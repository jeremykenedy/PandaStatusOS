// Panda Status stock WebSocket capture.
//
// Captures BOTH directions of the factory web UI's WebSocket with timestamps.
//
// TWO MODES. On the P2, USE ATTACH MODE.
//
//   attach mode  __wsCapAttach()  hooks the socket the page ALREADY has open.
//                No reload, no socket close, no dialog. This is the safe one.
//
//   wrap mode    the IIFE below replaces window.WebSocket so future sockets are
//                captured. It only sees sockets created AFTER it runs, which on a
//                page that opens its socket at load means a reload is required.
//
// WHY ATTACH MODE MATTERS ON THIS DEVICE, measured 2026-08-27:
//
// The P2 UI reacts to a closed socket by raising a modal, and that modal's OK
// button performs a full page navigation. So ANY socket close puts a dialog on
// screen that can reload the page, and a reload destroys the in-memory log.
// During the one-shot stock capture that is the difference between having the
// session and losing it.
//
//   *** IF THE "connection not open" DIALOG APPEARS, DO NOT CLICK OK. ***
//   *** Clicking OK reloads the page and wipes the capture.           ***
//
// Install (attach mode, recommended):
//   1. Open the factory web UI. Let it connect normally.
//   2. DevTools > Sources > Snippets > New snippet, paste this file, run it.
//   3. __wsCapAttach()
//   4. __wsCap.tx() and __wsCap.rx() to confirm both directions.
//
// Use:
//   __wsCap.mark('paused')   annotate the timeline. Do this at every state change.
//   __wsCap.save()           download the capture as JSONL
//   __wsCap.count()          how many entries so far
//   __wsCap.tail(20)         peek at the last N entries
//
// WARNING: the log lives in page memory. A reload wipes it. Save at every mark.
//
// WARNING: the captured frames carry live credentials in plaintext. Specifically:
// the network key for both the station and AP configs, the printer serial, and the
// printer access code. The saved JSONL is a secrets-bearing artifact. Keep it outside
// the repo. Never paste frames into a commit, an issue, or a doc.

(() => {
  if (window.__wsCap) { console.log('[wsCap] already installed,', window.__wsCap.log.length, 'entries'); return; }

  const log = [];
  const t0 = Date.now();
  const Native = window.WebSocket;
  const hex = buf => Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');

  const push = o => { const e = Object.assign({ t: Date.now(), rel_ms: Date.now() - t0 }, o); log.push(e); return e; };

  const record = (dir, url, data) => {
    if (typeof data === 'string') return push({ dir, url, kind: 'text', data });
    // Binary. Read it out of band so page behaviour is untouched and ordering holds.
    const e = push({ dir, url, kind: 'binary', hex: null });
    if (data instanceof ArrayBuffer) e.hex = hex(data);
    else if (data && data.arrayBuffer) data.arrayBuffer().then(b => { e.hex = hex(b); }).catch(() => { e.hex = 'READ_FAILED'; });
    else if (ArrayBuffer.isView(data)) e.hex = hex(data.buffer);
    return e;
  };

  function Wrapped(url, protocols) {
    const ws = protocols === undefined ? new Native(url) : new Native(url, protocols);
    const u = String(url);
    ws.addEventListener('open',    () => push({ dir: 'evt', url: u, event: 'open' }));
    ws.addEventListener('close',   e => push({ dir: 'evt', url: u, event: 'close', code: e.code, reason: e.reason }));
    ws.addEventListener('error',   () => push({ dir: 'evt', url: u, event: 'error' }));
    ws.addEventListener('message', e => record('rx', u, e.data));
    const nativeSend = ws.send.bind(ws);
    ws.send = d => { record('tx', u, d); return nativeSend(d); };
    push({ dir: 'evt', url: u, event: 'construct' });
    return ws;
  }
  Wrapped.prototype = Native.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach((k, i) => { Wrapped[k] = i; });
  window.WebSocket = Wrapped;

  window.__wsCap = {
    log,
    count: () => log.length,
    tail: (n = 10) => log.slice(-n),
    mark: label => { push({ dir: 'mark', label: String(label) }); console.log('[wsCap] mark:', label); },
    save: (name) => {
      const jsonl = log.map(e => JSON.stringify(e)).join('\n') + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([jsonl], { type: 'application/x-ndjson' }));
      a.download = name || ('ws-capture-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
      a.click();
      console.log('[wsCap] saved', log.length, 'entries as', a.download);
    },
  };
  console.log('[wsCap] installed. RELOAD THE PAGE NOW so it catches the socket.');
})();

// ---------------------------------------------------------------------------
// Attach mode. Hooks the socket the page already has open. Preferred on the P2.
// ---------------------------------------------------------------------------
// Pass the socket explicitly, or let it scan window for an open WebSocket. The scan
// avoids depending on whatever name the page happens to hold its socket under.
window.__wsCapFind = function () {
  for (const k of Object.keys(window)) {
    let v;
    try { v = window[k]; } catch (_) { continue; }
    if (v instanceof WebSocket) return v;
  }
  return null;
};

window.__wsCapAttach = function (sock) {
  const ws = sock || window.__wsCapFind();
  if (!ws) { console.error('[wsCap] no socket found. Pass one explicitly: __wsCapAttach(sock)'); return null; }
  if (window.__wsCap && window.__wsCap.attachedTo === ws) {
    console.log('[wsCap] already attached,', window.__wsCap.count(), 'entries'); return window.__wsCap;
  }
  const log = (window.__wsCap && window.__wsCap.log) || [];
  const t0 = Date.now();
  const push = o => { log.push(Object.assign({ t: Date.now(), rel_ms: Date.now() - t0 }, o)); };
  ws.addEventListener('message', e => push({ dir: 'rx', kind: typeof e.data === 'string' ? 'text' : 'binary',
                                             data: typeof e.data === 'string' ? e.data : '<binary>' }));
  ws.addEventListener('close', e => push({ dir: 'evt', event: 'close', code: e.code }));
  ws.addEventListener('error', () => push({ dir: 'evt', event: 'error' }));
  const nativeSend = ws.send.bind(ws);
  ws.send = d => { push({ dir: 'tx', kind: 'text', data: String(d) }); return nativeSend(d); };
  window.__wsCap = {
    log, attachedTo: ws,
    count: () => log.length,
    tx: () => log.filter(e => e.dir === 'tx').length,
    rx: () => log.filter(e => e.dir === 'rx').length,
    tail: (n = 10) => log.slice(-n),
    mark: l => { push({ dir: 'mark', label: String(l) }); console.log('[wsCap] mark:', l); },
    save: name => {
      const j = log.map(e => JSON.stringify(e)).join('\n') + '\n';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([j], { type: 'application/x-ndjson' }));
      a.download = name || ('ws-capture-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl');
      a.click();
      console.log('[wsCap] saved', log.length, 'entries as', a.download);
      return a.download;
    },
  };
  window.__wsCap.mark('attached-to-live-socket');
  console.log('[wsCap] attached to live socket, no reload needed.');
  return window.__wsCap;
};
