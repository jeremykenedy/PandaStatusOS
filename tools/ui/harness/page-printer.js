#!/usr/bin/env node
'use strict';
/*
 * Printer page harness. Behaviour only: scan, use a found printer, bind, unbind, and the
 * exact frame each puts on the wire. The device's replies come from the mock's timers
 * (PS_SCAN_MS, PS_CONNECT_MS) and its PS_PRINTER_FAIL knob.
 *
 * Fixture facts (p2-idle.json): printer name "Mock P2S", sn "<PRINTER_SN>", ip
 * 192.0.2.20, state 3, scan 5; __mock.printer_scan_results is one entry, "Mock P2S" at
 * 192.0.2.20. Values typed here are placeholders in angle brackets, as the fixtures use.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-printer.js
 *       tools/ui/harness/run.sh p2-idle.json page-printer.js PS_PRINTER_FAIL=6
 */

const pw = require('./pw');
const { t, frame, sentAfter, sent, resetMock, tapEye, eye, pressed } = pw;

const FAIL = Number(process.env.PS_PRINTER_FAIL || 0);
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const $ = (page, id) => page.locator('#' + id);
const val = (page, id) => page.$eval('#' + id, (el) => el.value);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const count = async () => (await sent()).length;
const dotIs = (page, cls) => page.$eval('#ps-printer-dot', (e, c) => e.className === ('ps-dot' + (c ? ' ps-dot-' + c : '')), cls);
async function waitText(page, id, want, ms = 3000) {
  return page.waitForFunction(([i, w]) => document.getElementById(i).textContent === w, [id, want], { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#printer' });

  // ---- A. the bound printer, as pushed ----
  t(`${tag} A1 printer card visible, every other card hidden`, await pw.waitCard(page, 'printer'));
  const navSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="printer"]' : '#ps-bottombar a[data-ps-nav="printer"]';
  t(`${tag} A2 the visible nav marks printer as current`, await page.$eval(navSel, (a) => a.classList.contains('ps-current')));
  t(`${tag} A3 name, state 3 label, lit dot`, (await text(page, 'ps-printer-name')) === 'Mock P2S' && (await text(page, 'ps-printer-state')) === (await tr(page, 'ps_dashboard_prn_3')) && await dotIs(page, 'on'),
    { name: await text(page, 'ps-printer-name'), state: await text(page, 'ps-printer-state') });
  t(`${tag} A4 serial and address shown because the device sends them`, (await text(page, 'ps-printer-sn')) === '<PRINTER_SN>' && (await text(page, 'ps-printer-ip')) === '192.0.2.20');
  t(`${tag} A5 the access code is nowhere on the page`, !(await page.content()).includes('<PRINTER_ACCESS_CODE>'));
  t(`${tag} A6 scan state 5 label`, (await text(page, 'ps-printer-scan-state')) === (await tr(page, 'ps_printer_scan_5')), await text(page, 'ps-printer-scan-state'));
  t(`${tag} A7 bind form starts empty, code field is a password field`, (await val(page, 'ps-printer-bind-name')) === '' && (await val(page, 'ps-printer-bind-sn')) === '' && (await val(page, 'ps-printer-bind-ip')) === '' && (await val(page, 'ps-printer-bind-code')) === '' && (await page.$eval('#ps-printer-bind-code', (e) => e.type)) === 'password');
  t(`${tag} A8 unbind enabled while bound, scan enabled while idle`, !(await $(page, 'ps-printer-unbind').isDisabled()) && !(await $(page, 'ps-printer-scan').isDisabled()));
  t(`${tag} A9 nothing sent by merely loading the page`, (await count()) === 0);
  await pw.shot(page, `printer-${combo.theme}-${combo.width}`);
  await pw.shot(page, `printer-${combo.theme}-${combo.width}`, { full: true });

  // ---- B. scan ----
  let n = await count();
  await pw.tap(page, '#ps-printer-scan');
  let got = await sentAfter(n);
  t(`${tag} B1 scan sends {scan:1}, once`, got.length === 1 && got[0] === frame('printer', { scan: 1 }), got);
  t(`${tag} B2 scanning: label 1, button disabled`, await waitText(page, 'ps-printer-scan-state', await tr(page, 'ps_printer_scan_1')) && await $(page, 'ps-printer-scan').isDisabled());
  t(`${tag} B3 scan finishes: label 2, one printer found`, await waitText(page, 'ps-printer-scan-state', await tr(page, 'ps_printer_scan_2')) && (await page.locator('[data-ps-found]').count()) === 1 && !(await $(page, 'ps-printer-scan').isDisabled()));
  t(`${tag} B4 the found row names the printer, its address and its serial`, (await page.$eval('[data-ps-found="0"]', (r) => r.textContent)).includes('Mock P2S') && (await page.$eval('[data-ps-found="0"]', (r) => r.textContent)).includes('192.0.2.20') && (await page.$eval('[data-ps-found="0"]', (r) => r.textContent)).includes('MOCKSN000000001'));
  n = await count();
  await pw.tap(page, '[data-ps-found="0"] button');
  t(`${tag} B5 Use fills name, address and serial, sends nothing`, (await val(page, 'ps-printer-bind-name')) === 'Mock P2S' && (await val(page, 'ps-printer-bind-ip')) === '192.0.2.20' && (await val(page, 'ps-printer-bind-sn')) === 'MOCKSN000000001' && (await count()) === n);
  // the access code is the one thing no announcement carries, so it stays empty and takes the caret
  t(`${tag} B5b it leaves the access code empty and focused`, (await val(page, 'ps-printer-bind-code')) === '' && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'ps-printer-bind-code');

  // ---- C. bind ----
  await $(page, 'ps-printer-bind-sn').fill('<PRINTER_SN>');
  await $(page, 'ps-printer-bind-code').fill('<ACCESS_CODE>');
  t(`${tag} C1 the access code starts hidden`, (await page.$eval('#ps-printer-bind-code', (e) => e.type)) === 'password' && (await eye(page, 'ps-printer-bind-code')) === '#ps-icon-eye');
  await tapEye(page, 'ps-printer-bind-code');
  t(`${tag} C1b the eye reveals it, presses itself and strikes the icon through`, (await page.$eval('#ps-printer-bind-code', (e) => e.type)) === 'text' && (await pressed(page, 'ps-printer-bind-code')) === 'true' && (await eye(page, 'ps-printer-bind-code')) === '#ps-icon-eye-slash');
  await tapEye(page, 'ps-printer-bind-code');
  t(`${tag} C1c and back to a hidden field`, (await page.$eval('#ps-printer-bind-code', (e) => e.type)) === 'password' && (await pressed(page, 'ps-printer-bind-code')) === 'false');
  n = await count();
  await pw.tap(page, '#ps-printer-bind-send');
  got = await sentAfter(n);
  t(`${tag} C2 bind sends name, sn, access_code, ip in that order, once`, got.length === 1 && got[0] === frame('printer', { name: 'Mock P2S', sn: '<PRINTER_SN>', access_code: '<ACCESS_CODE>', ip: '192.0.2.20' }), got);
  t(`${tag} C3 connecting: label 2, warn dot`, await waitText(page, 'ps-printer-state', await tr(page, 'ps_dashboard_prn_2')) && await dotIs(page, 'warn'));
  const final = FAIL >= 4 && FAIL <= 7 ? FAIL : 3;
  t(`${tag} C4 the device settles on state ${final}${FAIL ? ' (mock knob PS_PRINTER_FAIL)' : ''}: label and dot`, await waitText(page, 'ps-printer-state', await tr(page, 'ps_dashboard_prn_' + final)) && await dotIs(page, final === 3 ? 'on' : 'error'),
    { state: await text(page, 'ps-printer-state') });
  t(`${tag} C5 the typed access code never lands in the page text`, !(await page.$eval('#ps-card-printer', (c) => c.textContent)).includes('<ACCESS_CODE>'));

  // ---- D. unbind ----
  n = await count();
  await pw.tap(page, '#ps-printer-unbind');
  t(`${tag} D1 unbind asks first, with its own title`, (await page.$eval('#ps-dialog', (d) => d.open)) && (await text(page, 'ps-dialog-title')) === (await tr(page, 'ps_printer_unbind_title')));
  await $(page, 'ps-dialog-cancel').click();
  got = await sentAfter(n, 250);
  t(`${tag} D2 cancel sends nothing`, got.length === 0 && !(await page.$eval('#ps-dialog', (d) => d.open)), got);
  await pw.tap(page, '#ps-printer-unbind');
  await $(page, 'ps-dialog-ok').click();
  got = await sentAfter(n);
  t(`${tag} D3 confirm sends {disconnect:1}, once`, got.length === 1 && got[0] === frame('printer', { disconnect: 1 }), got);
  t(`${tag} D4 unbound: state 1 label, plain dot, unbind disabled`, await waitText(page, 'ps-printer-state', await tr(page, 'ps_dashboard_prn_1')) && await dotIs(page, '') && await $(page, 'ps-printer-unbind').isDisabled());
  await page.evaluate(() => window.scrollTo(0, 0));
  await pw.shot(page, `printer-${combo.theme}-${combo.width}-after-drive`);

  // ---- E. nav ----
  const dashSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="dashboard"]' : '#ps-bottombar a[data-ps-nav="dashboard"]';
  await pw.tap(page, dashSel);
  t(`${tag} E1 nav to dashboard`, await pw.waitCard(page, 'dashboard'));
  await pw.tap(page, navSel);
  t(`${tag} E2 nav back to printer`, await pw.waitCard(page, 'printer'));
  t(`${tag} E3 navigating sent nothing`, (await count()) === n + 1);

  t(`${tag} F1 no page errors, no console errors`, errors.length === 0, errors);
  t(`${tag} F2 no network errors`, netErrors.length === 0, netErrors);
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
