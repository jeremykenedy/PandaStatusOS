'use strict';
/* Printer binding. Facts from docs/protocol-websocket.md, root printer:
   - Scan button sends {scan}; Bind sends {name, sn, access_code, ip}; Unbind, after its
     confirm, sends {disconnect}. The values 1 for scan and disconnect follow the wire
     harness (wire.js), INFERENCE until the bench capture shows the factory frame
   - inbound: name, state, scan, list. The push also carries sn, access_code and ip; the
     factory UI handles only the first four. The name, serial and address are shown here
     because the device sends them. The access code is never shown and never pre-filled
   - printer.state and printer.scan are enums; the labels for state are the dashboard's
   - the bind form is not pre-filled from the device: the factory UI does not handle those
     fields, so its form starts empty, and what Bind sends is exactly what was typed
   - list entries are {name, ip, sn}. The first two are the factory's inferred shape; the
     serial is this project's addition, because a printer's own announcement carries it and
     there is no reason to make a person copy it off the printer by hand (ps_ssdp.c). Use fills
     all three and leaves the caret in the access code, which nothing broadcasts */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var PRN = { 1: 'ps_dashboard_prn_1', 2: 'ps_dashboard_prn_2', 3: 'ps_dashboard_prn_3', 4: 'ps_dashboard_prn_4', 5: 'ps_dashboard_prn_5', 6: 'ps_dashboard_prn_6', 7: 'ps_dashboard_prn_7' };
  var SCAN = { 0: 'ps_printer_scan_0', 1: 'ps_printer_scan_1', 2: 'ps_printer_scan_2', 3: 'ps_printer_scan_3', 4: 'ps_printer_scan_4', 5: 'ps_printer_scan_5', 6: 'ps_printer_scan_6' };
  var lastList = null;

  function present(v) { return v !== undefined && v !== null && v !== ''; }
  function setValue(el, v) { if (present(v)) { el.textContent = String(v); el.classList.remove('ps-unset'); } else { el.textContent = '—'; el.classList.add('ps-unset'); } }
  function label(map, v, el) {
    var k = map[v];
    if (k) { el.setAttribute('data-ps-str', k); el.textContent = PS.tr(k); }
    else { el.removeAttribute('data-ps-str'); el.textContent = present(v) ? PS.tr('ps_dashboard_unknown_state') + ' ' + v : '—'; }
  }

  function render(s) {
    var p = s.printer || {};
    setValue($('ps-printer-name'), p.name);
    label(PRN, p.state, $('ps-printer-state'));
    $('ps-printer-dot').className = 'ps-dot' + (p.state === 3 ? ' ps-dot-on' : p.state === 2 ? ' ps-dot-warn' : p.state >= 4 ? ' ps-dot-error' : '');
    $('ps-printer-sn').textContent = present(p.sn) ? String(p.sn) : '—';
    $('ps-printer-ip').textContent = present(p.ip) ? String(p.ip) : '—';
    $('ps-printer-unbind').disabled = !(p.state >= 2);
    label(SCAN, p.scan, $('ps-printer-scan-state'));
    $('ps-printer-scan').disabled = p.scan === 1 || p.scan === 3;
    renderFound(Array.isArray(p.list) ? p.list : []);
  }

  function renderFound(list) {
    var key = JSON.stringify(list);
    if (key === lastList) return;
    lastList = key;
    var box = $('ps-printer-found');
    while (box.firstChild) box.removeChild(box.firstChild);
    list.forEach(function (e, i) {
      if (!e || typeof e !== 'object') return;
      var row = document.createElement('div'); row.className = 'ps-row ps-printer-found-row'; row.setAttribute('data-ps-found', String(i));
      var name = document.createElement('span'); name.className = 'ps-tile-value'; name.textContent = present(e.name) ? String(e.name) : '—';
      var ip = document.createElement('span'); ip.className = 'ps-tile-label ps-mono';
      ip.textContent = (present(e.ip) ? String(e.ip) : '') + (present(e.sn) ? '  ' + String(e.sn) : '');
      var use = document.createElement('button'); use.className = 'border small'; use.setAttribute('data-ps-str', 'ps_printer_use'); use.textContent = PS.tr('ps_printer_use');
      /* Use fills everything the announcement carried and nothing it did not. The access
         code is the one field a printer never broadcasts: it is a secret read off the
         printer's own screen, so the caret lands there with the rest already filled in. */
      use.addEventListener('click', function () {
        $('ps-printer-bind-name').value = present(e.name) ? String(e.name) : '';
        $('ps-printer-bind-ip').value = present(e.ip) ? String(e.ip) : '';
        if (present(e.sn)) $('ps-printer-bind-sn').value = String(e.sn);
        $('ps-printer-bind-code').focus();
      });
      row.appendChild(name); row.appendChild(ip); row.appendChild(use); box.appendChild(row);
    });
  }

  function wire() {
    $('ps-printer-scan').addEventListener('click', function () { PS.send('printer', { scan: 1 }); });
    $('ps-printer-bind-send').addEventListener('click', function () {
      PS.send('printer', {
        name: $('ps-printer-bind-name').value,
        sn: $('ps-printer-bind-sn').value,
        access_code: $('ps-printer-bind-code').value,
        ip: $('ps-printer-bind-ip').value,
      });
    });
    $('ps-printer-unbind').addEventListener('click', function () {
      PS.dialog(PS.tr('ps_printer_unbind_title'), PS.tr('ps_printer_unbind_text'),
        [{ key: 'ps_printer_unbind_confirm', handler: function () { PS.send('printer', { disconnect: 1 }); } }, { key: 'ps_global_cancel' }]);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  PS.on('state', function (ev) { render(ev.state); });
})();
