/* =====================================================================
   PandaStatusOS web UI — THE RUNNING PRINT
   ---------------------------------------------------------------------
   The one thing anyone opens this page to see, and the one thing the
   socket does not carry.

   The state document is pinned to the factory's six roots by gate 2 and
   by the state test, so the clone does not add a seventh for a
   percentage. It exposes a route of its own instead, and the page polls
   it (ps_api.c ps_api_print_get):

       GET /api/print
       { percent, stage, printing, printer_state,
         temp: { nozzle, bed, chamber } }

       percent is -1 until a report has arrived, and each temperature is
       -1000 (PS_TEMP_NONE) until one has, so "not printing" is
       distinguishable from "printing at 0%".

   Polling is deliberate and it is cheap: a percentage does not need to
   arrive in the same millisecond it changes. The interval slows right
   down when the tab is hidden and when nothing is printing, so an idle
   device sitting on a desk is asked about twice a minute.

   This module owns the job strip on the dashboard and the progress line
   under the top bar. It reads no socket state and writes none.
   ================================================================= */

(function () {
  'use strict';

  var FAST = 2000;     /* printing, tab visible */
  var SLOW = 30000;    /* idle, or the tab is hidden */
  var TEMP_NONE = -1000;

  /* ps_cfg.c ps_gif_slot_names, in the device's order. The index is what
     /api/print reports as stage, so the order here is a contract with
     the firmware and not a list that can be tidied. */
  var STAGES = ['standby', 'nozzle_heating', 'bed_heating', 'bed_leveling', 'homing',
                'nozzle_cleaning', 'calibrating_flow', 'xy_mesh_mode_sweep',
                'filament_check_location', 'filament_cut', 'filament_pull_back_cur',
                'filament_push_new', 'filament_purge_old', 'printing_ok', 'printing'];

  var g_timer = null;
  var g_last = null;

  function stage_name(i) {
    if (!isNum(i) || i < 0 || i >= STAGES.length) return '';
    return tr('ui_stage_' + STAGES[i], STAGES[i].replace(/_/g, ' '));
  }

  function temp_span(labelKey, fallback, v) {
    if (!isNum(v) || v <= TEMP_NONE) return null;
    return valueSpan(tr(labelKey, fallback) + ' ' + fmtTemp(v));
  }

  function render_print(d) {
    var printing = !!(d && d.printing), pct = d ? d.percent : -1;
    var known = isNum(pct) && pct >= 0;

    /* The strip's headline: what the printer is doing, not what it is called.
       This device does not report a job name, so inventing a blank line where
       one would go is worse than saying the stage. */
    var head = printing ? stage_name(d.stage) : '';
    setText('ps-job-name', head || tr('ui_no_job', 'Nothing printing'));
    setText('ps-job-pct', known ? fmtPct(pct) : '');

    var fill = byId('ps-job-fill');
    if (fill) { fill.value = known ? pct : 0; fill.hidden = !known; }

    var meta = byId('ps-job-meta');
    if (meta) {
      meta.innerHTML = '';
      var t = (d && d.temp) || {};
      var rows = [temp_span('ui_nozzle', 'Nozzle', t.nozzle),
                  temp_span('ui_bed', 'Bed', t.bed),
                  temp_span('ui_chamber', 'Chamber', t.chamber)];
      for (var i = 0; i < rows.length; i++) if (rows[i]) meta.appendChild(rows[i]);
    }

    /* The same number under the top bar, where it can be read across a room. */
    setText('ps-top-pct', known ? fmtPct(pct) : '');
    var prog = byId('ps-top-prog');
    if (prog) { prog.value = known ? pct : 0; prog.hidden = !known; }

    g_last = d;
  }
  window.render_print = render_print;

  function interval() {
    if (typeof document.hidden === 'boolean' && document.hidden) return SLOW;
    return (g_last && g_last.printing) ? FAST : SLOW;
  }

  function poll() {
    var done = function () {
      if (g_timer) clearTimeout(g_timer);
      g_timer = setTimeout(poll, interval());
    };
    var x = new XMLHttpRequest();
    x.open('GET', '/api/print', true);
    x.timeout = 4000;
    x.onload = function () {
      if (x.status === 200) {
        try { render_print(JSON.parse(x.responseText)); }
        catch (e) { /* a body that is not JSON is a route that is not there */ }
      }
      done();
    };
    /* A device that does not answer is not an error to show. The socket already
       says whether the device is there, and two places saying it disagree. */
    x.onerror = done;
    x.ontimeout = done;
    try { x.send(); } catch (e) { done(); }
  }

  function start() {
    render_print(null);
    poll();
    if (typeof document.addEventListener === 'function') {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden) { if (g_timer) clearTimeout(g_timer); poll(); }
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
