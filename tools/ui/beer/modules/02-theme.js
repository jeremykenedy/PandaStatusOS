/* =====================================================================
   PandaStatusOS web UI — MODULE 2: theme + client-only chrome
   ---------------------------------------------------------------------
   The parts of the page that never talk to the device: the light/dark
   preference and the three-way control that sets it, the top-bar theme
   button that cycles it, the nav rail's pin, the accessible names of the
   nav items, and the top-bar state pill that goes to the Status card.

   Written from private/SPEC/handler-contract.md §4 (Theme card,
   client-only, no device push) and §0.7 (the client-only top-bar ids:
   ps-top-pill, ps-top-theme, ps-top-theme-icon, ps-top-mark,
   ps-top-mark-dark, ps-nav, ps-nav-toggle), against frame.html and
   pages/settings.html, with the DOM mechanisms taken from project.css
   (§6 nav labels, §19 marks + body theme class, §30 segmented control,
   §38 chrome surface, §41 active nav item, §42 hit targets), theme.css
   (tokens keyed on body.light / body.dark / no class), app.css and Beer's
   beer.trim.css (nav.left, nav.max, button cursor).

   Nothing here sends a message. Module 1 (core.js) owns the socket, the
   state document, i18n (tr), navigation (show_card) and the dialog.
   This module only uses those globals.

   Attestation: written from private/SPEC and Jeremy's markup/CSS/harnesses;
   no vendor source opened.
   ===================================================================== */

/* ---------------------------------------------------------------------
   0. Small helpers local to this module
   ------------------------------------------------------------------- */

function chrome_node(id) { return document.getElementById(id); }

function chrome_store_get(key) {
  try { return window.localStorage ? localStorage.getItem(key) : null; } catch (e) { return null; }
}

function chrome_store_set(key, val) {
  try {
    if (!window.localStorage) return;
    if (val === null || val === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch (e) {}
}

/* Point an <svg><use> at another sprite symbol. The markup writes `href`,
   so that is the attribute written here. */
function chrome_use_href(svgId, href) {
  var svg = chrome_node(svgId);
  if (!svg) return;
  var use = svg.querySelector('use');
  if (use) use.setAttribute('href', href);
}

/* ---------------------------------------------------------------------
   1. Theme preference: auto / light / dark (§4)

   The preference is a browser thing, kept in localStorage under pv_theme.
   Beer and theme.css read the theme from a class on <body>: `light`,
   `dark`, or NO class for auto, in which case prefers-color-scheme
   decides (theme.css, project.css §19). Auto is deliberately the absence
   of a class rather than a third class, so a page loaded on a light
   machine paints light from its first frame.
   ------------------------------------------------------------------- */

var THEME_STORE_KEY = 'pv_theme';
var THEME_PREFS = ['auto', 'light', 'dark'];

/* the icon the top-bar button shows for each state (sprite symbol ids) */
var THEME_ICON = { auto: '#i-theme', light: '#i-theme-light', dark: '#i-theme-dark' };

/* the three segments of the Appearance control (pages/settings.html) */
var THEME_SEGMENT = { auto: 'ps-theme-auto', light: 'ps-theme-light', dark: 'ps-theme-dark' };

/* the word for each state; the keys are the ones the segment labels carry */
var THEME_WORD_KEY = { auto: 'appearance_auto', light: 'appearance_light', dark: 'appearance_dark' };
var THEME_WORD_EN = { auto: 'Auto', light: 'Light', dark: 'Dark' };

var g_theme_pref = 'light';
var g_theme_media = null;

function theme_valid(pref) {
  return THEME_PREFS.indexOf(pref) >= 0;
}

/* The stored preference, or auto when nothing sensible is stored. */
function theme_read_store() {
  var v = chrome_store_get(THEME_STORE_KEY);
  /* Light is this app's default. Auto is a choice, not the starting point:
     a vent's page is read in a workshop, and the machine's own dark setting
     is a poor guess at what the page should be. */
  return theme_valid(v) ? v : 'light';
}

function theme_word(pref) {
  return tr(THEME_WORD_KEY[pref], THEME_WORD_EN[pref]);
}

/* The body class is the theme. Only `light` and `dark` are ever put on
   the body and nothing else is; auto removes both and adds nothing. */
function theme_body_class(pref) {
  var body = document.body;
  if (!body) return;
  body.classList.remove('light');
  body.classList.remove('dark');
  if (pref === 'light' || pref === 'dark') body.classList.add(pref);
}

/* Mark the chosen segment: aria-checked for the radio semantics the
   markup declares, is-on for the look project.css §30 gives it. */
function theme_segments_paint(pref) {
  for (var p in THEME_SEGMENT) {
    if (!Object.prototype.hasOwnProperty.call(THEME_SEGMENT, p)) continue;
    var btn = chrome_node(THEME_SEGMENT[p]);
    if (!btn) continue;
    var on = (p === pref);
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-checked', on ? 'true' : 'false');
  }
}

/* The top-bar button is a readout as much as a control: its icon names
   the state, and its accessible name says it in words. The `title` is
   left to the markup's data-str-title (module 1's translate pass
   owns it), so the two never fight. */
function theme_button_paint(pref) {
  chrome_use_href('ps-top-theme-icon', THEME_ICON[pref]);
  var btn = chrome_node('ps-top-theme');
  if (btn) btn.setAttribute('aria-label', tr('ui_theme', 'Theme') + ': ' + theme_word(pref));
}

/* Everything that shows the theme, from one preference. The brand marks
   are not touched here: project.css §19 swaps them off the body class. */
function theme_paint(pref) {
  theme_body_class(pref);
  theme_segments_paint(pref);
  theme_button_paint(pref);
}

/* Pick a theme: remember it, then show it. */
function theme_choose(pref) {
  if (!theme_valid(pref)) pref = 'light';
  g_theme_pref = pref;
  chrome_store_set(THEME_STORE_KEY, pref);
  theme_paint(pref);
}

/* The top-bar button's one tap: auto -> light -> dark -> auto. */
function theme_advance() {
  var i = THEME_PREFS.indexOf(g_theme_pref);
  theme_choose(THEME_PREFS[(i + 1) % THEME_PREFS.length]);
}

/* Auto follows the system live. The CSS already does the painting
   through prefers-color-scheme; this repaint keeps anything written by
   script in step with it and costs nothing when the preference is not
   auto. */
function theme_watch_system() {
  if (!window.matchMedia) return;
  var mql;
  try { mql = window.matchMedia('(prefers-color-scheme: dark)'); } catch (e) { return; }
  if (!mql) return;
  g_theme_media = mql;
  var onChange = function () { if (g_theme_pref === 'auto') theme_paint('auto'); };
  if (typeof mql.addEventListener === 'function') mql.addEventListener('change', onChange);
  else if (typeof mql.addListener === 'function') mql.addListener(onChange);
}

/* ---------------------------------------------------------------------
   2. The nav rail's pin (frame.html ps-nav / ps-nav-toggle)

   Beer lays the rail out from `nav.left`; its expanded form is the same
   nav wearing `max` (beer.trim.css: nav.max:is(.left,...) widens to
   12.75rem and lays each item out as a row). Pinning is that one class,
   remembered under pv_nav so a reload comes back the way it was left.
   ------------------------------------------------------------------- */

var NAV_STORE_KEY = 'pv_nav';
var NAV_PINNED_CLASS = 'max';
var NAV_STORE_PINNED = 'max';   /* the stored value names the class it restores */

function nav_read_store() {
  return chrome_store_get(NAV_STORE_KEY) === NAV_STORE_PINNED;
}

function nav_is_pinned() {
  var nav = chrome_node('ps-nav');
  return !!(nav && nav.classList.contains(NAV_PINNED_CLASS));
}

/* Show the rail pinned or at rest, and let the toggle say which. The
   toggle's icon is the one the markup gives it; only its state and its
   name change. */
function nav_pin_paint(pinned) {
  var nav = chrome_node('ps-nav');
  if (nav) nav.classList.toggle(NAV_PINNED_CLASS, !!pinned);
  var btn = chrome_node('ps-nav-toggle');
  if (btn) {
    btn.setAttribute('aria-expanded', pinned ? 'true' : 'false');
    var label = pinned ? tr('ui_menu_unpin', 'Unpin the menu') : tr('ui_menu_pin', 'Pin the menu open');
    btn.setAttribute('aria-label', label);
    btn.setAttribute('title', label);
  }
}

function nav_pin_set(pinned) {
  chrome_store_set(NAV_STORE_KEY, pinned ? NAV_STORE_PINNED : null);
  nav_pin_paint(!!pinned);
}

function nav_pin_toggle() {
  nav_pin_set(!nav_is_pinned());
}

/* ---------------------------------------------------------------------
   3. The accessible names this module writes on the chrome

   The bottom bar hides each item's word (project.css §6: `nav.bottom > a
   > span { display: none }`) and says the label stays in the markup so
   the script can turn it into the item's accessible name and tooltip.
   That is nav_names_sync. It reads the word from the item's own span, so
   a translated page names the items in that language.

   Module 1's translate pass (set_language -> apply_translations) rewrites
   every [data-str] span, the nav's among them, and announces
   nothing. The watcher below takes that rewrite of the nav's spans as
   the signal and says every name this module writes again, in the new
   language: the items, the rail's pin, the theme button.
   ------------------------------------------------------------------- */

function nav_names_sync() {
  var items = document.querySelectorAll('[data-nav]');
  for (var i = 0; i < items.length; i++) {
    var span = items[i].querySelector('span');
    var word = span ? (span.textContent || '').trim() : '';
    if (!word) continue;
    items[i].setAttribute('aria-label', word);
    items[i].setAttribute('title', word);
  }
}

/* Every label this module writes, in the current language. */
function chrome_names_sync() {
  nav_names_sync();
  nav_pin_paint(nav_is_pinned());
  theme_button_paint(g_theme_pref);
}

function chrome_names_watch() {
  if (typeof MutationObserver !== 'function') return;
  var hosts = [chrome_node('ps-nav'), document.querySelector('nav.bottom')];
  var mo = new MutationObserver(function () { chrome_names_sync(); });
  for (var i = 0; i < hosts.length; i++) {
    if (hosts[i]) mo.observe(hosts[i], { subtree: true, childList: true, characterData: true });
  }
}

/* ---------------------------------------------------------------------
   4. The top-bar state pill (ps-top-pill)

   It goes to the Status card. On the Status card there is nowhere to go,
   so it stops being a control: `disabled`, which project.css turns into
   the plain arrow rather than the crossed circle, and keeps readable.
   Which card is showing is the `.active` class app.css keys on, and it
   moves whenever module 1 navigates, by click, by key or by the landing
   rule, so the pill follows the class rather than the click.
   ------------------------------------------------------------------- */

function pill_sync() {
  var pill = chrome_node('ps-top-pill');
  if (!pill) return;
  var shown = document.querySelector('[data-card].active');
  pill.disabled = !!(shown && shown.id === 'ps-card-status');
}

function pill_watch() {
  var cards = document.querySelectorAll('[data-card]');
  if (typeof MutationObserver === 'function') {
    var mo = new MutationObserver(function () { pill_sync(); });
    for (var i = 0; i < cards.length; i++) {
      mo.observe(cards[i], { attributes: true, attributeFilter: ['class'] });
    }
    return;
  }
  /* No observer: resync after any navigation click has been handled. */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('[data-nav], #ps-top-pill') : null;
    if (a) setTimeout(pill_sync, 0);
  });
}

function pill_go_status() {
  if (typeof show_card === 'function') show_card('status');
}

/* ---------------------------------------------------------------------
   5. Wiring and boot
   ------------------------------------------------------------------- */

var g_chrome_ready = false;

function chrome_wire() {
  var btn;

  /* the Appearance segments */
  for (var p in THEME_SEGMENT) {
    if (!Object.prototype.hasOwnProperty.call(THEME_SEGMENT, p)) continue;
    btn = chrome_node(THEME_SEGMENT[p]);
    if (btn) btn.addEventListener('click', (function (pref) { return function () { theme_choose(pref); }; })(p));
  }

  /* the top-bar theme cycle */
  btn = chrome_node('ps-top-theme');
  if (btn) btn.addEventListener('click', theme_advance);

  /* the rail's pin */
  btn = chrome_node('ps-nav-toggle');
  if (btn) btn.addEventListener('click', nav_pin_toggle);

  /* the state pill */
  btn = chrome_node('ps-top-pill');
  if (btn) btn.addEventListener('click', pill_go_status);
}

function chrome_init() {
  if (g_chrome_ready) return;
  g_chrome_ready = true;

  g_theme_pref = theme_read_store();
  theme_paint(g_theme_pref);
  theme_watch_system();

  nav_pin_paint(nav_read_store());
  nav_names_sync();
  chrome_names_watch();

  pill_sync();
  pill_watch();

  chrome_wire();
}

/* The body class is the one thing worth doing before the DOM is ready:
   a stored dark on a light machine would otherwise open light and
   correct itself. Everything that needs an element waits for the DOM,
   the way core.js boots. */
if (document.body) theme_body_class(theme_read_store());

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', chrome_init);
} else {
  chrome_init();
}

/* ---------------------------------------------------------------------
   6. The globals this module offers

   theme_choose(pref)    pref is 'auto' | 'light' | 'dark'; remembers + paints
   theme_advance()       one step of the top-bar cycle
   nav_pin_set(pinned)   pin or release the rail; remembers + paints

   Harness conflict, recorded here rather than bent to: contrast.js
   (line 31) and pixels.js (line 105) drive the theme through a global
   named `theme_apply(name)`. No function of that name is defined here:
   the name is the harness's, and this module keeps its own names (author
   brief §3.3). The two values those harnesses pass, 'dark' and 'light',
   are valid prefs, so the harness fix is one token at each site:
   `theme_apply(x)` -> `theme_choose(x)`.
   ------------------------------------------------------------------- */

window.theme_choose = theme_choose;
window.theme_advance = theme_advance;
window.nav_pin_set = nav_pin_set;
