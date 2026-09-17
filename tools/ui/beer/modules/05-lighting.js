/* =====================================================================
   PandaStatusOS web UI — LIGHTING
   ---------------------------------------------------------------------
   The bar, and nothing else. This device's model is small and the page
   is small with it:

     settings.current_mode      0 Music, 1 H2D
     settings.list2[mode]       { brightness, rgb_rgba: [c0, c1, c2] }
     block.blocklist[]          { blockID, blockrgba }

   Outbound, all under the settings root, which core.js stamps with
   device_wakeup on the way out (ps_state.c:269-272):

     rgb_info_mode              select the mode
     rgb_info_brightness        0..100, live in both modes
     rgb_info_speed             0..100, stored per mode
     rgb_rgba + rgb_state_index one of the three state colours, and
                                rgb_info_mode to aim it at the other mode
     rgb_reset                  the light defaults, H2D only

   Two things here are the device's behaviour and not decisions made by
   this page. Speed is live in H2D only, and rgb_reset is refused in
   Music (ps_state.c apply_settings). Both are read off the model rather
   than hardcoded as a rule about what the user may do.

   Wired by id at load. No inline handlers. ===================== */

(function () {
  'use strict';

  var MUSIC = 0, H2D = 1;

  function mode_now() {
    var s = g_state.settings || {};
    return isNum(s.current_mode) ? s.current_mode : MUSIC;
  }

  function slot(m) {
    var s = g_state.settings || {};
    var l = Array.isArray(s.list2) ? s.list2 : [];
    return l[m] || {};
  }

  /* The device emits index 0 bare RRGGBB and index 1 as #RRGGBBAA, and a
     clone reproduces both rather than normalising either. For painting a
     swatch we only need something CSS accepts, so the alpha is dropped
     here and nowhere else: the value sent back is built from the picker,
     not from what the swatch is showing. */
  function css_colour(w) {
    if (typeof w !== 'string' || !w) return '';
    var hex = w.charAt(0) === '#' ? w.slice(1) : w;
    return hex.length >= 6 ? '#' + hex.slice(0, 6) : '';
  }

  function send(members) { ws_push('settings', members); }

  /* ---- mode ---------------------------------------------------- */

  function paint_mode(m) {
    var pairs = [['ps-mode-music', MUSIC], ['ps-mode-h2d', H2D]];
    for (var i = 0; i < pairs.length; i++) {
      var el = byId(pairs[i][0]);
      if (!el) continue;
      var on = pairs[i][1] === m;
      el.classList.toggle('is-active', on);
      el.classList.toggle('fill', on);
      el.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  /* ---- sliders ------------------------------------------------- */

  function paint_slider(id, val, live) {
    var el = byId(id), out = byId(id + '-value');
    /* A value the device has not reported is not zero. root_settings emits brightness but
       not speed ("speed is stored, not emitted": the observed push had no speed key), so
       painting a missing speed as 0 puts a number on screen that nothing said. The handle
       is left where it is and the reading stays blank until the device does say. */
    var known = isNum(val);
    if (el && known && document.activeElement !== el) el.value = val;
    if (el) el.disabled = !live;
    if (out) out.textContent = known ? fmtPct(val) : DASH;
    var card = byId(id === 'ps-speed' ? 'ps-speed-card' : null);
    if (card) card.classList.toggle('is-inert', !live);
  }

  /* ---- the three state colours --------------------------------- */

  /* The same three colours appear twice: on the Lighting page and on the last step of
     setup, where they are the first thing a new owner picks. One painter, one sender,
     two sets of ids, so the two can never drift apart. */
  var SWATCH_HOSTS = ['ps-col-', 'ps-setup-col-'];

  function paint_swatches(m) {
    var cols = slot(m).rgb_rgba;
    for (var h = 0; h < SWATCH_HOSTS.length; h++) {
      for (var i = 0; i < 3; i++) {
        var b = byId(SWATCH_HOSTS[h] + i);
        if (!b) continue;
        var c = Array.isArray(cols) ? css_colour(cols[i]) : '';
        b.style.background = c || '';
        b.classList.toggle('is-unset', !c);
      }
    }
  }

  /* ---- blocks --------------------------------------------------- */

  function paint_blocks() {
    var card = byId('ps-block-card'), list = byId('ps-block-list');
    if (!card || !list) return;
    var b = g_state.block || {};
    var rows = Array.isArray(b.blocklist) ? b.blocklist : [];
    card.hidden = rows.length === 0;
    if (!rows.length) { list.textContent = ''; return; }
    /* Rebuilt only when the set of ids changes. Repainting the whole list on
       every push would take the picker's own swatch out from under it. */
    var sig = rows.map(function (r) { return r.blockID; }).join(',');
    if (list.dataset.sig !== sig) {
      list.textContent = '';
      rows.forEach(function (r, i) {
        var nav = document.createElement('nav');
        nav.className = 'swatch-row';
        var lab = document.createElement('span');
        lab.className = 'max small-text';
        lab.id = 'lbl-block-' + r.blockID;
        /* The device's block id is its own bookkeeping and starts at zero, so "Lights 0" was
           the raw id leaking onto the page. A numbered list a person reads starts at one,
           and a single segment needs no label at all: the card is already called Lights,
           and repeating it beside the only swatch just said "Lights Lights". */
        lab.textContent = rows.length === 1 ? '' : tr('ui_lights', 'Lights') + ' ' + (i + 1);
        var wrap = document.createElement('div');
        wrap.className = 'swatch-slot';
        var btn = document.createElement('button');
        btn.className = 'swatch responsive small-round';
        btn.id = 'ps-block-' + r.blockID;
        btn.setAttribute('aria-labelledby', lab.id);
        btn.dataset.blockId = r.blockID;
        wrap.appendChild(btn);
        nav.appendChild(lab);
        nav.appendChild(wrap);
        list.appendChild(nav);
      });
      list.dataset.sig = sig;
    }
    rows.forEach(function (r) {
      var btn = byId('ps-block-' + r.blockID);
      if (!btn) return;
      var c = css_colour(r.blockrgba);
      btn.style.background = c || '';
      btn.classList.toggle('is-unset', !c);
    });
  }

  /* ---- the whole page, from the model -------------------------- */

  function render_lighting() {
    var m = mode_now(), s = slot(m);
    paint_mode(m);
    paint_slider('ps-brightness', s.brightness, true);
    /* Speed is stored for both modes and live only in H2D: the factory page's
       slider is disabled in Music, and the device is the authority on that. */
    paint_slider('ps-speed', s.speed, m === H2D);
    paint_swatches(m);
    paint_blocks();
    var rst = byId('ps-lights-reset');
    if (rst) rst.disabled = m !== H2D;   /* apply_settings refuses it in Music */
  }
  window.render_lighting = render_lighting;

  /* ---- wiring --------------------------------------------------- */

  function on_slider(id, key) {
    var el = byId(id);
    if (!el) return;
    var out = byId(id + '-value');
    el.addEventListener('input', function () {
      if (out) out.textContent = fmtPct(Number(el.value));
    });
    el.addEventListener('change', function () {
      var body = {};
      body[key] = Number(el.value);
      send(body);
    });
  }

  function wire() {
    var mm = byId('ps-mode-music'), mh = byId('ps-mode-h2d');
    if (mm) mm.addEventListener('click', function () { send({ rgb_info_mode: MUSIC }); });
    if (mh) mh.addEventListener('click', function () { send({ rgb_info_mode: H2D }); });

    on_slider('ps-brightness', 'rgb_info_brightness');
    on_slider('ps-speed', 'rgb_info_speed');

    for (var h = 0; h < SWATCH_HOSTS.length; h++) {
      for (var i = 0; i < 3; i++) {
        (function (host, idx) {
          var b = byId(host + idx);
          if (!b) return;
          b.addEventListener('click', function () {
            picker_open(b, function (hex) {
              send({ rgb_rgba: hex, rgb_state_index: idx, rgb_info_mode: mode_now() });
            });
          });
        })(SWATCH_HOSTS[h], i);
      }
    }

    var list = byId('ps-block-list');
    if (list) list.addEventListener('click', function (ev) {
      var btn = ev.target.closest && ev.target.closest('button[data-block-id]');
      if (!btn) return;
      picker_open(btn, function (hex) {
        ws_push('block', { blockID: Number(btn.dataset.blockId), blockrgba: hex });
      });
    });

    var rst = byId('ps-lights-reset');
    if (rst) rst.addEventListener('click', function () {
      if (mode_now() !== H2D) return;
      send({ rgb_reset: 1 });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
