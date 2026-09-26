#!/usr/bin/env node
'use strict';
/*
 * Mock Panda Vent, the other end of the bridge in docs/PANDAVENT-BRIDGE.md.
 *
 * The bridge is a protocol between two devices this family owns. The document is the
 * contract; this is the vent side of it, written first and on purpose, because the order of
 * work in that document is: the document, then the mock vent, then the PandaStatusOS side
 * against the mock, and the real vent is not touched during any of it.
 *
 * It is a peer, not a page: nothing here serves a UI. It answers two things.
 *
 *   GET /bridge/id    the same fields the mDNS TXT record carries, for manual binding
 *   WS  /bridge       the socket, JSON text frames, one root per frame, each with a seq
 *
 * And it speaks the exchange the contract describes:
 *
 *   hello    both ways, with a nonce each; the vent answers pair:true when it holds no
 *            token for that identity, and after pairing every hello carries
 *            auth = sha256(token ‖ nonce_peer), so the token itself never travels
 *   pair     {confirm:true} from each end; both then store the same token
 *   vent     vent to status, the state, the policy override, the chamber and any error,
 *            on every change and at least every PV_PERIOD_MS
 *   vent     status to vent, {command:"open"|"close"|"policy",...}, answered with ack and
 *            then the state it actually reached
 *   light    status to vent, recorded here, so coordinated lighting can be asserted
 *   ack/bye  as the contract writes them
 *
 * How it lies. All of these exist so the status side can be built against a vent that is
 * not behaving, which is the only way to find out what the page does then.
 *
 *   PV_SLOW=<ms>        every answer is delayed by this much
 *   PV_SILENT=1         the socket opens and the vent never speaks: no hello, no frames
 *   PV_GONE=1           the socket is refused outright (and /bridge/id 503)
 *   PV_WRONG_ID=<hex>   /bridge/id answers one identity and the socket claims another
 *   PV_WRONG_TOKEN=1    every auth is treated as wrong, so a paired peer is turned away
 *   PV_NO_PAIR=1        pairing is refused: hello answers bye{reason:"unpaired"}
 *   PV_DROP_AFTER=<n>   the socket closes after n frames have been sent
 *   PV_NO_ACK=1         commands are obeyed and never acknowledged
 *
 * Knobs for what it reports:
 *   PV_STATE=open|closed|sealing|moving|unknown     (default closed)
 *   PV_CHAMBER=<c>            chamber temperature, default 28.5; -1000 means "not reported"
 *   PV_OVERRIDE=1             the policy is overriding, with PV_OVERRIDE_REASON
 *   PV_ERROR=<code>           a short code instead of null
 *   PV_PERIOD_MS=<ms>         the heartbeat, default 30000
 *   PV_ID=<16 hex>            this vent's identity, default deterministic from the port
 *   PV_NAME=<name>            its hostname, default "pandaventos"
 *   PV_CAPS=a,b,c             what it says it can consume and produce
 *
 * Debug, not protocol, in the shape mockdev.js uses:
 *   GET  /__state    what the vent believes right now
 *   GET  /__sent     every frame it has received, in order, parsed
 *   POST /__reset    back to the fixture state, the log cleared, any pairing forgotten
 *   POST /__knob     {name, value} at runtime
 *
 *   PV_PORT=8299 node tools/ui/mock/mockvent.js
 */
const http = require('http');
const crypto = require('crypto');

let WebSocketServer = null;
try { ({ WebSocketServer } = require('ws')); }
catch (e) {
  console.error('mockvent: the "ws" package is not resolvable. Run tools/ui/harness/run.sh, which sets NODE_PATH, or install it under private/uiwork/.');
  process.exit(2);
}

const env = (k, d) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d);
const KNOBS = {};
const knob = (k, d) => (KNOBS[k] !== undefined ? KNOBS[k] : env(k, d));
const knobNum = (k, d) => Number(knob(k, d));
const knobFlag = (k) => ['1', 'true', 'yes'].includes(String(knob(k, '')).toLowerCase());

const PORT = Number(env('PV_PORT', 8299));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
/* Deterministic, so a harness can assert an identity without reading it first, and distinct
   per port, so two mock vents on one machine are two vents. */
const ID = String(knob('PV_ID', sha('pandabridge-mock-vent-' + PORT).slice(0, 16)));
const NAME = String(knob('PV_NAME', 'pandaventos'));
const VER = 1;
const CAPS = String(knob('PV_CAPS', 'vent_state,light,printer_state,backup')).split(',').filter(Boolean);

const t0 = Date.now();
const log = (o) => { if (!knobFlag('PV_QUIET')) console.log(JSON.stringify(Object.assign({ t: Date.now() - t0 }, o))); };

/* ---------------------------------------------------------------------------------------
 * State
 * ------------------------------------------------------------------------------------- */
const FRESH = () => ({
  state: String(knob('PV_STATE', 'closed')),
  chamber_c: Number(knob('PV_CHAMBER', 28.5)),
  override: knobFlag('PV_OVERRIDE'),
  reason: String(knob('PV_OVERRIDE_REASON', 'material')),
  error: knob('PV_ERROR', '') || null,
  /* identity -> token. A real vent keeps this in NVS; here it lives as long as the process,
     and /__reset forgets it, which is what "unpair" looks like from the other side. */
  tokens: {},
  light: null,          // the last light frame the status side sent
  seq: 0,
});
let STATE = FRESH();
const SENT = [];        // every frame RECEIVED, parsed, oldest first
const sockets = new Set();

const later = (ms, fn) => setTimeout(fn, ms);
const slow = () => knobNum('PV_SLOW', 0);

function send(ws, root, body) {
  if (!ws || ws.readyState !== 1) return;
  STATE.seq += 1;
  const frame = { [root]: Object.assign({ seq: STATE.seq }, body) };
  const text = JSON.stringify(frame);
  const go = () => {
    if (ws.readyState !== 1) return;
    ws.send(text);
    log({ ev: 'out', root, detail: text.slice(0, 120) });
    const cap = knobNum('PV_DROP_AFTER', 0);
    if (cap > 0 && STATE.seq >= cap) { log({ ev: 'drop', detail: 'PV_DROP_AFTER' }); ws.close(); }
  };
  if (slow() > 0) later(slow(), go); else go();
}

/* The contract's own two derivations, written once so the harness and the firmware can be
   checked against the same arithmetic rather than against each other. */
const pairCode = (na, nb, ia, ib) => String(BigInt('0x' + sha(na + nb + ia + ib)) % 1000000n).padStart(6, '0');
const pairToken = (na, nb, ia, ib) => sha(na + nb + ia + ib + 'pandabridge');

/* Per socket: the exchange in progress. */
function fresh(ws) {
  ws._peer = null;          // the identity the other end claims
  ws._myNonce = crypto.randomBytes(16).toString('hex');
  ws._peerNonce = null;
  ws._paired = false;       // this socket has proved it holds the token
  ws._pending = null;       // the token both ends would store if they confirm
  ws._confirmed = false;    // this end has seen the peer's pair{confirm}
}

function ventBody() {
  const b = {
    state: STATE.state,
    policy: { override: !!STATE.override, reason: STATE.override ? STATE.reason : null },
    error: STATE.error,
  };
  /* A vent that has not read its chamber leaves the field out rather than sending a zero,
     which is the same rule the status device keeps for a temperature it has not been told. */
  if (STATE.chamber_c > -1000) b.chamber_c = STATE.chamber_c;
  return b;
}

function pushVent(ws) { send(ws, 'vent', ventBody()); }

function handle(ws, text) {
  /* PV_SILENT is read here, at the moment of answering, rather than at start-up: a harness
     can then turn a talking vent silent with /__knob and watch what the other side does
     about it, which is the case that matters and the one a start-up flag cannot reach. The
     frame is still recorded, because a vent that heard and said nothing and a vent that
     never heard are different faults. */
  if (knobFlag('PV_SILENT')) {
    let f = null; try { f = JSON.parse(text); } catch (e) { f = null; }
    SENT.push({ t: Date.now() - t0, text, frame: f, roots: f ? Object.keys(f) : [], error: 'dropped: PV_SILENT' });
    log({ ev: 'in_dropped', detail: 'PV_SILENT' });
    return;
  }
  let frame;
  try { frame = JSON.parse(text); }
  catch (e) { SENT.push({ t: Date.now() - t0, text, error: 'not json' }); log({ ev: 'in_unparsable' }); return; }
  const roots = Object.keys(frame);
  const rec = { t: Date.now() - t0, text, frame, roots };
  SENT.push(rec);
  if (roots.length !== 1) { rec.error = 'expected one root'; log({ ev: 'in_multi_root' }); return; }
  const root = roots[0], body = frame[root] || {};
  log({ ev: 'in', root, detail: JSON.stringify(body).slice(0, 140) });

  if (root === 'hello') {
    if (knobFlag('PV_NO_PAIR') && !STATE.tokens[body.id]) { send(ws, 'bye', { reason: 'unpaired' }); return ws.close(); }
    ws._peer = String(body.id || '');
    ws._peerNonce = String(body.nonce || '');
    const held = STATE.tokens[ws._peer];
    if (held) {
      /* Paired already: the peer proves it by the auth it computed over the nonce THIS end
         sent last time... which on a fresh socket it cannot have, so the order in the
         contract is hello(status) -> hello(vent) -> the status side proves itself on its
         next hello. The mock accepts an auth over either nonce it has seen, and refuses
         everything when PV_WRONG_TOKEN is set. */
      const want = sha(held + ws._myNonce);
      const alt = sha(held + ws._peerNonce);
      const ok = !knobFlag('PV_WRONG_TOKEN') && (body.auth === want || body.auth === alt);
      if (body.auth !== undefined && !ok) { send(ws, 'bye', { reason: 'unpaired' }); return ws.close(); }
      ws._paired = ok;
    } else {
      ws._pending = pairToken(ws._peerNonce, ws._myNonce, ws._peer, ID);
      ws._code = pairCode(ws._peerNonce, ws._myNonce, ws._peer, ID);
      log({ ev: 'pair_code', detail: ws._code });
    }
    send(ws, 'hello', {
      ver: VER,
      id: knobFlag('PV_WRONG_ID') ? String(knob('PV_WRONG_ID', 'deadbeefdeadbeef')) : ID,
      kind: 'vent',
      name: NAME,
      nonce: ws._myNonce,
      auth: held ? sha(held + ws._peerNonce) : undefined,
      pair: held ? undefined : true,
      caps: CAPS,
    });
    if (ws._paired) pushVent(ws);
    return;
  }

  if (root === 'pair') {
    if (!ws._pending) { send(ws, 'ack', { seq: body.seq, ok: false }); return; }
    if (body.confirm === true) {
      STATE.tokens[ws._peer] = ws._pending;
      ws._paired = true;
      ws._confirmed = true;
      log({ ev: 'paired', detail: ws._peer });
      send(ws, 'pair', { confirm: true });
      pushVent(ws);
    }
    return;
  }

  /* Everything past here needs a paired socket. A real vent must not take a command from
     something that has not proved it holds the token. */
  if (!ws._paired) { send(ws, 'bye', { reason: 'unpaired' }); return ws.close(); }

  if (root === 'vent') {
    const cmd = body.command;
    if (cmd === 'open' || cmd === 'close') {
      if (!knobFlag('PV_NO_ACK')) send(ws, 'ack', { seq: body.seq, ok: true });
      /* Moving first, then where it got to: a flap takes time, and a page that never sees
         the moving state is a page that cannot show it. */
      STATE.state = 'moving';
      pushVent(ws);
      later(knobNum('PV_MOVE_MS', 150), () => {
        STATE.state = cmd === 'open' ? 'open' : 'closed';
        for (const s of sockets) if (s._paired) pushVent(s);
      });
      return;
    }
    if (cmd === 'policy') {
      const want = body.override;
      if (want !== true && want !== false) { send(ws, 'ack', { seq: body.seq, ok: false }); return; }
      STATE.override = want;
      if (!knobFlag('PV_NO_ACK')) send(ws, 'ack', { seq: body.seq, ok: true });
      for (const s of sockets) if (s._paired) pushVent(s);
      return;
    }
    send(ws, 'ack', { seq: body.seq, ok: false });
    return;
  }

  if (root === 'light') {
    STATE.light = body;
    if (!knobFlag('PV_NO_ACK')) send(ws, 'ack', { seq: body.seq, ok: true });
    return;
  }

  /* A root this vent does not know is not a reason to close: the contract says a device
     sends only the roots the peer listed in caps, so an unknown one is a fault on the other
     side and worth reporting rather than hiding. */
  log({ ev: 'in_unknown_root', detail: root });
}

/* ---------------------------------------------------------------------------------------
 * HTTP and the socket
 * ------------------------------------------------------------------------------------- */
const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'vent'}`);
  const p = u.pathname;
  const json = (o, code) => { res.writeHead(code || 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(o)); };

  if (p === '/__state') return json({ id: ID, name: NAME, kind: 'vent', ver: VER, caps: CAPS, state: STATE });
  if (p === '/__sent') return json(SENT);
  if (p === '/__reset' && req.method === 'POST') { STATE = FRESH(); SENT.length = 0; log({ ev: 'reset' }); res.writeHead(200); return res.end('ok'); }
  if (p === '/__knob' && req.method === 'POST') {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => {
      try { const k = JSON.parse(b); KNOBS[k.name] = k.value; log({ ev: 'knob', detail: `${k.name}=${k.value}` }); res.writeHead(200); res.end('ok'); }
      catch (e) { res.writeHead(400); res.end('bad knob'); }
    });
    return;
  }

  if (knobFlag('PV_GONE')) { res.writeHead(503); return res.end('gone'); }

  if (p === '/bridge/id') {
    const doc = { id: knobFlag('PV_WRONG_ID') ? String(knob('PV_WRONG_ID', 'deadbeefdeadbeef')) : ID, kind: 'vent', ver: VER, name: NAME };
    if (slow() > 0) return later(slow(), () => json(doc));
    return json(doc);
  }
  /* Anything else. A vent is not a web page and does not pretend to be one. */
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('no page here; this is a vent\n');
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const p = new URL(req.url, 'http://vent').pathname;
  if (p !== '/bridge' || knobFlag('PV_GONE')) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    fresh(ws);
    sockets.add(ws);
    log({ ev: 'open', detail: `sockets=${sockets.size}` });
    ws.on('message', (d) => handle(ws, d.toString()));
    ws.on('close', () => { sockets.delete(ws); log({ ev: 'close' }); });
    ws.on('error', () => {});
    /* The vent does not speak first. The contract has the status side send hello, and a
       vent that greeted an unauthenticated socket would be telling anything that connects
       what it is. PV_SILENT is the same silence taken further: no answers either. */
  });
});

/* The heartbeat: at least one vent frame every PV_PERIOD_MS to every paired socket, so a
   status device can tell "nothing has changed" from "nothing is there".
   
   A short ticker reading the knob each time, rather than an interval set once from it: the
   period is a knob, and a knob that can only be set before the process starts cannot be used
   to watch what happens when a vent goes quiet mid-conversation. */
let lastBeat = 0;
setInterval(() => {
  if (knobFlag('PV_SILENT')) return;
  if (Date.now() - lastBeat < Math.max(250, knobNum('PV_PERIOD_MS', 30000))) return;
  lastBeat = Date.now();
  for (const ws of sockets) if (ws._paired) pushVent(ws);
}, 200);

server.listen(PORT, '127.0.0.1', () => {
  log({ ev: 'listening', detail: `http://127.0.0.1:${PORT} id=${ID} name=${NAME}` });
});
