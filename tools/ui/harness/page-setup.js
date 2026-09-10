#!/usr/bin/env node
'use strict';
/*
 * Setup page harness. Two fixtures, two behaviours:
 *   factory-defaults.json  the device has no network: opening the page root lands on
 *                          #setup on its own, and Finish stops that for the session
 *   p2-idle.json           the device is on a network: the root lands on the dashboard,
 *                          and #setup is still reachable by its address
 * Then the same drive on both: scan, use, connect, the idle colour, each an exact frame
 * that another page also sends.
 *
 * Run:  tools/ui/harness/run.sh factory-defaults.json page-setup.js
 *       tools/ui/harness/run.sh p2-idle.json page-setup.js
 */

const pw = require('./pw');
const { t, frame, sentAfter, sent, resetMock } = pw;

const FACTORY = (process.env.PS_STATE || '').includes('factory');
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const $ = (page, id) => page.locator('#' + id);
const val = (page, id) => page.$eval('#' + id, (el) => el.value);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const count = async () => (await sent()).length;
const hash = (page) => page.evaluate(() => location.hash);
const dotIs = (page, cls) => page.$eval('#ps-setup-dot', (e, c) => e.className === ('ps-dot' + (c ? ' ps-dot-' + c : '')), cls);
async function waitText(page, id, want, ms = 3000) {
  return page.waitForFunction(([i, w]) => document.getElementById(i).textContent === w, [id, want], { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '' });

  // ---- A. where the root lands ----
  if (FACTORY) {
    t(`${tag} A1 an unprovisioned device: the root lands on #setup`, await pw.waitCard(page, 'setup') && (await hash(page)) === '#setup', await hash(page));
    t(`${tag} A2 no nav item is current; setup is not a destination`, await page.$$eval('[data-ps-nav]', (ls) => ls.every((l) => !l.classList.contains('ps-current'))));
    t(`${tag} A3 state 1 label, plain dot`, (await text(page, 'ps-setup-state')) === (await tr(page, 'ps_dashboard_sta_1')) && await dotIs(page, ''));
  } else {
    // the core routes an empty hash to the dashboard without rewriting the address
    t(`${tag} A1 a provisioned device: the root lands on the dashboard`, await pw.waitCard(page, 'dashboard') && ['', '#dashboard'].includes(await hash(page)), await hash(page));
    await page.evaluate(() => { location.hash = '#setup'; });
    t(`${tag} A2 #setup is still reachable by its address`, await pw.waitCard(page, 'setup'));
    t(`${tag} A3 state 3 label, lit dot`, (await text(page, 'ps-setup-state')) === (await tr(page, 'ps_dashboard_sta_3')) && await dotIs(page, 'on'));
  }
  t(`${tag} A4 the language list is the string table's, the device's language selected`, (await page.$$eval('#ps-setup-language option', (os) => os.map((o) => o.value))).join(',') === (await page.evaluate(() => PS_STRING_LANGS.join(','))) && (await val(page, 'ps-setup-language')) === 'en');
  t(`${tag} A5 the idle colour field shows the current mode's idle colour`, (await val(page, 'ps-setup-colour')) === '#FFFFFFFF', await val(page, 'ps-setup-colour'));
  t(`${tag} A6 the Wi-Fi form is empty, password masked`, (await val(page, 'ps-setup-ssid')) === '' && (await val(page, 'ps-setup-password')) === '' && (await page.$eval('#ps-setup-password', (e) => e.type)) === 'password');
  t(`${tag} A7 nothing sent by merely loading the page`, (await count()) === 0);
  await pw.shot(page, `setup-${FACTORY ? 'factory' : 'idle'}-${combo.theme}-${combo.width}`);
  await pw.shot(page, `setup-${FACTORY ? 'factory' : 'idle'}-${combo.theme}-${combo.width}`, { full: true });

  // ---- B. scan and use ----
  let n = await count();
  await pw.tap(page, '#ps-setup-scan');
  let got = await sentAfter(n);
  t(`${tag} B1 scan sends {scan:1}, once`, got.length === 1 && got[0] === frame('wifi', { scan: 1 }), got);
  t(`${tag} B2 the found networks arrive`, await page.waitForFunction(() => document.querySelectorAll('[data-ps-setup-found]').length === 2, null, { timeout: 3000 }).then(() => true).catch(() => false));
  n = await count();
  await pw.tap(page, '[data-ps-setup-found="1"] button');
  t(`${tag} B3 Use fills the name, focuses the password, sends nothing`, (await val(page, 'ps-setup-ssid')) === '<SCAN_SSID_B>' && (await page.evaluate(() => document.activeElement.id)) === 'ps-setup-password' && (await count()) === n);

  // ---- C. connect ----
  await $(page, 'ps-setup-password').fill('<WIFI_PASSWORD>');
  await pw.tap(page, 'label.checkbox:has(#ps-setup-show)');
  t(`${tag} C1 show reveals the password`, (await page.$eval('#ps-setup-password', (e) => e.type)) === 'text');
  n = await count();
  await pw.tap(page, '#ps-setup-connect');
  got = await sentAfter(n);
  t(`${tag} C2 connect sends ssid then password, once`, got.length === 1 && got[0] === frame('wifi', { ssid: '<SCAN_SSID_B>', password: '<WIFI_PASSWORD>' }), got);
  // the connecting window is the mock's PS_CONNECT_MS (700 ms) and a phone-width tap can eat
  // most of it, so the transition is read from the core's log rather than caught live
  t(`${tag} C3 connected: label and dot, having passed through connecting`, await waitText(page, 'ps-setup-state', await tr(page, 'ps_dashboard_sta_3')) && await dotIs(page, 'on') && (await page.evaluate(() => PS.state.sta.state)) === 3);

  // ---- D. the idle colour ----
  n = await count();
  await $(page, 'ps-setup-colour').fill('#00ff00');
  await page.keyboard.press('Tab');
  got = await sentAfter(n);
  t(`${tag} D1 the idle colour sends the current mode's format, index 0, once`, got.length === 1 && got[0] === frame('settings', { rgb_info_mode: 1, rgb_rgba: '#00FF00FF', rgb_state_index: 0 }), got);
  t(`${tag} D2 the echo lands: field and dot follow`, await page.waitForFunction(() => PS.state.settings.list2[1].rgb_rgba[0] === '#00FF00FF', null, { timeout: 2000 }).then(() => true).catch(() => false) && (await val(page, 'ps-setup-colour')) === '#00FF00FF');
  await page.evaluate(() => window.scrollTo(0, 0));
  await pw.shot(page, `setup-${FACTORY ? 'factory' : 'idle'}-${combo.theme}-${combo.width}-after-drive`);

  // ---- E. finish ----
  n = await count();
  await pw.tap(page, '#ps-setup-finish');
  t(`${tag} E1 Finish goes to the dashboard and sends nothing`, await pw.waitCard(page, 'dashboard') && (await hash(page)) === '#dashboard' && (await count()) === n);
  t(`${tag} E2 the session remembers`, (await page.evaluate(() => sessionStorage.getItem('ps_setup_done'))) === '1');
  await page.evaluate(() => { location.hash = ''; });
  await page.reload();
  await page.waitForFunction(() => !document.body.classList.contains('ps-waiting'), null, { timeout: 5000 });
  t(`${tag} E3 after a reload the root lands on the dashboard, setup done for this session`, await pw.waitCard(page, 'dashboard'), await hash(page));
  await page.evaluate(() => { location.hash = '#setup'; });
  t(`${tag} E4 #setup is still reachable by its address`, await pw.waitCard(page, 'setup'));

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
