#!/usr/bin/env python3
"""
Generate the project's marks and favicon from primitives. Standard library only.

Provenance by construction. Every shape in every output is drawn by the code below from a
handful of numbers, so the origin of the artwork is this file and nothing else. Re-running
the script reproduces every byte; `--check` proves it by regenerating into a temporary
directory and comparing against what is committed.

The mark is a family mark. The panda face is Jeremy Kenedy's, the same primitives his
PandaVentOS banner generator draws (his own work; it crosses into this project freely,
CLAUDE.md Rule 6). It says these two products are one project line. Under it sits the
light bar, this product's own element: four round LEDs in a housing, three lit. The vent
carries the face alone; the Status carries the face over its bar. See D-011 (revised) and
D-030.

The favicon was designed at 16 px first and the geometry checked there: the face keeps
its ears and eye patches, the bar keeps three lit dots. The larger sizes are the same
numbers.

Outputs, all under art/:
    mark-light.svg          the mark for light backgrounds
    mark-dark.svg           the mark for dark backgrounds
    favicon-16.png, favicon-32.png, favicon-64.png      transparent, 4x4 supersampled
    apple-touch-icon-180.png                            on an opaque rounded ground (iOS composites on black otherwise)
    MARKS.md                what each file is, its size, its sha256, regenerated every run

Usage:
    python3 tools/art/gen_marks.py              regenerate everything into art/
    python3 tools/art/gen_marks.py --check      regenerate to a temp dir, diff, exit 1 on drift
    python3 tools/art/gen_marks.py --options DIR   the design options (A face over bar, B headband,
                                                   C bar only, D face only) at 16, 64 and 180, both grounds

The PNG encoder writes RGBA with filter type 0 on every row and zlib level 9. Both are
deterministic, and no timestamp or text chunk is written, so the bytes do not depend on
when or where the script ran.
"""

import argparse
import hashlib
import math
import os
import struct
import sys
import tempfile
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ART = os.path.join(ROOT, "art")

W = 96

PALETTES = {
    "light": {"housing": "#1D1B20", "lit": "#2FA86A", "lit_hi": "#7FE0A8", "dim": "#4A484E", "glow": "#2FA86A",
              "ink": "#2B2B2B", "face": "#FFFFFF", "pink": "#F26B8A", "ground": "#F7FAF5"},
    "dark":  {"housing": "#E6E1E5", "lit": "#2FA86A", "lit_hi": "#7FE0A8", "dim": "#B8B3BC", "glow": "#2FA86A",
              "ink": "#20261F", "face": "#F4F7F3", "pink": "#F26B8A", "ground": "#0B0F0C"},
}

# ---------------------------------------------------------------------------------------
# Primitives. Each is (kind, params, fill_hex, alpha). Kinds: rrect, circle, ellipse
# (rotated, degrees), stroke (a polyline with round caps; 'svg' carries the true path).
# ---------------------------------------------------------------------------------------

def quad(p0, c, p1, n=14):
    """Points along a quadratic Bezier, for the rasteriser's polyline."""
    out = []
    for i in range(n + 1):
        t = i / n
        out.append(((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0],
                    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]))
    return out


def panda(p, ox, oy, s):
    """The face, in a 100-unit box scaled by s and placed at ox, oy. Jeremy Kenedy's."""
    ink, face, pink = p["ink"], p["face"], p["pink"]
    X = lambda x: ox + s * x
    Y = lambda y: oy + s * y
    R = lambda r: s * r
    out = [
        ("circle", dict(cx=X(23), cy=Y(25), r=R(17)), ink, 1.0),
        ("circle", dict(cx=X(77), cy=Y(25), r=R(17)), ink, 1.0),
        ("circle", dict(cx=X(23), cy=Y(25), r=R(8.5)), pink, 1.0),
        ("circle", dict(cx=X(77), cy=Y(25), r=R(8.5)), pink, 1.0),
        ("ellipse", dict(cx=X(50), cy=Y(56), rx=R(43), ry=R(38), rot=0), face, 1.0),
        ("ellipse", dict(cx=X(31), cy=Y(53), rx=R(13), ry=R(15.5), rot=-14), ink, 1.0),
        ("ellipse", dict(cx=X(69), cy=Y(53), rx=R(13), ry=R(15.5), rot=14), ink, 1.0),
        ("circle", dict(cx=X(32.5), cy=Y(52), r=R(5.6)), face, 1.0),
        ("circle", dict(cx=X(67.5), cy=Y(52), r=R(5.6)), face, 1.0),
        ("circle", dict(cx=X(33.5), cy=Y(53.5), r=R(3.1)), ink, 1.0),
        ("circle", dict(cx=X(66.5), cy=Y(53.5), r=R(3.1)), ink, 1.0),
        ("ellipse", dict(cx=X(13), cy=Y(69), rx=R(7.5), ry=R(5), rot=0), pink, 0.75),
        ("ellipse", dict(cx=X(87), cy=Y(69), rx=R(7.5), ry=R(5), rot=0), pink, 0.75),
        ("ellipse", dict(cx=X(50), cy=Y(68), rx=R(4.6), ry=R(3.4), rot=0), ink, 1.0),
        ("stroke", dict(pts=[(X(50), Y(71.5)), (X(50), Y(75))], w=R(2.2),
                        svg=f"M{X(50):.2f} {Y(71.5):.2f} v{R(3.5):.2f}"), ink, 1.0),
        ("stroke", dict(pts=quad((X(43.5), Y(75)), (X(50), Y(81)), (X(56.5), Y(75))), w=R(2.2),
                        svg=f"M{X(43.5):.2f} {Y(75):.2f} q{R(6.5):.2f} {R(6):.2f} {R(13):.2f} 0"), ink, 1.0),
    ]
    return out


def bar(p, x, y, w, h, led_r, lit=(True, True, True, False), glow=True):
    """The light bar: a pill housing with four LEDs on its centreline, three lit."""
    r = h / 2
    n = len(lit)
    step = (w - 2 * r) / (n - 1)
    xs = [x + r + i * step for i in range(n)]
    cy = y + r
    out = [("rrect", dict(x=x, y=y, w=w, h=h, r=r), p["housing"], 1.0)]
    if glow:
        for cx, on in zip(xs, lit):
            if on: out.append(("circle", dict(cx=cx, cy=cy, r=led_r * 1.5), p["glow"], 0.28))
    for cx, on in zip(xs, lit):
        out.append(("circle", dict(cx=cx, cy=cy, r=led_r), p["lit"] if on else p["dim"], 1.0))
        if on: out.append(("circle", dict(cx=cx - led_r * 0.32, cy=cy - led_r * 0.34, r=led_r * 0.38), p["lit_hi"], 0.9))
    return out


def shapes(palette, option="A"):
    p = PALETTES[palette]
    if option == "A":      # the mark: face over the bar
        return panda(p, 15, 0, 0.66) + bar(p, 10, 66, 76, 24, 6.5)
    if option == "B":      # a headband across the forehead
        return panda(p, 6, 6, 0.88) + bar(p, 14, 32, 68, 16, 4.6)
    if option == "C":      # the bar alone, this project's mark before the family mark
        return bar(p, 6, 30, 84, 36, 9.5, glow=True)
    if option == "D":      # the face alone, as the vent carries it
        return panda(p, 6, 6, 0.88)
    raise ValueError(option)


# ---------------------------------------------------------------------------------------
# SVG
# ---------------------------------------------------------------------------------------

def fmt(v):
    s = f"{v:.2f}".rstrip("0").rstrip(".")
    return s if s else "0"


def svg(palette, option="A"):
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {W}" width="{W}" height="{W}">',
        f'  <!-- generated by tools/art/gen_marks.py, palette {palette}. Do not edit; regenerate. -->',
    ]
    for kind, g, fill, a in shapes(palette, option):
        op = "" if a >= 1.0 else f' fill-opacity="{fmt(a)}"'
        if kind == "rrect":
            parts.append(f'  <rect x="{fmt(g["x"])}" y="{fmt(g["y"])}" width="{fmt(g["w"])}" height="{fmt(g["h"])}" rx="{fmt(g["r"])}" fill="{fill}"{op}/>')
        elif kind == "circle":
            parts.append(f'  <circle cx="{fmt(g["cx"])}" cy="{fmt(g["cy"])}" r="{fmt(g["r"])}" fill="{fill}"{op}/>')
        elif kind == "ellipse":
            tr = f' transform="rotate({fmt(g["rot"])} {fmt(g["cx"])} {fmt(g["cy"])})"' if g["rot"] else ""
            parts.append(f'  <ellipse cx="{fmt(g["cx"])}" cy="{fmt(g["cy"])}" rx="{fmt(g["rx"])}" ry="{fmt(g["ry"])}" fill="{fill}"{op}{tr}/>')
        else:
            parts.append(f'  <path d="{g["svg"]}" fill="none" stroke="{fill}" stroke-width="{fmt(g["w"])}" stroke-linecap="round"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------------------
# Rasteriser. Coverage by supersampling, alpha compositing back to front.
# ---------------------------------------------------------------------------------------

def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def inside_rrect(px, py, g):
    x, y, w, h, r = g["x"], g["y"], g["w"], g["h"], g["r"]
    if px < x or px > x + w or py < y or py > y + h:
        return False
    cx = x + r if px < x + r else (x + w - r if px > x + w - r else None)
    cy = y + r if py < y + r else (y + h - r if py > y + h - r else None)
    if cx is None or cy is None:
        return True
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r


def inside_circle(px, py, g):
    return (px - g["cx"]) ** 2 + (py - g["cy"]) ** 2 <= g["r"] ** 2


def inside_ellipse(px, py, g):
    dx, dy = px - g["cx"], py - g["cy"]
    if g["rot"]:
        a = math.radians(-g["rot"])
        dx, dy = dx * math.cos(a) - dy * math.sin(a), dx * math.sin(a) + dy * math.cos(a)
    return (dx / g["rx"]) ** 2 + (dy / g["ry"]) ** 2 <= 1.0


def inside_stroke(px, py, g):
    hw2 = (g["w"] / 2) ** 2
    pts = g["pts"]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        vx, vy = x1 - x0, y1 - y0
        L2 = vx * vx + vy * vy
        t = 0.0 if L2 == 0 else max(0.0, min(1.0, ((px - x0) * vx + (py - y0) * vy) / L2))
        ex, ey = x0 + t * vx - px, y0 + t * vy - py
        if ex * ex + ey * ey <= hw2:
            return True
    return False


INSIDE = {"rrect": inside_rrect, "circle": inside_circle, "ellipse": inside_ellipse, "stroke": inside_stroke}


def raster(palette, size, option="A", ss=4, ground=None):
    """RGBA rows, size x size. Transparent, or on an opaque rounded ground when asked."""
    shp = [(kind, g, hex_rgb(fill), a) for kind, g, fill, a in shapes(palette, option)]
    if ground:
        shp.insert(0, ("rrect", dict(x=0, y=0, w=W, h=W, r=W * 0.22), hex_rgb(ground), 1.0))
    scale = W / size
    sub = [(i + 0.5) / ss for i in range(ss)]
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc_r = acc_g = acc_b = acc_a = 0.0
            for sy in sub:
                uy = (py + sy) * scale
                for sx in sub:
                    ux = (px + sx) * scale
                    r = g_ = b = a = 0.0
                    for kind, g, (cr, cg, cb), ca in shp:
                        if not INSIDE[kind](ux, uy, g):
                            continue
                        r = cr * ca + r * (1 - ca)
                        g_ = cg * ca + g_ * (1 - ca)
                        b = cb * ca + b * (1 - ca)
                        a = ca + a * (1 - ca)
                    acc_r += r * a
                    acc_g += g_ * a
                    acc_b += b * a
                    acc_a += a
            n = ss * ss
            A = acc_a / n
            if A > 0:
                R, G, B = acc_r / acc_a, acc_g / acc_a, acc_b / acc_a
            else:
                R = G = B = 0.0
            row += bytes((int(round(R)), int(round(G)), int(round(B)), int(round(A * 255))))
        rows.append(bytes(row))
    return rows


def png(rows, size):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + r for r in rows)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


# ---------------------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------------------

OUTPUTS = [
    ("mark-light.svg", lambda: svg("light").encode()),
    ("mark-dark.svg", lambda: svg("dark").encode()),
    ("favicon-16.png", lambda: png(raster("light", 16), 16)),
    ("favicon-32.png", lambda: png(raster("light", 32), 32)),
    ("favicon-64.png", lambda: png(raster("light", 64), 64)),
    ("apple-touch-icon-180.png", lambda: png(raster("light", 180, ground=PALETTES["light"]["ground"]), 180)),
]


def build(outdir):
    os.makedirs(outdir, exist_ok=True)
    written = []
    for name, make in OUTPUTS:
        data = make()
        with open(os.path.join(outdir, name), "wb") as fh:
            fh.write(data)
        written.append((name, len(data), hashlib.sha256(data).hexdigest()))
    md = ["# Marks", "",
          "Generated by `tools/art/gen_marks.py`. Do not edit these files; edit the generator",
          "and re-run it. `python3 tools/art/gen_marks.py --check` proves the committed files",
          "are exactly what the generator produces.", "",
          "The mark is the family mark: Jeremy Kenedy's panda face over this product's light bar.",
          "The face is his own work, the same primitives as PandaVentOS's banner; the bar is this",
          "project's. See `docs/DECISIONS.md` D-010, D-011 and D-030, and `tools/ui/src/ARTWORK.md`.", "",
          "| File | Bytes | sha256 |", "|---|---:|---|"]
    for name, n, h in written:
        md.append(f"| `{name}` | {n:,} | `{h}` |")
    md.append("")
    with open(os.path.join(outdir, "MARKS.md"), "w") as fh:
        fh.write("\n".join(md))
    return written


def check():
    with tempfile.TemporaryDirectory() as tmp:
        build(tmp)
        drift = []
        for name, _ in OUTPUTS + [("MARKS.md", None)]:
            a, b = os.path.join(ART, name), os.path.join(tmp, name)
            if not os.path.exists(a):
                drift.append(f"missing: art/{name}"); continue
            if open(a, "rb").read() != open(b, "rb").read():
                drift.append(f"differs: art/{name}")
        if drift:
            print("DRIFT between art/ and the generator:")
            for d in drift: print("  " + d)
            return 1
        print(f"art/ matches the generator byte for byte ({len(OUTPUTS) + 1} files)")
        return 0


def options(outdir):
    """Every option at every size on both grounds, for a human to look at."""
    os.makedirs(outdir, exist_ok=True)
    for opt in "ABCD":
        for pal in ("light", "dark"):
            for size in (16, 64, 180):
                with open(os.path.join(outdir, f"{opt}-{pal}-{size}.png"), "wb") as fh:
                    fh.write(png(raster(pal, size, opt, ground=PALETTES[pal]["ground"]), size))
            with open(os.path.join(outdir, f"{opt}-{pal}.svg"), "w") as fh:
                fh.write(svg(pal, opt))
    print(f"options written to {outdir}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="verify art/ against a fresh build")
    ap.add_argument("--options", metavar="DIR", help="render the design options A to D for comparison")
    ap.add_argument("--out", default=ART, help=argparse.SUPPRESS)
    args = ap.parse_args()
    if args.check:
        return check()
    if args.options:
        options(args.options); return 0
    for name, n, h in build(args.out):
        print(f"  {name:28s} {n:7,} B  {h[:16]}...")
    print(f"  wrote -> {os.path.relpath(args.out, ROOT)}/  (+ MARKS.md)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
