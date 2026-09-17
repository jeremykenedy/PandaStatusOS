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

  /* ---- the settings that are not inside an fx --------------------- */

  function cfg() { return (g_doc && g_doc.config) || {}; }

  /* A1 is stored per mode, and the mode is the lighting module's state, not
     this one's: read it where it lives rather than keeping a second copy. */
  function mode_now() {
    var s = (window.g_state && g_state.settings) || {};
    return isNum(s.current_mode) ? s.current_mode : 0;
  }

  function send_cfg(patch) { post({ config: patch }); }

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
        o.textContent += '. ' + tr('ui_needs_feature', 'Turned off. Switch it on under Features.');
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

  function show(id, on) { var el = byId(id); if (el) el.hidden = !on; }

  function set_sel(id, v) {
    var el = byId(id);
    if (el && isNum(v) && document.activeElement !== el) el.value = String(v);
  }
  function set_num(id, v) {
    var el = byId(id);
    if (!el || document.activeElement === el) return;
    el.value = isNum(v) ? String(v) : '';
  }
  function set_range(id, out, v) {
    var el = byId(id);
    if (el && isNum(v) && document.activeElement !== el) el.value = String(v);
    setText(out, isNum(v) ? fmtPct(v) : DASH);
  }

  /* A5, A1: both are per state, so both are painted from the state the row
     above has selected. */
  function render_per_state() {
    var f = fx_of(g_state) || {};

    show('ps-fxr-card', !!feats().effect_ramp);
    var rampOn = !!((f.opt || 0) & OPT_RAMP);
    var ron = byId('ps-fxr-on');
    if (ron) ron.checked = rampOn;
    var rend = byId('ps-fxr-end');
    if (rend) {
      rend.disabled = !rampOn;
      if (isNum(f.bright_end) && document.activeElement !== rend) rend.value = String(f.bright_end);
    }
    setText('ps-fxr-end-value', rampOn && isNum(f.bright_end) ? fmtPct(f.bright_end) : tr('ui_off', 'off'));

    show('ps-fxs-card', !!feats().state_brightness);
    var sb = cfg().state_brightness;
    var row = (Array.isArray(sb) && sb[mode_now()]) || null;
    var v = (row && isNum(row[g_state])) ? row[g_state] : null;
    var sbEl = byId('ps-fxs-bright');
    if (sbEl && v !== null && document.activeElement !== sbEl) sbEl.value = String(v);
    setText('ps-fxs-value', v === null ? DASH : fmtPct(v));
  }

  /* A10, A11, A12: one setting each, shared by every state that runs them. */
  function render_layers() {
    var c = cfg();

    show('ps-tg-card', !!feats().fx_temp);
    var tg = c.temp_gradient || {};
    set_sel('ps-tg-source', tg.source);
    set_num('ps-tg-lo', tg.lo);
    set_num('ps-tg-hi', tg.hi);

    show('ps-hw-card', !!feats().hot_warning);
    var hw = c.hot_warning || {};
    set_sel('ps-hw-source', hw.source);
    set_num('ps-hw-threshold', hw.threshold);
    paint_swatch('ps-hw-colour', hw.colour);

    show('ps-ef-card', !!feats().error_flash);
    var ef = c.error_flash || {};
    paint_swatch('ps-ef-colour', ef.colour);
    set_range('ps-ef-bright', 'ps-ef-bright-value', ef.brightness);
    set_range('ps-ef-speed', 'ps-ef-speed-value', ef.speed);
  }

  function render_effects() {
    var f_ = feats();
    /* The chooser is shown when anything below it is per state, which is
       more than the effect list: the brightness and the ramp are too. */
    show('ps-fxsel-card', !!(f_.state_effects || f_.state_brightness || f_.effect_ramp ||
                             f_.effect_colours || f_.effect_params));
    show('ps-fx-card', !!f_.state_effects);
    paint_state_row();
    fill_effect_list();

    var f = fx_of(g_state) || {};
    var id = f.effect || 0;
    var cols = Array.isArray(f.colours) ? f.colours : [];

    /* The colour card is for the effects that take colours, and the device only
       honours the backgrounds when effect_colours is on. */
    show('ps-fxc-card', !!f_.effect_colours);
    paint_swatch('ps-fxc-0', cols[0]);
    paint_swatch('ps-fxc-2', cols[2]);
    paint_swatch('ps-fxc-3', cols[3]);

    /* The band width is the barber pole's and nothing else's. */
    show('ps-fxb-card', !!(id === 19 && f_.effect_params));
    var band = byId('ps-fxb-band');
    if (band && document.activeElement !== band) band.value = isNum(f.aux) ? f.aux : 0;
    setText('ps-fxb-band-value', isNum(f.aux) && f.aux > 0 ? String(f.aux) : tr('ui_auto', 'Auto'));

    show('ps-fxp-card', !!f_.effect_params);
    var sp = byId('ps-fxp-speed');
    if (sp && document.activeElement !== sp) sp.value = isNum(f.speed) ? f.speed : 100;
    setText('ps-fxp-speed-value', isNum(f.speed) ? fmtPct(f.speed) : '');
    var rev = byId('ps-fxp-reverse');
    if (rev) rev.checked = !!((f.opt || 0) & OPT_REVERSE);

    render_per_state();
    render_layers();
    if (window.render_presets) render_presets();
  }
  window.render_effects = render_effects;

  /* The presets page assigns a preset to the state being edited, and reads the
     state's effect to save it, so both are published rather than guessed. */
  window.fx_state_now = function () { return g_state; };
  window.fx_current = function () { var f = fx_of(g_state); return f ? JSON.parse(JSON.stringify(f)) : null; };
  window.fx_features = function () { return feats(); };

  function refresh(after) {
    get(function (doc) {
      if (doc) g_doc = doc;
      render_effects();
      if (after) after();
    });
  }
  window.refresh_features = refresh;

  /* ---- wiring --------------------------------------------------- */

  function num_field(id, apply) {
    var el = byId(id);
    if (!el) return;
    el.addEventListener('change', function () {
      var v = el.value === '' ? NaN : Number(el.value);
      if (!isFinite(v) || v < 0) { render_effects(); return; }
      apply(Math.round(v));
    });
  }

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

    /* A5: the switch owns the bit, the slider owns the value. Turning the
       switch on with no value stored sends the slider's, so the device never
       has the bit set over a value nobody chose. */
    var ron = byId('ps-fxr-on');
    if (ron) ron.addEventListener('change', function () {
      var f = fx_of(g_state) || {};
      var opt = f.opt || 0;
      if (ron.checked) {
        var end = byId('ps-fxr-end');
        var v = isNum(f.bright_end) && f.bright_end > 0 ? f.bright_end : Number((end && end.value) || 100);
        send_fx({ opt: opt | OPT_RAMP, bright_end: v });
      } else {
        send_fx({ opt: opt & ~OPT_RAMP });
      }
    });
    var rend = byId('ps-fxr-end');
    if (rend) {
      rend.addEventListener('input', function () { setText('ps-fxr-end-value', fmtPct(Number(rend.value))); });
      rend.addEventListener('change', function () {
        var f = fx_of(g_state) || {};
        send_fx({ bright_end: Number(rend.value), opt: (f.opt || 0) | OPT_RAMP });
      });
    }

    /* A1: the route takes the whole two by three block, so the stored one is
       copied and the one cell being changed is written into the copy. */
    var sbEl = byId('ps-fxs-bright');
    if (sbEl) {
      sbEl.addEventListener('input', function () { setText('ps-fxs-value', fmtPct(Number(sbEl.value))); });
      sbEl.addEventListener('change', function () {
        var sb = cfg().state_brightness;
        if (!Array.isArray(sb) || sb.length !== 2) return;
        var next = JSON.parse(JSON.stringify(sb));
        next[mode_now()][g_state] = Number(sbEl.value);
        send_cfg({ state_brightness: next });
      });
    }

    var tgs = byId('ps-tg-source');
    if (tgs) tgs.addEventListener('change', function () { send_cfg({ temp_gradient: { source: Number(tgs.value) } }); });
    num_field('ps-tg-lo', function (v) { send_cfg({ temp_gradient: { lo: v } }); });
    num_field('ps-tg-hi', function (v) { send_cfg({ temp_gradient: { hi: v } }); });

    var hws = byId('ps-hw-source');
    if (hws) hws.addEventListener('change', function () { send_cfg({ hot_warning: { source: Number(hws.value) } }); });
    num_field('ps-hw-threshold', function (v) { send_cfg({ hot_warning: { threshold: v } }); });
    var hwc = byId('ps-hw-colour');
    if (hwc) hwc.addEventListener('click', function () {
      picker_open(hwc, function (hex) { send_cfg({ hot_warning: { colour: hex + 'FF' } }); });
    });

    var efc = byId('ps-ef-colour');
    if (efc) efc.addEventListener('click', function () {
      picker_open(efc, function (hex) { send_cfg({ error_flash: { colour: hex + 'FF' } }); });
    });
    var efb = byId('ps-ef-bright');
    if (efb) {
      efb.addEventListener('input', function () { setText('ps-ef-bright-value', fmtPct(Number(efb.value))); });
      efb.addEventListener('change', function () { send_cfg({ error_flash: { brightness: Number(efb.value) } }); });
    }
    var efs = byId('ps-ef-speed');
    if (efs) {
      efs.addEventListener('input', function () { setText('ps-ef-speed-value', fmtPct(Number(efs.value))); });
      efs.addEventListener('change', function () { send_cfg({ error_flash: { speed: Number(efs.value) } }); });
    }

    refresh();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
