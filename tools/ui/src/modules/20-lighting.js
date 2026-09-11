'use strict';
/* Lighting. Every control here sends exactly one frame shape from docs/protocol-websocket.md.

   Parity notes, each a fact from the protocol doc:
   - brightness and speed are 0..100 in steps of 5, 21 positions each
   - speed is disabled in Music mode; the factory UI greys it and it sends nothing there
   - colours are addressed by state index 0 idle, 1 printing, 2 error, and are per mode
   - the two modes store colours in different formats, index 0 bare RRGGBB and index 1
     #RRGGBBAA. What the BROWSER sends is not settled until the bench write test; this page
     sends the format the device stores for the selected mode. INFERENCE, pinned by the
     harness, corrected by the bench if it differs
   - the reset sends nothing in Music mode. The factory UI returns before the send; the
     wire result is identical here, and the page says so instead of silently doing nothing
   - a device that did not send a speed key never moves the slider. Untouched, it sits at
     its markup default of 100, which is the UI's own default and not a device value, and
     the label says so. Once the user has set it, the slider keeps what they set: the mock
     has a knob for whether the device echoes speed, and a page that wrote 100 back on
     every push would fight the user on a device that does not */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var modeSel, bright, brightVal, speed, speedVal, speedNote, colours, dots, blockList, resetBtn;
  var focused = null;               // never write a field the user is editing
  var speedTouched = false;         // the user has moved the speed slider at least once
  // Coloris is bound to our own attributes, never to its data-coloris: on load it wraps every
  // data-coloris field in a div of its own, which breaks Beer's field styling. wrap:false is
  // honoured only per bind call, so every bind here says it.
  var COLOUR_FIELDS = '[data-ps-colour],[data-ps-block],[data-ps-fxc],[data-ps-layerc]';

  function mode() { var m = PS.state.settings && PS.state.settings.current_mode; return (m === 0 || m === 1) ? m : null; }
  function entry() { var m = mode(); var l = PS.state.settings && PS.state.settings.list2; return (m !== null && l && l[m]) ? l[m] : null; }

  // ---- colour format per mode. Coloris yields #rrggbb or #rrggbbaa (lowercase). ----
  function toDevice(hex, m) {
    var h = hex.replace('#', '').toUpperCase();
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var rgb = h.slice(0, 6), a = h.length >= 8 ? h.slice(6, 8) : 'FF';
    return m === 0 ? rgb : '#' + rgb + a;
  }
  function toCss(dev) {
    var h = String(dev || '').replace('#', '');
    if (h.length < 6) return '';
    return '#' + h.slice(0, 6) + (h.length >= 8 ? h.slice(6, 8) : '');
  }

  function render() {
    renderSb(); renderFx(); renderFxc(); renderFxp(); renderFxr(); renderTg(); renderHot(); renderEf(); renderPv(); renderEd();
    var m = mode(), e = entry();
    if (m !== null && document.activeElement !== modeSel) modeSel.value = String(m);
    var isMusic = m === 0;
    speed.disabled = isMusic;
    speedNote.hidden = !isMusic;
    if (e) {
      if (focused !== bright) { bright.value = e.brightness; }
      brightVal.textContent = e.brightness + '%';
      if (e.speed !== undefined) {
        if (focused !== speed) speed.value = e.speed;
        speedVal.textContent = e.speed + '%';
      } else if (!speedTouched) speedVal.textContent = PS.tr('ps_lighting_speed_default');
      for (var i = 0; i < 3; i++) {
        var css = toCss(e.rgb_rgba && e.rgb_rgba[i]);
        if (focused !== colours[i]) { colours[i].value = css; colours[i].dispatchEvent(new Event('input', { bubbles: false })); }
        dots[i].style.background = css || '';
      }
    }
    renderBlocks();
  }

  // A1: the per-state sliders, only while the feature is on, always the current mode's row
  var sb = [];
  function renderSb() {
    var tile = $('ps-lighting-sb'); if (!tile) return;
    var f = PS.features, m = mode();
    var on = !!(f && f.features && f.features.state_brightness && m !== null && f.config && f.config.state_brightness && f.config.state_brightness[m]);
    tile.hidden = !on;
    if (!on) return;
    for (var i = 0; i < 3; i++) {
      var v = f.config.state_brightness[m][i];
      if (focused !== sb[i]) sb[i].value = v;
      $('ps-lighting-sb-value-' + i).textContent = v + '%';
    }
  }
  function wireSb(i) {
    sb[i] = $('ps-lighting-sb-' + i);
    sb[i].addEventListener('focus', function () { focused = sb[i]; });
    sb[i].addEventListener('blur', function () { if (focused === sb[i]) focused = null; });
    sb[i].addEventListener('change', function () {
      var f = PS.features, m = mode(); if (!f || !f.config || m === null) return;
      var cfg = JSON.parse(JSON.stringify(f.config.state_brightness));
      cfg[m][i] = Number(sb[i].value);
      PS.api({ config: { state_brightness: cfg } });
    });
  }
  // A2: the per-state effect selects, only while the feature is on
  var fxSel = [];
  function renderFx() {
    var tile = $('ps-lighting-fx'); if (!tile) return;
    var f = PS.features;
    var on = !!(f && f.features && f.features.state_effects && f.config && f.config.state_effects && f.config.state_effects.length === 3);
    tile.hidden = !on;
    if (!on) return;
    for (var i = 0; i < 3; i++) {
      // the effects that read the print each wait for their own switch: hidden until it is on
      Array.prototype.forEach.call(fxSel[i].options, function (opt) {
        var needs = opt.getAttribute('data-ps-fx-needs');
        if (needs) { var ok = !!f.features[needs]; opt.hidden = !ok; opt.disabled = !ok; }
      });
      if (document.activeElement !== fxSel[i]) fxSel[i].value = String(f.config.state_effects[i].effect);
    }
    renderFxb();
  }
  // A8: the pole's band width, only while the pole is this state's effect and its switch is on
  var AUX_BIT = 0x08;
  function renderFxb() {
    var f = PS.features;
    for (var s = 0; s < 3; s++) {
      var box = document.querySelector('[data-ps-fxb-state="' + s + '"]'); if (!box) continue;
      var e = f && f.config && f.config.state_effects && f.config.state_effects[s];
      var on = !!(e && f.features.state_effects && f.features.fx_barber && e.effect === 19);
      box.hidden = !on;
      if (!on) continue;
      var inp = $('ps-lighting-fxb-' + s), w = (e.opt & AUX_BIT) ? e.aux : 0;
      if (focused !== inp) inp.value = w > 0 ? w : 3;
      $('ps-lighting-fxb-value-' + s).textContent = w > 0 ? String(w) : '—';
    }
  }
  // A10: which temperature the gradient follows and its ends, one setting for every state that runs it
  function renderTg() {
    var box = $('ps-lighting-tg'); if (!box) return;
    var f = PS.features;
    var on = !!(f && f.features && f.features.state_effects && f.features.fx_temp && f.config && f.config.temp_gradient);
    box.hidden = !on;
    if (!on) return;
    var g = f.config.temp_gradient, sel = $('ps-lighting-tg-source'), lo = $('ps-lighting-tg-lo'), hi = $('ps-lighting-tg-hi');
    if (document.activeElement !== sel) sel.value = String(g.source);
    if (focused !== lo) lo.value = g.lo;
    if (focused !== hi) hi.value = g.hi;
    $('ps-lighting-tg-lo-value').textContent = g.lo + ' \u00B0C';
    $('ps-lighting-tg-hi-value').textContent = g.hi + ' \u00B0C';
  }
  function wireTg() {
    var sel = $('ps-lighting-tg-source'); if (!sel) return;
    function post(patch) {
      var f = PS.features; if (!f || !f.config || !f.config.temp_gradient) return;
      var g = { source: f.config.temp_gradient.source, lo: f.config.temp_gradient.lo, hi: f.config.temp_gradient.hi };
      Object.keys(patch).forEach(function (k) { g[k] = patch[k]; });
      PS.api({ config: { temp_gradient: g } });
    }
    sel.addEventListener('change', function () { post({ source: Number(sel.value) }); });
    document.querySelectorAll('[data-ps-tg]').forEach(function (inp) {
      var k = inp.getAttribute('data-ps-tg');
      inp.addEventListener('focus', function () { focused = inp; });
      inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
      inp.addEventListener('change', function () { var o = {}; o[k] = Number(inp.value); post(o); });
    });
  }
  // A11: the hot warning's source, threshold and colour; a layer over whatever the bar shows
  function renderHot() {
    var tile = $('ps-lighting-hot'); if (!tile) return;
    var f = PS.features;
    var on = !!(f && f.features && f.features.hot_warning && f.config && f.config.hot_warning);
    tile.hidden = !on;
    if (!on) return;
    var h = f.config.hot_warning, sel = $('ps-lighting-hot-source'), c = $('ps-lighting-hot-c'), inp = $('ps-lighting-hot-colour'), dot = $('ps-lighting-hot-colour-dot');
    if (document.activeElement !== sel) sel.value = String(h.source);
    if (focused !== c) c.value = h.threshold;
    $('ps-lighting-hot-c-value').textContent = h.threshold + ' \u00B0C';
    var css = toCss(h.colour);
    if (focused !== inp) { inp.value = css; inp.dispatchEvent(new Event('input', { bubbles: false })); }
    dot.style.background = css || '';
  }
  function wireHot() {
    var sel = $('ps-lighting-hot-source'); if (!sel) return;
    function post(patch) {
      var f = PS.features; if (!f || !f.config || !f.config.hot_warning) return;
      var h = { source: f.config.hot_warning.source, threshold: f.config.hot_warning.threshold, colour: f.config.hot_warning.colour };
      Object.keys(patch).forEach(function (k) { h[k] = patch[k]; });
      PS.api({ config: { hot_warning: h } });
    }
    sel.addEventListener('change', function () { post({ source: Number(sel.value) }); });
    var c = $('ps-lighting-hot-c');
    c.addEventListener('focus', function () { focused = c; });
    c.addEventListener('blur', function () { if (focused === c) focused = null; });
    c.addEventListener('change', function () { post({ threshold: Number(c.value) }); });
    var inp = $('ps-lighting-hot-colour');
    inp.addEventListener('focus', function () { focused = inp; });
    inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
    inp.addEventListener('change', function () { var dev = toDevice(inp.value, 1); if (!dev) return; post({ colour: dev }); });
  }
  // A12: the error flash's colour, brightness and rate; a layer over whatever the bar shows
  function renderEf() {
    var tile = $('ps-lighting-ef'); if (!tile) return;
    var f = PS.features;
    var on = !!(f && f.features && f.features.error_flash && f.config && f.config.error_flash);
    tile.hidden = !on;
    if (!on) return;
    var e = f.config.error_flash, b = $('ps-lighting-ef-brightness'), s = $('ps-lighting-ef-speed'), inp = $('ps-lighting-ef-colour'), dot = $('ps-lighting-ef-colour-dot');
    if (focused !== b) b.value = e.brightness;
    if (focused !== s) s.value = e.speed;
    $('ps-lighting-ef-brightness-value').textContent = e.brightness + '%';
    $('ps-lighting-ef-speed-value').textContent = e.speed + '%';
    var css = toCss(e.colour);
    if (focused !== inp) { inp.value = css; inp.dispatchEvent(new Event('input', { bubbles: false })); }
    dot.style.background = css || '';
  }
  function wireEf() {
    var inp = $('ps-lighting-ef-colour'); if (!inp) return;
    function post(patch) {
      var f = PS.features; if (!f || !f.config || !f.config.error_flash) return;
      var e = { colour: f.config.error_flash.colour, brightness: f.config.error_flash.brightness, speed: f.config.error_flash.speed };
      Object.keys(patch).forEach(function (k) { e[k] = patch[k]; });
      PS.api({ config: { error_flash: e } });
    }
    inp.addEventListener('focus', function () { focused = inp; });
    inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
    inp.addEventListener('change', function () { var dev = toDevice(inp.value, 1); if (!dev) return; post({ colour: dev }); });
    document.querySelectorAll('[data-ps-ef]').forEach(function (r) {
      var k = r.getAttribute('data-ps-ef');
      r.addEventListener('focus', function () { focused = r; });
      r.addEventListener('blur', function () { if (focused === r) focused = null; });
      r.addEventListener('change', function () { var o = {}; o[k] = Number(r.value); post(o); });
    });
  }
  // A13: the live preview; the state and the progress are local until Preview is pressed
  var pvTimer = null, pvLeft = 0;
  function pvShow(running) {
    var status = $('ps-lighting-pv-status'), stop = $('ps-lighting-pv-stop');
    if (status) status.hidden = !running;
    if (stop) stop.hidden = !running;
  }
  function pvTick() {
    pvLeft -= 1;
    if (pvLeft <= 0) { clearInterval(pvTimer); pvTimer = null; pvShow(false); return; }
    $('ps-lighting-pv-left').textContent = pvLeft + ' s';
  }
  function pvRun(doc) {
    if (pvTimer) { clearInterval(pvTimer); pvTimer = null; }
    if (!doc || !doc.active || !(doc.remaining > 0)) { pvShow(false); return; }
    pvLeft = doc.remaining;
    $('ps-lighting-pv-left').textContent = pvLeft + ' s';
    pvShow(true);
    pvTimer = setInterval(pvTick, 1000);
  }
  function renderPv() {
    var tile = $('ps-lighting-pv'); if (!tile) return;
    var f = PS.features;
    var on = !!(f && f.features && f.features.preview);
    tile.hidden = !on;
    if (!on && pvTimer) { clearInterval(pvTimer); pvTimer = null; pvShow(false); }
  }
  function wirePv() {
    var start = $('ps-lighting-pv-start'); if (!start) return;
    var pct = $('ps-lighting-pv-percent');
    pct.addEventListener('input', function () { $('ps-lighting-pv-percent-value').textContent = pct.value + '%'; });
    start.addEventListener('click', function () {
      PS.post('/api/preview', { state: Number($('ps-lighting-pv-state').value), percent: Number(pct.value), seconds: 30 }, pvRun);
    });
    $('ps-lighting-pv-stop').addEventListener('click', function () {
      PS.post('/api/preview', { seconds: 0 }, function () { if (pvTimer) { clearInterval(pvTimer); pvTimer = null; } pvShow(false); });
    });
  }
  // A14: the effect editor and the named effects
  var presets = null;                       // the device's list while the switch is on
  var ED_DEFAULT = { name: '', effect: 0, brightness: 50, speed: 100, bright_end: 0, opt: 0, aux: 0, colours: ['#FFFFFFFF', '#FFFFFFFF', '#000000FF', '#000000FF'] };
  function gateOptions(sel, f) {
    Array.prototype.forEach.call(sel.options, function (opt) {
      var needs = opt.getAttribute('data-ps-fx-needs');
      if (needs) { var ok = !!(f && f.features && f.features[needs]); opt.hidden = !ok; opt.disabled = !ok; }
    });
  }
  function edStrip(p) { return { name: p.name, effect: p.effect, brightness: p.brightness, speed: p.speed, bright_end: p.bright_end, opt: p.opt, aux: p.aux, colours: p.colours.slice() }; }
  function edRead() {                       // the editor's fields as one preset, in the route's key order
    var cols = [], opt = 0;
    for (var i = 0; i < 4; i++) { var v = $('ps-lighting-ed-colour-' + i).value; cols.push(v ? toDevice(v, 1) : '#000000FF'); }
    if ($('ps-lighting-ed-colour-2').value) opt |= 0x01;
    if ($('ps-lighting-ed-colour-3').value) opt |= 0x02;
    var end = Number($('ps-lighting-ed-end').value); if (end > 0) opt |= 0x04;
    var band = Number($('ps-lighting-ed-band').value); if (band > 0) opt |= 0x08;
    if ($('ps-lighting-ed-reverse').checked) opt |= 0x10;
    return { name: $('ps-lighting-ed-name').value.trim(), effect: Number($('ps-lighting-ed-effect').value), brightness: Number($('ps-lighting-ed-brightness').value), speed: Number($('ps-lighting-ed-speed').value), bright_end: end, opt: opt, aux: band, colours: cols };
  }
  function edWrite(p) {                     // a preset into the editor's fields
    $('ps-lighting-ed-name').value = p.name || '';
    $('ps-lighting-ed-effect').value = String(p.effect);
    for (var i = 0; i < 4; i++) {
      var set = i < 2 || !!(p.opt & (i === 2 ? 0x01 : 0x02));
      var css = set ? toCss(p.colours[i]) : '';
      var inp = $('ps-lighting-ed-colour-' + i); inp.value = css; inp.dispatchEvent(new Event('input', { bubbles: false }));
      $('ps-lighting-ed-dot-' + i).style.background = css || '';
    }
    var end = (p.opt & 0x04) ? p.bright_end : 0, band = (p.opt & 0x08) ? p.aux : 0;
    $('ps-lighting-ed-brightness').value = p.brightness; $('ps-lighting-ed-brightness-value').textContent = p.brightness + '%';
    $('ps-lighting-ed-speed').value = p.speed; $('ps-lighting-ed-speed-value').textContent = p.speed + '%';
    $('ps-lighting-ed-end').value = end; $('ps-lighting-ed-end-value').textContent = end + '%';
    $('ps-lighting-ed-band').value = band; $('ps-lighting-ed-band-value').textContent = String(band);
    $('ps-lighting-ed-reverse').checked = !!(p.opt & 0x10);
  }
  function edList() {
    var list = $('ps-lighting-ed-list'), none = $('ps-lighting-ed-none');
    while (list.firstChild) list.removeChild(list.firstChild);
    var items = (presets && presets.presets) || [];
    none.hidden = items.length > 0;
    items.forEach(function (p) {
      var row = document.createElement('div'); row.className = 'ps-row ps-ed-row'; row.setAttribute('data-ps-ed-name', p.name);
      var name = document.createElement('span'); name.className = 'ps-ed-name'; name.textContent = p.name;
      var fx = document.createElement('span'); fx.className = 'ps-tile-label';
      var o = $('ps-lighting-ed-effect').querySelector('option[value="' + p.effect + '"]'); fx.textContent = o ? o.textContent : String(p.effect);
      row.appendChild(name); row.appendChild(fx);
      [[0, PS.tr('ps_lighting_ed_use_idle')], [1, PS.tr('ps_lighting_ed_use_printing')], [2, PS.tr('ps_lighting_ed_use_error')]].forEach(function (s) {
        var b = document.createElement('button'); b.className = 'border small'; b.textContent = s[1]; b.setAttribute('data-ps-ed-use', String(s[0]));
        b.addEventListener('click', function () { PS.post('/api/presets', { apply: { name: p.name, state: s[0] } }, function (doc) { if (doc) { presets = doc; edList(); PS.refreshFeatures(); } }); });
        row.appendChild(b);
      });
      var ed = document.createElement('button'); ed.className = 'border small'; ed.textContent = PS.tr('ps_lighting_ed_load'); ed.setAttribute('data-ps-ed-load', '');
      ed.addEventListener('click', function () { edWrite(p); });
      var del = document.createElement('button'); del.className = 'border small'; del.textContent = PS.tr('ps_lighting_ed_delete'); del.setAttribute('data-ps-ed-delete', '');
      del.addEventListener('click', function () {
        var rest = items.filter(function (q) { return q.name !== p.name; }).map(edStrip);
        PS.post('/api/presets', { presets: rest }, function (doc) { if (doc) { presets = doc; edList(); } });
      });
      row.appendChild(ed); row.appendChild(del);
      list.appendChild(row);
    });
  }
  function renderEd() {
    var tile = $('ps-lighting-ed'); if (!tile) return;
    var f = PS.features;
    var on = !!(f && f.features && f.features.presets);
    tile.hidden = !on;
    if (!on) { presets = null; return; }
    gateOptions($('ps-lighting-ed-effect'), f);
    if (!presets) PS.get('/api/presets', function (doc) { presets = doc || { presets: [], max: 8 }; edList(); });
    else edList();
  }
  function wireEd() {
    var save = $('ps-lighting-ed-save'); if (!save) return;
    edWrite(ED_DEFAULT);
    [['brightness', '%'], ['speed', '%'], ['end', '%'], ['band', '']].forEach(function (p) {
      var inp = $('ps-lighting-ed-' + p[0]);
      inp.addEventListener('input', function () { $('ps-lighting-ed-' + p[0] + '-value').textContent = inp.value + p[1]; });
    });
    for (var i = 0; i < 4; i++) (function (i) {
      var inp = $('ps-lighting-ed-colour-' + i);
      inp.addEventListener('change', function () { $('ps-lighting-ed-dot-' + i).style.background = inp.value ? toCss(toDevice(inp.value, 1)) : ''; });
    })(i);
    save.addEventListener('click', function () {
      var p = edRead(); if (!p.name) { PS.toast(PS.tr('ps_lighting_ed_name')); return; }
      var items = ((presets && presets.presets) || []).filter(function (q) { return q.name !== p.name; }).map(edStrip);
      if (items.length >= ((presets && presets.max) || 8)) { PS.toast(PS.tr('ps_lighting_ed_full')); return; }
      items.push(p);
      PS.post('/api/presets', { presets: items }, function (doc) { if (doc) { presets = doc; edList(); } });
    });
  }
  function wireFxb() {
    document.querySelectorAll('[data-ps-fxb]').forEach(function (inp) {
      var s = Number(inp.getAttribute('data-ps-fxb'));
      inp.addEventListener('focus', function () { focused = inp; });
      inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
      inp.addEventListener('change', function () {
        var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
        var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
        cfg[s].aux = Number(inp.value); cfg[s].opt = cfg[s].opt | AUX_BIT;
        PS.api({ config: { state_effects: cfg } });
      });
    });
  }
  function wireFx(i) {
    fxSel[i] = $('ps-lighting-fx-' + i);
    fxSel[i].addEventListener('change', function () {
      var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
      var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
      cfg[i].effect = Number(fxSel[i].value);
      PS.api({ config: { state_effects: cfg } });
    });
  }
  // A3: the effect's own four colours, only while both the effect and the colour bits are on
  var BG_BIT = [0, 0, 1, 2];
  function renderFxc() {
    var f = PS.features;
    var on = !!(f && f.features && f.features.state_effects && f.features.effect_colours && f.config && f.config.state_effects && f.config.state_effects.length === 3);
    document.querySelectorAll('[data-ps-fxc-state]').forEach(function (box) { box.hidden = !on; });
    var help = $('ps-lighting-fxc-help'); if (help) help.hidden = !on;
    if (!on) return;
    for (var s = 0; s < 3; s++) for (var i = 0; i < 4; i++) {
      var inp = $('ps-lighting-fxc-' + s + '-' + i), dot = $('ps-lighting-fxc-dot-' + s + '-' + i), e = f.config.state_effects[s];
      var set = i < 2 || !!(e.opt & BG_BIT[i]);
      var css = set ? toCss(e.colours[i]) : '';
      if (focused !== inp) { inp.value = css; inp.dispatchEvent(new Event('input', { bubbles: false })); }
      dot.style.background = css || '';
    }
  }
  function wireFxc() {
    document.querySelectorAll('[data-ps-fxc]').forEach(function (inp) {
      var s = Number(inp.getAttribute('data-ps-fxc')), i = Number(inp.getAttribute('data-ps-fxc-i'));
      inp.addEventListener('focus', function () { focused = inp; });
      inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
      inp.addEventListener('change', function () {
        var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
        var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
        var dev = toDevice(inp.value, 1); if (!dev) return;
        cfg[s].colours[i] = dev;
        if (i >= 2) cfg[s].opt = cfg[s].opt | BG_BIT[i];
        PS.api({ config: { state_effects: cfg } });
      });
    });
    document.querySelectorAll('[data-ps-fxc-clear]').forEach(function (btn) {
      var s = Number(btn.getAttribute('data-ps-fxc-clear')), i = Number(btn.getAttribute('data-ps-fxc-i'));
      btn.addEventListener('click', function () {
        var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
        var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
        cfg[s].colours[i] = '#000000FF';
        cfg[s].opt = cfg[s].opt & ~BG_BIT[i];
        PS.api({ config: { state_effects: cfg } });
      });
    });
  }
  // A4: the effect's own brightness, speed and direction, only while both the effect and the params bits are on
  var REVERSE_BIT = 0x10;
  function renderFxp() {
    var f = PS.features;
    var on = !!(f && f.features && f.features.state_effects && f.features.effect_params && f.config && f.config.state_effects && f.config.state_effects.length === 3);
    document.querySelectorAll('[data-ps-fxp-state]').forEach(function (box) { box.hidden = !on; });
    var help = $('ps-lighting-fxp-help'); if (help) help.hidden = !on;
    if (!on) return;
    for (var s = 0; s < 3; s++) {
      var e = f.config.state_effects[s];
      ['brightness', 'speed'].forEach(function (k) {
        var inp = $('ps-lighting-fxp-' + k + '-' + s);
        if (focused !== inp) inp.value = e[k];
        $('ps-lighting-fxp-' + k + '-value-' + s).textContent = e[k] + '%';
      });
      var rev = $('ps-lighting-fxp-reverse-' + s);
      if (document.activeElement !== rev) rev.checked = !!(e.opt & REVERSE_BIT);
    }
  }
  function wireFxp() {
    document.querySelectorAll('[data-ps-fxp]').forEach(function (inp) {
      var s = Number(inp.getAttribute('data-ps-fxp')), k = inp.getAttribute('data-ps-fxp-key');
      inp.addEventListener('focus', function () { focused = inp; });
      inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
      inp.addEventListener('change', function () {
        var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
        var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
        cfg[s][k] = Number(inp.value);
        PS.api({ config: { state_effects: cfg } });
      });
    });
    document.querySelectorAll('[data-ps-fxp-reverse]').forEach(function (cb) {
      var s = Number(cb.getAttribute('data-ps-fxp-reverse'));
      cb.addEventListener('change', function () {
        var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
        var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
        cfg[s].opt = cb.checked ? (cfg[s].opt | REVERSE_BIT) : (cfg[s].opt & ~REVERSE_BIT);
        PS.api({ config: { state_effects: cfg } });
      });
    });
  }
  // A5: the ramp, only while effects, params and the ramp bits are all on
  var RAMP_BIT = 0x04;
  function renderFxr() {
    var f = PS.features;
    var on = !!(f && f.features && f.features.state_effects && f.features.effect_params && f.features.effect_ramp && f.config && f.config.state_effects && f.config.state_effects.length === 3);
    document.querySelectorAll('[data-ps-fxr-state]').forEach(function (box) { box.hidden = !on; });
    var help = $('ps-lighting-fxr-help'); if (help) help.hidden = !on;
    if (!on) return;
    for (var s = 0; s < 3; s++) {
      var e = f.config.state_effects[s];
      var cb = $('ps-lighting-fxr-on-' + s), end = $('ps-lighting-fxr-end-' + s);
      if (document.activeElement !== cb) cb.checked = !!(e.opt & RAMP_BIT);
      if (focused !== end) end.value = e.bright_end;
      $('ps-lighting-fxr-end-value-' + s).textContent = e.bright_end + '%';
    }
  }
  function wireFxr() {
    document.querySelectorAll('[data-ps-fxr-on]').forEach(function (cb) {
      var s = Number(cb.getAttribute('data-ps-fxr-on'));
      cb.addEventListener('change', function () {
        var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
        var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
        cfg[s].opt = cb.checked ? (cfg[s].opt | RAMP_BIT) : (cfg[s].opt & ~RAMP_BIT);
        PS.api({ config: { state_effects: cfg } });
      });
    });
    document.querySelectorAll('[data-ps-fxr-end]').forEach(function (inp) {
      var s = Number(inp.getAttribute('data-ps-fxr-end'));
      inp.addEventListener('focus', function () { focused = inp; });
      inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
      inp.addEventListener('change', function () {
        var f = PS.features; if (!f || !f.config || !f.config.state_effects) return;
        var cfg = JSON.parse(JSON.stringify(f.config.state_effects));
        cfg[s].bright_end = Number(inp.value);
        PS.api({ config: { state_effects: cfg } });
      });
    });
  }
  function renderBlocks() {
    var list = (PS.state.block && PS.state.block.blocklist) || [];
    var want = list.map(function (b) { return b.blockID; }).join(',');
    if (blockList.getAttribute('data-ps-ids') !== want) {
      while (blockList.firstChild) blockList.removeChild(blockList.firstChild);
      list.forEach(function (b) {
        var lab = document.createElement('label'); lab.className = 'field prefix border small ps-colour-field';
        var dot = document.createElement('span'); dot.className = 'ps-dot'; dot.id = 'ps-lighting-block-dot-' + b.blockID;
        var inp = document.createElement('input'); inp.type = 'text'; inp.id = 'ps-lighting-block-' + b.blockID;
        inp.setAttribute('data-ps-block', String(b.blockID)); inp.setAttribute('aria-label', PS.tr('ps_lighting_block_aria') + ' ' + b.blockID);
        var help = document.createElement('span'); help.className = 'helper'; help.textContent = PS.tr('ps_lighting_block') + ' ' + b.blockID;
        lab.appendChild(dot); lab.appendChild(inp); lab.appendChild(help); blockList.appendChild(lab);
        inp.addEventListener('focus', function () { focused = inp; });
        inp.addEventListener('blur', function () { if (focused === inp) focused = null; });
        inp.addEventListener('change', function () {
          PS.send('block', { blockID: b.blockID, blockrgba: toDevice(inp.value, 1) });
        });
      });
      blockList.setAttribute('data-ps-ids', want);
      if (window.Coloris) Coloris({ el: COLOUR_FIELDS, wrap: false });   // wrap is per bind call
    }
    list.forEach(function (b) {
      var inp = $('ps-lighting-block-' + b.blockID), dot = $('ps-lighting-block-dot-' + b.blockID);
      if (!inp) return;
      var css = toCss(b.blockrgba);
      if (focused !== inp) { inp.value = css; inp.dispatchEvent(new Event('input', { bubbles: false })); }
      dot.style.background = css || '';
    });
  }

  function wire() {
    modeSel = $('ps-lighting-mode'); bright = $('ps-lighting-brightness'); brightVal = $('ps-lighting-brightness-value');
    speed = $('ps-lighting-speed'); speedVal = $('ps-lighting-speed-value'); speedNote = $('ps-lighting-speed-note');
    colours = [0, 1, 2].map(function (i) { return $('ps-lighting-colour-' + i); });
    dots = [0, 1, 2].map(function (i) { return $('ps-lighting-colour-dot-' + i); });
    blockList = $('ps-lighting-block-list'); resetBtn = $('ps-lighting-reset');

    [bright, speed].concat(colours).forEach(function (el) {
      el.addEventListener('focus', function () { focused = el; });
      el.addEventListener('blur', function () { if (focused === el) focused = null; });
    });

    modeSel.addEventListener('change', function () {
      PS.send('settings', { rgb_info_mode: Number(modeSel.value) });
    });
    bright.addEventListener('input', function () { brightVal.textContent = bright.value + '%'; });
    bright.addEventListener('change', function () { PS.send('settings', { rgb_info_brightness: Number(bright.value) }); });
    for (var i = 0; i < 3; i++) { wireSb(i); wireFx(i); }
    wireFxc(); wireFxp(); wireFxr(); wireFxb(); wireTg(); wireHot(); wireEf(); wirePv(); wireEd();
    speed.addEventListener('input', function () { if (speed.disabled) return; speedTouched = true; speedVal.textContent = speed.value + '%'; });
    speed.addEventListener('change', function () { if (!speed.disabled) PS.send('settings', { rgb_info_speed: Number(speed.value) }); });

    colours.forEach(function (inp, i) {
      inp.addEventListener('change', function () {
        var m = mode(); if (m === null) return;
        dots[i].style.background = inp.value;
        PS.send('settings', { rgb_info_mode: m, rgb_rgba: toDevice(inp.value, m), rgb_state_index: i });
      });
    });

    resetBtn.addEventListener('click', function () {
      if (mode() === 0) { PS.toast(PS.tr('ps_lighting_reset_music')); return; }   // parity: nothing on the wire in Music
      PS.dialog(PS.tr('ps_lighting_reset_title'), PS.tr('ps_lighting_reset_text'),
        [{ key: 'ps_lighting_reset_confirm', handler: function () { PS.send('settings', { rgb_reset: 1 }); } }, { key: 'ps_global_cancel' }]);
    });

    if (window.Coloris) {
      Coloris({ el: COLOUR_FIELDS, alpha: true, format: 'hex', themeMode: 'auto', wrap: false });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
  PS.on('state', function () { render(); });
  PS.on('features', function () { renderSb(); renderFx(); renderFxc(); renderFxp(); renderFxr(); renderTg(); renderHot(); renderEf(); renderPv(); renderEd(); });
})();
