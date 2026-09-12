'use strict';
/* Network: Wi-Fi, hostname, hotspot. Facts from docs/protocol-websocket.md:
   - wifi: Scan sends {scan}; Connect sends {ssid, password}. Inbound: ssid, password, scan,
     list. sta: Set-hostname sends {hostname}; inbound ip, hostname, state. ap: the enable
     checkbox sends {on}; the settings confirm sends {ssid, password, ip}; inbound ssid,
     password, ip, on
   - set_hostname and set_hotspot_ip answer with a response whose OK, in the core module,
     sends settings.reset (a restart). set_ap answers with a toast
   - sta.state 1 nossid 2 connecting 3 connected 4 reconnecting 5 password error; the labels
     are the dashboard's. wifi.scan 0 idle 1 scanning 2 done
   - the device also sends sta.auth_err_reason, which the factory UI does not handle. Shown
     as a bare code when non-zero, meaning unknown until the bench
   - the factory UI handles sta.hostname and the ap fields inbound, so those fields are
     pre-filled from the push while untouched. INFERENCE about the factory form, harmless
     on the wire: what is sent is what the field holds when the button is pressed. The Wi-Fi
     password is never pre-filled; the hotspot password is the device's own, pre-filled
     into a password field
   - scan list entries are {ssid, rssi}, the mock's INFERENCE of the shape */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var STA = { 1: 'ps_dashboard_sta_1', 2: 'ps_dashboard_sta_2', 3: 'ps_dashboard_sta_3', 4: 'ps_dashboard_sta_4', 5: 'ps_dashboard_sta_5' };
  var SCAN = { 0: 'ps_network_scan_0', 1: 'ps_network_scan_1', 2: 'ps_network_scan_2' };
  var touched = {};                                   // field id -> the user has typed in it
  var lastList = null;

  function present(v) { return v !== undefined && v !== null && v !== ''; }
  function setValue(el, v) { if (present(v)) { el.textContent = String(v); el.classList.remove('ps-unset'); } else { el.textContent = '—'; el.classList.add('ps-unset'); } }
  function label(map, v, el) {
    var k = map[v];
    if (k) { el.setAttribute('data-ps-str', k); el.textContent = PS.tr(k); }
    else { el.removeAttribute('data-ps-str'); el.textContent = present(v) ? PS.tr('ps_dashboard_unknown_state') + ' ' + v : '—'; }
  }
  function prefill(id, v) {
    var el = $(id);
    if (touched[id] || document.activeElement === el) return;
    el.value = present(v) ? String(v) : '';
  }

  function render(s) {
    var w = s.wifi || {}, sta = s.sta || {}, ap = s.ap || {};
    setValue($('ps-network-ssid'), w.ssid);
    label(STA, sta.state, $('ps-network-state'));
    $('ps-network-dot').className = 'ps-dot' + (sta.state === 3 ? ' ps-dot-on' : (sta.state === 2 || sta.state === 4) ? ' ps-dot-warn' : sta.state === 5 ? ' ps-dot-error' : '');
    $('ps-network-ip').textContent = present(sta.ip) ? String(sta.ip) : '—';
    var reason = sta.auth_err_reason;
    $('ps-network-reason').textContent = (present(reason) && Number(reason) !== 0) ? String(reason) : '—';
    label(SCAN, w.scan, $('ps-network-scan-state'));
    $('ps-network-scan').disabled = w.scan === 1;
    renderFound(Array.isArray(w.list) ? w.list : []);
    prefill('ps-network-hostname-input', sta.hostname);
    prefill('ps-network-ap-ssid', ap.ssid); prefill('ps-network-ap-password', ap.password); prefill('ps-network-ap-ip', ap.ip);
    var on = $('ps-network-ap-on'); if (document.activeElement !== on) on.checked = ap.on === 1;
  }

  function renderFound(list) {
    var key = JSON.stringify(list);
    if (key === lastList) return;
    lastList = key;
    var box = $('ps-network-found');
    while (box.firstChild) box.removeChild(box.firstChild);
    list.forEach(function (e, i) {
      if (!e || typeof e !== 'object') return;
      var row = document.createElement('div'); row.className = 'ps-row ps-network-found-row'; row.setAttribute('data-ps-found', String(i));
      var name = document.createElement('span'); name.className = 'ps-tile-value'; name.textContent = present(e.ssid) ? String(e.ssid) : '—';
      var rssi = document.createElement('span'); rssi.className = 'ps-tile-label ps-mono'; rssi.textContent = present(e.rssi) ? String(e.rssi) + ' dBm' : '';
      var use = document.createElement('button'); use.className = 'border small'; use.setAttribute('data-ps-str', 'ps_network_use'); use.textContent = PS.tr('ps_network_use');
      use.addEventListener('click', function () {
        $('ps-network-connect-ssid').value = present(e.ssid) ? String(e.ssid) : ''; touched['ps-network-connect-ssid'] = true;
        $('ps-network-connect-password').focus();
      });
      row.appendChild(name); row.appendChild(rssi); row.appendChild(use); box.appendChild(row);
    });
  }

  function wire() {
    ['ps-network-hostname-input', 'ps-network-ap-ssid', 'ps-network-ap-password', 'ps-network-ap-ip', 'ps-network-connect-ssid'].forEach(function (id) {
      $(id).addEventListener('input', function () { touched[id] = true; });
    });
    $('ps-network-scan').addEventListener('click', function () { PS.send('wifi', { scan: 1 }); });
    $('ps-network-connect-send').addEventListener('click', function () {
      PS.send('wifi', { ssid: $('ps-network-connect-ssid').value, password: $('ps-network-connect-password').value });
    });
    $('ps-network-hostname-send').addEventListener('click', function () { PS.send('sta', { hostname: $('ps-network-hostname-input').value }); });
    $('ps-network-ap-on').addEventListener('change', function () { PS.send('ap', { on: this.checked ? 1 : 0 }); });
    $('ps-network-ap-send').addEventListener('click', function () {
      PS.send('ap', { ssid: $('ps-network-ap-ssid').value, password: $('ps-network-ap-password').value, ip: $('ps-network-ap-ip').value });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  PS.on('state', function (ev) { render(ev.state); });
})();
