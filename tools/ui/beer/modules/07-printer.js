/* =====================================================================
   PandaStatusOS web UI — MODULE 7: Printer card, inbound side
   ---------------------------------------------------------------------
   The user's half of the Printer card: the scan button, the printer
   picker, the bind / unbind button and the card's help note. Module 1
   (core.js) paints every device push for this card — the fields, the
   bind state, the scan state and the scan list — so this file only turns
   what the user does into messages and asks module 1 for the optimistic
   repaint the spec calls for. It opens no socket and renders no push.

   Written from private/SPEC/handler-contract.md §0.4 (first-state gate),
   §0.6 (dialog / toast), §6.1–6.3 (what module 1 paints), §6.4 (what this
   card sends), §12 (single-key messages, optimistic settle); and
   private/SPEC/websocket-protocol.md §1.1 (single-key rule), §2.4
   (printer fields), §3 (scan-result document), §6.2 (printer.state),
   §6.3 (printer.scan), §7.4 (the three printer messages), §9 (what each
   one answers with). The help note is docs/printer.md in fewer words.

   Attestation: written from private/SPEC and Jeremy's markup/CSS/harnesses;
   no vendor source opened.

   Module 1's surface used here: ws_push, tr, dialog_open,
   toast_show, paint_printer_scan, paint_printer_bind, and g_state (read
   only). Everything else in this file is its own, prefixed pcard_.
   ===================================================================== */

/* printer.state values this file has to tell apart (P§6.2). */
var PCARD_STATE_UNBOUND = 1;
var PCARD_STATE_BINDING = 2;
var PCARD_STATE_BOUND = 3;

var g_pcard_wired = false;

function pcard_el(id) { return document.getElementById(id); }

/* Before the first state document lands the page is waiting (§0.4) and
   ws_push drops every frame. Nothing here may act then: an
   optimistic repaint with no message behind it would show a state the
   device was never asked for. */
function pcard_ready() {
  return !!(document.body && !document.body.classList.contains('is-waiting'));
}

/* The printer section of the merged state document (P§2.4), or an empty
   object before one has arrived. */
function pcard_printer() {
  return (typeof g_state === 'object' && g_state && g_state.printer) ? g_state.printer : {};
}

/* A text field's value, trimmed. */
function pcard_field(id) {
  var el = pcard_el(id);
  return el ? String(el.value == null ? '' : el.value).trim() : '';
}

/* Write a text field, never while it has focus (§12). */
function pcard_set_field(id, val) {
  var el = pcard_el(id);
  if (!el || document.activeElement === el) return;
  el.value = (val === null || val === undefined) ? '' : String(val);
}

/* ---------------------------------------------------------------------
   Scan (§6.4, P§7.4): {"printer":{"scan":1}}. The spinner goes on now;
   the scan-result document (P§3) is what module 1 settles it with.
   ------------------------------------------------------------------- */

function pcard_on_scan() {
  if (!pcard_ready()) return;
  ws_push('printer', { scan: 1 });
  paint_printer_scan(1);
}

/* ---------------------------------------------------------------------
   The picker. Module 1 rebuilds the options from the scan list (value =
   serial, label = name) and keeps only that much in the DOM, so the
   per-printer fields come from the scan list held in the state document
   (the scan reply merges into g_state.printer; arrays replace, so the
   last scan is the one there). A serial that is also the bound printer's
   fills in from the state document whatever the scan did not report,
   which is how a stored access code survives picking that printer again.
   ------------------------------------------------------------------- */

function pcard_entry_for(sn) {
  if (!sn) return null;
  var p = pcard_printer();
  var list = Array.isArray(p.list) ? p.list : [];
  var scanned = null;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].sn === sn) { scanned = list[i]; break; }
  }
  var current = (p.sn === sn) ? p : null;
  if (!scanned && !current) return null;
  function pick(key) {
    if (scanned && scanned[key]) return scanned[key];
    if (current && current[key]) return current[key];
    return '';
  }
  return { sn: sn, access_code: pick('access_code'), ip: pick('ip') };
}

function pcard_on_pick() {
  var sel = pcard_el('ps-printer-name');
  if (!sel) return;
  var entry = pcard_entry_for(sel.value);
  if (!entry) return;   /* the markup's placeholder option, or one nobody described */
  pcard_set_field('ps-printer-sn', entry.sn);
  pcard_set_field('ps-printer-access-code', entry.access_code);
  pcard_set_field('ps-printer-ip', entry.ip);
}

/* ---------------------------------------------------------------------
   Bind / unbind (§6.4). One button, three meanings by printer.state:
   bound (3) asks before disconnecting; connecting (2) has no action the
   spec defines, so a click does nothing; every other state binds.
   ------------------------------------------------------------------- */

function pcard_on_bind() {
  if (!pcard_ready()) return;
  var state = pcard_printer().state;
  if (state === PCARD_STATE_BOUND) { pcard_confirm_unbind(); return; }
  if (state === PCARD_STATE_BINDING) return;
  pcard_bind();
}

/* The display name is the picker's label for the chosen serial. When the
   picker has nothing in it (a scan that found no printers, nothing bound)
   the serial stands in, the same label module 1 gives an option with no
   name, so the device is never asked to store a printer with no name. */
function pcard_name() {
  var sel = pcard_el('ps-printer-name');
  var opt = (sel && sel.selectedIndex >= 0) ? sel.options[sel.selectedIndex] : null;
  return opt ? String(opt.textContent || '').trim() : '';
}

function pcard_bind() {
  var sn = pcard_field('ps-printer-sn');
  var code = pcard_field('ps-printer-access-code');
  var ip = pcard_field('ps-printer-ip');
  if (!sn || !code || !ip) {
    toast_show(tr('ui_fill_in_the_serial_number_access_c',
      'Fill in the serial number, access code and IP address first.'), 3000);
    return;
  }
  var name = pcard_name() || sn;
  ws_push('printer', { name: name, sn: sn, access_code: code, ip: ip });
  paint_printer_bind(PCARD_STATE_BINDING);   /* optimistic; the next push settles it (§6.2) */
}

/* dialog_open and toast_show look a key up and fall back to the bare
   key, so the strings are resolved here first, with their English, and
   handed over ready to show; a resolved string passes through the lookup
   untouched. The keys are still the translation keys. */
function pcard_confirm_unbind() {
  dialog_open(
    tr('ui_unbind_this_printer', 'Unbind this printer?'),
    tr('ui_the_vent_clears_the_stored_binding',
      'The vent clears the stored binding and stops talking to the printer. You can bind it again from this page.'),
    [
      { key: 'cancel', fallback: 'Cancel' },
      { key: 'ui_unbind', fallback: 'Unbind', handler: pcard_unbind }
    ]);
}

function pcard_unbind() {
  if (!pcard_ready()) return;
  ws_push('printer', { disconnect: 1 });
  paint_printer_bind(PCARD_STATE_UNBOUND);   /* optimistic; disconnect answers with a state push (P§9) */
}

/* ---------------------------------------------------------------------
   The help note (§6.4 ps-note-printer), from docs/printer.md.
   ------------------------------------------------------------------- */

function pcard_on_note() {
  dialog_open(
    tr('ui_bind_to_a_printer', 'Bind to a printer'),
    tr('ui_the_vent_talks_to_the_printer_dire',
      'The vent talks to the printer directly over your own network; nothing goes through Bambu\'s cloud. ' +
      'Scan finds Bambu printers on the network and fills in the serial number; the LAN access code is on the printer ' +
      'under Settings, Network, LAN Only Mode, and it changes if LAN Only Mode is turned off and on again.'),
    [{ key: 'ui_ok', fallback: 'OK' }]);
}

/* ---------------------------------------------------------------------
   Boot: wire the four controls once the DOM is there. The picker's
   options are rebuilt by module 1 on every scan, so its listener sits
   on the <select> itself, which stays.
   ------------------------------------------------------------------- */

function pcard_init() {
  if (g_pcard_wired) return;
  g_pcard_wired = true;
  var scan = pcard_el('ps-btn-printer-scan');
  if (scan) scan.addEventListener('click', pcard_on_scan);
  var picker = pcard_el('ps-printer-name');
  if (picker) picker.addEventListener('change', pcard_on_pick);
  var bind = pcard_el('ps-btn-printer-bind');
  if (bind) bind.addEventListener('click', pcard_on_bind);
  var note = pcard_el('ps-note-printer');
  if (note) note.addEventListener('click', pcard_on_note);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', pcard_init);
} else {
  pcard_init();
}
