#!/usr/bin/env node
'use strict';
/*
 * Images page harness. Behaviour only: choose a file for a slot the way a person does and
 * assert the exact HTTP request the device receives (method, path, the two headers, the
 * body bytes), then the page's reaction to the device's answer on the socket.
 *
 * Fixture facts (p2-idle.json): settings.img_version "V1.0.0" is present in the fixture
 * but the mock withholds it unless PS_IMG_VERSION=1, as the device did. __mock.ws_theme
 * previews "standby" and lists a colour per slot; the mock pushes it only under
 * PS_THEME_ON_CONNECT=1. PS_OTA_REFUSE=1 makes every upload fail with ok:0.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json page-images.js
 *       tools/ui/harness/run.sh p2-idle.json page-images.js PS_OTA_REFUSE=1
 *       tools/ui/harness/run.sh p2-idle.json page-images.js PS_IMG_VERSION=1
 *       tools/ui/harness/run.sh p2-idle.json page-images.js PS_THEME_ON_CONNECT=1
 */

const pw = require('./pw');
const { t, sent, resetMock } = pw;
const fs = require('fs');
const crypto = require('crypto');

const REFUSE = process.env.PS_OTA_REFUSE === '1';
const IMGVER = process.env.PS_IMG_VERSION === '1';
const THEME = process.env.PS_THEME_ON_CONNECT === '1';
const CAP = 0x180000;
// the smallest GIF there is: GIF89a, 1x1, one colour
const GIF = Buffer.from('47494638396101000100800000000000ffffff21f90401000000002c00000000010001000002024401003b', 'hex');
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];
const SLOTS = ['standby', 'nozzle_heating', 'bed_heating', 'bed_leveling', 'homing', 'nozzle_cleaning',
  'calibrating_flow', 'xy_mesh_mode_sweep', 'filament_check_location', 'filament_cut',
  'filament_pull_back_cur', 'filament_push_new', 'filament_purge_old', 'printing_ok', 'printing'];

const idOf = (s) => s.replace(/_/g, '-');
const text = (page, id) => page.$eval('#' + id, (el) => el.textContent);
const tr = (page, key) => page.evaluate((k) => PS.tr(k), key);
async function waitText(page, id, want, ms = 3000) {
  return page.waitForFunction(([i, w]) => document.getElementById(i).textContent === w, [id, want], { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
async function waitMock(fnBody, ms = 3000) {
  const f = new Function('s', fnBody); const end = Date.now() + ms;
  while (Date.now() < end) { if (f(await pw.mockState())) return true; await pw.sleep(40); }
  return false;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
// what the mock logged about uploads (run.sh points PS_LOG at a fresh file per run)
function mockLog(ev) {
  try { return fs.readFileSync(process.env.PS_LOG, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.ev === ev); } catch (_) { return []; }
}
function choose(page, slot, buffer, name) {
  return page.setInputFiles('#ps-images-file-' + idOf(slot), { name: name || slot + '.gif', mimeType: 'image/gif', buffer });
}

async function drive(browser, combo) {
  const tag = `${combo.theme}/${combo.width}`;
  console.log(`\n== ${tag}`);
  await resetMock();
  const { ctx, page, errors, netErrors } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#images' });
  const reqs = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/ota') reqs.push({ method: r.method(), headers: r.headers(), body: r.postDataBuffer() }); });

  // ---- A. up, on the right card, fifteen slots ----
  t(`${tag} A1 images card visible, every other card hidden`, await pw.waitCard(page, 'images'));
  const navSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="images"]' : '#ps-bottombar a[data-ps-nav="images"]';
  t(`${tag} A2 the visible nav marks images as current`, await page.$eval(navSel, (a) => a.classList.contains('ps-current')));
  const slots = await page.$$eval('[data-ps-slot]', (els) => els.map((e) => e.getAttribute('data-ps-slot')));
  t(`${tag} A3 fifteen slots, in the device's order`, JSON.stringify(slots) === JSON.stringify(SLOTS), slots);
  t(`${tag} A4 every slot has its file input accepting GIF only`, await page.$$eval('[data-ps-upload]', (els) => els.length === 15 && els.every((e) => e.type === 'file' && e.accept === 'image/gif')));
  t(`${tag} A5 every slot starts idle with no preview`, await page.$$eval('[data-ps-slot]', (els) => els.every((e) => e.querySelector('img').hidden && e.querySelector('progress').hidden)));
  t(`${tag} A6 image pack version ${IMGVER ? 'shown (mock knob PS_IMG_VERSION)' : 'unset, rendered as a dash'}`, (await text(page, 'ps-images-version')) === (IMGVER ? 'V1.0.0' : '—'), await text(page, 'ps-images-version'));
  if (THEME) {
    t(`${tag} A7 ws_theme.preview marks the standby slot as showing now`, await page.waitForFunction(() => document.getElementById('ps-images-slot-standby').classList.contains('ps-images-slot-showing'), null, { timeout: 2000 }).then(() => true).catch(() => false));
    t(`${tag} A7b the showing line names the slot`, !(await page.$eval('#ps-images-showing', (e) => e.hidden)) && (await text(page, 'ps-images-showing')) === (await tr(page, 'ps_images_showing')) + ' ' + (await tr(page, 'ps_images_slot_standby')), await text(page, 'ps-images-showing'));
    t(`${tag} A7c ws_theme.list colours the slot dots`, await page.$eval('#ps-images-dot-standby', (e) => !e.hidden && e.style.background !== ''));
  } else {
    t(`${tag} A7 no ws_theme: no showing line, no dots`, await page.$eval('#ps-images-showing', (e) => e.hidden) && await page.$$eval('[id^="ps-images-dot-"]', (els) => els.every((e) => e.hidden)));
  }
  t(`${tag} A8 nothing sent by merely loading the page`, (await sent()).length === 0 && reqs.length === 0);
  await pw.shot(page, `images-${combo.theme}-${combo.width}`);
  await pw.shot(page, `images-${combo.theme}-${combo.width}`, { full: true });

  // ---- B. one upload, the exact request ----
  await choose(page, 'standby', GIF);
  t(`${tag} B1 the device receives ${GIF.length} bytes for the standby slot${REFUSE ? ' (refused by knob, still received)' : ''}`,
    REFUSE ? await waitMock('return true') : await waitMock(`return s.__mock.gif_uploads.standby === ${GIF.length}`), (await pw.mockState()).__mock.gif_uploads);
  await pw.sleep(150);
  t(`${tag} B2 exactly one request: POST /ota`, reqs.length === 1 && reqs[0].method === 'POST', reqs.map((r) => r.method));
  const r0 = reqs[0] || { headers: {} };
  t(`${tag} B3 OTA-Type header is the slot name`, r0.headers['ota-type'] === 'standby', r0.headers['ota-type']);
  t(`${tag} B4 Content-Type is application/octet-stream;charset=UTF-8`, r0.headers['content-type'] === 'application/octet-stream;charset=UTF-8', r0.headers['content-type']);
  // Playwright does not expose a Blob request body, so the bytes are proven at the receiving
  // end: the mock hashes every accepted upload; a refused one is logged with its byte count
  if (REFUSE) t(`${tag} B5 the mock logged the refusal with the full byte count`, mockLog('ota_refused').some((r) => r.detail === `standby ${GIF.length}B`), mockLog('ota_refused').map((r) => r.detail));
  else t(`${tag} B5 the body is the file, byte for byte (sha256 at the mock)`, (await pw.mockState()).__mock.gif_sha256.standby === sha(GIF), (await pw.mockState()).__mock.gif_sha256);
  t(`${tag} B6 the chosen file is previewed in this browser`, await page.$eval('#ps-images-preview-standby img', (i) => !i.hidden && i.src.startsWith('blob:')));
  const want = await tr(page, REFUSE ? 'ps_images_status_refused' : 'ps_images_status_ok');
  t(`${tag} B7 the device's socket answer sets the slot status: ${REFUSE ? 'refused' : 'accepted'}`, await waitText(page, 'ps-images-status-standby', want), await text(page, 'ps-images-status-standby'));
  t(`${tag} B7b the status line's key follows it, so a language switch keeps it`, (await page.$eval('#ps-images-status-standby', (e) => e.getAttribute('data-ps-str'))) === (REFUSE ? 'ps_images_status_refused' : 'ps_images_status_ok'));
  t(`${tag} B8 the progress bar is put away`, await page.$eval('#ps-images-progress-standby', (e) => e.hidden));
  t(`${tag} B9 the response never touches the merged state, nothing sent on the socket`, (await sent()).length === 0);
  t(`${tag} B10 the top-bar pill survives a response-only frame`, (await text(page, 'ps-topbar-pill')) === (await tr(page, 'ps_dashboard_pill_ready')), await text(page, 'ps-topbar-pill'));

  // ---- C. a second slot, so the header is not a constant ----
  await choose(page, 'printing_ok', GIF, 'done.gif');
  t(`${tag} C1 printing_ok reaches the device under its own name`, REFUSE ? await waitMock('return true') : await waitMock(`return s.__mock.gif_uploads.printing_ok === ${GIF.length}`));
  await pw.sleep(150);
  t(`${tag} C2 second request carries OTA-Type printing_ok`, reqs.length === 2 && reqs[1].headers['ota-type'] === 'printing_ok', reqs.map((r) => r.headers['ota-type']));
  t(`${tag} C3 standby's status is untouched by printing_ok's answer`, (await text(page, 'ps-images-status-standby')) === want);

  // ---- D. too big: refused in the browser, no request ----
  const before = reqs.length;
  await choose(page, 'printing', Buffer.alloc(CAP + 1, 0), 'huge.gif');
  await pw.sleep(300);
  const tooBig = (await tr(page, 'ps_images_status_too_big')).replace('{limit}', '1.5 MB');
  t(`${tag} D1 a file over 0x180000 bytes is refused before any request, naming the limit in MB`, (await text(page, 'ps-images-status-printing')) === tooBig && reqs.length === before, { status: await text(page, 'ps-images-status-printing'), reqs: reqs.length });
  t(`${tag} D2 no preview for a refused file`, await page.$eval('#ps-images-preview-printing img', (i) => i.hidden));
  const atCap = Buffer.alloc(CAP, 0);
  await choose(page, 'homing', atCap, 'atcap.gif');
  t(`${tag} D3 a file of exactly 0x180000 bytes is sent`, REFUSE ? await waitMock('return true', 6000) : await waitMock(`return s.__mock.gif_uploads.homing === ${CAP}`, 6000), (await pw.mockState()).__mock.gif_uploads.homing);
  await pw.sleep(200);
  t(`${tag} D3b that request carried the whole file`, reqs.length === before + 1 && reqs[before].headers['ota-type'] === 'homing' && (REFUSE ? mockLog('ota_refused').some((r) => r.detail === `homing ${CAP}B`) : (await pw.mockState()).__mock.gif_sha256.homing === sha(atCap)), reqs.length);

  await page.evaluate(() => window.scrollTo(0, 0));
  await pw.shot(page, `images-${combo.theme}-${combo.width}-after-drive`);

  // ---- E. nav alive at this width ----
  const dashSel = combo.width >= 992 ? '#ps-rail a[data-ps-nav="dashboard"]' : '#ps-bottombar a[data-ps-nav="dashboard"]';
  await pw.tap(page, dashSel);
  t(`${tag} E1 nav to dashboard`, await pw.waitCard(page, 'dashboard'));
  await pw.tap(page, navSel);
  t(`${tag} E2 nav back to images`, await pw.waitCard(page, 'images'));
  t(`${tag} E3 the previews survive the round trip`, await page.$eval('#ps-images-preview-standby img', (i) => !i.hidden));

  t(`${tag} F1 no page errors, no console errors`, errors.length === 0, errors);
  t(`${tag} F2 network errors: ${REFUSE ? 'exactly the three refusals' : 'none'}`, netErrors.length === (REFUSE ? 3 : 0), netErrors);
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
