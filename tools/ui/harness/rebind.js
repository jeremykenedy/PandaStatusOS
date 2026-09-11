#!/usr/bin/env node
'use strict';
/*
 * C7: the bound printer takes a new address. No browser: this is socket and route behaviour.
 *
 * The device's own search finds nothing until a discovery mechanism is documented
 * (docs/ROADMAP.md), so on real hardware the conclusion is always "sn not matched" today.
 * The mock's search does return what it was told to find, which is what makes the policy
 * and all three of its conclusions provable: the wire's own printer.scan states 4, 5 and 6,
 * the same three the pure decision returns in firmware/test/host/rebind_test.c.
 *
 * Exit 0 when every assertion passes, 1 otherwise. sweep.sh trusts the exit code.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json rebind.js PS_CLONE=1
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
const post = (path, body) => fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.status);

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS);
    const c = { ws, frames: [] };
    ws.addEventListener('message', (ev) => { try { c.frames.push(JSON.parse(ev.data)); } catch (_) { /* not ours */ } });
    ws.addEventListener('open', () => resolve(c));
    ws.addEventListener('error', reject);
  });
}
/* the printer roots that arrived after index n */
const printersAfter = (c, n) => c.frames.slice(n).filter((f) => f.printer).map((f) => f.printer);

(async () => {
  await fetch(BASE + '/__reset', { method: 'POST' });
  const c = await connect();
  await sleep(300);
  const first = (c.frames.find((f) => f.printer) || {}).printer;
  t('the connect push carries the bound printer with its serial and address', !!first && !!first.sn && !!first.ip, first && { sn: !!first.sn, ip: first.ip });
  const boundSn = first.sn, boundIp = first.ip;

  // ---- the switch off: the device is left where the failure left it ----
  let n = c.frames.length;
  await post('/__printer_move', { ip: '192.0.2.30' });
  await sleep(600);
  let seen = printersAfter(c, n);
  t('with the switch off the printer goes to the address error and stays there', seen.length >= 1 && seen[seen.length - 1].state === 4 && seen[seen.length - 1].ip === boundIp, seen.map((p) => [p.state, p.scan, p.ip]));
  // the fixture's own scan state is 5, the value observed on a stock unit; what a rebind
  // would show is 3, and with the switch off it never appears
  t('with the switch off no rebind scan is started', seen.every((p) => p.scan !== 3), seen.map((p) => p.scan));

  // ---- the switch on ----
  let st = await post('/api/features', { features: { auto_rebind: true } });
  t('the switch turns on through the features route', st === 200, st);

  n = c.frames.length;
  await post('/__printer_move', { ip: '192.0.2.30' });
  await sleep(900);
  seen = printersAfter(c, n);
  t('a move starts a rebind scan: the wire says ip_change_scanning', seen.some((p) => p.scan === 3), seen.map((p) => p.scan));
  let last = seen[seen.length - 1];
  t('and concludes new ip applied, bound to the new address, connected again', last.scan === 6 && last.ip === '192.0.2.30' && last.state === 3, last && [last.scan, last.ip, last.state]);

  // ---- the same address again: nothing moved ----
  n = c.frames.length;
  await post('/__printer_move', { ip: '192.0.2.30' });
  await sleep(900);
  last = printersAfter(c, n).pop();
  t('a printer found where it already is concludes ip not changed', last.scan === 5 && last.ip === '192.0.2.30', last && [last.scan, last.ip]);

  // ---- somebody else's serial ----
  n = c.frames.length;
  await post('/__printer_move', { ip: '192.0.2.40', sn: '<SOMEONE_ELSES_SN>' });
  await sleep(900);
  last = printersAfter(c, n).pop();
  t('a hit carrying another serial concludes sn not matched', last.scan === 4, last && last.scan);
  t('and nothing is bound to it: the address is unchanged', last.ip === '192.0.2.30', last && last.ip);
  t('the serial the device is bound to never changed through any of it', last.sn === boundSn, last && last.sn);

  // ---- off again ----
  st = await post('/api/features', { features: { auto_rebind: false } });
  n = c.frames.length;
  await post('/__printer_move', { ip: '192.0.2.50' });
  await sleep(900);
  seen = printersAfter(c, n);
  t('with the switch off again a move starts no scan and moves nothing', st === 200 && seen.every((p) => p.scan !== 3 && p.ip === '192.0.2.30'), seen.map((p) => [p.scan, p.ip]));

  c.ws.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL  harness threw: ' + e.message); process.exit(1); });
