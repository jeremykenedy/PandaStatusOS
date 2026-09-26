#!/usr/bin/env node
'use strict';
/*
 * The colour picker's presets: every one names itself on the button, in the page's language,
 * the one that matches the colour being chosen is marked however it got there, and a preset
 * that is used reaches the device like any other colour.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-picker.js
 */
const { chromium } = require('playwright');
const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await fetch(`${BASE}/__state`)).json();
async function tap(page, sel) { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); }

const ENGLISH = ['White', 'Warm white', 'Red', 'Orange', 'Amber', 'Yellow', 'Green', 'Teal', 'Cyan', 'Blue', 'Purple', 'Magenta', 'Pink', 'Off'];
const HEXES = ['#FFFFFF', '#FFE0B0', '#FF0000', '#FF7F00', '#FFBF00', '#FFFF00', '#00FF00', '#00A080', '#00FFFF', '#0000FF', '#8000FF', '#FF00FF', '#FF69B4', '#000000'];

const presets = (page) => page.$$eval('#ps-hsl-presets [data-ps-hex]', (bs) => bs.map((b) => {
  const chip = b.querySelector('.chip'), nm = b.querySelector('.nm');
  const bg = chip ? getComputedStyle(chip).backgroundColor : '';
  return { hex: b.getAttribute('data-ps-hex'), name: nm ? nm.textContent : '', label: b.getAttribute('aria-label'),
           pressed: b.getAttribute('aria-pressed'), bg, nmSize: nm ? parseFloat(getComputedStyle(nm).fontSize) : 0 };
}));
const pressed = async (page) => (await presets(page)).filter((p) => p.pressed === 'true').map((p) => p.hex);
const rgb = (hex) => `rgb(${parseInt(hex.substr(1, 2), 16)}, ${parseInt(hex.substr(3, 2), 16)}, ${parseInt(hex.substr(5, 2), 16)})`;

async function openPicker(page) {
  await page.evaluate(() => show_card('theme'));
  await tap(page, '#ps-col-0');
  return page.waitForFunction(() => { const d = document.getElementById('ps-color-picker'); return d && d.open; }, null, { timeout: 3000 }).then(() => true).catch(() => false);
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

    // ---- A. fourteen presets, each one saying what it is ----
    t('A1 the picker opens from a state colour', await openPicker(page));
    const a = await presets(page);
    t('A2 fourteen presets', a.length === 14, a.length);
    t('A3 each is named on the button, in order', a.map((p) => p.name).join('|') === ENGLISH.join('|'), a.map((p) => p.name));
    t('A4 and named to a screen reader the same way', a.every((p) => p.label === p.name), a.map((p) => p.label));
    t('A5 each is the colour it says', a.every((p, i) => p.hex === HEXES[i] && p.bg === rgb(HEXES[i])), a.map((p) => p.bg));
    t('A6 the name is in smaller type than the page', a.every((p) => p.nmSize > 0 && p.nmSize < 14), a.map((p) => p.nmSize));

    // ---- B. the chosen one is marked, however the colour got there ----
    await tap(page, '#ps-hsl-presets [data-ps-hex="#FF0000"]');
    t('B1 a tap sets the colour', (await page.$eval('#ps-hsl-hex', (e) => e.value)).toUpperCase() === '#FF0000', await page.$eval('#ps-hsl-hex', (e) => e.value));
    t('B2 and marks that preset alone', JSON.stringify(await pressed(page)) === '["#FF0000"]', await pressed(page));
    await page.fill('#ps-hsl-hex', '#0000ff');
    await sleep(100);
    t('B3 a typed colour that is a preset marks it', JSON.stringify(await pressed(page)) === '["#0000FF"]', await pressed(page));
    await page.fill('#ps-hsl-hex', '#123456');
    await sleep(100);
    t('B4 a colour that is none of them marks none', (await pressed(page)).length === 0, await pressed(page));

    // ---- C. a preset reaches the device like any colour ----
    const mode = (await state()).settings.current_mode;
    await tap(page, '#ps-hsl-presets [data-ps-hex="#FF69B4"]');
    await tap(page, '#ps-hsl-confirm');
    await sleep(500);
    const got = String((await state()).settings.list2[mode].rgb_rgba[0]).toUpperCase().replace('#', '').slice(0, 6);
    t('C1 the device holds pink for the idle colour', got === 'FF69B4', got);

    // ---- D. the names follow the language ----
    await page.evaluate(() => set_language('de'));
    t('D1 the picker opens again', await openPicker(page));
    const d = await presets(page);
    t('D2 the names are German now', d[0].name === 'Weiß' && d[2].name === 'Rot' && d[13].name === 'Aus', d.map((p) => p.name));
    t('D3 and still fourteen, not twenty-eight', d.length === 14, d.length);
    t('D4 the colour it opened on is marked', JSON.stringify(d.filter((p) => p.pressed === 'true').map((p) => p.hex)) === '["#FF69B4"]', d.map((p) => p.pressed));
    await tap(page, '#ps-hsl-cancel');
    await page.evaluate(() => set_language('en'));

    t('E1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
