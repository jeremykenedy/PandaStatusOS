#!/usr/bin/env python3
"""One mechanical pass: the vent's element ids become this project's.

    the factory prefix, then a card name  ->  ps-card-printer
    the factory prefix, then a control    ->  ps-btn-scan
    the same in a selector                ->  #ps-airflow

The banned prefixes are not spelled out here on purpose: the residue check is a literal
scan of the whole tree, and a file that names them would have to be exempted, which is how
an allowlist starts.

Why, and why it is absolute. The factory page names things id_* and c_*, so either prefix
appearing anywhere in this tree is evidence of copied material, and the residue check treats
both as a failure with no allowlist. That only stays true if our own markup never uses them.
An allowlist that grows every time a control is added is a check that decays to nothing.

Markup, stylesheet, module and build regex are renamed in the SAME pass, because the id in
the markup is a contract with the module that binds it and the rule that styles it. Renaming
one without the others is how a control goes inert and a stylesheet stops matching.

Run once, on import. Idempotent: a tree with no id_ tokens left is unchanged.
"""
import io, os, re, sys

D = os.path.dirname(os.path.abspath(__file__))
TARGETS = (['frame.html', 'global.html', 'sprite.svg', 'project.css', 'theme.css', 'app.css',
            'build_firmware.py', 'i18n_attach.py', 'i18n_collect.py', 'prepare.py',
            'selects.json', 'selects.py'] +
           ['pages/' + f for f in sorted(os.listdir(os.path.join(D, 'pages')))
            if f.endswith(('.html', '.py'))] +
           ['modules/' + f for f in sorted(os.listdir(os.path.join(D, 'modules')))
            if f.endswith('.js')] +
           ['i18n/' + f for f in sorted(os.listdir(os.path.join(D, 'i18n')))
            if f.endswith('.json')])

RX = re.compile(r'\bid_([a-z0-9_]*)')


def main():
    total = 0
    for rel in TARGETS:
        p = os.path.join(D, rel)
        if not os.path.isfile(p):
            continue
        s = io.open(p, encoding='utf-8').read()
        out, n = RX.subn(lambda m: 'ps-' + m.group(1).replace('_', '-'), s)
        if n:
            io.open(p, 'w', encoding='utf-8').write(out)
            print('  %-28s %4d' % (rel, n))
            total += n
    print('%d id_ token(s) renamed across %d file(s)' % (total, len(TARGETS)))
    return 0


if __name__ == '__main__':
    sys.exit(main())
