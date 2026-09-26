#!/usr/bin/env node
'use strict';
/*
 * Printer controls: the fans and the print speed, beside the lamp that was already there.
 *
 * All three ride the clone's own printer_ctl root, which the device does not store and does
 * not echo: the printer answers in its own time, through its telemetry, and that is the only
 * thing allowed to move a control. So the assertions here are mostly about restraint. A row
 * exists only for a fan the printer has actually named. A drag sends one command, when the
 * finger comes off, not one per pixel. A tapped speed button does not mark itself. And a
 * slider that was just dragged is held against pushes that still carry the printer's old
 * value, for a bounded window, after which the printer wins.
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
const val = (page, id) => page.$eval('#' + id, (e) => Number(e.value));
const shown = (page, id) => page.$eval('#' + id + '-value', (e) => e.textContent.trim());

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

    // ---- A: the card, and the rows the printer's report earned ----
    t('A1 the card is up: the printer is bound, printing, and has named controls',
      await waitFor(page, "!document.getElementById('ps-card-pctl').hidden"));
    t('A2 the lamp row is up and the switch shows what the printer said, not a default',
      await page.$eval('#ps-pctl-chamber-light-row', (e) => !e.hidden) &&
      await page.$eval('#ps-pctl-chamber-light', (e) => e.checked === true));
    t('A3 one row per fan the printer named, all three up',
      await page.$eval('#ps-pctl-fan-part-row', (e) => !e.hidden) &&
      await page.$eval('#ps-pctl-fan-aux-row', (e) => !e.hidden) &&
      await page.$eval('#ps-pctl-fan-chamber-row', (e) => !e.hidden));
    t('A4 each slider carries the percentage the printer reported',
      await val(page, 'ps-pctl-fan-part') === 40 &&
      await val(page, 'ps-pctl-fan-aux') === 70 &&
      await val(page, 'ps-pctl-fan-chamber') === 0,
      [await val(page, 'ps-pctl-fan-part'), await val(page, 'ps-pctl-fan-aux'), await val(page, 'ps-pctl-fan-chamber')]);
    t('A5 and the number beside it, including a fan the printer says is off',
      await shown(page, 'ps-pctl-fan-part') === '40%' && await shown(page, 'ps-pctl-fan-chamber') === '0%',
      [await shown(page, 'ps-pctl-fan-part'), await shown(page, 'ps-pctl-fan-chamber')]);

    // ---- B: a fan the printer has not named ----
    /* Taken on a fresh page, because the state document is MERGED: a fan named once stays
       named, and a report that drops it is not the printer saying the fan is gone. What the
       row rule is actually about is a device whose report never carried that fan, which is
       this, and a printer that starts reporting one, which is below. */
    await post('/__printer_status', { fan_chamber: null });
    await page.reload();
    await open(page);
    t('B1 a fan the printer has not named has no row: a slider at zero would be a reading',
      await page.$eval('#ps-pctl-fan-chamber-row', (e) => e.hidden));
    t('B2 the fans it did name have theirs',
      await page.$eval('#ps-pctl-fan-part-row', (e) => !e.hidden) &&
      await page.$eval('#ps-pctl-fan-aux-row', (e) => !e.hidden));
    t('B3 and the card is up, because there is still something in it',
      await page.$eval('#ps-card-pctl', (e) => !e.hidden));
    await post('/__printer_status', { fan_chamber: 25 });
    t('B4 the printer names it: the row appears carrying the reading, not a default',
      await waitFor(page, "!document.getElementById('ps-pctl-fan-chamber-row').hidden") &&
      await val(page, 'ps-pctl-fan-chamber') === 25,
      await val(page, 'ps-pctl-fan-chamber'));

    // ---- C: one command per drag ----
    let mark = (await pctl()).length;
    await page.$eval('#ps-pctl-fan-aux', (el) => {
      [10, 20, 30, 40, 50].forEach((v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); });
    });
    await sleep(250);
    t('C1 a drag in progress sends the printer nothing', (await pctl()).length === mark,
      (await pctl()).slice(mark).map((r) => r.text));
    t('C2 but the number beside the slider follows the finger', await shown(page, 'ps-pctl-fan-aux') === '50%',
      await shown(page, 'ps-pctl-fan-aux'));

    await page.$eval('#ps-pctl-fan-aux', (el) => {
      el.value = '60';
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    let fresh = await since(mark, 1);
    t('C3 the finger coming off sends exactly one command', fresh.length === 1, fresh.map((r) => r.text));
    t('C4 naming the fan and the percentage, and nothing else',
      !!fresh[0] && fresh[0].frame.printer_ctl.fan === 'aux' && fresh[0].frame.printer_ctl.percent === 60 &&
      Object.keys(fresh[0].frame.printer_ctl).filter((k) => k !== 'device_wakeup').length === 2,
      fresh[0] && fresh[0].frame);
    t('C5 with the wakeup member every outbound frame carries',
      !!fresh[0] && fresh[0].device_wakeup === true, fresh[0] && fresh[0].frame);

    // ---- D: the hold, and its end ----
    /* A dragged slider keeps focus and never gives it back, so the hold is what protects it,
       not focus. This assertion is here by name: with a focus rule in that branch instead,
       D3 can never pass, and the row would sit on the last value dragged for as long as the
       page stayed open. */
    t('D0 the slider still has focus after the drag, which is why focus cannot be the rule',
      await page.evaluate(() => document.activeElement && document.activeElement.id) === 'ps-pctl-fan-aux',
      await page.evaluate(() => document.activeElement && document.activeElement.id));
    await post('/__printer_status', { fan_aux: 40, uptime_s: 11 });
    await sleep(300);
    t('D1 a push still carrying the printer\'s old value does not drag the slider back',
      await val(page, 'ps-pctl-fan-aux') === 60, await val(page, 'ps-pctl-fan-aux'));
    t('D2 nor the number beside it', await shown(page, 'ps-pctl-fan-aux') === '60%', await shown(page, 'ps-pctl-fan-aux'));

    /* The window is bounded on purpose: a printer that never took the command must not leave
       the page showing a number the hardware is not running at. Five seconds, then the
       printer wins, whatever it says. This is the one wait in the file. */
    await sleep(5200);
    await post('/__printer_status', { fan_aux: 35, uptime_s: 17 });
    t('D3 once the window has run out the printer wins',
      await waitFor(page, "Number(document.getElementById('ps-pctl-fan-aux').value) === 35"),
      await val(page, 'ps-pctl-fan-aux'));

    // ---- E: no print speed control ----
    /* There were four level buttons here. The printer refused every one of them with
       "mqtt message verify failed" and the owner had them taken out (D-053). The level
       the printer runs at is still a reading on the job strip. */
    t('E1 there is no speed control on the card', (await page.$$('#ps-pctl-speed, #ps-pctl-speed-wrap, button[data-level]')).length === 0);
    t('E2 and the running level is still shown on the job strip as a reading',
      await page.$$eval('#ps-job-meta span', (ss) => ss.some((x) => x.textContent.trim() === 'Standard')),
      await page.$$eval('#ps-job-meta span', (ss) => ss.map((x) => x.textContent.trim())));

    // ---- I: the lamp, which rides the same root and settles the same way ----
    /* The lamp had no harness before the fans arrived. It is here because the switch is the
       case the fans' hold was reasoned from, and because a switch that has just been clicked
       has FOCUS: everything below would pass trivially under a rule that spared it. */
    await post('/__knob', { name: 'PS_PCTL_ECHO', value: '1' });   // a printer that obeys
    mark = (await pctl()).length;
    await page.click('#ps-pctl-chamber-light');                    // the printer said it was on
    fresh = await since(mark, 1);
    t('I1 one command, naming the lamp and the state asked for',
      fresh.length === 1 && fresh[0].frame.printer_ctl.light === 'chamber_light' && fresh[0].frame.printer_ctl.on === 0,
      fresh.map((r) => r.text));
    await sleep(600);                                              // the echo, and its push
    t('I2 the printer takes it and says so in its own report',
      (await mstate()).printer.status.printer_light === 0,
      (await mstate()).printer.status.printer_light);
    t('I3 and the switch is where the printer is', await page.$eval('#ps-pctl-chamber-light', (e) => e.checked === false));

    await post('/__knob', { name: 'PS_PCTL_ECHO', value: '0' });   // a printer that ignores it
    mark = (await pctl()).length;
    await page.click('#ps-pctl-chamber-light');                    // ask for on
    fresh = await since(mark, 1);
    t('I4 the command goes out regardless: the page cannot know it will be refused',
      fresh.length === 1 && fresh[0].frame.printer_ctl.on === 1, fresh.map((r) => r.text));
    t('I5 the switch has focus, because it was just clicked',
      await page.evaluate(() => document.activeElement && document.activeElement.id) === 'ps-pctl-chamber-light',
      await page.evaluate(() => document.activeElement && document.activeElement.id));
    await post('/__printer_status', { uptime_s: 23 });              // a push still saying off
    await sleep(300);
    t('I6 a push still carrying the old value does not flip it back inside the window',
      await page.$eval('#ps-pctl-chamber-light', (e) => e.checked === true));
    t('I7 the printer never took it: the switch goes back to the printer, focus and all',
      await waitFor(page, "document.getElementById('ps-pctl-chamber-light').checked === false", 7000),
      await page.$eval('#ps-pctl-chamber-light', (e) => e.checked));

    // ---- F: the printer refusing, which is what an unswitched Developer Mode looks like ----
    t('F1 nothing says the printer is refusing, because it has not',
      await page.$eval('#ps-pctl-locked', (e) => e.hidden));
    await post('/__printer_status', { cmd: { at_s: 42, ok: false, reason: 'mqtt message verify failed' } });
    t('F2 a verify failure puts up the line that names what to switch on',
      await waitFor(page, "!document.getElementById('ps-pctl-locked').hidden"));
    t('F3 and the line says where that switch is',
      /Developer Mode/i.test(await page.$eval('#ps-pctl-locked', (e) => e.textContent)) &&
      /LAN Only Mode/i.test(await page.$eval('#ps-pctl-locked', (e) => e.textContent)),
      await page.$eval('#ps-pctl-locked', (e) => e.textContent.trim()));
    t('F4 and it is said out loud once, not only written in the card',
      await page.$eval('#ps-toast', (e) => e.classList.contains('active') && /Developer Mode/i.test(e.textContent)),
      await page.$eval('#ps-toast', (e) => e.textContent.trim()));
    /* The ack is keyed on the printer's own timestamp. Every push after it carries the same
       ack, and a toast raised again on each one would be a printer refusing once and a page
       complaining forever. Cleared by hand here rather than waited out, so the second push is
       the only thing that could put it back. */
    await page.evaluate(() => document.getElementById('ps-toast').classList.remove('active'));
    await post('/__printer_status', { uptime_s: 29 });
    await sleep(400);
    t('F5 and not again on every push that carries the same refusal',
      await page.$eval('#ps-toast', (e) => !e.classList.contains('active')));
    t('F6 while the card goes on saying it, because that is still true',
      await page.$eval('#ps-pctl-locked', (e) => !e.hidden));

    // ---- G: a printer that is no longer printing ----
    await post('/__printer_move', { ip: '' });          // state 4: nothing answers there
    t('G1 the whole card goes away with the print',
      await waitFor(page, "document.getElementById('ps-card-pctl').hidden"));

    t('H1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
