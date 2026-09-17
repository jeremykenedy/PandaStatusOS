/* =====================================================================
   PandaVentOS web UI — MODULE 3: Dashboard / Status card inbound
   + printer-control inbound
   ---------------------------------------------------------------------
   The user's side of the Status card. Module 1 (core.js) draws every
   device push for this card; this file turns the card's controls into
   the single-key messages the device accepts, paints the one optimistic
   change the spec asks for, and owns the card's client-only behaviour:

     - the vent dial and the airflow pill cycle the vent mode
       auto -> open -> closed -> auto, and the three named mode buttons
       pick one outright                       {"vent": {"mode": "..."}}
     - the endstop check asks first, then      {"calibrate": {"go": 1}}
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

   Module 1 surface used: ws_push, tr, dialog_open, toast_show,
   render_vent_modes (the optimistic vent repaint the brief allows), and
   the read-only g_state. Nothing here opens a socket or renders a push.
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

/* ---------------------------------------------------------------------
   1. Vent mode (§1.1, §2.2, P§7.9)
   ------------------------------------------------------------------- */

/* The cycle order, and the only three strings that ever leave the page:
   anything else is refused by the device because it drives a motor. */
var VENT_MODE_ORDER = ['auto', 'open', 'closed'];

/* The current mode is the device's word for it, from the merged document. */
function vent_mode_current() {
  var m = status_printer().vent_mode;
  return VENT_MODE_ORDER.indexOf(m) >= 0 ? m : 'auto';
}

function vent_mode_after(mode) {
  var i = VENT_MODE_ORDER.indexOf(mode);
  return VENT_MODE_ORDER[(i + 1) % VENT_MODE_ORDER.length];
}

/* One inbound message per action. The same repaint the push will make
   (module 1's render_vent_modes) runs first so the chosen button lights
   under the finger; the dial, the pill text and the flap readout follow
   from the push the device sends back. */
function vent_mode_choose(mode) {
  if (VENT_MODE_ORDER.indexOf(mode) < 0) return;
  if (!status_device_ready()) return;
  render_vent_modes({ vent_mode: mode });
  ws_push('vent', { mode: mode });
}

function vent_mode_cycle() {
  vent_cycle_labels_apply();
  vent_mode_choose(vent_mode_after(vent_mode_current()));
}

/* The dial's visible content is the flap word ("OPEN") and the pill's is
   the mode ("Auto mode"); neither says what a press does. The markup gives
   both a translated title, and that same string is their accessible name.
   Re-applied on every press, so a language change is picked up. */
function vent_cycle_labels_apply() {
  var dial = status_el('ps-hero-dial');
  if (dial) dial.setAttribute('aria-label', tr('ui_cycle_the_vent_auto_open_closed', 'Cycle the vent: auto, open, closed'));
  var pill = status_el('ps-af-pill');
  if (pill) pill.setAttribute('aria-label', tr('ui_cycle_the_vent_mode', 'Cycle the vent mode'));
}

/* ---------------------------------------------------------------------
   2. Endstop check (§1.6, P§7.10)
   ------------------------------------------------------------------- */

function cal_is_running() {
  var cal = status_printer().calibrate;
  return !!(cal && cal.state === 1);
}

function cal_refuse_running() {
  toast_show(tr('ui_endstop_check_already_running', 'An endstop check is already running.'), 3000);
}

/* The button moves a mechanism, so it asks first. Module 1 disables the
   button from the push while a check runs; a press that gets through
   anyway is refused here rather than queued, because the device would
   refuse it too (P§7.10) and a second confirm would only confuse. */
function cal_confirm() {
  if (!status_device_ready()) return;
  if (cal_is_running()) { cal_refuse_running(); return; }
  dialog_open(
    tr('ui_endstop_check_confirm_title', 'Run the endstop check?'),
    tr('ui_endstop_check_confirm_text',
      'The vent will close, then open, then go back to where it was, and the hall reading at each end is reported. It takes about ten seconds.'),
    [
      { key: 'cancel', fallback: 'Cancel' },
      { key: 'ui_run_the_check', fallback: 'Run the check', handler: cal_start }
    ]);
}

function cal_start() {
  if (!status_device_ready()) return;
  /* The physical button can start a check while the dialog is open. */
  if (cal_is_running()) { cal_refuse_running(); return; }
  ws_push('calibrate', { go: 1 });
  /* The immediate response{type:"calibrate"} is silent; progress, the
     button's lock and the two readings all arrive in vent_policy.calibrate
     on the next pushes, and module 1 draws them. Nothing is locked here. */
}

/* ---------------------------------------------------------------------
   3. Printer lights (§10.3, §12, P§7.11)
   ------------------------------------------------------------------- */

/* switch id -> the light's wire name, and the status field the printer
   reports it back on */
var LIGHT_SWITCHES = {
  ps-pctl-chamber-light: { light: 'chamber_light', field: 'printer_light' },
  ps-pctl-work-light:    { light: 'work_light',    field: 'work_light' }
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
  status_wire('ps-hero-dial', 'click', vent_mode_cycle);
  status_wire('ps-af-pill', 'click', vent_mode_cycle);
  VENT_MODE_ORDER.forEach(function (mode) {
    status_wire('ps-vent-' + mode, 'click', function () { vent_mode_choose(mode); });
  });
  status_wire('ps-btn-cal', 'click', cal_confirm);
  for (var id in LIGHT_SWITCHES) {
    if (Object.prototype.hasOwnProperty.call(LIGHT_SWITCHES, id)) status_wire(id, 'change', light_switch_changed);
  }
  vent_cycle_labels_apply();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init_status_card);
} else {
  init_status_card();
}
