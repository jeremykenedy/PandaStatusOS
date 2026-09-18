#!/usr/bin/env node
'use strict';
/*
 * The lighting page's seven remaining cards, driven the way a person drives them and
 * asserted at the receiving end: the ramp, the per state brightness, the temperature
 * gradient, the hot warning, the error flash, the presets and the fifteen print stages,
 * plus the stage images card's answer on a unit that has nowhere to put an image.
 *
 * Self contained on purpose: pw.js still speaks the old page's conventions (data-ps-card,
 * ps-waiting, PS.state) and this page speaks data-card, is-waiting and g_state.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-stages.js PS_CLONE=1
 */

const { chromium } = require('playwright');

const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function t(name, ok, got) {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sent = async () => (await fetch(`${BASE}/__sent`)).json();
const getJSON = async (p) => (await fetch(BASE + p)).json();
const postJSON = (p, body) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const ON = ['state_effects', 'effect_colours', 'effect_params', 'effect_ramp', 'state_brightness',
            'fx_temp', 'hot_warning', 'error_flash', 'presets', 'stage_effects'];

/* Click the way a person does: the control scrolled to the middle of the screen, clear of
   the rail and of the sticky bar, and then clicked. A click at wherever the layout happened
   to leave the control is a miss for a person as well. */
async function tap(page, sel) {
  await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.click(sel);
}
const hidden = (page, id) => page.$eval('#' + id, (e) => e.hidden);
const text = (page, id) => page.$eval('#' + id, (e) => e.textContent);

async function waitFor(page, body, ms = 3000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 })
    .then(() => true).catch(() => false);
}
async function waitApi(path, pred, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const rows = (await sent()).filter((r) => r.api === path && r.frame);
    if (rows.length && pred(rows[rows.length - 1].frame, rows)) return rows[rows.length - 1].frame;
    await sleep(40);
  }
  return null;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    // Every switch on, because each card answers to one and this run is about the cards.
    const feats = {}; ON.forEach((k) => { feats[k] = true; });
    await postJSON('/api/features', { features: feats });

    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push('console: ' + m.text()); });
    await page.goto(BASE + '/');
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    /* The fixture's printer answers a rebind on connect and the page says so in a modal.
       That is correct behaviour and not this harness's subject: a modal dialog sits in the
       top layer, so every click lands on its backdrop until it is closed. Close it the way
       a person does, through the dialog's own control. */
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('theme'));
    t('A0 the lighting card is the one showing', await page.$eval('[data-card].active', (e) => e.id) === 'ps-card-theme');

    // ---- A. every card that has a switch on is up ----
    for (const [id, what] of [['ps-fxsel-card', 'the state chooser'], ['ps-fx-card', 'the effect'],
                              ['ps-fxr-card', 'the ramp'], ['ps-fxs-card', 'the state brightness'],
                              ['ps-tg-card', 'the temperature gradient'], ['ps-hw-card', 'the hot warning'],
                              ['ps-ef-card', 'the error flash'], ['ps-pre-card', 'the presets'],
                              ['ps-stg-card', 'the print stages']]) {
      t(`A ${what} card is visible`, await waitFor(page, `!document.getElementById('${id}').hidden`), await hidden(page, id));
    }

    // ---- B. fifteen stage rows, in the device's order ----
    const doc = await getJSON('/api/stages');
    const want = doc.stages.map((r) => r.slot);
    t('B1 fifteen rows', await waitFor(page, "document.querySelectorAll('#ps-stg-list > li').length === 15"),
      await page.$$eval('#ps-stg-list > li', (e) => e.length));
    /* A row is its name and then, under it, what that stage IS, the way a Features row is.
       So the row's first line is checked against the name, not the whole row's text. */
    const labels = await page.$$eval('#ps-stg-list > li > div.max', (els) => els.map((e) => e.childNodes[0].textContent));
    const wantLabels = await page.evaluate((slots) => slots.map((s) => tr('ui_stage_' + s, s)), want);
    t('B2 each row is the device\'s slot, named in the page\'s own words', JSON.stringify(labels) === JSON.stringify(wantLabels), labels);
    const subs = await page.$$eval('#ps-stg-list > li > div.max > .small-text', (els) => els.length);
    t('B2b and every one of them says what the stage is', subs === 15, subs);
    t('B3 every row starts on Inherit', await page.$$eval('#ps-stg-list select', (els) => els.every((s) => s.value === '')));
    t('B4 with no presets the card says a preset is needed first',
      (await text(page, 'ps-stg-note')) === (await page.evaluate(() => tr('ui_stages_need_presets', ''))));

    // ---- C. saving a preset ----
    t('C0 the empty list says so', (await text(page, 'ps-pre-list')) === (await page.evaluate(() => tr('ui_no_presets', ''))));
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.fill('#ps-pre-name', 'warmup');
    await tap(page, '#ps-pre-save');
    const c1 = await waitApi('/api/presets', (f) => Array.isArray(f.presets) && f.presets.length === 1);
    t('C1 the whole list goes to the device with the new name in it', !!c1 && c1.presets[0].name === 'warmup', c1);
    t('C2 the saved row carries the state\'s own effect, not a default',
      !!c1 && Array.isArray(c1.presets[0].colours) && c1.presets[0].colours.length === 4, c1 && c1.presets[0]);
    t('C3 the row appears, named', await waitFor(page, "document.querySelectorAll('#ps-pre-list > li').length === 1 && /warmup/.test(document.getElementById('ps-pre-list').textContent)"),
      await text(page, 'ps-pre-list'));
    t('C4 the name field is emptied, so a second save is deliberate', (await page.$eval('#ps-pre-name', (e) => e.value)) === '');
    t('C5 the stages card stops asking for a preset', await waitFor(page, "document.getElementById('ps-stg-note').textContent === ''"),
      await text(page, 'ps-stg-note'));

    // ---- D. assigning it to a stage ----
    await page.selectOption('#ps-stg-sel-3', 'warmup');           // bed_leveling
    const d1 = await waitApi('/api/stages', (f) => !!f.assign);
    t('D1 the device is told to assign by stage number and name', !!d1 && d1.assign.stage === 3 && d1.assign.name === 'warmup', d1);
    t('D2 the row shows the assignment the device confirmed',
      await waitFor(page, "document.getElementById('ps-stg-sel-3').value === 'warmup'"),
      await page.$eval('#ps-stg-sel-3', (e) => e.value));
    const after = await getJSON('/api/stages');
    t('D3 the device kept it, with the name on the row', after.stages[3].set === true && after.stages[3].name === 'warmup', after.stages[3]);
    t('D4 no other row moved', after.stages.filter((r) => r.set).length === 1);

    await page.selectOption('#ps-stg-sel-3', '');
    const d5 = await waitApi('/api/stages', (f) => !!f.clear);
    t('D5 choosing Inherit clears that stage and nothing else', !!d5 && d5.clear.stage === 3, d5);
    t('D6 the device dropped it', (await getJSON('/api/stages')).stages[3].set === false);

    // ---- E. applying a preset to the state being edited ----
    await page.evaluate(() => { const b = [...document.querySelectorAll('#ps-pre-list button')].find((x) => x.textContent === tr('ui_apply', 'Apply')); b.click(); });
    const e1 = await waitApi('/api/presets', (f) => !!f.apply);
    t('E1 apply names the preset and the state the chooser has selected', !!e1 && e1.apply.name === 'warmup' && e1.apply.state === 0, e1);

    // ---- F. the ramp: the switch owns the bit, the slider the value ----
    t('F0 the ramp reads off before it is set', (await text(page, 'ps-fxr-end-value')) === (await page.evaluate(() => tr('ui_off', 'off'))));
    await tap(page, '#ps-fxr-on');
    const f1 = await waitApi('/api/features', (f) => f.config && Array.isArray(f.config.state_effects) && (f.config.state_effects[0].opt & 0x04));
    t('F1 turning it on sets the ramp bit and sends a value with it',
      !!f1 && (f1.config.state_effects[0].opt & 0x04) === 0x04 && typeof f1.config.state_effects[0].bright_end === 'number', f1 && f1.config.state_effects[0]);
    t('F2 the slider comes alive', await waitFor(page, "!document.getElementById('ps-fxr-end').disabled"));

    // ---- G. the per state brightness: one cell of the two by three block ----
    const sb0 = (await getJSON('/api/features')).config.state_brightness;
    await page.$eval('#ps-fxs-bright', (el) => { el.value = '40'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const g1 = await waitApi('/api/features', (f) => f.config && Array.isArray(f.config.state_brightness));
    t('G1 the whole block goes back with one cell changed',
      !!g1 && g1.config.state_brightness[0][0] === 40 && g1.config.state_brightness[1][0] === sb0[1][0], g1 && g1.config.state_brightness);

    // ---- H. the three layers ----
    await page.selectOption('#ps-tg-source', '2');
    const h1 = await waitApi('/api/features', (f) => f.config && f.config.temp_gradient);
    t('H1 the gradient follows the reading that was chosen', !!h1 && h1.config.temp_gradient.source === 2, h1);
    await page.$eval('#ps-tg-hi', (el) => { el.value = '240'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const h2 = await waitApi('/api/features', (f) => f.config && f.config.temp_gradient && f.config.temp_gradient.hi === 240);
    t('H2 the hot end is sent alone, the rest left as stored', !!h2 && Object.keys(h2.config.temp_gradient).join() === 'hi', h2 && h2.config.temp_gradient);

    await page.$eval('#ps-hw-threshold', (el) => { el.value = '55'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const h3 = await waitApi('/api/features', (f) => f.config && f.config.hot_warning && f.config.hot_warning.threshold === 55);
    t('H3 the hot warning takes its threshold', !!h3, h3 && h3.config.hot_warning);
    t('H4 the device kept it', (await getJSON('/api/features')).config.hot_warning.threshold === 55);

    await page.$eval('#ps-ef-speed', (el) => { el.value = '30'; el.dispatchEvent(new Event('change', { bubbles: true })); });
    const h5 = await waitApi('/api/features', (f) => f.config && f.config.error_flash && f.config.error_flash.speed === 30);
    t('H5 the error flash takes its rate', !!h5, h5 && h5.config.error_flash);

    // ---- I. stage images on a unit with nowhere to put them ----
    t('I1 the images card is shown, because the device answered', await waitFor(page, "!document.getElementById('ps-img-card').hidden"));
    t('I2 it says why there is nothing to choose, rather than offering a chooser',
      (await text(page, 'ps-img-note')) === (await page.evaluate(() => tr('ui_no_image_storage', ''))) &&
      (await page.$$eval('#ps-img-list > li', (e) => e.length)) === 0,
      await text(page, 'ps-img-note'));

    // ---- J. nothing broke ----
    t('J1 no page errors, no console errors', errors.length === 0, errors);
    t('J2 nothing went out on the socket: every one of these is an HTTP route',
      (await sent()).every((r) => !!r.api), (await sent()).filter((r) => !r.api).map((r) => r.text));

    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally {
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
