/* =====================================================================
   PandaVentOS web UI - MODULE 10: Logs card inbound + uploaded animation
   ---------------------------------------------------------------------
   Written from private/SPEC/handler-contract.md sections 0.1, 0.4, 0.6,
   11.1, 11.2 and 12, private/SPEC/websocket-protocol.md sections 1, 2.8
   (leds), 2.8a (status.anim), 4 and 7.14, firmware/PROTOCOL.md
   (transport), Jeremy's markup (pages/logs.html, pages/lighting.html,
   frame.html), stylesheets (app.css, project.css, beer.trim.css) and the
   logs.js / anim.js harnesses as run against mockdev.js.

   Attestation: written from private/SPEC and Jeremy's markup/CSS/harnesses;
   no vendor source opened.

   Scope. The INBOUND side of the Logs card (ask for the log, clear it) and
   the client-only side of the uploaded animation (decode a picked image on
   the canvas, preview it, POST /anim, discard, clear). Module 1 renders
   the log document and the animation rows from the device's own pushes;
   nothing here paints a device value.

   Uses from module 1: ws_push, toast_show, g_state (read only).
   ===================================================================== */

/* ---------------------------------------------------------------------
   1. Logs card (11.1, P4, P7.14)
   ------------------------------------------------------------------- */

var g_logs_card_shown = false;

function logs_request() {
  ws_push('logs', {});
}

function logs_clear_request() {
  ws_push('logs', { clear: 1 });
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
    if (shown && !g_logs_card_shown) logs_request();
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
  if (card && card.classList.contains('active')) logs_request();
}

function logs_on_nav_key(e) {
  if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
  logs_on_nav_click(e);
}

function logs_init() {
  var refresh = document.getElementById('ps-btn-logs-refresh');
  var clear = document.getElementById('ps-btn-logs-clear');
  if (refresh) refresh.addEventListener('click', logs_request);
  if (clear) clear.addEventListener('click', logs_clear_request);
  document.addEventListener('click', logs_on_nav_click, true);
  document.addEventListener('keydown', logs_on_nav_key, true);
  logs_watch_card();
}

/* ---------------------------------------------------------------------
   2. Uploaded animation (11.2, P2.8 leds, P2.8a status.anim)

   The picked image never leaves the browser as a file. It is drawn onto
   ps-anim-canvas at strip-length x frames and the RGB bytes are read
   back off that same canvas, so the preview on screen and the bytes on
   the wire are one thing. POST /anim body: u16 frames, u16 pixels, both
   little-endian, then frames*pixels*3 bytes of RGB. An empty body clears.
   ------------------------------------------------------------------- */

var ANIM_MIN_PIXELS = 16;    /* a strip is never treated as shorter than this */
var ANIM_BYTE_CAP = 16384;   /* P2.8a max_bytes; used only before the device has said */
var ANIM_U16_MAX = 65535;    /* the two counts travel as u16 */

/* The pending pick: null, or { frames, pixels, rgb: Uint8Array }. */
var g_anim = null;
var g_anim_busy = false;

/* The words this module can show, keyed as the translation table keys them. */
var ANIM_TEXT = {
  ui_anim_bad_image: 'That file could not be read as an image.',
  ui_anim_send_failed: 'The animation could not be sent to the vent.',
  ui_anim_clear_failed: 'The strip could not be cleared.'
};

function anim_el(id) { return document.getElementById(id); }

function anim_num(v) { return typeof v === 'number' && isFinite(v); }

function anim_toast(key, ms) { toast_show(key, ms, ANIM_TEXT[key]); }

function anim_device() {
  var vp = (typeof g_state === 'object' && g_state && g_state.printer) || {};
  return { leds: vp.leds, anim: (vp.status && vp.status.anim) || {} };
}

/* Pixels per frame: what the device says a frame is (status.anim.max_pixels,
   the pixels-per-frame cap it checks an upload against, P2.8a). Before it
   has said, the longer of the strips it reports (vent_policy.leds), and
   never under 16. */
function anim_strip_pixels() {
  var d = anim_device();
  var cap = d.anim.max_pixels;
  if (anim_num(cap) && cap >= 1) return Math.min(ANIM_U16_MAX, Math.floor(cap));
  var longest = 0;
  if (Array.isArray(d.leds)) {
    for (var i = 0; i < d.leds.length; i++) {
      if (anim_num(d.leds[i]) && d.leds[i] > longest) longest = d.leds[i];
    }
  }
  return longest >= 1 ? Math.min(ANIM_U16_MAX, Math.floor(longest)) : ANIM_MIN_PIXELS;
}

/* Frame cap: what the device says it has room for; failing that, what the
   byte cap allows at this width. */
function anim_max_frames(pixels) {
  var a = anim_device().anim;
  if (anim_num(a.max_frames) && a.max_frames >= 1) return Math.min(ANIM_U16_MAX, Math.floor(a.max_frames));
  var cap = (anim_num(a.max_bytes) && a.max_bytes >= 3) ? a.max_bytes : ANIM_BYTE_CAP;
  return Math.min(ANIM_U16_MAX, Math.max(1, Math.floor(cap / (pixels * 3))));
}

/* Preview wrap and Discard exist only while there is a pick to show. */
function anim_set(pick) {
  g_anim = pick;
  window.g_anim = pick;
  var wrap = anim_el('ps-anim-preview-wrap');
  var discard = anim_el('ps-btn-anim-discard');
  if (wrap) wrap.hidden = !pick;
  if (discard) discard.hidden = !pick;
}

/* Send, Discard and Clear the strip are all held while a POST is in flight. */
function anim_busy(on) {
  g_anim_busy = on;
  var ids = ['ps-btn-anim-send', 'ps-btn-anim-discard', 'ps-btn-anim-clear'];
  for (var i = 0; i < ids.length; i++) {
    var b = anim_el(ids[i]);
    if (b) b.disabled = on;
  }
}

/* Draw the decoded image at strip-width x frames and lift the bytes back
   off the canvas. Nearest-neighbour: these are pixels, and the preview
   must be the upload. Transparent pixels land on black, which is a lit
   strip's "off". */
function anim_rasterise(img) {
  var canvas = anim_el('ps-anim-canvas');
  if (!canvas || typeof canvas.getContext !== 'function') return null;
  var pixels = anim_strip_pixels();
  var frames = Math.max(1, Math.floor(img.naturalHeight || img.height || 1));
  var cap = anim_max_frames(pixels);
  if (frames > cap) frames = cap;
  canvas.width = pixels;
  canvas.height = frames;
  var ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, pixels, frames);
  ctx.drawImage(img, 0, 0, pixels, frames);
  var data = ctx.getImageData(0, 0, pixels, frames).data;
  var rgb = new Uint8Array(frames * pixels * 3);
  for (var i = 0, o = 0; o < rgb.length; i += 4, o += 3) {
    rgb[o] = data[i];
    rgb[o + 1] = data[i + 1];
    rgb[o + 2] = data[i + 2];
  }
  return { frames: frames, pixels: pixels, rgb: rgb };
}

function anim_on_file_change() {
  var input = anim_el('ps-anim-file');
  var file = input && input.files && input.files[0];
  if (!file) return;
  var url = null;
  var img = new Image();
  var release = function () {
    if (url) { try { URL.revokeObjectURL(url); } catch (e) {} }
    /* Forget the pick on the input so the same file can be chosen again
       after a Discard; the change event only fires on a different value. */
    try { input.value = ''; } catch (e) {}
  };
  img.onload = function () {
    var pick = anim_rasterise(img);
    release();
    if (!pick) { anim_toast('ui_anim_bad_image', 3000); return; }
    anim_set(pick);
  };
  img.onerror = function () {
    release();
    anim_toast('ui_anim_bad_image', 3000);
  };
  try {
    url = URL.createObjectURL(file);
    img.src = url;
  } catch (e) {
    release();
    anim_toast('ui_anim_bad_image', 3000);
  }
}

/* The wire body for a pick: the two little-endian counts, then the RGB. */
function anim_body(pick) {
  var n = pick.frames * pick.pixels * 3;
  var body = new Uint8Array(4 + n);
  body[0] = pick.frames & 0xff;
  body[1] = (pick.frames >> 8) & 0xff;
  body[2] = pick.pixels & 0xff;
  body[3] = (pick.pixels >> 8) & 0xff;
  body.set(pick.rgb.subarray(0, n), 4);
  return body;
}

/* One POST /anim. Settles exactly once with whether the HTTP exchange
   succeeded. Whether the device ACCEPTED it comes back on the socket as
   response{type:"anim"} and the next status.anim push, both module 1's. */
function anim_post(body, onSettled) {
  var settled = false;
  var finish = function (ok) {
    if (settled) return;
    settled = true;
    onSettled(ok);
  };
  var xhr = new XMLHttpRequest();
  xhr.open('POST', '/anim', true);
  xhr.setRequestHeader('Content-Type', 'application/octet-stream');
  xhr.onload = function () { finish(xhr.status >= 200 && xhr.status < 300); };
  xhr.onerror = function () { finish(false); };
  xhr.onabort = function () { finish(false); };
  xhr.ontimeout = function () { finish(false); };
  try { xhr.send(body); } catch (e) { finish(false); }
}

/* Send: with nothing picked it opens the chooser (the markup carries no
   other control that does); with a pick it uploads. */
function anim_on_send() {
  if (g_anim_busy) return;
  if (!g_anim) {
    var input = anim_el('ps-anim-file');
    if (input) input.click();
    return;
  }
  var pick = g_anim;
  anim_busy(true);
  anim_post(anim_body(pick), function (ok) {
    anim_busy(false);
    if (ok) anim_set(null);     /* the push repaints the rows; the preview is put away */
    else anim_toast('ui_anim_send_failed', 4000);
  });
}

function anim_on_discard() {
  if (g_anim_busy) return;
  anim_set(null);
}

function anim_on_clear() {
  if (g_anim_busy) return;
  anim_busy(true);
  anim_post(new Uint8Array(0), function (ok) {
    anim_busy(false);
    if (!ok) anim_toast('ui_anim_clear_failed', 4000);
  });
}

function anim_init() {
  var file = anim_el('ps-anim-file');
  var send = anim_el('ps-btn-anim-send');
  var discard = anim_el('ps-btn-anim-discard');
  var clear = anim_el('ps-btn-anim-clear');
  if (file) file.addEventListener('change', anim_on_file_change);
  if (send) send.addEventListener('click', anim_on_send);
  if (discard) discard.addEventListener('click', anim_on_discard);
  if (clear) clear.addEventListener('click', anim_on_clear);
  anim_set(null);   /* nothing picked yet: preview and Discard put away */
}

/* ---------------------------------------------------------------------
   3. Boot, exactly like module 1's
   ------------------------------------------------------------------- */

function module10_init() {
  logs_init();
  anim_init();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', module10_init);
} else {
  module10_init();
}

window.g_anim = g_anim;
