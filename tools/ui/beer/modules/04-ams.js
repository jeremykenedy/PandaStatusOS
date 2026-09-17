/* =====================================================================
   PandaStatusOS web UI — THE AMS
   ---------------------------------------------------------------------
   Everything here comes off printer.status, which the device fills from
   the printer's own report:

       trays        [ { id, type, sub, remain, colour }, ... ]
       tray_now     the loaded tray's index
       ams_humidity the unit's level, 1 to 5
       ams_temp     the unit's temperature

   Three things this card refuses to do.

   It does not turn the humidity level into a percentage. The printer
   reports a level from one to five, publishes no mapping to a relative
   humidity, and the two do not track: an owner measuring ten percent
   against a reported five is the published counter-example. A percentage
   drawn here would be a number this project invented, so the level is
   drawn as a level, with a row of pips and the number beside it.

   It does not assume the humidity is there. Bambu has removed that field
   from an X1C firmware release before. Its absence is a normal state and
   says so, rather than reading as zero.

   It does not draw a spool the printer has not described. A tray with no
   type, no colour and no remaining is an empty slot; the device leaves it
   out of the list, and a printer with no AMS sends no list at all, which
   takes the whole card with it.
   ================================================================= */

(function () {
  'use strict';

  var PIPS = 5;

  function st() { return (g_state.printer && g_state.printer.status) || {}; }

  function css_colour(w) {
    if (typeof w !== 'string' || !w) return '';
    var hex = w.charAt(0) === '#' ? w.slice(1) : w;
    return hex.length >= 6 ? '#' + hex.slice(0, 6) : '';
  }

  /* The level as pips, the way a level reads at a glance, with the number beside it so the
     reading is still exact. Never a percentage: see the note above. */
  function humidity_node(level) {
    var wrap = document.createElement('span');
    wrap.className = 'ams-humidity';
    for (var i = 1; i <= PIPS; i++) {
      var pip = document.createElement('i');
      pip.className = 'ams-pip' + (i <= level ? ' is-on' : '');
      wrap.appendChild(pip);
    }
    var n = document.createElement('span');
    n.className = 'small-text';
    n.textContent = ' ' + tr('ams_level', 'level') + ' ' + level;
    wrap.appendChild(n);
    return wrap;
  }

  function render_ams() {
    var card = byId('ps-card-ams');
    var kv = byId('ps-ams-kv');
    var wrap = byId('ps-trays');
    var row = byId('ps-trays-row');
    if (!card || !kv || !wrap || !row) return;

    var s = st();
    var trays = Array.isArray(s.trays) ? s.trays : [];

    /* No spools described is no AMS. project.css takes the card away with the block. */
    wrap.hidden = trays.length === 0;
    card.hidden = trays.length === 0;
    if (card.hidden) { kv.textContent = ''; row.textContent = ''; return; }

    kv.textContent = '';
    kv.appendChild(kv_li_icon('humidity', tr('ui_humidity', 'Humidity'), null,
      isNum(s.ams_humidity) ? humidity_node(s.ams_humidity)
                            : valueSpan(tr('ui_ams_no_reading', 'The printer is not reporting a humidity reading.'))));
    if (isNum(s.ams_temp)) {
      kv.appendChild(kv_li_icon('temp', tr('ui_temperature', 'Temperature'), null, valueSpan(fmtTemp(s.ams_temp))));
    }

    /* Rebuilt only when the set of spools changes, so a chip is not pulled out from under
       a finger on every push. */
    var sig = trays.map(function (t) {
      return [t.id, t.type || '', t.sub || '', isNum(t.remain) ? t.remain : '', t.colour || ''].join('~');
    }).join('|') + '#' + (isNum(s.tray_now) ? s.tray_now : '');
    if (row.dataset.sig === sig) return;
    row.dataset.sig = sig;
    row.textContent = '';

    trays.forEach(function (t) {
      var chip = document.createElement('div');
      chip.className = 'chip border';
      chip.id = 'ps-tray-' + t.id;
      if (isNum(s.tray_now) && s.tray_now === t.id) {
        chip.classList.add('is-now');
        chip.title = tr('ui_loaded', 'Loaded');
      }

      var dot = document.createElement('i');
      dot.className = 'circle small swatch-dot';
      var c = css_colour(t.colour);
      if (c) dot.style.background = c; else dot.classList.add('is-unset');
      chip.appendChild(dot);

      var text = document.createElement('span');
      /* The slot number is always there; what is in it may not be, and an empty slot says
         so with the dash this page uses everywhere else rather than with a blank. */
      var parts = [];
      if (t.type) parts.push(t.type);
      if (t.sub && t.sub !== t.type) parts.push(t.sub);
      if (isNum(t.remain)) parts.push(fmtPct(t.remain));
      text.textContent = (t.id + 1) + ' · ' + (parts.length ? parts.join(' · ') : DASH);
      chip.appendChild(text);

      row.appendChild(chip);
    });
  }
  window.render_ams = render_ams;
})();
