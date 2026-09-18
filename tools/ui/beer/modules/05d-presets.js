/* =====================================================================
   PandaStatusOS web UI — PRESETS AND PRINT STAGES
   ---------------------------------------------------------------------
   Two routes, each behind its own switch and each answering with the
   whole truth after every change, so nothing here is ever assumed to
   have worked.

       GET  /api/presets    { presets:[ {...fx, name} ], max }
       POST /api/presets    { presets:[...] }            the whole list
                            { apply:{ name, state } }    one into one state

       GET  /api/stages     { stages:[ {...fx, slot, set, name} ], current }
       POST /api/stages     { assign:{ stage, name } }
                            { clear:{ stage } }
                            { stages:[ ...fifteen rows... ] }

   A preset is a copy, not a link: assigning one to a stage copies the
   effect and its name into that row, so deleting the preset afterwards
   leaves the stage exactly as it was. That is the device's own design
   and this page does not pretend otherwise.

   The slot order is the firmware's ps_gif_slot_names, which is also the
   order /api/print reports as its stage number. The device sends each
   row's slot name, so this list is only used to translate it, never to
   decide what the rows are.
   ================================================================= */

(function () {
  'use strict';

  var g_pre = null;        /* the last /api/presets document */
  var g_stg = null;        /* the last /api/stages document */
  var g_pre_asked = false, g_stg_asked = false;

  function feats() { return (window.fx_features && fx_features()) || {}; }

  function stage_label(slot) {
    if (typeof slot !== 'string' || !slot) return '';
    return tr('ui_stage_' + slot, slot.replace(/_/g, ' '));
  }

  function css_colour(w) {
    if (typeof w !== 'string' || !w) return '';
    var hex = w.charAt(0) === '#' ? w.slice(1) : w;
    return hex.length >= 6 ? '#' + hex.slice(0, 6) : '';
  }

  /* ---- talking to the device ----------------------------------- */

  function get(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 5000;
    x.onload = function () {
      if (x.status !== 200) { cb(null); return; }
      try { cb(JSON.parse(x.responseText)); } catch (e) { cb(null); }
    };
    x.onerror = function () { cb(null); };
    x.ontimeout = function () { cb(null); };
    try { x.send(); } catch (e) { cb(null); }
  }

  function post(url, body, cb) {
    var x = new XMLHttpRequest();
    x.open('POST', url, true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 6000;
    x.onload = function () {
      if (x.status === 200) {
        var doc = null;
        try { doc = JSON.parse(x.responseText); } catch (e) {}
        cb(doc, true);
        return;
      }
      /* Refused whole. Re-read rather than guess what stuck. */
      get(url, function (doc) { cb(doc, false); });
    };
    x.onerror = function () { cb(null, false); };
    x.ontimeout = function () { cb(null, false); };
    try { x.send(JSON.stringify(body)); } catch (e) { cb(null, false); }
  }

  function note(id, key, fallback) {
    var el = byId(id);
    if (!el) return;
    el.textContent = key ? tr(key, fallback) : '';
  }

  /* ---- presets -------------------------------------------------- */

  function preset_list() { return (g_pre && Array.isArray(g_pre.presets)) ? g_pre.presets : []; }
  function preset_max() { return (g_pre && isNum(g_pre.max)) ? g_pre.max : 8; }

  /* The whole list goes back, so a change is made on a copy of what the
     device last said, never on what this page last drew. */
  function send_list(list) {
    post('/api/presets', { presets: list }, function (doc) {
      if (doc) g_pre = doc;
      render_presets();
    });
  }

  function save_current() {
    var field = byId('ps-pre-name');
    var name = field ? String(field.value || '').trim() : '';
    var fx = window.fx_current ? fx_current() : null;
    /* No name is not an error worth a sentence: the field is where the
       answer goes, so the cursor goes there. */
    if (!name || !fx) { if (field) field.focus(); return; }
    var list = preset_list().slice();
    var row = { name: name };
    ['effect', 'brightness', 'speed', 'bright_end', 'opt', 'aux'].forEach(function (k) {
      if (isNum(fx[k])) row[k] = fx[k];
    });
    if (Array.isArray(fx.colours) && fx.colours.length === 4) row.colours = fx.colours.slice();
    var at = -1;
    for (var i = 0; i < list.length; i++) if (list[i].name === name) at = i;
    if (at >= 0) list[at] = row;
    else {
      if (list.length >= preset_max()) { note('ps-pre-note', 'ui_presets_full', 'Every slot is used. Delete one to save another.'); return; }
      list.push(row);
    }
    note('ps-pre-note', '', '');
    if (field) field.value = '';
    send_list(list);
  }

  function delete_preset(name) {
    send_list(preset_list().filter(function (p) { return p.name !== name; }));
  }

  function apply_preset(name) {
    var state = window.fx_state_now ? fx_state_now() : 0;
    post('/api/presets', { apply: { name: name, state: state } }, function (doc) {
      if (doc) g_pre = doc;
      /* The state's effect just changed on the device, so the effect cards
         above are stale until they re-read it. */
      if (window.refresh_features) refresh_features();
      else render_presets();
    });
  }

  function build_preset_rows() {
    var list = byId('ps-pre-list');
    if (!list) return;
    var rows = preset_list();
    list.textContent = '';
    if (!rows.length) {
      var empty = document.createElement('li');
      var t = document.createElement('div');
      t.className = 'max small-text';
      t.textContent = tr('ui_no_presets', 'No presets saved yet.');
      empty.appendChild(t);
      list.appendChild(empty);
      return;
    }
    rows.forEach(function (p) {
      var row = document.createElement('li');

      /* The same dot the printer rows use, so a colour reads the same
         everywhere on the page. */
      var sw = document.createElement('i');
      sw.className = 'circle small swatch-dot';
      var c = css_colour(Array.isArray(p.colours) ? p.colours[0] : '');
      if (c) sw.style.background = c; else sw.classList.add('is-unset');

      var text = document.createElement('div');
      text.className = 'max';
      text.textContent = p.name;
      var sub = document.createElement('div');
      sub.className = 'small-text';
      sub.textContent = tr('ui_fx_' + (p.effect || 0), '');
      text.appendChild(document.createElement('br'));
      text.appendChild(sub);

      var ap = document.createElement('button');
      ap.className = 'border small-round';
      ap.textContent = tr('ui_apply', 'Apply');
      ap.addEventListener('click', function () { apply_preset(p.name); });

      var del = document.createElement('button');
      del.className = 'border small-round';
      del.textContent = tr('ui_delete', 'Delete');
      del.addEventListener('click', function () { delete_preset(p.name); });

      row.appendChild(sw);
      row.appendChild(text);
      row.appendChild(ap);
      row.appendChild(del);
      list.appendChild(row);
    });
  }

  /* ---- the fifteen stages --------------------------------------- */

  function stage_rows() { return (g_stg && Array.isArray(g_stg.stages)) ? g_stg.stages : []; }

  function stage_now() {
    /* The print poll already knows; /api/stages carries it too, and the poll
       is the fresher of the two. */
    var p = window.g_last_print;
    if (p && isNum(p.stage) && p.stage >= 0) return p.stage;
    return (g_stg && isNum(g_stg.current)) ? g_stg.current : -1;
  }

  function assign_stage(i, name) {
    var body = name ? { assign: { stage: i, name: name } } : { clear: { stage: i } };
    post('/api/stages', body, function (doc) {
      if (doc) g_stg = doc;
      render_stages();
    });
  }

  function build_stage_rows() {
    var list = byId('ps-stg-list');
    if (!list) return;
    var rows = stage_rows();
    var names = preset_list().map(function (p) { return p.name; });

    /* Rebuilt only when the rows or the names available to them change:
       repainting on every poll would close a select under a finger. */
    var sig = rows.map(function (r) { return r.slot + ':' + (r.set ? r.name : ''); }).join('|') + '#' + names.join(',');
    if (list.dataset.sig !== sig) {
      list.textContent = '';
      rows.forEach(function (r, i) {
        var row = document.createElement('li');
        row.id = 'ps-stg-row-' + i;

        var text = document.createElement('div');
        text.className = 'max';
        text.textContent = stage_label(r.slot);
        /* The same shape the Features rows use: the name, then what it is. A key with no
           translation would show its own name back, so an absent one draws nothing. */
        var subKey = 'ui_stage_' + r.slot + '_sub';
        var subTxt = tr(subKey, '');
        if (subTxt && subTxt !== subKey) {
          var sub = document.createElement('div');
          sub.className = 'small-text';
          sub.textContent = subTxt;
          text.appendChild(document.createElement('br'));
          text.appendChild(sub);
        }

        var field = document.createElement('div');
        field.className = 'field suffix border small no-margin';
        var sel = document.createElement('select');
        sel.id = 'ps-stg-sel-' + i;
        sel.setAttribute('aria-label', stage_label(r.slot));

        var inh = document.createElement('option');
        inh.value = '';
        inh.textContent = tr('ui_inherit', 'Inherit');
        sel.appendChild(inh);

        /* A row can carry a name whose preset has since been deleted: the row
           keeps its copy, so the name is offered rather than silently lost. */
        var offer = names.slice();
        if (r.set && r.name && offer.indexOf(r.name) < 0) offer.push(r.name);
        offer.forEach(function (n) {
          var o = document.createElement('option');
          o.value = n;
          o.textContent = n;
          sel.appendChild(o);
        });
        sel.addEventListener('change', function () { assign_stage(i, sel.value); });

        var caret = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        caret.setAttribute('class', 'i');
        var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        use.setAttribute('href', '#i-caret');
        caret.appendChild(use);

        field.appendChild(sel);
        field.appendChild(caret);

        row.appendChild(text);
        row.appendChild(field);
        list.appendChild(row);
      });
      list.dataset.sig = sig;
    }

    var now = stage_now();
    rows.forEach(function (r, i) {
      var sel = byId('ps-stg-sel-' + i);
      if (sel && document.activeElement !== sel) sel.value = r.set ? (r.name || '') : '';
      var row = byId('ps-stg-row-' + i);
      if (row) row.classList.toggle('is-active', i === now);
    });
  }

  /* ---- what gets shown ------------------------------------------ */

  function render_presets() {
    var on = !!feats().presets;
    var card = byId('ps-pre-card');
    if (card) card.hidden = !on;
    if (on) {
      if (!g_pre && !g_pre_asked) { g_pre_asked = true; get('/api/presets', function (d) { if (d) g_pre = d; render_presets(); }); }
      build_preset_rows();
    }
    render_stages();
  }
  window.render_presets = render_presets;

  function render_stages() {
    var on = !!feats().stage_effects;
    var card = byId('ps-stg-card');
    if (card) card.hidden = !on;
    if (!on) return;
    if (!g_stg && !g_stg_asked) { g_stg_asked = true; get('/api/stages', function (d) { if (d) g_stg = d; render_stages(); }); }
    note('ps-stg-note', preset_list().length ? '' : 'ui_stages_need_presets',
         'Save a preset first. A stage is assigned by name.');
    build_stage_rows();
  }
  window.render_stages = render_stages;

  /* ---- wiring --------------------------------------------------- */

  function wire() {
    var save = byId('ps-pre-save');
    if (save) save.addEventListener('click', save_current);
    var field = byId('ps-pre-name');
    if (field) field.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); save_current(); }
    });
    /* The mark on the row the printer is in follows the print poll, which is
       the only thing on the page that knows the stage as it changes. */
    setInterval(function () {
      var card = byId('ps-stg-card');
      if (card && !card.hidden && g_stg) build_stage_rows();
    }, 2000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
