/* =====================================================================
   PandaStatusOS web UI — MODULE 3: Dashboard / Status card inbound
   + printer-control inbound
   ---------------------------------------------------------------------
   The user's side of the Status card. Module 1 (core.js) draws every
   device push for this card; this file turns the card's controls into
   the single-key messages the device accepts, paints the one optimistic
   change the spec asks for, and owns the card's client-only behaviour:

     - the two printer lights flip at once, then
       {"printer_ctl": {"light": "...", "on": 0|1}}, held for a bounded
       settle until the printer reports the same, or the page gives up;
       a switch that has focus is never written (§10.1, §12)

   Written from private/SPEC/handler-contract.md §1.1, §1.6, §2.2,
   §10.1–§10.3 and §12, and private/SPEC/websocket-protocol.md §1.1,
   §7.9, §7.10, §7.11 and §9. The DOM is pages/dashboard.html and
   global.html; the mechanisms are project.css, app.css, beer.trim.css.

   Attestation: written from private/SPEC and Jeremy's markup/CSS/
   harnesses; no vendor source opened.

   Module 1 surface used: ws_push, tr, toast_show and the read-only
   g_state. Nothing here opens a socket or renders a push.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. Small local helpers (own names; module 1's helpers are not ours)
   ------------------------------------------------------------------- */

function status_el(id) { return document.getElementById(id); }

/* Until the first state document lands the page is not real: module 1
   keeps `is-waiting` on <body> and ws_push drops frames while it is
   there. Nothing here may paint an optimistic change whose send would be
   dropped, so every action checks this first. */
function status_device_ready() {
  return !(document.body && document.body.classList.contains('is-waiting'));
}

/* The merged document's printer root, or an empty object before it lands. */
function status_printer() {
  return (typeof g_state === 'object' && g_state && g_state.printer) ? g_state.printer : {};
}

function status_wire(id, event, fn) {
  var el = status_el(id);
  if (el) el.addEventListener(event, fn);
  return el;
}

/* Sections 1 and 2 stood here and are gone.

   Section 1 was the vent dial and the airflow pill, cycling a flap through auto, open and
   closed. Section 2 was the endstop check, which drove that flap onto both stops and read a
   hall sensor. This device has no flap, no hall sensor and no vent root to send either to;
   both cards came off the dashboard with them. What is left below is the one part of this
   file that was ever about this device: its two printer lights. */

/* ---------------------------------------------------------------------
   3. Printer lights (§10.3, §12, P§7.11)
   ------------------------------------------------------------------- */

/* switch id -> the light's wire name, and the status field the printer
   reports it back on */
var LIGHT_SWITCHES = {
  'ps-pctl-chamber-light': { light: 'chamber_light', field: 'printer_light' },
  'ps-pctl-work-light':    { light: 'work_light',    field: 'work_light' }
};

/* The settle window. The device does not push state for printer_ctl (P§9):
   the printer answers in its own time through the telemetry, and pushes
   carrying unrelated telemetry can land meanwhile with the light's OLD
   value. A flipped switch is held against those until the printer reports
   what was asked, or until this window runs out, when the page follows the
   device rather than the finger. */
var LIGHT_SETTLE_MS = 5000;
var LIGHT_SETTLE_TICK_MS = 50;

var g_light_settles = {};          /* switch id -> { want: 0|1, until: ms } */
var g_light_settle_timer = null;

/* 0 or 1 as the printer reports it, or null when it never mentioned the light. */
function light_reported(field) {
  var st = status_printer().status || {};
  var v = st[field];
  return (v === 0 || v === 1) ? v : null;
}

/* Beer's switch is a real checkbox under a painted span, so the browser
   has already flipped it by the time `change` fires: that IS the
   optimistic paint. Send, then hold it until the printer agrees. */
function light_switch_changed(ev) {
  var el = ev.target;
  var sw = LIGHT_SWITCHES[el.id];
  if (!sw) return;
  var want = el.checked ? 1 : 0;
  if (!status_device_ready()) { el.checked = (want === 0); return; }   /* inert before the first document */
  ws_push('printer_ctl', { light: sw.light, on: want });
  light_settle_begin(el.id, want);
}

function light_settle_begin(id, want) {
  g_light_settles[id] = { want: want, until: Date.now() + LIGHT_SETTLE_MS };
  if (!g_light_settle_timer) g_light_settle_timer = setInterval(light_settle_tick, LIGHT_SETTLE_TICK_MS);
}

/* Runs only while a settle is open, and stops itself when none is. */
function light_settle_tick() {
  var now = Date.now();
  var active = false;
  for (var id in g_light_settles) {
    if (!Object.prototype.hasOwnProperty.call(g_light_settles, id)) continue;
    var s = g_light_settles[id];
    var el = status_el(id);
    var sw = LIGHT_SWITCHES[id];
    var reported = (el && sw) ? light_reported(sw.field) : null;
    if (!el || !sw || reported === s.want) {
      /* the printer agreed (or there is nothing to settle): done */
      delete g_light_settles[id];
      continue;
    }
    if (now >= s.until) {
      /* it never did: the switch goes back to what the printer says,
         unless it still has focus. A focused input is never written
         (§10.1, §12), so the settle ends and module 1's next push, which
         guards focus the same way, repaints the switch once the focus
         has moved on. */
      if (reported !== null && document.activeElement !== el) el.checked = (reported === 1);
      delete g_light_settles[id];
      continue;
    }
    /* a push still carrying the old value repainted it: hold. Module 1
       never repaints a focused switch, so a focused one needs no hold,
       and the same focus rule applies here. */
    if (el.checked !== (s.want === 1) && document.activeElement !== el) el.checked = (s.want === 1);
    active = true;
  }
  if (!active && g_light_settle_timer) { clearInterval(g_light_settle_timer); g_light_settle_timer = null; }
}

/* ---------------------------------------------------------------------
   4. Wiring: one init, every listener added here, no inline handlers
   ------------------------------------------------------------------- */

function init_status_card() {
  for (var id in LIGHT_SWITCHES) {
    if (Object.prototype.hasOwnProperty.call(LIGHT_SWITCHES, id)) status_wire(id, 'change', light_switch_changed);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init_status_card);
} else {
  init_status_card();
}
