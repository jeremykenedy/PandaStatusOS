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
    /* The name the printer gave the job, which is what a person recognises. The stage is
       the fallback, because a running print with no name still has something to say. */
    var job = d && typeof d.job === 'string' ? d.job : '';
    var head = printing ? (job || stage_name(d.stage)) : '';
    setText('ps-job-name', head || tr('ui_no_job', 'Nothing printing'));
    setText('ps-job-pct', known ? fmtPct(pct) : '');

    var fill = byId('ps-job-fill');
    if (fill) { fill.value = known ? pct : 0; fill.hidden = !known; }

    var meta = byId('ps-job-meta');
    if (meta) {
      meta.innerHTML = '';
      var t = (d && d.temp) || {};
      var rows = [];
      /* Which printer, first. "Printing, 68%" says nothing about WHERE, and a device that
         can be re-bound to another printer should never leave that ambiguous. */
      var pname = (g_state.printer || {}).name;
      if (printing && typeof pname === 'string' && pname) rows.push(valueSpan(pname));
      /* The stage, when the name took the headline: otherwise the strip never says what
         the printer is actually doing right now. */
      if (printing && job) rows.push(valueSpan(stage_name(d.stage)));
      if (printing && isNum(d.layer) && d.layer >= 0) {
        rows.push(valueSpan(isNum(d.layers) && d.layers > 0
          ? tr('ui_layer', 'layer') + ' ' + d.layer + ' ' + tr('ui_of', 'of') + ' ' + d.layers
          : tr('ui_layer', 'layer') + ' ' + d.layer));
      }
      if (printing && isNum(d.remain_min) && d.remain_min >= 0) {
        rows.push(valueSpan(fmtRemain(d.remain_min) + ' ' + tr('ui_left', 'left')));
      }
      if (printing && isNum(d.speed_level) && SPEED_WORDS[d.speed_level]) {
        rows.push(valueSpan(tr('speed_word_' + d.speed_level, SPEED_WORDS[d.speed_level])));
      }
      rows.push(temp_span('ui_nozzle', 'Nozzle', t.nozzle));
      rows.push(temp_span('ui_bed', 'Bed', t.bed));
      rows.push(temp_span('ui_chamber', 'Chamber', t.chamber));
      for (var i = 0; i < rows.length; i++) if (rows[i]) meta.appendChild(rows[i]);
    }

    /* The same number under the top bar, where it can be read across a room. */
    setText('ps-top-pct', known ? fmtPct(pct) : '');
    var prog = byId('ps-top-prog');
    if (prog) { prog.value = known ? pct : 0; prog.hidden = !known; }

    render_chip(d, printing, known, pct);
    render_printer_card(d);
    g_last = d;
    window.g_last_print = d;
  }
  window.render_print = render_print;

  /* The chip on the top bar. What the printer is DOING, which is the stage while a print
     runs and the link's own state otherwise. The vent read a six-value device_state off
     its own policy root; this device sends printer.state, which is the link (1 unbound
     through 7 unknown error), and what the print is doing comes from here. */
  function render_chip(d, printing, known, pct) {
    if (typeof g_have_first_state !== 'undefined' && !g_have_first_state) return;
    var link = (g_state.printer || {}).state;
    var dot = byId('ps-top-dot');
    var word, cls;
    if (printing) {
      word = stage_name(d.stage) || tr('ui_printer_state_2', 'Printing');
      cls = 'is-run';
    } else if (isNum(link) && link !== 3) {
      word = tr('ui_link_state_' + link, 'Printer not connected');
      cls = (link >= 4) ? 'is-err' : 'is-wait';
    } else {
      word = tr('ui_printer_state_0', 'Idle');
      cls = 'is-idle';
    }
    if (dot) dot.setAttribute('class', 'ux_top_dot ' + cls);
    setText('ps-top-state', word);
    setHidden('ps-top-pct', !known);
  }

  /* The Printer card. It was eight static rows with a label and no value element, because
     the vent rebuilt the list from its own model and that model is gone. Rebuilt here from
     what this device reports and nothing else: rows for readings it does not have would be
     eight dashes forever. */
  function render_printer_card(d) {
    var ul = byId('ps-kv-printer');
    if (!ul) return;
    var p = g_state.printer || {};
    var t = (d && d.temp) || {};
    var rows = [];

    /* Which printer this is, before anything about it. On a bench with two of them the
       name is the only row that says WHICH one the rest of the card is describing. */
    rows.push(kv_li_icon('printer', tr('card_printer', 'Printer'), null,
      (typeof p.name === 'string' && p.name) ? valueSpan(p.name) : unknownSpan()));

    rows.push(kv_li_icon('network', tr('status_link', 'Link'), null,
      isNum(p.state) ? valueSpan(tr('ui_link_state_' + p.state, String(p.state))) : unknownSpan()));

    var stateTxt = d && d.printing ? (stage_name(d.stage) || tr('ui_printer_state_2', 'Printing'))
                                   : (d ? tr('ui_printer_state_0', 'Idle') : null);
    rows.push(kv_li_icon('printer-enclosed', tr('ui_state', 'State'), null,
      stateTxt ? valueSpan(stateTxt) : unknownSpan()));

    var temps = [['nozzle-temp', 'status_nozzle', 'Nozzle', t.nozzle],
                 ['bed-hot', 'status_bed', 'Bed', t.bed],
                 ['temp', 'status_chamber', 'Chamber', t.chamber]];
    for (var i = 0; i < temps.length; i++) {
      var v = temps[i][3];
      rows.push(kv_li_icon(temps[i][0], tr(temps[i][1], temps[i][2]), null,
        (isNum(v) && v > TEMP_NONE) ? valueSpan(fmtTemp(v)) : unknownSpan()));
    }

    /* Everything below comes from printer.status, which the device fills from the same
       report the temperatures come from. A member the printer has never sent is absent from
       that object, and an absent member means the row is left out rather than shown as a
       dash: the card is what this printer reports, not a form with gaps in it. */
    var st = p.status || {};

    if (isNum(st.fan_part) || isNum(st.fan_aux) || isNum(st.fan_chamber)) {
      rows.push(kv_li_icon('fan', tr('status_fans', 'Fans'), null,
        valueSpan([st.fan_part, st.fan_aux, st.fan_chamber]
          .map(function (f) { return isNum(f) ? fmtPct(f) : DASH; }).join(' \u00b7 '))));
    }

    var spec = [];
    if (st.nozzle_dia) spec.push(st.nozzle_dia + ' mm');
    var kind = window.nozzle_kind_text ? nozzle_kind_text(st.nozzle_kind) : null;
    if (kind) spec.push(kind);
    if (spec.length) rows.push(kv_li_icon('nozzle', tr('ui_kv_nozzle_fitted', 'Nozzle fitted'), null, valueSpan(spec.join(', '))));

    if (isNum(st.filament_in)) {
      rows.push(kv_li_icon('spool-end', tr('ui_filament', 'Filament'), null,
        valueSpan(st.filament_in ? tr('ui_yes', 'Yes') : tr('ui_no', 'No'))));
    }

    if (isNum(st.ams_humidity) || isNum(st.ams_temp)) {
      var ams = [];
      if (isNum(st.ams_humidity)) ams.push(tr('ams_level', 'level') + ' ' + st.ams_humidity);
      if (isNum(st.ams_temp)) ams.push(fmtTemp(st.ams_temp));
      rows.push(kv_li_icon('humidity', tr('ui_kv_ams_humidity', 'AMS humidity'), null, valueSpan(ams.join(' \u00b7 '))));
    }

    /* A fault the printer is carrying right now. No fault, no row. */
    if (st.hms_code) rows.push(kv_li_icon('warning', tr('status_fault_code', 'Fault code'), null, valueSpan(st.hms_code)));

    if (st.printer_rssi) rows.push(kv_li_icon('network', tr('ui_kv_printer_signal', 'Printer signal'), null, valueSpan(st.printer_rssi)));

    /* This device's own side of the same link, on the same card, because the card is about
       the two of them talking. */
    var wifi = g_state.wifi || {}, sta = g_state.sta || {};
    var mine = [];
    if (wifi.ssid) mine.push(wifi.ssid);
    if (sta.ip) mine.push(sta.ip);
    if (isNum(st.wifi_rssi)) mine.push(st.wifi_rssi + ' dBm');
    if (mine.length) rows.push(kv_li_icon('network', tr('ui_this_device', 'This device'), null, valueSpan(mine.join(' \u00b7 '))));

    if (isNum(st.uptime_s)) rows.push(kv_li_icon('clock', tr('status_uptime', 'Uptime'), null, valueSpan(fmtUptime(st.uptime_s))));

    ul.textContent = '';
    for (var j = 0; j < rows.length; j++) ul.appendChild(rows[j]);
  }

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
