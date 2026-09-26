#!/usr/bin/env node
'use strict';
/*
 * A4, an effect kept inside the printed part of the bar: the switch under the effect list,
 * offered only with the effect's own settings and never for the three effects that draw
 * only the progress already, stored per state in the effect's opt as 0x20.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-inprog.js PS_CLONE=1
 */
const { chromium } = require('playwright');
const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;
const IN_PROGRESS = 0x20;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const feats = async () => (await fetch(`${BASE}/api/features`)).json();
const post = (b) => fetch(`${BASE}/api/features`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const opt = async (st) => (await feats()).config.state_effects[st].opt;
async function waitFor(page, body, ms = 3000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function tap(page, sel) { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); }
const rowShown = "!document.getElementById('ps-fx-inprog-row').hidden";
const rowHidden = "document.getElementById('ps-fx-inprog-row').hidden";

async function fresh(page) {
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
  await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
  await page.evaluate(() => show_card('theme'));
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

    // ---- A. effects on, their own settings off: no switch ----
    await post({ features: { state_effects: true, fx_progress: true } });
    await fresh(page);
    t('A1 the effect list is there', await waitFor(page, "!document.getElementById('ps-fx-card').hidden"));
    t('A2 but not the switch, without the effect\'s own settings', await waitFor(page, rowHidden));

    // ---- B. with them, the switch sits under the list, off ----
    await post({ features: { effect_params: true } });
    await fresh(page);
    await tap(page, '#ps-fx-state-1');
    await page.selectOption('#ps-fx-effect', '6');
    await sleep(400);
    t('B1 the printing state runs the rainbow', (await feats()).config.state_effects[1].effect === 6);
    t('B2 the switch shows under the list', await waitFor(page, rowShown));
    t('B3 and starts off', (await page.$eval('#ps-fx-inprog', (e) => e.checked)) === false);
    const before0 = await opt(0), before2 = await opt(2);

    // ---- C. on: the device holds the bit for that state alone ----
    await tap(page, '#ps-fx-inprog');
    await sleep(400);
    t('C1 the device holds 0x20 for printing', ((await opt(1)) & IN_PROGRESS) !== 0, await opt(1));
    t('C2 idle and error keep what they had', (await opt(0)) === before0 && (await opt(2)) === before2, [await opt(0), await opt(2)]);
    t('C3 the switch follows the device', await waitFor(page, "document.getElementById('ps-fx-inprog').checked === true"));

    // ---- D. the three that draw the progress do not offer it ----
    await page.selectOption('#ps-fx-effect', '17');
    await sleep(400);
    t('D1 the progress bar is chosen', (await feats()).config.state_effects[1].effect === 17);
    t('D2 and the switch goes away for it', await waitFor(page, rowHidden));
    await page.selectOption('#ps-fx-effect', '6');
    await sleep(400);
    t('D3 back on the rainbow the switch returns, still on', (await waitFor(page, rowShown)) && (await page.$eval('#ps-fx-inprog', (e) => e.checked)) === true);

    // ---- E. the other states are their own ----
    await tap(page, '#ps-fx-state-0');
    await sleep(200);
    t('E1 idle shows its own setting, off', (await page.$eval('#ps-fx-inprog', (e) => e.checked)) === false);
    await tap(page, '#ps-fx-state-1');

    // ---- F. off again ----
    await tap(page, '#ps-fx-inprog');
    await sleep(400);
    t('F1 the device clears the bit', ((await opt(1)) & IN_PROGRESS) === 0, await opt(1));

    // ---- G. the device refuses a bit it does not know ----
    const cur = (await feats()).config.state_effects;
    const bad = JSON.parse(JSON.stringify(cur)); bad[1].opt = 0x40;
    const r = await post({ config: { state_effects: bad } });
    t('G1 opt 0x40 is refused whole', r.status === 400, r.status);
    t('G2 and nothing changed', (await opt(1)) === cur[1].opt, await opt(1));

    // ---- H. the effect's own settings off again: the switch goes ----
    await post({ features: { effect_params: false } });
    await fresh(page);
    await tap(page, '#ps-fx-state-1');
    t('H1 no switch without the effect\'s own settings', await waitFor(page, rowHidden));

    t('I1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
