#!/usr/bin/env node
'use strict';
/*
 * Printer controls: the lamp, and nothing beside it.
 *
 * The card rides the clone's own printer_ctl root, which the device does not store and does
 * not echo: the printer answers in its own time, through its telemetry, and that is the only
 * thing allowed to move a control. So the assertions here are about restraint: a switch that
 * was just clicked is held against pushes that still carry the printer's old value, for a
 * bounded window, after which the printer wins.
 *
 * Three fan sliders and a four-level speed control sat here for one day. The printer refused
 * every one of them with "mqtt message verify failed", because on this firmware the fans and
 * the speed are signed commands and this device signs nothing, and the owner had them taken
 * out (D-052, D-053, D-054). The fan speeds and the running level are still shown, as
 * readings, on the printer card and the job strip.
 *
 *   tools/ui/harness/run.sh p2-printing.json t-pctl.js PS_CLONE=1 PS_PRINT_PERCENT=37 PS_PRINT_SPEED=2
 */
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
async function waitFor(page, body, ms = 4000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
/* every printer_ctl frame the page has sent, oldest first */
async function pctl() {
  const rows = await (await fetch(`${BASE}/__sent`)).json();
  return rows.filter((r) => r.roots && r.roots.length === 1 && r.roots[0] === 'printer_ctl');
}
/* the frames sent since a mark, waiting briefly for at least `want` of them */
async function since(mark, want, ms = 1500) {
  const end = Date.now() + ms;
  for (;;) {
    const all = await pctl();
    const fresh = all.slice(mark);
    if (fresh.length >= want || Date.now() > end) return fresh;
    await sleep(40);
  }
}
async function open(page) {
  await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
  await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
  await page.evaluate(() => show_card('status'));
}
const mstate = async () => (await (await fetch(`${BASE}/__state`)).json());

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });

    await page.goto(BASE + '/');
    await open(page);

    // ---- A: the card, and the one row the printer's report earned ----
    t('A1 the card is up: the printer is bound, printing, and has named its lamp',
      await waitFor(page, "!document.getElementById('ps-card-pctl').hidden"));
    t('A2 the lamp row is up and the switch shows what the printer said, not a default',
      await page.$eval('#ps-pctl-chamber-light-row', (e) => !e.hidden) &&
      await page.$eval('#ps-pctl-chamber-light', (e) => e.checked === true));
    t('A3 the card carries exactly one control',
      await page.$$eval('#ps-card-pctl input, #ps-card-pctl button', (els) => els.length) === 1,
      await page.$$eval('#ps-card-pctl input, #ps-card-pctl button', (els) => els.map((e) => e.id)));

    // ---- B: what is not here, on purpose ----
    t('B1 no fan slider anywhere on the page',
      (await page.$$('[id^="ps-pctl-fan"]')).length === 0);
    t('B2 no speed control anywhere on the page',
      (await page.$$('#ps-pctl-speed, #ps-pctl-speed-wrap, button[data-level]')).length === 0);
    t('B3 no line about Developer Mode on the card, because nothing on it needs it',
      await page.$eval('#ps-card-pctl', (e) => !/Developer Mode/i.test(e.textContent)),
      await page.$eval('#ps-card-pctl', (e) => e.textContent.trim()));
    t('B4 the fan speeds are still shown as a reading on the printer card',
      await page.$eval('#ps-kv-printer', (e) => /40%/.test(e.textContent) && /70%/.test(e.textContent)),
      await page.$eval('#ps-kv-printer', (e) => e.textContent.replace(/\s+/g, ' ').trim()));
    t('B5 and the running level as a reading on the job strip',
      await page.$$eval('#ps-job-meta span', (ss) => ss.some((x) => x.textContent.trim() === 'Standard')),
      await page.$$eval('#ps-job-meta span', (ss) => ss.map((x) => x.textContent.trim())));

    // ---- C: the lamp, which settles against the printer's own report ----
    /* A switch that has just been clicked has FOCUS: everything below would pass trivially
       under a rule that spared a focused control, so the hold is by time, not by focus. */
    await post('/__knob', { name: 'PS_PCTL_ECHO', value: '1' });   // a printer that obeys
    let mark = (await pctl()).length;
    await page.click('#ps-pctl-chamber-light');                    // the printer said it was on
    let fresh = await since(mark, 1);
    t('C1 one command, naming the lamp and the state asked for',
      fresh.length === 1 && fresh[0].frame.printer_ctl.light === 'chamber_light' && fresh[0].frame.printer_ctl.on === 0,
      fresh.map((r) => r.text));
    t('C2 naming nothing else',
      !!fresh[0] && Object.keys(fresh[0].frame.printer_ctl).filter((k) => k !== 'device_wakeup').length === 2,
      fresh[0] && fresh[0].frame);
    t('C3 with the wakeup member every outbound frame carries',
      !!fresh[0] && fresh[0].device_wakeup === true, fresh[0] && fresh[0].frame);
    await sleep(600);                                              // the echo, and its push
    t('C4 the printer takes it and says so in its own report',
      (await mstate()).printer.status.printer_light === 0,
      (await mstate()).printer.status.printer_light);
    t('C5 and the switch is where the printer is', await page.$eval('#ps-pctl-chamber-light', (e) => e.checked === false));

    await post('/__knob', { name: 'PS_PCTL_ECHO', value: '0' });   // a printer that ignores it
    mark = (await pctl()).length;
    await page.click('#ps-pctl-chamber-light');                    // ask for on
    fresh = await since(mark, 1);
    t('C6 the command goes out regardless: the page cannot know it will be ignored',
      fresh.length === 1 && fresh[0].frame.printer_ctl.on === 1, fresh.map((r) => r.text));
    t('C7 the switch has focus, because it was just clicked',
      await page.evaluate(() => document.activeElement && document.activeElement.id) === 'ps-pctl-chamber-light',
      await page.evaluate(() => document.activeElement && document.activeElement.id));
    await post('/__printer_status', { uptime_s: 23 });              // a push still saying off
    await sleep(300);
    t('C8 a push still carrying the old value does not flip it back inside the window',
      await page.$eval('#ps-pctl-chamber-light', (e) => e.checked === true));
    t('C9 the printer never took it: the switch goes back to the printer, focus and all',
      await waitFor(page, "document.getElementById('ps-pctl-chamber-light').checked === false", 7000),
      await page.$eval('#ps-pctl-chamber-light', (e) => e.checked));

    // ---- D: a printer that has not named its lamp, and one that is gone ----
    await post('/__printer_status', { printer_light: null });
    await page.reload();
    await open(page);
    t('D1 a lamp the printer has never named has no row, and the card goes with it',
      await waitFor(page, "document.getElementById('ps-card-pctl').hidden"));
    await post('/__printer_status', { printer_light: 1 });
    t('D2 the printer names it: the row and the card come back carrying the reading',
      await waitFor(page, "!document.getElementById('ps-card-pctl').hidden") &&
      await page.$eval('#ps-pctl-chamber-light', (e) => e.checked === true));
    await post('/__printer_move', { ip: '' });          // state 4: nothing answers there
    t('D3 the whole card goes away with the printer',
      await waitFor(page, "document.getElementById('ps-card-pctl').hidden"));

    t('E1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
