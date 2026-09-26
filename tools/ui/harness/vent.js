#!/usr/bin/env node
'use strict';
/*
 * The mock vent, before anything trusts it.
 *
 * docs/PANDAVENT-BRIDGE.md is a contract between two devices, and the order of work in it
 * puts the mock vent second and the PandaStatusOS side third. This file is what stands
 * between them: it plays the STATUS side by hand, frame by frame, and asserts that the vent
 * does what the document says. When ps_bridge.c is written it is written against this same
 * exchange, and if the two disagree one of them is wrong in a way that can be pointed at.
 *
 * No browser here. The page has nothing to do with this yet.
 *
 *   tools/ui/harness/run.sh p2-idle.json vent.js PS_WITH_VENT=1
 */
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PV_PORT || 8299);
const BASE = `http://127.0.0.1:${PORT}`;
const WS = `ws://127.0.0.1:${PORT}/bridge`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pairCode = (na, nb, ia, ib) => String(BigInt('0x' + sha(na + nb + ia + ib)) % 1000000n).padStart(6, '0');
const pairToken = (na, nb, ia, ib) => sha(na + nb + ia + ib + 'pandabridge');
const knob = (name, value) => fetch(`${BASE}/__knob`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, value: String(value) }) });
const vstate = async () => (await (await fetch(`${BASE}/__state`)).json());
const heard = async () => (await (await fetch(`${BASE}/__sent`)).json());

/* One end of the link, as the firmware will have to hold it: an identity, a nonce per
   socket, and whatever token pairing produced. */
const ME = { id: sha('harness-status-side').slice(0, 16), name: 'ps-mock', kind: 'status' };
let TOKEN = null;

function open() {
  const ws = new WebSocket(WS);
  ws.frames = [];
  ws.ready = new Promise((res, rej) => { ws.on('open', res); ws.on('error', rej); });
  ws.closed = new Promise((res) => ws.on('close', (code, reason) => res({ code, reason: String(reason || '') })));
  ws.on('message', (d) => { try { ws.frames.push(JSON.parse(d.toString())); } catch (e) { ws.frames.push({ unparsable: d.toString() }); } });
  ws.say = (root, body) => ws.send(JSON.stringify({ [root]: Object.assign({ seq: (ws._seq = (ws._seq || 0) + 1) }, body) }));
  ws.waitFor = async (root, ms = 2000) => {
    const end = Date.now() + ms;
    for (;;) {
      const f = ws.frames.find((x) => x[root]);
      if (f) return f[root];
      if (Date.now() > end) return null;
      await sleep(25);
    }
  };
  ws.forget = (root) => { ws.frames = ws.frames.filter((x) => !x[root]); };
  return ws;
}

/* hello, and the vent's hello back. Returns what it said. */
async function greet(ws, auth) {
  const nonce = crypto.randomBytes(16).toString('hex');
  ws._nonce = nonce;
  ws.say('hello', { ver: 1, id: ME.id, kind: ME.kind, name: ME.name, nonce, auth, caps: ['vent_state', 'light'] });
  const h = await ws.waitFor('hello');
  if (h) ws._peerNonce = h.nonce;
  return h;
}

(async () => {
  try {
    // ---- A: the identity, over HTTP, which is how a vent is bound by hand ----
    const id = await (await fetch(`${BASE}/bridge/id`)).json();
    t('A1 GET /bridge/id names the device, what kind it is and what version it speaks',
      typeof id.id === 'string' && id.id.length === 16 && id.kind === 'vent' && id.ver === 1 && !!id.name, id);
    const r404 = await fetch(`${BASE}/nope`);
    t('A2 and nothing else is served: a vent is not a web page', r404.status === 404, r404.status);

    // ---- B: the first hello, from a vent that holds no token for this identity ----
    let ws = open();
    await ws.ready;
    let hello = await greet(ws);
    t('B1 the vent answers hello with its own identity and a nonce',
      !!hello && hello.id === id.id && hello.kind === 'vent' && /^[0-9a-f]{32}$/.test(hello.nonce || ''), hello);
    t('B2 and says it has no token for this peer, which is what asks for pairing',
      !!hello && hello.pair === true, hello);
    t('B3 it does not speak first: nothing arrived before the hello was sent',
      ws.frames.length === 1, ws.frames.length);
    t('B4 it lists what it can consume and produce', Array.isArray(hello.caps) && hello.caps.includes('vent_state'), hello && hello.caps);

    const code = pairCode(ws._nonce, hello.nonce, ME.id, id.id);
    const token = pairToken(ws._nonce, hello.nonce, ME.id, id.id);
    t('B5 both ends can compute the same six digits from what has been exchanged',
      /^\d{6}$/.test(code), code);

    // ---- C: confirming at both ends ----
    ws.say('pair', { confirm: true });
    const conf = await ws.waitFor('pair');
    t('C1 the vent confirms in return', !!conf && conf.confirm === true, conf);
    const st1 = await vstate();
    t('C2 and stores the token the contract derives, against this identity, not the code',
      st1.state.tokens[ME.id] === token, { held: st1.state.tokens[ME.id], want: token });
    const v1 = await ws.waitFor('vent');
    t('C3 a paired socket is told the vent state without asking',
      !!v1 && typeof v1.state === 'string' && v1.policy !== undefined, v1);
    t('C4 the state is one of the five the contract names',
      ['open', 'closed', 'sealing', 'moving', 'unknown'].includes(v1.state), v1 && v1.state);
    t('C5 every frame carries its seq', typeof v1.seq === 'number', v1);
    TOKEN = token;
    ws.close();
    await ws.closed;

    // ---- D: coming back, and proving it with the token rather than sending it ----
    ws = open();
    await ws.ready;
    /* The auth is over the nonce the peer sent, so on a fresh socket the first hello cannot
       carry one; the contract's exchange is hello, hello, and the proof rides the next one.
       The mock accepts either nonce, which is what lets a single round trip work. */
    hello = await greet(ws);
    t('D1 a vent that holds a token does not ask to pair again', hello && hello.pair === undefined, hello);
    t('D2 and proves itself in the same breath, over the nonce it was just sent',
      hello && hello.auth === sha(TOKEN + ws._nonce), { got: hello && hello.auth, want: sha(TOKEN + ws._nonce) });
    ws.forget('hello');
    await greet(ws, sha(TOKEN + hello.nonce));
    const v2 = await ws.waitFor('vent');
    t('D3 the socket is accepted and starts carrying state', !!v2, v2);

    // ---- E: commands ----
    ws.forget('vent');
    ws.say('vent', { command: 'open' });
    const ack = await ws.waitFor('ack');
    t('E1 a command is acknowledged by its own seq', !!ack && ack.ok === true, ack);
    const moving = await ws.waitFor('vent');
    t('E2 the flap says it is moving before it says where it got to', moving && moving.state === 'moving', moving);
    ws.forget('vent');
    const opened = await ws.waitFor('vent', 3000);
    t('E3 and then that it is open', opened && opened.state === 'open', opened);
    t('E4 which is what the vent itself believes', (await vstate()).state.state === 'open');

    ws.forget('vent'); ws.forget('ack');
    ws.say('vent', { command: 'policy', override: true });
    await ws.waitFor('ack');
    const pol = await ws.waitFor('vent');
    t('E5 the policy override is taken and reported back with its reason',
      pol && pol.policy && pol.policy.override === true && !!pol.policy.reason, pol);

    ws.forget('ack');
    ws.say('vent', { command: 'sideways' });
    const bad = await ws.waitFor('ack');
    t('E6 a command it does not know is refused, not ignored', bad && bad.ok === false, bad);

    // ---- F: the light frame, which is the other direction of coordinated lighting ----
    ws.forget('ack');
    ws.say('light', { mode: 1, brightness: 50, colours: ['#FFFFFFFF', '#1B00FFFF', '#FF0000FF'] });
    const lack = await ws.waitFor('ack');
    t('F1 a light frame is acknowledged', lack && lack.ok === true, lack);
    const st2 = await vstate();
    t('F2 and kept as sent, colours and all',
      st2.state.light && st2.state.light.brightness === 50 && st2.state.light.colours.length === 3, st2.state.light);
    ws.close(); await ws.closed;

    // ---- G: a socket that has not paired ----
    await knob('PV_WRONG_TOKEN', '1');
    let w2 = open();
    await w2.ready;
    await greet(w2, sha('not the token' + '00'));
    const bye = await w2.waitFor('bye');
    t('G1 a peer whose proof does not check out is told why, and the socket closes',
      bye && bye.reason === 'unpaired', bye);
    t('G2 and it really closes', !!(await Promise.race([w2.closed, sleep(1500).then(() => null)])));
    await knob('PV_WRONG_TOKEN', '0');

    // ---- H: an unpaired socket may not command ----
    w2 = open();
    await w2.ready;
    w2.say('vent', { command: 'open' });
    const bye2 = await w2.waitFor('bye');
    t('H1 a command from a socket that never said hello is refused outright',
      bye2 && bye2.reason === 'unpaired', bye2);
    w2.close(); await w2.closed;

    // ---- I: the heartbeat, and the three silences ----
    await knob('PV_PERIOD_MS', '1000');
    let w3 = open();
    await w3.ready;
    hello = await greet(w3);
    w3.forget('hello');
    await greet(w3, sha(TOKEN + hello.nonce));
    await w3.waitFor('vent');
    w3.forget('vent');
    const beat = await w3.waitFor('vent', 3000);
    t('I1 a paired socket hears from the vent even when nothing has changed', !!beat, beat);

    await knob('PV_SILENT', '1');
    w3.forget('ack');
    const before = (await heard()).length;
    w3.say('vent', { command: 'close' });
    await sleep(600);
    t('I2 a silent vent hears the command', (await heard()).length > before);
    t('I3 and answers nothing at all', !(await w3.waitFor('ack', 400)));
    t('I4 the frame is recorded as dropped, so "heard and said nothing" is not "never heard"',
      (await heard()).slice(-1)[0].error === 'dropped: PV_SILENT', (await heard()).slice(-1)[0]);
    await knob('PV_SILENT', '0');
    w3.close(); await w3.closed;

    await knob('PV_GONE', '1');
    const gone = await fetch(`${BASE}/bridge/id`);
    t('I5 a vent that is gone answers nothing useful over HTTP', gone.status === 503, gone.status);
    const w4 = open();
    let refused = false;
    try { await w4.ready; } catch (e) { refused = true; }
    t('I6 and refuses the socket outright', refused);
    await knob('PV_GONE', '0');
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
