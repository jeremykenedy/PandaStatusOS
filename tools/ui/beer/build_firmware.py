# -*- coding: utf-8 -*-
"""Assemble firmware/main/ui.html from the project's own sources.

    beer/       ─┬─ beer.trim.css, theme.css, project.css, app.css, fonts.css
                 ├─ frame.html + pages/*.html + global.html, sprite.svg, marks.json
                 ├─ beer.min.js (MIT), firmware/main/vendor/iro/iro.min.js (MPL-2.0)
                 ├─ modules/*.js, the clean-room UI modules (core.js is the router)
                 └─ strings/*.json -> pv_strings.js, the UI string table

Every script in the page is one of: a third-party library shipped unmodified
with its licence, a clean-room module written from private/SPEC, or the
string table. Nothing is read from a vendor page any more.
"""
import io, json, os, re, sys, glob

D = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(D, '..', '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    os.path.normpath(os.path.join(D, '..', '..', '..')), 'firmware', 'main', 'ui.html')


def r(*p):
    return io.open(os.path.join(D, *p), encoding='utf-8').read()


sys.path.insert(0, D)
from prepare import prepare
prepare(verbose=True)

js_out = []

# ── third-party: iro.js, pinned, unmodified, licence banner intact ────────
_IRO = os.path.join(ROOT, 'firmware', 'main', 'vendor', 'iro', 'iro.min.js')
_iro_src = io.open(_IRO, encoding='utf-8').read()
assert _iro_src.startswith('/*!\n * iro.js v5.5.2'), 'vendored iro.min.js is not the pinned 5.5.2 release'
js_out.append('<script>%s</script>' % _iro_src)
print('spliced vendor iro.js 5.5.2 (%d bytes)' % len(_iro_src))

# ── no sheet may declare the same property twice for the same selector ───
# A rule fixed once and duplicated further down the same file goes on showing the old value,
# because the later copy wins, and nothing about the fix looks wrong. tools/ui/css_check.py
# says which selector and which property.
import subprocess as _sp
_c = _sp.run([sys.executable, os.path.join(D, '..', 'css_check.py')], capture_output=True, text=True)
assert _c.returncode == 0, 'a stylesheet shadows itself:\n' + _c.stdout + _c.stderr
sys.stdout.write(_c.stdout)

# ── the string table, ours, from strings/en.json and its 23 siblings ─────
# build_strings.py refuses to emit unless every language carries every key
# with the same placeholders, so a half-translated table cannot ship.
_r = _sp.run([sys.executable, os.path.join(D, '..', 'build_strings.py'), os.path.join(D, '..', 'i18n')],
             capture_output=True, text=True)
sys.stdout.write(_r.stdout)
assert _r.returncode == 0, 'the string table is incomplete:\n' + _r.stdout + _r.stderr
_tbl = io.open(os.path.join(D, '..', 'i18n', 'ps_strings.js'), encoding='utf-8').read()
js_out.append('<script>%s</script>' % _tbl)
print('spliced the string table (%d bytes)' % len(_tbl))

# ── the clean-room modules ───────────────────────────────────────────────
_mods = sorted(glob.glob(os.path.join(D, 'modules', '*.js')))
# Every module is parsed before it is spliced. A syntax error in one classic script stops
# that script and only that script: the page still loads, the other modules still run, and
# the controls the broken one owned are simply dead. That is the quietest failure in the
# whole build, and it shipped once: an element id used as a bare object key became
# ps-pctl-chamber-light after the id rename, which is not a valid unquoted key, and the
# status module stopped existing. See docs/LESSONS-FROM-THE-VENT.md.
import shutil as _sh
_node = _sh.which('node')
if _node:
    _bad = []
    for _m in _mods:
        _r = _sp.run([_node, '--check', _m], capture_output=True, text=True)
        if _r.returncode:
            _bad.append('%s: %s' % (os.path.basename(_m),
                                    (_r.stderr or _r.stdout).strip().split(chr(10))[-1][:120]))
    assert not _bad, 'module(s) do not parse:' + chr(10) + chr(10).join('  ' + b for b in _bad)
    print('%d module(s) parse' % len(_mods))
else:
    print('node not found: module syntax check skipped')
for _m in _mods:
    js_out.append('<script>%s</script>' % io.open(_m, encoding='utf-8').read())
print('spliced %d clean module(s): %s' % (len(_mods), [os.path.basename(m) for m in _mods]))

# ── the page ─────────────────────────────────────────────────────────────
PAGES = ['dashboard', 'lighting', 'settings', 'printer',
         'wifi', 'hotspot', 'logs', 'setup']
APP = [p for p in PAGES if p != 'setup']
pages = ('<div id="ps-page-app" data-page class="active">\n'
         + '\n'.join(r('pages', p + '.html') for p in APP)
         + '\n</div>\n'
         + r('pages', 'setup.html'))

out = r('frame.html')
out = out.replace('__FONTS__', r('fonts.css'))
out = out.replace('__BEER__', r('beer.trim.css'))
out = out.replace('__THEME__', r('theme.css'))
out = out.replace('__PROJECT__', r('project.css') + r('app.css'))
out = out.replace('__PAGES__', pages)
out = out.replace('__GLOBAL__', r('global.html'))
out = out.replace('__SPRITE__', r('sprite.svg'))
_marks = json.load(io.open(os.path.join(D, 'marks.json'), encoding='utf-8'))
for _slot, _key in (('__FAVICON__', 'favicon'), ('__TOUCH__', 'touch'),
                    ('__MARKLIGHT__', 'light'), ('__MARKDARK__', 'dark')):
    assert _slot in out, 'no slot for %s' % _key
    out = out.replace(_slot, _marks[_key])
out = out.replace('__MOCKNOTE__', '')
out = out.replace('__MOCKUI__', '')
out = out.replace('<script type="module">__BEERJS__</script>',
                  '<script type="module">%s</script>\n\n%s' % (r('beer.min.js'), '\n'.join(js_out)))

# Every page is a card, every card is reachable, and nothing in the markup
# is wired inline: the modules wire their own listeners.
_cards = set(re.findall(r'<section id="ps-card-([a-z0-9_]+)"', out))
_marked = set(re.findall(r'<section id="ps-card-([a-z0-9_]+)"[^>]*\bdata-card\b', out))
assert not (_cards - _marked), 'pages not marked data-card: %s' % sorted(_cards - _marked)
_dests = set(re.findall(r'data-nav="([a-z0-9_]+)"', out))
assert _dests == _cards, 'navs and pages disagree: nav-only %s, page-only %s' % (sorted(_dests - _cards), sorted(_cards - _dests))
# Beer lays <body> out as a grid with named areas. The navs, the header, main and the
# footer are its cells, and a cell nested inside another element is not in the grid. The
# sibling project shipped a <header> that was never closed, so the rail and <main> became
# its children: the top bar floated mid document and main rendered empty. Nine rounds of
# CSS were thrown at it. See docs/LESSONS-FROM-THE-VENT.md, lesson 5.
_body = out[out.index('<body'):]
_top = re.findall(r'(?m)^<(nav|header|main|footer)\b', _body)
assert _top[:5] == ['nav', 'nav', 'header', 'main', 'footer'], (
    'body top level children are %s; they must be nav, nav, header, main, footer, each a '
    'direct child of <body>. Nesting one inside another kills Beer\'s app layout grid.'
    % _top[:8])
print('body structure: nav, nav, header, main, footer, each a direct child of <body>')

_inline = re.findall(r'\son[a-z]+="[^"]*"', out)
assert not _inline, 'inline handlers in the markup: %s' % _inline[:5]

# The attribute the markup carries and the attribute the stylesheets select on have to be
# the same string, and nothing else in the page will tell you when they are not. The
# sibling tree drifted to data-ps-card in its markup while its CSS kept data-card, which
# killed `[data-card]:not(.active) { display: none }`: every page rendered at once, stacked
# down the document, and the whole masonry block was dead with it. Both faults are silent.
# This compares the two sets and fails the build if they differ by one character.
_attr_markup = set(re.findall(r'<[^>]*\s(data-[a-z-]*(?:card|page))\b', out))
_attr_css = set()
for _sheet in ('project.css', 'app.css'):
    _attr_css |= set(re.findall(r'\[(data-[a-z-]*(?:card|page))\]', r(_sheet)))
assert _attr_markup and _attr_css, 'no page attribute found in the markup or in the CSS'
assert _attr_markup == _attr_css, (
    'the markup and the stylesheets name the page attribute differently: markup has %s, '
    'CSS selects %s. Every rule on the other name is dead, including the one that hides '
    'the pages that are not active.' % (sorted(_attr_markup), sorted(_attr_css)))
print('page attribute agrees in markup and CSS: %s' % ', '.join(sorted(_attr_markup)))
print('%d pages, each marked data-card and each reachable from both navs; no inline handlers' % len(_cards))

# ── every browser-storage key belongs to this project ─────────────────
#
# The page kept its theme preference under pv_theme, which is the sibling project's prefix.
# The cost was not cosmetic: the contrast harness sets ps_theme, so the page never saw the
# preference, fell back to its default (light), and every "dark" row in that harness measured
# the light theme against itself and passed. The dark theme had never been rendered under a
# check at all. Two more keys, pv_nav and pv_lang, were the same mistake waiting.
#
# A storage key is an interface between the page and everything that drives it, so it is
# checked here rather than trusted: every key literal in the spliced page must be ps_.
_keys = set(re.findall(r"(?:getItem|setItem|removeItem)\(\s*'([A-Za-z0-9_]+)'", '\n'.join(js_out)))
_keys |= set(re.findall(r'(?:getItem|setItem|removeItem)\(\s*"([A-Za-z0-9_]+)"', '\n'.join(js_out)))
# Both idioms the page uses: the key written at the call, and the key held in a NAME_KEY
# constant, which is how the theme and the nav preferences are stored.
_keys |= set(re.findall(r"_KEY\s*=\s*'([A-Za-z0-9_]+)'", '\n'.join(js_out)))
_wrongkeys = sorted(k for k in _keys if not k.startswith('ps_'))
assert not _wrongkeys, (
    'browser storage keys that are not this project\'s: %s. A key another project\'s prefix '
    'owns is a key nothing driving this page will set, and a harness that sets the right one '
    'silently tests the default instead.' % _wrongkeys)
print('%d browser storage key(s), every one of them ours: %s' % (len(_keys), ', '.join(sorted(_keys))))

# ── every key the page looks up must exist ────────────────────────────────
#
# tr() falls back to the key's own English, so a key no language carries is
# invisible in English and shows English to the other 23. Five of them shipped
# that way. A key built from a prefix and a number -- tr('ui_printer_state_' +
# n) -- reaches this as the bare prefix, so those are matched by prefix and
# only pass if at least one numbered key exists behind them.
_en = json.load(io.open(os.path.join(D, '..', 'i18n', 'en.json'), encoding='utf-8'))
# tr() and data-str are not the only ways a key is reached. A dialog takes its title and
# its text as keys in the second and fourth argument positions, a toast takes one in the
# first, and a note takes one too. Twenty-four keys shipped through those calls that no
# language carried: English showed to all twenty-three other readers, silently, because
# tr() falls back to the fallback that sits right beside the key. So the sweep below is by
# SHAPE, not by call: every quoted token that looks like one of this project's keys is
# treated as one, and a key-shaped literal that no language carries fails the build.
#
# The prefixes are this project's own naming, listed rather than guessed at, so a literal
# like 'click' or 'change' is not mistaken for a key.
_PREFIX = ('ui_', 'dlg_', 'cal_', 'anim_', 'status_', 'card_', 'ams_', 'fw_', 'door_',
           'logs_', 'response_', 'sta_', 'ap_', 'cfg_', 'pctl_', 'hostname', 'restart',
           'factory_reset', 'language_name')
_used = set(re.findall(r"(?:tr|cpk_tr)\(\s*'([a-z0-9_]+)'", out)) | \
        set(re.findall(r'data-str="([a-z0-9_]+)"', out)) | \
        set(re.findall(r'data-str-aria="([a-z0-9_]+)"', out)) | \
        set(k for k in re.findall(r"'([a-z][a-z0-9_]*)'", out) if k.startswith(_PREFIX))
_missing = []
for _k in sorted(_used):
    if _k in _en:
        continue
    if _k.endswith('_') and any(x.startswith(_k) for x in _en):
        continue            # a prefix, completed at run time
    _missing.append(_k)
assert not _missing, 'keys used by the page that no language carries: %s' % _missing
print('%d translation keys used, every one of them backed' % len(_used))

io.open(OUT, 'w', encoding='utf-8').write(out)
print('\n%s  %.0f KB' % (os.path.basename(OUT), len(out) / 1024))

# And straight into the firmware, rather than leaving a `cp` for a human to
# remember. The two copies drifted once already: the page was rebuilt, the
# copy was not made, and the build that followed embedded the older page while
# every check on the newer one read clean. A step that only sometimes happens
# is not a build step.
