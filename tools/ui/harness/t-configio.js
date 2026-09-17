#!/usr/bin/env node
'use strict';
/*
 * C3, the settings file. Behind its switch; the download is the device's own route with the
 * filename on it; a restore posts the document back whole and a document the device refuses
 * is said to be refused rather than left looking saved.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-configio.js PS_CLONE=1
 */
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
async function waitFor(page, body, ms = 4000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function tap(page, sel) { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); }

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });

    await page.goto(BASE + '/');
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('settings'));
    t('A1 the card is away while the switch is off', await page.$eval('#ps-cfg-card', (e) => e.hidden));

    await post('/api/features', { features: { config_io: true } });
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('settings'));
    t('B1 the card appears', await waitFor(page, "!document.getElementById('ps-cfg-card').hidden"));

    // ---- the download is the device's route, named by the device ----
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 6000 }), tap(page, '#ps-cfg-download')]);
    t('C1 a file is downloaded', !!dl);
    t('C2 the device named it, not the page', dl && /pandastatusos/i.test(dl.suggestedFilename()), dl && dl.suggestedFilename());

    const doc = await (await fetch(BASE + '/api/config')).json();
    t('C3 it is the settings document', !!doc && typeof doc === 'object' && 'hostname' in doc, Object.keys(doc || {}).slice(0, 8));
    t('C4 it carries no Wi-Fi password, no hotspot password and no access code',
      !(doc.wifi && doc.wifi.password) && !(doc.ap && doc.ap.password) && !(doc.printer && doc.printer.access_code),
      { wifi: doc.wifi, ap: doc.ap, printer: doc.printer });

    // ---- a restore that the device takes ----
    const changed = JSON.parse(JSON.stringify(doc));
    changed.hostname = 'restored-name';
    await page.setInputFiles('#ps-cfg-file', { name: 'settings.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(changed)) });
    t('D1 the page says the settings were restored',
      await waitFor(page, "document.getElementById('ps-cfg-note').textContent === tr('ui_settings_restored','')"),
      await page.$eval('#ps-cfg-note', (e) => e.textContent));
    const after = await (await fetch(BASE + '/api/config')).json();
    t('D2 the device holds what was in the file', after.hostname === 'restored-name', after.hostname);

    // ---- a restore the device refuses ----
    await page.setInputFiles('#ps-cfg-file', { name: 'junk.json', mimeType: 'application/json', buffer: Buffer.from('{"not":"a settings document"}') });
    t('E1 the page says it was refused, rather than leaving it looking saved',
      await waitFor(page, "document.getElementById('ps-cfg-note').textContent === tr('ui_settings_refused','')"),
      await page.$eval('#ps-cfg-note', (e) => e.textContent));
    const after2 = await (await fetch(BASE + '/api/config')).json();
    t('E2 and nothing on the device moved', after2.hostname === 'restored-name', after2.hostname);

    t('F1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
