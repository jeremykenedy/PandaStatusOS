#!/usr/bin/env node
'use strict';
/*
 * Under PS_NO_WS=1 the mock runs its HTTP side with no WebSocket server at all, so the
 * upgrade is refused. This is the "device came up with its socket dead" case. A page must
 * survive it: the sibling project's cold-start bug was a page that showed stale defaults
 * as if they were device state. This harness only proves the mock does refuse; the page
 * harness that proves the page copes runs in the same sweep row with the same env.
 *
 * Run through sweep.sh; the row carries PS_NO_WS=1.
 */
const PORT = Number(process.env.PS_PORT || 8199);
let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log('  ok    ' + n); } else { fail++; console.log('  FAIL  ' + n + (got !== undefined ? '   got: ' + JSON.stringify(got) : '')); } };

(async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  t('HTTP still serves the page', r.status === 200, r.status);
  const outcome = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    let opened = false;
    ws.onopen = () => { opened = true; };
    ws.onerror = () => {};
    ws.onclose = (e) => resolve({ opened, code: e.code });
    setTimeout(() => resolve({ opened, code: 'timeout' }), 2000);
  });
  t('WebSocket upgrade is refused (never opens)', outcome.opened === false, outcome);
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
