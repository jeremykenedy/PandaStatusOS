'use strict';
/* Logs: the core's event ring, rendered newest first. Nothing here sends; nothing here
   reaches the device. The ring is masked at the source (core module): inbound frames are
   root names only, outbound credentials are lengths. This page only formats. */

(function () {
  var $ = function (id) { return document.getElementById(id); };
  var list, countEl, dirty = true;

  function two(n) { return (n < 10 ? '0' : '') + n; }
  function stamp(t) { var d = new Date(t); return two(d.getHours()) + ':' + two(d.getMinutes()) + ':' + two(d.getSeconds()) + '.' + String(d.getMilliseconds() + 1000).slice(1); }
  function line(e) {
    switch (e.kind) {
      case 'open': return PS.tr('ps_logs_open');
      case 'close': return PS.tr('ps_logs_close');
      case 'bad': return PS.tr('ps_logs_bad') + ' ' + e.bytes;
      case 'in': return PS.tr('ps_logs_in') + ' ' + e.roots.join(', ');
      case 'response': return PS.tr('ps_logs_response') + ' ' + e.type + ' ' + (e.ok === 1 ? PS.tr('ps_logs_ok') : PS.tr('ps_logs_failed'));
      case 'out': return PS.tr('ps_logs_out') + ' ' + e.root + ' ' + JSON.stringify(e.members);
      default: return e.kind;
    }
  }
  function text() {
    var out = [];
    for (var i = PS.log.length - 1; i >= 0; i--) out.push(stamp(PS.log[i].t) + '  ' + line(PS.log[i]));
    return out.join('\n');
  }
  function render() {
    if (!list) return;
    list.textContent = text();
    countEl.textContent = PS.log.length + ' / 200';
    dirty = false;
  }

  function wire() {
    list = $('ps-logs-list'); countEl = $('ps-logs-count');
    $('ps-logs-clear').addEventListener('click', function () { PS.clearLog(); });
    $('ps-logs-copy').addEventListener('click', function () {
      var t = text();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { PS.toast(PS.tr('ps_logs_copied')); }, function () { PS.toast(PS.tr('ps_logs_copy_failed')); });
      } else PS.toast(PS.tr('ps_logs_copy_failed'));
    });
    window.addEventListener('hashchange', function () { if (dirty && location.hash === '#logs') render(); });
    render();
  }

  // render only while the card is in view; a busy socket must not repaint a hidden page
  PS.on('log', function () { if (location.hash === '#logs') render(); else dirty = true; });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
