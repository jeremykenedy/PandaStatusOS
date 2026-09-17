/* =====================================================================
   PandaVentOS web UI — MODULE 1: message router and rendering substrate
   ---------------------------------------------------------------------
   One cohesive classic <script> body. It owns the socket, the merged
   state document, the i18n runtime, navigation, the response UI (dialog
   and toast) and the device-push render of every card. Per-card INBOUND
   handlers (button clicks, form submits, sliders, the colour picker) are
   later modules; they call into the globals this module exposes:

       g_sock, ws_push(root, members), tr(key[, fallback]),
       show_card(id), show_page(id),
       dialog_open(titleKey, textKey, btns), dialog_dismiss(),
       toast_show(key, ms)

   Written entirely from private/SPEC/handler-contract.md,
   private/SPEC/websocket-protocol.md and private/SPEC/printer-states.md
   plus Jeremy's own clean Beer markup (frame/global/pages).

   Attestation, written 2026-09-02 and deliberately not backdated.

   [provenance-note] This module was authored BEFORE the "ui-legacy.html
   [provenance-note] closed" mandate was stated for modules 2-10, and
   [provenance-note] ui-legacy.html was still in the working tree at the time. So unlike its siblings it cannot carry their line, "no vendor
   source opened": the discipline was not yet in place to attest to, and this
   file says so rather than implying otherwise.

   What the record does show, from the 2026-09-02 provenance scan:

     - Of 112 distinctive string literals this file shares with the vendor
       page, 111 are accounted for by the SPEC, our own markup or our English
       key set. The one left is 'http://www.w3.org/2000/svg', which
       createElementNS requires and which has no other spelling.
     - This module coined its own name for everything it names: ws_recv,
       render_status, g_state, g_inbound_queue, g_out_queue, handle_camera,
       handle_pctl, g_have_first_state, hexColour. None of
       them appears anywhere in the vendor page.
     - It was OFFERED vendor names by the harnesses it was written against --
       two names the vendor page used, which occur 3 and 21 times in the
       vendor page -- and refused both. The harnesses were rewritten to call
       this module's names instead; see PHASE2-RECORD.md section D.

   Seven identifiers that did match the vendor's have since been renamed, six
   of them because private/SPEC named them and every author inherited them
   honestly from a document that was itself derivative. That was the leak, and
   it was in the brief, not in this file.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. Small shared helpers
   ------------------------------------------------------------------- */

var DASH = '—';           /* em dash — the "value never reported" mark */
var DEG = '°C';

function byId(id) { return document.getElementById(id); }

function present(v) { return v !== null && v !== undefined; }

function isNum(v) { return typeof v === 'number' && isFinite(v); }

function setText(id, val) {
  var el = byId(id);
  if (el) el.textContent = (val === null || val === undefined) ? '' : String(val);
}

function setElText(el, val) {
  if (el) el.textContent = (val === null || val === undefined) ? '' : String(val);
}

function setHidden(id, hide) {
  var el = byId(id);
  if (el) el.hidden = !!hide;
}

/* Write an input's value, but never while the field has focus (§1, §2, §5). */
function setInputValue(id, val) {
  var el = byId(id);
  if (el && document.activeElement !== el) el.value = (val === null || val === undefined) ? '' : val;
}

/* Write a checkbox, optionally guarding against a focused control. */
function setChecked(id, on, guardFocus) {
  var el = byId(id);
  if (!el) return;
  if (guardFocus && document.activeElement === el) return;
  el.checked = !!on;
}

/* An em-dash value node marked unknown (§0.5). */
function unknownSpan() {
  var s = document.createElement('span');
  s.className = 'is-unknown';
  s.textContent = DASH;
  return s;
}

function valueSpan(text) {
  var s = document.createElement('span');
  s.textContent = text;
  return s;
}

/* "#RRGGBB" from a 6-hex colour, first 6 chars of an 8-hex tray colour. */
function hexColour(c) {
  if (!c || typeof c !== 'string') return null;
  var h = c.replace('#', '');
  if (h.length < 6) return null;
  return '#' + h.slice(0, 6).toUpperCase();
}

/* formatting -------------------------------------------------------- */

function fmtPct(v) { return v + '%'; }
function fmtTemp(v) { return v + ' ' + DEG; }

function fmtRemain(min) {
  var h = Math.floor(min / 60);
  var m = min % 60;
  if (h > 0) return h + ' h ' + m + ' m';
  return m + ' m';
}

function fmtUptime(s) {
  if (s >= 86400) { return Math.floor(s / 86400) + ' d ' + Math.floor((s % 86400) / 3600) + ' h'; }
  if (s >= 3600) { return Math.floor(s / 3600) + ' h ' + Math.floor((s % 3600) / 60) + ' m'; }
  if (s >= 60) { return Math.floor(s / 60) + ' m ' + (s % 60) + ' s'; }
  return s + ' s';
}

function fmtKB(bytes) { return Math.round(bytes / 1024) + ' kB'; }

function fmtStorageMB(v) {
  if (v >= 1024) return (Math.round((v / 1024) * 10) / 10) + ' GB';
  return v + ' MB';
}

/* ---------------------------------------------------------------------
   1. Enumerations / label tables (from the specs)
   ------------------------------------------------------------------- */

/* device_state 0..5 (printer-states.md) */
var DEVICE_STATE_NAMES = ['Idle', 'Preparation', 'Printing', 'Paused', 'Completed', 'Error'];
/* top-bar dot class per state (§0.7) */
var TOP_DOT_CLASS = ['is-idle', 'is-wait', 'is-run', 'is-wait', 'is-run', 'is-err'];

/* The printer state and link state as words, through the table with the
   English above as the fallback. */
function device_state_name(n) {
  return (isNum(n) && DEVICE_STATE_NAMES[n]) ? tr('ui_printer_state_' + n, DEVICE_STATE_NAMES[n]) : null;
}
function link_state_name(n) {
  return (isNum(n) && LINK_STATES[n] !== undefined) ? tr('ui_link_state_' + n, LINK_STATES[n]) : null;
}

/* effect ids 0..21 (§3.3 / §6.4). Used only as a fallback for the picker text. */
var EFFECT_NAMES = ['Static', 'Breathing', 'Strobing', 'Wave', 'Marquee', 'Color Cycle',
  'Rainbow', 'Cylon', 'Bounce', 'Progress Bar', 'Marquee Out', 'Marquee In', 'Fill Out',
  'Fill In', 'Bounce Out', 'Bounce In', 'Bounce Fill Out', 'Bounce Fill In',
  'Animated Progress', 'Barber Pole', 'Bed Temperature', 'Animation'];
var FX_COUNT = 22;
var FX_BARBER = 19;   /* aux band-width effect */
var FX_BEDTEMP = 20;  /* temperature-gradient effect */

/* spd_lvl 1..4 (§1.2) */
var SPEED_WORDS = { 1: 'Silent', 2: 'Standard', 3: 'Sport', 4: 'Ludicrous' };

/* printer.state 0..7 -> link string (§1.4 / §6.2) */
var LINK_STATES = ['Unbound', 'Unbound', 'Connecting', 'Connected', 'IP error',
  'SN error', 'Access code error', 'Unknown error'];

/* sta.state 1..5 (§7.2) */
var STA_STATES = { 1: 'No network saved', 2: 'Connecting', 3: 'Connected', 4: 'Reconnecting', 5: 'Password error' };

/* ---------------------------------------------------------------------
   2. i18n runtime: tr() + the DOM translate pass
   ------------------------------------------------------------------- */

/* The string table is PS_STRINGS, language-major: PS_STRINGS[lang][key].
   The build generates it from strings/en.json and the per-language files
   beside it and splices it into the page as its own block. */
var g_language = 'en';

function langTable() {
  if (typeof PS_STRINGS !== 'undefined' && PS_STRINGS) return PS_STRINGS;
  if (window.PS_STRINGS) return window.PS_STRINGS;
  return null;
}

/* Raw lookup: the string in the current language, else English, else null. */
function trLookup(key) {
  var tbl = langTable();
  if (!tbl) return null;
  var cur = tbl[g_language];
  if (cur && cur[key] != null) return cur[key];
  if (tbl.en && tbl.en[key] != null) return tbl.en[key];
  return null;
}

/* Public translate: the string for the current language, falling back to
   English then to the supplied fallback, then to the key itself. */
function tr(key, fallback) {
  var v = trLookup(key);
  if (v != null) return v;
  return (fallback !== undefined) ? fallback : key;
}

/* Set text on every [data-str] and the title on every
   [data-str-title]. Only overwrite when a resource actually exists,
   so the English defaults baked into the markup survive a missing key. */
function apply_translations() {
  var i, el, key, v, nodes;
  nodes = document.querySelectorAll('[data-str]');
  for (i = 0; i < nodes.length; i++) {
    el = nodes[i];
    key = el.getAttribute('data-str');
    v = trLookup(key);
    if (v != null) el.textContent = v;
  }
  nodes = document.querySelectorAll('[data-str-title]');
  for (i = 0; i < nodes.length; i++) {
    el = nodes[i];
    key = el.getAttribute('data-str-title');
    v = trLookup(key);
    if (v != null) el.setAttribute('title', v);
  }
}

var RTL_LANGS = ['ar'];

/* The document's language, not only its direction.
   <html lang> was written once at build time and never updated, so 23 of the
   24 languages shipped a page telling every screen reader and every
   translation tool that its content was English -- which picks the wrong
   voice, the wrong pronunciation rules and the wrong hyphenation. */
function apply_direction() {
  var el = document.documentElement;
  if (!el) return;
  el.setAttribute('dir', RTL_LANGS.indexOf(g_language) >= 0 ? 'rtl' : 'ltr');
  /* zh is Simplified here, and yue is its own tag rather than a zh variant. */
  el.setAttribute('lang', g_language === 'zh' ? 'zh-Hans' : g_language);
}

function set_language(lang) {
  if (!lang || lang === g_language) return;
  g_language = lang;
  try { localStorage.setItem('pv_lang', lang); } catch (e) {}
  apply_direction();
  apply_translations();
}

/* ---------------------------------------------------------------------
   3. Navigation: show_page / show_card + a delegated nav listener
   ------------------------------------------------------------------- */

var g_current_card = null;

function chrome_nodes() {
  return [byId('ps-top-bar'), byId('ps-nav'),
  document.querySelector('nav.bottom'), document.querySelector('footer.ux_version')];
}

/* Show the app chrome and hide every setup page. */
function enter_app() {
  /* app.css shows exactly the [data-page] / [data-card] that carries .active */
  var pages = document.querySelectorAll('[data-page]');
  for (var i = 0; i < pages.length; i++) pages[i].classList.toggle('active', pages[i].id === 'ps-page-app');
  var c = chrome_nodes();
  for (var j = 0; j < c.length; j++) { if (c[j]) c[j].style.display = ''; }
}

/* Switch the top-level page: a setup page (data-page) vs the app (§0.4). */
function show_page(id) {
  var el = byId(id);
  var isSetup = el && el.hasAttribute('data-page');
  if (isSetup) {
    var pages = document.querySelectorAll('[data-page]');
    for (var j = 0; j < pages.length; j++) pages[j].classList.toggle('active', pages[j].id === id);
    var c = chrome_nodes();
    for (var k = 0; k < c.length; k++) { if (c[k]) c[k].style.display = 'none'; }
  } else {
    enter_app();
  }
}

/* Show one card inside the app and mark it active in both navs (§0.4). */
function show_card(id) {
  enter_app();
  var targetId = 'ps-card-' + id;
  var cards = document.querySelectorAll('[data-card]');
  for (var i = 0; i < cards.length; i++) {
    cards[i].classList.toggle('active', cards[i].id === targetId);
  }
  var navs = document.querySelectorAll('[data-nav]');
  for (var j = 0; j < navs.length; j++) {
    var on = navs[j].getAttribute('data-nav') === id;
    navs[j].classList.toggle('active', on);
    if (navs[j].hasAttribute('aria-current') || on) {
      navs[j].setAttribute('aria-current', on ? 'page' : 'false');
    }
  }
  g_current_card = id;
}

/* One delegated listener: activate [data-nav] on click and on Enter/Space,
   and let the arrow keys move within a nav. */
function wire_navigation() {
  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('[data-nav]') : null;
    if (a) { e.preventDefault(); show_card(a.getAttribute('data-nav')); }
  });
  document.addEventListener('keydown', function (e) {
    var a = e.target.closest ? e.target.closest('[data-nav]') : null;
    if (!a) return;
    if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
      e.preventDefault();
      show_card(a.getAttribute('data-nav'));
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      var group = a.parentNode ? a.parentNode.querySelectorAll('[data-nav]') : [];
      var list = Array.prototype.slice.call(group);
      var idx = list.indexOf(a);
      if (idx < 0) return;
      var fwd = (e.key === 'ArrowDown' || e.key === 'ArrowRight');
      var next = list[(idx + (fwd ? 1 : -1) + list.length) % list.length];
      if (next && next.focus) { e.preventDefault(); next.focus(); }
    }
  });
}

/* ---------------------------------------------------------------------
   4. Response UI: dialog + toast (§0.6)
   ------------------------------------------------------------------- */

function dialog_dismiss() {
  var dlg = byId('ps-dialog');
  if (!dlg) return;
  if (typeof dlg.close === 'function' && dlg.open) { try { dlg.close(); } catch (e) {} }
  dlg.removeAttribute('open');
}

/* English for every dialog this module opens (§0.6, §6.2, §6.3, §7.2),
   used when the table has no entry for the key. A caller may also pass
   an already-translated string as either key; it passes through. */
var DLG_EN = {
  dlg_error_title: 'Something went wrong',
  dlg_error_text: 'The vent refused the request. Nothing was changed.',
  dlg_bind_ok_title: 'Printer connected',
  dlg_bind_ok_text: 'The vent is talking to the printer. The Status page fills in as the printer reports.',
  dlg_bind_ip_title: 'Printer address not reachable',
  dlg_bind_ip_text: 'The vent could not reach the printer at that address. Check the IP address and that both are on the same network.',
  dlg_bind_sn_title: 'Serial number not accepted',
  dlg_bind_sn_text: 'The printer did not accept that serial number. Copy it from the printer\'s own settings screen.',
  dlg_bind_code_title: 'Access code not accepted',
  dlg_bind_code_text: 'The printer rejected the access code. Check it on the printer under Settings, Network.',
  dlg_bind_unknown_title: 'Could not connect',
  dlg_bind_unknown_text: 'The printer did not answer in a way the vent understands. Check the details and try again.',
  dlg_scan_ok_title: 'Scan finished',
  dlg_scan_ok_text: 'Pick a printer from the list, then bind it.',
  dlg_scan_sn_title: 'Serial number not found',
  dlg_scan_sn_text: 'No printer on the network reported that serial number.',
  dlg_scan_ip_title: 'Address unchanged',
  dlg_scan_ip_text: 'The printer answered from the address the vent already has. If the vent cannot reach it, check the hotspot settings.',
  dlg_scan_newip_title: 'New address applied',
  dlg_scan_newip_text: 'The printer moved and the vent now uses its new address.',
  dlg_conn_ok_title: 'Connected to the network',
  dlg_conn_ok_text: 'The vent joined the Wi-Fi network. Next, bind your printer.',
  dlg_conn_reconnect_title: 'Reconnecting',
  dlg_conn_reconnect_text: 'The vent lost the network and is trying again.',
  dlg_conn_pw_title: 'Wrong password',
  dlg_conn_pw_text: 'The network refused the password. Check it and connect again.',
  dlg_hostname_title: 'Host name saved',
  dlg_hostname_text: 'The vent restarts to take the new name.',
  dlg_ap_title: 'Hotspot saved',
  dlg_ap_text: 'The hotspot uses the new name and password from its next start.',
  dlg_hotspot_ip_title: 'Hotspot address saved',
  dlg_hotspot_ip_text: 'The vent restarts to move to the new address.',
  dlg_factory_title: 'Reset to factory settings',
  dlg_factory_text: 'The vent erases its settings and restarts. Connect to its hotspot to set it up again.',
  dlg_ota_title: 'Update received',
  dlg_ota_text: 'The vent restarts into the new firmware. This page reloads when it is back.',
  dlg_ota_err_title: 'Update failed',
  dlg_ota_err_text: 'The vent did not accept the image. The running firmware is unchanged.',
  dlg_ota_unknown_title: 'Unknown upload',
  dlg_ota_unknown_text: 'The vent did not recognise the upload type. Nothing was changed.'
};

/* dialog_open(titleKey, textKey, btns): btns is a list of
   {key, handler}. A button's handler may run a follow-on. */
function dialog_open(titleKey, textKey, btns) {
  var dlg = byId('ps-dialog');
  if (!dlg) return;
  setElText(byId('ps-dialog-title'), tr(titleKey, DLG_EN[titleKey] || titleKey));
  setElText(byId('ps-dialog-text'), tr(textKey, DLG_EN[textKey] || textKey));
  var host = byId('ps-dialog-btn');
  if (host) {
    host.innerHTML = '';
    var list = btns && btns.length ? btns : [{ key: 'ui_ok', fallback: 'OK' }];
    for (var i = 0; i < list.length; i++) {
      (function (b, last) {
        var btn = document.createElement('button');
        btn.className = last ? 'fill' : 'transparent';
        btn.textContent = tr(b.key, b.fallback || b.key);
        btn.addEventListener('click', function () {
          dialog_dismiss();
          if (typeof b.handler === 'function') b.handler();
        });
        host.appendChild(btn);
      })(list[i], i === list.length - 1);
    }
  }
  if (typeof dlg.showModal === 'function') {
    if (dlg.open) { try { dlg.close(); } catch (e) {} }
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  } else {
    dlg.setAttribute('open', '');
  }
}

var g_toast_timer = null;

function toast_show(key, ms, fallback) {
  var el = byId('ps-toast');
  if (!el) return;
  el.textContent = tr(key, fallback !== undefined ? fallback : key);
  el.classList.add('active');
  if (g_toast_timer) clearTimeout(g_toast_timer);
  g_toast_timer = setTimeout(function () { el.classList.remove('active'); }, ms || 3000);
}

function error_dialog() {
  dialog_open('dlg_error_title', 'dlg_error_text',
    [{ key: 'ui_ok', fallback: 'OK' }]);
}

/* ---------------------------------------------------------------------
   5. The socket, the merged state document, the deep merge
   ------------------------------------------------------------------- */

var g_sock = null;
var g_state = {};             /* the single merged source of truth (§0.2) */

var g_ui_ready = false;
var g_inbound_queue = [];     /* frames that arrive before the DOM is ready */
var g_out_queue = [];         /* outbound frames queued until the socket opens */

var g_have_first_state = false;
var g_landed = false;
var g_firstuse = false;

var g_ask_timer = null;
var g_ask_tries = 0;
var ASK_MAX = 5;

/* Deep merge src into dst, key by key. Plain objects merge; arrays and
   scalars replace, and so do arrays: this device sends list2 and blocklist whole
   and re-sort so all six survive being pushed one per frame (§0.2). */
/* JSON.parse makes __proto__ a real own property, so hasOwnProperty lets it
   through and the recursion below would walk straight into Object.prototype
   and write attacker-chosen keys onto every object on the page. The peer is
   the vent over ws:// on the LAN, so it takes a compromised device or someone
   on the wire, but the guard is one line. */
function deep_merge(dst, src) {
  for (var k in src) {
    if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
    var sv = src[k];
    if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
      if (!dst[k] || typeof dst[k] !== 'object' || Array.isArray(dst[k])) dst[k] = {};
      deep_merge(dst[k], sv);
    } else {
      /* Arrays and scalars replace. The vent merged one array per entry id, because its
         device sent a single device-state at a time. This one sends list2 and blocklist
         whole in every push (ps_state.c root_settings and root_block build both from the
         config each time), so replacing is what matches the device. */
      dst[k] = sv;
    }
  }
}

function ws_url() { return 'ws://' + location.host + '/ws'; }

function ws_raw_send(obj) {
  var str = JSON.stringify(obj);
  if (g_sock && g_sock.readyState === 1) {
    try { g_sock.send(str); return true; } catch (e) {}
  }
  g_out_queue.push(str);
  return false;
}

/* THE send helper every later module uses. One inbound message, a single
   top-level key (§1.1). Controls stay inert until the first state document
   lands — the ws_push guard the markup refers to. Our own "please
   send everything" request bypasses it via ws_raw_send. */
/* This device echoes. apply_settings returns the roots it changed and ps_ws.c:203 pushes
 * every root back to the sender, so the page does not have to remember what it just sent
 * and then reconcile. The vent had to: its device sent the light bodies once on connect
 * and never again, so a swatch that waited for an echo showed the old colour until a
 * reconnect. Here the echo is the source of truth and the page simply renders it. */
function ws_push(root, members) {
  if (document.body && document.body.classList.contains('is-waiting')) return;
  var msg = {};
  msg[root] = members || {};
  /* device_wakeup rides INSIDE each root, not on the frame: ps_state.c:269-272 walks the
     frame's children and checks each root object for it, logging the ones that arrive
     without. FACT about the factory page. Stamped here, at the one place every outbound
     root goes out, so no call site can forget it. */
  if (msg[root].device_wakeup === undefined) msg[root].device_wakeup = 1;
  ws_raw_send(msg);
}

function flush_out_queue() {
  if (!g_sock || g_sock.readyState !== 1) return;
  var q = g_out_queue;
  g_out_queue = [];
  for (var i = 0; i < q.length; i++) {
    try { g_sock.send(q[i]); } catch (e) { g_out_queue.push(q[i]); }
  }
}

/* On connect this device pushes all six roots in one frame, unprompted: ps_ws.c:183, FACT.
   There is no "send me everything" request to make, and an empty root of our own invention
   would only earn an "unknown root" in its log. So the fallback for a socket that opens and
   then says nothing is to reopen it, a few times, and then stop and let the page say so. */
function start_state_ask() {
  stop_state_ask();
  g_ask_tries = 0;
  g_ask_timer = setInterval(function () {
    if (g_have_first_state || g_ask_tries >= ASK_MAX) { stop_state_ask(); return; }
    g_ask_tries++;
    try { if (g_sock) g_sock.close(); } catch (e) {}
  }, 2000);
}

function stop_state_ask() {
  if (g_ask_timer) { clearInterval(g_ask_timer); g_ask_timer = null; }
}

function ws_open() {
  var sock;
  try { sock = new WebSocket(ws_url()); }
  catch (e) { setTimeout(ws_open, 2000); return; }
  g_sock = sock;
  window.g_sock = sock;

  sock.onopen = function () {
    flush_out_queue();
    if (!g_have_first_state) start_state_ask();
  };
  sock.onmessage = function (ev) {
    if (!g_ui_ready) { g_inbound_queue.push(ev.data); return; }
    ws_recv(ev.data);
  };
  sock.onclose = function () {
    stop_state_ask();
    /* Put the page back into waiting. is-waiting is the single gate every
       control checks and the only thing that shows the "waiting for the vent"
       banner, and nothing was ever re-adding it: after the vent rebooted or
       the Wi-Fi dropped the page still looked fully live, so every tap went
       into g_out_queue instead. */
    if (document.body) document.body.classList.add('is-waiting');
    g_have_first_state = false;
    /* And the backlog goes with it. Replaying a queue of vent commands minutes
       after they were given drives the flap from intent the user has long
       since abandoned; whatever they want when the link is back, they can ask
       for again against a page that is showing them the truth. */
    if (g_out_queue && g_out_queue.length) {
      console.log('[pv] link closed, dropping ' + g_out_queue.length + ' queued message(s)');
      g_out_queue.length = 0;
    }
    setTimeout(ws_open, 2000);   /* keep the page alive if the link drops */
  };
  sock.onerror = function () { try { sock.close(); } catch (e) {} };
}

function flush_inbound_queue() {
  var q = g_inbound_queue;
  g_inbound_queue = [];
  for (var i = 0; i < q.length; i++) ws_recv(q[i]);
}

/* ---------------------------------------------------------------------
   6. The router: one entry per socket frame (§0.4)
   ------------------------------------------------------------------- */

/* The roots this device pushes, in the order ps_state.c:119-126 emits them. FACT, read off
   the stock unit: ps_ws.c:183 sends all six in one frame on connect. This is a clone target,
   not a preference. Gates 1 and 2 are exact wire equivalence with the factory application,
   so where the UI and the device disagree the UI moves. */
var STATE_KEYS = ['wifi', 'sta', 'ap', 'printer', 'settings', 'block'];

function ws_recv(data) {
  var msg;
  try { msg = JSON.parse(data); }
  catch (e) { return; }
  if (!msg || typeof msg !== 'object') return;

  /* logs: its own partial document; render and return (§0.4, §11). */
  if (msg.logs) { render_logs(msg.logs); return; }


  /* 1. Merge every state key present into the running document (§0.2). */
  var mergedAny = false;
  for (var i = 0; i < STATE_KEYS.length; i++) {
    var key = STATE_KEYS[i];
    if (msg[key] !== undefined) {
      var patch = {};
      patch[key] = msg[key];
      deep_merge(g_state, patch);
      mergedAny = true;
    }
  }

  /* 2. First-state gate. settings is in every connect burst (ps_ws.c:183 sends all six
        roots in one frame), so its arrival is what proves the device is talking. */
  if (!g_have_first_state && msg.settings !== undefined) {
    g_have_first_state = true;
    stop_state_ask();
    if (document.body) document.body.classList.remove('is-waiting');
  }

  /* 3. Global chrome, from the merged doc (§0.7). */
  render_chrome();

  /* 4. The Status renderer runs on every state push so no value can lag. */
  if (mergedAny) render_status();

  /* 5. Per-card device-push handlers for whatever keys arrived. */
  if (msg.wifi !== undefined) handle_wifi(msg.wifi);
  if (msg.sta !== undefined) handle_sta(msg.sta);
  if (msg.ap !== undefined) handle_ap();
  if (msg.printer !== undefined) { handle_printer(msg.printer); handle_camera(); handle_pctl(); }
  if (msg.settings !== undefined) {
    handle_settings();
    /* settings carries the bar: current_mode, and list2[mode] with its brightness and its
       three state colours. 05-lighting.js owns the page; core owns the dispatch. */
    if (window.render_lighting) render_lighting();
  }
  if (msg.block !== undefined && window.render_lighting) render_lighting();

  /* 6. Landing, once, on the first frame carrying both states (§0.4). */
  if (!g_landed && !g_firstuse &&
    msg.sta && msg.sta.state !== undefined &&
    msg.printer && msg.printer.state !== undefined) {
    g_landed = true;
    if (msg.sta.state === 3 && msg.printer.state === 3) show_card('status');
    else show_card('sta');
  }

  /* 7. Response envelope: dialog / toast (§0.6). */
  if (msg.response) handle_response(msg.response);
}

/* ---------------------------------------------------------------------
   7. Global chrome (§0.7)
   ------------------------------------------------------------------- */

function render_chrome() {
  var s = g_state.settings || {};
  var vp = g_state.printer || {};

  /* Top bar name */
  var name = s.device_name;
  setText('ps-top-name', (name && name.length) ? name : 'PandaVentOS');

  /* Dot, state, percent, progress */
  var dot = byId('ps-top-dot');
  var st = vp.device_state;
  if (!g_have_first_state) {
    if (dot) dot.setAttribute('class', 'ux_top_dot');
    setText('ps-top-state', tr('waiting_for_device', "Waiting for the device. These controls are showing placeholders until it answers, so they are inactive for a moment."));
    setHidden('ps-top-pct', true);
    setHidden('ps-top-prog', true);
    setHidden('ps-top-prog-fill', true);
  } else {
    var cls = (isNum(st) && st >= 0 && st <= 5) ? TOP_DOT_CLASS[st] : 'is-idle';
    if (dot) dot.setAttribute('class', 'ux_top_dot ' + cls);
    setText('ps-top-state', device_state_name(st) || tr('waiting_for_device', "Waiting for the device. These controls are showing placeholders until it answers, so they are inactive for a moment."));

    var pct = vp.print_percent;
    var running = isNum(st) && (st === 1 || st === 2 || st === 3);
    if (running && isNum(pct) && pct >= 0) {
      setText('ps-top-pct', fmtPct(pct));
      setHidden('ps-top-pct', false);
    } else {
      setHidden('ps-top-pct', true);
    }
    var prog = byId('ps-top-prog');
    var fill = byId('ps-top-prog-fill');
    if (running && isNum(pct) && pct >= 0) {
      if (prog) { prog.hidden = false; prog.value = pct; }
      if (fill) { fill.hidden = false; fill.style.width = pct + '%'; }
    } else {
      if (prog) prog.hidden = true;
      if (fill) fill.hidden = true;
    }
  }

  /* Version badge */
  if (s.os_version) setText('ps-version-num', 'v' + s.os_version);
  else if (s.fw_version) setText('ps-version-num', s.fw_version);
  var vname = document.querySelector('#ps-version-badge .ux_version_name');
  if (vname) vname.textContent = s.os_name || 'PandaVentOS';
  var badge = byId('ps-version-badge');
  if (badge && (s.os_name || s.os_version)) {
    badge.setAttribute('title', (s.os_name || 'PandaVentOS') + (s.os_version ? ' ' + s.os_version : ''));
  }

  /* Config-save-failed banner. It cannot be dismissed: the fault is still
     happening while it shows, and it withdraws itself the moment the device
     reports a save that worked. The detail line names the error the device
     actually got and which keys are unstored, so the reader can tell a full
     NVS from a corrupt page. */
  var cfgFailed = !!s.cfg_save_failed;
  setHidden('ps-cfg-alert', !cfgFailed);
  if (cfgFailed) setText('ps-cfg-alert-detail', cfg_save_detail(s));
}

/* ---------------------------------------------------------------------
   8. Status card (§1)
   ------------------------------------------------------------------- */

function render_status() {
  /* The vent kept the print it was watching under its own policy root. This device keeps
     the same facts under the printer root, because that is what it emits. */
  var printer = g_state.printer || {};
  var st = printer.status || printer;

  render_job_strip(printer, st);
  render_lighting_now();
  render_kv_printer(st, printer, printer);
  render_trays(st);
  render_calibrate(printer);
  render_anim(st);
}

/* 1.1 The dashboard's read-only summary of the bar: which mode it is in, how bright, and
   at what speed. The page that changes any of it is Lighting; this only reports. */
function render_lighting_now() {
  var s = g_state.settings || {};
  var m = isNum(s.current_mode) ? s.current_mode : 0;
  var slot = (Array.isArray(s.list2) ? s.list2[m] : null) || {};

  setText('ps-light-showing', m === 1 ? tr('ui_h2d', 'H2D') : tr('ui_music', 'Music'));
  setText('ps-light-effect', isNum(slot.brightness) ? fmtPct(slot.brightness) : DASH);
  setText('ps-light-speed', (m === 1 && isNum(slot.speed)) ? fmtPct(slot.speed) : DASH);

  var dot = byId('ps-light-dot');
  if (dot) {
    var cols = slot.rgb_rgba;
    var c = Array.isArray(cols) && typeof cols[0] === 'string' ? cols[0] : '';
    if (c.charAt(0) !== '#') c = c ? '#' + c : '';
    dot.style.background = c ? c.slice(0, 7) : '';
  }
}

/* 1.1 Airflow dial + vent mode */
function render_job_strip(vp, st) {
  var name = st.job_name;
  setText('ps-job-name', (name && name.length) ? name : tr('status_no_job', 'No job'));

  var pct = vp.print_percent;
  setText('ps-job-pct', isNum(pct) ? fmtPct(pct) : '');
  var fill = byId('ps-job-fill');
  if (fill) { fill.value = isNum(pct) ? pct : 0; fill.style.width = (isNum(pct) ? pct : 0) + '%'; }

  var meta = byId('ps-job-meta');
  if (meta) {
    meta.innerHTML = '';
    if (isNum(st.layer_num)) {
      var layerTxt = isNum(st.layer_total)
        ? tr('status_layer', 'layer') + ' ' + st.layer_num + ' ' + tr('status_of', 'of') + ' ' + st.layer_total
        : tr('status_layer', 'layer') + ' ' + st.layer_num;
      meta.appendChild(valueSpan(layerTxt));
    }
    if (isNum(st.remain_min)) {
      meta.appendChild(valueSpan(fmtRemain(st.remain_min) + ' ' + tr('status_left', 'left')));
    }
    if (isNum(st.spd_lvl) && SPEED_WORDS[st.spd_lvl]) {
      meta.appendChild(valueSpan(tr('speed_word_' + st.spd_lvl, SPEED_WORDS[st.spd_lvl])));
    }
  }
}

/* 1.3 Lighting-now key/values */
function effect_name(fxId, which) {
  var sel = byId(which === 'h2d' ? 'ps-rgb-h2d-mode-type' : 'ps-rgb-simple-mode-type');
  if (sel && sel.options && sel.options[fxId]) {
    var t = sel.options[fxId].textContent;
    if (t) return t;
  }
  return EFFECT_NAMES[fxId] || String(fxId);
}

function kv_li_plain(label, valueNode) {
  var li = document.createElement('li');
  var d = document.createElement('div');
  d.className = 'max';
  d.textContent = label;
  li.appendChild(d);
  li.appendChild(valueNode || unknownSpan());
  return li;
}

function kv_li_icon(icon, label, sub, valueNode) {
  var li = document.createElement('li');
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'i');
  var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', '#i-' + icon);
  svg.appendChild(use);
  li.appendChild(svg);
  var d = document.createElement('div');
  d.className = 'max';
  if (sub) {
    var t = document.createElement('div'); t.textContent = label; d.appendChild(t);
    var s = document.createElement('div'); s.className = 'small-text'; s.textContent = sub; d.appendChild(s);
  } else {
    d.textContent = label;
  }
  li.appendChild(d);
  li.appendChild(valueNode || unknownSpan());
  return li;
}

function vnode(cond, text) { return cond ? valueSpan(text) : unknownSpan(); }

function render_kv_printer(st, printer, vp) {
  var host = byId('ps-kv-printer');
  if (!host) return;
  host.innerHTML = '';
  var d = g_state;

  /* link */
  var ps = printer.state;
  host.appendChild(kv_li_icon('network', tr('status_link', 'Link'), null,
    vnode(!!link_state_name(ps), link_state_name(ps) || '')));

  /* printer state */
  var dsv = vp.device_state;
  host.appendChild(kv_li_icon('printer-enclosed', tr('ui_state', 'State'), null,
    vnode(!!device_state_name(dsv), device_state_name(dsv) || '')));

  /* nozzle temp */
  host.appendChild(kv_li_icon('nozzle-temp', tr('status_nozzle', 'Nozzle'),
    nozzle_spec(st),
    vnode(isNum(st.nozzle_temp), fmtTemp(st.nozzle_temp))));

  /* bed temp */
  host.appendChild(kv_li_icon('bed-hot', tr('status_bed', 'Bed'), null,
    vnode(isNum(vp.bed_temp), fmtTemp(vp.bed_temp))));

  /* chamber temp */
  host.appendChild(kv_li_icon('temp', tr('status_chamber', 'Chamber'), null,
    vnode(isNum(st.chamber_temp), fmtTemp(st.chamber_temp))));

  /* material now */
  host.appendChild(kv_li_icon('spool-end', tr('status_material', 'Material'), null,
    vnode(!!(vp.material && vp.material.length), vp.material)));

  /* fans: all-null -> whole row unknown */
  var fanVals = [st.fan_part, st.fan_aux, st.fan_chamber];
  var anyFan = fanVals.some(function (f) { return isNum(f); });
  var fanNode;
  if (anyFan) {
    fanNode = valueSpan(fanVals.map(function (f) { return isNum(f) ? fmtPct(f) : DASH; }).join(' · '));
  } else { fanNode = unknownSpan(); }
  host.appendChild(kv_li_icon('fan', tr('status_fans', 'Fans'), null, fanNode));

  /* chamber light */
  host.appendChild(kv_li_icon('lighting', tr('status_chamber_light', 'Chamber light'), null,
    vnode(isNum(st.printer_light), st.printer_light ? tr('ui_on', 'On') : tr('ui_off', "off"))));

  /* filament present */
  host.appendChild(kv_li_icon('spool-end', tr('ui_filament', 'Filament'), null,
    vnode(isNum(st.filament_in), st.filament_in ? tr('ui_yes', 'Yes') : tr('ui_no', 'No'))));

  /* nozzle spec (dedicated row) */
  host.appendChild(kv_li_icon('nozzle', tr('ui_kv_nozzle_fitted', 'Nozzle fitted'), null,
    vnode(!!nozzle_spec(st), nozzle_spec(st))));

  /* door */
  host.appendChild(kv_li_icon('printer-open', tr('status_door', 'Door'), null,
    vnode(isNum(st.door_open), st.door_open ? tr('door_open', 'Open') : tr('door_shut', 'Shut'))));

  /* fault code */
  host.appendChild(kv_li_icon('warning', tr('status_fault_code', 'Fault code'), null,
    vnode(!!(st.hms_code && st.hms_code.length), st.hms_code)));

  /* fw update */
  host.appendChild(kv_li_icon('refresh', tr('status_fw_update', "Printer firmware"), null,
    vnode(isNum(st.fw_update), st.fw_update ? tr('fw_ready', 'Ready') : tr('fw_current', 'Up to date'))));

  /* AMS humidity + temp */
  var amsParts = [];
  if (isNum(st.ams_humidity_pct)) amsParts.push(fmtPct(st.ams_humidity_pct));
  else if (isNum(st.ams_humidity)) amsParts.push(tr('ams_level', 'level') + ' ' + st.ams_humidity);
  if (isNum(st.ams_temp)) amsParts.push(fmtTemp(st.ams_temp));
  host.appendChild(kv_li_icon('humidity', tr('ui_kv_ams_humidity', 'AMS humidity'), null,
    amsParts.length ? valueSpan(amsParts.join(' · ')) : unknownSpan()));

  /* printer wifi */
  host.appendChild(kv_li_icon('network', tr('ui_kv_printer_signal', 'Printer signal'), null,
    vnode(!!(st.printer_rssi && st.printer_rssi.length), st.printer_rssi)));

  /* vent wifi: ssid + ip + rssi */
  var wifi = d.wifi || {}, sta = d.sta || {};
  var ventParts = [];
  if (wifi.ssid && wifi.ssid.length) ventParts.push(wifi.ssid);
  if (sta.ip && sta.ip.length) ventParts.push(sta.ip);
  if (isNum(st.wifi_rssi)) ventParts.push(st.wifi_rssi + ' dBm');
  host.appendChild(kv_li_icon('network', tr('ui_kv_vent_network', 'Vent network'), null,
    ventParts.length ? valueSpan(ventParts.join(' · ')) : unknownSpan()));

  /* uptime */
  host.appendChild(kv_li_icon('clock', tr('status_uptime', 'Uptime'), null,
    vnode(isNum(st.uptime_s), isNum(st.uptime_s) ? fmtUptime(st.uptime_s) : '')));

  /* memory */
  host.appendChild(kv_li_icon('memory', tr('ui_kv_free_memory', 'Free memory'), null,
    vnode(isNum(st.heap_free), isNum(st.heap_free) ? fmtKB(st.heap_free) : '')));
}

/* nozzle spec: diameter + kind code. The 4-char kind -> material + flow
   class decode table is NOT given by the spec (recorded as a gap), so the
   raw kind code is shown alongside the diameter rather than invented. */
/* The printer reports its nozzle as a diameter and a 4-character kind code.
   Decoded here as material (1st letter) + flow class (2nd letter): the
   fixture's HH01 is the "0.4 mm, hardened steel, high flow" the markup
   shows. Letters not in the tables fall back to the raw code. */
var NOZZLE_MATERIAL = { H: 'hardened steel', S: 'stainless steel', C: 'tungsten carbide' };
var NOZZLE_FLOW = { H: 'high flow', S: 'standard flow' };
function nozzle_kind_text(kind) {
  if (!kind || typeof kind !== 'string') return null;
  var k = kind.toUpperCase();
  var mat = NOZZLE_MATERIAL[k.charAt(0)];
  var flow = NOZZLE_FLOW[k.charAt(1)];
  if (!mat) return kind;
  var out = tr('ui_nozzle_' + k.charAt(0).toLowerCase(), mat);
  if (flow) out += ', ' + tr('ui_nozzle_flow_' + k.charAt(1).toLowerCase(), flow);
  return out;
}
function nozzle_spec(st) {
  var parts = [];
  if (st.nozzle_dia && String(st.nozzle_dia).length) parts.push(st.nozzle_dia + ' mm');
  var kt = nozzle_kind_text(st.nozzle_kind);
  if (kt) parts.push(kt);
  return parts.length ? parts.join(', ') : null;
}

/* 1.5 AMS trays */
function render_trays(st) {
  var wrap = byId('ps-trays');
  var row = byId('ps-trays-row');
  var trays = st.trays;
  if (!Array.isArray(trays) || trays.length === 0) {
    if (wrap) wrap.hidden = true;
    if (row) row.innerHTML = '';
    return;
  }
  if (wrap) wrap.hidden = false;
  if (!row) return;
  row.innerHTML = '';
  for (var i = 0; i < trays.length; i++) {
    var tray = trays[i];
    if (!tray) continue;
    var chip = document.createElement('span');
    chip.className = 'chip border tray-chip';
    if (tray.i === st.tray_now) chip.classList.add('is-now');
    var dot = document.createElement('i');
    dot.className = 'circle small swatch-dot';
    var hex = hexColour(tray.color);
    if (hex) dot.style.background = hex;
    chip.appendChild(dot);
    var label = tray.type || DASH;
    if (isNum(tray.remain) && tray.remain >= 0) label += ' ' + tray.remain + '%';
    chip.appendChild(document.createTextNode(' ' + label));
    row.appendChild(chip);
  }
}

/* 1.6 Endstop check */
function render_calibrate(vp) {
  var cal = vp.calibrate || {};
  var state = cal.state;
  var running = (state === 1);

  var btn = byId('ps-btn-cal');
  if (btn) {
    btn.disabled = running;
    var lbl = btn.querySelector('span');
    if (running) {
      var stepMap = { 0: tr('ui_cal_step_closing', 'Closing...'), 1: tr('ui_cal_step_opening', 'Opening...'), 2: tr('ui_cal_step_restoring', 'Restoring...') };
      if (lbl) lbl.textContent = stepMap[cal.step] || tr('ui_cal_running', 'Running...');
    } else {
      if (lbl) lbl.textContent = tr('ui_run_the_check', 'Run the check');
    }
  }

  var result = byId('ps-cal-result');
  var showResult = (state === 2 || state === 3);
  if (result) result.hidden = !showResult;

  var kv = byId('ps-kv-cal');
  if (kv) {
    kv.innerHTML = '';
    if (showResult) {
      kv.appendChild(kv_li_plain(tr('cal_closed', "At the closed stop"),
        isNum(cal.closed_mv) ? valueSpan(cal.closed_mv + ' mV · ' + (cal.closed_ok ? tr('cal_in_band', "in range") : tr('cal_off_band', "out of range"))) : unknownSpan()));
      kv.appendChild(kv_li_plain(tr('cal_open', "At the open stop"),
        isNum(cal.open_mv) ? valueSpan(cal.open_mv + ' mV · ' + (cal.open_ok ? tr('cal_in_band', "in range") : tr('cal_off_band', "out of range"))) : unknownSpan()));
      var verdict = (cal.closed_ok && cal.open_ok);
      kv.appendChild(kv_li_plain(tr('cal_verdict', 'Verdict'),
        valueSpan(verdict ? tr('cal_ok', "Both endstops read correctly.") : tr('cal_bad', "At least one endstop is off. Check that the vent moves freely and that the sensor cable is seated."))));
    }
  }
}

/* 11.2 Uploaded animation (rendered from status) */
function render_anim(st) {
  var anim = st.anim || {};
  var host = byId('ps-kv-anim');
  if (host) {
    host.innerHTML = '';
    var frames = anim.frames || 0;
    host.appendChild(kv_li_plain(tr('anim_loaded', 'Loaded'),
      valueSpan(frames > 0 ? (frames + ' ' + tr('anim_frames', 'frames')) : tr('anim_none', 'Nothing'))));
    if (frames > 0 && isNum(anim.bytes)) {
      host.appendChild(kv_li_plain(tr('anim_size', "Memory used"), valueSpan(fmtKB(anim.bytes))));
    }
    if (isNum(anim.max_frames)) {
      host.appendChild(kv_li_plain(tr('anim_room', 'Room for'), valueSpan(anim.max_frames + ' ' + tr('anim_frames', 'frames'))));
    }
  }
  setHidden('ps-btn-anim-clear', !(anim.frames > 0));
}

/* ---------------------------------------------------------------------
   9. Behaviour card: vent policy, ring, leds (§2, device push)
   ------------------------------------------------------------------- */

var g_simple_selected = null;
var g_last_simple_current = null;
var g_h2d_selected = null;
var g_h2d_populated = false;

var NVS_ERRS = {
  4353: 'the store is not initialised',
  4354: 'the key was not found',
  4355: 'the handle is invalid',
  4356: 'the value is too long',
  4357: 'the store is full',
  4358: 'the key is invalid',
  4359: 'the store is out of pages',
  4360: 'the value does not fit the page'
};

/* What failed to save, in words the reader's language already has.
 *
 * This used to build the line from five keys that exist in no language file
 * and eight English sentences about NVS internals, so every reader outside
 * English got a paragraph of English in the middle of their own page -- and
 * the eight sentences were about the flash store's internal state, which is
 * not something the owner of a vent can act on anyway.
 *
 * It now names the parts using the keys the page already uses for them --
 * Settings and Lighting, plus each device state's own translated name -- and
 * gives the failure as its numeric code, which needs no translation and is
 * the thing worth quoting in a bug report. The English explanation of the
 * code still goes to the console for whoever is reading logs. */
function cfg_save_detail(s) {
  var bits = isNum(s.cfg_save_keys) ? s.cfg_save_keys : 0;
  var which = [];
  if (bits & 1) which.push(tr('card_settings', 'Settings'));
  var states = [];
  for (var i = 0; i < 6; i++) if (bits & (2 << i)) states.push(device_state_name(i));
  if (states.length) which.push(tr('ui_lighting', 'Lighting') + ' (' + states.join(', ') + ')');
  var err = isNum(s.cfg_save_err) ? s.cfg_save_err : 0;
  if (err && NVS_ERRS[err]) console.log('[pv] save failed: ' + NVS_ERRS[err] + ' (' + err + ')');
  var code = err ? '0x' + err.toString(16).toUpperCase() : '';
  if (!which.length) return code;
  return which.join('; ') + (code ? ' \u2014 ' + code : '');
}

/* Slider + its label, guarding focus. */
function set_slider(id, valueId, val, suffix) {
  var el = byId(id);
  if (el && document.activeElement !== el && isNum(val)) el.value = val;
  if (valueId && isNum(val)) setText(valueId, suffix ? (val + suffix) : String(val));
}

/* Paint a swatch button background from a colour, or show the unset hatch.
   Leaving the old paint alone when the colour goes away left the swatch
   showing a colour the device no longer holds. */
function set_swatch(id, col) {
  var el = byId(id);
  if (!el) return;
  var hex = hexColour(col);
  if (hex) { el.style.background = hex; el.classList.remove('is-unset'); }
  else { el.style.background = ''; el.classList.add('is-unset'); }
}

function set_swatch_unset(id, col, clearId) {
  var el = byId(id);
  var set = !!hexColour(col);
  if (el) {
    if (set) { el.style.background = hexColour(col); el.classList.remove('is-unset'); }
    else { el.style.background = ''; el.classList.add('is-unset'); }
  }
  if (clearId) setHidden(clearId, !set);
}

/* Shared effect-editor repaint for a given suffix set. */
var SIMPLE_SUFFIX = {
  effectSel: 'ps-rgb-simple-mode-type',
  bg: 'ps-mode1-bg-percent', bgVal: 'ps-mode1-bg-percent-value',
  speed: 'ps-mode1-speed-percent', speedVal: 'ps-mode1-speed-percent-value', speedC: 'mode1_speed_container',
  be: 'ps-mode1-be-percent', beVal: 'ps-mode1-be-percent-value', beClear: 'ps-clear-simple-be',
  col: 'ps-picker-btn-simple', colClosed: 'ps-picker-btn-simple-closed',
  bg2: 'ps-picker-btn-simple-bg', bg2Clear: 'ps-clear-simple-bg',
  bg2Closed: 'ps-picker-btn-simple-bg-closed', bg2ClosedClear: 'ps-clear-simple-bg-closed',
  bandRow: 'ps-band-row-simple', band: 'ps-band-simple', bandVal: 'ps-band-simple-value', bandClear: 'ps-band-clear-simple',
  gradRow: 'ps-grad-row-simple', gradMin: 'ps-grad-min-simple', gradMax: 'ps-grad-max-simple',
  rev: 'ps-fx-rev-simple'
};

var H2D_SUFFIX = {
  effectSel: 'ps-rgb-h2d-mode-type',
  bg: 'ps-mode2-bg-percent', bgVal: 'ps-mode2-bg-percent-value',
  speed: 'ps-mode2-speed-percent', speedVal: 'ps-mode2-speed-percent-value', speedC: 'mode2_speed_container',
  be: 'ps-mode2-be-percent', beVal: 'ps-mode2-be-percent-value', beClear: 'ps-clear-h2d-be',
  col: 'ps-picker-btn-h2d', colClosed: 'ps-picker-btn-h2d-closed',
  bg2: 'ps-picker-btn-h2d-bg', bg2Clear: 'ps-clear-h2d-bg',
  bg2Closed: 'ps-picker-btn-h2d-bg-closed', bg2ClosedClear: 'ps-clear-h2d-bg-closed',
  bandRow: 'ps-band-row-h2d', band: 'ps-band-h2d', bandVal: 'ps-band-h2d-value', bandClear: 'ps-band-clear-h2d',
  gradRow: 'ps-grad-row-h2d', gradMin: 'ps-grad-min-h2d', gradMax: 'ps-grad-max-h2d',
  rev: 'ps-fx-rev-h2d'
};

function handle_settings() {
  var s = g_state.settings || {};
  setInputValue('ps-settings-fw-ver', s.fw_version);
  setInputValue('ps-settings-device-name', s.device_name);
  setText('ps-settings-printing-ui-type', s.device_name);
  if (s.language) set_language(s.language);
  /* ps-settings-img-ver is Panda-Status only; a vent never sends it. */
  /* Version badge + cfg banner are handled in render_chrome (§0.7). */
}

/* ---------------------------------------------------------------------
   12. Printer card (§6, device push)
   ------------------------------------------------------------------- */

var g_prev_printer_state = null;
var g_prev_printer_scan = null;
var g_was_binding = false;
var g_bind_timer = null;
var g_bind_start = 0;
var g_cur_printer = null;

function handle_printer(printer) {
  /* 6.3 Scan list reply */
  if (Array.isArray(printer.list)) {
    rebuild_printer_list(printer.list);
  }

  /* 6.1 Fields + current binding */
  if (printer.name && printer.name.length) {
    setInputValue('ps-printer-sn', printer.sn);
    setInputValue('ps-printer-access-code', printer.access_code);
    setInputValue('ps-printer-ip', printer.ip);
    add_printer_option(printer.name, printer.sn, true);
    g_cur_printer = { name: printer.name, sn: printer.sn, access_code: printer.access_code, ip: printer.ip };
  }

  /* 6.2 Bind state */
  if (printer.state !== undefined) paint_printer_bind(printer.state);

  /* 6.3 Scan state */
  if (printer.scan !== undefined) paint_printer_scan(printer.scan);
}

function add_printer_option(name, sn, select) {
  var sel = byId('ps-printer-name');
  if (!sel || !sn) return;
  var found = null;
  for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === sn) { found = sel.options[i]; break; } }
  if (!found) {
    found = document.createElement('option');
    found.value = sn;
    found.textContent = name || sn;
    sel.appendChild(found);
  }
  if (select) sel.value = sn;
}

function rebuild_printer_list(list) {
  var sel = byId('ps-printer-name');
  if (sel) sel.innerHTML = '';
  setInputValue('ps-printer-sn', '');
  setInputValue('ps-printer-access-code', '');
  setInputValue('ps-printer-ip', '');
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].sn) add_printer_option(list[i].name, list[i].sn, false);
  }
  if (g_cur_printer && g_cur_printer.sn) {
    add_printer_option(g_cur_printer.name, g_cur_printer.sn, true);
    setInputValue('ps-printer-sn', g_cur_printer.sn);
    setInputValue('ps-printer-access-code', g_cur_printer.access_code);
    setInputValue('ps-printer-ip', g_cur_printer.ip);
    return;
  }

  /* Nothing bound yet, which is every first setup.
     The picker shows its first option whether or not anything selected it,
     so after a scan the name read "P2S Right" while the serial and address
     sat empty: the fields are only filled on a `change` event, and building
     options in script fires none. The card then asked for a serial the vent
     already knew. Fill from the same entry the picker is showing -- the
     scan reports name, sn and ip -- and leave only the access code, which
     is the one thing no scan can see because it lives on the printer's
     own screen. */
  var first = null;
  for (var j = 0; j < list.length; j++) {
    if (list[j] && list[j].sn) { first = list[j]; break; }
  }
  if (!first) return;
  if (sel) sel.value = first.sn;
  setInputValue('ps-printer-sn', first.sn);
  setInputValue('ps-printer-ip', first.ip || '');
}

function set_use_href(id, href) {
  var svg = byId(id);
  if (!svg) return;
  var use = svg.querySelector('use');
  if (use) use.setAttribute('href', href);
}

function paint_printer_bind(state) {
  var btn = byId('ps-btn-printer-bind');
  var span = byId('ps-span-printer-bind');
  var binding = (state === 2);
  var bound = (state === 3);

  /* label */
  var label = tr('ui_bind', 'Bind');
  if (state === 2) label = tr('ui_binding', 'Binding');
  else if (state === 3) label = tr('ui_unbind', 'Unbind');
  if (span) span.textContent = label;

  /* icon */
  if (state === 2) { set_use_href('ps-img-printer-bind', '#i-refresh'); var im = byId('ps-img-printer-bind'); if (im) im.classList.add('spin'); }
  else if (state === 3) { set_use_href('ps-img-printer-bind', '#i-link-off'); var im2 = byId('ps-img-printer-bind'); if (im2) im2.classList.remove('spin'); }
  else { set_use_href('ps-img-printer-bind', '#i-link'); var im3 = byId('ps-img-printer-bind'); if (im3) im3.classList.remove('spin'); }

  /* elapsed timer while binding */
  if (binding) {
    if (!g_bind_timer) {
      g_bind_start = Date.now();
      g_bind_timer = setInterval(function () {
        setText('ps-timer-printer-bind', Math.floor((Date.now() - g_bind_start) / 1000) + ' s');
      }, 1000);
      setText('ps-timer-printer-bind', '0 s');
    }
  } else {
    if (g_bind_timer) { clearInterval(g_bind_timer); g_bind_timer = null; }
    setText('ps-timer-printer-bind', '');
  }

  /* lock fields while binding or bound */
  var lock = binding || bound;
  ['ps-printer-name', 'ps-printer-sn', 'ps-printer-access-code', 'ps-printer-ip'].forEach(function (id) {
    var el = byId(id);
    if (el) el.disabled = lock;
  });

  /* state -> dialog
     Only on a CHANGE. The firmware sends every part on every push and these
     failure states are sticky or repeating -- 4 and 6 are re-set on each mqtt
     reconnect attempt, 5 is latched -- and dialog_open re-showModal()s an
     already-open dialog. An unreachable printer therefore reopened the same
     dialog under the reader's cursor every couple of seconds, with no way to
     dismiss it for longer than the gap between frames. The success branch was
     already edge-guarded by g_was_binding; the failures were not. */
  var bind_changed = (state !== g_prev_printer_state);
  if (state === 3 && g_was_binding) {
    dialog_open('dlg_bind_ok_title', 'dlg_bind_ok_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  } else if (state === 4 && bind_changed) {
    dialog_open('dlg_bind_ip_title', 'dlg_bind_ip_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  } else if (state === 5 && bind_changed) {
    dialog_open('dlg_bind_sn_title', 'dlg_bind_sn_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  } else if (state === 6 && bind_changed) {
    dialog_open('dlg_bind_code_title', 'dlg_bind_code_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  } else if (state === 7 && bind_changed) {
    dialog_open('dlg_bind_unknown_title', 'dlg_bind_unknown_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  }

  g_was_binding = binding;
  g_prev_printer_state = state;
}

function paint_printer_scan(scan) {
  var img = byId('ps-img-scan-printer');
  if (scan === 1 || scan === 3) {
    set_use_href('ps-img-scan-printer', '#i-refresh');
    if (img) img.classList.add('spin');
  } else {
    set_use_href('ps-img-scan-printer', '#i-search');
    if (img) img.classList.remove('spin');
  }
  if (scan === 2) {
    if (g_prev_printer_scan === 1 || g_prev_printer_scan === 3) dialog_open('dlg_scan_ok_title', 'dlg_scan_ok_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  } else if (scan === 4 && scan !== g_prev_printer_scan) {
    dialog_open('dlg_scan_sn_title', 'dlg_scan_sn_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  } else if (scan === 5 && scan !== g_prev_printer_scan) {
    dialog_open('dlg_scan_ip_title', 'dlg_scan_ip_text', [
      { key: 'ui_hotspot', fallback: 'Hotspot', handler: function () { show_card('ap'); } },
      { key: 'cancel', fallback: 'Cancel' }
    ]);
  } else if (scan === 6 && scan !== g_prev_printer_scan) {
    dialog_open('dlg_scan_newip_title', 'dlg_scan_newip_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  }
  g_prev_printer_scan = scan;
}

/* ---------------------------------------------------------------------
   13. Wi-Fi (Station) card (§7, device push)
   ------------------------------------------------------------------- */

var g_prev_sta_state = null;
var g_wifi_scanning = false;
var g_cur_wifi = null;

function handle_wifi(wifi) {
  /* 7.1 scan list reply */
  if (Array.isArray(wifi.list)) {
    rebuild_wifi_list(wifi.list);
  }

  /* 7.1 ssid */
  if (wifi.ssid !== undefined) {
    if (wifi.ssid === '') {
      /* no saved network: send the owner to the first-use flow */
      if (!g_landed) { g_firstuse = true; show_page('ps-page-language'); }
    } else {
      add_wifi_option(wifi.ssid, true);
      setInputValue('ps-password-wifi', wifi.password);
      g_cur_wifi = { ssid: wifi.ssid, password: wifi.password };
    }
  }

  /* 7.1 scan state */
  if (wifi.scan !== undefined) paint_wifi_scan(wifi.scan);
}

function add_wifi_option(ssid, select) {
  var sel = byId('ps-wifi-ssid');
  if (!sel || !ssid) return;
  var found = null;
  for (var i = 0; i < sel.options.length; i++) { if (sel.options[i].value === ssid || sel.options[i].textContent === ssid) { found = sel.options[i]; break; } }
  if (!found) {
    found = document.createElement('option');
    found.value = ssid;
    found.textContent = ssid;
    sel.appendChild(found);
  }
  if (select) sel.value = found.value;
}

function rebuild_wifi_list(list) {
  var sel = byId('ps-wifi-ssid');
  if (sel) sel.innerHTML = '';
  setInputValue('ps-password-wifi', '');
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].ssid) add_wifi_option(list[i].ssid, false);
  }
  if (g_cur_wifi && g_cur_wifi.ssid) {
    add_wifi_option(g_cur_wifi.ssid, true);
    setInputValue('ps-password-wifi', g_cur_wifi.password);
  }
}

function paint_wifi_scan(scan) {
  var img = byId('ps-img-scan-wifi');
  if (scan === 1) {
    g_wifi_scanning = true;
    set_use_href('ps-img-scan-wifi', '#i-refresh');
    if (img) img.classList.add('spin');
  } else {
    set_use_href('ps-img-scan-wifi', '#i-search');
    if (img) img.classList.remove('spin');
    if (scan === 2 && g_wifi_scanning) {
      g_wifi_scanning = false;
      dialog_open('dlg_scan_ok_title', 'dlg_scan_ok_text', [{ key: 'ui_ok', fallback: 'OK' }]);
    }
  }
}

function handle_sta(sta) {
  /* These two are <span>s on the Connected card, not inputs. setInputValue
     assigns .value, which a span simply does not render, so the Address row
     had been blank since the card was built -- and nothing wrote the signal
     at all. The strength is only present while associated, so the row empties
     itself when it should rather than keeping a stale reading. */
  setText('ps-sta-ip', sta.ip);
  var _vst = (g_state.printer && g_state.printer.status) || {};
  setText('ps-sta-rssi', isNum(_vst.wifi_rssi) ? _vst.wifi_rssi + ' dBm' : '');
  setInputValue('ps-sta-hostname', sta.hostname);

  var state = sta.state;
  var lbl = byId('ps-label-sta-state');
  if (lbl && isNum(state)) {
    var v = trLookup('sta_state_' + state);
    lbl.textContent = (v != null) ? v : (STA_STATES[state] || DASH);
  }

  if (state === 3 && (g_prev_sta_state === 2 || g_prev_sta_state === 4)) {
    dialog_open('dlg_conn_ok_title', 'dlg_conn_ok_text', [
      { key: 'card_printer', fallback: 'Printer', handler: function () { show_card('printer'); } },
      { key: 'cancel', fallback: 'Cancel' }
    ]);
  } else if (state === 4 && state !== g_prev_sta_state) {
    dialog_open('dlg_conn_reconnect_title', 'dlg_conn_reconnect_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  } else if (state === 5 && state !== g_prev_sta_state) {
    dialog_open('dlg_conn_pw_title', 'dlg_conn_pw_text', [{ key: 'ui_ok', fallback: 'OK' }]);
  }
  g_prev_sta_state = state;
}

/* ---------------------------------------------------------------------
   14. Hotspot (AP) card (§8, device push)
   ------------------------------------------------------------------- */

function handle_ap() {
  var ap = g_state.ap || {};
  setInputValue('ps-ap-ssid', ap.ssid);
  setInputValue('ps-password-ap', ap.password);
  setInputValue('ps-ap-ip', ap.ip);
  setChecked('ps-btn-ap-on', ap.on, true);
  var sw = byId('ps-card-ap-switch');
  if (sw) sw.classList.toggle('active', !!ap.on);
  var note = byId('ps-label-ap-note');
  if (note) {
    var v = trLookup(ap.on ? 'ui_ap_note_on' : 'ui_ap_note_off');
    if (v != null) note.textContent = v;
  }
}

/* ---------------------------------------------------------------------
   15. Camera card (§9, device push)
   ------------------------------------------------------------------- */

function handle_camera() {
  var st = (g_state.printer && g_state.printer.status) || {};
  var printer = g_state.printer || {};
  var linked = (printer.state === 3);
  var present_cam = linked && (st.cam_present === 1);

  setHidden('ps-cam-none', present_cam);
  setHidden('ps-cam-ctl', !present_cam);

  /* readout rows */
  var host = byId('ps-kv-camera');
  if (host) {
    host.innerHTML = '';
    host.appendChild(kv_li_icon('image', tr('cam_resolution', 'Resolution'), null,
      vnode(!!(st.cam_res && st.cam_res.length), st.cam_res)));
    host.appendChild(kv_li_icon('video', tr('cam_record', 'Recording'), null,
      vnode(isNum(st.cam_record), st.cam_record ? tr('ui_on', 'On') : tr('ui_off', "off"))));
    host.appendChild(kv_li_icon('clock', tr('cam_timelapse', 'Timelapse'), null,
      vnode(isNum(st.cam_timelapse), st.cam_timelapse ? tr('ui_on', 'On') : tr('ui_off', "off"))));
    var storeNode;
    if (isNum(st.cam_free_mb) && isNum(st.cam_total_mb)) storeNode = valueSpan(fmtStorageMB(st.cam_free_mb) + ' / ' + fmtStorageMB(st.cam_total_mb));
    else if (isNum(st.cam_free_mb)) storeNode = valueSpan(fmtStorageMB(st.cam_free_mb));
    else storeNode = unknownSpan();
    host.appendChild(kv_li_icon('disk', tr('cam_storage', 'Storage'), null, storeNode));
  }

  /* record toggle */
  setChecked('ps-cam-record', st.cam_record, true);

  /* rtsp */
  var url = st.cam_rtsp;
  var usable = !!(url && url.length && url !== 'disable');
  var note = byId('ps-cam-rtsp-note');
  if (note) {
    if (!url || url === '') note.textContent = tr('cam_rtsp_off', "RTSP is turned off on the printer. Turn it on from the printer's own screen, under the camera settings, and the address will appear here.");
    else if (url === 'disable') note.textContent = tr('ui_cam_rtsp_disabled', "RTSP is switched off on the printer. Turn on LAN Mode Liveview in the printer's camera settings, then the address appears here.");
    else note.textContent = tr('ui_cam_rtsp_enabled', 'A browser cannot play this stream. Copy the address into VLC or Home Assistant.');
  }
  setHidden('ps-cam-rtsp-row', !usable);
  if (usable) setText('ps-cam-rtsp', url);
}

/* ---------------------------------------------------------------------
   16. Printer control card (§10, device push)
   ------------------------------------------------------------------- */

var g_pctl_locked = false;
var g_last_cmd_at = null;

function handle_pctl() {
  var st = (g_state.printer && g_state.printer.status) || {};
  var printer = g_state.printer || {};

  var card = byId('ps-card-pctl');
  if (card) card.hidden = (printer.state !== 3);

  setChecked('ps-pctl-chamber-light', st.printer_light, true);

  var wlRow = byId('ps-pctl-work-light-row');
  var hasWL = (st.work_light === 0 || st.work_light === 1);
  if (wlRow) wlRow.hidden = !hasWL;
  if (hasWL) setChecked('ps-pctl-work-light', st.work_light, true);

  setHidden('ps-pctl-locked', !g_pctl_locked);

  /* 10.2 command ack */
  var cmd = st.cmd;
  if (cmd && isNum(cmd.at_s) && cmd.at_s !== g_last_cmd_at) {
    g_last_cmd_at = cmd.at_s;
    if (cmd.ok === false || cmd.ok === 0) {
      if (cmd.reason && /verify failed/i.test(cmd.reason)) {
        g_pctl_locked = true;
        setHidden('ps-pctl-locked', false);
        toast_show('ui_pctl_needs_dev_mode', 4000, 'The printer refused: it only takes this from a signed app unless Developer Mode (LAN mode) is on.');
      } else {
        var el = byId('ps-toast');
        if (el) { el.textContent = cmd.reason || tr('response_err', 'Command failed'); el.classList.add('active'); if (g_toast_timer) clearTimeout(g_toast_timer); g_toast_timer = setTimeout(function () { el.classList.remove('active'); }, 4000); }
      }
    }
  }
}

/* ---------------------------------------------------------------------
   17. Logs card (§11, request/reply)
   ------------------------------------------------------------------- */

function render_logs(logs) {
  var view = byId('ps-log-view');
  if (!view) return;
  view.innerHTML = '';
  var lines = logs.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    view.textContent = tr('logs_empty', 'The log is empty.');
    return;
  }
  var frag = document.createDocumentFragment();
  for (var i = 0; i < lines.length; i++) {
    var ln = lines[i];
    if (!ln) continue;
    var t = isNum(ln.t) ? ln.t.toFixed(3) : '';
    while (t.length < 9) t = ' ' + t;   /* right-pad time */
    var s = ln.s || '';
    var row = document.createElement('div');
    if (/^E /.test(s)) row.className = 'e';
    else if (/^W /.test(s)) row.className = 'w';
    row.textContent = t + '  ' + s;
    frag.appendChild(row);
  }
  view.appendChild(frag);
  view.scrollTop = view.scrollHeight;   /* newest at the bottom */
}

/* ---------------------------------------------------------------------
   18. Response envelope (§0.6)
   ------------------------------------------------------------------- */

function handle_response(resp) {
  var type = resp.type;
  var ok = (resp.ok === 1 || resp.ok === true);

  switch (type) {
    case 'set_hostname':
      if (ok) dialog_open('dlg_hostname_title', 'dlg_hostname_text',
        [{ key: 'restart', fallback: 'Restart', handler: function () { ws_push('settings', { reset: 1 }); } }]);
      else error_dialog();
      break;
    case 'set_ap':
      if (ok) dialog_open('dlg_ap_title', 'dlg_ap_text', [{ key: 'ui_ok', fallback: 'OK' }]);
      else error_dialog();
      break;
    case 'set_hotspot_ip':
      if (ok) dialog_open('dlg_hotspot_ip_title', 'dlg_hotspot_ip_text',
        [{ key: 'restart', fallback: 'Restart', handler: function () { ws_push('settings', { reset: 1 }); } }]);
      else error_dialog();
      break;
    case 'factory_reset':
      if (ok) dialog_open('dlg_factory_title', 'dlg_factory_text', [{ key: 'ui_ok', fallback: 'OK' }]);
      else error_dialog();
      break;
    case 'set_device_name':
      if (ok) toast_show('device_name_saved', 3000);
      else toast_show('response_err', 3000);
      break;
    case 'ota_fw':
      clear_ota_progress();
      if (ok) dialog_open('dlg_ota_title', 'dlg_ota_text',
        [{ key: 'ui_reload', fallback: 'Reload', handler: function () { location.reload(); } }]);
      else dialog_open('dlg_ota_err_title', 'dlg_ota_err_text', [{ key: 'ui_ok', fallback: 'OK' }]);
      break;
    case 'ota_unknown':
      dialog_open('dlg_ota_unknown_title', 'dlg_ota_unknown_text', [{ key: 'ui_ok', fallback: 'OK' }]);
      break;
    /* printer, block, settings, anim,
       printer_speed, printer_light, printer_record: silent success ack;
       failures are consumed by optimistic settle / status.cmd (§0.6). */
    default:
      break;
  }
}

function clear_ota_progress() {
  var p = byId('ps-span-progress-ota-fw');
  if (p) p.textContent = '';
  var s = byId('ps-span-status-ota-fw');
  if (s) { var v = trLookup('ui_choose_a_bin_file'); if (v != null) s.textContent = v; }
}

/* ---------------------------------------------------------------------
   19. Boot
   ------------------------------------------------------------------- */

function wire_dialog_close() {
  var x = byId('ps-dialog-close');
  if (x) x.addEventListener('click', dialog_dismiss);
  var dlg = byId('ps-dialog');
  if (dlg) dlg.addEventListener('cancel', function (e) { e.preventDefault(); dialog_dismiss(); });
}

function init_ui() {
  if (g_ui_ready) return;
  g_ui_ready = true;

  /* language: stored preference, else English (device settings.language
     overrides once part 0 arrives). Recorded as a gap: the spec is thin on
     where the UI language is sourced pre-connect. */
  try { var stored = localStorage.getItem('pv_lang'); if (stored) g_language = stored; } catch (e) {}

  apply_direction();
  apply_translations();
  wire_navigation();
  wire_dialog_close();

  /* Open on the Status card by default; landing may move it once (§0.4). */
  show_card('status');

  /* Every choice group shows one selection even before the device answers
     (coldstart.js): the device-state buttons default to Idle until the
     first settings part lands and the lighting page takes over. */
  for (var sb = 1; sb <= 6; sb++) {
    var sbtn = byId('ps-btn' + sb);
    if (sbtn) { sbtn.classList.toggle('active', sb === 1); sbtn.setAttribute('aria-checked', sb === 1 ? 'true' : 'false'); }
  }

  /* A device that has said nothing after two seconds is probably not on
     the network yet: move to the Wi-Fi card while waiting. It is a guess,
     so it does not count as landed, and the device's own first frame still
     lands the page wherever §0.4 says. */
  setTimeout(function () {
    if (g_landed || g_firstuse || g_have_first_state) return;
    /* Not if the reader has already gone somewhere. None of the three flags
       above move when a nav item is tapped, and the nav is not inert while
       the page is waiting, so opening Lighting at 1.5 s used to be yanked to
       Wi-Fi at 2.0 s. Module 8 has a second, later fallback that already
       guards this way; this is the one that was doing the damage first. */
    var onSetup = document.querySelector('[data-page].active:not(#ps-page-app)');
    var card = document.querySelector('[data-card].active');
    if (onSetup || (card && card.id !== 'ps-card-status')) return;
    show_card('sta');
  }, 2000);

  flush_inbound_queue();
}

/* Open the socket immediately; wire the DOM when it is ready. */
ws_open();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init_ui);
} else {
  init_ui();
}

/* ---------------------------------------------------------------------
   20. Expose the globals later modules call into
   ------------------------------------------------------------------- */

window.g_sock = g_sock;
window.ws_push = ws_push;
window.tr = tr;
window.show_card = show_card;
window.show_page = show_page;
window.dialog_open = dialog_open;
window.dialog_dismiss = dialog_dismiss;
window.toast_show = toast_show;
window.apply_translations = apply_translations;
window.set_language = set_language;
