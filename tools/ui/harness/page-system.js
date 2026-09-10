#!/usr/bin/env node
'use strict';
/*
 * System page harness. Behaviour only: the versions, the language list, the theme
 * preference (browser-side, nothing on the wire), the two whole-image uploads with their
 * caps, and the factory reset behind its confirm, which ends the run: the mock answers,
 * then restarts, and the page's lost-device dialog is asserted.
 *
 * Fixture facts (p2-idle.json): settings.fw_version "V1.0.0", img_version "V1.0.0" withheld
 * unless PS_IMG_VERSION=1, language "en"; __mock.next_img_version "V1.0.1". Only English
 * exists in the string table yet, so the language select has one option and a change
 * cannot be driven; the option list is asserted instead.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-system.js
 *       tools/ui/harness/run.sh p2-idle.json page-system.js PS_IMG_VERSION=1
 *       tools/ui/harness/run.sh p2-idle.json page-system.js PS_OTA_REFUSE=1
 */

const pw = require('./pw');
const { t, frame, sentAfter, sent, resetMock } = pw;
const fs = require('fs');

const REFUSE = process.env.PS_OTA_REFUSE === '1';
const IMGVER = process.env.PS_IMG_VERSION === '1';
const CAP_FW = 0x480000, CAP_IMG = 0x6E0000;
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const $ = (page, id) => page.locator('#' + id);
const val = (page, id) => page.$eval('#' + id, (el) => el.value);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const count = async () => (await sent()).length;
const bodyTheme = (page) => page.evaluate(() => document.body.classList.contains('dark') ? 'dark' : document.body.classList.contains('light') ? 'light' : 'none');
const stored = (page) => page.evaluate(() => { try { return localStorage.getItem('ps_theme'); } catch (e) { return 'ERR'; } });
const dialogOpen = (page) => page.$eval('#ps-dialog', (d) => d.open);
async function waitText(page, id, want, ms = 3000) {
  return page.waitForFunction(([i, w]) => document.getElementById(i).textContent === w, [id, want], { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function waitDialog(page, title, ms = 3000) {
  return page.waitForFunction((w) => document.getElementById('ps-dialog').open && document.getElementById('ps-dialog-title').textContent === w, title, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
function mockLog(ev) {
  try { return fs.readFileSync(process.env.PS_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ev === ev); } catch (_) { return []; }
}
async function waitLog(ev, detail, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (mockLog(ev).some((r) => r.detail === detail)) return true; await pw.sleep(40); }
  return false;
}
const choose = (page, id, buffer, name) => page.setInputFiles('#' + id, { name, mimeType: 'application/octet-stream', buffer });

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#system' });
  const reqs = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/ota') reqs.push({ method: r.method(), headers: r.headers() }); });

  // ---- A. as pushed ----
  t(`${tag} A1 system card visible, every other card hidden`, await pw.waitCard(page, 'system'));
  const navSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="system"]' : '#ps-bottombar a[data-ps-nav="system"]';
  t(`${tag} A2 the visible nav marks system as current`, await page.$eval(navSel, (a) => a.classList.contains('ps-current')));
  t(`${tag} A3 firmware version shown`, (await text(page, 'ps-system-fw')) === 'V1.0.0', await text(page, 'ps-system-fw'));
  t(`${tag} A4 image pack version ${IMGVER ? 'shown (mock knob)' : 'a dash until the device sends it'}`, (await text(page, 'ps-system-img')) === (IMGVER ? 'V1.0.0' : '—'), await text(page, 'ps-system-img'));
  const langs = await page.$$eval('#ps-system-language option', (os) => os.map((o) => [o.value, o.textContent]));
  const want = await page.evaluate(() => PS_STRING_LANGS.map((c) => [c, PS_STRINGS[c].ps_core_language_name || c]));
  t(`${tag} A5 the language list is the string table's, named in each language's own words`, JSON.stringify(langs) === JSON.stringify(want) && langs.length >= 1, langs);
  t(`${tag} A6 the device's language is selected`, (await val(page, 'ps-system-language')) === 'en');
  t(`${tag} A7 the theme select shows this browser's preference`, (await val(page, 'ps-system-theme')) === combo.theme, await val(page, 'ps-system-theme'));
  t(`${tag} A8 upload status lines idle, bars hidden`, (await text(page, 'ps-system-fw-status')) === (await tr(page, 'ps_system_status_idle')) && await page.$eval('#ps-system-fw-progress', (e) => e.hidden) && await page.$eval('#ps-system-img-progress', (e) => e.hidden));
  t(`${tag} A9 nothing sent by merely loading the page`, (await count()) === 0 && reqs.length === 0);
  await pw.shot(page, `system-${combo.theme}-${combo.width}`);
  await pw.shot(page, `system-${combo.theme}-${combo.width}`, { full: true });

  // ---- B. theme: browser-side only ----
  const other = combo.theme === 'dark' ? 'light' : 'dark';
  await $(page, 'ps-system-theme').selectOption(other);
  t(`${tag} B1 choosing ${other} repaints the body and stores the preference, nothing on the wire`, (await bodyTheme(page)) === other && (await stored(page)) === other && (await count()) === 0, { body: await bodyTheme(page), stored: await stored(page) });
  await $(page, 'ps-system-theme').selectOption('auto');
  t(`${tag} B2 auto follows the system (${combo.theme} here) and stores auto`, (await bodyTheme(page)) === combo.theme && (await stored(page)) === 'auto', { body: await bodyTheme(page), stored: await stored(page) });
  await pw.tap(page, '#ps-topbar-theme');
  await pw.sleep(50);
  t(`${tag} B3 the top-bar button cycles auto to dark and the select follows`, (await bodyTheme(page)) === 'dark' && (await val(page, 'ps-system-theme')) === 'dark', { body: await bodyTheme(page), sel: await val(page, 'ps-system-theme') });
  await $(page, 'ps-system-theme').selectOption(combo.theme);
  t(`${tag} B4 back to ${combo.theme}`, (await bodyTheme(page)) === combo.theme);

  // ---- C. firmware upload ----
  const fw = Buffer.alloc(1000, 7);
  await choose(page, 'ps-system-fw-file', fw, 'firmware.bin');
  t(`${tag} C1 the device receives 1000 bytes as ota_fw${REFUSE ? ' and refuses (mock knob)' : ''}`, await waitLog(REFUSE ? 'ota_refused' : 'ota_accepted', 'ota_fw 1000B'), mockLog('ota_refused').concat(mockLog('ota_accepted')).map((r) => r.detail));
  await pw.sleep(150);
  t(`${tag} C2 one request: POST /ota, OTA-Type ota_fw, octet-stream`, reqs.length === 1 && reqs[0].method === 'POST' && reqs[0].headers['ota-type'] === 'ota_fw' && reqs[0].headers['content-type'] === 'application/octet-stream;charset=UTF-8', reqs);
  t(`${tag} C3 the device's answer is the status: ${REFUSE ? 'refused' : 'accepted'}`, await waitText(page, 'ps-system-fw-status', await tr(page, REFUSE ? 'ps_system_status_refused' : 'ps_system_status_ok')), await text(page, 'ps-system-fw-status'));
  t(`${tag} C4 the bar is put away`, await page.$eval('#ps-system-fw-progress', (e) => e.hidden));
  await choose(page, 'ps-system-fw-file', Buffer.alloc(CAP_FW + 1, 0), 'huge.bin');
  await pw.sleep(300);
  t(`${tag} C5 a file over 0x480000 bytes is refused in the browser, naming 4.5 MB, no request`, (await text(page, 'ps-system-fw-status')) === (await tr(page, 'ps_system_status_too_big')).replace('{limit}', '4.5 MB') && reqs.length === 1, { status: await text(page, 'ps-system-fw-status'), reqs: reqs.length });

  // ---- D. image pack upload ----
  await choose(page, 'ps-system-img-file', Buffer.alloc(2000, 9), 'images.bin');
  t(`${tag} D1 the device receives 2000 bytes as ota_img${REFUSE ? ' and refuses' : ''}`, await waitLog(REFUSE ? 'ota_refused' : 'ota_accepted', 'ota_img 2000B'));
  await pw.sleep(150);
  t(`${tag} D2 second request carries OTA-Type ota_img`, reqs.length === 2 && reqs[1].headers['ota-type'] === 'ota_img', reqs.map((r) => r.headers['ota-type']));
  t(`${tag} D3 status follows the device's answer`, await waitText(page, 'ps-system-img-status', await tr(page, REFUSE ? 'ps_system_status_refused' : 'ps_system_status_ok')), await text(page, 'ps-system-img-status'));
  if (!REFUSE) t(`${tag} D4 the mock now holds the next image version; the page shows it only when pushed (INFERENCE, D-014)`, (await pw.mockState()).settings.img_version === 'V1.0.1');
  await choose(page, 'ps-system-img-file', Buffer.alloc(CAP_IMG + 1, 0), 'huge.bin');
  await pw.sleep(300);
  t(`${tag} D5 a file over 0x6E0000 bytes is refused in the browser, naming 6.875 MB, no request`, (await text(page, 'ps-system-img-status')) === (await tr(page, 'ps_system_status_too_big')).replace('{limit}', '6.875 MB') && reqs.length === 2, { status: await text(page, 'ps-system-img-status'), reqs: reqs.length });
  t(`${tag} D6 uploads put nothing on the socket`, (await count()) === 0);

  // ---- E. nav, and the lighting link inside the resets tile ----
  await pw.tap(page, '#ps-system-resets a[data-ps-nav="lighting"]');
  t(`${tag} E1 the reset-lighting link opens the lighting page`, await pw.waitCard(page, 'lighting'));
  await pw.tap(page, navSel);
  t(`${tag} E2 nav back to system`, await pw.waitCard(page, 'system'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await pw.shot(page, `system-${combo.theme}-${combo.width}-after-drive`);

  // ---- F. factory reset, last ----
  let n = await count();
  await pw.tap(page, '#ps-system-factory');
  t(`${tag} F1 asks first, in its own words, with the explicit confirm label`, (await dialogOpen(page)) && (await text(page, 'ps-dialog-title')) === (await tr(page, 'ps_system_factory_title')) && (await text(page, 'ps-dialog-ok')) === (await tr(page, 'ps_system_factory_confirm')) && !(await page.$eval('#ps-dialog-cancel', (b) => b.hidden)));
  await $(page, 'ps-dialog-cancel').click();
  let got = await sentAfter(n, 250);
  t(`${tag} F2 cancel sends nothing`, got.length === 0 && !(await dialogOpen(page)), got);
  await pw.tap(page, '#ps-system-factory');
  const doneTitle = await tr(page, 'ps_core_factory_done_title'), lostTitle = await tr(page, 'ps_core_lost_title');
  await $(page, 'ps-dialog-ok').click();
  // the notice lives only until the mock restarts (PS_RESTART_MS, 150 ms): look for it first
  t(`${tag} F3 the device answers before it restarts: the factory-done notice`, await waitDialog(page, doneTitle));
  got = (await sent()).slice(n).map((r) => r.text);
  t(`${tag} F4 confirm sent settings.factory_reset 1, once`, got.length === 1 && got[0] === frame('settings', { factory_reset: 1 }), got);
  t(`${tag} F5 then the socket closes and the lost-device dialog takes over`, await waitDialog(page, lostTitle));
  t(`${tag} F6 nothing else was sent`, (await count()) === n + 1);

  t(`${tag} G1 no page errors, no console errors`, errors.length === 0, errors);
  t(`${tag} G2 network errors: ${REFUSE ? 'exactly the two refusals' : 'none'}`, netErrors.length === (REFUSE ? 2 : 0), netErrors);
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
