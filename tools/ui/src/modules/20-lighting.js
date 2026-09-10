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
  var COLOUR_FIELDS = '[data-ps-colour],[data-ps-block]';

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
})();
