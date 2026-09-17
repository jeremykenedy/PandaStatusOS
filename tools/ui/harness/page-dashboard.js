#!/usr/bin/env node
'use strict';
/*
 * Dashboard harness. The dashboard sends nothing; it renders what the device pushes, and
 * an unset value renders as a marked dash, never a zero. Expectations are read from the
 * mock's own state document, so the same harness runs on every fixture.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-dashboard.js
 *       tools/ui/harness/run.sh factory-defaults.json page-dashboard.js
 */

const pw = require('./pw');
const { t, sent, resetMock } = pw;

const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const fx = (process.env.PS_STATE || 'fixture').replace('.json', '');
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const unset = (page, id) => page.$eval('#' + id, (el) => el.classList.contains('ps-unset'));
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const present = (v) => v !== undefined && v !== null && v !== '';

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const s = await pw.mockState();
  // asked for by address: where the ROOT lands is the setup page's rule, and its harness's
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#dashboard' });

  const navSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="dashboard"]' : '#ps-bottombar a[data-ps-nav="dashboard"]';
  // an unprovisioned device puts its setup page in front of the default landing (D-024);
  // the nav must still lead here
  await page.waitForFunction(() => !document.body.classList.contains('ps-waiting'), null, { timeout: 5000 });
  if ((await page.evaluate(() => location.hash)) === '#setup') { await pw.waitCard(page, 'setup'); await pw.tap(page, navSel); }
  t(`${tag} A1 the dashboard card shows, alone`, await pw.waitCard(page, 'dashboard'));
  t(`${tag} A2 the visible nav marks dashboard as current`, await page.$eval(navSel, (a) => a.classList.contains('ps-current')));
  t(`${tag} A3 the waiting banner is gone once state arrived`, !(await page.locator('#ps-banner-waiting').isVisible()) && !(await page.evaluate(() => document.body.classList.contains('ps-waiting'))));

  // printer tile
  const p = s.printer || {};
  t(`${tag} B1 printer name ${present(p.name) ? 'shown' : 'unset renders as a dash'}`, present(p.name) ? (await text(page, 'ps-dashboard-printer-name')) === p.name && !(await unset(page, 'ps-dashboard-printer-name')) : (await text(page, 'ps-dashboard-printer-name')) === '—' && await unset(page, 'ps-dashboard-printer-name'));
  t(`${tag} B2 printer state label from the enum`, (await text(page, 'ps-dashboard-printer-state')) === (await tr(page, 'ps_dashboard_prn_' + p.state)), await text(page, 'ps-dashboard-printer-state'));
  const pillKey = p.state === 3 ? 'ready' : p.state === 2 ? 'connecting' : p.state >= 4 ? 'error' : 'unbound';
  t(`${tag} B3 the top-bar pill follows the printer link`, (await text(page, 'ps-topbar-pill')) === (await tr(page, 'ps_dashboard_pill_' + pillKey)));

  // network tile
  const sta = s.sta || {};
  t(`${tag} C1 hostname`, (await text(page, 'ps-dashboard-hostname')) === (present(sta.hostname) ? sta.hostname : '—'));
  const netWant = (await tr(page, 'ps_dashboard_sta_' + sta.state)) + (sta.state === 3 && present(sta.ip) ? ' · ' + sta.ip : '');
  t(`${tag} C2 network state label, with the address only once connected`, (await text(page, 'ps-dashboard-network-state')) === netWant, await text(page, 'ps-dashboard-network-state'));

  // lighting and device tiles
  const set = s.settings || {}, entry = set.list2 && set.list2[set.current_mode];
  t(`${tag} D1 mode name`, (await text(page, 'ps-dashboard-mode')) === (await tr(page, set.current_mode === 0 ? 'ps_dashboard_mode_music' : 'ps_dashboard_mode_h2d')));
  t(`${tag} D2 brightness of the selected mode`, (await text(page, 'ps-dashboard-brightness')) === (await tr(page, 'ps_dashboard_brightness')) + ' ' + entry.brightness + '%');
  t(`${tag} D3 firmware version`, (await text(page, 'ps-dashboard-fw')) === set.fw_version);
  t(`${tag} D4 hotspot on/off`, (await text(page, 'ps-dashboard-hotspot')) === (await tr(page, s.ap.on === 1 ? 'ps_dashboard_hotspot_on' : 'ps_dashboard_hotspot_off')));
  t(`${tag} E1 the dashboard sends nothing`, (await sent()).length === 0);
  await pw.shot(page, `dashboard-${fx}-${combo.theme}-${combo.width}`);

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
