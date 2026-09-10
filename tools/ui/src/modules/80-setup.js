'use strict';
/* Setup: the first-run page. Language, Wi-Fi, idle colour, in that order, on one card.
   Not in the nav. Shown on its own when the first state document says the device has no
   network (sta.state 1, no ssid) and this browser session has not finished setup;
   reachable at #setup at any time. Whether the factory UI has a first-run flow, and what
   it looks like, is unknown: INFERENCE, recorded in docs/DECISIONS.md.
   Every send here is a frame another page also sends, with the same members:
   settings.language, wifi.scan, wifi.ssid + password, settings.rgb_info_mode + rgb_rgba
   + rgb_state_index 0. Nothing new on the wire. */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STA = { 1: 'ps_dashboard_sta_1', 2: 'ps_dashboard_sta_2', 3: 'ps_dashboard_sta_3', 4: 'ps_dashboard_sta_4', 5: 'ps_dashboard_sta_5' };
  var DONE_KEY = 'ps_setup_done';
  var routed = false, lastList = null, colourFocused = false;

  function present(v) { return v !== undefined && v !== null && v !== ''; }
  function done() { try { return sessionStorage.getItem(DONE_KEY) === '1'; } catch (e) { return false; } }
  function mode() { var m = PS.state.settings && PS.state.settings.current_mode; return (m === 0 || m === 1) ? m : null; }
  function toDevice(hex, m) {
    var h = hex.replace('#', '').toUpperCase();
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var rgb = h.slice(0, 6), a = h.length >= 8 ? h.slice(6, 8) : 'FF';
    return m === 0 ? rgb : '#' + rgb + a;
  }
  function toCss(dev) { var h = String(dev || '').replace('#', ''); return h.length < 6 ? '' : '#' + h.slice(0, 6) + (h.length >= 8 ? h.slice(6, 8) : ''); }

  function render(s) {
    var sta = s.sta || {}, w = s.wifi || {};
    if (!routed) {
      routed = true;
      var unprovisioned = sta.state === 1 && !present(w.ssid);
      if (unprovisioned && !done() && (!location.hash || location.hash === '#dashboard')) location.hash = '#setup';
    }
    PS.fillLangs($('ps-setup-language'));
    var sel = $('ps-setup-language'); if (document.activeElement !== sel && typeof (s.settings || {}).language === 'string') sel.value = s.settings.language;
    var k = STA[sta.state]; var el = $('ps-setup-state');
    if (k) { el.setAttribute('data-ps-str', k); el.textContent = PS.tr(k); } else { el.removeAttribute('data-ps-str'); el.textContent = '—'; }
    $('ps-setup-dot').className = 'ps-dot' + (sta.state === 3 ? ' ps-dot-on' : (sta.state === 2 || sta.state === 4) ? ' ps-dot-warn' : sta.state === 5 ? ' ps-dot-error' : '');
    $('ps-setup-scan').disabled = w.scan === 1;
    renderFound(Array.isArray(w.list) ? w.list : []);
    var m = mode(), e = m !== null && s.settings.list2 && s.settings.list2[m];
    var css = e ? toCss(e.rgb_rgba && e.rgb_rgba[0]) : '';
    if (!colourFocused) { $('ps-setup-colour').value = css; $('ps-setup-colour').dispatchEvent(new Event('input', { bubbles: false })); }
    $('ps-setup-colour-dot').style.background = css || '';
  }

  function renderFound(list) {
    var key = JSON.stringify(list);
    if (key === lastList) return;
    lastList = key;
    var box = $('ps-setup-found');
    while (box.firstChild) box.removeChild(box.firstChild);
    list.forEach(function (e, i) {
      if (!e || typeof e !== 'object') return;
      var row = document.createElement('div'); row.className = 'ps-row ps-network-found-row'; row.setAttribute('data-ps-setup-found', String(i));
      var name = document.createElement('span'); name.className = 'ps-tile-value'; name.textContent = present(e.ssid) ? String(e.ssid) : '—';
      var rssi = document.createElement('span'); rssi.className = 'ps-tile-label ps-mono'; rssi.textContent = present(e.rssi) ? String(e.rssi) + ' dBm' : '';
      var use = document.createElement('button'); use.className = 'border small'; use.setAttribute('data-ps-str', 'ps_setup_use'); use.textContent = PS.tr('ps_setup_use');
      use.addEventListener('click', function () { $('ps-setup-ssid').value = present(e.ssid) ? String(e.ssid) : ''; $('ps-setup-password').focus(); });
      row.appendChild(name); row.appendChild(rssi); row.appendChild(use); box.appendChild(row);
    });
  }

  function wire() {
    PS.fillLangs($('ps-setup-language'));
    $('ps-setup-language').addEventListener('change', function () { PS.send('settings', { language: this.value }); });
    $('ps-setup-scan').addEventListener('click', function () { PS.send('wifi', { scan: 1 }); });
    $('ps-setup-connect').addEventListener('click', function () { PS.send('wifi', { ssid: $('ps-setup-ssid').value, password: $('ps-setup-password').value }); });
    $('ps-setup-show').addEventListener('change', function () { $('ps-setup-password').type = this.checked ? 'text' : 'password'; });
    var colour = $('ps-setup-colour');
    colour.addEventListener('focus', function () { colourFocused = true; });
    colour.addEventListener('blur', function () { colourFocused = false; });
    colour.addEventListener('change', function () {
      var m = mode(); if (m === null) return;
      $('ps-setup-colour-dot').style.background = colour.value;
      PS.send('settings', { rgb_info_mode: m, rgb_rgba: toDevice(colour.value, m), rgb_state_index: 0 });
    });
    if (window.Coloris) Coloris({ el: '[data-ps-colour="setup"]', alpha: true, format: 'hex', themeMode: 'auto', wrap: false });
    $('ps-setup-finish').addEventListener('click', function () {
      try { sessionStorage.setItem(DONE_KEY, '1'); } catch (e) {}
      location.hash = '#dashboard';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  PS.on('state', function (ev) { render(ev.state); });
})();
