#!/usr/bin/env python3
"""Normalise Illustrator SVG exports into the project's icon source files.

    python3 tools/ui/normalize_icons.py <export.svg | directory> [...]     write tools/ui/src/icons/<name>.svg
    python3 tools/ui/normalize_icons.py --check                             every committed icon is normalised and idempotent

What changes, and why. An Illustrator export carries a twenty-class stylesheet (.st0 to
.st19) of which each file uses three or four, hardcodes its ink as #010000, and wraps the
drawing in export furniture. On a page that lives in flash that is dead weight nine times
over, and a hardcoded colour cannot follow the theme (the sibling project had a control
whose colour was baked into an SVG no stylesheet could reach). So:

  - the stylesheet is removed and every element gets exactly the attributes its class gave
    it, no more: fill, stroke, stroke-width, stroke-linecap, stroke-linejoin, opacity, and
    stroke-miterlimit only where the join is a miter (it is meaningless on a round join)
  - #010000 becomes currentColor, in fills and strokes alike, so the icon takes the text
    colour of wherever it sits
  - the XML declaration, id="Layer_1", enable-background, xml:space, xmlns:xlink and the
    version attribute go; attribute-less <g> wrappers are unwrapped
  - the viewBox and every coordinate, every path, every stroke width stay exactly as drawn.
    Nothing about the artwork changes; this is about how it is expressed

The output is deterministic: one element per line, attributes in a fixed order, so a
re-run reproduces the committed file byte for byte and `--check` can prove it. The
residue sweep fails any tracked SVG that still carries the export furniture, as a hygiene
check: its appearance means unprocessed artwork was committed.
"""
import os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tools", "ui", "src", "icons")
INK = "#010000"
STYLE_ORDER = ["fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit", "opacity"]
GEOM_ORDER = ["d", "points", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "x", "y", "width", "height", "transform"]
DROP_ROOT = {"id", "style", "version", "xml:space", "xmlns:xlink", "enable-background", "x", "y"}

def parse_classes(svg):
    """.stN{...} rules -> {stN: {prop: value}}"""
    classes = {}
    for name, body in re.findall(r"\.(st\d+)\s*\{([^}]*)\}", svg):
        props = {}
        for decl in body.split(";"):
            if ":" in decl:
                k, v = decl.split(":", 1)
                props[k.strip()] = v.strip()
        classes[name] = props
    return classes

def styled(props):
    """The explicit attributes a class's properties become."""
    out = {}
    for k in ("fill", "stroke"):
        if k in props:
            v = props[k]
            out[k] = "currentColor" if v.lower() == INK else v
    for k in ("stroke-width", "stroke-linecap", "stroke-linejoin", "opacity"):
        if k in props: out[k] = props[k]
    if "stroke-miterlimit" in props and props.get("stroke-linejoin", "miter") == "miter" and "stroke" in props:
        out["stroke-miterlimit"] = props["stroke-miterlimit"]
    return out

def attrs_of(s):
    return re.findall(r'([\w:-]+)="([^"]*)"', s)

def normalise(svg):
    classes = parse_classes(svg)
    svg = re.sub(r"<\?xml[^>]*\?>\s*", "", svg)
    svg = re.sub(r"<style[^>]*>.*?</style>\s*", "", svg, flags=re.S)
    root = re.search(r"<svg\b([^>]*)>", svg)
    if not root: raise ValueError("no <svg> root")
    ra = dict(attrs_of(root.group(1)))
    vb = ra.get("viewBox")
    if not vb: raise ValueError("no viewBox")
    body = svg[root.end():svg.rfind("</svg>")]
    lines = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}">']
    depth = 1
    for m in re.finditer(r"<(/?)([\w:-]+)([^>]*?)(/?)>", body):
        close, tag, rest, selfclose = m.groups()
        if tag == "g" and not close and not attrs_of(rest):
            continue                                        # an attribute-less wrapper: unwrapped
        if tag == "g" and close:
            continue
        if close:
            depth -= 1; lines.append("  " * depth + f"</{tag}>"); continue
        a = dict(attrs_of(rest))
        cls = a.pop("class", None)
        style = {}
        if cls:
            for c in cls.split():
                if c not in classes: raise ValueError(f"class {c} has no rule")
                style.update(styled(classes[c]))
        for k in ("fill", "stroke"):                        # inline ink, if any
            if k in a and a[k].lower() == INK: a[k] = "currentColor"
        geom = [(k, a[k]) for k in GEOM_ORDER if k in a]
        other = [(k, v) for k, v in a.items() if k not in GEOM_ORDER and k not in STYLE_ORDER]
        sty = [(k, style[k]) for k in STYLE_ORDER if k in style]
        inline = [(k, a[k]) for k in STYLE_ORDER if k in a and k not in style]
        parts = " ".join(f'{k}="{v}"' for k, v in geom + other + sty + inline)
        if selfclose or tag in ("path", "polygon", "polyline", "line", "circle", "ellipse", "rect"):
            lines.append("  " * depth + f"<{tag} {parts}/>")
        else:
            lines.append("  " * depth + f"<{tag} {parts}>"); depth += 1
    lines.append("</svg>")
    return "\n".join(lines) + "\n"

FURNITURE = ["<?xml", "<style", 'class="st', 'id="Layer_1"', "enable-background", "xml:space", "xmlns:xlink", INK]

def check():
    bad = []
    for f in sorted(os.listdir(OUT)):
        if not f.endswith(".svg"): continue
        s = open(os.path.join(OUT, f)).read()
        for token in FURNITURE:
            if token in s: bad.append(f"{f}: carries {token!r}")
        if normalise(s) != s: bad.append(f"{f}: not idempotent under the normaliser")
    for b in bad: print("  " + b)
    print("icons: " + ("normalised, idempotent" if not bad else f"{len(bad)} problem(s)"))
    return 1 if bad else 0

def main(argv):
    if "--check" in argv: return check()
    inputs = []
    for a in argv:
        if os.path.isdir(a): inputs += [os.path.join(a, f) for f in sorted(os.listdir(a)) if f.endswith(".svg")]
        else: inputs.append(a)
    if not inputs: print(__doc__); return 2
    os.makedirs(OUT, exist_ok=True)
    for p in inputs:
        raw = open(p).read()
        out = normalise(raw)
        dst = os.path.join(OUT, os.path.basename(p))
        open(dst, "w").write(out)
        print(f"  {os.path.basename(p):22s} {len(raw):6d} -> {len(out):5d} bytes  ({100 - 100 * len(out) // len(raw)}% smaller)")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
