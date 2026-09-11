#!/usr/bin/env node
'use strict';
/*
 * Features harness: the clone's own route and the first feature behind it (A1, per-state
 * brightness). Two rows in the sweep, and the row decides what is asserted:
 *
 *   PS_CLONE unset   the factory. GET /api/features is a 302, so the page must show no
 *                    Features card, no per-state tile, and must send nothing to the route.
 *   PS_CLONE=1       the clone. The card shows with every switch off; turning one on sends
 *                    exactly {"features":{"state_brightness":true}}; the Lighting page then
 *                    shows the three sliders for the current mode and a nudge sends exactly
 *                    the whole 2 x 3 table; the factory's own brightness slider keeps sending
 *                    the factory frame untouched; the setting survives a reload; off again
 *                    hides the tile.
 *
 * Fixture facts (p2-idle.json): current_mode 1 (H2D), brightness 50 in both modes.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-features.js
 *       tools/ui/harness/run.sh p2-idle.json page-features.js PS_CLONE=1
 */

const pw = require('./pw');
const { t, frame, apiFrame, sentAfter, sent, resetMock } = pw;

const CLONE = process.env.PS_CLONE === '1';
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const $ = (page, id) => page.locator('#' + id);
const val = (page, id) => page.$eval('#' + id, (el) => el.value);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const hidden = (page, id) => page.$eval('#' + id, (el) => el.hidden);
const count = async () => (await sent()).length;
const apiSent = async () => (await sent()).filter((r) => r.api);
// Beer's switch covers the native checkbox with a span; the label is what a person clicks
async function toggle(page, id) { await page.locator('label.switch:has(#' + id + ')').click(); }
async function nudge(page, id, key) { await $(page, id).focus(); await page.keyboard.press(key); await page.keyboard.press('Tab'); }
async function waitHidden(page, id, want, ms = 3000) {
  return page.waitForFunction(([i, w]) => document.getElementById(i).hidden === w, [id, want], { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function go(page, hash) { await page.evaluate((h) => { location.hash = h; }, hash); await pw.sleep(150); }

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#system' });
  await pw.sleep(700);

  if (!CLONE) {
    t(`${tag} F1 factory: the Features card stays hidden`, await hidden(page, 'ps-system-features'));
    t(`${tag} F2 factory: PS.features is null`, await page.evaluate(() => PS.features === null));
    t(`${tag} F3 factory: nothing was sent to the route`, (await apiSent()).length === 0, await apiSent());
    await go(page, '#lighting');
    t(`${tag} F4 factory: the per-state tile stays hidden`, await hidden(page, 'ps-lighting-sb'));
    await pw.shot(page, `features-factory-lighting-${combo.theme}-${combo.width}`);
    t(`${tag} F5 no page errors`, errors.length === 0, errors);
    await ctx.close();
    return;
  }

  // ---- the clone: the card, off by default ----
  t(`${tag} C1 the Features card shows`, await waitHidden(page, 'ps-system-features', false));
  t(`${tag} C2 the switch is off`, !(await page.$eval('#ps-system-feature-state-brightness', (el) => el.checked)));
  t(`${tag} C3 PS.features carries the document with the switch off and the defaults`,
    await page.evaluate(() => PS.features && PS.features.features.state_brightness === false && JSON.stringify(PS.features.config.state_brightness) === '[[50,50,50],[50,50,50]]'));
  await pw.shot(page, `features-system-off-${combo.theme}-${combo.width}`);

  // ---- on: exactly one body ----
  let n = await count();
  await toggle(page, 'ps-system-feature-state-brightness');
  let got = await sentAfter(n);
  t(`${tag} C4 turning it on sends exactly {"features":{"state_brightness":true}}`, got.length === 1 && got[0] === apiFrame({ features: { state_brightness: true } }), got);
  t(`${tag} C5 the device's answer lands: switch on`, await page.waitForFunction(() => PS.features && PS.features.features.state_brightness === true, null, { timeout: 2000 }).then(() => true).catch(() => false)
    && (await page.$eval('#ps-system-feature-state-brightness', (el) => el.checked)));
  await pw.shot(page, `features-system-on-${combo.theme}-${combo.width}`);

  // ---- the lighting page: the current mode's row ----
  await go(page, '#lighting');
  t(`${tag} C6 the per-state tile shows`, await waitHidden(page, 'ps-lighting-sb', false));
  t(`${tag} C7 three sliders at 50 with 50% labels`,
    (await val(page, 'ps-lighting-sb-0')) === '50' && (await val(page, 'ps-lighting-sb-1')) === '50' && (await val(page, 'ps-lighting-sb-2')) === '50'
    && (await text(page, 'ps-lighting-sb-value-1')) === '50%');
  n = await count();
  await nudge(page, 'ps-lighting-sb-1', 'ArrowRight');
  got = await sentAfter(n);
  t(`${tag} C8 nudging the printing slider sends the whole table with H2D's printing at 55`,
    got.length === 1 && got[0] === apiFrame({ config: { state_brightness: [[50, 50, 50], [50, 55, 50]] } }), got);
  t(`${tag} C9 the answer lands: label 55%`, await page.waitForFunction(() => document.getElementById('ps-lighting-sb-value-1').textContent === '55%', null, { timeout: 2000 }).then(() => true).catch(() => false));
  n = await count();
  await nudge(page, 'ps-lighting-brightness', 'ArrowRight');
  got = await sentAfter(n);
  t(`${tag} C10 the factory brightness slider still sends the factory frame, untouched`, got.length === 1 && got[0] === frame('settings', { rgb_info_brightness: 55 }), got);
  await pw.shot(page, `features-lighting-on-${combo.theme}-${combo.width}`);

  // ---- mode change: the other row ----
  n = await count();
  await $(page, 'ps-lighting-mode').selectOption('0');
  got = await sentAfter(n);
  t(`${tag} C11 the mode select still sends the factory frame`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 0 }), got);
  t(`${tag} C12 Music mode shows Music's row, still at 50`, await page.waitForFunction(() => document.getElementById('ps-lighting-sb-value-1').textContent === '50%', null, { timeout: 2000 }).then(() => true).catch(() => false));

  // ---- a reload: the device kept it ----
  await page.reload(); await pw.sleep(900);
  t(`${tag} C13 after a reload the tile is back and H2D's printing value is still 55`,
    await waitHidden(page, 'ps-lighting-sb', false) && await page.evaluate(() => PS.features.config.state_brightness[1][1] === 55));

  // ---- off again ----
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-state-brightness');
  got = await sentAfter(n);
  t(`${tag} C14 turning it off sends exactly {"features":{"state_brightness":false}}`, got.length === 1 && got[0] === apiFrame({ features: { state_brightness: false } }), got);
  await go(page, '#lighting');
  t(`${tag} C15 the per-state tile hides again`, await waitHidden(page, 'ps-lighting-sb', true));
  t(`${tag} C16 no page errors`, errors.length === 0, errors);
  await ctx.close();
}

(async () => {
  const browser = await pw.launch();
  try { for (const combo of COMBOS) await drive(browser, combo); }
  finally { await browser.close(); }
  process.exit(pw.verdict());
})();
