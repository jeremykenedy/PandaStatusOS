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
      /* it never did: the switch goes back to what the printer says. Focus is not
         considered, here or in module 1's repaint: the switch was just clicked, so it HAS
         focus and keeps it, and a rule that spared a focused switch would leave a refused
         command drawn as though it had been taken for as long as the page stayed open. */
      if (reported !== null) el.checked = (reported === 1);
      delete g_light_settles[id];
      continue;
    }
    /* a push still carrying the old value repainted it: hold */
    if (el.checked !== (s.want === 1)) el.checked = (s.want === 1);
    active = true;
  }
  if (!active && g_light_settle_timer) { clearInterval(g_light_settle_timer); g_light_settle_timer = null; }
}

/* ---------------------------------------------------------------------
   3b. The fans and the print speed
   ---------------------------------------------------------------------

   The same route as the lights and the same silence afterwards: the device stores nothing
   and pushes nothing for printer_ctl, and what the fan actually ends up doing arrives in
   the printer's next report. The difference is what the printer will accept. `ledctrl` is
   not signature-checked and these are: they ride in the `print` envelope, which the printer
   refuses unless Developer Mode is on under LAN Only Mode. Both are sent regardless. A
   printer with it on takes them, one without it answers `mqtt message verify failed`, and
   the card already carries the line that says so.

   A slider is not a switch, so the hold is simpler: while a drag is in progress, or for a
   moment after one ends, the reported value does not repaint the control. `input` paints
   the number beside it and sends nothing; `change`, which fires when the drag ends, is what
   goes to the printer. Dragging a slider does not spray thirty commands at a printer.
   ------------------------------------------------------------------- */

/* slider id -> the fan's wire name, and the status field it is reported back on */
var FAN_SLIDERS = {
  'ps-pctl-fan-part':    { fan: 'part',    field: 'fan_part' },
  'ps-pctl-fan-aux':     { fan: 'aux',     field: 'fan_aux' },
  'ps-pctl-fan-chamber': { fan: 'chamber', field: 'fan_chamber' }
};

var FAN_SETTLE_MS = 5000;
var g_fan_settles = {};            /* slider id -> until ms */

/* True while this control's own value is not to be written over.
   
   For a slider this hold is the whole of the rule, and it replaces the focus rule the rest
   of the page keeps. A text field is protected by focus because focus is what "someone is
   typing here" looks like; a slider keeps focus after the finger comes off and never gives
   it back on its own, so a focus rule would freeze that row at the last value dragged and
   the printer's own reading would never appear in it again. The window is refreshed on every
   movement, so it covers the drag itself and five seconds after the last one, and then the
   printer wins whatever it says. */
function pctl_held(id) {
  var until = g_fan_settles[id];
  return !!(until && Date.now() < until);
}
window.pctl_held = pctl_held;

function fan_hold(id) { g_fan_settles[id] = Date.now() + FAN_SETTLE_MS; }

function fan_paint_value(id) {
  var el = status_el(id);
  if (el) setText(id + '-value', fmtPct(Number(el.value)));
}

/* Every movement: hold the row and paint the number beside it. Nothing is sent. */
function fan_slider_input(ev) {
  if (!FAN_SLIDERS[ev.target.id]) return;
  fan_hold(ev.target.id);
  fan_paint_value(ev.target.id);
}

function fan_slider_changed(ev) {
  var el = ev.target;
  var f = FAN_SLIDERS[el.id];
  if (!f) return;
  if (!status_device_ready()) return;
  ws_push('printer_ctl', { fan: f.fan, percent: Number(el.value) });
  fan_hold(el.id);
  fan_paint_value(el.id);
}

function speed_clicked(ev) {
  var btn = ev.target.closest ? ev.target.closest('button[data-level]') : null;
  if (!btn || !status_device_ready()) return;
  var level = Number(btn.getAttribute('data-level'));
  if (!(level >= 1 && level <= 4)) return;
  ws_push('printer_ctl', { speed: level });
  /* The printer reports the level it is actually running at, in its own time, and module 1
     paints the row from that. Marking the button now would be this page's opinion. */
}

/* ---------------------------------------------------------------------
   4. Wiring: one init, every listener added here, no inline handlers
   ------------------------------------------------------------------- */

function init_status_card() {
  for (var id in LIGHT_SWITCHES) {
    if (Object.prototype.hasOwnProperty.call(LIGHT_SWITCHES, id)) status_wire(id, 'change', light_switch_changed);
  }
  for (var fid in FAN_SLIDERS) {
    if (!Object.prototype.hasOwnProperty.call(FAN_SLIDERS, fid)) continue;
    status_wire(fid, 'input', fan_slider_input);
    status_wire(fid, 'change', fan_slider_changed);
  }
  var sp = byId('ps-pctl-speed');
  if (sp) sp.addEventListener('click', speed_clicked);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init_status_card);
} else {
  init_status_card();
}
