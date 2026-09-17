/* =====================================================================
   PandaStatusOS web UI — MODULE 8: Wi-Fi (station) card, Hotspot card
   and the setup Wi-Fi page — the inbound side
   ---------------------------------------------------------------------
   Everything the person does on these three surfaces: scan, join, save
   the host name, switch the hotspot, save the hotspot details, reveal a
   password, open a help note, move between the app and the setup page,
   and the one guess the page makes while a slow device is still saying
   nothing. Module 1 (core.js) renders every device push for these cards;
   this file never writes a value the device owns except the optimistic
   flip the spec asks for.

   Written from:
     private/SPEC/handler-contract.md   §0.1–0.7 (transport, first-state
       gate, landing, response envelope), §7 (Wi-Fi card: 7.1 first-use,
       7.3 inbound), §8.2 (Hotspot inbound), §12, §13
     private/SPEC/websocket-protocol.md §1.1, §2.1–2.3, §3, §5, §6.1,
       §6.3, §7.1 wifi, §7.2 sta, §7.3 ap, §9
     firmware/PROTOCOL.md (wifi / sta / ap inbound, responses, defaults)
     docs/network.md (the wording of the help notes)
     markup: pages/wifi.html, pages/setup.html, pages/hotspot.html,
       frame.html, global.html, sprite.svg
     stylesheets: project.css, app.css, theme.css, beer.trim.css
     harnesses: slowland.js, coldstart.js, layout.js, navsize.js, with
       mockdev.js and sweep.sh
     modules/core.js (module 1) for the surface this file calls into

   Attestation: written from private/SPEC and Jeremy's
   markup/CSS/harnesses; no vendor source opened.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. Constants and small helpers (own names; nothing here shadows
      module 1)
   ------------------------------------------------------------------- */

/* How long the page waits for the device's first state document before it
   guesses that the network card is the one to show (slowland.js: still
   on Status at 1.2 s, on the network card by 3.8 s, and the device's own
   answer overrules the guess whenever it lands). */
var NET_FALLBACK_MS = 2500;

/* A non-empty soft-AP password must be at least this long for WPA2; the
   device refuses shorter ones with response ok:0 (§8.2, P§7.3). Checked
   here so the person hears it before the round trip, not after. */
var NET_AP_PASSWORD_MIN = 8;

function net_el(id) { return document.getElementById(id); }

/* The device has said nothing yet while body.is-waiting (frame.html /
   app.css): ws_push is inert then, so a control that would send does
   nothing rather than pretending it did. The waiting banner says why. */
function net_ready() {
  return !(document.body && document.body.classList.contains('is-waiting'));
}

/* An input's or select's current value as a string, '' when absent. */
function net_val(id) {
  var el = net_el(id);
  if (!el || el.value === null || el.value === undefined) return '';
  return String(el.value);
}

/* Module 1's toast_show / dialog_open look a key up with the key itself
   as the fallback. Every string this module produces is resolved here
   first with tr(key, English), so a key the table does not carry still
   shows its English rather than its name; a resolved string handed back
   to tr() passes through unchanged. */
function net_toast(key, english, ms) {
  toast_show(tr(key, english), ms || 3000);
}

function net_dialog(titleKey, titleEn, textKey, textEn, btns) {
  dialog_open(tr(titleKey, titleEn), tr(textKey, textEn), btns);
}

/* Keyboard activation for an <a role="button" tabindex="0">. */
function net_is_activate_key(e) {
  return e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
}

/* ---------------------------------------------------------------------
   1. Password reveal (client-only, §7.3 / §8.2)
      Beer's suffix field: <div class="field label suffix border">
        <input type="password"> <label> <a><svg class="i"><use/></svg></a>
      The anchor is the control; the input's type flips between password
      and text and the sprite's eye / eye-off symbols say which.
   ------------------------------------------------------------------- */

function net_wire_eye(btnId, inputId, imgId) {
  var btn = net_el(btnId);
  var input = net_el(inputId);
  if (!btn || !input) return;

  function paint(shown) {
    var svg = net_el(imgId);
    var use = svg ? svg.querySelector('use') : null;
    if (use) use.setAttribute('href', shown ? '#i-eye-off' : '#i-eye');
    /* The title follows the state, and the data-str-title key with
       it, so a later language change keeps the two in step. */
    var key = shown ? 'ui_hide_the_password' : 'ui_show_the_password';
    btn.setAttribute('data-str-title', key);
    btn.setAttribute('title', tr(key, shown ? 'Hide the password' : 'Show the password'));
    btn.setAttribute('aria-pressed', shown ? 'true' : 'false');
  }

  function flip(e) {
    if (e) e.preventDefault();
    var show = (input.type !== 'text');
    input.type = show ? 'text' : 'password';
    paint(show);
  }

  paint(input.type === 'text');
  btn.addEventListener('click', flip);
  btn.addEventListener('keydown', function (e) { if (net_is_activate_key(e)) flip(e); });
}

/* ---------------------------------------------------------------------
   2. Help notes (the round "i" buttons). Text from docs/network.md.
   ------------------------------------------------------------------- */

function net_wire_note(btnId, titleKey, titleEn, textKey, textEn) {
  var btn = net_el(btnId);
  if (!btn) return;
  btn.addEventListener('click', function () {
    net_dialog(titleKey, titleEn, textKey, textEn, [{ key: 'ui_ok', fallback: 'OK' }]);
  });
}

function net_wire_notes() {
  net_wire_note('ps-note-sta-ip',
    'ui_address', 'Address',
    'ui_note_sta_ip_text',
    'The address the vent has on your network. Type it into a browser on any device on the same network. The router may hand out a different one after a restart; the host name stays the same.');

  net_wire_note('ps-note-hostname',
    'hostname', 'Host name',
    'ui_note_hostname_text',
    'The name the vent answers to on the network. Add .local to it in a browser on any device on the same network. It takes about a minute to register after a restart, so straight after an update use the address instead.');

  net_wire_note('ps-note-ap-ip',
    'ui_hotspot_address', 'Hotspot address',
    'ui_note_ap_ip_text',
    'The address the vent answers at when you are connected through its own hotspot. Change it only if it clashes with a range your own network already uses.');
}

/* ---------------------------------------------------------------------
   3. Wi-Fi (station) card and the setup Wi-Fi page (§7.3, P§7.1, P§7.2)
   ------------------------------------------------------------------- */

/* {"wifi":{"scan":1}}. The spinner goes on before the reply so the tap is
   seen to do something; module 1's paint_wifi_scan also remembers that a
   scan is in flight, which is what makes it raise the "scan ok" dialog
   when scan:2 comes back (§7.1). */
function net_wifi_scan() {
  if (!net_ready()) return;
  if (typeof paint_wifi_scan === 'function') paint_wifi_scan(1);
  ws_push('wifi', { scan: 1 });
}

/* {"wifi":{"ssid","password"}} from the select and the field. The device
   ignores an empty ssid (P§7.1), so it is refused here with a toast and
   nothing is sent. The join itself is reported later through sta.state,
   which module 1 turns into the connected / reconnecting / password
   dialogs; the toast is the only immediate sign the tap landed. */
function net_wifi_connect() {
  if (!net_ready()) return;
  var ssid = net_val('ps-wifi-ssid');
  if (!ssid) { net_toast('ui_choose_a_network_first', 'Choose a network first.'); return; }
  ws_push('wifi', { ssid: ssid, password: net_val('ps-password-wifi') });
  net_toast('ui_joining_the_network', 'Joining the network...');
}

/* {"sta":{"hostname"}}. The device answers response set_hostname, whose
   OK (module 1) restarts it. Empty is refused with a toast. */
function net_set_hostname() {
  if (!net_ready()) return;
  var name = net_val('ps-sta-hostname').trim();
  if (!name) { net_toast('ui_enter_a_host_name', 'Enter a host name first.'); return; }
  ws_push('sta', { hostname: name });
}

function net_wire_wifi() {
  var scan = net_el('ps-btn-wifi-scan');
  if (scan) scan.addEventListener('click', net_wifi_scan);

  var connect = net_el('ps-btn-wifi-connect');
  if (connect) connect.addEventListener('click', net_wifi_connect);

  var host = net_el('ps-btn-set-hostname');
  if (host) host.addEventListener('click', net_set_hostname);

  /* Client-only page moves (§7.3). */
  var config = net_el('ps-btn-wifi-config');
  if (config) config.addEventListener('click', function () { show_page('ps-page-wifi'); });

  var back = net_el('ps-btn-wifi-back');
  if (back) back.addEventListener('click', function () { show_page('ps-page-app'); });

  net_wire_eye('ps-btn-password-wifi', 'ps-password-wifi', 'ps-img-password-wifi');
}

/* ---------------------------------------------------------------------
   4. Hotspot card (§8.2, P§7.3)
   ------------------------------------------------------------------- */

/* The switch. On: {"ap":{"on":1}}, optimistically, the browser has
   already flipped it. Off: ask first, because dropping the hotspot drops
   anyone connected through it. The switch is put back ON while the
   question is open, so a dialog that is closed with its X or Escape
   (neither runs a button handler) leaves the switch agreeing with the
   device; only "Turn off" flips it and sends. */
function net_ap_switch_changed(e) {
  var sw = e.target;
  if (!sw) return;
  if (!net_ready()) { sw.checked = !sw.checked; return; }

  if (sw.checked) {
    ws_push('ap', { on: 1 });
    return;
  }

  sw.checked = true;
  net_dialog(
    'ui_turn_off_the_hotspot', 'Turn off the hotspot?',
    'ui_turn_off_the_hotspot_text',
    'With the hotspot off the vent can only be reached over your Wi-Fi. If you are connected through the hotspot now, you will be dropped.',
    [
      { key: 'cancel', fallback: 'Cancel' },
      { key: 'ui_turn_off', fallback: 'Turn off', handler: function () {
        sw.checked = false;
        ws_push('ap', { on: 0 });
      } }
    ]);
}

/* The three-field form: {"ap":{"ssid","password","ip"}}. The presence of
   ip is what makes the device answer set_hotspot_ip, whose OK (module 1)
   restarts it (P§7.3). Local checks: a name, a password of at least 8
   characters or none at all, an address. Then a confirmation, because
   saving drops anyone connected through the hotspot. */
function net_ap_save() {
  if (!net_ready()) return;
  var ssid = net_val('ps-ap-ssid').trim();
  var password = net_val('ps-password-ap');
  var ip = net_val('ps-ap-ip').trim();

  if (!ssid) { net_toast('ui_enter_a_network_name', 'Enter a network name first.'); return; }
  if (password.length > 0 && password.length < NET_AP_PASSWORD_MIN) {
    net_toast('ui_hotspot_password_too_short',
      'A hotspot password needs at least 8 characters, or leave it empty for an open network.', 4000);
    return;
  }
  if (!ip) { net_toast('ui_enter_an_address', 'Enter an address first.'); return; }

  net_dialog(
    'ui_save_hotspot_settings', 'Save hotspot settings?',
    'ui_save_hotspot_settings_text',
    'The vent applies the new hotspot details and then offers to restart. If you are connected through the hotspot, you will be dropped and will need to rejoin with the new details.',
    [
      { key: 'cancel', fallback: 'Cancel' },
      { key: 'ui_save', fallback: 'Save', handler: function () {
        ws_push('ap', { ssid: ssid, password: password, ip: ip });
      } }
    ]);
}

function net_wire_hotspot() {
  var sw = net_el('ps-btn-ap-on');
  if (sw) sw.addEventListener('change', net_ap_switch_changed);

  var save = net_el('ps-btn-ap-confirm');
  if (save) save.addEventListener('click', net_ap_save);

  net_wire_eye('ps-btn-password-ap', 'ps-password-ap', 'ps-img-password-ap');
}

/* ---------------------------------------------------------------------
   5. The network-card fallback landing (slowland.js)
      The page opens on Status (module 1). The real landing happens once,
      on the first frame carrying sta.state and printer.state (§0.4), and
      module 1 owns it. A device that is slow to say anything leaves the
      person looking at a Status card full of dashes, so after a moment
      the page guesses the network card instead. It is only a guess: it
      is not recorded as a landing, so module 1's answer still moves the
      page when it arrives, and it never fires once the device has spoken
      or once the person has picked a card of their own.
   ------------------------------------------------------------------- */

var g_net_fallback_timer = null;

function net_fallback_land() {
  g_net_fallback_timer = null;
  if (net_ready()) return;                                   /* the device answered */
  if (document.querySelector('[data-page].active:not(#ps-page-app)')) return;   /* a setup page is up */
  var cur = document.querySelector('[data-card].active');
  if (cur && cur.id !== 'ps-card-status') return;           /* the person already chose */
  show_card('sta');
}

/* ---------------------------------------------------------------------
   6. Boot: wire everything once the DOM is there, exactly as module 1
   ------------------------------------------------------------------- */

var g_net_wired = false;

function net_init() {
  if (g_net_wired) return;
  g_net_wired = true;
  net_wire_wifi();
  net_wire_hotspot();
  net_wire_notes();
  g_net_fallback_timer = setTimeout(net_fallback_land, NET_FALLBACK_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', net_init);
} else {
  net_init();
}
