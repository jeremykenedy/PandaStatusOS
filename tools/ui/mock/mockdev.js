#!/usr/bin/env node
'use strict';
/*
 * Mock Panda Status P2. One process: HTTP serves the page, a WebSocket at /ws speaks the
 * protocol in docs/protocol-websocket.md, a JSON fixture is the whole device state.
 *
 * Every harness runs against this and nothing else. Standing rule 9: no real device.
 *
 * What it reproduces, and where each fact comes from (docs/protocol-websocket.md unless
 * stated):
 *   - one WebSocket at /ws, JSON text, one frame may carry several roots
 *   - connect-time push of exactly six roots in ONE frame: wifi sta ap printer settings
 *     block (measured; the redacted capture in .claude/work/analysis/ has the shape)
 *   - settings in that push carries list2, current_mode, fw_version, language and NOT
 *     img_version, which the UI handles but the device did not send. The mock is as
 *     unkind as the hardware: img_version is absent unless PS_IMG_VERSION is set
 *   - zero idle traffic. Nothing is sent that a connect or an inbound frame did not cause
 *   - every inbound frame is a single-root object carrying device_wakeup: 1
 *   - list2[0].rgb_rgba is bare RRGGBB, list2[1].rgb_rgba is #RRGGBBAA; neither is
 *     normalised, and a colour written by the client is stored in the format it arrived
 *   - the three reset commands: rgb_reset (lighting only), reset (a restart, config
 *     kept), factory_reset (acknowledged, then restart onto factory defaults)
 *   - the 15 stage GIF slots, the block/blocklist model, all five enums
 *   - HTTP: GET / is the page, HEAD / and GET /ota are 405, POST /ota is the upload
 *     with an OTA-Type header and per-type size caps, everything else is a 302
 *
 * What is INFERENCE and adjustable by knob, because the bench session has not run:
 *   - whether a change-triggered push carries all six roots or only the changed one
 *     (default: all six, PS_PUSH_CHANGED_ONLY=1 for the other)
 *   - whether a change-triggered push reaches other clients (default: sender only,
 *     matching the measured connect-time behaviour; PS_BROADCAST=1 for the other)
 *   - what the device does with rgb_reset while in Music mode. The factory UI never
 *     sends it there. Default: no-op, no push. PS_RGB_RESET_MUSIC_APPLIES=1 applies it
 *   - whether rgb_info_speed is echoed back in list2 (observed push had no speed key;
 *     default: stored, not emitted; PS_EMIT_SPEED=1 emits it)
 *   - which response type the ap message earns: set_hotspot_ip when ip changed, else set_ap
 *   - the shape of wifi.list and printer.list entries
 *   - what a GIF upload's response looks like: {type:"ota_img", ok, gif:<slot>}
 *
 * How it lies (all env, all off by default). These exist so a harness can prove the page
 * survives a device that is slow, silent, gone, or wrong:
 *   PS_DELAY=ms            connect push arrives late; device is awake
 *   PS_DEAF=ms             nothing in either direction for N ms after connect
 *   PS_NOECHO=1            apply writes, never push afterwards
 *   PS_NO_WS=1             no WebSocket server at all; the upgrade is refused
 *   PS_NO_PUSH=1           accept the socket, never send the connect push
 *   PS_DROP_AFTER=ms       terminate every socket N ms after it connects
 *   PS_MALFORMED=1         after the connect push, send one frame that is not JSON
 *   PS_UNKNOWN_ENUM=1      connect push carries sta.state=9 and printer.scan=42
 *   PS_PRINTER_OFFLINE_AFTER=ms   printer.state drops to 2 (connecting) after N ms
 *   PS_SLOW=ms             every push is delayed by N ms
 *   PS_STRICT_WAKEUP=1     drop any inbound frame missing device_wakeup: 1
 *   PS_OTA_REFUSE=1        POST /ota returns 500 and a response with ok:0
 *   PS_WIFI_FAIL=1         a wifi connect ends in sta.state 5 (password error)
 *   PS_PRINTER_FAIL=n      a printer bind ends in printer.state n (4..7)
 *   PS_REBOOT_DOWN_MS=ms   after a restart, refuse upgrades for N ms
 *
 * Plumbing:
 *   PS_PORT     default 8199
 *   PS_STATE    fixture file; relative paths resolve against ./fixtures
 *   PS_PAGE     page to serve at /; default firmware/main/ui.html at the repo root, and a
 *               built-in placeholder that opens the socket when that file does not exist
 *   PS_LOG      if set, every event is appended to this file as JSONL
 *
 * Debug endpoints, NOT protocol, present only in the mock:
 *   GET  /__sent     every frame the device received, in order, with timestamps
 *   GET  /__pushed   every frame the device sent
 *   GET  /__state    the current state document; __mock.gif_uploads[slot] is the byte count of
 *                    the last accepted upload per slot, __mock.gif_sha256[slot] its sha256
 *   POST /__reset    reload the fixture, clear the logs
 *   POST /__knob     {"name":"PS_...","value":"..."} set a lie at runtime
 *
 * Lessons carried from the sibling project's mock, each of which cost it a night:
 *   - state is mutated in place, then pushed. Echoing before applying made every write
 *     look rejected
 *   - timers live OUTSIDE the state object. A handle inside it made JSON.stringify throw
 *     inside a try/catch and the mock went silent
 *   - the mock re-sends only what the device re-sends. Re-sending connect-only bodies on
 *     every push hid a page bug that only showed on hardware
 *   - every timer honours the same deaf window, or the slow-device test never tests one
 *   - no absolute paths. The repo root is found from __dirname
 */

const http = require('http');
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); }
catch (e) {
  console.error('mockdev: the "ws" package is not resolvable. Run tools/ui/harness/run.sh, which sets NODE_PATH, or install it under private/uiwork/.');
  process.exit(2);
}

const ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURES = path.join(__dirname, 'fixtures');
const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const num = (k, d) => Number(env(k, d));
const flag = (k) => ['1', 'true', 'yes'].includes(String(env(k, '')).toLowerCase());

const KNOBS = {};                      // runtime overrides via /__knob
const knob = (k, d) => (KNOBS[k] !== undefined ? KNOBS[k] : env(k, d));
const knobNum = (k, d) => Number(knob(k, d));
const knobFlag = (k) => ['1', 'true', 'yes'].includes(String(knob(k, '')).toLowerCase());

const PORT = num('PS_PORT', 8199);
const FIXTURE = (() => { const f = env('PS_STATE', 'p2-idle.json'); return path.isAbsolute(f) ? f : path.join(FIXTURES, f); })();
const FACTORY = path.join(FIXTURES, 'factory-defaults.json');
const PAGE = env('PS_PAGE', path.join(ROOT, 'firmware', 'main', 'ui.html'));
const LOG = env('PS_LOG', '');

// ---------------------------------------------------------------------------------------
// Protocol facts, as data
// ---------------------------------------------------------------------------------------

const CONNECT_ROOTS = ['wifi', 'sta', 'ap', 'printer', 'settings', 'block'];
const SETTINGS_PUSH_KEYS = ['list2', 'current_mode', 'fw_version', 'language'];
const OUTBOUND_ROOTS = new Set(['settings', 'wifi', 'sta', 'ap', 'printer', 'block']);
const RESPONSE_TYPES = new Set(['set_hostname', 'set_ap', 'set_hotspot_ip', 'factory_reset', 'ota_fw', 'ota_img']);
const GIF_SLOTS = ['standby', 'nozzle_heating', 'bed_heating', 'bed_leveling', 'homing', 'nozzle_cleaning',
  'calibrating_flow', 'xy_mesh_mode_sweep', 'filament_check_location', 'filament_cut',
  'filament_pull_back_cur', 'filament_push_new', 'filament_purge_old', 'printing_ok', 'printing'];
const OTA_CAPS = { ota_fw: 0x480000, ota_img: 0x6E0000, gif: 0x180000 };
const ENUM = {
  sta_state: { 1: 'nossid', 2: 'connecting', 3: 'connected', 4: 'reconnecting', 5: 'password error' },
  printer_state: { 1: 'invalid info', 2: 'connecting', 3: 'connected', 4: 'ip err', 5: 'sn err', 6: 'access code', 7: 'unknown err' },
  printer_scan: { 0: 'idle', 1: 'scanning', 2: 'done', 3: 'ip_change_scanning', 4: 'sn not matched', 5: 'ip not changed', 6: 'new ip applied' },
  wifi_scan: { 0: 'idle', 1: 'scanning', 2: 'done' },
};

// ---------------------------------------------------------------------------------------
// State. Mutated in place. Timers are NOT in here.
// ---------------------------------------------------------------------------------------

let STATE = null;
let booting = false;                    // true while a "restart" is in progress
const timers = new Set();               // every pending timer, outside STATE
const sockets = new Set();
const SENT = [];                        // frames the device received (the harness reads these)
const PUSHED = [];                      // frames the device sent
const t0 = Date.now();

function loadFixture(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const doc = JSON.parse(raw);
  // deep copy so the fixture on disk is never the object we mutate
  return JSON.parse(JSON.stringify(doc));
}

function log(ev) {
  const rec = Object.assign({ t: Date.now(), rel_ms: Date.now() - t0 }, ev);
  if (LOG) { try { fs.appendFileSync(LOG, JSON.stringify(rec) + '\n'); } catch (_) { /* logging must never kill the mock */ } }
  if (process.env.PS_QUIET !== '1') console.log(`[mock ${String(rec.rel_ms).padStart(6)}] ${ev.ev}${ev.detail ? ' ' + ev.detail : ''}`);
}

function later(ms, fn) {
  const h = setTimeout(() => { timers.delete(h); try { fn(); } catch (e) { log({ ev: 'timer_error', detail: String(e) }); } }, ms);
  timers.add(h);
  return h;
}
function clearTimers() { for (const h of timers) clearTimeout(h); timers.clear(); }

// ---------------------------------------------------------------------------------------
// Building what the device sends
// ---------------------------------------------------------------------------------------

function settingsPushBody() {
  const s = STATE.settings;
  const out = {};
  for (const k of SETTINGS_PUSH_KEYS) if (s[k] !== undefined) out[k] = s[k];
  if (knobFlag('PS_IMG_VERSION') && s.img_version !== undefined) out.img_version = s.img_version;
  // list2: emit brightness and rgb_rgba; emit speed only if the knob says the device does
  out.list2 = s.list2.map((e) => {
    const o = { brightness: e.brightness, rgb_rgba: e.rgb_rgba.slice() };
    if (knobFlag('PS_EMIT_SPEED') && e.speed !== undefined) o.speed = e.speed;
    return o;
  });
  return out;
}

function rootBody(root) {
  if (root === 'settings') return settingsPushBody();
  // shallow copy of the fixture's root as the device reports it
  return JSON.parse(JSON.stringify(STATE[root]));
}

function fullDocument() {
  const doc = {};
  for (const r of CONNECT_ROOTS) doc[r] = rootBody(r);
  if (knobFlag('PS_UNKNOWN_ENUM')) { doc.sta.state = 9; doc.printer.scan = 42; }
  return doc;
}

function sendRaw(ws, text, meta) {
  if (!ws || ws.readyState !== 1) return;
  const delay = knobNum('PS_SLOW', 0);
  const doSend = () => {
    if (ws.readyState !== 1) return;
    ws.send(text);
    PUSHED.push(Object.assign({ t: Date.now(), rel_ms: Date.now() - t0, text }, meta || {}));
  };
  if (delay > 0) later(delay, doSend); else doSend();
}

function push(ws, doc, why) {
  sendRaw(ws, JSON.stringify(doc), { why, roots: Object.keys(doc) });
  log({ ev: 'push', detail: `${why} roots=${Object.keys(doc).join(',')}` });
}

function pushAfterChange(originWs, changedRoots) {
  if (knobFlag('PS_NOECHO')) { log({ ev: 'push_suppressed', detail: 'PS_NOECHO' }); return; }
  const doc = knobFlag('PS_PUSH_CHANGED_ONLY')
    ? Object.fromEntries(changedRoots.map((r) => [r, rootBody(r)]))
    : fullDocument();
  const targets = knobFlag('PS_BROADCAST') ? [...sockets] : [originWs];
  for (const ws of targets) push(ws, doc, `change:${changedRoots.join('+')}`);
}

function response(wsOrAll, type, ok, extra) {
  if (!RESPONSE_TYPES.has(type)) log({ ev: 'warn', detail: `response type ${type} is not in the enum` });
  const frame = { response: Object.assign({ type, ok: ok ? 1 : 0 }, extra || {}) };
  const targets = wsOrAll === 'all' ? [...sockets] : [wsOrAll];
  for (const ws of targets) push(ws, frame, `response:${type}`);
}

// ---------------------------------------------------------------------------------------
// Restart. Closes every socket; optionally refuses upgrades for a while.
// ---------------------------------------------------------------------------------------

function restart(why, afterState) {
  log({ ev: 'restart', detail: why });
  booting = true;
  clearTimers();
  later(knobNum('PS_RESTART_MS', 150), () => {
    for (const ws of sockets) { try { ws.close(1001, 'device restarting'); } catch (_) { /* already gone */ } }
    sockets.clear();
    if (afterState) STATE = afterState;
    const down = knobNum('PS_REBOOT_DOWN_MS', 0);
    later(down, () => { booting = false; log({ ev: 'booted' }); });
  });
}

// ---------------------------------------------------------------------------------------
// Applying an inbound frame. Mutate first, push after.
// Returns the list of changed roots, or null if nothing should be pushed.
// ---------------------------------------------------------------------------------------

function clampInt(v, lo, hi) { const n = Number(v); if (!Number.isInteger(n)) return null; return Math.max(lo, Math.min(hi, n)); }

function applySettings(ws, m) {
  const s = STATE.settings;
  const mode = s.current_mode;

  if ('rgb_reset' in m) {
    if (mode === 0 && !knobFlag('PS_RGB_RESET_MUSIC_APPLIES')) {
      log({ ev: 'rgb_reset_ignored', detail: 'Music mode; INFERENCE, see header' });
      return null;
    }
    // Lighting only. Values are the UI's client-side reset expectations, marked in the
    // protocol doc as UI values rather than proven compiled-in defaults.
    s.list2[0].brightness = 50;
    s.list2[1].brightness = 50;
    s.list2[1].speed = 100;
    s.list2[0].rgb_rgba = ['FFFFFF', 'FFFFFF', 'FF0000'];
    s.list2[1].rgb_rgba = ['#FFFFFFFF', '#FFFFFFFF', '#FF0000FF'];
    return ['settings'];
  }
  if ('reset' in m) { restart('settings.reset'); return null; }
  if ('factory_reset' in m) {
    response(ws, 'factory_reset', true);
    restart('settings.factory_reset', loadFixture(FACTORY));
    return null;
  }

  const changed = [];
  if ('rgb_info_mode' in m && !('rgb_rgba' in m)) {
    const v = clampInt(m.rgb_info_mode, 0, 1);
    if (v !== null) { s.current_mode = v; changed.push('settings'); }
  }
  if ('rgb_info_brightness' in m) {
    const v = clampInt(m.rgb_info_brightness, 0, 100);
    if (v !== null) { s.list2[mode].brightness = v; changed.push('settings'); }
  }
  if ('rgb_info_speed' in m) {
    const v = clampInt(m.rgb_info_speed, 0, 100);
    if (v !== null) { s.list2[mode].speed = v; changed.push('settings'); }
  }
  if ('rgb_rgba' in m && 'rgb_state_index' in m) {
    const idx = clampInt(m.rgb_state_index, 0, 2);
    const tgt = 'rgb_info_mode' in m ? clampInt(m.rgb_info_mode, 0, 1) : mode;
    if (idx !== null && tgt !== null && typeof m.rgb_rgba === 'string') {
      s.list2[tgt].rgb_rgba[idx] = m.rgb_rgba;     // stored exactly as sent, no normalising
      changed.push('settings');
    }
  }
  if ('language' in m && typeof m.language === 'string') { s.language = m.language; changed.push('settings'); }
  // The three dead controls. Handled inbound by the UI, never sent by it. If a frame
  // carries them, record that the device saw them and store them; whether the real
  // firmware honours them is unknown and untested.
  for (const dead of ['on', 'follow', 'printing_ui_type']) {
    if (dead in m) { s[dead] = m[dead]; log({ ev: 'dead_control_received', detail: dead }); changed.push('settings'); }
  }
  return changed.length ? [...new Set(changed)] : null;
}

function applyWifi(ws, m) {
  const w = STATE.wifi;
  if ('scan' in m) {
    w.scan = 1;
    later(knobNum('PS_SCAN_MS', 800), () => {
      if (!sockets.has(ws)) return;
      w.scan = 2; w.list = STATE.__mock.wifi_scan_results.slice();
      pushAfterChange(ws, ['wifi']);
    });
    return ['wifi'];
  }
  if ('ssid' in m) {
    w.ssid = String(m.ssid); if ('password' in m) w.password = String(m.password);
    STATE.sta.state = 2;
    later(knobNum('PS_CONNECT_MS', 700), () => {
      if (!sockets.has(ws)) return;
      if (knobFlag('PS_WIFI_FAIL')) { STATE.sta.state = 5; STATE.sta.auth_err_reason = 2; }
      else { STATE.sta.state = 3; STATE.sta.auth_err_reason = 0; }
      pushAfterChange(ws, ['sta']);
    });
    return ['wifi', 'sta'];
  }
  return null;
}

function applySta(ws, m) {
  if ('hostname' in m) {
    STATE.sta.hostname = String(m.hostname);
    response(ws, 'set_hostname', true);       // the UI then sends settings.reset on OK
    return null;                              // no state push; the response is the answer
  }
  return null;
}

function applyAp(ws, m) {
  const a = STATE.ap;
  if ('on' in m && !('ssid' in m)) { a.on = clampInt(m.on, 0, 1) ?? a.on; return ['ap']; }
  if ('ssid' in m) {
    const ipChanged = 'ip' in m && m.ip !== a.ip;
    a.ssid = String(m.ssid); if ('password' in m) a.password = String(m.password); if ('ip' in m) a.ip = String(m.ip);
    response(ws, ipChanged ? 'set_hotspot_ip' : 'set_ap', true);   // INFERENCE, see header
    return null;
  }
  return null;
}

function applyPrinter(ws, m) {
  const p = STATE.printer;
  if ('scan' in m) {
    p.scan = 1;
    later(knobNum('PS_SCAN_MS', 800), () => {
      if (!sockets.has(ws)) return;
      p.scan = 2; p.list = STATE.__mock.printer_scan_results.slice();
      pushAfterChange(ws, ['printer']);
    });
    return ['printer'];
  }
  if ('disconnect' in m) { p.state = 1; return ['printer']; }
  if ('sn' in m || 'ip' in m) {
    for (const k of ['name', 'sn', 'access_code', 'ip']) if (k in m) p[k] = String(m[k]);
    p.state = 2;
    later(knobNum('PS_CONNECT_MS', 700), () => {
      if (!sockets.has(ws)) return;
      const fail = knobNum('PS_PRINTER_FAIL', 0);
      p.state = fail >= 4 && fail <= 7 ? fail : 3;
      pushAfterChange(ws, ['printer']);
    });
    return ['printer'];
  }
  return null;
}

function applyBlock(ws, m) {
  if (!('blockID' in m) || !('blockrgba' in m)) return null;
  const id = clampInt(m.blockID, 0, 255); if (id === null) return null;
  const list = STATE.block.blocklist;
  const hit = list.find((b) => b.blockID === id);
  if (hit) hit.blockrgba = String(m.blockrgba); else list.push({ blockID: id, blockrgba: String(m.blockrgba) });
  return ['block'];
}

const APPLY = { settings: applySettings, wifi: applyWifi, sta: applySta, ap: applyAp, printer: applyPrinter, block: applyBlock };

function handleInbound(ws, text) {
  const rec = { t: Date.now(), rel_ms: Date.now() - t0, text };
  let frame;
  try { frame = JSON.parse(text); }
  catch (e) { rec.error = 'not json'; SENT.push(rec); log({ ev: 'inbound_unparsable' }); return; }
  rec.frame = frame;
  const roots = Object.keys(frame);
  rec.roots = roots;
  if (roots.length !== 1) { rec.error = `expected one root, got ${roots.length}`; SENT.push(rec); log({ ev: 'inbound_multi_root', detail: roots.join(',') }); return; }
  const root = roots[0]; const body = frame[root];
  rec.device_wakeup = body && body.device_wakeup === 1;
  if (!rec.device_wakeup) {
    rec.warn = 'missing device_wakeup:1';
    log({ ev: 'inbound_no_wakeup', detail: root });
    if (knobFlag('PS_STRICT_WAKEUP')) { rec.error = 'dropped: PS_STRICT_WAKEUP'; SENT.push(rec); return; }
  }
  SENT.push(rec);
  if (!OUTBOUND_ROOTS.has(root)) { log({ ev: 'inbound_unknown_root', detail: root }); return; }
  log({ ev: 'inbound', detail: `${root} ${Object.keys(body).filter((k) => k !== 'device_wakeup').join(',')}` });
  const changed = APPLY[root](ws, body);
  if (changed) pushAfterChange(ws, changed);
}

// ---------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------

const PLACEHOLDER = `<!doctype html><meta charset="utf-8"><title>mock placeholder</title>
<p>No built page at ${PAGE}. This placeholder opens the socket so wire harnesses can run.</p>
<script>window.PS_MOCK_PLACEHOLDER=1;var g=new WebSocket('ws://'+location.host+'/ws');g.onmessage=function(e){window.PS_LAST=e.data};</script>`;

function readBody(req, cap) {
  return new Promise((resolve) => {
    const chunks = []; let n = 0; let over = false;
    req.on('data', (c) => { n += c.length; if (n > cap) { over = true; } else chunks.push(c); });
    req.on('end', () => resolve({ bytes: n, over, body: Buffer.concat(chunks) }));
  });
}

async function handleHttp(req, res) {
  const u = new URL(req.url, `http://${req.headers.host || 'mock'}`);
  const p = u.pathname;

  // --- debug, not protocol ---
  if (p === '/__sent') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(SENT)); }
  if (p === '/__pushed') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(PUSHED)); }
  if (p === '/__state') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(STATE)); }
  if (p === '/__reset' && req.method === 'POST') { await readBody(req, 1 << 16); STATE = loadFixture(FIXTURE); SENT.length = 0; PUSHED.length = 0; clearTimers(); log({ ev: 'debug_reset' }); res.writeHead(200); return res.end('ok'); }
  if (p === '/__knob' && req.method === 'POST') {
    const { body } = await readBody(req, 1 << 16);
    try { const k = JSON.parse(body.toString('utf8')); KNOBS[k.name] = k.value; log({ ev: 'knob', detail: `${k.name}=${k.value}` }); res.writeHead(200); return res.end('ok'); }
    catch (_) { res.writeHead(400); return res.end('bad knob'); }
  }

  // --- protocol ---
  if (p === '/') {
    if (req.method === 'HEAD') { res.writeHead(405); return res.end(); }
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    let page = PLACEHOLDER;
    try { page = fs.readFileSync(PAGE, 'utf8'); } catch (_) { /* placeholder */ }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(page) });
    return res.end(page);
  }
  if (p === '/ota') {
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const type = String(req.headers['ota-type'] || '');
    const isGif = GIF_SLOTS.includes(type);
    const cap = type === 'ota_fw' ? OTA_CAPS.ota_fw : type === 'ota_img' ? OTA_CAPS.ota_img : isGif ? OTA_CAPS.gif : null;
    if (cap === null) { await readBody(req, 1 << 20); log({ ev: 'ota_unknown_type', detail: type }); res.writeHead(400); return res.end('unknown OTA-Type'); }
    const { bytes, over, body } = await readBody(req, cap);
    const rtype = type === 'ota_fw' ? 'ota_fw' : 'ota_img';
    if (over || knobFlag('PS_OTA_REFUSE')) {
      log({ ev: 'ota_refused', detail: `${type} ${bytes}B${over ? ' over cap' : ''}` });
      response('all', rtype, false, isGif ? { gif: type } : undefined);
      res.writeHead(over ? 413 : 500); return res.end('refused');
    }
    log({ ev: 'ota_accepted', detail: `${type} ${bytes}B` });
    if (isGif) { STATE.__mock.gif_uploads[type] = bytes; (STATE.__mock.gif_sha256 = STATE.__mock.gif_sha256 || {})[type] = crypto.createHash('sha256').update(body).digest('hex'); }
    if (type === 'ota_img') STATE.settings.img_version = STATE.__mock.next_img_version;
    response('all', rtype, true, isGif ? { gif: type } : undefined);
    res.writeHead(200); return res.end('ok');
  }
  // everything else: captive portal redirect
  res.writeHead(302, { Location: `http://${req.headers.host || 'mock'}/` });
  return res.end('captive portal redirect');
}

// ---------------------------------------------------------------------------------------
// Sockets
// ---------------------------------------------------------------------------------------

function onConnection(ws) {
  if (booting) { log({ ev: 'upgrade_refused', detail: 'booting' }); try { ws.close(1013, 'booting'); } catch (_) {} return; }
  sockets.add(ws);
  const deaf = knobNum('PS_DEAF', 0);
  const delay = Math.max(deaf, knobNum('PS_DELAY', 0));
  const connectedAt = Date.now();
  log({ ev: 'connect', detail: `clients=${sockets.size}${deaf ? ` deaf=${deaf}` : ''}${delay ? ` delay=${delay}` : ''}` });

  if (!knobFlag('PS_NO_PUSH')) {
    later(delay, () => {
      if (!sockets.has(ws)) return;
      push(ws, fullDocument(), 'connect');
      if (knobFlag('PS_MALFORMED')) later(50, () => sendRaw(ws, '{"settings":{"current_mode":', { why: 'malformed' }));
      if (knobFlag('PS_THEME_ON_CONNECT')) later(60, () => push(ws, { ws_theme: JSON.parse(JSON.stringify(STATE.__mock.ws_theme)) }, 'theme'));
    });
  } else log({ ev: 'push_suppressed', detail: 'PS_NO_PUSH' });

  const drop = knobNum('PS_DROP_AFTER', 0);
  if (drop > 0) later(drop, () => { if (sockets.has(ws)) { log({ ev: 'drop', detail: 'PS_DROP_AFTER' }); ws.terminate(); } });

  const off = knobNum('PS_PRINTER_OFFLINE_AFTER', 0);
  if (off > 0) later(off, () => { if (sockets.has(ws)) { STATE.printer.state = 2; pushAfterChange(ws, ['printer']); } });

  ws.on('message', (data) => {
    if (Date.now() - connectedAt < deaf) { log({ ev: 'inbound_dropped', detail: 'deaf' }); return; }
    handleInbound(ws, data.toString('utf8'));
  });
  ws.on('close', () => { sockets.delete(ws); log({ ev: 'close', detail: `clients=${sockets.size}` }); });
  ws.on('error', () => { sockets.delete(ws); });
}

// ---------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------

function main() {
  STATE = loadFixture(FIXTURE);
  if (!STATE.__mock) throw new Error('fixture has no __mock section');
  const server = http.createServer((req, res) => { handleHttp(req, res).catch((e) => { log({ ev: 'http_error', detail: String(e) }); try { res.writeHead(500); res.end(); } catch (_) {} }); });
  if (!flag('PS_NO_WS')) {
    const wss = new WebSocketServer({ server, path: '/ws' });
    wss.on('connection', onConnection);
  } else log({ ev: 'no_ws', detail: 'PS_NO_WS: upgrades will be refused' });
  server.listen(PORT, '127.0.0.1', () => {
    log({ ev: 'listening', detail: `http://127.0.0.1:${PORT}  fixture=${path.relative(ROOT, FIXTURE)}  page=${fs.existsSync(PAGE) ? path.relative(ROOT, PAGE) : 'placeholder'}` });
  });
  const stop = () => { clearTimers(); for (const ws of sockets) { try { ws.terminate(); } catch (_) {} } server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 300); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}

main();
