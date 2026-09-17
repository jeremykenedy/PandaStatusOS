/* =====================================================================
   PandaStatusOS web UI — C9: A FIXED ADDRESS
   ---------------------------------------------------------------------
       GET  /api/features   { features:{ static_ip, ... },
                              config:{ static_ip:{ on, ip, mask, gw, dns } } }
       POST /api/features   { config:{ static_ip:{ ... } } }

   The whole object is validated and applied by the device or refused by
   the device; this page sends what was typed and renders what came back.
   An empty string clears a field, which is how a gateway or a DNS server
   is taken back out without the switch going off.

   The change lands on the NEXT association, not on save, and the device
   says so rather than this page pretending the address has moved. Saving
   a fixed address while you are looking at the old one is normal: the
   page you are reading keeps working until the device rejoins.
   ================================================================= */

(function () {
  'use strict';

  var FIELDS = [['ps-sip-ip', 'ip'], ['ps-sip-mask', 'mask'], ['ps-sip-gw', 'gw'], ['ps-sip-dns', 'dns']];

  var g_doc = null;

  function feats() { return (g_doc && g_doc.features) || {}; }
  function sip() { return (g_doc && g_doc.config && g_doc.config.static_ip) || null; }

  function get(cb) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/features', true);
    x.timeout = 5000;
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
    x.open('POST', '/api/features', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 6000;
    x.onload = function () {
      if (x.status === 200) {
        try { g_doc = JSON.parse(x.responseText); } catch (e) {}
        render_static_ip();
        if (after) after(true);
        return;
      }
      /* Refused whole. Say so and re-read, rather than leave what was typed
         looking as though the device took it. */
      refresh(function () { if (after) after(false); });
    };
    x.onerror = function () { if (after) after(false); };
    x.ontimeout = function () { if (after) after(false); };
    try { x.send(JSON.stringify(body)); } catch (e) { if (after) after(false); }
  }

  function note(key, fallback) {
    var el = byId('ps-sip-note');
    if (!el) return;
    if (!key) { el.textContent = ''; el.removeAttribute('data-str'); return; }
    el.textContent = tr(key, fallback);
    el.setAttribute('data-str', key);
  }

  function render_static_ip() {
    var card = byId('ps-sip-card');
    if (!card) return;
    card.hidden = !feats().static_ip;
    if (card.hidden) return;

    var s = sip() || {};
    var on = byId('ps-sip-on');
    if (on && document.activeElement !== on) on.checked = !!s.on;
    FIELDS.forEach(function (pair) {
      var el = byId(pair[0]);
      if (el && document.activeElement !== el) el.value = s[pair[1]] || '';
    });
  }
  window.render_static_ip = render_static_ip;

  function refresh(after) {
    get(function (doc) {
      if (doc) g_doc = doc;
      render_static_ip();
      if (after) after();
    });
  }

  function save() {
    var body = { on: byId('ps-sip-on') && byId('ps-sip-on').checked ? 1 : 0 };
    FIELDS.forEach(function (pair) {
      var el = byId(pair[0]);
      body[pair[1]] = el ? String(el.value || '').trim() : '';
    });
    note('', '');
    post({ config: { static_ip: body } }, function (ok) {
      if (!ok) { note('ui_address_refused', 'The device refused that. Check every box holds an address like 192.168.1.50.'); return; }
      /* The device clears the switch itself when there is no address to apply, so what is
         drawn after a save is the device's answer and not the click. */
      note('ui_fixed_address_help', '');
    });
  }

  function wire() {
    var b = byId('ps-sip-save');
    if (b) b.addEventListener('click', save);
    /* The switch is part of the form, not a separate action: it is sent with Save, so a
       half-filled form cannot take the device off DHCP the moment the switch is touched. */
    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
