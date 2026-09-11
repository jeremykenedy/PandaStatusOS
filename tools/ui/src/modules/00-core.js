'use strict';
/* Module 0: the substrate. Everything the page shares.
   - the socket, and the ONE place that sends: PS.send(root, members) adds device_wakeup:1
   - the merged state document, merged key by key per root, never replaced wholesale
   - the i18n runtime: one accessor, PS.tr(), and apply_translations()
   - navigation between cards, hash-routed, one card visible at a time
   - the dialog, the toast, the top-bar pill
   - the response root: what each type does to the page
   - the theme control
   Later modules register on PS.on('state', ...) and call PS.send(); they own nothing here.

   Parity: the factory UI reacts to a closed socket with a modal whose OK reloads the page,
   and refuses to send while the socket is not open. Both are reproduced, because that is
   what the device's owner is used to. Both are exactly what makes a capture session
   dangerous; that is documented in the run sheet, not changed here.

   Written from docs/protocol-websocket.md and the mock. No factory JavaScript was read. */

var PS = (function () {
  var state = { wifi: {}, sta: {}, ap: {}, printer: {}, settings: {}, block: {} };
  var listeners = { state: [], response: [], open: [], close: [], log: [] };
  var sock = null;
  var haveFirst = false;
  var lang = 'en';

  // ---------- i18n: the one accessor ----------
  function table() { return (typeof PS_STRINGS !== 'undefined') ? PS_STRINGS : null; }
  // The product name is never in a table: tables carry {product} and this is the one place
  // it is filled in, so no translation can split, transliterate or misspell it.
  function product(s) { return s.indexOf('{product}') >= 0 ? s.split('{product}').join(typeof PS_PRODUCT !== 'undefined' ? PS_PRODUCT : 'PandaStatusOS') : s; }
  function tr(key, fallback) {
    var t = table();
    if (t) {
      if (t[lang] && typeof t[lang][key] === 'string') return product(t[lang][key]);
      if (t.en && typeof t.en[key] === 'string') return product(t.en[key]);
    }
    return (fallback !== undefined) ? fallback : key;
  }
  function apply_translations() {
    var t = table(); if (!t) return;
    document.querySelectorAll('[data-ps-str]').forEach(function (el) {
      var k = el.getAttribute('data-ps-str'); var v = tr(k, null);
      if (v !== null) el.textContent = v;
    });
    [['title', 'title'], ['placeholder', 'placeholder'], ['aria', 'aria-label']].forEach(function (pair) {
      document.querySelectorAll('[data-ps-str-' + pair[0] + ']').forEach(function (el) {
        var v = tr(el.getAttribute('data-ps-str-' + pair[0]), null);
        if (v !== null) el.setAttribute(pair[1], v);
      });
    });
    var rtl = (typeof PS_RTL_LANGS !== 'undefined') && PS_RTL_LANGS.indexOf(lang) >= 0;
    document.documentElement.setAttribute('dir', rtl ? 'rtl' : 'ltr');
    document.documentElement.setAttribute('lang', lang);
  }
  // Fill a <select> with the string table's languages, each named in its own words.
  function fillLangs(sel) {
    if (typeof PS_STRING_LANGS === 'undefined' || sel.options.length) return;
    var t = table();
    PS_STRING_LANGS.forEach(function (code) {
      var o = document.createElement('option'); o.value = code;
      o.textContent = (t && t[code] && t[code].ps_core_language_name) || code;
      sel.appendChild(o);
    });
  }
  function setLang(code) {
    var t = table();
    if (!code || !t || !t[code] || code === lang) return;   // re-applying on every frame clobbers text set at runtime
    lang = code; apply_translations();
  }

  // ---------- the event log. What the socket did, in order, credentials never. ----------
  // Inbound frames are logged as their root names only: the push carries the Wi-Fi
  // password, the hotspot password and the printer's access code, and none of those
  // belongs in a log. Outbound frames are logged with their members, and a member named
  // password or access_code is replaced by its length before it is stored.
  var LOG_MAX = 200;
  var logRing = [];
  var MASKED = { password: 1, access_code: 1 };
  function logPush(entry) {
    entry.t = Date.now();
    logRing.push(entry); if (logRing.length > LOG_MAX) logRing.shift();
    emit('log', entry);
  }
  function maskMembers(members) {
    var out = {};
    Object.keys(members).forEach(function (k) {
      out[k] = MASKED[k] ? '(' + String(members[k]).length + ' chars)' : members[k];
    });
    return out;
  }
  function clearLog() { logRing.length = 0; emit('log', null); }

  // ---------- events ----------
  function on(name, fn) { (listeners[name] = listeners[name] || []).push(fn); }
  function emit(name, arg) { (listeners[name] || []).forEach(function (fn) { try { fn(arg); } catch (e) { console.error('[ps] listener', name, e); } }); }

  // ---------- state merge ----------
  function merge(root, body) {
    if (!state[root]) state[root] = {};
    Object.keys(body).forEach(function (k) {
      var v = body[k];
      // arrays of records with an id are merged by id, never by position
      if (Array.isArray(v) && Array.isArray(state[root][k]) && v.length && v[0] && typeof v[0] === 'object' && 'blockID' in v[0]) {
        var cur = state[root][k].slice();
        v.forEach(function (rec) { var i = cur.findIndex(function (c) { return c.blockID === rec.blockID; }); if (i >= 0) cur[i] = rec; else cur.push(rec); });
        state[root][k] = cur;
      } else state[root][k] = v;
    });
  }
  function receive(text) {
    var frame; try { frame = JSON.parse(text); } catch (e) { console.warn('[ps] unparsable frame'); logPush({ kind: 'bad', bytes: text.length }); return; }
    var roots = Object.keys(frame);
    if (roots.indexOf('response') >= 0) { logPush({ kind: 'response', type: frame.response && frame.response.type, ok: frame.response && frame.response.ok }); emit('response', frame.response); }
    if (roots.some(function (r) { return r !== 'response'; })) logPush({ kind: 'in', roots: roots.filter(function (r) { return r !== 'response'; }) });
    var changed = [];
    roots.forEach(function (r) { if (r === 'response') return; if (r === 'ws_theme') { state.ws_theme = frame.ws_theme; changed.push(r); return; } merge(r, frame[r]); changed.push(r); });
    if (state.settings && state.settings.language) setLang(state.settings.language);
    if (!haveFirst && changed.length) { haveFirst = true; document.body.classList.remove('ps-waiting'); }
    if (changed.length) emit('state', { changed: changed, state: state });
  }

  // ---------- socket ----------
  function connect() {
    var url = 'ws://' + location.host + '/ws';
    try { sock = new WebSocket(url); } catch (e) { onClosed(); return; }
    sock.onopen = function () { logPush({ kind: 'open' }); emit('open'); };
    sock.onmessage = function (e) { receive(String(e.data)); };
    sock.onclose = function () { onClosed(); };
    sock.onerror = function () { /* close follows */ };
  }
  function onClosed() {
    logPush({ kind: 'close' });
    emit('close');
    // Parity with the factory UI: a closed socket raises a modal whose OK reloads the page.
    dialog(tr('ps_core_lost_title'), tr('ps_core_lost_text'), [{ key: 'ps_core_reload', handler: function () { location.reload(); } }]);
  }
  function send(root, members) {
    if (!sock || sock.readyState !== 1) {
      dialog(tr('ps_core_lost_title'), tr('ps_core_lost_text'), [{ key: 'ps_core_reload', handler: function () { location.reload(); } }]);
      return false;
    }
    var body = {}; Object.keys(members).forEach(function (k) { body[k] = members[k]; });
    body.device_wakeup = 1;
    var frame = {}; frame[root] = body;
    sock.send(JSON.stringify(frame));
    logPush({ kind: 'out', root: root, members: maskMembers(body) });
    return true;
  }

  // ---------- navigation ----------
  function showCard(name) {
    var found = false;
    document.querySelectorAll('article[data-ps-card]').forEach(function (a) {
      var is = a.id === 'ps-card-' + name; a.hidden = !is; if (is) found = true;
    });
    if (!found) return showCard('dashboard');
    document.querySelectorAll('[data-ps-nav]').forEach(function (l) { l.classList.toggle('ps-current', l.getAttribute('data-ps-nav') === name); });
    window.scrollTo(0, 0);
  }
  function route() { var h = (location.hash || '#dashboard').slice(1); showCard(h); }

  // ---------- dialog and toast ----------
  var dlg, dlgTitle, dlgText, dlgOk, dlgCancel, dlgHandlers = {};
  function dialog(title, text, buttons) {
    // runtime text owns these elements now: drop the markup keys so a language switch
    // cannot repaint an open dialog with its placeholders; the buttons keep their keys
    dlgTitle.removeAttribute('data-ps-str'); dlgText.removeAttribute('data-ps-str');
    dlgTitle.textContent = title; dlgText.textContent = text;
    var ok = buttons && buttons[0]; var cancel = buttons && buttons[1];
    dlgOk.setAttribute('data-ps-str', ok ? ok.key : 'ps_global_ok'); dlgOk.textContent = tr(ok ? ok.key : 'ps_global_ok');
    dlgCancel.hidden = !cancel; if (cancel) { dlgCancel.setAttribute('data-ps-str', cancel.key); dlgCancel.textContent = tr(cancel.key); }
    dlgHandlers.ok = ok && ok.handler; dlgHandlers.cancel = cancel && cancel.handler;
    if (typeof dlg.showModal === 'function') { if (!dlg.open) dlg.showModal(); } else dlg.setAttribute('open', '');
  }
  function closeDialog() { if (dlg.open) dlg.close(); else dlg.removeAttribute('open'); }
  var toastTimer = null;
  function toast(text, ms) {
    var t = document.getElementById('ps-toast'); t.textContent = text; t.classList.add('active');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove('active'); }, ms || 3000);
  }

  // ---------- the response root ----------
  on('response', function (r) {
    var ok = r.ok === 1;
    switch (r.type) {
      case 'set_hostname':
      case 'set_hotspot_ip':
        // Parity: on success the factory UI shows a notice whose OK sends a restart.
        if (ok) dialog(tr('ps_core_saved_title'), tr('ps_core_restart_text'), [{ key: 'ps_global_ok', handler: function () { send('settings', { reset: 1 }); } }]);
        else toast(tr('ps_core_save_failed'));
        break;
      case 'set_ap':
        toast(ok ? tr('ps_core_saved_title') : tr('ps_core_save_failed')); break;
      case 'factory_reset':
        dialog(tr('ps_core_factory_done_title'), tr('ps_core_factory_done_text'), [{ key: 'ps_global_ok', handler: function () {} }]); break;
      case 'ota_fw':
      case 'ota_img':
        toast(ok ? tr('ps_core_upload_ok') : tr('ps_core_upload_failed')); break;
      default:
        toast((ok ? 'ok: ' : 'failed: ') + r.type);
    }
  });

  // ---------- uploads. POST /ota is the one HTTP write the device accepts. ----------
  // Caps per OTA-Type, from docs/protocol-websocket.md: the factory UI compares the file's
  // size against them before sending. Callers check; this only sends.
  var UPLOAD_CAPS = { ota_fw: 0x480000, ota_img: 0x6E0000, gif: 0x180000 };
  function upload(type, file, cb) {
    cb = cb || {};
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/ota', true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream;charset=UTF-8');
    xhr.setRequestHeader('OTA-Type', type);
    xhr.upload.onprogress = function (e) { if (e.lengthComputable && cb.progress) cb.progress(Math.round(100 * e.loaded / e.total)); };
    xhr.onload = function () { if (cb.done) cb.done(xhr.status); };
    xhr.onerror = function () { if (cb.done) cb.done(0); };
    xhr.send(file);
  }

  // ---------- theme ----------
  function theme(next) {
    try { if (next) localStorage.setItem('ps_theme', next); } catch (e) {}
    var pref = null; try { pref = localStorage.getItem('ps_theme'); } catch (e) {}
    document.body.classList.remove('dark', 'light');
    if (pref === 'dark' || pref === 'light') document.body.classList.add(pref);
    else document.body.classList.add(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  function cycleTheme() {
    var pref = null; try { pref = localStorage.getItem('ps_theme'); } catch (e) {}
    theme(pref === 'dark' ? 'light' : pref === 'light' ? 'auto' : 'dark');
  }

  // ---------- pill. Takes a string KEY, so a language switch keeps it right. ----------
  function pill(key, cls) {
    var p = document.getElementById('ps-topbar-pill'); p.setAttribute('data-ps-str', key); p.textContent = tr(key);
    p.className = 'ps-pill' + (cls ? ' ps-pill-' + cls : '');
  }

  // ---------- boot ----------
  function boot() {
    dlg = document.getElementById('ps-dialog'); dlgTitle = document.getElementById('ps-dialog-title');
    dlgText = document.getElementById('ps-dialog-text'); dlgOk = document.getElementById('ps-dialog-ok'); dlgCancel = document.getElementById('ps-dialog-cancel');
    dlgOk.addEventListener('click', function () { closeDialog(); if (dlgHandlers.ok) dlgHandlers.ok(); });
    dlgCancel.addEventListener('click', function () { closeDialog(); if (dlgHandlers.cancel) dlgHandlers.cancel(); });
    document.getElementById('ps-topbar-theme').addEventListener('click', cycleTheme);
    document.querySelectorAll('[data-ps-nav]').forEach(function (l) {
      l.addEventListener('click', function (e) { e.preventDefault(); location.hash = '#' + l.getAttribute('data-ps-nav'); });
    });
    window.addEventListener('hashchange', route);
    apply_translations();
    route();
    connect();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();

  return { state: state, on: on, send: send, upload: upload, UPLOAD_CAPS: UPLOAD_CAPS, log: logRing, clearLog: clearLog, tr: tr, setLang: setLang, fillLangs: fillLangs, apply_translations: apply_translations,
           dialog: dialog, toast: toast, pill: pill, showCard: showCard, theme: theme, get lang() { return lang; }, get connected() { return !!(sock && sock.readyState === 1); } };
})();
