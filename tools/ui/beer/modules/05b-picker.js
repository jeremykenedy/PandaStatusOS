/* =====================================================================
   PandaStatusOS web UI — COLOUR PICKER
   ---------------------------------------------------------------------
   One dialog, reused by whoever opens it. The caller passes the button it
   was opened from and a function to call with the chosen colour; nothing
   here knows what the colour is for, so the bar states and the blocks use
   the same picker without it growing a case for each.

       picker_open(buttonEl, function (hex) { ... })

   hex is '#RRGGBB'. The wire format is the caller's business: this device
   emits index 0 as bare RRGGBB and index 1 as #RRGGBBAA, and normalising
   either of them here would push that difference somewhere it does not
   belong.

   iro.js draws the wheel. It is vendored at 5.5.2 under MPL-2.0 with its
   own banner intact; see firmware/main/vendor/iro/. ============== */

(function () {
  'use strict';

  var PRESETS = ['#FFFFFF', '#FF0000', '#FF7F00', '#FFD400', '#00C000',
                 '#00B7C3', '#0066FF', '#7B2FF7', '#FF2D8D', '#000000'];

  var dlg, wheel, preview, hexIn, hslIn, presetRow;
  var iroPicker = null;
  var onPick = null;
  var openedFrom = null;
  var startColour = '#FFFFFF';

  function clampHex(v) {
    if (typeof v !== 'string') return null;
    var s = v.trim();
    if (s.charAt(0) === '#') s = s.slice(1);
    if (!/^[0-9a-fA-F]{6}$/.test(s) && !/^[0-9a-fA-F]{8}$/.test(s)) return null;
    return '#' + s.slice(0, 6).toUpperCase();
  }

  function fromButton(btn) {
    var bg = btn && btn.style && btn.style.background;
    var m = bg && bg.match(/#[0-9a-fA-F]{6}/);
    if (m) return m[0].toUpperCase();
    if (bg && /^rgb/.test(bg)) {
      var n = bg.match(/\d+/g);
      if (n && n.length >= 3) {
        return '#' + n.slice(0, 3).map(function (x) {
          return ('0' + Number(x).toString(16)).slice(-2);
        }).join('').toUpperCase();
      }
    }
    return '#FFFFFF';
  }

  function toHsl(hex) {
    var r = parseInt(hex.substr(1, 2), 16) / 255,
        g = parseInt(hex.substr(3, 2), 16) / 255,
        b = parseInt(hex.substr(5, 2), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (d) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [Math.round(h), Math.round(s * 100), Math.round(l * 100)];
  }

  function show(hex) {
    if (preview) preview.style.background = hex;
    if (hexIn && document.activeElement !== hexIn) hexIn.value = hex;
    if (hslIn && document.activeElement !== hslIn) hslIn.value = toHsl(hex).join(', ');
    if (iroPicker) { try { iroPicker.color.hexString = hex; } catch (e) {} }
  }

  function current() {
    if (iroPicker) { try { return iroPicker.color.hexString.toUpperCase(); } catch (e) {} }
    return clampHex(hexIn && hexIn.value) || startColour;
  }

  function build_presets() {
    if (!presetRow || presetRow.childNodes.length) return;
    PRESETS.forEach(function (c) {
      var b = document.createElement('button');
      b.className = 'swatch small-round';
      b.style.background = c;
      b.setAttribute('aria-label', c);
      b.addEventListener('click', function () { show(c); });
      presetRow.appendChild(b);
    });
  }

  function ensure_wheel() {
    if (iroPicker || !wheel || typeof window.iro === 'undefined') return;
    try {
      iroPicker = new window.iro.ColorPicker(wheel, {
        width: 220,
        color: startColour,
        borderWidth: 0,
        layout: [{ component: window.iro.ui.Wheel },
                 { component: window.iro.ui.Slider, options: { sliderType: 'value' } }]
      });
      iroPicker.on('color:change', function (c) {
        if (preview) preview.style.background = c.hexString;
        if (hexIn && document.activeElement !== hexIn) hexIn.value = c.hexString.toUpperCase();
        if (hslIn && document.activeElement !== hslIn) hslIn.value = toHsl(c.hexString).join(', ');
      });
    } catch (e) { iroPicker = null; }
  }

  function close() {
    onPick = null;
    openedFrom = null;
    if (dlg && dlg.open) { try { dlg.close(); } catch (e) { dlg.removeAttribute('open'); } }
  }

  function open(btn, cb) {
    dlg = dlg || byId('ps-color-picker');
    if (!dlg) return;
    wheel = wheel || byId('ps-hsl-picker');
    preview = preview || byId('ps-hsl-preview');
    hexIn = hexIn || byId('ps-hsl-hex');
    hslIn = hslIn || byId('ps-hsl-hsl');
    presetRow = presetRow || byId('ps-hsl-presets');

    onPick = cb;
    openedFrom = btn;
    startColour = fromButton(btn);
    build_presets();
    ensure_wheel();
    show(startColour);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  }
  window.picker_open = open;

  function wire() {
    dlg = byId('ps-color-picker');
    hexIn = byId('ps-hsl-hex');
    hslIn = byId('ps-hsl-hsl');

    if (hexIn) hexIn.addEventListener('input', function () {
      var h = clampHex(hexIn.value);
      if (h) show(h);
    });

    if (hslIn) hslIn.addEventListener('change', function () {
      var n = (hslIn.value || '').match(/-?\d+/g);
      if (!n || n.length < 3 || !iroPicker) return;
      try {
        iroPicker.color.hsl = { h: Number(n[0]), s: Number(n[1]), l: Number(n[2]) };
      } catch (e) {}
    });

    var cancel = byId('ps-hsl-cancel');
    if (cancel) cancel.addEventListener('click', close);

    var reset = byId('ps-hsl-reset');
    if (reset) reset.addEventListener('click', function () { show('#FFFFFF'); });

    var ok = byId('ps-hsl-confirm');
    if (ok) ok.addEventListener('click', function () {
      var hex = current(), cb = onPick, btn = openedFrom;
      close();
      /* Paint it straight away. The device does not echo a colour back until
         the next push, so between sending and that push the page is the only
         thing that knows. The vent learned this the hard way: a swatch that
         waited for an echo showed the old colour until a reconnect. */
      if (btn) { btn.style.background = hex; btn.classList.remove('is-unset'); }
      if (cb) cb(hex);
    });

    if (dlg) dlg.addEventListener('cancel', function (ev) { ev.preventDefault(); close(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
