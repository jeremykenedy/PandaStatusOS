# -*- coding: utf-8 -*-
"""Does any sheet declare the same property twice for the same selector, in the same context?

The sibling project found a fault of exactly this shape: a rule was fixed, a duplicate of it
further down the same file kept the old value, and being later it won. Nothing about the fix
looks wrong, the page goes on showing the old colour, and the only way anyone found it was by
reading the whole sheet.

Run by the build, so it cannot be forgotten:

    python3 tools/ui/css_check.py

Selector lists are split on TOP-LEVEL commas only, so :is(a, b) is one selector and not two;
splitting it naively made half the sheet look like duplicates of itself.
"""
import io, os, re, sys, collections
R = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
B = os.path.join(R, 'tools', 'ui', 'beer')

def split_sel(head):
    """Top-level commas only: :is(a, b) is one selector, not two."""
    out, depth, buf = [], 0, ''
    for c in head:
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
        if c == ',' and depth == 0:
            out.append(buf.strip()); buf = ''
        else:
            buf += c
    if buf.strip():
        out.append(buf.strip())
    return out


def blocks(css):
    """(context, selector, [properties]) for every rule, where context is the enclosing at-rule."""
    css = re.sub(r'/\*.*?\*/', '', css, flags=re.S)
    out, ctx, i, n = [], [], 0, len(css)
    buf = ''
    while i < n:
        c = css[i]
        if c == '{':
            head = buf.strip(); buf = ''
            if head.startswith('@'):
                ctx.append(head)
                i += 1
                continue
            depth, j = 1, i + 1
            while j < n and depth:
                if css[j] == '{': depth += 1
                elif css[j] == '}': depth -= 1
                j += 1
            body = css[i + 1:j - 1]
            props = [p.split(':', 1)[0].strip().lower() for p in body.split(';') if ':' in p]
            for sel in split_sel(head):
                out.append((' '.join(ctx), sel, props))
            i = j
            continue
        if c == '}':
            if ctx: ctx.pop()
            buf = ''
            i += 1
            continue
        buf += c
        i += 1
    return out

bad = 0
for name in ('project.css', 'app.css', 'theme.css'):
    css = io.open(os.path.join(B, name), encoding='utf-8').read()
    seen = collections.defaultdict(collections.Counter)
    for ctx, sel, props in blocks(css):
        if not sel:
            continue
        for p in set(props):
            seen[(ctx, sel)][p] += 1
    for (ctx, sel), cnt in sorted(seen.items()):
        dup = [p for p, k in cnt.items() if k > 1]
        if dup:
            bad += 1
            print('%s  %s%s  declares %s more than once' % (name, (ctx + ' ') if ctx else '', sel, ', '.join(sorted(dup))))
print('%d selector/property pairs declared twice in one context' % bad)
sys.exit(1 if bad else 0)
