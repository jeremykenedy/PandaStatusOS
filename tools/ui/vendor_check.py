# -*- coding: utf-8 -*-
"""Every vendored file's sha256 is written down beside it, and matches.

    python3 tools/ui/vendor_check.py

One rule, applied to every directory under firmware/main/vendor/: hash each file that is
not the licence text and not the README, and require that hash to appear, verbatim, in
that component's own README.md. That is what makes the README a record rather than a
claim, and it is the check docs/PUBLISHING.md's licence audit calls.

The check that stood here before was `tools/ui/build/build.py --check`, which has not
existed since the page was rebuilt, so nothing had verified a vendored hash for some time.

Exit 0 and a line per component when every file matches; exit 1 and the first mismatch
otherwise. Nothing here writes.
"""
import hashlib, io, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.normpath(os.path.join(HERE, '..', '..', 'firmware', 'main', 'vendor'))
SKIP_NAMES = {'README.md', 'LICENSE.txt', 'OFL.txt'}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 16), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    bad, checked, comps = [], 0, 0
    for name in sorted(os.listdir(VENDOR)):
        d = os.path.join(VENDOR, name)
        if not os.path.isdir(d):
            continue
        readme = os.path.join(d, 'README.md')
        if not os.path.isfile(readme):
            bad.append('%s/ has no README.md, so nothing records what it is' % name)
            continue
        text = io.open(readme, encoding='utf-8').read()
        files, here = [], 0
        for root, _dirs, names in os.walk(d):
            for n in sorted(names):
                if n in SKIP_NAMES or n.startswith('.'):
                    continue
                files.append(os.path.join(root, n))
        for f in files:
            digest = sha256(f)
            rel = os.path.relpath(f, d)
            if digest not in text:
                bad.append('%s/%s: sha256 %s is not in %s/README.md' % (name, rel, digest[:16] + '...', name))
            else:
                here += 1
            checked += 1
        comps += 1
        print('  %-12s %d file(s), %d recorded' % (name + '/', len(files), here))
    print('%d component(s), %d file(s) hashed' % (comps, checked))
    if bad:
        print('\nVENDOR HASHES DO NOT MATCH THEIR RECORDS')
        for b in bad:
            print('  ' + b)
        return 1
    print('every vendored file is recorded in its own README')
    return 0


if __name__ == '__main__':
    sys.exit(main())
