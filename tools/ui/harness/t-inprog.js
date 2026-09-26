#!/usr/bin/env node
'use strict';
/*
 * A4, an effect kept inside the printed part of the bar: the switch under the effect list,
 * offered only with the effect's own settings and never for the three effects that draw
 * only the progress already, stored per state in the effect's opt as 0x20. On by default
 * (O2), and with it on the unfilled part runs an effect of its own, one of the seventeen
 * that need no live input, stored as fx_unlit (O1).
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
const unlit = async (st) => (await feats()).config.state_effects[st].fx_unlit;
const unlitShown = "!document.getElementById('ps-fx-unlit-wrap').hidden";
const unlitHidden = "document.getElementById('ps-fx-unlit-wrap').hidden";
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
    t('B3 and starts on: a new device keeps its effects inside the progress (O2)', (await page.$eval('#ps-fx-inprog', (e) => e.checked)) === true && ((await opt(1)) & IN_PROGRESS) !== 0, await opt(1));
    t('B4 with it on, the unfilled part\'s own effect is offered', await waitFor(page, unlitShown));
    t('B5 seventeen to choose from, none that draws the progress', await page.$$eval('#ps-fx-unlit option', (o) => o.length) === 17);
    t('B6 and it starts solid, which with the unlit colour dark is off', (await page.$eval('#ps-fx-unlit', (e) => e.value)) === '0' && (await unlit(1)) === 0, await unlit(1));
    const before0 = await opt(0), before2 = await opt(2);

    // ---- C. the unfilled part's effect reaches the device, for that state alone ----
    await page.selectOption('#ps-fx-unlit', '1');
    await sleep(400);
    t('C1 the device holds breathing for the unfilled part of printing', (await unlit(1)) === 1, await unlit(1));
    t('C2 idle and error keep what they had', (await opt(0)) === before0 && (await opt(2)) === before2 && (await unlit(0)) === 0, [await opt(0), await opt(2)]);
    t('C3 the list follows the device', await waitFor(page, "document.getElementById('ps-fx-unlit').value === '1'"));
    // a progress draw on the unfilled part is refused whole
    const cur0 = (await feats()).config.state_effects;
    const bad0 = JSON.parse(JSON.stringify(cur0)); bad0[1].fx_unlit = 17;
    const r0 = await post({ config: { state_effects: bad0 } });
    t('C4 a progress draw as the unfilled part\'s effect is refused', r0.status === 400 && (await unlit(1)) === 1, [r0.status, await unlit(1)]);

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
    t('E1 idle shows its own setting: kept, with a solid unfilled part', (await page.$eval('#ps-fx-inprog', (e) => e.checked)) === true && (await page.$eval('#ps-fx-unlit', (e) => e.value)) === '0');
    await tap(page, '#ps-fx-state-1');

    // ---- F. off: the bit clears, and the unfilled part\'s list goes with it ----
    await tap(page, '#ps-fx-inprog');
    await sleep(400);
    t('F1 the device clears the bit', ((await opt(1)) & IN_PROGRESS) === 0, await opt(1));
    t('F2 and the unfilled part\'s effect is not offered while nothing is unfilled', await waitFor(page, unlitHidden));
    t('F3 though the device keeps what was chosen for when it comes back', (await unlit(1)) === 1, await unlit(1));

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
