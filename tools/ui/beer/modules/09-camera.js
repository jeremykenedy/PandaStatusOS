/* =====================================================================
   PandaStatusOS web UI — MODULE 9: Camera card, inbound side
   ---------------------------------------------------------------------
   The camera card's one control and its one client-only widget:

     ps-cam-record   the recording switch  ->  {"printer_ctl":{"record":0|1}}
     ps-cam-copy     copies the RTSP address shown in ps-cam-rtsp

   Module 1 (core.js, handle_camera) renders every device push for this
   card: the readout rows, the "no camera" state, the RTSP note and
   address, and the switch's confirmed position. Nothing here redraws a
   push. This file turns a user action into a message and keeps the
   switch where the user put it until the printer has answered.

   Written from private/SPEC/handler-contract.md §9.2 (with §9.1 for what
   module 1 paints, §0.6 for the printer_record ack, §12 for optimistic
   settle) and private/SPEC/websocket-protocol.md §7.11 (printer_ctl,
   record sub-command) and §9 (reply behaviour).

   Attestation: written from private/SPEC and Jeremy's markup/CSS/harnesses;
   no vendor source opened.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. Helpers
   ------------------------------------------------------------------- */

function cam_node(id) { return document.getElementById(id); }

/* The merged state document's status block, read-only (module 1 owns it). */
function cam_status() {
  var doc = window.g_state;
  var vp = (doc && doc.vent_policy) || {};
  return vp.status || {};
}

function cam_frame(fn) {
  if (window.requestAnimationFrame) return window.requestAnimationFrame(fn);
  return setTimeout(fn, 50);
}

/* ---------------------------------------------------------------------
   1. The recording switch (§9.2, P§7.11)
   ------------------------------------------------------------------- */

/* How long the switch is held where the user put it while the printer
   answers. The device acks printer_ctl.record at once but pushes no
   state for it (P§9); the real value arrives later, from the printer, in
   the telemetry, and any state push in between still carries the old
   value. Module 1 repaints the switch from every push (guarding only a
   focused input), so without a hold a stale push would flip it back
   under the finger and the printer's report would flip it forward again.
   The hold ends the moment the device reports the requested value, or at
   this deadline, after which the next push is trusted as it comes. */
var CAM_RECORD_HOLD_MS = 4000;

/* {want: 0|1, until: ms} while a record write is in flight, else null. */
var g_cam_hold = null;
var g_cam_hold_ticking = false;

function cam_on_record_change() {
  var input = cam_node('ps-cam-record');
  if (!input) return;
  /* Inert before the first state document, like every other control:
     ws_push would drop the frame, and module 1's first push sets the
     switch from the device. No hold either, or it would fight that push. */
  if (document.body && document.body.classList.contains('is-waiting')) return;
  var want = input.checked ? 1 : 0;           /* the switch is already flipped: that is the optimistic paint */
  g_cam_hold = { want: want, until: Date.now() + CAM_RECORD_HOLD_MS };
  ws_push('printer_ctl', { record: want });
  cam_hold_start();
}

function cam_hold_start() {
  if (g_cam_hold_ticking) return;
  g_cam_hold_ticking = true;
  cam_frame(cam_hold_tick);
}

/* Once per frame, before paint, so a repaint that flipped the switch back
   is undone before it is ever seen. A focused input is never repainted by
   module 1, so in that case there is nothing to undo. */
function cam_hold_tick() {
  var hold = g_cam_hold;
  if (!hold) { g_cam_hold_ticking = false; return; }
  var reported = cam_status().cam_record;      /* int 0/1, or null when unknown (P§2.8a) */
  if (reported === hold.want || Date.now() >= hold.until) {
    g_cam_hold = null;
    g_cam_hold_ticking = false;
    return;
  }
  var input = cam_node('ps-cam-record');
  if (input && input.checked !== !!hold.want) input.checked = !!hold.want;
  cam_frame(cam_hold_tick);
}

/* ---------------------------------------------------------------------
   2. Copy the stream address (§9.2, client-only)
   ------------------------------------------------------------------- */

function cam_on_copy_click() {
  var code = cam_node('ps-cam-rtsp');
  var text = code ? (code.textContent || '').trim() : '';
  if (!text) return;   /* module 1 hides the row without a usable address (§9.1) */
  var clip = navigator.clipboard;
  if (clip && typeof clip.writeText === 'function') {
    /* Only present on a secure origin. The vent serves plain HTTP, so this
       is normally absent; where it exists, try it and fall back on refusal. */
    clip.writeText(text).then(
      function () { cam_copy_done(true); },
      function () { cam_copy_done(cam_copy_by_selection(code)); });
    return;
  }
  cam_copy_done(cam_copy_by_selection(code));
}

/* The legacy path: select the address and ask the browser to copy the
   selection. It needs a user gesture, which the click is. */
function cam_copy_by_selection(code) {
  var ok = false;
  var sel = window.getSelection ? window.getSelection() : null;
  if (!sel || !document.createRange) return false;
  try {
    var range = document.createRange();
    range.selectNodeContents(code);
    sel.removeAllRanges();
    sel.addRange(range);
    ok = document.execCommand('copy') === true;
  } catch (e) { ok = false; }
  try { sel.removeAllRanges(); } catch (e2) {}
  return ok;
}

function cam_copy_done(ok) {
  /* toast_show takes a translation key and has no fallback parameter, so
     the key is resolved here with its English fallback; a string that is
     not itself a key passes through toast_show's lookup unchanged. */
  toast_show(ok ? tr('ui_address_copied', 'Address copied')
                : tr('ui_address_copy_failed', 'Could not copy. Select the address and copy it by hand.'),
    3000);
}

/* ---------------------------------------------------------------------
   3. Boot
   ------------------------------------------------------------------- */

function cam_init() {
  var sw = cam_node('ps-cam-record');
  if (sw) sw.addEventListener('change', cam_on_record_change);
  var copy = cam_node('ps-cam-copy');
  if (copy) copy.addEventListener('click', cam_on_copy_click);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', cam_init);
} else {
  cam_init();
}
