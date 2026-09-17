#!/usr/bin/env node
'use strict';
/*
 * Lighting page harness. Behaviour only: drive each control the way a person would and
 * assert the exact frame the device receives, byte for byte, device_wakeup included.
 * Nothing here asserts padding, alignment, colour values of the chrome, or anything else
 * the design system is allowed to change.
 *
 * Runs the whole drive at every theme/width combination, because the phone layout and
 * the desktop layout are different DOM (rail vs bottom bar) and a control that is dead
 * at one width is a bug the other width cannot see.
 *
 * Fixture facts this leans on (tools/ui/mock/fixtures/p2-idle.json): current_mode 1,
 * brightness 50 in both modes, no speed key, list2[1] colours #FFFFFFFF #1B00FFFF
 * #FF0000FF, list2[0] colours FFFFFF x3, one block with blockID 0.
 *
 * Exit 0 when every assertion passes, 1 otherwise. sweep.sh trusts the exit code.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-lighting.js
 *       tools/ui/harness/run.sh p2-idle.json page-lighting.js PS_EMIT_SPEED=1
 */

const pw = require('./pw');
const { t, frame, sentAfter, sent, resetMock } = pw;

const ECHO_SPEED = process.env.PS_EMIT_SPEED === '1';
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];

const $ = (page, id) => page.locator('#' + id);
const val = (page, id) => page.$eval('#' + id, (el) => el.value);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const count = async () => (await sent()).length;

// A colour field is Coloris-wrapped text input. Type a value, leave the field.
async function setColour(page, id, value) {
  const loc = $(page, id);
  await loc.fill(value);
  await page.keyboard.press('Tab');
}
// A range input, driven from the keyboard, which is what fires input and change natively.
async function nudge(page, id, key) {
  await $(page, id).focus();
  await page.keyboard.press(key);
  await page.keyboard.press('Tab');
}

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#lighting' });

  // ---- A. the page is up, on the right card, in the right layout ----
  t(`${tag} A1 body carries the ${combo.theme} theme class`, await page.evaluate((th) => document.body.classList.contains(th), combo.theme));
  t(`${tag} A2 lighting card visible, every other card hidden`,
    await page.evaluate(() => { const all = [...document.querySelectorAll('article[data-ps-card]')]; return all.length > 1 && all.every((a) => a.hidden === (a.id !== 'ps-card-lighting')); }));
  const railVisible = await page.locator('#ps-rail').isVisible();
  const barVisible = await page.locator('#ps-bottombar').isVisible();
  if (combo.width >= 992) t(`${tag} A3 desktop: rail shown, bottom bar hidden`, railVisible && !barVisible, { railVisible, barVisible });
  else t(`${tag} A3 phone: bottom bar shown, rail hidden`, barVisible && !railVisible, { railVisible, barVisible });
  const navSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="lighting"]' : '#ps-bottombar a[data-ps-nav="lighting"]';
  t(`${tag} A4 the visible nav marks lighting as current`, await page.$eval(navSel, (a) => a.classList.contains('ps-current')));

  // ---- B. controls reflect the device's state ----
  t(`${tag} B1 mode select shows current_mode 1`, (await val(page, 'ps-lighting-mode')) === '1');
  t(`${tag} B2 brightness slider at 50, label 50%`, (await val(page, 'ps-lighting-brightness')) === '50' && (await text(page, 'ps-lighting-brightness-value')) === '50%');
  t(`${tag} B3 speed enabled in H2D, at its default of 100, label says default`,
    !(await $(page, 'ps-lighting-speed').isDisabled()) && (await val(page, 'ps-lighting-speed')) === '100' && (await text(page, 'ps-lighting-speed-value')) === (await tr(page, 'ps_lighting_speed_default')),
    { v: await val(page, 'ps-lighting-speed'), l: await text(page, 'ps-lighting-speed-value') });
  t(`${tag} B4 speed note hidden in H2D`, !(await $(page, 'ps-lighting-speed-note').isVisible()));
  t(`${tag} B5 three colour fields carry list2[1]`,
    (await val(page, 'ps-lighting-colour-0')) === '#FFFFFFFF' && (await val(page, 'ps-lighting-colour-1')) === '#1B00FFFF' && (await val(page, 'ps-lighting-colour-2')) === '#FF0000FF',
    [await val(page, 'ps-lighting-colour-0'), await val(page, 'ps-lighting-colour-1'), await val(page, 'ps-lighting-colour-2')]);
  t(`${tag} B6 one block field, blockID 0, carrying its colour`, (await page.locator('[data-ps-block]').count()) === 1 && (await val(page, 'ps-lighting-block-0')) === '#FFFFFFFF');
  t(`${tag} B7 nothing sent by merely loading the page`, (await count()) === 0, await sent());
  await pw.shot(page, `lighting-${combo.theme}-${combo.width}`);
  await pw.shot(page, `lighting-${combo.theme}-${combo.width}`, { full: true });

  // ---- C. H2D mode: every control, exact frame ----
  let n = await count();
  await nudge(page, 'ps-lighting-brightness', 'ArrowRight');
  let got = await sentAfter(n);
  t(`${tag} C1 brightness +1 step sends rgb_info_brightness 55, once`, got.length === 1 && got[0] === frame('settings', { rgb_info_brightness: 55 }), got);
  t(`${tag} C1b device echo lands: label 55%`, await pw.waitState(page, 'return s.settings.list2[1].brightness === 55') && (await text(page, 'ps-lighting-brightness-value')) === '55%');

  n = await count();
  await nudge(page, 'ps-lighting-speed', 'ArrowLeft');
  got = await sentAfter(n);
  t(`${tag} C2 speed -1 step sends rgb_info_speed 95, once`, got.length === 1 && got[0] === frame('settings', { rgb_info_speed: 95 }), got);
  await pw.sleep(200);
  t(`${tag} C2b slider stays at 95 ${ECHO_SPEED ? 'with' : 'without'} a device echo, label 95%`,
    (await val(page, 'ps-lighting-speed')) === '95' && (await text(page, 'ps-lighting-speed-value')) === '95%',
    { v: await val(page, 'ps-lighting-speed'), l: await text(page, 'ps-lighting-speed-value') });
  t(`${tag} C2c page state ${ECHO_SPEED ? 'carries' : 'does not carry'} speed (mock knob PS_EMIT_SPEED)`,
    (await page.evaluate(() => PS.state.settings.list2[1].speed)) === (ECHO_SPEED ? 95 : undefined));

  n = await count();
  await setColour(page, 'ps-lighting-colour-0', '#00ff00');
  got = await sentAfter(n);
  t(`${tag} C3 idle colour sends #RRGGBBAA for mode 1, index 0, once`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 1, rgb_rgba: '#00FF00FF', rgb_state_index: 0 }), got);
  t(`${tag} C3b device echo lands in list2[1][0]`, await pw.waitState(page, 'return s.settings.list2[1].rgb_rgba[0] === "#00FF00FF"'));

  n = await count();
  await setColour(page, 'ps-lighting-colour-1', '#12345680');
  got = await sentAfter(n);
  t(`${tag} C4 printing colour keeps its alpha, index 1`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 1, rgb_rgba: '#12345680', rgb_state_index: 1 }), got);

  n = await count();
  await setColour(page, 'ps-lighting-colour-2', '#abc');
  got = await sentAfter(n);
  t(`${tag} C5 short hex is expanded, index 2`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 1, rgb_rgba: '#AABBCCFF', rgb_state_index: 2 }), got);

  n = await count();
  await setColour(page, 'ps-lighting-block-0', '#abcdef');
  got = await sentAfter(n);
  t(`${tag} C6 block colour sends the block root, #RRGGBBAA`, got.length === 1 && got[0] === frame('block', { blockID: 0, blockrgba: '#ABCDEFFF' }), got);
  t(`${tag} C6b device echo lands in blocklist`, await pw.waitState(page, 'return s.block.blocklist[0].blockrgba === "#ABCDEFFF"'));

  // reset: cancel sends nothing, confirm sends rgb_reset
  n = await count();
  await pw.tap(page, '#ps-lighting-reset');
  t(`${tag} C7 reset opens the dialog with the reset title`, (await page.$eval('#ps-dialog', (d) => d.open)) && (await text(page, 'ps-dialog-title')) === (await tr(page, 'ps_lighting_reset_title')));
  await $(page, 'ps-dialog-cancel').click();
  got = await sentAfter(n, 250);
  t(`${tag} C7b cancel closes it and sends nothing`, !(await page.$eval('#ps-dialog', (d) => d.open)) && got.length === 0, got);
  await pw.tap(page, '#ps-lighting-reset');
  await $(page, 'ps-dialog-ok').click();
  got = await sentAfter(n);
  t(`${tag} C8 confirm sends rgb_reset 1, once`, got.length === 1 && got[0] === frame('settings', { rgb_reset: 1 }), got);
  t(`${tag} C8b device echo lands: brightness back to 50, idle colour back to white`,
    await pw.waitState(page, 'return s.settings.list2[1].brightness === 50 && s.settings.list2[1].rgb_rgba[0] === "#FFFFFFFF"') && (await val(page, 'ps-lighting-brightness')) === '50' && (await val(page, 'ps-lighting-colour-0')) === '#FFFFFFFF');

  // ---- D. Music mode ----
  n = await count();
  await $(page, 'ps-lighting-mode').selectOption('0');
  got = await sentAfter(n);
  t(`${tag} D1 mode select sends rgb_info_mode 0, once`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 0 }), got);
  t(`${tag} D1b device echo lands: current_mode 0`, await pw.waitState(page, 'return s.settings.current_mode === 0'));
  t(`${tag} D2 speed disabled in Music, note shown`, (await $(page, 'ps-lighting-speed').isDisabled()) && (await $(page, 'ps-lighting-speed-note').isVisible()));
  // list2[0] after C8's reset: the mock resets both modes, index 2 to red
  t(`${tag} D3 colour fields switch to list2[0], bare RRGGBB shown as #RRGGBB`,
    (await val(page, 'ps-lighting-colour-0')) === '#FFFFFF' && (await val(page, 'ps-lighting-colour-1')) === '#FFFFFF' && (await val(page, 'ps-lighting-colour-2')) === '#FF0000',
    [await val(page, 'ps-lighting-colour-0'), await val(page, 'ps-lighting-colour-1'), await val(page, 'ps-lighting-colour-2')]);

  n = await count();
  await page.$eval('#ps-lighting-speed', (el) => { el.value = '20'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  got = await sentAfter(n, 250);
  t(`${tag} D4 a change forced on the disabled speed slider sends nothing`, got.length === 0, got);

  n = await count();
  await setColour(page, 'ps-lighting-colour-0', '#0000ff');
  got = await sentAfter(n);
  t(`${tag} D5 idle colour in Music sends bare RRGGBB for mode 0`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 0, rgb_rgba: '0000FF', rgb_state_index: 0 }), got);
  t(`${tag} D5b device echo lands in list2[0][0]`, await pw.waitState(page, 'return s.settings.list2[0].rgb_rgba[0] === "0000FF"'));

  n = await count();
  await pw.tap(page, '#ps-lighting-reset');
  await pw.sleep(100);
  got = await sentAfter(n, 250);
  t(`${tag} D6 reset in Music: no dialog, a toast, nothing on the wire`,
    !(await page.$eval('#ps-dialog', (d) => d.open)) && (await page.$eval('#ps-toast', (e) => e.classList.contains('active'))) && (await text(page, 'ps-toast')) === (await tr(page, 'ps_lighting_reset_music')) && got.length === 0,
    { got, toast: await text(page, 'ps-toast') });

  n = await count();
  await $(page, 'ps-lighting-mode').selectOption('1');
  got = await sentAfter(n);
  t(`${tag} D7 back to H2D sends rgb_info_mode 1`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 1 }), got);
  t(`${tag} D7b speed enabled again`, await pw.waitState(page, 'return s.settings.current_mode === 1') && !(await $(page, 'ps-lighting-speed').isDisabled()));
  await page.evaluate(() => window.scrollTo(0, 0));
  await pw.shot(page, `lighting-${combo.theme}-${combo.width}-after-drive`);

  // ---- E. the nav at this width is alive ----
  const dashSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="dashboard"]' : '#ps-bottombar a[data-ps-nav="dashboard"]';
  await pw.tap(page, dashSel);
  t(`${tag} E1 nav to dashboard shows the dashboard card, only`, await pw.waitCard(page, 'dashboard'));
  await pw.tap(page, navSel);
  t(`${tag} E2 nav back to lighting shows the lighting card, only`, await pw.waitCard(page, 'lighting'));
  t(`${tag} E3 navigating sent nothing`, (await count()) === n + 1);

  t(`${tag} F1 no page errors, no console errors`, errors.length === 0, errors);
  await ctx.close();
}

(async () => {
  const browser = await pw.launch();
  try {
    for (const combo of COMBOS) await drive(browser, combo);
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('harness ran to the end', false);
  } finally {
    await browser.close();
  }
  process.exit(pw.verdict());
})();
