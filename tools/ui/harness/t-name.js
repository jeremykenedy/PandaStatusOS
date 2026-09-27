#!/usr/bin/env node
'use strict';
/*
 * D-060, the two names. The Settings card's Device name is a label: saved as
 * settings.device_name, answered with a toast, shown in the bar above, given to the vent
 * bridge, and it never touches the hostname or restarts anything. The Network page's Host
 * name is the address: saving it restarts the device, and the dialog says the address the
 * device will answer at afterwards.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-name.js PS_CLONE=1
 */
const { chromium } = require('playwright');
const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async () => (await fetch(`${BASE}/__state`)).json();
/* the mock's own log (run.sh points PS_LOG at it): a restart is an event in it, not a state */
const restarted = () => { try { return require('fs').readFileSync(process.env.PS_LOG, 'utf8').split('\n').filter((l) => /"ev":"restart"/.test(l)).length; } catch (e) { return -1; } };
async function waitFor(page, body, ms = 3000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function tap(page, sel) { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); }
const text = (page, id) => page.$eval('#' + id, (e) => e.textContent.trim());
const val = (page, id) => page.$eval('#' + id, (e) => e.value);

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
    const host0 = (await state()).sta.hostname;

    // ---- A. what a device shows before anyone names it ----
    t('A1 the bar shows the default label, not the hostname', await waitFor(page, "document.getElementById('ps-top-name').textContent === 'Panda Status'"), await text(page, 'ps-top-name'));
    await page.evaluate(() => show_card('settings'));
    t('A2 and the Device name field holds the same', await waitFor(page, "document.getElementById('ps-settings-device-name').value === 'Panda Status'"), await val(page, 'ps-settings-device-name'));

    // ---- B. saving a label ----
    await page.fill('#ps-settings-device-name', 'Panda Status Two');
    await tap(page, '#ps-btn-device-name-set');
    t('B1 the device stores it under settings.device_name', await (async () => { for (let i = 0; i < 20; i++) { if ((await state()).settings.device_name === 'Panda Status Two') return true; await sleep(100); } return false; })(), (await state()).settings.device_name);
    t('B2 the hostname is exactly what it was', (await state()).sta.hostname === host0, (await state()).sta.hostname);
    t('B3 the page says the name was saved, in a toast, not a restart dialog', await waitFor(page, "document.getElementById('ps-toast') && /Name saved/.test(document.getElementById('ps-toast').textContent) && !document.getElementById('ps-dialog').open"), await text(page, 'ps-toast'));
    t('B4 the bar follows, from the push', await waitFor(page, "document.getElementById('ps-top-name').textContent === 'Panda Status Two'"), await text(page, 'ps-top-name'));
    t('B5 nothing restarted', !restarted(), restarted());

    // ---- C. an empty save is refused on the page ----
    await page.fill('#ps-settings-device-name', '   ');
    await tap(page, '#ps-btn-device-name-set');
    await sleep(300);
    t('C1 blank is not sent: the device keeps the name', (await state()).settings.device_name === 'Panda Status Two', (await state()).settings.device_name);
    t('C2 and says so', await waitFor(page, "/Enter a name first/.test(document.getElementById('ps-toast').textContent)"), await text(page, 'ps-toast'));

    // ---- D. reset asks, then puts the default back ----
    await tap(page, '#ps-btn-device-name-reset');
    t('D1 reset asks first', await waitFor(page, "document.getElementById('ps-dialog').open && /default name/.test(document.getElementById('ps-dialog-text').textContent)"), await text(page, 'ps-dialog-text'));
    await page.click('#ps-dialog button:has-text("Yes")');
    t('D2 yes sends the word default and the device shows the default again', await (async () => { for (let i = 0; i < 20; i++) { const s = await state(); if (s.settings.device_name === '' ) return true; await sleep(100); } return false; })(), (await state()).settings.device_name);
    t('D3 the bar is back to the default', await waitFor(page, "document.getElementById('ps-top-name').textContent === 'Panda Status'"), await text(page, 'ps-top-name'));
    t('D4 and the field too', await waitFor(page, "document.getElementById('ps-settings-device-name').value === 'Panda Status'"), await val(page, 'ps-settings-device-name'));

    // ---- E. the host name is the other thing: its dialog names the address to come ----
    await page.evaluate(() => show_card('sta'));
    await page.fill('#ps-sta-hostname', 'Bench Two');
    await tap(page, '#ps-btn-set-hostname');
    t('E1 the host name dialog opens', await waitFor(page, "document.getElementById('ps-dialog').open"));
    t('E2 and says the address the device will answer at, one label, lower case', await waitFor(page, "/http:\\/\\/bench-two\\.local\\//.test(document.getElementById('ps-dialog-text').textContent)"), await text(page, 'ps-dialog-text'));
    t('E3 with the address it keeps', /192\.0\.2\.10/.test(await text(page, 'ps-dialog-text')), await text(page, 'ps-dialog-text'));
    t('E4 the device stored the host name as typed; it makes its own label', (await state()).sta.hostname === 'Bench Two', (await state()).sta.hostname);
    t('E5 and the label stayed the label', (await state()).settings.device_name === '', (await state()).settings.device_name);
    t('E6 the host name, not the label, is the one that restarts: nothing has yet, the dialog asks first', restarted() === 0, restarted());
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });

    t('F1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
