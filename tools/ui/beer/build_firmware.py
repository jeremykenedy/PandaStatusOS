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

# ── the string table, ours, from strings/en.json and its 23 siblings ─────
# build_strings.py refuses to emit unless every language carries every key
# with the same placeholders, so a half-translated table cannot ship.
import subprocess as _sp
_r = _sp.run([sys.executable, os.path.join(D, '..', 'build_strings.py'), os.path.join(D, '..', 'i18n')],
             capture_output=True, text=True)
sys.stdout.write(_r.stdout)
assert _r.returncode == 0, 'the string table is incomplete:\n' + _r.stdout + _r.stderr
_tbl = io.open(os.path.join(D, '..', 'i18n', 'ps_strings.js'), encoding='utf-8').read()
js_out.append('<script>%s</script>' % _tbl)
print('spliced the string table (%d bytes)' % len(_tbl))

# ── the clean-room modules ───────────────────────────────────────────────
_mods = sorted(glob.glob(os.path.join(D, 'modules', '*.js')))
for _m in _mods:
    js_out.append('<script>%s</script>' % io.open(_m, encoding='utf-8').read())
print('spliced %d clean module(s): %s' % (len(_mods), [os.path.basename(m) for m in _mods]))

# ── the page ─────────────────────────────────────────────────────────────
PAGES = ['dashboard', 'lighting', 'settings', 'printer', 'camera',
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
print('%d pages, each marked data-card and each reachable from both navs; no inline handlers' % len(_cards))

# ── every key the page looks up must exist ────────────────────────────────
#
# tr() falls back to the key's own English, so a key no language carries is
# invisible in English and shows English to the other 23. Five of them shipped
# that way. A key built from a prefix and a number -- tr('ui_printer_state_' +
# n) -- reaches this as the bare prefix, so those are matched by prefix and
# only pass if at least one numbered key exists behind them.
_en = json.load(io.open(os.path.join(D, '..', 'i18n', 'en.json'), encoding='utf-8'))
_used = set(re.findall(r"(?:tr|cpk_tr)\(\s*'([a-z0-9_]+)'", out)) | \
        set(re.findall(r'data-str="([a-z0-9_]+)"', out))
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
