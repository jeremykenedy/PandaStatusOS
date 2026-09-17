/* =====================================================================
   PandaStatusOS web UI — FEATURES
   ---------------------------------------------------------------------
   One switch per addition beyond the factory application. Every one is off
   on a new device and off again after a factory reset, because they live
   in the config blob (ps_cfg.c) and a reset clears it.

       GET  /api/features   { features:{ name: bool, ... }, config:{...} }
       POST /api/features   { features:{ name: bool } }

   The rows are BUILT from the names the device returns, not listed here.
   A bit the firmware gains appears without this file being edited, and a
   bit it loses stops being offered. The order is the order the device
   sends, which is bit order (ps_api.c FEATURES[]), so the list reads the
   way the firmware is laid out.

   A name with no label falls back to itself rather than to an empty row,
   so a new bit is visible and usable the day it lands, just unpolished.
   ================================================================= */

(function () {
  'use strict';

  var g_busy = false;

  function post_one(name, on, row) {
    if (g_busy) return;
    g_busy = true;
    var body = { features: {} };
    body.features[name] = !!on;

    var x = new XMLHttpRequest();
    x.open('POST', '/api/features', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 6000;
    var done = function (doc) {
      g_busy = false;
      if (doc) {
        /* Render what came back, never what was clicked. The route applies a
           document whole or refuses it whole, and a switch that shows the
           click rather than the answer lies whenever the answer is no. */
        render_features(doc);
        if (window.render_effects && window.refresh_features) window.refresh_features();
      } else {
        refresh();
      }
    };
    x.onload = function () {
      var doc = null;
      if (x.status === 200) { try { doc = JSON.parse(x.responseText); } catch (e) {} }
      done(doc);
    };
    x.onerror = function () { done(null); };
    x.ontimeout = function () { done(null); };
    try { x.send(JSON.stringify(body)); } catch (e) { done(null); }
  }

  function render_features(doc) {
    var list = byId('ps-feat-list');
    if (!list) return;
    var f = (doc && doc.features) || null;
    if (!f) { list.textContent = ''; return; }

    var names = [];
    for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) names.push(k);

    /* Rebuilt only when the set of names changes. Repainting every row on every
       answer would take a switch out from under a finger mid-press. */
    var sig = names.join(',');
    if (list.dataset.sig !== sig) {
      list.textContent = '';
      names.forEach(function (name) {
        /* The vent's own row: a list item with a .max label and a switch. No class of
           our own, because project.css already styles this one everywhere else. */
        var row = document.createElement('li');

        var text = document.createElement('div');
        text.className = 'max';
        text.id = 'lbl-feat-' + name;
        text.textContent = tr('ui_feat_' + name, name);

        var subTxt = tr('ui_feat_' + name + '_sub', '');
        if (subTxt && subTxt !== 'ui_feat_' + name + '_sub') {
          var sub = document.createElement('div');
          sub.className = 'small-text';
          sub.textContent = subTxt;
          text.appendChild(document.createElement('br'));
          text.appendChild(sub);
        }

        var label = document.createElement('label');
        label.className = 'switch';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'ps-feat-' + name;
        input.setAttribute('aria-labelledby', text.id);
        input.addEventListener('change', function () { post_one(name, input.checked, row); });
        label.appendChild(input);
        label.appendChild(document.createElement('span'));

        row.appendChild(text);
        row.appendChild(label);
        list.appendChild(row);
      });
      list.dataset.sig = sig;
    }

    names.forEach(function (name) {
      var el = byId('ps-feat-' + name);
      if (el && document.activeElement !== el) el.checked = !!f[name];
      else if (el) el.checked = !!f[name];
    });
  }
  window.render_features = render_features;

  function refresh() {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/features', true);
    x.timeout = 5000;
    x.onload = function () {
      if (x.status !== 200) return;
      try { render_features(JSON.parse(x.responseText)); } catch (e) {}
    };
    /* A device that does not answer this route is a device without the clone's
       own surface. Nothing to report: the card simply stays empty. */
    try { x.send(); } catch (e) {}
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refresh);
  else refresh();
})();
