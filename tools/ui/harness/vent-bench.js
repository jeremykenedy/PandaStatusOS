#!/usr/bin/env node
'use strict';
/*
 * The bench: the status side of the bridge played by hand against a REAL vent running
 * PandaVentOS with its bridge half, by address. Nothing here needs the mock's debug routes;
 * it speaks only the contract (docs/PANDAVENT-BRIDGE.md), which is the point: the vent's
 * half was written against the mock vent's behaviour, and this holds the vent to the same
 * exchange from the outside, frame by frame, before the status device is bound to it.
 *
 *   NODE_PATH=private/uiwork/node_modules PV_URL=http://<vent address> node tools/ui/harness/vent-bench.js
 *
 * What it does to the vent: pairs with it under a throwaway identity (the vent then holds a
 * token for that identity; PV_ID sets it, so a second run reuses it), opens and closes the
 * flap once, and asks for its light and its effect. It does not change any setting.
 *
 *   PV_ID=<16 hex>     the identity to pair under (default: a fixed bench identity)
 *   PV_NO_MOVE=1       skip the open/close commands (a vent on a printer mid-print)
 */
const crypto = require('crypto');
const WebSocket = require('ws');
const URL_ = String(process.env.PV_URL || '').replace(/\/+$/, '');
if (!URL_) { console.log('PV_URL=http://<vent> is required'); process.exit(2); }
const WSURL = URL_.replace(/^http/, 'ws') + '/bridge';
const ME = String(process.env.PV_ID || 'b3bc0000b3bc0001');   // 16 hex: the vent checks the shape
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const pairCode = (na, nb, ia, ib) => String(BigInt('0x' + sha(na + nb + ia + ib)) % 1000000n).padStart(6, '0');
const pairToken = (na, nb, ia, ib) => sha(na + nb + ia + ib + 'pandabridge');

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* one socket, with a queue of received frames and a "wait for a root" helper */
function open() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WSURL);
    const q = [];
    const waiters = [];
    let seq = 0;
    ws.on('message', (d) => {
      let f = null; try { f = JSON.parse(d.toString()); } catch (e) { return; }
      const root = Object.keys(f)[0];
      const w = waiters.findIndex((x) => x.root === root);
      if (w >= 0) { const x = waiters.splice(w, 1)[0]; clearTimeout(x.timer); x.resolve(f[root]); }
      else q.push(f);
    });
    ws.on('error', (e) => reject(e));
    ws.on('open', () => resolve({
      ws,
      send: (root, body) => { seq += 1; const frame = { [root]: Object.assign({ seq }, body) }; ws.send(JSON.stringify(frame)); return seq; },
      expect: (root, ms = 4000) => new Promise((res) => {
        const i = q.findIndex((f) => Object.keys(f)[0] === root);
        if (i >= 0) { const f = q.splice(i, 1)[0]; return res(f[root]); }
        const timer = setTimeout(() => { const j = waiters.findIndex((x) => x.resolve === res); if (j >= 0) waiters.splice(j, 1); res(null); }, ms);
        waiters.push({ root, resolve: res, timer });
      }),
      close: () => { try { ws.close(); } catch (e) {} },
    }));
  });
}

(async () => {
  try {
    // ---- A. the identity over HTTP ----
    const idDoc = await (await fetch(`${URL_}/bridge/id`)).json();
    t('A1 /bridge/id answers an identity, kind vent, a name', /^[0-9a-f]{16}$/.test(idDoc.id || '') && idDoc.kind === 'vent' && typeof idDoc.name === 'string' && idDoc.name.length > 0, idDoc);
    const VENT = idDoc.id;

    // ---- B. the first hello: a stranger is offered a pairing ----
    let c = await open();
    const na = crypto.randomBytes(16).toString('hex');
    c.send('hello', { ver: 1, id: ME, kind: 'status', name: 'bench', nonce: na, caps: ['vent_state', 'light'] });
    let h = await c.expect('hello');
    t('B1 the vent answers with its one hello: its identity, a nonce, pair:true', !!h && h.id === VENT && /^[0-9a-f]{32}$/.test(h.nonce || '') && h.pair === true && h.kind === 'vent', h);
    const nb = h ? h.nonce : '';
    const code = pairCode(na, nb, ME, VENT), token = pairToken(na, nb, ME, VENT);
    console.log(`        the six digits this end computes: ${code} (the vent logs the same)`);
    t('B2 nothing arrives until this end confirms', (await c.expect('vent', 1200)) === null);

    // ---- C. confirm: both store the token, the vent starts reporting ----
    c.send('pair', { confirm: true });
    const pc = await c.expect('pair');
    t('C1 the vent confirms back', !!pc && pc.confirm === true, pc);
    let v = await c.expect('vent');
    t('C2 and sends its state: one of the five words, a policy, an error field', !!v && ['open', 'closed', 'sealing', 'moving', 'unknown'].includes(v.state) && v.policy && typeof v.policy.override === 'boolean' && 'error' in v, v);
    console.log(`        vent: ${v && v.state}, chamber ${v && v.chamber_c}, override ${v && v.policy && v.policy.override}, error ${v && v.error}`);

    // ---- D. the two asks the copies are made of ----
    c.send('light', { request: true });
    const l = await c.expect('light');
    t('D1 light: mode, brightness, three colours as #RRGGBBAA', !!l && l.mode === 1 && Number.isInteger(l.brightness) && Array.isArray(l.colours) && l.colours.length === 3 && l.colours.every((x) => /^#[0-9A-Fa-f]{8}$/.test(x)), l);
    c.send('fx', { request: true, state: 1 });
    const fx = await c.expect('fx');
    t('D2 fx: the printing state\'s effect, by NAME, with its timing, options and four colours', !!fx && fx.state === 1 && typeof fx.name === 'string' && Number.isInteger(fx.effect) && Number.isInteger(fx.brightness) && Number.isInteger(fx.speed) && Number.isInteger(fx.opt) && Array.isArray(fx.colours) && fx.colours.length === 4, fx);
    console.log(`        printing effect: ${fx && fx.name} (vent id ${fx && fx.effect}), opt ${fx && fx.opt}, colours ${fx && fx.colours && fx.colours.join(' ')}`);
    c.send('fx', { request: true, state: 7 });
    const bad = await c.expect('ack');
    t('D3 a state that does not exist is refused with an ack, not answered', !!bad && bad.ok === false, bad);

    // ---- E. the commands ----
    if (!process.env.PV_NO_MOVE) {
      const before = v ? v.state : null;
      const cmd = before === 'open' ? 'close' : 'open';
      const s1 = c.send('vent', { command: cmd });
      const a1 = await c.expect('ack');
      t(`E1 ${cmd}: acknowledged`, !!a1 && a1.ok === true && a1.seq === s1, a1);
      let seen = [];
      const end = Date.now() + 12000;
      while (Date.now() < end) { const f = await c.expect('vent', 1500); if (!f) continue; seen.push(f.state); if (f.state === (cmd === 'open' ? 'open' : 'closed')) break; }
      t(`E2 the flap reports moving, then where it got to`, seen.includes(cmd === 'open' ? 'open' : 'closed'), seen);
      console.log(`        states seen: ${seen.join(' > ')}`);
      const back = cmd === 'open' ? 'close' : 'open';
      const s2 = c.send('vent', { command: back });
      const a2 = await c.expect('ack');
      t(`E3 ${back} again: acknowledged`, !!a2 && a2.ok === true && a2.seq === s2, a2);
      seen = [];
      const end2 = Date.now() + 12000;
      while (Date.now() < end2) { const f = await c.expect('vent', 1500); if (!f) continue; seen.push(f.state); if (f.state === (back === 'open' ? 'open' : 'closed')) break; }
      t('E4 and it comes back', seen.includes(back === 'open' ? 'open' : 'closed'), seen);
    } else {
      console.log('  skip  E1..E4 (PV_NO_MOVE)');
    }
    const s3 = c.send('vent', { command: 'dance' });
    const a3 = await c.expect('ack');
    t('E5 a command the vent does not know is refused, not ignored', !!a3 && a3.ok === false && a3.seq === s3, a3);
    c.close();
    await sleep(300);

    // ---- F. a returning peer: the token never travels, a proof does ----
    c = await open();
    const na2 = crypto.randomBytes(16).toString('hex');
    c.send('hello', { ver: 1, id: ME, kind: 'status', name: 'bench', nonce: na2, auth: sha(token + na2), caps: ['vent_state', 'light'] });
    h = await c.expect('hello');
    t('F1 the vent knows this identity: no pair, a proof over the nonce this end sent', !!h && h.pair === undefined && h.auth === sha(token + na2), h);
    c.send('hello', { ver: 1, id: ME, kind: 'status', name: 'bench', nonce: na2, auth: sha(token + (h ? h.nonce : '')), caps: ['vent_state', 'light'] });
    v = await c.expect('vent');
    t('F2 the second hello, proved over the vent\'s nonce, is answered with the state, not a third hello', !!v && typeof v.state === 'string', v);
    t('F3 and no hello follows', (await c.expect('hello', 1000)) === null);
    c.close();
    await sleep(300);

    // ---- G. a wrong token is turned away ----
    c = await open();
    const na3 = crypto.randomBytes(16).toString('hex');
    c.send('hello', { ver: 1, id: ME, kind: 'status', name: 'bench', nonce: na3, auth: sha('not-the-token' + na3), caps: [] });
    const bye = await c.expect('bye');
    t('G1 a proof that fails gets bye {unpaired}', !!bye && bye.reason === 'unpaired', bye);
    c.close();
    await sleep(300);

    // ---- H. a socket that never said hello is refused a command ----
    c = await open();
    c.send('vent', { command: 'open' });
    const bye2 = await c.expect('bye');
    t('H1 a command before any hello: bye, and nothing moves', !!bye2 && bye2.reason === 'unpaired', bye2);
    c.close();
  } catch (e) {
    console.log('  FAIL  bench threw: ' + (e && e.stack || e));
    fail++;
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
