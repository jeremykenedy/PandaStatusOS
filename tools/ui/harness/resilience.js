#!/usr/bin/env node
'use strict';
/*
 * Resilience harness. One scenario per sweep row, chosen by the mock knob in the row's
 * env, so every lie the page must survive is written in the table:
 *
 *   PS_DROP_AFTER=1500           socket loss: the lost-device dialog, Reload reconnects,
 *                                and a send while the socket is down shows the dialog
 *                                again and reaches nothing
 *   PS_MALFORMED=1               a frame that is not JSON: ignored, state intact, logged
 *   PS_UNKNOWN_ENUM=1            sta.state 9 and printer.scan 42: rendered as unknown
 *                                with the value, nothing throws
 *   PS_DELAY=2500                cold start: the waiting banner until the push lands
 *   PS_NO_PUSH=1                 a device that never speaks: waiting, forever, quietly
 *   PS_PRINTER_OFFLINE_AFTER=1000  the printer link drops: pill and dashboard follow
 *   PS_SLOW=800                  every push late: the page does not fight the user
 *
 * No knob: the baseline, which every scenario shares (state arrives, no errors).
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json resilience.js PS_DROP_AFTER=1500
 */

const pw = require('./pw');
const { t, frame, sentAfter, sent, resetMock } = pw;

const E = process.env;
const SCENARIO = ['PS_DROP_AFTER', 'PS_MALFORMED', 'PS_UNKNOWN_ENUM', 'PS_DELAY', 'PS_NO_PUSH', 'PS_PRINTER_OFFLINE_AFTER', 'PS_SLOW'].find((k) => E[k]) || 'baseline';
const COMBOS = [{ theme: 'light', width: 1280 }, { theme: 'dark', width: 390 }];
const $ = (page, id) => page.locator('#' + id);
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
const waiting = (page) => page.evaluate(() => document.body.classList.contains('ps-waiting'));
const dialogTitle = (page) => page.evaluate(() => document.getElementById('ps-dialog').open ? document.getElementById('ps-dialog-title').textContent : null);
async function waitDialog(page, title, ms = 5000) {
  return page.waitForFunction((w) => document.getElementById('ps-dialog').open && document.getElementById('ps-dialog-title').textContent === w, title, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
const waitState = (page, ms = 6000) => page.waitForFunction(() => !document.body.classList.contains('ps-waiting'), null, { timeout: ms }).then(() => true).catch(() => false);

async function drive(browser, combo) {
  const tag = `${SCENARIO} ${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#dashboard', waitForState: false });
  const lost = await tr(page, 'ps_core_lost_title'), reload = await tr(page, 'ps_core_reload');

  if (SCENARIO === 'PS_NO_PUSH') {
    await pw.sleep(3000);
    t(`${tag} A1 three seconds in, still waiting: banner shown, content dimmed and inert`, await waiting(page) && await page.locator('#ps-banner-waiting').isVisible() && (await page.$eval('#ps-card-dashboard .ps-needs-state', (e) => getComputedStyle(e).pointerEvents)) === 'none');
    t(`${tag} A2 no dialog, no errors: quiet`, (await dialogTitle(page)) === null && errors.length === 0, errors);
    t(`${tag} A3 nothing sent`, (await sent()).length === 0);
    await pw.shot(page, `resilience-waiting-${combo.theme}-${combo.width}`);
    await ctx.close(); return;
  }

  if (SCENARIO === 'PS_DELAY') {
    await pw.sleep(1200);
    t(`${tag} A1 1.2 s in, waiting: banner shown, controls inert`, await waiting(page) && await page.locator('#ps-banner-waiting').isVisible());
    t(`${tag} A2 the push lands late and the page wakes`, await waitState(page) && !(await page.locator('#ps-banner-waiting').isVisible()) && (await page.$eval('#ps-card-dashboard .ps-needs-state', (e) => getComputedStyle(e).pointerEvents)) !== 'none');
  } else {
    t(`${tag} A1 the state arrives`, await waitState(page));
  }
  t(`${tag} A2b dashboard shows the printer name`, (await text(page, 'ps-dashboard-printer-name')) === 'Mock P2S');

  if (SCENARIO === 'PS_MALFORMED') {
    await pw.sleep(400);
    t(`${tag} B1 the non-JSON frame is ignored: state intact, no dialog`, (await page.evaluate(() => PS.state.settings.current_mode)) === 1 && (await dialogTitle(page)) === null);
    t(`${tag} B2 it is on the log as a bad frame with its byte count`, await page.evaluate(() => PS.log.some((e) => e.kind === 'bad' && e.bytes > 0)));
    let n = (await sent()).length;
    await page.evaluate(() => { location.hash = '#lighting'; }); await pw.waitCard(page, 'lighting');
    await $(page, 'ps-lighting-brightness').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
    const got = await sentAfter(n);
    t(`${tag} B3 the page still works afterwards: a control sends its frame`, got.length === 1 && got[0] === frame('settings', { rgb_info_brightness: 55 }), got);
  }

  if (SCENARIO === 'PS_UNKNOWN_ENUM') {
    const unk = await tr(page, 'ps_dashboard_unknown_state');
    t(`${tag} B1 sta.state 9 renders as unknown with its value on the dashboard`, (await text(page, 'ps-dashboard-network-state')) === `${unk} 9`, await text(page, 'ps-dashboard-network-state'));
    await page.evaluate(() => { location.hash = '#network'; }); await pw.waitCard(page, 'network');
    t(`${tag} B2 and on the network page, with a plain dot`, (await text(page, 'ps-network-state')) === `${unk} 9` && (await page.$eval('#ps-network-dot', (e) => e.className)) === 'ps-dot');
    await page.evaluate(() => { location.hash = '#printer'; }); await pw.waitCard(page, 'printer');
    t(`${tag} B3 printer.scan 42 renders as unknown with its value; scan still enabled`, (await text(page, 'ps-printer-scan-state')) === `${unk} 42` && !(await $(page, 'ps-printer-scan').isDisabled()), await text(page, 'ps-printer-scan-state'));
  }

  if (SCENARIO === 'PS_PRINTER_OFFLINE_AFTER') {
    t(`${tag} B1 the pill starts connected`, (await text(page, 'ps-topbar-pill')) === (await tr(page, 'ps_dashboard_pill_ready')));
    t(`${tag} B2 the link drops: pill says connecting, dashboard dot warns`, await page.waitForFunction((w) => document.getElementById('ps-topbar-pill').textContent === w, await tr(page, 'ps_dashboard_pill_connecting'), { timeout: 4000 }).then(() => true).catch(() => false) && (await page.$eval('#ps-dashboard-printer-dot', (e) => e.className)) === 'ps-dot ps-dot-warn');
  }

  if (SCENARIO === 'PS_SLOW') {
    await page.evaluate(() => { location.hash = '#lighting'; }); await pw.waitCard(page, 'lighting');
    const n = (await sent()).length;
    await $(page, 'ps-lighting-brightness').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
    const got = await sentAfter(n);
    t(`${tag} B1 the frame goes out at once`, got.length === 1 && got[0] === frame('settings', { rgb_info_brightness: 55 }), got);
    await pw.sleep(200);
    t(`${tag} B2 before the late echo the slider keeps the user's value`, (await page.$eval('#ps-lighting-brightness', (e) => e.value)) === '55' && (await text(page, 'ps-lighting-brightness-value')) === '55%');
    t(`${tag} B3 the echo lands late and agrees`, await page.waitForFunction(() => PS.state.settings.list2[1].brightness === 55, null, { timeout: 4000 }).then(() => true).catch(() => false) && (await page.$eval('#ps-lighting-brightness', (e) => e.value)) === '55');
  }

  if (SCENARIO === 'PS_DROP_AFTER') {
    t(`${tag} B1 the socket drops and the lost-device dialog appears, with Reload`, await waitDialog(page, lost) && (await text(page, 'ps-dialog-ok')) === reload);
    t(`${tag} B2 the dashboard keeps showing the last state behind it`, (await text(page, 'ps-dashboard-printer-name')) === 'Mock P2S');
    await page.keyboard.press('Escape');
    t(`${tag} B3 Escape dismisses it without reloading`, (await dialogTitle(page)) === null && (await page.evaluate(() => PS.connected)) === false);
    await page.evaluate(() => { location.hash = '#lighting'; }); await pw.waitCard(page, 'lighting');
    const before = (await sent()).length;
    await $(page, 'ps-lighting-brightness').focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Tab');
    await pw.sleep(300);
    t(`${tag} B4 a control used while the socket is down: nothing reaches the device, the dialog is back`, (await sent()).length === before && (await dialogTitle(page)) === lost);
    t(`${tag} B5 the loss is on the log`, await page.evaluate(() => PS.log.some((e) => e.kind === 'close')));
    await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 5000 }).catch(() => null), $(page, 'ps-dialog-ok').click()]);
    t(`${tag} B6 Reload reloads the page and the device speaks again`, await waitState(page) && (await text(page, 'ps-dashboard-printer-name')) === 'Mock P2S');
    t(`${tag} B7 the mock saw two connections`, (await pw.pushed()).filter((p) => p.why === 'connect').length >= 2);
  }

  t(`${tag} Z1 no page errors, no console errors`, errors.length === 0, errors);
  t(`${tag} Z2 no network errors`, netErrors.length === 0, netErrors);
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
