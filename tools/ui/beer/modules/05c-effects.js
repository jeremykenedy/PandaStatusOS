/* =====================================================================
   PandaStatusOS web UI — PER STATE EFFECTS
   ---------------------------------------------------------------------
   Everything beyond parity, and every bit of it off on a new device.

       GET  /api/features   { features:{...19 bits...},
                              config:{ state_brightness:[[3],[3]],
                                       state_effects:[ fx, fx, fx ] } }
       POST /api/features   { features:{...} } and/or { config:{...} },
                            applied whole or refused whole, answering with
                            the same document GET returns.

   One fx is:
       { effect, brightness, speed, bright_end, opt, aux, colours[4] }

   colours, as ps_fx.c reads them:
       [0]  the primary
       [1]  the second, for the effects that take one
       [2]  the background while printing   (opt 0x01 says it is set)
       [3]  the background while idle       (opt 0x02 says it is set)

   For the barber pole those first two are literally the two stripes: the
   renderer mixes between colour and bg per band, so "two progress colours"
   is the primary and the background, and aux is how wide each stripe is.
   The pole animates on its own (barber_pos advances every frame); there is
   no separate switch for that, and PS_FX_PROGRESS_ANIM is a different
   thing again, the plain bar with a chase and a breathing tip.

   opt bits, from ps.h:
       0x01 bg while printing set   0x02 bg while idle set   0x04 ramp set
       0x08 aux set                 0x10 run it backwards

   Which effects may be chosen is the device's answer, not ours: the
   seventeen that need no live input want only state_effects, and each of
   the ones that read the print waits for its own bit. That mapping is
   ps_fx_allowed() and it is mirrored here only to grey out what the
   device would refuse, never to allow anything it would not.
   ================================================================= */

(function () {
  'use strict';

  var FX_SELECTABLE = 17;
  var FX_NEEDS = { 17: 'fx_progress', 18: 'fx_progress_anim', 19: 'fx_barber',
                   20: 'fx_temp', 21: 'fx_hue_ramp', 22: 'presets', 23: 'presets' };
  var FX_COUNT = 24;

  var OPT_BG_PRINTING = 0x01, OPT_BG_IDLE = 0x02, OPT_RAMP = 0x04,
      OPT_AUX = 0x08, OPT_REVERSE = 0x10;

  /* The effects that read the print, and so the ones the band width and the
     background colours are for. */
  var READS_PRINT = { 17: 1, 18: 1, 19: 1, 21: 1 };

  var g_doc = null;     /* the last /api/features document */
  var g_state = 0;      /* which bar state is being edited: 0 idle, 1 printing, 2 error */

  function feats() { return (g_doc && g_doc.features) || {}; }

  function fx_of(i) {
    var c = (g_doc && g_doc.config) || {};
    var l = c.state_effects;
    return (Array.isArray(l) && l[i]) || null;
  }

  function fx_allowed(id) {
    if (id < FX_SELECTABLE) return !!feats().state_effects;
    return FX_NEEDS[id] ? !!feats()[FX_NEEDS[id]] : false;
  }

  function css_colour(w) {
    if (typeof w !== 'string' || !w) return '';
    var hex = w.charAt(0) === '#' ? w.slice(1) : w;
    return hex.length >= 6 ? '#' + hex.slice(0, 6) : '';
  }

  /* ---- talking to the device ----------------------------------- */

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

  /* The route applies a document whole or refuses it whole, so a change is
     sent as a change and the answer is the new truth. Nothing is assumed to
     have worked: the page renders what came back. */
  function post(body, after) {
    var x = new XMLHttpRequest();
    x.open('POST', '/api/features', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 6000;
    x.onload = function () {
      if (x.status === 200) {
        try { g_doc = JSON.parse(x.responseText); } catch (e) {}
        render_effects();
        if (after) after(true);
        return;
      }
      /* 400 means the whole document was refused, most often because an effect
         was chosen whose bit is off. Re-read rather than guess what stuck. */
      refresh(function () { if (after) after(false); });
    };
    x.onerror = function () { if (after) after(false); };
    x.ontimeout = function () { if (after) after(false); };
    try { x.send(JSON.stringify(body)); } catch (e) { if (after) after(false); }
  }

  function send_fx(patch) {
    var cur = fx_of(g_state);
    if (!cur) return;
    var rows = [];
    for (var i = 0; i < 3; i++) {
      var f = fx_of(i);
      rows.push(f ? JSON.parse(JSON.stringify(f)) : null);
    }
    if (!rows[g_state]) return;
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) rows[g_state][k] = patch[k];
    post({ config: { state_effects: rows } });
  }

  function set_opt(bit, on) {
    var f = fx_of(g_state);
    if (!f) return;
    var opt = f.opt || 0;
    send_fx({ opt: on ? (opt | bit) : (opt & ~bit) });
  }

  /* ---- painting ------------------------------------------------- */

  function fill_effect_list() {
    var sel = byId('ps-fx-effect');
    if (!sel) return;
    var want = String((fx_of(g_state) || {}).effect || 0);
    sel.innerHTML = '';
    for (var id = 0; id < FX_COUNT; id++) {
      var o = document.createElement('option');
      o.value = String(id);
      o.textContent = tr('ui_fx_' + id, 'Effect ' + id);
      /* An effect whose bit is off is shown and disabled rather than hidden:
         a list that changes length as switches move is a list nobody can learn. */
      if (!fx_allowed(id)) {
        o.disabled = true;
        o.textContent += ' — ' + tr('ui_needs_feature', 'Turned off. Switch it on under Features.');
      }
      sel.appendChild(o);
    }
    sel.value = want;
  }

  function paint_state_row() {
    for (var i = 0; i < 3; i++) {
      var b = byId('ps-fx-state-' + i);
      if (!b) continue;
      var on = i === g_state;
      b.classList.toggle('is-active', on);
      b.classList.toggle('fill', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
  }

  function paint_swatch(id, wire) {
    var b = byId(id);
    if (!b) return;
    var c = css_colour(wire);
    b.style.background = c || '';
    b.classList.toggle('is-unset', !c);
  }

  function render_effects() {
    var on = !!feats().state_effects;
    var card = byId('ps-fx-card');
    if (card) card.hidden = !on;
    if (!on) {
      ['ps-fxc-card', 'ps-fxb-card', 'ps-fxp-card'].forEach(function (id) {
        var el = byId(id); if (el) el.hidden = true;
      });
      return;
    }

    paint_state_row();
    fill_effect_list();

    var f = fx_of(g_state) || {};
    var id = f.effect || 0;
    var cols = Array.isArray(f.colours) ? f.colours : [];

    /* The colour card is for the effects that take colours, and the device only
       honours the backgrounds when effect_colours is on. */
    var cCard = byId('ps-fxc-card');
    if (cCard) cCard.hidden = !feats().effect_colours;
    paint_swatch('ps-fxc-0', cols[0]);
    paint_swatch('ps-fxc-2', cols[2]);
    paint_swatch('ps-fxc-3', cols[3]);

    /* The band width is the barber pole's and nothing else's. */
    var bCard = byId('ps-fxb-card');
    if (bCard) bCard.hidden = !(id === 19 && feats().effect_params);
    var band = byId('ps-fxb-band');
    if (band && document.activeElement !== band) band.value = isNum(f.aux) ? f.aux : 0;
    setText('ps-fxb-band-value', isNum(f.aux) && f.aux > 0 ? String(f.aux) : tr('ui_auto', 'Auto'));

    var pCard = byId('ps-fxp-card');
    if (pCard) pCard.hidden = !feats().effect_params;
    var sp = byId('ps-fxp-speed');
    if (sp && document.activeElement !== sp) sp.value = isNum(f.speed) ? f.speed : 100;
    setText('ps-fxp-speed-value', isNum(f.speed) ? fmtPct(f.speed) : '');
    var rev = byId('ps-fxp-reverse');
    if (rev) rev.checked = !!((f.opt || 0) & OPT_REVERSE);
  }
  window.render_effects = render_effects;

  function refresh(after) {
    get(function (doc) {
      if (doc) g_doc = doc;
      render_effects();
      if (after) after();
    });
  }
  window.refresh_features = refresh;

  /* ---- wiring --------------------------------------------------- */

  function wire() {
    for (var i = 0; i < 3; i++) {
      (function (n) {
        var b = byId('ps-fx-state-' + n);
        if (b) b.addEventListener('click', function () { g_state = n; render_effects(); });
      })(i);
    }

    var sel = byId('ps-fx-effect');
    if (sel) sel.addEventListener('change', function () {
      send_fx({ effect: Number(sel.value) });
    });

    [['ps-fxc-0', 0], ['ps-fxc-2', 2], ['ps-fxc-3', 3]].forEach(function (pair) {
      var b = byId(pair[0]);
      if (!b) return;
      b.addEventListener('click', function () {
        picker_open(b, function (hex) {
          var f = fx_of(g_state);
          if (!f) return;
          var cols = (Array.isArray(f.colours) ? f.colours.slice() : ['#FFFFFFFF', '#FFFFFFFF', '#000000FF', '#000000FF']);
          /* The route wants four, always, and the wire format carries alpha. */
          while (cols.length < 4) cols.push('#000000FF');
          cols[pair[1]] = hex + 'FF';
          var patch = { colours: cols };
          /* Setting a background means saying it is set: the renderer reads the
             opt bit, not the presence of a colour. */
          if (pair[1] === 2) patch.opt = (f.opt || 0) | OPT_BG_PRINTING;
          if (pair[1] === 3) patch.opt = (f.opt || 0) | OPT_BG_IDLE;
          send_fx(patch);
        });
      });
    });

    var band = byId('ps-fxb-band');
    if (band) {
      band.addEventListener('input', function () {
        setText('ps-fxb-band-value', Number(band.value) > 0 ? band.value : tr('ui_auto', 'Auto'));
      });
      band.addEventListener('change', function () {
        var v = Number(band.value);
        var f = fx_of(g_state) || {};
        var opt = f.opt || 0;
        send_fx({ aux: v, opt: v > 0 ? (opt | OPT_AUX) : (opt & ~OPT_AUX) });
      });
    }

    var sp = byId('ps-fxp-speed');
    if (sp) {
      sp.addEventListener('input', function () { setText('ps-fxp-speed-value', fmtPct(Number(sp.value))); });
      sp.addEventListener('change', function () { send_fx({ speed: Number(sp.value) }); });
    }

    var rev = byId('ps-fxp-reverse');
    if (rev) rev.addEventListener('change', function () { set_opt(OPT_REVERSE, rev.checked); });

    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
