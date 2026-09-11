#!/usr/bin/env python3
"""Build the README banner, light and dark, from the page's own M3 tokens.

One generator, two palettes, so the two files can never drift apart. The panda is drawn,
not embedded: a banner is the one image that gets scaled to whatever width a reader's
browser feels like, and a raster blown up looks like a mistake. The face is Jeremy
Kenedy's, the same primitives as tools/art/gen_marks.py and PandaVentOS's own banner
(his work; it crosses freely, CLAUDE.md Rule 6); the light bar on the right is this
product's.

    python3 tools/art/gen_banner.py            writes art/banner-light.svg and art/banner-dark.svg
    python3 tools/art/gen_banner.py --check    regenerate in memory, compare, exit 1 on drift
"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "art")

# tools/ui/src/css/theme.css, the light and dark token sets
LIGHT = dict(surface="#f8faf5", on_surface="#191c1a", on_surface_variant="#414942",
             primary="#1f6b45", outline="#717971", face="#FFFFFF", ink="#2B2B2B")
DARK = dict(surface="#111412", on_surface="#e1e3de", on_surface_variant="#c0c9bf",
            primary="#8ed5ab", outline="#8b938a", face="#F4F7F3", ink="#20261F")
PINK = "#F26B8A"
LIT = ["#8FD3A6", "#5FBF88", "#3FA36C", "#2E7D32"]          # four lit LEDs, the greens the bar shows
FONT = ("ui-sans-serif,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,"
        "'Helvetica Neue',Arial,sans-serif")


def panda(p, x, y, s):
    """The face mark, drawn in a 100x100 box scaled by s and placed at x,y."""
    ink, face = p["ink"], p["face"]
    return f'''  <g transform="translate({x},{y}) scale({s})">
    <circle cx="23" cy="25" r="17" fill="{ink}"/>
    <circle cx="77" cy="25" r="17" fill="{ink}"/>
    <circle cx="23" cy="25" r="8.5" fill="{PINK}"/>
    <circle cx="77" cy="25" r="8.5" fill="{PINK}"/>
    <ellipse cx="50" cy="56" rx="43" ry="38" fill="{face}"/>
    <ellipse cx="31" cy="53" rx="13" ry="15.5" fill="{ink}" transform="rotate(-14 31 53)"/>
    <ellipse cx="69" cy="53" rx="13" ry="15.5" fill="{ink}" transform="rotate(14 69 53)"/>
    <circle cx="32.5" cy="52" r="5.6" fill="{face}"/>
    <circle cx="67.5" cy="52" r="5.6" fill="{face}"/>
    <circle cx="33.5" cy="53.5" r="3.1" fill="{ink}"/>
    <circle cx="66.5" cy="53.5" r="3.1" fill="{ink}"/>
    <ellipse cx="13" cy="69" rx="7.5" ry="5" fill="{PINK}" opacity=".75"/>
    <ellipse cx="87" cy="69" rx="7.5" ry="5" fill="{PINK}" opacity=".75"/>
    <ellipse cx="50" cy="68" rx="4.6" ry="3.4" fill="{ink}"/>
    <path d="M50 71.5 v3.5" stroke="{ink}" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    <path d="M43.5 75 q6.5 6 13 0" stroke="{ink}" stroke-width="2.2"
          stroke-linecap="round" fill="none"/>
  </g>'''


def bar(p, x, y, w, h, lit):
    """The light bar: a pill housing, eight LEDs, the first ones lit, a glow under each lit one."""
    r = h / 2
    n = 8
    step = (w - 2 * r) / (n - 1)
    out = [f'  <rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" fill="{p["on_surface"]}" opacity=".92"/>']
    for i in range(n):
        cx = x + r + i * step
        cy = y + r
        if i < lit:
            out.append(f'  <circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * 0.78:.1f}" fill="{LIT[i % 4]}" opacity=".35"/>')
            out.append(f'  <circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * 0.52:.1f}" fill="{LIT[i % 4]}"/>')
            out.append(f'  <circle cx="{cx - r * 0.17:.1f}" cy="{cy - r * 0.18:.1f}" r="{r * 0.18:.1f}" fill="#DFF7E8" opacity=".9"/>')
        else:
            out.append(f'  <circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r * 0.52:.1f}" fill="{p["surface"]}" opacity=".35"/>')
    return "\n".join(out)


def build(p):
    W, H = 880, 215
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}"
     viewBox="0 0 {W} {H}" role="img" aria-label="PandaStatusOS">
  <rect width="{W}" height="{H}" rx="28" fill="{p['surface']}"/>
  <rect x="1" y="1" width="{W - 2}" height="{H - 2}" rx="27" fill="none"
        stroke="{p['outline']}" stroke-width="1" opacity=".35"/>
{panda(p, 56, 50, 1.16)}
  <text x="206" y="98" font-family="{FONT}" font-size="52" font-weight="700"
        letter-spacing="-1" fill="{p['on_surface']}">PandaStatus<tspan
        fill="{p['primary']}" font-weight="600">OS</tspan></text>
  <text x="208" y="132" font-family="{FONT}" font-size="17" font-weight="400"
        letter-spacing=".2" fill="{p['on_surface_variant']}">Open firmware for the BIGTREETECH Panda Status P2</text>
  <text x="208" y="160" font-family="{FONT}" font-size="14" font-weight="500"
        letter-spacing="1.4" fill="{p['primary']}">FIFTEEN STAGE ANIMATIONS  &#183;  TWO MODES  &#183;  25 LANGUAGES</text>
{bar(p, 640, 70, 210, 44, 5)}
</svg>
'''


def main(argv):
    files = {os.path.join(OUT, f"banner-{name}.svg"): build(pal) for name, pal in (("light", LIGHT), ("dark", DARK))}
    if "--check" in argv:
        drift = [os.path.relpath(f, ROOT) for f, s in files.items() if not os.path.exists(f) or open(f).read() != s]
        print("banners: " + ("match the generator" if not drift else "DRIFT: " + ", ".join(drift)))
        return 1 if drift else 0
    os.makedirs(OUT, exist_ok=True)
    for f, s in files.items():
        open(f, "w").write(s); print(f"{os.path.relpath(f, ROOT)}  {len(s)} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
