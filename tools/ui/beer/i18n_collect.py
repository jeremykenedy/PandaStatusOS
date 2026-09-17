# -*- coding: utf-8 -*-
"""Derive the new-key table from the markup itself.

new-keys.json used to be whatever the last attach run happened to mint,
which meant re-running the attach over already-attached files shrank it
from 144 keys to 69 and 75 strings quietly went back to printing their own
key on screen.

So it is derived, not accumulated: every `data-str="ui_*"` in the
markup, with the English that is sitting in that element. Run it after any
markup edit and it cannot drift.
"""
import io, json, os, re, glob, html

D = os.path.dirname(os.path.abspath(__file__))
PAGES = glob.glob(os.path.join(D, 'pages', '*.html')) + \
        [os.path.join(D, 'global.html'), os.path.join(D, 'frame.html')]

norm = lambda t: re.sub(r'\s+', ' ', html.unescape(t)).strip()

keys, dupes = {}, []
for p in sorted(PAGES):
    if os.path.basename(p) == 'overlays.html':
        continue                      # mock furniture, never shipped
    s = re.sub(r'<!--.*?-->', '', io.open(p, encoding='utf-8').read(), flags=re.S)
    # the element's own text, for a key on the element itself
    for m in re.finditer(r'data-str="(ui_[\w]+)"[^>]*>([^<]*)<', s):
        k, t = m.group(1), norm(m.group(2))
        if not t:
            continue
        if k in keys and keys[k] != t:
            dupes.append((k, keys[k], t))
        keys.setdefault(k, t)
    # a title attribute carrying a key
    for m in re.finditer(r'title="([^"]*)"[^>]*data-str-title="(ui_[\w]+)"', s):
        k, t = m.group(2), norm(m.group(1))
        keys.setdefault(k, t)

# Keys the markup cannot show us.
#
# A handful of strings are only ever set from JavaScript, by swapping the
# element's data-str between two values. The off state of the hotspot
# note is one: nothing in any page file mentions it, so deriving the key
# list from the markup alone would drop it and the page would print the raw
# key the first time somebody turned the switch off.
JS_ONLY = {
    'ui_ap_note_off': 'Only appears when the vent cannot join the network it knows about.',
    # Set from JS when the password is revealed (the shown state's title).
    'ui_hide_the_password': 'Hide the password',
}
for _k, _t in JS_ONLY.items():
    keys.setdefault(_k, _t)


if __name__ == '__main__':
    old = {}
    f = os.path.join(D, 'new-keys.json')
    if os.path.exists(f):
        old = json.load(io.open(f, encoding='utf-8'))
    io.open(f, 'w', encoding='utf-8').write(
        json.dumps(keys, ensure_ascii=False, indent=1, sort_keys=True))
    print('%d keys in the markup (was %d in the file)' % (len(keys), len(old)))
    for k in sorted(set(old) - set(keys)):
        print('  gone: %s' % k)
    if dupes:
        print('\nSAME KEY, DIFFERENT ENGLISH - one of these is wrong:')
        for k, a, b in dupes:
            print('  %-40s %r vs %r' % (k, a[:40], b[:40]))
