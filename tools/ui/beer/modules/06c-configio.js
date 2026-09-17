/* =====================================================================
   PandaStatusOS web UI — C3: THE SETTINGS FILE
   ---------------------------------------------------------------------
       GET  /api/config    the whole settings document, with a
                           Content-Disposition so a browser saves it
       POST /api/config    the same document back; taken whole or refused
                           whole, and the answer is the new truth

   The document carries no Wi-Fi password, no hotspot password and no
   printer access code: the device leaves them out, so a file that ends up
   in a chat or a backup folder cannot hand anyone the network. That also
   means a restore cannot put them back, and the card says so rather than
   letting someone find out after wiping a unit.

   The download is a plain navigation to the route, not a fetch and a blob:
   the device already sets the filename, and one less copy of the settings
   passes through this page.
   ================================================================= */

(function () {
  'use strict';

  function on() {
    var f = (window.fx_features && fx_features()) || {};
    return !!f.config_io;
  }

  function note(key, fallback) {
    var el = byId('ps-cfg-note');
    if (!el) return;
    if (!key) { el.textContent = ''; el.removeAttribute('data-str'); return; }
    el.textContent = tr(key, fallback);
    el.setAttribute('data-str', key);
  }

  function render_config_io() {
    var card = byId('ps-cfg-card');
    if (card) card.hidden = !on();
  }
  window.render_config_io = render_config_io;

  function restore(file) {
    if (!file) return;
    note('', '');
    var r = new FileReader();
    r.onload = function () {
      var x = new XMLHttpRequest();
      x.open('POST', '/api/config', true);
      x.setRequestHeader('Content-Type', 'application/json');
      x.timeout = 8000;
      x.onload = function () {
        if (x.status === 200) {
          note('ui_settings_restored', 'Settings restored.');
          /* Everything on every page just changed under the reader. The socket will push
             the roots it owns; the routes' own cards are asked again here. */
          if (window.refresh_features) refresh_features();
          return;
        }
        note('ui_settings_refused', 'The device refused that file. It takes the file this page downloads, whole.');
      };
      x.onerror = function () { note('ui_settings_refused', ''); };
      x.ontimeout = function () { note('ui_settings_refused', ''); };
      try { x.send(r.result); } catch (e) { note('ui_settings_refused', ''); }
    };
    r.onerror = function () { note('ui_settings_refused', ''); };
    try { r.readAsText(file); } catch (e) { note('ui_settings_refused', ''); }
  }

  function wire() {
    var d = byId('ps-cfg-download');
    if (d) d.addEventListener('click', function () {
      /* The route names the file and marks it an attachment; the browser does the rest. */
      window.location.href = '/api/config';
    });
    var f = byId('ps-cfg-file');
    if (f) f.addEventListener('change', function () {
      var file = f.files && f.files[0];
      f.value = '';
      restore(file);
    });
    render_config_io();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
