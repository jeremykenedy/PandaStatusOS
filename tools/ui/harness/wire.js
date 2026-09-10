#!/usr/bin/env node
'use strict';
/*
 * Wire-level harness for the mock device. No browser, no page: this proves the MOCK
 * speaks the protocol in docs/protocol-websocket.md before any page is tested against it.
 * A mock that is wrong makes every page harness wrong in the same direction, so this runs
 * first in the sweep.
 *
 * Uses Node's built-in WebSocket client and fetch (Node 22+). No dependencies.
 *
 * Behaviour only. Every assertion is about a frame, a field, a timing, or a status code.
 * Nothing here knows what the page looks like.
 *
 * Exit 0 when every assertion passes, 1 otherwise. sweep.sh trusts the exit code.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json wire.js
 */

const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}/ws`;

let pass = 0, fail = 0;
function t(name, ok, got) {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = (s) => { try { return JSON.parse(s); } catch (_) { return undefined; } };

// ---------------------------------------------------------------------------------------
// plumbing
// ---------------------------------------------------------------------------------------

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const c = { ws, frames: [], opened: 0, closed: null };
    ws.onmessage = (e) => c.frames.push({ t: Date.now(), data: String(e.data) });
    ws.onopen = () => { c.opened = Date.now(); resolve(c); };
    ws.onclose = (e) => { c.closed = { t: Date.now(), code: e.code }; };
    ws.onerror = () => { if (!c.opened) reject(new Error('socket error before open')); };
  });
}
async function waitFrames(c, n, ms) { const end = Date.now() + ms; while (c.frames.length < n && Date.now() < end) await sleep(15); return c.frames.length >= n; }
async function waitClosed(c, ms) { const end = Date.now() + ms; while (!c.closed && Date.now() < end) await sleep(15); return !!c.closed; }
const sent = async () => (await fetch(`${BASE}/__sent`)).json();
const state = async () => (await fetch(`${BASE}/__state`)).json();
const knob = (name, value) => fetch(`${BASE}/__knob`, { method: 'POST', body: JSON.stringify({ name, value }) });
const resetMock = () => fetch(`${BASE}/__reset`, { method: 'POST' });
function send(c, root, members, withWakeup = true) {
  const body = Object.assign({}, members); if (withWakeup) body.device_wakeup = 1;
  const f = { [root]: body }; c.ws.send(JSON.stringify(f)); return f;
}
async function sendExpectPush(c, root, members) {
  const before = c.frames.length; const f = send(c, root, members);
  const got = await waitFrames(c, before + 1, 1500);
  const s = await sent(); const rec = s[s.length - 1];
  return { f, rec, pushed: got, push: got ? J(c.frames[before].data) : undefined, frames: c.frames.slice(before) };
}
async function sendExpectSilence(c, root, members, ms = 500) {
  const before = c.frames.length; const f = send(c, root, members); await sleep(ms);
  const s = await sent(); const rec = s[s.length - 1];
  return { f, rec, silent: c.frames.length === before, frames: c.frames.slice(before) };
}
const last = (arr) => arr[arr.length - 1];
async function fresh() { const c = await connect(); await waitFrames(c, 1, 2000); return c; }

// ---------------------------------------------------------------------------------------
// A. the connect push
// ---------------------------------------------------------------------------------------
async function sectionA() {
  console.log('\nA. connect push');
  await resetMock();
  const c = await connect();
  t('A1 one frame arrives on connect', await waitFrames(c, 1, 2000), c.frames.length);
  const d = J(c.frames[0] && c.frames[0].data) || {};
  const roots = Object.keys(d).sort();
  t('A2 exactly the six roots, in one frame', JSON.stringify(roots) === JSON.stringify(['ap', 'block', 'printer', 'settings', 'sta', 'wifi']), roots);
  t('A3 no ws_theme, no response in the connect push', !('ws_theme' in d) && !('response' in d));
  t('A4 settings carries list2, current_mode, fw_version, language', d.settings && ['list2', 'current_mode', 'fw_version', 'language'].every((k) => k in d.settings), d.settings && Object.keys(d.settings));
  t('A5 settings does NOT carry img_version (as the hardware did not)', d.settings && !('img_version' in d.settings));
  t('A6 sta carries auth_err_reason, which the device sends and the UI ignores', d.sta && 'auth_err_reason' in d.sta, d.sta);
  t('A7 printer push carries sn, access_code, ip as well as name/state/scan', d.printer && ['name', 'sn', 'access_code', 'ip', 'state', 'scan'].every((k) => k in d.printer), d.printer && Object.keys(d.printer));
  t('A8 list2 has two entries', Array.isArray(d.settings.list2) && d.settings.list2.length === 2);
  t('A9 list2[0].rgb_rgba is bare RRGGBB', d.settings.list2[0].rgb_rgba.every((x) => /^[0-9A-Fa-f]{6}$/.test(x)), d.settings.list2[0].rgb_rgba);
  t('A10 list2[1].rgb_rgba is #RRGGBBAA', d.settings.list2[1].rgb_rgba.every((x) => /^#[0-9A-Fa-f]{8}$/.test(x)), d.settings.list2[1].rgb_rgba);
  t('A11 list2 entries carry no speed key by default', d.settings.list2.every((e) => !('speed' in e)));
  t('A12 enum values in range: sta.state 1..5, printer.state 1..7, printer.scan 0..6, wifi.scan 0..2',
    d.sta.state >= 1 && d.sta.state <= 5 && d.printer.state >= 1 && d.printer.state <= 7 && d.printer.scan >= 0 && d.printer.scan <= 6 && d.wifi.scan >= 0 && d.wifi.scan <= 2);
  t('A13 blocklist entry has blockID and blockrgba', d.block.blocklist[0] && 'blockID' in d.block.blocklist[0] && 'blockrgba' in d.block.blocklist[0]);
  t('A14 no secrets in the fixture: every ssid/password/sn/access_code is a <PLACEHOLDER>',
    [d.wifi.ssid, d.wifi.password, d.ap.ssid, d.ap.password, d.printer.sn, d.printer.access_code].every((v) => /^<[A-Z_]+>$/.test(v)));
  t('A15 addresses are documentation addresses', [d.sta.ip, d.ap.ip, d.printer.ip].every((v) => v.startsWith('192.0.2.')), [d.sta.ip, d.ap.ip, d.printer.ip]);
  const n = c.frames.length; await sleep(1500);
  t('A16 zero idle traffic for 1.5 s', c.frames.length === n, c.frames.length - n);
  // a second client gets its own push and the first sees nothing
  const c2 = await connect(); await waitFrames(c2, 1, 2000);
  t('A17 a second client gets its own connect push', c2.frames.length === 1);
  t('A18 the first client saw nothing when the second connected', c.frames.length === n);
  c2.ws.close(); c.ws.close();
}

// ---------------------------------------------------------------------------------------
// B. every outbound shape, applied and echoed
// ---------------------------------------------------------------------------------------
async function sectionB() {
  console.log('\nB. outbound shapes');
  await resetMock();
  const c = await fresh();
  let r;

  r = await sendExpectPush(c, 'settings', { rgb_info_brightness: 75 });
  t('B1 brightness: frame recorded exactly as sent, with device_wakeup', r.rec && r.rec.device_wakeup && JSON.stringify(r.rec.frame) === JSON.stringify(r.f), r.rec && r.rec.frame);
  t('B2 brightness: a push follows, carrying all six roots by default', r.pushed && Object.keys(r.push).length === 6, r.push && Object.keys(r.push));
  t('B3 brightness: list2[current_mode].brightness is 75', r.push && r.push.settings.list2[r.push.settings.current_mode].brightness === 75);

  r = await sendExpectPush(c, 'settings', { rgb_info_speed: 30 });
  const st = await state();
  t('B4 speed: stored on the device', st.settings.list2[st.settings.current_mode].speed === 30, st.settings.list2);
  t('B5 speed: NOT echoed in list2, matching the observed push', r.push && r.push.settings.list2.every((e) => !('speed' in e)));

  r = await sendExpectPush(c, 'settings', { rgb_info_mode: 1, rgb_rgba: '#00FFAAFF', rgb_state_index: 2 });
  t('B6 colour write in H2D: stored byte for byte, format preserved', r.push && r.push.settings.list2[1].rgb_rgba[2] === '#00FFAAFF', r.push && r.push.settings.list2[1].rgb_rgba);

  r = await sendExpectPush(c, 'settings', { rgb_info_mode: 0 });
  t('B7 mode select: current_mode 0', r.push && r.push.settings.current_mode === 0);
  r = await sendExpectPush(c, 'settings', { rgb_info_mode: 0, rgb_rgba: 'ABCDEF', rgb_state_index: 0 });
  t('B8 colour write in Music: bare format preserved, not normalised', r.push && r.push.settings.list2[0].rgb_rgba[0] === 'ABCDEF', r.push && r.push.settings.list2[0].rgb_rgba);

  r = await sendExpectSilence(c, 'settings', { rgb_reset: 1 }, 700);
  t('B9 rgb_reset in Music mode: recorded', r.rec && r.rec.frame.settings.rgb_reset === 1);
  t('B10 rgb_reset in Music mode: no push (default no-op, D-014)', r.silent);
  t('B11 rgb_reset in Music mode: nothing changed', (await state()).settings.list2[0].rgb_rgba[0] === 'ABCDEF');

  await sendExpectPush(c, 'settings', { rgb_info_mode: 1 });
  r = await sendExpectPush(c, 'settings', { rgb_reset: 1 });
  t('B12 rgb_reset in H2D: push follows', r.pushed);
  t('B13 rgb_reset: brightness back to 50 in both entries', r.push && r.push.settings.list2[0].brightness === 50 && r.push.settings.list2[1].brightness === 50);
  t('B14 rgb_reset: colours back to UI reset values, each in its own format', r.push && r.push.settings.list2[0].rgb_rgba[0] === 'FFFFFF' && r.push.settings.list2[1].rgb_rgba[2] === '#FF0000FF');
  t('B15 rgb_reset: mode untouched', r.push && r.push.settings.current_mode === 1);
  t('B16 rgb_reset: language untouched', r.push && r.push.settings.language === 'en');

  r = await sendExpectPush(c, 'settings', { language: 'de' });
  t('B17 language', r.push && r.push.settings.language === 'de');

  r = await sendExpectPush(c, 'block', { blockID: 0, blockrgba: '#123456FF' });
  t('B18 block colour', r.push && r.push.block.blocklist[0].blockrgba === '#123456FF');

  r = await sendExpectPush(c, 'ap', { on: 0 });
  t('B19 ap on/off', r.push && r.push.ap.on === 0);

  r = await sendExpectPush(c, 'sta', { hostname: 'renamed' });
  t('B20 hostname: answered by a response frame, not a state push', r.pushed && r.push.response && r.push.response.type === 'set_hostname' && r.push.response.ok === 1, r.push);
  t('B21 hostname: stored', (await state()).sta.hostname === 'renamed');

  r = await sendExpectPush(c, 'ap', { ssid: 'x', password: 'y', ip: '192.0.2.99' });
  t('B22 ap with changed ip: response set_hotspot_ip (INFERENCE, D-014)', r.push && r.push.response && r.push.response.type === 'set_hotspot_ip', r.push);
  r = await sendExpectPush(c, 'ap', { ssid: 'x2', password: 'y', ip: '192.0.2.99' });
  t('B23 ap with same ip: response set_ap', r.push && r.push.response && r.push.response.type === 'set_ap', r.push);

  r = await sendExpectPush(c, 'wifi', { scan: 1 });
  t('B24 wifi scan: immediate push with scan 1', r.push && r.push.wifi.scan === 1);
  const b = c.frames.length; await waitFrames(c, b + 1, 2000);
  const w2 = J(last(c.frames).data);
  t('B25 wifi scan: later push with scan 2 and a list', w2 && w2.wifi && w2.wifi.scan === 2 && Array.isArray(w2.wifi.list) && w2.wifi.list.length > 0, w2 && w2.wifi);

  r = await sendExpectPush(c, 'printer', { scan: 1 });
  t('B26 printer scan: scan 1', r.push && r.push.printer.scan === 1);
  const b2 = c.frames.length; await waitFrames(c, b2 + 1, 2000);
  const p2 = J(last(c.frames).data);
  t('B27 printer scan: scan 2 with a list', p2 && p2.printer && p2.printer.scan === 2 && Array.isArray(p2.printer.list), p2 && p2.printer);

  r = await sendExpectPush(c, 'printer', { name: 'n', sn: 's', access_code: 'a', ip: '192.0.2.21' });
  t('B28 printer bind: state 2 connecting first', r.push && r.push.printer.state === 2);
  const b3 = c.frames.length; await waitFrames(c, b3 + 1, 2000);
  t('B29 printer bind: then state 3 connected', J(last(c.frames).data).printer.state === 3);

  r = await sendExpectPush(c, 'printer', { disconnect: 1 });
  t('B30 printer unbind: state 1', r.push && r.push.printer.state === 1);

  r = await sendExpectPush(c, 'wifi', { ssid: 'net', password: 'pw' });
  t('B31 wifi connect: sta.state 2 first', r.push && r.push.sta.state === 2);
  const b4 = c.frames.length; await waitFrames(c, b4 + 1, 2000);
  t('B32 wifi connect: then sta.state 3', J(last(c.frames).data).sta.state === 3);

  // dead controls, and frames without the envelope
  r = await sendExpectPush(c, 'settings', { on: 0 });
  t('B33 a dead control arriving is recorded and stored, never assumed honoured', r.rec && r.rec.frame.settings.on === 0 && (await state()).settings.on === 0);
  const before = c.frames.length; send(c, 'settings', { rgb_info_brightness: 40 }, false); await sleep(300);
  const s = await sent(); const rr = last(s);
  t('B34 a frame without device_wakeup is recorded with a warning and still applied by default', rr && rr.device_wakeup === false && rr.warn && c.frames.length > before, rr);
  await knob('PS_STRICT_WAKEUP', '1');
  send(c, 'settings', { rgb_info_brightness: 45 }, false); await sleep(300);
  t('B35 under PS_STRICT_WAKEUP the same frame is dropped', last(await sent()).error === 'dropped: PS_STRICT_WAKEUP' && (await state()).settings.list2[1].brightness === 40);
  await knob('PS_STRICT_WAKEUP', '');
  c.ws.close();
}

// ---------------------------------------------------------------------------------------
// C. reset is a restart that keeps config; D. factory_reset acknowledges then wipes
// ---------------------------------------------------------------------------------------
async function sectionCD() {
  console.log('\nC. reset (restart)');
  await resetMock();
  let c = await fresh();
  await sendExpectPush(c, 'settings', { rgb_info_brightness: 65 });
  send(c, 'settings', { reset: 1 });
  t('C1 reset: socket closes', await waitClosed(c, 1500), c.closed);
  t('C2 reset: close code 1001 (going away), not an abrupt drop', c.closed && c.closed.code === 1001, c.closed);
  c = await fresh();
  t('C3 after restart: a fresh connect push arrives', c.frames.length >= 1);
  t('C4 after restart: config preserved (brightness still 65)', J(c.frames[0].data).settings.list2[1].brightness === 65);
  c.ws.close();

  console.log('\nD. factory_reset');
  c = await fresh();
  const before = c.frames.length; send(c, 'settings', { factory_reset: 1 });
  await waitFrames(c, before + 1, 1500);
  const resp = J(c.frames[before] && c.frames[before].data);
  t('D1 factory_reset: acknowledged by response type factory_reset ok 1', resp && resp.response && resp.response.type === 'factory_reset' && resp.response.ok === 1, resp);
  t('D2 factory_reset: then the socket closes', await waitClosed(c, 1500));
  c = await fresh();
  const d = J(c.frames[0].data);
  t('D3 after factory reset: sta.state 1 nossid (INFERENCE fixture)', d.sta.state === 1, d.sta);
  t('D4 after factory reset: brightness 50', d.settings.list2[1].brightness === 50);
  t('D5 after factory reset: printer unbound', d.printer.state === 1);
  c.ws.close();
}

// ---------------------------------------------------------------------------------------
// E. the lies
// ---------------------------------------------------------------------------------------
async function sectionE() {
  console.log('\nE. lies, via /__knob');
  const clear = async (...ks) => { for (const k of ks) await knob(k, ''); };
  let c, d;

  await resetMock(); await knob('PS_DROP_AFTER', '300'); c = await fresh();
  t('E1 PS_DROP_AFTER: socket terminated abruptly (1006) around 300 ms', await waitClosed(c, 1500) && c.closed.code === 1006 && c.closed.t - c.opened >= 250, c.closed);
  await clear('PS_DROP_AFTER');

  await resetMock(); await knob('PS_MALFORMED', '1'); c = await fresh(); await waitFrames(c, 2, 1000);
  t('E2 PS_MALFORMED: a second frame arrives that is not JSON', c.frames.length >= 2 && J(c.frames[1].data) === undefined, c.frames[1] && c.frames[1].data);
  await clear('PS_MALFORMED'); c.ws.close();

  await resetMock(); await knob('PS_UNKNOWN_ENUM', '1'); c = await fresh(); d = J(c.frames[0].data);
  t('E3 PS_UNKNOWN_ENUM: sta.state 9 and printer.scan 42 in the push', d.sta.state === 9 && d.printer.scan === 42);
  await clear('PS_UNKNOWN_ENUM'); c.ws.close();

  await resetMock(); await knob('PS_NO_PUSH', '1'); c = await connect(); await sleep(800);
  t('E4 PS_NO_PUSH: socket open, nothing arrives', c.ws.readyState === 1 && c.frames.length === 0);
  await clear('PS_NO_PUSH'); c.ws.close();

  await resetMock(); await knob('PS_DELAY', '500'); c = await connect(); await waitFrames(c, 1, 2000);
  t('E5 PS_DELAY: first frame at least 450 ms after open', c.frames.length === 1 && c.frames[0].t - c.opened >= 450, c.frames[0] && c.frames[0].t - c.opened);
  await clear('PS_DELAY'); c.ws.close();

  await resetMock(); await knob('PS_DEAF', '500'); c = await connect(); await sleep(100);
  send(c, 'settings', { rgb_info_brightness: 11 }); await sleep(700);
  t('E6 PS_DEAF: a frame sent inside the deaf window is not even recorded', (await sent()).length === 0);
  send(c, 'settings', { rgb_info_brightness: 12 }); await sleep(300);
  t('E7 PS_DEAF: a frame after the window is recorded', (await sent()).length === 1);
  await clear('PS_DEAF'); c.ws.close();

  await resetMock(); await knob('PS_SLOW', '400'); c = await connect(); await waitFrames(c, 1, 2000);
  t('E8 PS_SLOW: push delayed by about 400 ms', c.frames[0].t - c.opened >= 350);
  await clear('PS_SLOW'); c.ws.close();

  await resetMock(); await knob('PS_PRINTER_OFFLINE_AFTER', '200'); c = await fresh(); await waitFrames(c, 2, 1500);
  t('E9 PS_PRINTER_OFFLINE_AFTER: an unprompted printer push with state 2', c.frames.length >= 2 && J(c.frames[1].data).printer.state === 2);
  await clear('PS_PRINTER_OFFLINE_AFTER'); c.ws.close();

  await resetMock(); await knob('PS_NOECHO', '1'); c = await fresh();
  let r = await sendExpectSilence(c, 'settings', { rgb_info_brightness: 33 });
  t('E10 PS_NOECHO: applied but never echoed', r.silent && (await state()).settings.list2[1].brightness === 33);
  await clear('PS_NOECHO'); c.ws.close();

  await resetMock(); await knob('PS_RGB_RESET_MUSIC_APPLIES', '1'); c = await fresh();
  await sendExpectPush(c, 'settings', { rgb_info_mode: 0 }); await sendExpectPush(c, 'settings', { rgb_info_brightness: 20 });
  r = await sendExpectPush(c, 'settings', { rgb_reset: 1 });
  t('E11 PS_RGB_RESET_MUSIC_APPLIES: rgb_reset in Music now applies and pushes', r.pushed && r.push.settings.list2[0].brightness === 50);
  await clear('PS_RGB_RESET_MUSIC_APPLIES'); c.ws.close();

  await resetMock(); await knob('PS_PUSH_CHANGED_ONLY', '1'); c = await fresh();
  r = await sendExpectPush(c, 'settings', { rgb_info_brightness: 70 });
  t('E12 PS_PUSH_CHANGED_ONLY: the push carries only the changed root', r.pushed && Object.keys(r.push).length === 1 && 'settings' in r.push, r.push && Object.keys(r.push));
  await clear('PS_PUSH_CHANGED_ONLY'); c.ws.close();

  await resetMock(); await knob('PS_BROADCAST', '1'); c = await fresh(); const c2 = await fresh();
  const n2 = c2.frames.length; await sendExpectPush(c, 'settings', { rgb_info_brightness: 71 }); await sleep(200);
  t('E13 PS_BROADCAST: the other client also receives the change push', c2.frames.length === n2 + 1);
  await clear('PS_BROADCAST'); c.ws.close(); c2.ws.close();

  await resetMock(); await knob('PS_EMIT_SPEED', '1'); c = await fresh();
  await sendExpectPush(c, 'settings', { rgb_info_speed: 55 }); r = await sendExpectPush(c, 'settings', { rgb_info_brightness: 50 });
  t('E14 PS_EMIT_SPEED: speed appears in list2', r.push && r.push.settings.list2[1].speed === 55);
  await clear('PS_EMIT_SPEED'); c.ws.close();

  await resetMock(); await knob('PS_IMG_VERSION', '1'); c = await fresh(); d = J(c.frames[0].data);
  t('E15 PS_IMG_VERSION: img_version appears in the connect push', 'img_version' in d.settings);
  await clear('PS_IMG_VERSION'); c.ws.close();

  await resetMock(); await knob('PS_THEME_ON_CONNECT', '1'); c = await fresh(); await waitFrames(c, 2, 1000); d = J(c.frames[1] && c.frames[1].data);
  t('E16 PS_THEME_ON_CONNECT: a ws_theme frame with preview and a 15-entry list of {gif, rgba}', d && d.ws_theme && d.ws_theme.list.length === 15 && d.ws_theme.list.every((e) => 'gif' in e && 'rgba' in e));
  await clear('PS_THEME_ON_CONNECT'); c.ws.close();

  await resetMock(); await knob('PS_WIFI_FAIL', '1'); c = await fresh();
  await sendExpectPush(c, 'wifi', { ssid: 'n', password: 'p' }); const bb = c.frames.length; await waitFrames(c, bb + 1, 2000);
  t('E17 PS_WIFI_FAIL: sta.state 5 password error', J(last(c.frames).data).sta.state === 5);
  await clear('PS_WIFI_FAIL'); c.ws.close();

  await resetMock(); await knob('PS_PRINTER_FAIL', '6'); c = await fresh();
  await sendExpectPush(c, 'printer', { name: 'n', sn: 's', access_code: 'a', ip: '192.0.2.21' }); const b5 = c.frames.length; await waitFrames(c, b5 + 1, 2000);
  t('E18 PS_PRINTER_FAIL=6: printer.state 6 access code', J(last(c.frames).data).printer.state === 6);
  await clear('PS_PRINTER_FAIL'); c.ws.close();
}

// ---------------------------------------------------------------------------------------
// F. HTTP
// ---------------------------------------------------------------------------------------
async function sectionF() {
  console.log('\nF. HTTP surface');
  await resetMock();
  let r = await fetch(`${BASE}/`);
  t('F1 GET / is 200 text/html', r.status === 200 && (r.headers.get('content-type') || '').includes('text/html'), r.status);
  r = await fetch(`${BASE}/`, { method: 'HEAD' });
  t('F2 HEAD / is 405', r.status === 405, r.status);
  r = await fetch(`${BASE}/ota`);
  t('F3 GET /ota is 405', r.status === 405, r.status);
  r = await fetch(`${BASE}/gif/standby.gif`, { redirect: 'manual' });
  t('F4 any other path is a 302 with a Location', r.status === 302 && !!r.headers.get('location'), r.status);
  r = await fetch(`${BASE}/status`, { redirect: 'manual' });
  t('F5 /status too', r.status === 302);

  const c = await fresh(); const before = c.frames.length;
  r = await fetch(`${BASE}/ota`, { method: 'POST', headers: { 'OTA-Type': 'ota_fw', 'Content-Type': 'application/octet-stream' }, body: Buffer.alloc(100) });
  await waitFrames(c, before + 1, 1500);
  const resp = J(last(c.frames).data);
  t('F6 POST /ota ota_fw: 200 and a response frame ota_fw ok 1 on the socket', r.status === 200 && resp && resp.response && resp.response.type === 'ota_fw' && resp.response.ok === 1, [r.status, resp]);

  const b2 = c.frames.length;
  r = await fetch(`${BASE}/ota`, { method: 'POST', headers: { 'OTA-Type': 'standby' }, body: Buffer.alloc(0x180000 + 1) });
  await waitFrames(c, b2 + 1, 2000);
  const resp2 = J(last(c.frames).data);
  t('F7 POST /ota gif over the 1.5 MB cap: 413 and response ota_img ok 0 gif standby', r.status === 413 && resp2 && resp2.response && resp2.response.ok === 0 && resp2.response.gif === 'standby', [r.status, resp2]);

  const b3 = c.frames.length;
  r = await fetch(`${BASE}/ota`, { method: 'POST', headers: { 'OTA-Type': 'standby' }, body: Buffer.alloc(1024) });
  await waitFrames(c, b3 + 1, 1500);
  const resp3 = J(last(c.frames).data);
  t('F8 POST /ota gif within cap: 200, response ota_img ok 1 gif standby', r.status === 200 && resp3 && resp3.response.ok === 1 && resp3.response.gif === 'standby');

  r = await fetch(`${BASE}/ota`, { method: 'POST', headers: { 'OTA-Type': 'bogus' }, body: Buffer.alloc(10) });
  t('F9 POST /ota with an unknown OTA-Type: 400', r.status === 400, r.status);

  const b4 = c.frames.length;
  r = await fetch(`${BASE}/ota`, { method: 'POST', headers: { 'OTA-Type': 'ota_img' }, body: Buffer.alloc(100) });
  await waitFrames(c, b4 + 1, 1500);
  t('F10 POST /ota ota_img: 200, response ota_img ok 1, and img_version advances', r.status === 200 && J(last(c.frames).data).response.type === 'ota_img' && (await state()).settings.img_version === 'V1.0.1');

  await knob('PS_OTA_REFUSE', '1'); const b5 = c.frames.length;
  r = await fetch(`${BASE}/ota`, { method: 'POST', headers: { 'OTA-Type': 'ota_fw' }, body: Buffer.alloc(10) });
  await waitFrames(c, b5 + 1, 1500);
  t('F11 PS_OTA_REFUSE: 500 and response ok 0', r.status === 500 && J(last(c.frames).data).response.ok === 0);
  await knob('PS_OTA_REFUSE', ''); c.ws.close();
}

// ---------------------------------------------------------------------------------------
(async () => {
  try {
    await sectionA(); await sectionB(); await sectionCD(); await sectionE(); await sectionF();
  } catch (e) {
    fail++; console.log(`  FAIL  harness threw: ${e && e.stack || e}`);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
