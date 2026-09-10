'use strict';
/* System: versions, language, theme, the two whole-image uploads, and the three resets.
   Facts from docs/protocol-websocket.md:
   - settings.fw_version is pushed; settings.img_version is handled by the factory UI but was
     absent from the observed push, so it renders as a dash until it arrives
   - the language select sends {language}; the device echoes settings.language and the core
     switches the string table on it
   - the theme is the browser's: PS.theme(), stored in localStorage, nothing on the wire
   - ota_fw and ota_img are POST /ota with those OTA-Type values and caps of 0x480000 and
     0x6E0000 bytes, compared against the file before sending, the limit named in MB when
     refused. The device answers on the socket with response {type, ok}; that is the verdict
   - reset is a restart and is never a button: only the set_hostname and set_hotspot_ip
     success handlers send it. rgb_reset belongs to the lighting page. factory_reset, after
     its confirm, erases all data and restarts; the response comes before the restart */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var verdict = {};                                     // ota type -> the device's last answer
  var langsBuilt = false;

  function mb(n) { return String(n / 1048576) + ' MB'; }
  function status(kind, key, fill) {
    var el = $('ps-system-' + kind + '-status');
    el.setAttribute('data-ps-str', key);
    var text = PS.tr(key);
    if (fill) Object.keys(fill).forEach(function (k) { text = text.replace('{' + k + '}', fill[k]); });
    el.textContent = text;
  }
  function sendFile(kind, type, file) {
    var cap = PS.UPLOAD_CAPS[type];
    if (file.size > cap) { status(kind, 'ps_system_status_too_big', { limit: mb(cap) }); return; }
    verdict[type] = null;
    var prog = $('ps-system-' + kind + '-progress'); prog.value = 0; prog.hidden = false;
    status(kind, 'ps_system_status_sending');
    PS.upload(type, file, {
      progress: function (pct) { prog.value = pct; },
      done: function (code) {
        prog.hidden = true;
        if (verdict[type]) return;
        if (code === 200) status(kind, 'ps_system_status_sent');
        else status(kind, 'ps_system_status_failed', { code: String(code) });
      },
    });
  }

  function buildLangs() {
    if (langsBuilt || typeof PS_STRING_LANGS === 'undefined') return;
    var sel = $('ps-system-language');
    PS_STRING_LANGS.forEach(function (code) {
      var o = document.createElement('option'); o.value = code;
      var table = (typeof PS_STRINGS !== 'undefined') && PS_STRINGS[code];
      o.textContent = (table && table.ps_core_language_name) || code;
      sel.appendChild(o);
    });
    langsBuilt = true;
  }

  function render(s) {
    var set = s.settings || {};
    $('ps-system-fw').textContent = (set.fw_version !== undefined && set.fw_version !== '') ? String(set.fw_version) : '—';
    $('ps-system-img').textContent = (set.img_version !== undefined && set.img_version !== '') ? String(set.img_version) : '—';
    buildLangs();
    var sel = $('ps-system-language');
    if (document.activeElement !== sel && typeof set.language === 'string') sel.value = set.language;
  }
  function renderTheme() {
    var pref = null; try { pref = localStorage.getItem('ps_theme'); } catch (e) {}
    $('ps-system-theme').value = (pref === 'dark' || pref === 'light') ? pref : 'auto';
  }

  function wire() {
    buildLangs(); renderTheme();
    $('ps-system-language').addEventListener('change', function () { PS.send('settings', { language: this.value }); });
    $('ps-system-theme').addEventListener('change', function () { PS.theme(this.value); });
    $('ps-topbar-theme').addEventListener('click', function () { setTimeout(renderTheme, 0); });   // the top-bar cycle changes the same preference
    $('ps-system-fw-file').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) sendFile('fw', 'ota_fw', f); });
    $('ps-system-img-file').addEventListener('change', function () { var f = this.files && this.files[0]; this.value = ''; if (f) sendFile('img', 'ota_img', f); });
    $('ps-system-factory').addEventListener('click', function () {
      PS.dialog(PS.tr('ps_system_factory_title'), PS.tr('ps_system_factory_dialog'),
        [{ key: 'ps_system_factory_confirm', handler: function () { PS.send('settings', { factory_reset: 1 }); } }, { key: 'ps_global_cancel' }]);
    });
  }

  PS.on('response', function (r) {
    if (r.type !== 'ota_fw' && r.type !== 'ota_img') return;
    verdict[r.type] = r.ok === 1 ? 'ok' : 'refused';
    status(r.type === 'ota_fw' ? 'fw' : 'img', r.ok === 1 ? 'ps_system_status_ok' : 'ps_system_status_refused');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  PS.on('state', function (ev) { render(ev.state); });
})();
