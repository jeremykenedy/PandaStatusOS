#!/usr/bin/env node
'use strict';
/*
 * topbar: the chip on the top bar through its transitions, driven by the device and never
 * by the page's own guess.
 *
 * The chip is one word and a dot, and it has four things to say: nothing has arrived yet;
 * the device is talking and the link is such-and-such; the printer is idle; the printer is
 * printing, at this stage, this far along. Each comes from a different source (the page's
 * own boot, the socket's printer root, the print document) and the mistake this harness
 * exists for is a word left behind by the source before it. The vent's harness of this name
 * watched its state dot the same way, without racing the device's own push: every change
 * here is made through the mock and then waited for, never asserted on a timer.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-topbar.js PS_CLONE=1 PS_DELAY=1200
 */
const pw = require('./pw');
const { t } = pw;

const chip = (page) => page.evaluate(() => ({
  word: (document.getElementById('ps-top-state') || {}).textContent || '',
  dot: (document.getElementById('ps-top-dot') || {}).getAttribute('class') || '',
  pct: (document.getElementById('ps-top-pct') || {}).textContent || '',
  pctHidden: !!(document.getElementById('ps-top-pct') || {}).hidden,
  prog: !(document.getElementById('ps-top-prog') || {}).hidden,
}));
const word = (page, key, fb) => page.evaluate(([k, f]) => tr(k, f), [key, fb]);
const until = (page, body, ms = 4000) => page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 50 }).then(() => true).catch(() => false);

(async () => {
  const browser = await pw.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${pw.BASE}/`);
    await pw.sleep(400);
    const waiting = await word(page, 'ui_waiting_short', 'Waiting for the device');
    let c = await chip(page);
    t('A1 before the device has spoken the chip says so, with a bare dot and no percentage', c.word === waiting && c.dot === 'ux_top_dot' && c.pctHidden && !c.prog, c);

    /* the first state: the socket says the link is up and nothing yet about a print */
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 6000 });
    c = await chip(page);
    const connected = await word(page, 'ui_link_state_3', 'Connected');
    const idle = await word(page, 'ui_printer_state_0', 'Idle');
    t('A2 on landing the chip is the link\'s own word or already the printer\'s, never the waiting word', (c.word === connected || c.word === idle) && c.word !== waiting, c);

    /* the print document: idle */
    t('B1 once the print document has come the chip says Idle with the idle dot', await until(page, `document.getElementById('ps-top-state').textContent === ${JSON.stringify(idle)} && /is-idle/.test(document.getElementById('ps-top-dot').getAttribute('class'))`), await chip(page));
    c = await chip(page);
    t('B2 and no percentage or progress line is shown for a printer that is not printing', c.pctHidden && !c.prog, c);

    /* printing, at a stage and a percentage. The knobs set what /api/print will say; the status
       push is what the device sends when the printer's report changes (ps_printer.c), and it is
       what makes the page ask for the print document now rather than on its idle poll. */
    const report = (status) => fetch(`${pw.BASE}/__printer_status`, { method: 'POST', body: JSON.stringify(status) });
    await pw.knob('PS_PRINT_PERCENT', 37);
    await pw.knob('PS_PRINT_STAGE', 14);
    await report({ device_state: 2 });
    const printing = await page.evaluate(() => tr('ui_stage_printing', 'Printing'));
    t('C1 a print under way: within two seconds of the report the chip says the stage, the dot runs, the percentage shows', await until(page, `document.getElementById('ps-top-state').textContent === ${JSON.stringify(printing)} && /is-run/.test(document.getElementById('ps-top-dot').getAttribute('class')) && document.getElementById('ps-top-pct').textContent === '37%'`, 2500), await chip(page));
    c = await chip(page);
    t('C2 and the progress line under the bar is on', c.prog && !c.pctHidden, c);

    /* the stage moves, the percentage climbs: each shown as sent, not smoothed by the page */
    await pw.knob('PS_PRINT_STAGE', 4);
    await pw.knob('PS_PRINT_PERCENT', 38);
    await report({ nozzle_temp: 211 });
    const heating = await page.evaluate(() => tr('ui_stage_homing', 'Homing'));
    t('D1 the next report moves the word and the number together', await until(page, `document.getElementById('ps-top-state').textContent === ${JSON.stringify(heating)} && document.getElementById('ps-top-pct').textContent === '38%'`, 6000), await chip(page));

    /* the print ends */
    await pw.knob('PS_PRINT_PERCENT', -1);
    await report({ device_state: 4 });
    t('E1 when the print is over the chip is Idle again and the percentage goes', await until(page, `document.getElementById('ps-top-state').textContent === ${JSON.stringify(idle)} && document.getElementById('ps-top-pct').hidden`, 6000), await chip(page));

    /* the printer link fails: the socket's word outranks the print document's */
    await fetch(`${pw.BASE}/__printer_move`, { method: 'POST', body: JSON.stringify({ ip: '192.0.2.99' }) });
    const iperr = await word(page, 'ui_link_state_4', 'IP error');
    t('F1 a printer that cannot be reached: the chip says the link\'s error with the error dot', await until(page, `document.getElementById('ps-top-state').textContent === ${JSON.stringify(iperr)} && /is-err/.test(document.getElementById('ps-top-dot').getAttribute('class'))`, 8000), await chip(page));

    /* O8: the door row on the printer card follows the report, closed and open, with its own
       icon each way. The fixture starts shut, which is how the owner's printer stood when this
       was checked against it (home_flag bit 23 clear). */
    await page.evaluate(() => show_card('status'));
    const doorRow = () => page.$eval('#ps-kv-printer', (ul) => { const li = Array.from(ul.querySelectorAll('li')).find((e) => /Door/.test(e.textContent)); if (!li) return null; const u = li.querySelector('use'); return { text: li.textContent.replace(/\s+/g, ' ').trim(), icon: u ? u.getAttribute('href') : null }; });
    t('K1 the door row is there and says Closed, with the shut door icon', await until(page, "Array.from(document.querySelectorAll('#ps-kv-printer li')).some((e) => /Door/.test(e.textContent) && /Closed/.test(e.textContent))", 3000) && (await doorRow()).icon === '#i-door', await doorRow());
    await report({ door_open: 1 });
    t('K2 the printer reports it open: the row says Open with the open door icon, within the push', await until(page, "Array.from(document.querySelectorAll('#ps-kv-printer li')).some((e) => /Door/.test(e.textContent) && /Open/.test(e.textContent))", 3000) && (await doorRow()).icon === '#i-door-open', await doorRow());
    await report({ door_open: 0 });
    t('K3 and shut again', await until(page, "Array.from(document.querySelectorAll('#ps-kv-printer li')).some((e) => /Door/.test(e.textContent) && /Closed/.test(e.textContent))", 3000), await doorRow());

    /* the socket drops: back to the waiting word, not the last state seen */
    await pw.knob('PS_NO_PUSH', 1);
    await page.evaluate(() => { try { g_sock.close(); } catch (e) {} });
    t('G1 the socket gone: the chip says waiting again rather than the last thing it saw', await until(page, `document.body.classList.contains('is-waiting') && document.getElementById('ps-top-state').textContent === ${JSON.stringify(waiting)}`, 4000), await chip(page));

    t('H1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
