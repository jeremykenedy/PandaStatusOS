/* =====================================================================
   PandaStatusOS web UI — A13: TRY IT
   ---------------------------------------------------------------------
       GET  /api/preview   { active, state, percent, temps[3], remaining, stage }
       POST /api/preview   { state, percent, seconds, temps[3], stage }
                           seconds:0 cancels; every member optional but a
                           non-zero seconds needs a state.

   Nothing is stored on the device: the pin runs out on its own, and the
   bar goes back to whatever the printer is actually doing. That is the
   whole point, so this page never writes a setting to make a preview
   work and never has to put one back afterwards.

   The state being previewed is the one the effect editor above has
   selected, because the two are always used together: pick a state, pick
   its effect, then hold the bar at that state and look at it. The
   countdown comes from the device's own `remaining`, not from a timer
   started here, so a pin that was cancelled elsewhere is noticed.

   The Per state card higher up the page carries the short version of the
   same thing: one button per state that pins ITS state for fifteen seconds
   with no sliders to set first. Same route, same pin, same clock, so the
   button of whichever state is live is the one wearing the fill, whether
   the pin was started from a row, from the card below, or from another
   browser. Both are behind the one switch, because with it off the device
   answers the route with a redirect and there is nothing to drive.
   ================================================================= */

(function () {
  'use strict';

  /* The firmware's ps_gif_slot_names, in its order. A stage is optional here:
     with none chosen the bar shows the state's own effect rather than a stage row. */
  var SLOTS = ['standby', 'nozzle_heating', 'bed_heating', 'bed_leveling', 'homing',
               'nozzle_cleaning', 'calibrating_flow', 'xy_mesh_mode_sweep',
               'filament_check_location', 'filament_cut', 'filament_pull_back_cur',
               'filament_push_new', 'filament_purge_old', 'printing_ok', 'printing'];

  /* The per-state buttons on the Per state card above. One gesture, no sliders:
     hold the bar at THIS state for fifteen seconds and then let it go. The
     percentage rides along because the progress effects draw one and a pin with
     none leaves an empty bar, and 60 is what the Try it card offers by default.
     Fifteen seconds is the button's own promise, so it is not a setting. */
  var ROW_SECONDS = 15;
  var ROW_PERCENT = 60;

  var g_doc = null;        /* the last /api/preview answer */
  var g_timer = null;

  function feats() { return (window.fx_features && fx_features()) || {}; }

  function get(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/preview', true);
    x.timeout = 4000;
    x.onload = function () {
      if (x.status !== 200) { cb(null); return; }
      try { cb(JSON.parse(x.responseText)); } catch (e) { cb(null); }
    };
    x.onerror = function () { cb(null); };
    x.ontimeout = function () { cb(null); };
    try { x.send(); } catch (e) { cb(null); }
  }

  function post(body, after) {
    var x = new XMLHttpRequest();
    x.open('POST', '/api/preview', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 5000;
    x.onload = function () {
      if (x.status === 200) { try { g_doc = JSON.parse(x.responseText); } catch (e) {} }
      render_preview();
      if (after) after(x.status === 200);
    };
    x.onerror = function () { if (after) after(false); };
    x.ontimeout = function () { if (after) after(false); };
    try { x.send(JSON.stringify(body)); } catch (e) { if (after) after(false); }
  }

  function fill_stages() {
    var sel = byId('ps-pv-stage');
    if (!sel || sel.dataset.built === '1') return;
    var none = document.createElement('option');
    none.value = '';
    none.textContent = tr('ui_none', 'None');
    sel.appendChild(none);
    SLOTS.forEach(function (slot, i) {
      var o = document.createElement('option');
      o.value = String(i);
      o.textContent = tr('ui_stage_' + slot, slot.replace(/_/g, ' '));
      sel.appendChild(o);
    });
    sel.dataset.built = '1';
  }

  /* The three row buttons are drawn first and on their own terms: the Try it card
     below can be hidden, or missing entirely, and the rows still have to be right. */
  function render_rows() {
    var on = !!feats().preview;
    var live = !!(g_doc && g_doc.active);
    var pinned = live && isNum(g_doc.state) ? g_doc.state : -1;
    for (var i = 0; i < 3; i++) {
      var slot = byId('ps-pv-slot-' + i);
      if (slot) slot.hidden = !on;
      var btn = byId('ps-pv-state-' + i);
      if (btn) btn.classList.toggle('fill', on && i === pinned);
    }
    return on;
  }

  function render_preview() {
    var on = render_rows();
    var card = byId('ps-pv-card');
    if (!card) { if (!on) stop_tick(); return; }
    card.hidden = !on;
    if (card.hidden) { stop_tick(); return; }
    fill_stages();

    var active = !!(g_doc && g_doc.active);
    var left = (g_doc && isNum(g_doc.remaining)) ? g_doc.remaining : 0;
    var stop = byId('ps-pv-stop');
    if (stop) stop.hidden = !active;
    var note = byId('ps-pv-note');
    if (note) {
      note.textContent = active
        ? tr('ui_showing_for', 'Showing this for {n} more seconds.').replace('{n}', String(left))
        : '';
    }
    if (active) start_tick(); else stop_tick();
  }
  window.render_preview = render_preview;

  /* While a pin is running the device is asked once a second, because the countdown
     has to be the device's and not a guess: the pin can end early from elsewhere. */
  function start_tick() {
    if (g_timer) return;
    g_timer = setInterval(function () {
      var card = byId('ps-pv-card');
      if (!card || card.hidden) { stop_tick(); return; }
      get(function (d) { if (d) g_doc = d; render_preview(); });
    }, 1000);
  }
  function stop_tick() { if (g_timer) { clearInterval(g_timer); g_timer = null; } }

  function show_it() {
    var pc = byId('ps-pv-percent'), se = byId('ps-pv-seconds'), st = byId('ps-pv-stage');
    /* The state is the editor's, because the two cards are one job. Without the editor
       on the page at all, idle is the honest default. */
    var state = window.fx_state_now ? fx_state_now() : 0;
    var body = { state: state, seconds: Number((se && se.value) || 60) };
    if (pc) body.percent = Number(pc.value);
    if (st && st.value !== '') body.stage = Number(st.value);
    post(body);
  }

  /* One row, fifteen seconds, this state. Clicking the button of a state that is
     already pinned starts its fifteen seconds over, which is what a second look
     means; Stop on the Try it card, or the clock, ends it. */
  function pin_row(i) {
    post({ state: i, percent: ROW_PERCENT, seconds: ROW_SECONDS });
  }

  function wire() {
    var pc = byId('ps-pv-percent');
    if (pc) {
      var paint = function () { setText('ps-pv-percent-value', fmtPct(Number(pc.value))); };
      pc.addEventListener('input', paint);
      paint();
    }
    var se = byId('ps-pv-seconds');
    if (se) {
      var paintS = function () { setText('ps-pv-seconds-value', se.value + ' ' + tr('ui_seconds_short', 's')); };
      se.addEventListener('input', paintS);
      paintS();
    }
    for (var i = 0; i < 3; i++) {
      (function (n) {
        var b = byId('ps-pv-state-' + n);
        if (b) b.addEventListener('click', function () { pin_row(n); });
      })(i);
    }

    var go = byId('ps-pv-go');
    if (go) go.addEventListener('click', show_it);
    var stop = byId('ps-pv-stop');
    if (stop) stop.addEventListener('click', function () { post({ seconds: 0 }); });

    get(function (d) { if (d) g_doc = d; render_preview(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
