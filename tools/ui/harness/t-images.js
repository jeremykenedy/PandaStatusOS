#!/usr/bin/env node
'use strict';
/*
 * The stage images card on a unit that HAS somewhere to put an image. The zero case, which
 * is what this hardware actually reports, is covered in t-stages.js; this run drives the
 * other branch with the mock's PS_IMG_SLOT_BYTES knob.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-images.js PS_CLONE=1 PS_IMG_SLOT_BYTES=98304
 */

const { chromium } = require('playwright');
const crypto = require('crypto');

const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;
const CAP = Number(process.env.PS_IMG_SLOT_BYTES || 98304);

// the smallest GIF there is: GIF89a, 1x1, one colour
const GIF = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

let pass = 0, fail = 0;
const t = (name, ok, got) => { if (ok) { pass++; console.log(`  ok    ${name}`); } else { fail++; console.log(`  FAIL  ${name}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mockState = async () => (await fetch(`${BASE}/__state`)).json();
const text = (page, id) => page.$eval('#' + id, (e) => e.textContent);

async function waitFor(page, body, ms = 4000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function waitMock(pred, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred(await mockState())) return true; await sleep(40); }
  return false;
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [], netErrors = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
    page.on('console', (m) => { if (m.type() === 'error') (m.text().startsWith('Failed to load resource') ? netErrors : errors).push(m.text()); });
    const reqs = [];
    page.on('request', (r) => { if (new URL(r.url()).pathname === '/ota') reqs.push({ method: r.method(), headers: r.headers() }); });

    await page.goto(BASE + '/');
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('theme'));

    t('A1 the card is up, because the device reported a slot size', await waitFor(page, "!document.getElementById('ps-img-card').hidden"));
    t('A2 no note: there is nothing to explain away', (await text(page, 'ps-img-note')) === '');
    t('A3 fifteen slots, in the firmware\'s order',
      await waitFor(page, "document.querySelectorAll('#ps-img-list > li').length === 15"),
      await page.$$eval('#ps-img-list > li', (e) => e.length));
    t('A4 every slot takes a GIF and nothing else',
      await page.$$eval('#ps-img-list input[type=file]', (els) => els.length === 15 && els.every((e) => e.accept === 'image/gif')));
    t('A5 every slot starts with no preview and no progress',
      await page.$$eval('#ps-img-list > li', (els) => els.every((e) => e.querySelector('img').hidden && e.querySelector('progress').hidden)));
    t('A6 loading the page sent nothing to /ota', reqs.length === 0);

    // ---- one upload, the exact request ----
    await page.setInputFiles('#ps-img-file-standby', { name: 'standby.gif', mimeType: 'image/gif', buffer: GIF });
    t('B1 the device received the bytes for the standby slot',
      await waitMock((s) => s.__mock.gif_uploads && s.__mock.gif_uploads.standby === GIF.length),
      (await mockState()).__mock.gif_uploads);
    await sleep(200);
    t('B2 exactly one request, a POST to /ota', reqs.length === 1 && reqs[0].method === 'POST', reqs.map((r) => r.method));
    t('B3 OTA-Type is the slot name, which is how the device knows where it goes',
      reqs[0] && reqs[0].headers['ota-type'] === 'standby', reqs[0] && reqs[0].headers['ota-type']);
    t('B4 Content-Type is the one the firmware reads',
      reqs[0] && reqs[0].headers['content-type'] === 'application/octet-stream;charset=UTF-8', reqs[0] && reqs[0].headers['content-type']);
    t('B5 the body is the file, byte for byte (sha256 at the receiving end)',
      (await mockState()).__mock.gif_sha256.standby === sha(GIF), (await mockState()).__mock.gif_sha256);
    t('B6 the chosen file is previewed in this browser',
      await page.$eval('#ps-img-preview-standby', (i) => !i.hidden && i.src.startsWith('blob:')));
    t('B7 the slot is marked accepted only once the socket said so',
      await waitFor(page, "document.getElementById('ps-img-status-standby').textContent === tr('ui_upload_ok','')"),
      await text(page, 'ps-img-status-standby'));
    t('B8 the progress bar is put away', await page.$eval('#ps-img-progress-standby', (e) => e.hidden));

    // ---- a second slot, so the header is not a constant ----
    await page.setInputFiles('#ps-img-file-printing-ok', { name: 'done.gif', mimeType: 'image/gif', buffer: GIF });
    t('C1 printing_ok goes up under its own name',
      await waitMock((s) => s.__mock.gif_uploads && s.__mock.gif_uploads.printing_ok === GIF.length));
    await sleep(200);
    t('C2 the second request carries its own OTA-Type', reqs.length === 2 && reqs[1].headers['ota-type'] === 'printing_ok', reqs.map((r) => r.headers['ota-type']));
    t('C3 standby\'s line is untouched by another slot\'s answer',
      (await text(page, 'ps-img-status-standby')) === (await page.evaluate(() => tr('ui_upload_ok', ''))));

    // ---- over the cap: refused here, so the device is never asked ----
    const before = reqs.length;
    await page.setInputFiles('#ps-img-file-printing', { name: 'huge.gif', mimeType: 'image/gif', buffer: Buffer.alloc(CAP + 1, 0) });
    await sleep(400);
    t('D1 a file over the device\'s own limit is refused before any request, and the limit is named',
      /\d/.test(await text(page, 'ps-img-status-printing')) && reqs.length === before,
      { line: await text(page, 'ps-img-status-printing'), reqs: reqs.length });
    t('D2 nothing is previewed for a file that was never sent', await page.$eval('#ps-img-preview-printing', (i) => i.hidden));

    t('E1 no page errors, no console errors', errors.length === 0, errors);
    t('E2 no network errors', netErrors.length === 0, netErrors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally {
    await browser.close();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
