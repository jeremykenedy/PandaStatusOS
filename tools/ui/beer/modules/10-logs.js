/* =====================================================================
   PandaStatusOS web UI - MODULE 10: Logs card inbound
   ---------------------------------------------------------------------
   Written from private/SPEC/handler-contract.md sections 0.1, 0.4, 0.6,
   11.1, 11.2 and 12, private/SPEC/websocket-protocol.md sections 1, 2.8
   4 and 7.14, firmware/PROTOCOL.md
   (transport), Jeremy's markup (pages/logs.html, pages/lighting.html,
   frame.html), stylesheets (app.css, project.css, beer.trim.css) and the
   the logs harness as run against mockdev.js.

   Attestation: written from private/SPEC and Jeremy's markup/CSS/harnesses;
   no vendor source opened.

   Scope. The INBOUND side of the Logs card (ask for the log, clear it) and
   Module 1 renders the log document from the device's own answer;
   nothing here paints a device value.

   Uses from module 1: ws_push, toast_show, g_state (read only).
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Logs card (11.1, P4, P7.14)
   ------------------------------------------------------------------- */

var g_logs_card_shown = false;

/* The vent asked for its log over the socket, with a root of its own. This device's
   document is pinned to the factory's six roots, so the log is a route instead
   (ps_api.c ps_api_logs_get) and asking over the socket would only earn an
   "unknown root" in the very log being asked for. */
/* The IDF colours its own log lines, and the escape it does it with is invisible in a
   browser while the rest of the sequence is not: every line arrived reading
   "[0;32mI (4524713) ps_ws: ... [0m" with the marker showing and the colour nowhere.
   A terminal is not what this is, so the sequences come out and the line reads as it was
   written. Nothing else is touched: the text is the device's. */
function strip_ansi(s) {
  /* eslint-disable no-control-regex */
  return s.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}

function logs_fill(text) {
  var view = document.getElementById('ps-log-view');
  if (!view) return;
  var t = (typeof text === 'string') ? strip_ansi(text).replace(/\s+$/, '') : '';
  view.textContent = t || tr('ui_no_logs', 'Nothing logged yet.');
  /* Newest at the bottom, so the interesting end is the end you land on. */
  view.scrollTop = view.scrollHeight;
}

function logs_request() {
  var x = new XMLHttpRequest();
  x.open('GET', '/api/logs', true);
  x.timeout = 5000;
  x.onload = function () { if (x.status === 200) logs_fill(x.responseText); };
  x.onerror = function () {};
  x.ontimeout = function () {};
  try { x.send(); } catch (e) {}
}

function logs_clear_request() {
  var x = new XMLHttpRequest();
  x.open('DELETE', '/api/logs', true);
  x.timeout = 5000;
  /* Re-read rather than blanking the view: what the device kept is the truth, and a
     line written between the click and the clear should still be there. */
  x.onload = function () { logs_request(); };
  x.onerror = function () {};
  x.ontimeout = function () {};
  try { x.send(); } catch (e) {}
}

/* A card is open exactly when it wears .active (app.css). Watching that
   class on the Logs card catches every way of opening it: the rail, the
   bottom bar, the keyboard, and a bare show_card('logs'). It runs
   after module 1's navigation has finished, because it IS that navigation
   landing. Only the closed-to-open edge asks. */
function logs_watch_card() {
  var card = document.getElementById('ps-card-logs');
  if (!card || typeof MutationObserver !== 'function') return;
  g_logs_card_shown = card.classList.contains('active');
  var watcher = new MutationObserver(function () {
    var shown = card.classList.contains('active');
    if (shown && !g_logs_card_shown) { logs_request(); render_poll_start(); }
    if (!shown && g_logs_card_shown) render_poll_stop();
    g_logs_card_shown = shown;
  });
  watcher.observe(card, { attributes: true, attributeFilter: ['class'] });
}

/* The Logs entries in both navs (ps-btn-logs in the rail, the bottom bar's
   [data-nav="logs"]). Activating one while the card is ALREADY open moves
   no class, so the observer stays quiet; 11.1 still maps ps-btn-logs to
   {"logs":{}}, so that case is asked for here. Capture phase, so the card's
   state is read before module 1's delegated handler (and the bottom bar's
   own inline onclick) has navigated: one activation, one request, never
   two. Enter and Space are the keys module 1 treats as activation. */
function logs_nav_hit(e) {
  var t = e.target;
  if (!t || typeof t.closest !== 'function') return false;
  return !!t.closest('[data-nav="logs"]');
}

function logs_on_nav_click(e) {
  if (!logs_nav_hit(e)) return;
  var card = document.getElementById('ps-card-logs');
  if (card && card.classList.contains('active')) { logs_request(); render_stats_request(); }
}

function logs_on_nav_key(e) {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  logs_on_nav_click(e);
}

function logs_init() {
  var refresh = document.getElementById('ps-btn-logs-refresh');
  var clear = document.getElementById('ps-btn-logs-clear');
  /* Refresh means the page, not only the log: the renderer's numbers are the other half of
     why anyone is on this page. */
  if (refresh) refresh.addEventListener('click', function () { logs_request(); render_stats_request(); });
  if (clear) clear.addEventListener('click', logs_clear_request);
  document.addEventListener('click', logs_on_nav_click, true);
  document.addEventListener('keydown', logs_on_nav_key, true);
  logs_watch_card();
  /* A tab coming back to the front asks once, rather than waiting out the interval. */
  if (typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && g_logs_card_shown) render_stats_request();
    });
  }
  /* Landing straight on this page (a reload while it is open) moves no class, so the
     observer stays quiet and the poll has to be started here. */
  if (g_logs_card_shown) render_poll_start();
}

/* ---------------------------------------------------------------------
   2. C8: what the renderer is doing (GET /api/render)
   ---------------------------------------------------------------------

   The card decides nothing. It asks the route, and the route goes with the diagnostics
   switch: a device with the switch off answers the 302 every absent route answers, an
   older firmware has no route at all, and a factory device redirects to its own page. All
   three arrive here as "not JSON I understand", and all three mean the same thing, which
   is that this card has nothing to say and should not be on the page.

   Polled only while the card is open and the tab is visible. Thirty frames a second is
   not something to watch through a two second poll; what these numbers answer is "is it
   drawing at all, and is the driver taking it", and that does not need to be live. The
   device measures the rate over the window between reads, so a page that polled it in the
   background would be narrowing that window for nothing.
   ------------------------------------------------------------------- */

var RENDER_POLL_MS = 2000;
var g_render_timer = null;

function render_kind_text(d) {
  if (d.kind === 'fx') {
    return (typeof effect_name === 'function') ? effect_name(d.effect, 'h2d') : String(d.effect);
  }
  if (d.kind === 'solid') return tr('ui_solid_colour', 'Solid colour');
  if (d.kind === 'diag') return tr('ui_diagnostic', 'Diagnostic');
  return DASH;                                  /* "none": nothing drawn yet */
}

function render_stats_fill(d) {
  var card = document.getElementById('ps-card-render');
  /* A number the device did not send is a dash, never a zero: "no frames yet" and "it has
     drawn nothing since boot" are different answers and one of them is alarming. */
  if (!d || typeof d.kind !== 'string') { if (card) card.hidden = true; return; }
  if (card) card.hidden = false;
  setText('ps-rd-kind', render_kind_text(d));
  setText('ps-rd-fps', isNum(d.fps) && d.fps >= 0 ? String(d.fps) : DASH);
  setText('ps-rd-interval', isNum(d.interval_ms) ? d.interval_ms + ' ms' : DASH);
  setText('ps-rd-frames', isNum(d.frames) ? String(d.frames) : DASH);
  setText('ps-rd-failed', isNum(d.push_failed) ? String(d.push_failed) : DASH);
}

function render_stats_request() {
  var x = new XMLHttpRequest();
  x.open('GET', '/api/render', true);
  x.timeout = 4000;
  x.onload = function () {
    var d = null;
    /* A 302 is followed by the browser, so the switch being off arrives here as the page's
       own HTML with a 200. Parsing is the test, not the status. */
    if (x.status === 200) { try { d = JSON.parse(x.responseText); } catch (e) { d = null; } }
    render_stats_fill(d);
  };
  /* A device that does not answer is not an error to draw: the socket already says whether
     it is there, and two places saying it disagree. */
  x.onerror = function () {};
  x.ontimeout = function () {};
  try { x.send(); } catch (e) {}
}

function render_poll_stop() {
  if (g_render_timer) { clearInterval(g_render_timer); g_render_timer = null; }
}

function render_poll_start() {
  render_poll_stop();
  render_stats_request();
  g_render_timer = setInterval(function () {
    if (typeof document.hidden === 'boolean' && document.hidden) return;
    render_stats_request();
  }, RENDER_POLL_MS);
}

/* Section 3 stood here and is gone.

   It let a picked image be decoded in the browser and POSTed to /anim as raw RGB, a frame
   per row, and it drew its progress into #ps-anim-canvas and its state into #ps-kv-anim.
   Neither of those elements is on any page of this device, the /anim route is not one this
   firmware answers, and the three strings it reached for existed in no language file, so
   every one of them would have shown English to the other twenty-three readers if the card
   had ever appeared. A whole section of dead code kept alive by nothing.

   The stage images card on the Lighting page is what this device does instead, and it goes
   through /ota with the slot in a header, which is a route the firmware really has. */

function module10_init() {
  logs_init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', module10_init);
} else {
  module10_init();
}

