#!/usr/bin/env node
'use strict';
/*
 * O6, the temperature unit: a Celsius / Fahrenheit segment on the Settings card, stored on
 * the device (config.temp_unit in the features document, "c" by default) so every browser
 * sees the same choice. The device holds every temperature in °C; the page converts on the
 * way out (the dashboard's readings, the Lighting page's three degree fields and their
 * suffixes) and back (what is typed into a degree field), and a unit change redraws the
 * whole page the way a language change does.
 *
 *   tools/ui/harness/run.sh p2-printing.json t-units.js PS_CLONE=1 PS_PRINT_PERCENT=37 \
 *       PS_PRINT_NOZZLE=220 PS_PRINT_BED=60 PS_PRINT_CHAMBER=35
 */
const { chromium } = require('playwright');
const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const feats = async () => (await fetch(`${BASE}/api/features`)).json();
const post = (b) => fetch(`${BASE}/api/features`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const unit = async () => (await feats()).config.temp_unit;
const tg = async () => (await feats()).config.temp_gradient;
async function waitFor(page, body, ms = 3000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function tap(page, sel) { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); }
const printerText = (page) => page.$eval('#ps-kv-printer', (e) => e.textContent.replace(/\s+/g, ' ').trim());
const has = (page, id, re) => waitFor(page, `${re}.test(document.getElementById('${id}').textContent)`);
const val = (page, id) => page.$eval('#' + id, (e) => e.value);
const suffixes = (page) => page.$$eval('.ps-deg', (o) => o.map((x) => x.textContent).join(','));
const isOn = (page, id) => page.$eval('#' + id, (e) => e.classList.contains('is-on') && e.getAttribute('aria-checked') === 'true');

async function fresh(page) {
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
  await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
}
async function typeInto(page, id, text) {
  await page.$eval('#' + id, (el) => el.scrollIntoView({ block: 'center' }));
  await page.fill('#' + id, text);
  /* leaving the field is what fires change for a person, so the focus goes first */
  await page.$eval('#' + id, (el) => { el.blur(); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(400);
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    await post({ features: { fx_temp: true, hot_warning: true, config_io: true } });
    await page.goto(BASE + '/');
    await fresh(page);

    // ---- A. the default: Celsius, everywhere ----
    t('A1 the device starts in Celsius', (await unit()) === 'c', await unit());
    await page.evaluate(() => show_card('settings'));
    t('A2 the segment shows Celsius chosen', await waitFor(page, "document.getElementById('ps-unit-c').classList.contains('is-on') && !document.getElementById('ps-unit-f').classList.contains('is-on')"));
    await page.evaluate(() => show_card('status'));
    t('A3 the printer card reads its three temperatures in °C', await has(page, 'ps-kv-printer', '/220 °C/') && /60 °C/.test(await printerText(page)) && /35 °C/.test(await printerText(page)), await printerText(page));
    await page.evaluate(() => show_card('theme'));
    t('A4 the gradient\'s ends and the warning threshold are in °C', await waitFor(page, "document.getElementById('ps-tg-lo').value === '25'") && (await val(page, 'ps-tg-hi')) === '250' && (await val(page, 'ps-hw-threshold')) === '50', [await val(page, 'ps-tg-lo'), await val(page, 'ps-tg-hi'), await val(page, 'ps-hw-threshold')]);
    t('A5 with °C after each', (await suffixes(page)) === '°C,°C,°C', await suffixes(page));
    t('A6 and the fields bounded 0..500', (await page.$eval('#ps-tg-lo', (e) => e.min + '..' + e.max)) === '0..500');

    // ---- B. Fahrenheit from the segment: the device holds it, the whole page follows ----
    await page.evaluate(() => show_card('settings'));
    await tap(page, '#ps-unit-f');
    await sleep(400);
    t('B1 the device now says Fahrenheit', (await unit()) === 'f', await unit());
    t('B2 the segment moved', await waitFor(page, "document.getElementById('ps-unit-f').classList.contains('is-on') && !document.getElementById('ps-unit-c').classList.contains('is-on')"));
    await page.evaluate(() => show_card('status'));
    t('B3 the printer card reads 428, 140 and 95 °F', await has(page, 'ps-kv-printer', '/428 °F/') && /140 °F/.test(await printerText(page)) && /95 °F/.test(await printerText(page)), await printerText(page));
    t('B4 and no °C is left on it', !/°C/.test(await printerText(page)), await printerText(page));
    await page.evaluate(() => show_card('theme'));
    t('B5 the degree fields show 77, 482 and 122', await waitFor(page, "document.getElementById('ps-tg-lo').value === '77'") && (await val(page, 'ps-tg-hi')) === '482' && (await val(page, 'ps-hw-threshold')) === '122', [await val(page, 'ps-tg-lo'), await val(page, 'ps-tg-hi'), await val(page, 'ps-hw-threshold')]);
    t('B6 with °F after each', (await suffixes(page)) === '°F,°F,°F', await suffixes(page));
    t('B7 and bounded 32..932', (await page.$eval('#ps-tg-lo', (e) => e.min + '..' + e.max)) === '32..932');

    // ---- C. typing in Fahrenheit reaches the device in Celsius ----
    await typeInto(page, 'ps-tg-lo', '212');
    t('C1 212 °F typed is 100 °C stored', (await tg()).lo === 100, await tg());
    t('C2 and the field still reads 212', (await val(page, 'ps-tg-lo')) === '212', await val(page, 'ps-tg-lo'));
    await typeInto(page, 'ps-tg-lo', '20');
    t('C3 20 °F is below 0 °C: not sent, the field put back', (await tg()).lo === 100 && (await val(page, 'ps-tg-lo')) === '212', [(await tg()).lo, await val(page, 'ps-tg-lo')]);
    await typeInto(page, 'ps-tg-lo', '77');
    t('C4 77 °F back to 25 °C', (await tg()).lo === 25, await tg());

    // ---- D. a language change keeps the unit ----
    await page.evaluate(() => set_language('de'));
    await sleep(300);
    t('D1 the suffixes survive the redraw in German', (await suffixes(page)) === '°F,°F,°F', await suffixes(page));
    await page.evaluate(() => show_card('status'));
    t('D2 and so do the readings', await has(page, 'ps-kv-printer', '/428 °F/'), await printerText(page));
    await page.evaluate(() => set_language('en'));

    // ---- E. a fresh page load reads the unit from the device ----
    await fresh(page);
    await page.evaluate(() => show_card('status'));
    t('E1 a reload comes up in Fahrenheit without being told', await has(page, 'ps-kv-printer', '/428 °F/'), await printerText(page));
    await page.evaluate(() => show_card('settings'));
    t('E2 with the segment on Fahrenheit', await waitFor(page, "document.getElementById('ps-unit-f').classList.contains('is-on')"));

    // ---- F. the route takes two words and nothing else ----
    const r1 = await post({ config: { temp_unit: 'k' } });
    const r2 = await post({ config: { temp_unit: 'C' } });
    const r3 = await post({ config: { temp_unit: 1 } });
    t('F1 kelvin, a capital and a number are refused', r1.status === 400 && r2.status === 400 && r3.status === 400, [r1.status, r2.status, r3.status]);
    t('F2 and the device still says Fahrenheit', (await unit()) === 'f', await unit());

    // ---- G. the unit rides in the settings file ----
    const exp = await (await fetch(`${BASE}/api/config`)).json();
    t('G1 the export carries temp_unit f', exp.temp_unit === 'f', exp.temp_unit);
    exp.temp_unit = 'c';
    const ri = await fetch(`${BASE}/api/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(exp) });
    t('G2 importing it with c puts the device back in Celsius', ri.status === 200 && (await unit()) === 'c', [ri.status, await unit()]);
    await fresh(page);
    await page.evaluate(() => show_card('status'));
    t('G3 and the page follows on the next load', await has(page, 'ps-kv-printer', '/220 °C/'), await printerText(page));

    t('H1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
