#!/usr/bin/env python3
"""Draw the stage icons that neither Heroicons nor the project's drawn set covers.

    python3 tools/ui/gen_icons.py            write tools/ui/src/icons/<name>.svg for each icon below
    python3 tools/ui/gen_icons.py --check    regenerate in memory and compare; exit 1 on drift

Same model as tools/art/gen_marks.py: primitives in, files out, provenance by regeneration.
The grid and the weight are the drawn set's (96 box, stroke 4, round caps and joins,
currentColor) so these sit beside Jeremy's icons as one set. The output is written in the
normaliser's own format, so tools/ui/normalize_icons.py --check accepts it unchanged.

    bed-level    a bed plate under a spirit level: the bed_leveling stage
    mesh         a bed plate under a 3 x 3 probe grid: the xy_mesh_mode_sweep stage
    flow         a nozzle tip, an extruded bead and a caliper: the calibrating_flow stage
    eye          an open eye: reveal what a password field is hiding
    eye-slash    the same eye struck through: hide it again

Heroicons has an eye and an eye-slash, and they are not used here: nothing in this tree
vendors them, and a vendor row has to state the sha256 of the upstream bytes it shipped.
Drawing them from primitives on the drawn set's own grid is honest and checkable; claiming
an upstream hash for a file this project wrote would not be.
"""
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "tools", "ui", "src", "icons")
STROKE = 'fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"'
THIN = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
FILL = 'fill="currentColor"'

def f(v):
    s = f"{v:.1f}".rstrip("0").rstrip(".")
    return s if s else "0"

def bed():
    """The plate every bed icon shares: a slab seen a little from above, with its front edge."""
    return [f'<path d="M14,64h68" {STROKE}/>',
            f'<path d="M20,64l-4,10h64l-4,-10" {STROKE}/>',
            f'<path d="M24,80h48" {THIN}/>']

ICONS = {
    "bed-level": bed() + [
        f'<path d="M22,38h52" {STROKE}/>',                              # the level's body
        f'<circle cx="48" cy="38" r="7" {STROKE}/>',                     # the bubble
        f'<path d="M36,32v12" {THIN}/>', f'<path d="M60,32v12" {THIN}/>',  # the marks the bubble sits between
        f'<path d="M22,52h52" {THIN}/>',                                 # the plane it proves
    ],
    "mesh": bed() + [
        *[f'<circle cx="{f(x)}" cy="{f(y)}" r="3.5" {FILL}/>' for y in (22, 36, 50) for x in (30, 48, 66)],
        *[f'<path d="M30,{f(y)}h36" {THIN}/>' for y in (22, 36, 50)],
        *[f'<path d="M{f(x)},22v28" {THIN}/>' for x in (30, 48, 66)],
    ],
    "flow": [
        f'<path d="M36,10h24v10l-6,10h-12l-6,-10z" {STROKE}/>',           # the nozzle tip
        f'<path d="M48,34c0,10,-8,12,-8,22c0,8,16,8,16,16" fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>',   # the bead
        f'<path d="M18,84h60" {STROKE}/>',                                # the caliper
        f'<path d="M18,78v12" {STROKE}/>', f'<path d="M78,78v12" {STROKE}/>',
        f'<path d="M33,80v8" {THIN}/>', f'<path d="M48,80v8" {THIN}/>', f'<path d="M63,80v8" {THIN}/>',
    ],
    "eye": [
        f'<path d="M8,48C20,30,34,22,48,22C62,22,76,30,88,48C76,66,62,74,48,74C34,74,20,66,8,48Z" {STROKE}/>',
        f'<circle cx="48" cy="48" r="13" {STROKE}/>',
    ],
    "eye-slash": [
        f'<path d="M8,48C20,30,34,22,48,22C62,22,76,30,88,48C76,66,62,74,48,74C34,74,20,66,8,48Z" {STROKE}/>',
        f'<circle cx="48" cy="48" r="13" {STROKE}/>',
        f'<path d="M16,80L80,16" {STROKE}/>',
    ],
}

def svg(name):
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">\n' + "".join("  " + e + "\n" for e in ICONS[name]) + "</svg>\n"

def main(argv):
    if "--check" in argv:
        drift = [n for n in ICONS if not os.path.exists(os.path.join(OUT, n + ".svg")) or open(os.path.join(OUT, n + ".svg")).read() != svg(n)]
        print("generated icons: " + ("match the generator" if not drift else "DRIFT: " + ", ".join(drift)))
        return 1 if drift else 0
    os.makedirs(OUT, exist_ok=True)
    for n in ICONS:
        open(os.path.join(OUT, n + ".svg"), "w").write(svg(n)); print(f"  {n}.svg  {len(svg(n))} B")
    return 0

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
