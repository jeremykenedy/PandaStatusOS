/* =====================================================================
   PandaStatusOS web UI — THE VENT BRIDGE, the page's half

       GET  /api/bridge   { self, link, bound, pair, vent, found, scanning }
       POST /api/bridge   {"scan":true} | {"bind":{ip|id}} | {"pair":{confirm|cancel}}
                          | {"unbind":true} | {"copy":{what,state}}

   The contract between the two devices is docs/PANDAVENT-BRIDGE.md and this
   page speaks none of it: the device holds the socket, the token and the
   state machine, and the page asks it what is going on. That is the same
   division the printer bind keeps, and it is why a vent that moves, drops
   or refuses is the device's problem to report rather than this page's to
   discover.

   The card is behind the bridge switch, which is bit 0 and defaults off.
   With it off the route is a redirect like every other gated one, and the
   card is not on the page at all: a device that cannot reach a vent should
   not have a place to type one in.

   Three blocks appear and disappear as the link moves, and each exists
   only while it has something to say:
     - the link row, once there is something bound
     - the pairing block, only while six digits are waiting for a person
     - the two copy buttons, only while a vent is actually talking, because
       there is nothing to copy from otherwise

   Polled, not pushed: the bridge is not one of the factory's six roots and
   nothing on the socket carries it. Two seconds while the page is open, and
   nothing at all while it is not.
   ================================================================= */

(function () {
  'use strict';

  var POLL_MS = 2000;
  var g_timer = null;
  var g_doc = null;
  var g_card_shown = false;

  /* The link, in the device's own numbering. 0, 2, 3 and 4 mean what they mean for the
     printer and borrow its words; 5 and 6 are a vent's own and have their own. */
  var LINK_WORD = {
    0: ['ui_link_state_0', 'Unbound'],
    2: ['ui_link_state_2', 'Connecting'],
    3: ['ui_link_state_3', 'Connected'],
    4: ['ui_link_state_4', 'IP error'],
    5: ['ui_vent_wrong_one', 'A different vent answered at that address'],
    6: ['ui_vent_unpaired', 'Not paired yet'],
  };

  function el(id) { return document.getElementById(id); }
  function show(id, on) { var e = el(id); if (e) e.hidden = !on; }

  function get(after) {
    var x = new XMLHttpRequest();
    x.open('GET', '/api/bridge', true);
    x.timeout = 4000;
    x.onload = function () {
      var d = null;
      /* The switch being off is a 302 the browser follows, so what arrives is the page's own
         HTML with a 200. Parsing is the test, not the status. */
      if (x.status === 200) { try { d = JSON.parse(x.responseText); } catch (e) { d = null; } }
      render(d);
      if (after) after(d);
    };
    x.onerror = function () {};
    x.ontimeout = function () {};
    try { x.send(); } catch (e) {}
  }

  function post(body, after) {
    var x = new XMLHttpRequest();
    x.open('POST', '/api/bridge', true);
    x.setRequestHeader('Content-Type', 'application/json');
    x.timeout = 6000;
    x.onload = function () {
      if (x.status === 200) {
        var d = null;
        try { d = JSON.parse(x.responseText); } catch (e) { d = null; }
        render(d);
        if (after) after(d);
        return;
      }
      /* A refusal says so out loud. The device answers 400 with a reason it does not
         translate, so what is shown is this page's own sentence, not the device's. */
      toast_show('ui_command_failed', 4000, 'Command failed');
    };
    x.onerror = function () {};
    x.ontimeout = function () {};
    try { x.send(JSON.stringify(body)); } catch (e) {}
  }

  /* ---------------------------------------------------------------- render */

  function render(d) {
    var card = el('ps-card-vent');
    if (!d || typeof d.link !== 'number') {
      if (card) card.hidden = true;
      stop();                      /* the route is not there: stop asking for it */
      return;
    }
    g_doc = d;
    if (card) card.hidden = false;

    /* The found list. A scan that found nothing leaves one row saying so rather than an
       empty select, which reads as a page that has not loaded. */
    var sel = el('ps-vent-name');
    if (sel && document.activeElement !== sel) {
      var want = (d.found || []).map(function (v) { return (v.name || v.ip) + '|' + v.ip; }).join(',');
      if (sel.getAttribute('data-filled') !== want) {
        sel.setAttribute('data-filled', want);
        sel.textContent = '';
        var none = document.createElement('option');
        none.value = '';
        none.textContent = d.scanning ? tr('ui_scanning', 'Scanning...') : tr('ui_none', 'None');
        sel.appendChild(none);
        (d.found || []).forEach(function (v) {
          var o = document.createElement('option');
          o.value = v.ip;
          o.textContent = (v.name || tr('ui_vent', 'Vent')) + (v.ip ? ' · ' + v.ip : '');
          sel.appendChild(o);
        });
        if (d.bound && d.bound.ip) sel.value = d.bound.ip;
      }
    }

    var bound = !!(d.bound && (d.bound.ip || d.bound.id));
    var ip = el('ps-vent-ip');
    if (ip && document.activeElement !== ip && bound) ip.value = d.bound.ip || '';

    /* One button, two meanings, the way the printer's is: bind what has been typed or
       picked, or let go of what is bound. */
    setText('ps-span-vent-bind', bound ? tr('ui_unbind', 'Unbind') : tr('ui_bind', 'Bind'));
    var img = el('ps-img-vent-bind');
    if (img) { var u = img.querySelector('use'); if (u) u.setAttribute('href', bound ? '#i-link' : '#i-link-off'); }

    show('ps-vent-link-row', bound);
    var w = LINK_WORD[d.link] || LINK_WORD[0];
    setText('ps-vent-link', tr(w[0], w[1]));

    /* The pairing block, only while a code is live. The countdown is the device's own
       `left`, not a timer started here, so a pairing cancelled from the vent is noticed. */
    var pairing = !!(d.pair && d.pair.code);
    show('ps-vent-pair', pairing);
    if (pairing) {
      setText('ps-vent-code', d.pair.code);
      setText('ps-vent-code-left', d.pair.left > 0 ? d.pair.left + ' s' : '');
    }

    /* The copies, only while the vent is actually talking. */
    show('ps-vent-copy', d.link === 3 && !!d.vent);
  }

  /* ---------------------------------------------------------------- actions */

  function scan() {
    var img = el('ps-img-scan-vent');
    if (img) img.classList.add('is-spinning');
    post({ scan: true }, function () {
      /* The device answers at once and fills the list a moment later, so one extra read
         rather than a spinner that never stops. */
      setTimeout(function () {
        get();
        if (img) img.classList.remove('is-spinning');
      }, 900);
    });
  }

  function bind() {
    if (g_doc && g_doc.bound && (g_doc.bound.ip || g_doc.bound.id)) { post({ unbind: true }); return; }
    var typed = (el('ps-vent-ip') || {}).value || '';
    var picked = (el('ps-vent-name') || {}).value || '';
    var addr = typed.trim() || picked;
    if (!addr) { toast_show('ui_vent_help', 4000, 'Pick a vent, or type its address.'); return; }
    post({ bind: { ip: addr } });
  }

  function confirmPair() { post({ pair: { confirm: true } }); }
  function cancelPair() { post({ pair: { cancel: true } }); }

  function copyColours() { post({ copy: { what: 'colours' } }, function () { if (window.refresh_features) refresh_features(); }); }

  function copyEffect() {
    /* Which state it lands in is the one the effect editor has selected, for the same
       reason the preview uses it: the two are always used together. */
    var st = (typeof window.fx_state_now === 'function') ? Number(fx_state_now()) : 0;
    if (!(st >= 0 && st <= 2)) st = 0;
    post({ copy: { what: 'effect', state: st } }, function () { if (window.refresh_features) refresh_features(); });
  }

  /* ---------------------------------------------------------------- the poll */

  function stop() { if (g_timer) { clearInterval(g_timer); g_timer = null; } }

  function start() {
    stop();
    get();
    g_timer = setInterval(function () {
      if (typeof document.hidden === 'boolean' && document.hidden) return;
      get();
    }, POLL_MS);
  }

  /* A card is open exactly when it wears .active, which catches every way of opening it:
     the rail, the bottom bar, the keyboard and a bare show_card('printer'). */
  function watch() {
    var card = document.getElementById('ps-card-printer');
    if (!card || typeof MutationObserver !== 'function') return;
    g_card_shown = card.classList.contains('active');
    new MutationObserver(function () {
      var on = card.classList.contains('active');
      if (on && !g_card_shown) start();
      if (!on && g_card_shown) stop();
      g_card_shown = on;
    }).observe(card, { attributes: true, attributeFilter: ['class'] });
  }

  function wire(id, ev, fn) { var e = el(id); if (e) e.addEventListener(ev, fn); }

  function init() {
    wire('ps-btn-vent-scan', 'click', scan);
    wire('ps-btn-vent-bind', 'click', bind);
    wire('ps-btn-vent-confirm', 'click', confirmPair);
    wire('ps-btn-vent-cancel', 'click', cancelPair);
    wire('ps-btn-vent-copy-colours', 'click', copyColours);
    wire('ps-btn-vent-copy-effect', 'click', copyEffect);
    watch();
    if (g_card_shown) start();
    window.bridge_refresh = get;          /* the harness, and anything else that needs a read */
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
