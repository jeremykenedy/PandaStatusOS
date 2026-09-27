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

   It does not invent a spool. A slot the printer describes as empty (its
   exist bit clear, or nothing in it at all) keeps its badge and says None
   (O7); a unit that is there and holds nothing says Empty where the badges
   would be; and a printer with no AMS (ams_units 0, or no unit and no
   spools described) has no card at all.
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

  /* Two different readings, drawn differently on purpose.
   *
   * A unit that sends a real relative humidity gets a plain percentage, because that is a
   * measurement. The newer AMS units do this.
   *
   * A unit that sends only the level gets the pips, an APPROXIMATE band, and the level
   * itself. The band is the level's own fifth of the range and is marked with a wavy equals
   * so it cannot be read as a measurement: Bambu's documentation says the level comes from
   * water content and temperature mapped onto undisclosed curve thresholds, and no mapping
   * back to a percentage is published by anyone. The note under the row says so in words.
   * That is as close to a percentage as this reading honestly goes. */
  function humidity_node(level, pct) {
    var wrap = document.createElement('span');
    wrap.className = 'ams-humidity';
    for (var i = 1; i <= PIPS; i++) {
      var pip = document.createElement('i');
      pip.className = 'ams-pip' + (isNum(level) && i <= level ? ' is-on' : '');
      wrap.appendChild(pip);
    }
    var n = document.createElement('span');
    n.className = 'small-text';
    if (isNum(pct)) {
      n.textContent = ' ' + fmtPct(pct);
    } else {
      var lo = (level - 1) * 20, hi = level * 20;
      n.textContent = ' \u2248 ' + lo + '\u2013' + hi + '% \u00b7 ' + tr('ams_level', 'level') + ' ' + level;
    }
    wrap.appendChild(n);
    return wrap;
  }

  /* The pips follow a real percentage too, in the same five bands, so the bar and the number
     never disagree with each other. */
  function pips_for(level, pct) {
    if (isNum(pct)) { var n = Math.ceil(pct / 20); return n < 1 ? 1 : (n > PIPS ? PIPS : n); }
    return level;
  }

  function render_ams() {
    var card = byId('ps-card-ams');
    var kv = byId('ps-ams-kv');
    var wrap = byId('ps-trays');
    var row = byId('ps-trays-row');
    if (!card || !kv || !wrap || !row) return;

    var s = st();
    var trays = Array.isArray(s.trays) ? s.trays : [];

    /* O7: an AMS is an AMS whether or not it holds anything. The device says how many units
       there are once the printer has; a device from before that says nothing, and then the
       spools it describes are the only evidence. No unit and no spools is no card. */
    var units = isNum(s.ams_units) ? s.ams_units : (trays.length ? 1 : 0);
    card.hidden = units === 0 && trays.length === 0;
    wrap.hidden = card.hidden;
    if (card.hidden) { kv.textContent = ''; row.textContent = ''; row.dataset.sig = ''; return; }

    kv.textContent = '';
    var pct = isNum(s.ams_humidity_pct) ? s.ams_humidity_pct : null;
    var lvl = isNum(s.ams_humidity) ? s.ams_humidity : null;
    /* A unit that sends a percentage and no level still fills the bar, from the percentage. */
    var shown = (pct !== null || lvl !== null) ? pips_for(lvl, pct) : null;
    kv.appendChild(kv_li_icon('humidity', tr('ui_humidity', 'Humidity'), null,
      shown !== null ? humidity_node(shown, pct)
                     : valueSpan(tr('ui_ams_no_reading', 'The printer is not reporting a humidity reading.'))));
    /* The caveat rides with the approximation and goes away when the reading is real. */
    var note = byId('ps-ams-note');
    if (note) {
      var approx = (pct === null && lvl !== null);
      note.hidden = !approx;
      if (approx) note.textContent = tr('ui_humidity_is_a_level', '');
    }
    if (isNum(s.ams_temp)) {
      kv.appendChild(kv_li_icon('temp', tr('ui_temperature', 'Temperature'), null, valueSpan(fmtTemp(s.ams_temp))));
    }

    /* Rebuilt only when the set of spools changes, so a chip is not pulled out from under
       a finger on every push. */
    var sig = trays.map(function (t) {
      return [t.id, t.empty ? 'e' : '', t.type || '', t.sub || '', isNum(t.remain) ? t.remain : '', t.colour || ''].join('~');
    }).join('|') + '#' + (isNum(s.tray_now) ? s.tray_now : '') + '#' + units;
    if (row.dataset.sig === sig) return;
    row.dataset.sig = sig;
    row.textContent = '';

    /* O7: a unit with nothing in any slot, or with no slot described at all, says Empty
       once, where the badges would be, rather than four badges each saying None. */
    var holding = trays.filter(function (t) { return !t.empty; }).length;
    if (holding === 0) {
      var none = document.createElement('div');
      none.className = 'small-text ams-empty';
      none.id = 'ps-trays-empty';
      none.textContent = tr('ui_ams_empty', 'Empty');
      row.appendChild(none);
      return;
    }

    trays.forEach(function (t) {
      var chip = document.createElement('div');
      chip.className = 'chip border';
      chip.id = 'ps-tray-' + t.id;
      if (isNum(s.tray_now) && s.tray_now === t.id) {
        chip.classList.add('is-now');
        chip.title = tr('ui_loaded', 'Loaded');
      }
      if (t.empty) chip.classList.add('is-empty');

      var dot = document.createElement('i');
      dot.className = 'circle small swatch-dot';
      var c = css_colour(t.colour);
      if (c) dot.style.background = c; else dot.classList.add('is-unset');
      chip.appendChild(dot);

      var text = document.createElement('span');
      /* The slot number is always there. An empty slot keeps its badge and says None (O7);
         a slot with a spool the printer has not described says so with the dash this page
         uses everywhere else rather than with a blank. */
      var parts = [];
      if (t.type) parts.push(t.type);
      if (t.sub && t.sub !== t.type) parts.push(t.sub);
      if (isNum(t.remain)) parts.push(fmtPct(t.remain));
      var what = t.empty ? tr('ui_none', 'None') : (parts.length ? parts.join(' · ') : DASH);
      text.textContent = (t.id + 1) + ' · ' + what;
      chip.appendChild(text);

      row.appendChild(chip);
    });
  }
  window.render_ams = render_ams;
})();
