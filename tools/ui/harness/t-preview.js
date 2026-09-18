#!/usr/bin/env node
'use strict';
/*
 * A13, the live preview. The card is behind its switch, the request carries what the sliders
 * and the effect editor's state say, the countdown is the device's, and Stop cancels.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-preview.js PS_CLONE=1
 */
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = async () => (await fetch(`${BASE}/__sent`)).json();
const preview = async () => (await fetch(`${BASE}/api/preview`)).json();
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
async function waitFor(page, body, ms = 4000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function tap(page, sel) { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); }
async function lastTo(path, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const rows = (await sent()).filter((r) => r.api === path && r.frame);
    if (rows.length) return rows[rows.length - 1].frame;
    await sleep(40);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });

    await page.goto(BASE + '/');
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('theme'));
    t('A1 the card is away while the switch is off', await page.$eval('#ps-pv-card', (e) => e.hidden));

    // the switch, and the effect editor's switch so a state can be chosen
    await post('/api/features', { features: { preview: true, state_effects: true } });
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('theme'));
    t('B1 the card appears', await waitFor(page, "!document.getElementById('ps-pv-card').hidden"));
    t('B2 the stage list is None plus the device\'s fifteen',
      await page.$eval('#ps-pv-stage', (s) => s.options.length) === 16,
      await page.$eval('#ps-pv-stage', (s) => s.options.length));
    t('B3 Stop is away while nothing is pinned', await page.$eval('#ps-pv-stop', (e) => e.hidden));
    t('B4 loading the card pinned nothing', (await preview()).active === false);

    // ---- the request carries what the page says ----
    await page.$eval('#ps-pv-percent', (el) => { el.value = '42'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.$eval('#ps-pv-seconds', (el) => { el.value = '30'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.selectOption('#ps-pv-stage', '2');           // bed_heating
    await page.evaluate(() => document.getElementById('ps-fx-state-1').click());   // printing
    await tap(page, '#ps-pv-go');

    const body = await lastTo('/api/preview');
    t('C1 the device is asked for the state the editor has selected', !!body && body.state === 1, body);
    t('C2 with the percentage from the slider', !!body && body.percent === 42, body);
    t('C3 with the stage that was chosen', !!body && body.stage === 2, body);
    t('C4 for the number of seconds that was chosen', !!body && body.seconds === 30, body);

    const p1 = await preview();
    t('D1 the device is pinned', p1.active === true && p1.state === 1 && p1.percent === 42, p1);
    t('D2 Stop appears', await waitFor(page, "!document.getElementById('ps-pv-stop').hidden"));
    t('D3 the page counts down from the device\'s own remaining, not a timer of its own',
      await waitFor(page, "/\\d/.test(document.getElementById('ps-pv-note').textContent)"),
      await page.$eval('#ps-pv-note', (e) => e.textContent));

    // ---- Stop ----
    await tap(page, '#ps-pv-stop');
    await sleep(400);
    const p2 = await preview();
    t('E1 Stop cancels the pin on the device', p2.active === false, p2);
    t('E2 Stop goes away with it', await waitFor(page, "document.getElementById('ps-pv-stop').hidden"));
    t('E3 and the countdown line is cleared', (await page.$eval('#ps-pv-note', (e) => e.textContent)) === '');

    // ---- G: the per-state buttons on the Per state card ----
    // One button per bar state, no sliders: fifteen seconds of THAT state.
    t('G1 three buttons, one per state, and all of them up while the switch is on',
      await page.$$eval('.pv-one', (b) => b.length) === 3 &&
      await page.$$eval('.pv-slot', (b) => b.every((s) => !s.hidden)));
    t('G2 each one names the state it belongs to, for a reader who cannot see the row',
      await page.$eval('#ps-pv-state-2', (b) => b.getAttribute('aria-labelledby')) === 'pv-lbl-2 lbl-col-2');

    await tap(page, '#ps-pv-state-2');                 // error
    const g = await lastTo('/api/preview');
    t('G3 the error button asks for the error state', !!g && g.state === 2, g);
    t('G4 for fifteen seconds, which is what the button says', !!g && g.seconds === 15, g);
    t('G5 with a percentage, so a progress effect has something to draw',
      !!g && g.percent === 60, g);
    t('G6 no stage is pinned: the row previews a state, not a step of a print',
      !!g && g.stage === undefined, g);

    const p3 = await preview();
    t('G7 the device is pinned to it', p3.active === true && p3.state === 2, p3);
    t('G8 that button is the one marked live',
      await waitFor(page, "document.getElementById('ps-pv-state-2').classList.contains('fill')"));
    t('G9 and the other two are not',
      await page.$eval('#ps-pv-state-0', (b) => !b.classList.contains('fill')) &&
      await page.$eval('#ps-pv-state-1', (b) => !b.classList.contains('fill')));

    // a second state takes the pin from the first
    await tap(page, '#ps-pv-state-0');
    await sleep(400);
    const p4 = await preview();
    t('G10 clicking another state moves the pin', p4.active === true && p4.state === 0, p4);
    t('G11 the mark moves with it',
      await waitFor(page, "document.getElementById('ps-pv-state-0').classList.contains('fill')") &&
      await page.$eval('#ps-pv-state-2', (b) => !b.classList.contains('fill')));

    // Stop on the card below ends what a row started
    await tap(page, '#ps-pv-stop');
    await sleep(400);
    t('G12 Stop ends a pin a row button started', (await preview()).active === false);
    t('G13 and no row is left marked live',
      await waitFor(page, "!document.getElementById('ps-pv-state-0').classList.contains('fill')"));

    // the switch off takes the rows with it, because the route goes with it
    await post('/api/features', { features: { preview: false } });
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('theme'));
    t('G14 with the switch off every row button is away',
      await waitFor(page, "Array.from(document.querySelectorAll('.pv-slot')).every(s => s.hidden)"));
    t('G15 and so is the card', await page.$eval('#ps-pv-card', (e) => e.hidden));

    t('F1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
