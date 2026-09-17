/* =====================================================================
   PandaVentOS web UI — MODULE 6: Settings card inbound + the first-use
   language page
   ---------------------------------------------------------------------
   Written from private/SPEC/handler-contract.md §5.2 (every row of the
   Settings card), §0.6 (which answers module 1 turns into a dialog or a
   toast — this module only sends), §0.4 landing and the last sentence of
   §7.1 (module 1 lands a device with no saved network on
   ps-page-language; this module owns what happens ON that page), §0.1
   (the firmware upload is POST /ota with header OTA-Type: ota_fw and the
   raw image as body) and §12 (one single-key message per action, never
   write a focused input); private/SPEC/websocket-protocol.md §1, §5,
   §7.5 (`settings`: language / reset / factory_reset / device_name) and
   §9. Note and dialog text is written in my own words from
   docs/network.md ("Device name") and docs/backup.md ("What survives
   what").

   Written from private/SPEC and Jeremy's markup/CSS/harnesses; no
   vendor source opened.

   This module SENDS. Module 1 (core.js) owns the socket, the merged
   state, every device-push render and every response dialog/toast. It is
   reached only through ws_push, tr, set_language, show_page,
   dialog_open, toast_show and the read-only g_language.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. The language list, derived from the string tables themselves
   ---------------------------------------------------------------------
   Every table carries language_name: its own name, in its own script. So the
   menu is built from the tables that ship, and adding a language is adding a
   file rather than adding a file and remembering to edit a list beside it.

   It also keeps every endonym out of the source and the markup, which matters
   here for a second reason: this repository's residue check treats CJK in
   source text as a fingerprint of copied material, and a hardcoded menu of
   language names is CJK in source text. The tables are the one place it is
   expected, and they are the one place it now appears.
   ------------------------------------------------------------------- */

var PS_LANGUAGES = (function () {
  var codes = (typeof PS_STRING_LANGS !== 'undefined' && PS_STRING_LANGS) || ['en'];
  var out = [];
  for (var i = 0; i < codes.length; i++) {
    var c = codes[i];
    var t = (typeof PS_STRINGS !== 'undefined' && PS_STRINGS[c]) || {};
    out.push({ code: c, name: t.language_name || c });
  }
  return out;
})();

var S6_SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------------------------------------------------------------------
   1. Small helpers of this module's own
   ------------------------------------------------------------------- */

function s6_el(id) { return document.getElementById(id); }

function s6_set_text(node, text) {
  if (node) node.textContent = (text === null || text === undefined) ? '' : String(text);
}

function s6_lang_known(code) {
  for (var i = 0; i < PS_LANGUAGES.length; i++) {
    if (PS_LANGUAGES[i].code === code) return true;
  }
  return false;
}

/* The language module 1 is currently speaking (it restores the stored
   preference at boot and follows settings.language on every push). */
function s6_current_language() {
  return (typeof g_language === 'string' && g_language) ? g_language : 'en';
}

/* dialog_open() takes translation keys only, so the English fallback the
   brief requires for every string is written in afterwards through tr():
   the dialog then never shows a raw key while the table is catching up. */
function s6_dialog(titleKey, titleEn, textKey, textEn, btns) {
  dialog_open(titleKey, textKey, btns);
  s6_set_text(s6_el('ps-dialog-title'), tr(titleKey, titleEn));
  s6_set_text(s6_el('ps-dialog-text'), tr(textKey, textEn));
}

/* Same for the toast: toast_show() looks the key up with itself as the
   fallback. */
function s6_toast(key, en, ms) {
  toast_show(key, ms);
  s6_set_text(s6_el('ps-toast'), tr(key, en));
}

/* Beer's list-row tick: <svg class="i"><use href="#i-check"/></svg>, the
   mark the markup puts on the chosen language row and nowhere else. */
function s6_tick_node() {
  var svg = document.createElementNS(S6_SVG_NS, 'svg');
  svg.setAttribute('class', 'i');
  svg.setAttribute('aria-hidden', 'true');
  var use = document.createElementNS(S6_SVG_NS, 'use');
  use.setAttribute('href', '#i-check');
  svg.appendChild(use);
  return svg;
}

/* ---------------------------------------------------------------------
   2. The two language controls: the Settings select and the setup list
   ------------------------------------------------------------------- */

/* The select in pages/settings.html ships with four placeholder options
   and no values; it is rebuilt with one valued option per language. The
   option text is the language's own name and is deliberately not run
   through the translator. */
function s6_build_language_select() {
  var sel = s6_el('ps-settings-lang');
  if (!sel) return;
  sel.innerHTML = '';
  for (var i = 0; i < PS_LANGUAGES.length; i++) {
    var opt = document.createElement('option');
    opt.value = PS_LANGUAGES[i].code;
    opt.textContent = PS_LANGUAGES[i].name;
    opt.setAttribute('lang', PS_LANGUAGES[i].code);
    sel.appendChild(opt);
  }
}

/* One Beer list row per language on ps-page-language, in the shape the
   markup draws: <li class="wave"><div class="max">Name</div>[tick]</li>.
   Rows are keyboard-reachable radios; the tick sits on the chosen one. */
function s6_build_language_list() {
  var host = s6_el('ps-language-buttons');
  if (!host) return;
  host.innerHTML = '';
  host.setAttribute('role', 'radiogroup');
  for (var i = 0; i < PS_LANGUAGES.length; i++) {
    var li = document.createElement('li');
    li.className = 'wave';
    li.setAttribute('role', 'radio');
    li.setAttribute('tabindex', '0');
    li.setAttribute('aria-checked', 'false');
    li.setAttribute('data-pv-lang', PS_LANGUAGES[i].code);
    li.setAttribute('lang', PS_LANGUAGES[i].code);
    var name = document.createElement('div');
    name.className = 'max';
    name.textContent = PS_LANGUAGES[i].name;
    li.appendChild(name);
    host.appendChild(li);
  }
}

/* Mark `code` as the chosen language on both controls. The select is left
   alone while it has focus (§12); the list moves its tick and aria state. */
function s6_mark_language(code) {
  var sel = s6_el('ps-settings-lang');
  if (sel && s6_lang_known(code) && document.activeElement !== sel && sel.value !== code) {
    sel.value = code;
  }
  var host = s6_el('ps-language-buttons');
  if (host) {
    var rows = host.querySelectorAll('[data-pv-lang]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var on = (row.getAttribute('data-pv-lang') === code);
      row.setAttribute('aria-checked', on ? 'true' : 'false');
      var tick = row.querySelector('svg');
      if (on && !tick) row.appendChild(s6_tick_node());
      else if (!on && tick) row.removeChild(tick);
    }
  }
}

/* Bring both controls in line with the language module 1 is speaking.
   Called at boot, after every pick of our own, and whenever the Settings
   card or the language page is shown (see the observer in init). */
function settings_language_sync() {
  s6_mark_language(s6_current_language());
}

/* A pick from either control: re-translate the page now (module 1), mark
   the choice, and tell the device (§5.2: {"settings":{"language":code}}).
   The device saves silently; there is no response or push to wait for. */
function s6_pick_language(code) {
  if (!s6_lang_known(code)) return;
  set_language(code);
  s6_mark_language(code);
  ws_push('settings', { language: code });
}

/* ---------------------------------------------------------------------
   3. Device name (§5.2)
   ------------------------------------------------------------------- */

function s6_device_name_save() {
  var input = s6_el('ps-settings-device-name');
  if (!input) return;
  ws_push('settings', { device_name: input.value });
}

/* An empty string tells the device to restore its compiled default, so the
   page does not have to know what that name is (P§7.5). */
function s6_device_name_reset() {
  ws_push('settings', { device_name: '' });
}

function s6_note_device_name() {
  s6_dialog('device_name', 'Device name',
    'ui_note_device_name_text',
    'This is what the page calls the vent, in the corner of the bar above. It is separate from the hostname, which is what the network calls it. Handy when you have two.',
    [{ key: 'ui_ok', fallback: 'OK' }]);
}

/* ---------------------------------------------------------------------
   4. Restart and factory reset (§5.2): confirm first, then one message
   ------------------------------------------------------------------- */

function s6_confirm_restart() {
  s6_dialog('ui_restart_title', 'Restart the vent?',
    'ui_restart_text',
    'It drops off the network for a few seconds while it reboots. Nothing is erased.',
    [
      { key: 'cancel', fallback: 'Cancel' },
      { key: 'restart', fallback: 'Restart', handler: function () {
        ws_push('settings', { reset: 1 });
      } }
    ]);
}

function s6_confirm_factory() {
  s6_dialog('ui_factory_title', 'Erase everything?',
    'ui_factory_text',
    'A factory reset clears the Wi-Fi credentials, the printer binding, the language and every light setting, and drops any uploaded animation. The vent reboots and has to be set up again. It cannot be undone from here.',
    [
      { key: 'cancel', fallback: 'Cancel' },
      { key: 'factory_reset', fallback: 'Factory reset', handler: function () {
        ws_push('settings', { factory_reset: 1 });
      } }
    ]);
}

/* ---------------------------------------------------------------------
   5. Firmware upload (§0.1, §5.2): POST /ota over plain HTTP
   ------------------------------------------------------------------- */

var g6_ota_busy = false;

function s6_ota_choose() {
  if (g6_ota_busy) return;
  var input = s6_el('ps-file-input');
  if (input) input.click();
}

function s6_ota_file_chosen() {
  var input = s6_el('ps-file-input');
  if (!input) return;
  var file = (input.files && input.files.length) ? input.files[0] : null;
  input.value = '';   /* so choosing the same file again still fires change */
  if (!file) return;
  s6_ota_upload(file);
}

/* The upload's own progress drives the two spans; the WebSocket only ever
   delivers the final ota_fw response, which is module 1's to show (§5.2).
   Module 1 clears the progress span on that response; the button is ours
   to lock while the bytes are leaving. */
function s6_ota_upload(file) {
  var btn = s6_el('ps-btn-ota-fw');
  var prog = s6_el('ps-span-progress-ota-fw');
  var stat = s6_el('ps-span-status-ota-fw');
  var xhr;
  try { xhr = new XMLHttpRequest(); } catch (e) { return; }

  g6_ota_busy = true;
  if (btn) btn.disabled = true;
  s6_set_text(stat, tr('ui_uploading', 'Uploading'));
  s6_set_text(prog, '0%');

  function failed() {
    s6_set_text(prog, '');
    s6_set_text(stat, tr('ui_choose_a_bin_file', 'Choose a .bin file'));
    s6_toast('ui_upload_failed', 'The upload did not reach the vent.', 4000);
  }

  if (xhr.upload) {
    xhr.upload.addEventListener('progress', function (e) {
      if (e.lengthComputable && e.total > 0) {
        s6_set_text(prog, Math.round((e.loaded * 100) / e.total) + '%');
      }
    });
  }
  xhr.addEventListener('load', function () {
    if (xhr.status >= 200 && xhr.status < 300) {
      s6_set_text(prog, '100%');
      s6_set_text(stat, tr('ui_upload_sent', 'Sent. Waiting for the vent to check it'));
    } else {
      failed();
    }
  });
  xhr.addEventListener('error', failed);
  xhr.addEventListener('abort', failed);
  xhr.addEventListener('timeout', failed);
  xhr.addEventListener('loadend', function () {
    g6_ota_busy = false;
    if (btn) btn.disabled = false;
  });

  xhr.open('POST', '/ota', true);
  xhr.setRequestHeader('OTA-Type', 'ota_fw');
  xhr.send(file);
}

/* ---------------------------------------------------------------------
   6. Wiring
   ------------------------------------------------------------------- */

function s6_on(id, ev, fn) {
  var node = s6_el(id);
  if (node) node.addEventListener(ev, fn);
}

function s6_wire_language() {
  var sel = s6_el('ps-settings-lang');
  if (sel) {
    sel.addEventListener('change', function () { s6_pick_language(sel.value); });
  }

  var host = s6_el('ps-language-buttons');
  if (host) {
    /* Delegated: the rows are rebuilt by this module, so the stable host
       carries the listeners. */
    host.addEventListener('click', function (e) {
      var row = e.target.closest ? e.target.closest('[data-pv-lang]') : null;
      if (row && host.contains(row)) s6_pick_language(row.getAttribute('data-pv-lang'));
    });
    host.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      var row = e.target.closest ? e.target.closest('[data-pv-lang]') : null;
      if (row && host.contains(row)) {
        e.preventDefault();
        s6_pick_language(row.getAttribute('data-pv-lang'));
      }
    });
  }

  /* Next: send the chosen language and move on to the Wi-Fi page. */
  s6_on('ps-btn-lang-next', 'click', function () {
    ws_push('settings', { language: s6_current_language() });
    show_page('ps-page-wifi');
  });
}

/* Module 1 shows a card or a setup page by toggling `.active` on it
   (app.css). When the Settings card or the language page comes into view,
   re-read the language module 1 is speaking, so a settings.language that
   arrived in a push is what the controls show. The callback never sends. */
function s6_watch_shown(id) {
  var node = s6_el(id);
  if (!node || typeof MutationObserver !== 'function') return;
  var obs = new MutationObserver(function () {
    if (node.classList.contains('active')) settings_language_sync();
  });
  obs.observe(node, { attributes: true, attributeFilter: ['class'] });
}

function settings_init() {
  s6_build_language_select();
  s6_build_language_list();
  settings_language_sync();
  s6_wire_language();
  s6_watch_shown('ps-card-settings');
  s6_watch_shown('ps-page-language');

  s6_on('ps-btn-device-name-set', 'click', s6_device_name_save);
  s6_on('ps-btn-device-name-reset', 'click', s6_device_name_reset);
  s6_on('ps-note-device-name', 'click', s6_note_device_name);

  s6_on('ps-btn-restart', 'click', s6_confirm_restart);
  s6_on('ps-btn-factory', 'click', s6_confirm_factory);

  s6_on('ps-btn-ota-fw', 'click', s6_ota_choose);
  s6_on('ps-file-input', 'change', s6_ota_file_chosen);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', settings_init);
} else {
  settings_init();
}

window.settings_language_sync = settings_language_sync;
