#!/usr/bin/env node
'use strict';
/*
 * Logs page harness. The log is the core's event ring, so this drives other pages to
 * make entries and asserts what the logs page shows of them: inbound frames as root
 * names only, outbound frames with members, credentials as lengths and never as values,
 * newest first, copy and clear.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-logs.js
 */

const pw = require('./pw');
const { t, sent, resetMock } = pw;

const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const $ = (page, id) => page.locator('#' + id);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const lines = async (page) => (await text(page, 'ps-logs-list')).split('\n').filter(Boolean).map((l) => l.replace(/^\d\d:\d\d:\d\d\.\d\d\d  /, ''));
const navTo = async (page, combo, name) => { await pw.tap(page, (combo.width >= 992 ? '#ps-rail' : '#ps-bottombar') + ` a[data-ps-nav="${name}"]`); return pw.waitCard(page, name); };

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#logs', permissions: ['clipboard-read', 'clipboard-write'] });
  const T = {};
  for (const k of ['open', 'in', 'out', 'response', 'ok', 'copied']) T[k] = await tr(page, 'ps_logs_' + k);

  // ---- A. the connect, as the log tells it ----
  t(`${tag} A1 logs card visible, every other card hidden`, await pw.waitCard(page, 'logs'));
  const navSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="logs"]' : '#ps-bottombar a[data-ps-nav="logs"]';
  t(`${tag} A2 the visible nav marks logs as current`, await page.$eval(navSel, (a) => a.classList.contains('ps-current')));
  let L = await lines(page);
  t(`${tag} A3 two entries: the socket opening, then the six-root push, newest first`, L.length === 2 && L[1] === T.open && L[0] === `${T.in} wifi, sta, ap, printer, settings, block`, L);
  t(`${tag} A4 every line carries a clock stamp`, (await text(page, 'ps-logs-list')).split('\n').every((l) => /^\d\d:\d\d:\d\d\.\d\d\d  /.test(l)));
  t(`${tag} A5 the count reads 2 / 200`, (await text(page, 'ps-logs-count')) === '2 / 200', await text(page, 'ps-logs-count'));
  t(`${tag} A6 the push's Wi-Fi password is not in the page`, !(await page.content()).includes('<WIFI_PASSWORD>'));
  t(`${tag} A7 nothing sent by merely loading the page`, (await sent()).length === 0);
  await pw.shot(page, `logs-${combo.theme}-${combo.width}`);

  // ---- B. an outbound frame from another page ----
  t(`${tag} B1 to lighting`, await navTo(page, combo, 'lighting'));
  await $(page, 'ps-lighting-brightness').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
  await page.waitForFunction(() => PS.state.settings.list2[1].brightness === 55, null, { timeout: 2000 }).catch(() => {});
  t(`${tag} B2 back to logs`, await navTo(page, combo, 'logs'));
  L = await lines(page);
  t(`${tag} B3 the frame is logged with its members, then the device's echo, newest first`, L[1] === `${T.out} settings {"rgb_info_brightness":55,"device_wakeup":1}` && L[0] === `${T.in} wifi, sta, ap, printer, settings, block` && L.length === 4, L);

  // ---- C. a credential goes out: the log keeps its length, never its value ----
  t(`${tag} C1 to network`, await navTo(page, combo, 'network'));
  await $(page, 'ps-network-connect-ssid').fill('<SCAN_SSID_A>');
  await $(page, 'ps-network-connect-password').fill('<WIFI_PASSWORD>');
  await pw.tap(page, '#ps-network-connect-send');
  await page.waitForFunction(() => PS.state.sta.state === 3 && PS.state.wifi.ssid === '<SCAN_SSID_A>', null, { timeout: 3000 }).catch(() => {});
  t(`${tag} C2 back to logs`, await navTo(page, combo, 'logs'));
  L = await lines(page);
  const outLine = L.find((l) => l.startsWith(`${T.out} wifi`));
  t(`${tag} C3 the connect frame shows the ssid and the password's length only`, outLine === `${T.out} wifi {"ssid":"<SCAN_SSID_A>","password":"(15 chars)","device_wakeup":1}`, outLine);
  t(`${tag} C4 the password value is nowhere in the page`, !(await page.content()).includes('<WIFI_PASSWORD>'));
  t(`${tag} C5 the ring is the core's, so the value is not in memory either`, !JSON.stringify(await page.evaluate(() => PS.log)).includes('<WIFI_PASSWORD>'));

  // ---- D. a response entry ----
  t(`${tag} D1 to network`, await navTo(page, combo, 'network'));
  await $(page, 'ps-network-ap-ssid').fill('<AP_SSID_NEW>');
  await pw.tap(page, '#ps-network-ap-send');
  await page.waitForFunction(() => PS.log.some((e) => e.kind === 'response'), null, { timeout: 3000 }).catch(() => {});
  t(`${tag} D2 back to logs`, await navTo(page, combo, 'logs'));
  L = await lines(page);
  t(`${tag} D3 the device's answer is logged by type and outcome`, L.includes(`${T.response} set_ap ${T.ok}`), L.filter((l) => l.startsWith(T.response)));
  t(`${tag} D4 the hotspot password went out as a length`, L.some((l) => l.startsWith(`${T.out} ap `) && l.includes('"password":"(13 chars)"')) && !(await page.content()).includes('<AP_PASSWORD>'), L.filter((l) => l.startsWith(`${T.out} ap`)));
  await page.evaluate(() => window.scrollTo(0, 0));
  await pw.shot(page, `logs-${combo.theme}-${combo.width}-after-drive`);

  // ---- E. copy and clear ----
  await pw.tap(page, '#ps-logs-copy');
  t(`${tag} E1 copy puts the list on the clipboard and says so`, await page.waitForFunction((w) => document.getElementById('ps-toast').textContent === w, T.copied, { timeout: 2000 }).then(() => true).catch(() => false) && (await page.evaluate(() => navigator.clipboard.readText())) === (await text(page, 'ps-logs-list')));
  await pw.tap(page, '#ps-logs-clear');
  t(`${tag} E2 clear empties the list and the count`, (await text(page, 'ps-logs-list')) === '' && (await text(page, 'ps-logs-count')) === '0 / 200');
  t(`${tag} E3 copy and clear sent nothing`, (await sent()).filter((r) => !r.text.includes('rgb_info_brightness') && !r.text.includes('"wifi"') && !r.text.includes('"ap"')).length === 0);

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
