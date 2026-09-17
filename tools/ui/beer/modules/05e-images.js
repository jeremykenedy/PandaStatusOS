/* =====================================================================
   PandaStatusOS web UI — STAGE IMAGES
   ---------------------------------------------------------------------
   One GIF per print stage, uploaded to the device's images partition.

       GET  /api/info    { ..., image_slot_bytes }
       POST /ota         OTA-Type: <slot name>
                         Content-Type: application/octet-stream;charset=UTF-8
                         body: the file, byte for byte

   The device answers on the socket, not in the HTTP reply:

       { "response": { "type":"ota_img", "ok":1, "gif":"<slot>" } }

   so a slot is not marked accepted until that frame arrives naming it.

   image_slot_bytes is the whole reason this card exists in this shape. The
   stock partition table read out of this unit carries nvs, otadata, two app
   slots and a coredump, and nothing else: there is no images partition on it,
   the device reports zero, and the card says so rather than offering fifteen
   file choosers whose every upload the firmware would refuse. On a unit that
   does have one, the same number is the per slot cap and the card works.
   ================================================================= */

(function () {
  'use strict';

  /* The firmware's ps_gif_slot_names, in its order: the OTA-Type header is one
     of these strings exactly, so this list is a contract, not a tidy-able list. */
  var SLOTS = ['standby', 'nozzle_heating', 'bed_heating', 'bed_leveling', 'homing',
               'nozzle_cleaning', 'calibrating_flow', 'xy_mesh_mode_sweep',
               'filament_check_location', 'filament_cut', 'filament_pull_back_cur',
               'filament_push_new', 'filament_purge_old', 'printing_ok', 'printing'];

  var g_cap = null;        /* bytes per slot, as the device reports them */
  var g_urls = {};         /* slot -> object URL, so a preview can be revoked */
  /* slot -> still waiting for the socket's verdict. The device answers on the socket, and
     that answer can land BEFORE the HTTP request completes: the firmware pushes the frame
     and then ends the response. Without this the later onload would paint "sent" over an
     answer that had already arrived. */
  var g_waiting = {};

  function slot_id(slot) { return slot.replace(/_/g, '-'); }
  function label_of(slot) { return tr('ui_stage_' + slot, slot.replace(/_/g, ' ')); }

  function human(n) {
    if (!isNum(n) || n <= 0) return '0';
    if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function status(slot, key, fallback, extra) {
    var el = byId('ps-img-status-' + slot_id(slot));
    if (!el) return;
    /* The key rides with the text so a language switch re-renders it rather
       than leaving one line in the language it was written in. */
    if (!key) { el.textContent = ''; el.removeAttribute('data-str'); return; }
    var t = tr(key, fallback);
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) t = t.replace('{' + k + '}', extra[k]);
    el.textContent = t;
    if (extra) el.removeAttribute('data-str'); else el.setAttribute('data-str', key);
  }

  function progress(slot, pct) {
    var el = byId('ps-img-progress-' + slot_id(slot));
    if (!el) return;
    if (pct === null) { el.hidden = true; el.removeAttribute('value'); return; }
    el.hidden = false;
    el.value = pct;
  }

  /* ---- the upload ----------------------------------------------- */

  function upload(slot, file) {
    if (!file) return;
    if (isNum(g_cap) && g_cap > 0 && file.size > g_cap) {
      status(slot, 'ui_too_big', 'Too big. The limit is {limit}.', { limit: human(g_cap) });
      progress(slot, null);
      return;
    }
    var img = byId('ps-img-preview-' + slot_id(slot));
    if (img) {
      if (g_urls[slot]) { try { URL.revokeObjectURL(g_urls[slot]); } catch (e) {} }
      g_urls[slot] = URL.createObjectURL(file);
      img.src = g_urls[slot];
      img.hidden = false;
    }
    status(slot, 'ui_uploading', 'Uploading');
    progress(slot, 0);
    g_waiting[slot] = true;

    var x = new XMLHttpRequest();
    x.open('POST', '/ota', true);
    x.setRequestHeader('OTA-Type', slot);
    x.setRequestHeader('Content-Type', 'application/octet-stream;charset=UTF-8');
    if (x.upload) x.upload.onprogress = function (e) {
      if (e.lengthComputable) progress(slot, Math.round((e.loaded / e.total) * 100));
    };
    x.onload = function () {
      progress(slot, null);
      /* A 200 means the bytes arrived. Whether they were kept is the socket's answer, so
         the line stays on "sent" until that frame names this slot -- unless it already
         came, in which case its verdict stands and nothing here overwrites it. */
      if (!g_waiting[slot]) return;
      if (x.status === 200) status(slot, 'ui_upload_sent', 'Sent. Waiting for the device to check it');
      else { g_waiting[slot] = false; status(slot, 'ui_upload_failed', 'Refused by the device'); }
    };
    x.onerror = function () { progress(slot, null); g_waiting[slot] = false; status(slot, 'ui_upload_failed', 'Refused by the device'); };
    try { x.send(file); } catch (e) { progress(slot, null); g_waiting[slot] = false; status(slot, 'ui_upload_failed', 'Refused by the device'); }
  }

  /* core.js routes the socket's response frames and hands this one over by
     name: ota_img carries the slot in "gif". */
  window.on_ota_img = function (slot, ok) {
    if (typeof slot !== 'string' || SLOTS.indexOf(slot) < 0) return;
    g_waiting[slot] = false;
    progress(slot, null);
    status(slot, ok ? 'ui_upload_ok' : 'ui_upload_failed', ok ? 'Accepted' : 'Refused by the device');
  };

  /* ---- painting -------------------------------------------------- */

  function build_rows() {
    var list = byId('ps-img-list');
    if (!list || list.dataset.built === '1') return;
    list.textContent = '';
    SLOTS.forEach(function (slot) {
      var sid = slot_id(slot);
      var row = document.createElement('li');
      row.id = 'ps-img-slot-' + sid;

      var img = document.createElement('img');
      img.id = 'ps-img-preview-' + sid;
      img.className = 'circle small';
      img.alt = '';
      img.hidden = true;

      var text = document.createElement('div');
      text.className = 'max';
      text.id = 'lbl-img-' + sid;
      text.textContent = label_of(slot);
      var st = document.createElement('div');
      st.className = 'small-text';
      st.id = 'ps-img-status-' + sid;
      var pr = document.createElement('progress');
      pr.id = 'ps-img-progress-' + sid;
      pr.max = 100;
      pr.hidden = true;
      text.appendChild(document.createElement('br'));
      text.appendChild(st);
      text.appendChild(pr);

      /* Beer dresses a file input by wrapping it in a button: the input stays
         the thing that is clicked, so no click is synthesised anywhere. */
      var btn = document.createElement('button');
      btn.className = 'border small-round';
      var span = document.createElement('span');
      span.textContent = tr('ui_choose_a_gif', 'Choose a GIF');
      var file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/gif';
      file.id = 'ps-img-file-' + sid;
      file.setAttribute('aria-labelledby', text.id);
      file.addEventListener('change', function () {
        var f = file.files && file.files[0];
        file.value = '';
        upload(slot, f);
      });
      btn.appendChild(span);
      btn.appendChild(file);

      row.appendChild(img);
      row.appendChild(text);
      row.appendChild(btn);
      list.appendChild(row);
    });
    list.dataset.built = '1';
  }

  function render_images() {
    var card = byId('ps-img-card');
    if (!card) return;
    if (g_cap === null) { card.hidden = true; return; }

    /* Zero is an answer, not a failure: the card appears and explains itself,
       because a person who went looking for this deserves to be told why it
       is not here rather than to find nothing. */
    var note = byId('ps-img-note');
    card.hidden = false;
    if (g_cap <= 0) {
      if (note) { note.textContent = tr('ui_no_image_storage', 'This unit has no image partition, so there is nowhere on it to put a stage image.'); note.setAttribute('data-str', 'ui_no_image_storage'); }
      var list = byId('ps-img-list');
      if (list) { list.textContent = ''; list.dataset.built = ''; list.hidden = true; }
      return;
    }
    if (note) { note.textContent = ''; note.removeAttribute('data-str'); }
    var list2 = byId('ps-img-list');
    if (list2) list2.hidden = false;
    build_rows();
  }
  window.render_images = render_images;

  function refresh() {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/info', true);
    x.timeout = 5000;
    x.onload = function () {
      if (x.status !== 200) return;
      var d = null;
      try { d = JSON.parse(x.responseText); } catch (e) { return; }
      /* A device that does not carry the field is not a device with zero
         slots: it is a device that was never asked. Leave the card away. */
      if (!d || !isNum(d.image_slot_bytes)) return;
      g_cap = d.image_slot_bytes;
      render_images();
    };
    try { x.send(); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
})();
