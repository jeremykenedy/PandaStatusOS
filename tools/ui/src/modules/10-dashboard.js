'use strict';
/* Dashboard: what the device pushes, rendered. Nothing here sends.

   Only fields the WebSocket actually carries are shown. Print stage, progress and the stage
   image are NOT on this socket; they reach the display by another route the bench session
   identifies, so they are not drawn here until that is known. Drawing a stale progress bar
   with no data behind it is exactly the fault the sibling project shipped. "Unset" is a
   rendering that has to be designed: a marked dash, never a zero. */

(function () {
  var STA = { 1: 'ps_dashboard_sta_1', 2: 'ps_dashboard_sta_2', 3: 'ps_dashboard_sta_3', 4: 'ps_dashboard_sta_4', 5: 'ps_dashboard_sta_5' };
  var PRN = { 1: 'ps_dashboard_prn_1', 2: 'ps_dashboard_prn_2', 3: 'ps_dashboard_prn_3', 4: 'ps_dashboard_prn_4', 5: 'ps_dashboard_prn_5', 6: 'ps_dashboard_prn_6', 7: 'ps_dashboard_prn_7' };
  var $ = function (id) { return document.getElementById(id); };

  function present(v) { return v !== undefined && v !== null && v !== ''; }
  function setValue(el, v) { if (present(v)) { el.textContent = String(v); el.classList.remove('ps-unset'); } else { el.textContent = '—'; el.classList.add('ps-unset'); } }
  function dot(el, cls) { el.className = 'ps-dot' + (cls ? ' ps-dot-' + cls : ''); }

  function render(s) {
    var p = s.printer || {}, sta = s.sta || {}, ap = s.ap || {}, set = s.settings || {};

    // printer: name, then the binding state as a label with a dot
    setValue($('ps-dashboard-printer-name'), p.name);
    var pk = PRN[p.state]; $('ps-dashboard-printer-state').textContent = pk ? PS.tr(pk) : (present(p.state) ? PS.tr('ps_dashboard_unknown_state') + ' ' + p.state : '—');
    dot($('ps-dashboard-printer-dot'), p.state === 3 ? 'on' : p.state === 2 ? 'warn' : p.state >= 4 ? 'error' : '');

    // network: hostname, then the station state; the address only once connected
    setValue($('ps-dashboard-hostname'), sta.hostname);
    var sk = STA[sta.state];
    var net = sk ? PS.tr(sk) : (present(sta.state) ? PS.tr('ps_dashboard_unknown_state') + ' ' + sta.state : '—');
    if (sta.state === 3 && present(sta.ip)) net += ' · ' + sta.ip;
    $('ps-dashboard-network-state').textContent = net;
    dot($('ps-dashboard-network-dot'), sta.state === 3 ? 'on' : (sta.state === 2 || sta.state === 4) ? 'warn' : sta.state === 5 ? 'error' : '');

    // lighting: the mode, and the brightness of the mode that is selected
    var mode = set.current_mode;
    setValue($('ps-dashboard-mode'), mode === 0 ? PS.tr('ps_dashboard_mode_music') : mode === 1 ? PS.tr('ps_dashboard_mode_h2d') : undefined);
    var entry = (set.list2 && set.list2[mode]) || null;
    $('ps-dashboard-brightness').textContent = entry && present(entry.brightness) ? PS.tr('ps_dashboard_brightness') + ' ' + entry.brightness + '%' : '—';

    // device: firmware version, and whether the hotspot is up
    setValue($('ps-dashboard-fw'), set.fw_version);
    $('ps-dashboard-hotspot').textContent = present(ap.on) ? (ap.on === 1 ? PS.tr('ps_dashboard_hotspot_on') : PS.tr('ps_dashboard_hotspot_off')) : '—';

    // the top-bar pill reflects the printer link, which is what an owner glances for
    if (p.state === 3) PS.pill('ps_dashboard_pill_ready', 'ok');
    else if (p.state === 2) PS.pill('ps_dashboard_pill_connecting', 'warn');
    else if (p.state >= 4) PS.pill('ps_dashboard_pill_error', 'error');
    else PS.pill('ps_dashboard_pill_unbound', '');
  }

  PS.on('state', function (e) { render(e.state); });
})();
