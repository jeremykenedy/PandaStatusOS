'use strict';
/* Images: the fifteen print-stage animation slots. Facts from docs/protocol-websocket.md:
   - an upload is POST /ota, Content-Type application/octet-stream;charset=UTF-8, the
     OTA-Type header naming the target slot, the file as the body
   - the per-slot maximum is 0x180000 bytes. The factory UI compares the chosen file's size
     against it before sending and names the limit in megabytes when it refuses; so does this
   - the device answers over the socket with response {type:"ota_img", ok, gif:<slot>}. The
     gif member is what the browser handles inbound; that the device fills it is the mock's
     INFERENCE until the bench confirms it
   - there is no route that serves a slot's current animation, so a preview can only be the
     file chosen in this browser
   - ws_theme {preview, list:[{gif, rgba}]} is inbound only, never sent by the browser, and
     has not been seen on the wire. Rendered when present, absent otherwise
   The verdict order matters: the device's answer arrives on the socket before the HTTP
   status does on the mock, so a device verdict, once shown, is not overwritten by the HTTP
   failure that follows it. */

(function () {
  var CAP = 0x180000;                                   // 1,572,864 bytes, the per-slot maximum
  var $ = function (id) { return document.getElementById(id); };
  var urls = {};                                        // slot -> object URL of the chosen file
  var verdict = {};                                     // slot -> the device's last answer

  function idOf(slot) { return String(slot).replace(/_/g, '-'); }
  function mb(n) { return (n / 1048576).toFixed(1) + ' MB'; }
  function status(slot, key, fill) {
    var el = $('ps-images-status-' + idOf(slot)); if (!el) return;
    el.setAttribute('data-ps-str', key);
    var text = PS.tr(key);
    if (fill) Object.keys(fill).forEach(function (k) { text = text.replace('{' + k + '}', fill[k]); });
    el.textContent = text;
  }
  function preview(slot, file) {
    var box = $('ps-images-preview-' + idOf(slot)), img = box.querySelector('img');
    if (urls[slot]) URL.revokeObjectURL(urls[slot]);
    urls[slot] = URL.createObjectURL(file);
    img.onerror = function () { img.hidden = true; box.classList.remove('ps-images-preview-set'); };   // not an image: the glyph stays
    img.src = urls[slot]; img.hidden = false; box.classList.add('ps-images-preview-set');
  }

  function upload(slot, file) {
    if (file.size > CAP) { status(slot, 'ps_images_status_too_big', { limit: mb(CAP) }); return; }   // parity: refused before any request
    preview(slot, file);
    verdict[slot] = null;
    var prog = $('ps-images-progress-' + idOf(slot)); prog.value = 0; prog.hidden = false;
    status(slot, 'ps_images_status_sending');
    var xhr = new XMLHttpRequest();
    xhr.open('POST', '/ota', true);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream;charset=UTF-8');
    xhr.setRequestHeader('OTA-Type', slot);
    xhr.upload.onprogress = function (e) { if (e.lengthComputable) prog.value = Math.round(100 * e.loaded / e.total); };
    xhr.onload = function () {
      prog.hidden = true;
      if (verdict[slot]) return;                        // the device already answered on the socket
      if (xhr.status === 200) status(slot, 'ps_images_status_sent');
      else status(slot, 'ps_images_status_failed', { code: String(xhr.status) });
    };
    xhr.onerror = function () { prog.hidden = true; if (!verdict[slot]) status(slot, 'ps_images_status_failed', { code: '0' }); };
    xhr.send(file);
  }

  function render(s) {
    var set = s.settings || {}, v = set.img_version, el = $('ps-images-version');
    if (v !== undefined && v !== null && v !== '') { el.textContent = String(v); el.classList.remove('ps-unset'); }
    else { el.textContent = '—'; el.classList.add('ps-unset'); }

    var th = s.ws_theme;
    var showing = $('ps-images-showing');
    if (th && typeof th.preview === 'string') {
      var tile = document.querySelector('[data-ps-slot="' + th.preview + '"]');
      var name = tile ? tile.querySelector('.ps-images-name').textContent : th.preview;
      showing.textContent = PS.tr('ps_images_showing') + ' ' + name; showing.hidden = false;
      document.querySelectorAll('.ps-images-slot').forEach(function (t) { t.classList.toggle('ps-images-slot-showing', t.getAttribute('data-ps-slot') === th.preview); });
    }
    if (th && Array.isArray(th.list)) {
      th.list.forEach(function (e) {
        if (!e || typeof e.gif !== 'string') return;
        var dot = $('ps-images-dot-' + idOf(e.gif)); if (!dot) return;
        var h = String(e.rgba || '').replace('#', '');
        if (h.length >= 6) { dot.style.background = '#' + h.slice(0, 8); dot.hidden = false; }
      });
    }
  }

  function wire() {
    document.querySelectorAll('[data-ps-upload]').forEach(function (inp) {
      var slot = inp.getAttribute('data-ps-upload');
      var title = inp.closest('.ps-images-slot').querySelector('.ps-images-name');
      inp.setAttribute('aria-label', PS.tr('ps_images_choose') + ': ' + title.textContent);
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        inp.value = '';                                 // choosing the same file again must fire again
        if (f) upload(slot, f);
      });
    });
  }

  PS.on('response', function (r) {
    if (r.type !== 'ota_img' || typeof r.gif !== 'string') return;
    verdict[r.gif] = r.ok === 1 ? 'ok' : 'refused';
    status(r.gif, r.ok === 1 ? 'ps_images_status_ok' : 'ps_images_status_refused');
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  PS.on('state', function (ev) { render(ev.state); });
})();
