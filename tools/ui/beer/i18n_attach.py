# -*- coding: utf-8 -*-
"""Put the translation keys back on the rebuilt markup.

Every visible string in this app is a data-str key with 24
translations behind it. The rebuild is new markup with English in it, so
each string has to find its key again.

Three outcomes per string, in order of preference:

  exact   the English is already in the table, ignoring case, spacing and
          punctuation -> reuse that key, free, and 24 languages come with
          it
  new     anything else -> mint a key, English only for now, listed at the
          end so the missing translations are a number rather than a
          surprise

There is deliberately no fuzzy tier. It was tried: difflib at 0.72 put
`status_door_open` on the vent's "Open" button and `appearance_auto` on
its "Auto" one, because short UI strings are mostly the same few letters
and text similarity knows nothing about what a word MEANS. A wrong
translation is worse than a missing one — a missing one falls back to
English, which the reader can at least tell is English.

Strings the renderer fills in are skipped: a key on an element whose
content is overwritten on every state push is a key that never shows.

A matching key is not automatically the RIGHT key. `ap_on` is "Always ON"
for the hotspot switch and the ring light also has an "Always on"; reusing
one for the other gives a translator's sentence about a Wi-Fi access point
on a row about an LED. So a key is only reused when its own prefix belongs
to the page the string is on. The prefixes are the ones the table already
uses, and they are per file below.
"""
import io, re, json, html, glob, os

D = os.path.dirname(os.path.abspath(__file__))
# These two live beside this script, not in /tmp: the build must not depend on
# a temporary directory that the machine clears on its own schedule.
EN2KEY = json.load(io.open(os.path.join(D, 'i18n', 'en2key.json'), encoding='utf-8'))
WRITTEN = set(json.load(io.open(os.path.join(D, 'i18n', 'written_ids.json'), encoding='utf-8')))

norm = lambda t: re.sub(r'\s+', ' ', html.unescape(t)).strip()

# The match key: case, spacing and trailing punctuation carry no meaning
# for this purpose, so "Print\nFinished" and "Print finished" are the same
# string and share the same 24 translations.
def fold(t):
    t = norm(t).lower().replace('\\n', ' ')
    t = re.sub(r'[\s\u00a0]+', ' ', t)
    return re.sub(r'[.:!?\u2026]+$', '', t).strip()

EN = {}
_collide = set()
for eng, k in EN2KEY.items():
    f = fold(eng)
    if f in EN and EN[f] != k:
        _collide.add(f)          # two keys, same folded text: not safe to reuse
    else:
        EN.setdefault(f, k)
for f in _collide:
    EN.pop(f, None)

# Which key families belong to which page. A key from another family is
# the same English word about a different thing, so it is not reused.
PREFIXES = {
    'dashboard.html': ('status_', 'vent_', 'airflow_', 'cal_', 'pctl_', 'job_', 'card_', 'note_'),
    'lighting.html':  ('rgb_', 'fx_', 'color_', 'colour_', 'preview_', 'bright_', 'leds_',
                       'ring_', 'policy_', 'anim_', 'errflash_', 'warn_', 'behaviour_',
                       'card_', 'note_', 'status_speed', 'status_brightness', 'status_effect',
                       'use_default'),
    'settings.html':  ('settings_', 'appearance_', 'device_name', 'ota_', 'sys_', 'restart',
                       'factory_', 'card_', 'note_', 'ui_'),
    'printer.html':   ('printer_', 'bind', 'unbind', 'scan', 'card_', 'note_'),
    'camera.html':    ('cam_', 'card_', 'note_'),
    'wifi.html':      ('sta_', 'wifi_', 'hostname', 'set_hostname', 'configure_', 'card_', 'note_'),
    'hotspot.html':   ('ap_', 'confirm', 'card_', 'note_', 'placeholder_'),
    'logs.html':      ('status_logs', 'card_', 'note_'),
    'setup.html':     ('lang_', 'wifi_', 'connect', 'back', 'scan', 'placeholder_', 'color_',
                       'colour_', 'bright_', 'finish', 'next'),
    'overlays.html':  (),
    'global.html':    ('note_', 'cancel', 'confirm', 'hex_', 'hsl_', 'cfg_', 'dialog_', 'ok'),
    'frame.html':     ('card_', 'top_', 'nav_'),
}

# Values, not copy. The renderer writes these, or they are proper nouns.
DATA = re.compile(r'^(v?\d|[\d.,%°·\s/+-]+$|#[0-9A-Fa-f]{3,8}$|rtsps?://|__[A-Z]+__$)')
LITERAL = {
    'PandaStatusOS', 'PandaStatusOS v1.0.0', 'example-iot', 'My Printer', '.local',
    'PLA', 'PLA Basic', 'PETG HF', 'PLA Silk', 'Panda Vent', 'v1.1.0', '1080p',
    'Wi-Fi',
    'Storage Lid 5x5 0.2mm layer, 2 walls, 15% infill', 'layer 41 of 58',
    '54 m left', 'Standard', 'Connected to example-iot', '-47 dBm', 'auto', 'live',
    'PandaVent-AP', '0.4 mm, hardened steel, high flow', 'Per state: Printing',
    'Humidity and temperature', '637 MB / 940 MB', '170 frames', 'Nothing',
    'Connected', 'Printing', 'Shut', 'On', 'Off', 'PLA', 'Idle',
}

new_keys = {}     # key -> english
stats = {'exact': 0, 'new': 0, 'skip': 0, 'wrong_family': 0}


def mint(text):
    base = re.sub(r'[^a-z0-9]+', '_', text.lower()).strip('_')[:34] or 'x'
    key = 'ui_' + base
    n = 2
    while key in new_keys and new_keys[key] != text:
        key = 'ui_%s_%d' % (base, n); n += 1
    new_keys[key] = text
    return key


def key_for(text, page):
    """(key, replacement_text_or_None)"""
    f = fold(text)
    k = EN.get(f)
    if k and any(k.startswith(p) for p in PREFIXES.get(page, ())):
        stats['exact'] += 1
        return k, None
    if k:
        stats['wrong_family'] += 1
    stats['new'] += 1
    return mint(norm(text)), None


def attach(src, page):
    out, i = [], 0
    # <tag ...>TEXT</tag> where TEXT is the whole content
    pat = re.compile(r'<(?P<tag>span|div|h\d|button|label|option|a|p|code|li)(?P<attrs>[^>]*)>'
                     r'(?P<text>[^<>]+)</(?P=tag)>')
    def repl(m):
        tag, attrs, text = m.group('tag'), m.group('attrs'), m.group('text')
        t = norm(text)
        if (not t or len(t) < 2 or t in LITERAL or DATA.match(t)
                or re.fullmatch(r'[\d\W_]+', t) or 'data-str' in attrs
                or 'pandavent:' in t or 'pv_' in t):
            stats['skip'] += 1
            return m.group(0)
        mid = re.search(r'id="([\w]+)"', attrs)
        if mid and mid.group(1) in WRITTEN:
            stats['skip'] += 1
            return m.group(0)
        key, rep = key_for(text, page)
        return '<%s%s data-str="%s">%s</%s>' % (
            tag, attrs, key, html.escape(rep) if rep else text, tag)
    return pat.sub(repl, src)


def attach_attrs(src, page):
    """A title= needs a key too, so a tooltip is not the one English string
    left on a translated page.

    Per TAG, not per attribute: the lookahead this used to use only saw the
    character straight after the title, so a tag whose data-str-title
    came later was re-keyed on every run. The key is minted from the title
    text, the title text was then rewritten from the key, and eleven runs
    later the key was `ui_ui_ui_ui_ui_ui_ui_ui_ui_ui_ui_copy`."""
    def one(m):
        tag = m.group(0)
        if 'data-str-title' in tag:
            return tag
        mt = re.search(r'title="([^"]+)"', tag)
        if not mt:
            return tag
        t = norm(mt.group(1))
        if not t or t.startswith('ui_'):
            return tag
        key, rep = key_for(t, page)
        return tag.replace(mt.group(0),
                           'title="%s" data-str-title="%s"' % (html.escape(rep or t), key))
    return re.sub(r'<\w+[^>]*>', one, src)


if __name__ == '__main__':
    # overlays.html is mock furniture: it exists so the dialog and the two
    # banners can be looked at, and it does not ship. Keys for "Filled",
    # "Outlined" and "Assist" would be 23 translations of a swatch board.
    for p in sorted(glob.glob(os.path.join(D, 'pages', '*.html'))) + \
             [os.path.join(D, 'global.html'), os.path.join(D, 'frame.html')]:
        if os.path.basename(p) == 'overlays.html':
            continue
        page = os.path.basename(p)
        s = io.open(p, encoding='utf-8').read()
        body = re.split(r'(<!--.*?-->)', s, flags=re.S)
        # never touch the inside of a comment
        for i in range(0, len(body), 2):
            body[i] = attach_attrs(attach(body[i], page), page)
        io.open(p, 'w', encoding='utf-8').write(''.join(body))

    io.open(os.path.join(D, 'new-keys.json'), 'w', encoding='utf-8').write(
        json.dumps(new_keys, ensure_ascii=False, indent=1, sort_keys=True))
    print('reused an existing key %(exact)d   new key %(new)d '
          '  (%(wrong_family)d of those matched text but belonged to another page)\n'
          'not copy, skipped %(skip)d' % stats)
    print('distinct new keys: %d  ->  new-keys.json' % len(new_keys))
