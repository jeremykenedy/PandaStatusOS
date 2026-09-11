#!/usr/bin/env node
'use strict';
/*
 * Features harness: the clone's own route and the first feature behind it (A1, per-state
 * brightness). Two rows in the sweep, and the row decides what is asserted:
 *
 *   PS_CLONE unset   the factory. GET /api/features is a 302, so the page must show no
 *                    Features card, no per-state tile, and must send nothing to the route.
 *   PS_CLONE=1       the clone. The card shows with every switch off; turning one on sends
 *                    (A1, then A2: an effect per state, the select's exact table)
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
    t(`${tag} F4b factory: the effect tile stays hidden`, await hidden(page, 'ps-lighting-fx'));
    t(`${tag} F4c factory: no colour field box is shown`, await page.$$eval('[data-ps-fxc-state]', (els) => els.every((e) => e.hidden)));
    t(`${tag} F4d factory: no params box is shown`, await page.$$eval('[data-ps-fxp-state]', (els) => els.every((e) => e.hidden)));
    t(`${tag} F4e factory: no ramp box is shown`, await page.$$eval('[data-ps-fxr-state]', (els) => els.every((e) => e.hidden)));
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
  await pw.shot(page, `features-system-on-${combo.theme}-${combo.width}`, { full: true });

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

  // ---- A2: an effect per state ----
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  t(`${tag} E1 the effect switch is off and the tile hidden`, !(await page.$eval('#ps-system-feature-state-effects', (el) => el.checked)));
  n = await count();
  await toggle(page, 'ps-system-feature-state-effects');
  got = await sentAfter(n);
  t(`${tag} E2 turning effects on sends exactly {"features":{"state_effects":true}}`, got.length === 1 && got[0] === apiFrame({ features: { state_effects: true } }), got);
  await go(page, '#lighting');
  t(`${tag} E3 the effect tile shows with three selects at Solid`, await waitHidden(page, 'ps-lighting-fx', false)
    && (await val(page, 'ps-lighting-fx-0')) === '0' && (await val(page, 'ps-lighting-fx-1')) === '0' && (await val(page, 'ps-lighting-fx-2')) === '0');
  t(`${tag} E4 the select offers the seventeen effects, the four that read the print hidden until their switches`, (await page.$eval('#ps-lighting-fx-1', (el) => [...el.options].filter((o) => !o.hidden).length)) === 17);
  n = await count();
  await $(page, 'ps-lighting-fx-1').selectOption('1');
  got = await sentAfter(n);
  const before = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  const want = JSON.parse(JSON.stringify(before)); want[1].effect = 1;
  t(`${tag} E5 choosing Breathing for printing sends the whole three-state table with effect 1`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want } }), got);
  t(`${tag} E6 the answer lands: printing reads Breathing`, await page.waitForFunction(() => PS.features.config.state_effects[1].effect === 1, null, { timeout: 2000 }).then(() => true).catch(() => false)
    && (await val(page, 'ps-lighting-fx-1')) === '1');
  await pw.shot(page, `features-lighting-fx-${combo.theme}-${combo.width}`, { full: true });

  // ---- A3: the effect's own colours ----
  t(`${tag} G1 with only effects on, the colour boxes stay hidden`, await page.$$eval('[data-ps-fxc-state]', (els) => els.every((e) => e.hidden)));
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-effect-colours');
  got = await sentAfter(n);
  t(`${tag} G2 turning effect colours on sends exactly {"features":{"effect_colours":true}}`, got.length === 1 && got[0] === apiFrame({ features: { effect_colours: true } }), got);
  await go(page, '#lighting');
  t(`${tag} G3 the twelve colour fields show, lit ones filled from the state colours, unlit ones empty`,
    await page.waitForFunction(() => [...document.querySelectorAll('[data-ps-fxc-state]')].every((e) => !e.hidden), null, { timeout: 2000 }).then(() => true).catch(() => false)
    && (await page.$$eval('[data-ps-fxc]', (els) => els.length)) === 12
    && (await val(page, 'ps-lighting-fxc-1-0')) === '#FFFFFFFF' && (await val(page, 'ps-lighting-fxc-2-1')) === '#FF0000FF' && (await val(page, 'ps-lighting-fxc-1-2')) === '');
  n = await count();
  await $(page, 'ps-lighting-fxc-1-0').fill('#00FF00'); await page.keyboard.press('Tab');
  got = await sentAfter(n);
  let cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  let want2 = JSON.parse(JSON.stringify(cur)); want2[1].colours[0] = '#00FF00FF';
  t(`${tag} G4 a lit colour change sends the whole table with that colour as #RRGGBBAA`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[1].colours[0] === '#00FF00FF', null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await $(page, 'ps-lighting-fxc-1-2').fill('#0000FF'); await page.keyboard.press('Tab');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].colours[2] = '#0000FFFF'; want2[1].opt = want2[1].opt | 1;
  t(`${tag} G5 an unlit colour change sets its bit in opt as well`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => (PS.features.config.state_effects[1].opt & 1) === 1, null, { timeout: 2000 }).catch(() => {});
  t(`${tag} G6 the answer lands: the unlit field shows the colour`, (await val(page, 'ps-lighting-fxc-1-2')) === '#0000FFFF');
  n = await count();
  await page.locator('[data-ps-fxc-clear="1"][data-ps-fxc-i="2"]').click();
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].colours[2] = '#000000FF'; want2[1].opt = want2[1].opt & ~1;
  t(`${tag} G7 clearing the unlit colour sends black with the bit clear`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  t(`${tag} G8 the field empties again`, await page.waitForFunction(() => document.getElementById('ps-lighting-fxc-1-2').value === '', null, { timeout: 2000 }).then(() => true).catch(() => false));
  await pw.shot(page, `features-lighting-fxc-${combo.theme}-${combo.width}`, { full: true });
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-effect-colours');
  got = await sentAfter(n);
  t(`${tag} G9 turning effect colours off sends exactly {"features":{"effect_colours":false}}`, got.length === 1 && got[0] === apiFrame({ features: { effect_colours: false } }), got);
  await go(page, '#lighting');
  t(`${tag} G10 the colour boxes hide again`, await page.waitForFunction(() => [...document.querySelectorAll('[data-ps-fxc-state]')].every((e) => e.hidden), null, { timeout: 2000 }).then(() => true).catch(() => false));

  // ---- A4: the effect's own brightness, speed and direction ----
  t(`${tag} H1 with the params switch off, the boxes stay hidden`, await page.$$eval('[data-ps-fxp-state]', (els) => els.every((e) => e.hidden)));
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-effect-params');
  got = await sentAfter(n);
  t(`${tag} H2 turning params on sends exactly {"features":{"effect_params":true}}`, got.length === 1 && got[0] === apiFrame({ features: { effect_params: true } }), got);
  await go(page, '#lighting');
  t(`${tag} H3 the three boxes show with the defaults 50%, 100% and no reverse`,
    await page.waitForFunction(() => [...document.querySelectorAll('[data-ps-fxp-state]')].every((e) => !e.hidden), null, { timeout: 2000 }).then(() => true).catch(() => false)
    && (await val(page, 'ps-lighting-fxp-brightness-1')) === '50' && (await val(page, 'ps-lighting-fxp-speed-1')) === '100' && (await text(page, 'ps-lighting-fxp-speed-value-1')) === '100%'
    && !(await page.$eval('#ps-lighting-fxp-reverse-1', (el) => el.checked)));
  n = await count();
  await nudge(page, 'ps-lighting-fxp-speed-1', 'ArrowLeft');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].speed = 95;
  t(`${tag} H4 nudging the printing speed sends the whole table with speed 95`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[1].speed === 95, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await nudge(page, 'ps-lighting-fxp-brightness-2', 'ArrowRight');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[2].brightness = 55;
  t(`${tag} H5 nudging the error brightness sends the whole table with brightness 55`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[2].brightness === 55, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await page.locator('label.checkbox:has(#ps-lighting-fxp-reverse-1)').click();
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].opt = want2[1].opt | 0x10;
  t(`${tag} H6 the reverse box sets bit 0x10 in opt`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  t(`${tag} H7 the answer lands: the box is checked`, await page.waitForFunction(() => document.getElementById('ps-lighting-fxp-reverse-1').checked, null, { timeout: 2000 }).then(() => true).catch(() => false));
  t(`${tag} H8 the factory brightness slider still sends the factory frame`, await (async () => { const b = Number(await val(page, 'ps-lighting-brightness')); const m = await count(); await nudge(page, 'ps-lighting-brightness', 'ArrowLeft'); const g = await sentAfter(m); return g.length === 1 && g[0] === frame('settings', { rgb_info_brightness: b - 5 }); })());
  await pw.shot(page, `features-lighting-fxp-${combo.theme}-${combo.width}`, { full: true });

  // ---- A5: the ramp, which needs the params switch too ----
  t(`${tag} I1 with params on but the ramp switch off, the ramp boxes stay hidden`, await page.$$eval('[data-ps-fxr-state]', (els) => els.every((e) => e.hidden)));
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-effect-ramp');
  got = await sentAfter(n);
  t(`${tag} I2 turning the ramp on sends exactly {"features":{"effect_ramp":true}}`, got.length === 1 && got[0] === apiFrame({ features: { effect_ramp: true } }), got);
  await go(page, '#lighting');
  t(`${tag} I3 the ramp boxes show, unchecked, end at 0%`,
    await page.waitForFunction(() => [...document.querySelectorAll('[data-ps-fxr-state]')].every((e) => !e.hidden), null, { timeout: 2000 }).then(() => true).catch(() => false)
    && !(await page.$eval('#ps-lighting-fxr-on-1', (el) => el.checked)) && (await val(page, 'ps-lighting-fxr-end-1')) === '0');
  n = await count();
  await nudge(page, 'ps-lighting-fxr-end-1', 'ArrowRight');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].bright_end = 5;
  t(`${tag} I4 nudging the end sends the whole table with bright_end 5`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[1].bright_end === 5, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await page.locator('label.checkbox:has(#ps-lighting-fxr-on-1)').click();
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].opt = want2[1].opt | 0x04;
  t(`${tag} I5 the ramp box sets bit 0x04 in opt`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  t(`${tag} I6 the answer lands: the box is checked`, await page.waitForFunction(() => document.getElementById('ps-lighting-fxr-on-1').checked, null, { timeout: 2000 }).then(() => true).catch(() => false));
  await pw.shot(page, `features-lighting-fxr-${combo.theme}-${combo.width}`, { full: true });
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-effect-ramp');
  got = await sentAfter(n);
  t(`${tag} I7 turning the ramp off sends exactly {"features":{"effect_ramp":false}}`, got.length === 1 && got[0] === apiFrame({ features: { effect_ramp: false } }), got);
  await go(page, '#lighting');
  t(`${tag} I8 the ramp boxes hide again`, await page.waitForFunction(() => [...document.querySelectorAll('[data-ps-fxr-state]')].every((e) => e.hidden), null, { timeout: 2000 }).then(() => true).catch(() => false));

  // ---- A6 to A9: the effects that read the print, each behind its own switch ----
  const post = (body) => page.evaluate(async (b) => { const r = await fetch('/api/features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.status; }, body);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  { const refused = JSON.parse(JSON.stringify(cur)); refused[1].effect = 17;
    t(`${tag} J1 with its switch off, the device refuses effect 17 (400)`, (await post({ config: { state_effects: refused } })) === 400); }
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  for (const [name, id, label] of [['fx_progress', 17, 'progress'], ['fx_progress_anim', 18, 'animated progress'], ['fx_hue_ramp', 21, 'the colour ramp']]) {
    n = await count();
    await toggle(page, 'ps-system-feature-' + name.replace(/_/g, '-'));
    got = await sentAfter(n);
    t(`${tag} J2 turning ${label} on sends exactly its switch`, got.length === 1 && got[0] === apiFrame({ features: { [name]: true } }), got);
    await page.waitForFunction((nm) => PS.features.features[nm] === true, name, { timeout: 2000 }).catch(() => {});
  }
  await go(page, '#lighting');
  t(`${tag} J3 the printing select now offers twenty effects, the pole still hidden`, await page.waitForFunction(() => [...document.getElementById('ps-lighting-fx-1').options].filter((o) => !o.hidden).length === 20, null, { timeout: 2000 }).then(() => true).catch(() => false));
  n = await count();
  await $(page, 'ps-lighting-fx-1').selectOption('17');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].effect = 17;
  t(`${tag} J4 choosing the progress bar for printing sends the table with effect 17`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[1].effect === 17, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await $(page, 'ps-lighting-fx-0').selectOption('21');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[0].effect = 21;
  t(`${tag} J5 choosing the colour ramp for idle sends the table with effect 21`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[0].effect === 21, null, { timeout: 2000 }).catch(() => {});
  t(`${tag} J6 no band width box while the pole's switch is off`, await page.$$eval('[data-ps-fxb-state]', (els) => els.every((e) => e.hidden)));
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-fx-barber');
  got = await sentAfter(n);
  t(`${tag} J7 turning the pole on sends exactly {"features":{"fx_barber":true}}`, got.length === 1 && got[0] === apiFrame({ features: { fx_barber: true } }), got);
  await page.waitForFunction(() => PS.features.features.fx_barber === true, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  n = await count();
  await $(page, 'ps-lighting-fx-2').selectOption('19');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[2].effect = 19;
  t(`${tag} J8 choosing the pole for error sends the table with effect 19`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  t(`${tag} J9 the band width box shows for that state only`, await page.waitForFunction(() => { const b = [...document.querySelectorAll('[data-ps-fxb-state]')]; return !b[2].hidden && b[0].hidden && b[1].hidden; }, null, { timeout: 2000 }).then(() => true).catch(() => false));
  n = await count();
  await nudge(page, 'ps-lighting-fxb-2', 'ArrowRight');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[2].aux = 4; want2[2].opt = want2[2].opt | 0x08;
  t(`${tag} J10 nudging the band width sends aux 4 with its bit set`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  t(`${tag} J11 the answer lands: the label reads 4`, await page.waitForFunction(() => document.getElementById('ps-lighting-fxb-value-2').textContent === '4', null, { timeout: 2000 }).then(() => true).catch(() => false));
  await pw.shot(page, `features-lighting-fxprog-${combo.theme}-${combo.width}`, { full: true });
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  for (const name of ['fx_progress', 'fx_progress_anim', 'fx_barber', 'fx_hue_ramp']) {
    n = await count();
    await toggle(page, 'ps-system-feature-' + name.replace(/_/g, '-'));
    got = await sentAfter(n);
    t(`${tag} J12 turning ${name} off sends exactly its switch`, got.length === 1 && got[0] === apiFrame({ features: { [name]: false } }), got);
    await page.waitForFunction((nm) => PS.features.features[nm] === false, name, { timeout: 2000 }).catch(() => {});
  }
  await go(page, '#lighting');
  t(`${tag} J13 the four options hide again`, await page.waitForFunction(() => [...document.getElementById('ps-lighting-fx-1').options].filter((o) => !o.hidden).length === 17, null, { timeout: 2000 }).then(() => true).catch(() => false));
  t(`${tag} J14 the switches took their effects with them: all three states read Static`, (await val(page, 'ps-lighting-fx-0')) === '0' && (await val(page, 'ps-lighting-fx-1')) === '0' && (await val(page, 'ps-lighting-fx-2')) === '0');
  n = await count();
  await $(page, 'ps-lighting-fx-1').selectOption('1');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[1].effect = 1;
  t(`${tag} J15 Breathing for printing again sends the table with effect 1, the fallen-back ids echoed and accepted`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[1].effect === 1, null, { timeout: 2000 }).catch(() => {});

  // ---- A10: the temperature gradient, its source and its ends ----
  t(`${tag} K1 with fx_temp off the gradient box is hidden and option 20 is hidden`, (await hidden(page, 'ps-lighting-tg')) && (await page.$eval('#ps-lighting-fx-0', (el) => [...el.options].find((o) => o.value === '20').hidden)));
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-fx-temp');
  got = await sentAfter(n);
  t(`${tag} K2 turning the gradient on sends exactly {"features":{"fx_temp":true}}`, got.length === 1 && got[0] === apiFrame({ features: { fx_temp: true } }), got);
  await page.waitForFunction(() => PS.features.features.fx_temp === true, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} K3 the box shows: nozzle, cold at 25, hot at 250, and option 20 is offered`, await waitHidden(page, 'ps-lighting-tg', false)
    && (await val(page, 'ps-lighting-tg-source')) === '0' && (await val(page, 'ps-lighting-tg-lo')) === '25' && (await val(page, 'ps-lighting-tg-hi')) === '250'
    && (await text(page, 'ps-lighting-tg-hi-value')) === '250 \u00B0C'
    && (await page.$eval('#ps-lighting-fx-0', (el) => [...el.options].filter((o) => !o.hidden).length)) === 18);
  n = await count();
  await $(page, 'ps-lighting-fx-0').selectOption('20');
  got = await sentAfter(n);
  cur = await page.evaluate(() => JSON.parse(JSON.stringify(PS.features.config.state_effects)));
  want2 = JSON.parse(JSON.stringify(cur)); want2[0].effect = 20;
  t(`${tag} K4 choosing the gradient for idle sends the table with effect 20`, got.length === 1 && got[0] === apiFrame({ config: { state_effects: want2 } }), got);
  await page.waitForFunction(() => PS.features.config.state_effects[0].effect === 20, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await $(page, 'ps-lighting-tg-source').selectOption('1');
  got = await sentAfter(n);
  t(`${tag} K5 following the bed sends exactly {"config":{"temp_gradient":{"source":1,"lo":25,"hi":250}}}`, got.length === 1 && got[0] === apiFrame({ config: { temp_gradient: { source: 1, lo: 25, hi: 250 } } }), got);
  await page.waitForFunction(() => PS.features.config.temp_gradient.source === 1, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await nudge(page, 'ps-lighting-tg-hi', 'ArrowRight');
  got = await sentAfter(n);
  t(`${tag} K6 nudging the hot end sends the whole setting with hi 255`, got.length === 1 && got[0] === apiFrame({ config: { temp_gradient: { source: 1, lo: 25, hi: 255 } } }), got);
  await page.waitForFunction(() => PS.features.config.temp_gradient.hi === 255, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await nudge(page, 'ps-lighting-tg-lo', 'ArrowRight');
  got = await sentAfter(n);
  t(`${tag} K7 nudging the cold end sends the whole setting with lo 30`, got.length === 1 && got[0] === apiFrame({ config: { temp_gradient: { source: 1, lo: 30, hi: 255 } } }), got);
  t(`${tag} K8 the answer lands: the label reads 30 \u00B0C`, await page.waitForFunction(() => document.getElementById('ps-lighting-tg-lo-value').textContent === '30 \u00B0C', null, { timeout: 2000 }).then(() => true).catch(() => false));
  { const st = await page.evaluate(async () => { const r = await fetch('/api/features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { temp_gradient: { source: 3 } } }) }); return r.status; });
    t(`${tag} K9 a fourth source is refused (400)`, st === 400, st); }
  await pw.shot(page, `features-lighting-fxtemp-${combo.theme}-${combo.width}`, { full: true });
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-fx-temp');
  got = await sentAfter(n);
  t(`${tag} K10 turning the gradient off sends exactly {"features":{"fx_temp":false}}`, got.length === 1 && got[0] === apiFrame({ features: { fx_temp: false } }), got);
  await page.waitForFunction(() => PS.features.features.fx_temp === false, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} K11 the box hides and idle fell back to Static`, await waitHidden(page, 'ps-lighting-tg', true) && (await val(page, 'ps-lighting-fx-0')) === '0');

  // ---- A11: the hot warning layer ----
  t(`${tag} L1 with hot_warning off the tile is hidden`, await hidden(page, 'ps-lighting-hot'));
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-hot-warning');
  got = await sentAfter(n);
  t(`${tag} L2 turning the warning on sends exactly {"features":{"hot_warning":true}}`, got.length === 1 && got[0] === apiFrame({ features: { hot_warning: true } }), got);
  await page.waitForFunction(() => PS.features.features.hot_warning === true, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} L3 the tile shows: nozzle, hot from 50, red`, await waitHidden(page, 'ps-lighting-hot', false)
    && (await val(page, 'ps-lighting-hot-source')) === '0' && (await val(page, 'ps-lighting-hot-c')) === '50' && (await text(page, 'ps-lighting-hot-c-value')) === '50 \u00B0C'
    && (await val(page, 'ps-lighting-hot-colour')) === '#FF0000FF');
  n = await count();
  await $(page, 'ps-lighting-hot-source').selectOption('1');
  got = await sentAfter(n);
  t(`${tag} L4 watching the bed sends the whole setting`, got.length === 1 && got[0] === apiFrame({ config: { hot_warning: { source: 1, threshold: 50, colour: '#FF0000FF' } } }), got);
  await page.waitForFunction(() => PS.features.config.hot_warning.source === 1, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await nudge(page, 'ps-lighting-hot-c', 'ArrowRight');
  got = await sentAfter(n);
  t(`${tag} L5 nudging the threshold sends the whole setting with 55`, got.length === 1 && got[0] === apiFrame({ config: { hot_warning: { source: 1, threshold: 55, colour: '#FF0000FF' } } }), got);
  await page.waitForFunction(() => PS.features.config.hot_warning.threshold === 55, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await $(page, 'ps-lighting-hot-colour').fill('#FFA500'); await page.keyboard.press('Tab');
  got = await sentAfter(n);
  t(`${tag} L6 a colour change sends the whole setting with the colour as #RRGGBBAA`, got.length === 1 && got[0] === apiFrame({ config: { hot_warning: { source: 1, threshold: 55, colour: '#FFA500FF' } } }), got);
  t(`${tag} L7 the answer lands: the field and the label read back`, await page.waitForFunction(() => document.getElementById('ps-lighting-hot-colour').value === '#FFA500FF' && document.getElementById('ps-lighting-hot-c-value').textContent === '55 \u00B0C', null, { timeout: 2000 }).then(() => true).catch(() => false));
  { const st = await page.evaluate(async () => { const r = await fetch('/api/features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { hot_warning: { colour: 'red' } } }) }); return r.status; });
    t(`${tag} L8 a colour that is not #RRGGBBAA is refused (400)`, st === 400, st); }
  await pw.shot(page, `features-lighting-hot-${combo.theme}-${combo.width}`, { full: true });
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-hot-warning');
  got = await sentAfter(n);
  t(`${tag} L9 turning the warning off sends exactly {"features":{"hot_warning":false}}`, got.length === 1 && got[0] === apiFrame({ features: { hot_warning: false } }), got);
  await page.waitForFunction(() => PS.features.features.hot_warning === false, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} L10 the tile hides again`, await waitHidden(page, 'ps-lighting-hot', true));

  // ---- A12: the error flash layer ----
  t(`${tag} M1 with error_flash off the tile is hidden`, await hidden(page, 'ps-lighting-ef'));
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-error-flash');
  got = await sentAfter(n);
  t(`${tag} M2 turning the flash on sends exactly {"features":{"error_flash":true}}`, got.length === 1 && got[0] === apiFrame({ features: { error_flash: true } }), got);
  await page.waitForFunction(() => PS.features.features.error_flash === true, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} M3 the tile shows: red, 50%, 50%`, await waitHidden(page, 'ps-lighting-ef', false)
    && (await val(page, 'ps-lighting-ef-colour')) === '#FF0000FF' && (await val(page, 'ps-lighting-ef-brightness')) === '50' && (await val(page, 'ps-lighting-ef-speed')) === '50'
    && (await text(page, 'ps-lighting-ef-speed-value')) === '50%');
  n = await count();
  await nudge(page, 'ps-lighting-ef-brightness', 'ArrowRight');
  got = await sentAfter(n);
  t(`${tag} M4 nudging the brightness sends the whole setting with 55`, got.length === 1 && got[0] === apiFrame({ config: { error_flash: { colour: '#FF0000FF', brightness: 55, speed: 50 } } }), got);
  await page.waitForFunction(() => PS.features.config.error_flash.brightness === 55, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await nudge(page, 'ps-lighting-ef-speed', 'ArrowLeft');
  got = await sentAfter(n);
  t(`${tag} M5 nudging the rate sends the whole setting with 45`, got.length === 1 && got[0] === apiFrame({ config: { error_flash: { colour: '#FF0000FF', brightness: 55, speed: 45 } } }), got);
  await page.waitForFunction(() => PS.features.config.error_flash.speed === 45, null, { timeout: 2000 }).catch(() => {});
  n = await count();
  await $(page, 'ps-lighting-ef-colour').fill('#FF00FF'); await page.keyboard.press('Tab');
  got = await sentAfter(n);
  t(`${tag} M6 a colour change sends the whole setting with the colour as #RRGGBBAA`, got.length === 1 && got[0] === apiFrame({ config: { error_flash: { colour: '#FF00FFFF', brightness: 55, speed: 45 } } }), got);
  t(`${tag} M7 the answer lands: the field and the labels read back`, await page.waitForFunction(() => document.getElementById('ps-lighting-ef-colour').value === '#FF00FFFF' && document.getElementById('ps-lighting-ef-brightness-value').textContent === '55%' && document.getElementById('ps-lighting-ef-speed-value').textContent === '45%', null, { timeout: 2000 }).then(() => true).catch(() => false));
  { const st = await page.evaluate(async () => { const r = await fetch('/api/features', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ config: { error_flash: { speed: 101 } } }) }); return r.status; });
    t(`${tag} M8 a rate past 100 is refused (400)`, st === 400, st); }
  await pw.shot(page, `features-lighting-ef-${combo.theme}-${combo.width}`, { full: true });
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-error-flash');
  got = await sentAfter(n);
  t(`${tag} M9 turning the flash off sends exactly {"features":{"error_flash":false}}`, got.length === 1 && got[0] === apiFrame({ features: { error_flash: false } }), got);
  await page.waitForFunction(() => PS.features.features.error_flash === false, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} M10 the tile hides again`, await waitHidden(page, 'ps-lighting-ef', true));

  // ---- A13: the live preview ----
  const pvFrame = (body) => JSON.stringify({ api: '/api/preview', body });
  const pvPost = (body) => page.evaluate(async (b) => { const r = await fetch('/api/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b), redirect: 'manual' }); return r.type === 'opaqueredirect' ? 302 : r.status; }, body);
  t(`${tag} N1 with preview off the tile is hidden and the route answers 302 like any unknown path`, (await hidden(page, 'ps-lighting-pv')) && (await pvPost({ state: 0 })) === 302);
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-preview');
  got = await sentAfter(n);
  t(`${tag} N2 turning the preview on sends exactly {"features":{"preview":true}}`, got.length === 1 && got[0] === apiFrame({ features: { preview: true } }), got);
  await page.waitForFunction(() => PS.features.features.preview === true, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} N3 the tile shows: idle, 0%, nothing running`, await waitHidden(page, 'ps-lighting-pv', false)
    && (await val(page, 'ps-lighting-pv-state')) === '0' && (await val(page, 'ps-lighting-pv-percent')) === '0' && (await hidden(page, 'ps-lighting-pv-status')) && (await hidden(page, 'ps-lighting-pv-stop')));
  n = await count();
  await $(page, 'ps-lighting-pv-state').selectOption('1');
  await nudge(page, 'ps-lighting-pv-percent', 'ArrowRight');
  got = await sentAfter(n, 600);
  t(`${tag} N4 choosing a state and a progress sends nothing: they are local until Preview`, got.length === 0 && (await text(page, 'ps-lighting-pv-percent-value')) === '5%', got);
  n = await count();
  await $(page, 'ps-lighting-pv-start').click();
  got = await sentAfter(n);
  t(`${tag} N5 Preview sends exactly {"state":1,"percent":5,"seconds":30} to /api/preview`, got.length === 1 && got[0] === pvFrame({ state: 1, percent: 5, seconds: 30 }), got);
  t(`${tag} N6 the answer lands: the status shows a countdown from 30`, await page.waitForFunction(() => !document.getElementById('ps-lighting-pv-status').hidden && /^(30|29) s$/.test(document.getElementById('ps-lighting-pv-left').textContent) && !document.getElementById('ps-lighting-pv-stop').hidden, null, { timeout: 2000 }).then(() => true).catch(() => false));
  await pw.shot(page, `features-lighting-pv-${combo.theme}-${combo.width}`, { full: true });
  t(`${tag} N7 the countdown counts`, await page.waitForFunction(() => /^(28|27|26) s$/.test(document.getElementById('ps-lighting-pv-left').textContent), null, { timeout: 4000 }).then(() => true).catch(() => false));
  n = await count();
  await $(page, 'ps-lighting-pv-stop').click();
  got = await sentAfter(n);
  t(`${tag} N8 Stop sends exactly {"seconds":0}`, got.length === 1 && got[0] === pvFrame({ seconds: 0 }), got);
  t(`${tag} N9 the status hides again`, await waitHidden(page, 'ps-lighting-pv-status', true));
  t(`${tag} N10 a fourth state is refused (400), and a pin without a state too`, (await pvPost({ state: 3 })) === 400 && (await pvPost({ percent: 50 })) === 400);
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-preview');
  got = await sentAfter(n);
  t(`${tag} N11 turning the preview off sends exactly {"features":{"preview":false}}`, got.length === 1 && got[0] === apiFrame({ features: { preview: false } }), got);
  await page.waitForFunction(() => PS.features.features.preview === false, null, { timeout: 2000 }).catch(() => {});
  await go(page, '#lighting');
  t(`${tag} N12 the tile hides and the route is gone again`, await waitHidden(page, 'ps-lighting-pv', true) && (await pvPost({ state: 0 })) === 302);
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-effect-params');
  got = await sentAfter(n);
  t(`${tag} H9 turning params off sends exactly {"features":{"effect_params":false}}`, got.length === 1 && got[0] === apiFrame({ features: { effect_params: false } }), got);
  await go(page, '#lighting');
  t(`${tag} H10 the boxes hide again`, await page.waitForFunction(() => [...document.querySelectorAll('[data-ps-fxp-state]')].every((e) => e.hidden), null, { timeout: 2000 }).then(() => true).catch(() => false));
  await page.reload(); await pw.sleep(900);
  t(`${tag} E7 after a reload printing is still Breathing`, await waitHidden(page, 'ps-lighting-fx', false) && (await val(page, 'ps-lighting-fx-1')) === '1');
  await go(page, '#system');
  await waitHidden(page, 'ps-system-features', false);
  n = await count();
  await toggle(page, 'ps-system-feature-state-effects');
  got = await sentAfter(n);
  t(`${tag} E8 turning effects off sends exactly {"features":{"state_effects":false}}`, got.length === 1 && got[0] === apiFrame({ features: { state_effects: false } }), got);
  await go(page, '#lighting');
  t(`${tag} E9 the effect tile hides again`, await waitHidden(page, 'ps-lighting-fx', true));

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
