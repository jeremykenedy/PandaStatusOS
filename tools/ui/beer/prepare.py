# -*- coding: utf-8 -*-
"""Key the markup, then derive the key table. In that order, every time.

    pages/*.html  ─►  i18n_attach   (adds data-str where missing)
                      └─►  i18n_collect  (derives new-keys.json)

The vent generated its lighting page from a Python model, because it had 22 effects each
with its own editor. This device has two modes and three colours in each, so the page is
written by hand and there is nothing to generate before the keys are attached.

The order that remains still matters: attaching keys and THEN collecting is the only way
round that works. Collect first and the table is derived from a page that has not been
keyed yet. See docs/LESSONS-FROM-THE-VENT.md, lesson 8.
"""
import io, os, subprocess, sys

D = os.path.dirname(os.path.abspath(__file__))


def run(mod):
    r = subprocess.run([sys.executable, os.path.join(D, mod)],
                       capture_output=True, text=True, cwd=D)
    if r.returncode:
        sys.stderr.write(r.stdout + r.stderr)
        raise SystemExit('%s failed' % mod)
    return r.stdout.strip()


def prepare(verbose=True):
    out = [run('i18n_attach.py'), run('i18n_collect.py')]
    if verbose:
        for l in out:
            print('  ' + l.replace('\n', '\n  '))


if __name__ == '__main__':
    prepare()
