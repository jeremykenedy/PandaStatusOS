#!/usr/bin/env node
'use strict';
/*
 * Network page harness. Behaviour only: scan, use a found network, connect, the hotspot
 * switch and settings, the hostname, and the restart dialogs those two earn. Every frame
 * is asserted byte for byte. The hostname step is last because its OK restarts the mock,
 * which closes the socket; the page's lost-socket dialog is asserted and its reload is
 * never clicked.
 *
 * Fixture facts (p2-idle.json): wifi.ssid "<WIFI_SSID>", scan 0; sta hostname "ps-mock",
 * ip 192.0.2.10, state 3, auth_err_reason 0; ap "<AP_SSID>" / "<AP_PASSWORD>" at 192.0.2.1,
 * on 1; __mock.wifi_scan_results two entries, "<SCAN_SSID_A>" -48 and "<SCAN_SSID_B>" -71.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-network.js
 *       tools/ui/harness/run.sh p2-idle.json page-network.js PS_WIFI_FAIL=1
 */

const pw = require('./pw');
const { t, frame, sentAfter, sent, resetMock } = pw;

const WIFI_FAIL = process.env.PS_WIFI_FAIL === '1';
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const $ = (page, id) => page.locator('#' + id);
const val = (page, id) => page.$eval('#' + id, (el) => el.value);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const type = (page, id) => page.$eval('#' + id, (el) => el.type);
const checked = (page, id) => page.$eval('#' + id, (el) => el.checked);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const count = async () => (await sent()).length;
const dotIs = (page, cls) => page.$eval('#ps-network-dot', (e, c) => e.className === ('ps-dot' + (c ? ' ps-dot-' + c : '')), cls);
const dialogOpen = (page) => page.$eval('#ps-dialog', (d) => d.open);
async function waitText(page, id, want, ms = 3000) {
  return page.waitForFunction(([i, w]) => document.getElementById(i).textContent === w, [id, want], { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function waitDialog(page, title, ms = 3000) {
  return page.waitForFunction((w) => document.getElementById('ps-dialog').open && document.getElementById('ps-dialog-title').textContent === w, title, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#network' });

  // ---- A. as pushed ----
  t(`${tag} A1 network card visible, every other card hidden`, await pw.waitCard(page, 'network'));
  const navSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="network"]' : '#ps-bottombar a[data-ps-nav="network"]';
  t(`${tag} A2 the visible nav marks network as current`, await page.$eval(navSel, (a) => a.classList.contains('ps-current')));
  t(`${tag} A3 ssid, state 3 label, lit dot, address`, (await text(page, 'ps-network-ssid')) === '<WIFI_SSID>' && (await text(page, 'ps-network-state')) === (await tr(page, 'ps_dashboard_sta_3')) && await dotIs(page, 'on') && (await text(page, 'ps-network-ip')) === '192.0.2.10',
    { ssid: await text(page, 'ps-network-ssid'), state: await text(page, 'ps-network-state') });
  t(`${tag} A4 reason code 0 renders as a dash`, (await text(page, 'ps-network-reason')) === '—');
  t(`${tag} A5 scan state 0 label`, (await text(page, 'ps-network-scan-state')) === (await tr(page, 'ps_network_scan_0')));
  t(`${tag} A6 connect form empty, password field is a password field`, (await val(page, 'ps-network-connect-ssid')) === '' && (await val(page, 'ps-network-connect-password')) === '' && (await type(page, 'ps-network-connect-password')) === 'password');
  t(`${tag} A7 hostname pre-filled from the push`, (await val(page, 'ps-network-hostname-input')) === 'ps-mock');
  t(`${tag} A8 hotspot switch on, fields pre-filled, password masked`, await checked(page, 'ps-network-ap-on') && (await val(page, 'ps-network-ap-ssid')) === '<AP_SSID>' && (await val(page, 'ps-network-ap-password')) === '<AP_PASSWORD>' && (await type(page, 'ps-network-ap-password')) === 'password' && (await val(page, 'ps-network-ap-ip')) === '192.0.2.1');
  t(`${tag} A9 the Wi-Fi password from the push is nowhere on the page`, !(await page.content()).includes('<WIFI_PASSWORD>'));
  t(`${tag} A10 nothing sent by merely loading the page`, (await count()) === 0);
  await pw.shot(page, `network-${combo.theme}-${combo.width}`);
  await pw.shot(page, `network-${combo.theme}-${combo.width}`, { full: true });

  // ---- B. scan and use ----
  let n = await count();
  await pw.tap(page, '#ps-network-scan');
  let got = await sentAfter(n);
  t(`${tag} B1 scan sends {scan:1}, once`, got.length === 1 && got[0] === frame('wifi', { scan: 1 }), got);
  t(`${tag} B2 scanning: label 1, button disabled`, await waitText(page, 'ps-network-scan-state', await tr(page, 'ps_network_scan_1')) && await $(page, 'ps-network-scan').isDisabled());
  t(`${tag} B3 scan finishes: label 2, two networks with signal`, await waitText(page, 'ps-network-scan-state', await tr(page, 'ps_network_scan_2')) && (await page.locator('[data-ps-found]').count()) === 2 && (await page.$eval('[data-ps-found="1"]', (r) => r.textContent)).includes('<SCAN_SSID_B>') && (await page.$eval('[data-ps-found="1"]', (r) => r.textContent)).includes('-71 dBm'));
  n = await count();
  await pw.tap(page, '[data-ps-found="0"] button');
  t(`${tag} B4 Use fills the network name, focuses the password, sends nothing`, (await val(page, 'ps-network-connect-ssid')) === '<SCAN_SSID_A>' && (await page.evaluate(() => document.activeElement && document.activeElement.id)) === 'ps-network-connect-password' && (await count()) === n);

  // ---- C. connect ----
  await $(page, 'ps-network-connect-password').fill('<WIFI_PASSWORD>');
  await pw.tap(page, 'label.checkbox:has(#ps-network-connect-show)');
  t(`${tag} C1 show reveals the password field`, (await type(page, 'ps-network-connect-password')) === 'text');
  await pw.tap(page, 'label.checkbox:has(#ps-network-connect-show)');
  n = await count();
  await pw.tap(page, '#ps-network-connect-send');
  got = await sentAfter(n);
  t(`${tag} C2 connect sends ssid then password, once`, got.length === 1 && got[0] === frame('wifi', { ssid: '<SCAN_SSID_A>', password: '<WIFI_PASSWORD>' }), got);
  t(`${tag} C3 connecting: label 2, warn dot, ssid follows the push`, await waitText(page, 'ps-network-state', await tr(page, 'ps_dashboard_sta_2')) && await dotIs(page, 'warn') && (await text(page, 'ps-network-ssid')) === '<SCAN_SSID_A>');
  if (WIFI_FAIL) {
    t(`${tag} C4 the device refuses (mock knob PS_WIFI_FAIL): state 5 label, error dot, reason code shown`, await waitText(page, 'ps-network-state', await tr(page, 'ps_dashboard_sta_5')) && await dotIs(page, 'error') && (await text(page, 'ps-network-reason')) === '2', { state: await text(page, 'ps-network-state'), reason: await text(page, 'ps-network-reason') });
  } else {
    t(`${tag} C4 the device joins: state 3 label, lit dot, no reason code`, await waitText(page, 'ps-network-state', await tr(page, 'ps_dashboard_sta_3')) && await dotIs(page, 'on') && (await text(page, 'ps-network-reason')) === '—', { state: await text(page, 'ps-network-state') });
  }

  // ---- D. hotspot ----
  n = await count();
  await pw.tap(page, 'label.switch:has(#ps-network-ap-on)');
  got = await sentAfter(n);
  t(`${tag} D1 switching the hotspot off sends {on:0}, once`, got.length === 1 && got[0] === frame('ap', { on: 0 }), got);
  t(`${tag} D1b the push confirms it: switch off`, await page.waitForFunction(() => PS.state.ap.on === 0, null, { timeout: 2000 }).then(() => true).catch(() => false) && !(await checked(page, 'ps-network-ap-on')));
  n = await count();
  await pw.tap(page, 'label.switch:has(#ps-network-ap-on)');
  got = await sentAfter(n);
  t(`${tag} D2 and back on sends {on:1}`, got.length === 1 && got[0] === frame('ap', { on: 1 }), got);
  await $(page, 'ps-network-ap-ssid').fill('<AP_SSID_NEW>');
  n = await count();
  await pw.tap(page, '#ps-network-ap-send');
  got = await sentAfter(n);
  t(`${tag} D3 save sends ssid, password, ip in that order, once`, got.length === 1 && got[0] === frame('ap', { ssid: '<AP_SSID_NEW>', password: '<AP_PASSWORD>', ip: '192.0.2.1' }), got);
  t(`${tag} D4 an unchanged address earns set_ap: a toast, no dialog`, await page.waitForFunction((w) => document.getElementById('ps-toast').classList.contains('active') && document.getElementById('ps-toast').textContent === w, await tr(page, 'ps_core_saved_title'), { timeout: 2000 }).then(() => true).catch(() => false) && !(await dialogOpen(page)));
  await $(page, 'ps-network-ap-ip').fill('192.0.2.2');
  n = await count();
  await pw.tap(page, '#ps-network-ap-send');
  got = await sentAfter(n);
  t(`${tag} D5 save with a new address sends the same shape`, got.length === 1 && got[0] === frame('ap', { ssid: '<AP_SSID_NEW>', password: '<AP_PASSWORD>', ip: '192.0.2.2' }), got);
  t(`${tag} D6 a changed address earns set_hotspot_ip: the restart dialog`, await waitDialog(page, await tr(page, 'ps_core_saved_title')));
  await page.keyboard.press('Escape');
  got = await sentAfter(n, 250);
  t(`${tag} D7 Escape closes it and sends nothing`, !(await dialogOpen(page)) && got.length === 1, got);

  // ---- E. nav, while the socket is still up ----
  const dashSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="dashboard"]' : '#ps-bottombar a[data-ps-nav="dashboard"]';
  await pw.tap(page, dashSel);
  t(`${tag} E1 nav to dashboard`, await pw.waitCard(page, 'dashboard'));
  await pw.tap(page, navSel);
  t(`${tag} E2 nav back to network, the form keeps what was typed`, await pw.waitCard(page, 'network') && (await val(page, 'ps-network-ap-ip')) === '192.0.2.2');

  // ---- F. hostname, which restarts the device ----
  await $(page, 'ps-network-hostname-input').fill('ps-new');
  n = await count();
  await pw.tap(page, '#ps-network-hostname-send');
  got = await sentAfter(n);
  t(`${tag} F1 set hostname sends {hostname}, once`, got.length === 1 && got[0] === frame('sta', { hostname: 'ps-new' }), got);
  t(`${tag} F2 set_hostname ok: the restart dialog`, await waitDialog(page, await tr(page, 'ps_core_saved_title')));
  await page.evaluate(() => window.scrollTo(0, 0));
  await pw.shot(page, `network-${combo.theme}-${combo.width}-after-drive`);
  n = await count();
  await $(page, 'ps-dialog-ok').click();
  got = await sentAfter(n);
  t(`${tag} F3 OK sends settings.reset 1, the restart`, got.length === 1 && got[0] === frame('settings', { reset: 1 }), got);
  t(`${tag} F4 the device goes away and the page says so, with its reload button`, await waitDialog(page, await tr(page, 'ps_core_lost_title')) && (await text(page, 'ps-dialog-ok')) === (await tr(page, 'ps_core_reload')));
  t(`${tag} F5 nothing else was sent while the socket was down`, (await count()) === n + 1);

  t(`${tag} G1 no page errors, no console errors`, errors.length === 0, errors);
  t(`${tag} G2 no network errors`, netErrors.length === 0, netErrors);
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
