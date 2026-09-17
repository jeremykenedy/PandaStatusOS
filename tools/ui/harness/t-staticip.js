#!/usr/bin/env node
'use strict';
/*
 * C9, the fixed address. Off, on, refused, and cleared, driven the way a person drives it
 * and asserted at the device end.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-staticip.js PS_CLONE=1
 */
const { chromium } = require('playwright');
const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const feats = async () => (await fetch(`${BASE}/api/features`)).json();
const post = (b) => fetch(`${BASE}/api/features`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const text = (p, id) => p.$eval('#' + id, (e) => e.textContent);
const val = (p, id) => p.$eval('#' + id, (e) => e.value);
async function waitFor(page, body, ms = 3000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function tap(page, sel) { await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await page.click(sel); }

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
    await page.evaluate(() => show_card('sta'));

    // ---- A. off by default, and the card is not there ----
    t('A1 the card is away while the switch is off', await page.$eval('#ps-sip-card', (e) => e.hidden));
    t('A2 the device says the address is off and empty', (await feats()).config.static_ip.on === 0);

    // ---- B. the switch under Features brings the card up ----
    await post({ features: { static_ip: true } });
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('sta'));
    t('B1 the card appears', await waitFor(page, "!document.getElementById('ps-sip-card').hidden"));
    t('B2 every box starts empty, because nothing is stored', (await val(page, 'ps-sip-ip')) === '' && (await val(page, 'ps-sip-gw')) === '');
    t('B3 the switch inside the card starts off', (await page.$eval('#ps-sip-on', (e) => e.checked)) === false);

    // ---- C. a whole address, saved ----
    await page.fill('#ps-sip-ip', '192.168.9.50');
    await page.fill('#ps-sip-gw', '192.168.9.1');
    await page.fill('#ps-sip-dns', '192.168.9.1');
    await tap(page, '#ps-sip-on');
    await tap(page, '#ps-sip-save');
    await sleep(400);
    const c = (await feats()).config.static_ip;
    t('C1 the device holds the address that was typed', c.ip === '192.168.9.50' && c.gw === '192.168.9.1' && c.dns === '192.168.9.1', c);
    t('C2 the switch is on, because there is an address to apply', c.on === 1, c);
    t('C3 a blank mask became /24 rather than nothing', c.mask === '255.255.255.0', c);
    t('C4 the page shows the mask the device filled in',
      await waitFor(page, "document.getElementById('ps-sip-mask').value === '255.255.255.0'"), await val(page, 'ps-sip-mask'));

    // ---- D. nonsense is refused whole, and said so ----
    await page.fill('#ps-sip-ip', '192.168.9.999');
    await tap(page, '#ps-sip-save');
    await sleep(500);
    const d = (await feats()).config.static_ip;
    t('D1 nothing changed on the device', d.ip === '192.168.9.50', d);
    t('D2 the page says it was refused rather than leaving it looking saved',
      (await text(page, 'ps-sip-note')) === (await page.evaluate(() => tr('ui_address_refused', ''))), await text(page, 'ps-sip-note'));
    t('D3 the box is put back to what the device holds',
      await waitFor(page, "document.getElementById('ps-sip-ip').value === '192.168.9.50'"), await val(page, 'ps-sip-ip'));

    // ---- E. one field cleared without the switch going off ----
    await page.fill('#ps-sip-dns', '');
    await tap(page, '#ps-sip-save');
    await sleep(400);
    const e = (await feats()).config.static_ip;
    t('E1 the DNS server is cleared', e.dns === '', e);
    t('E2 the address and the switch are untouched', e.ip === '192.168.9.50' && e.on === 1, e);

    // ---- F. no address means the device will not take itself off DHCP ----
    await page.fill('#ps-sip-ip', '');
    await tap(page, '#ps-sip-save');
    await sleep(400);
    const f = (await feats()).config.static_ip;
    t('F1 with no address the device turns the switch off itself', f.on === 0 && f.ip === '', f);
    t('F2 the page follows the device, not the click',
      await waitFor(page, "document.getElementById('ps-sip-on').checked === false"),
      await page.$eval('#ps-sip-on', (x) => x.checked));

    // ---- G. the switch going off hides the card again ----
    await post({ features: { static_ip: false } });
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const dd = document.getElementById('ps-dialog'); if (dd && dd.open) dd.close(); });
    await page.evaluate(() => show_card('sta'));
    t('G1 the card is away again', await waitFor(page, "document.getElementById('ps-sip-card').hidden"));

    t('H1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
