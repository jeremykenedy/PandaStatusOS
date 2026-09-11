#!/usr/bin/env python3
"""
Assemble the served page. Standard library only.

    python3 tools/ui/build/build.py            build firmware/main/ui.html
    python3 tools/ui/build/build.py --check    build to memory, compare, exit 1 on drift
    python3 tools/ui/build/build.py --strings fetch    (the seam; not implemented, see below)

ONE SOURCE OF TRUTH. firmware/main/ui.html is an OUTPUT. Nobody edits it. Every byte comes
from tools/ui/src/, tools/ui/i18n/, art/, and firmware/main/vendor/, through this script.
The gzip the firmware embeds is produced by CMake from that file with gzip -9 -n, and is
gitignored because macOS and GNU gzip disagree on the bytes.

NO ABSOLUTE PATHS. Everything is found from this file's own location.

What the build asserts, and why each assertion exists (each one is a bug the sibling
project shipped):
  - the marks in art/ are exactly what their generator produces (provenance by re-run)
  - every vendored file's sha256 matches the hash its vendor README states, before it is
    spliced (a vendor row is a claim, so it is checked)
  - every text-bearing element carries a data-ps-str key, every key exists in the English
    table, and every tr('...') in the modules does too (English fallback hides a missing
    key; five shipped that way)
  - no id_ or c_ token anywhere in the output (standing rule 8, at build time)
  - no inline on*= handlers (modules wire their own listeners)
  - no external asset reference: the device serves ONE file and nothing else
  - every card has a data-ps-card and an id; every nav target names a card that exists
    (a page once painted over every other page, invisible below the fold)
  - every slot in frame.html was replaced and none is left behind

THE SEAM. The language tables reach the page through exactly one function here,
strings_block(). It returns the inline <script> today. The alternative, a <script src>
that the firmware serves per language, is the same function returning a different string,
plus a route in the firmware. If the dump shows tight flash, that path gets built; nothing
else in the page changes, because nothing else knows where the tables came from.
"""

import argparse
import base64
import hashlib
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(ROOT, "tools", "ui", "src")
I18N = os.path.join(ROOT, "tools", "ui", "i18n")
ART = os.path.join(ROOT, "art")
VENDOR = os.path.join(ROOT, "firmware", "main", "vendor")
OUT = os.path.join(ROOT, "firmware", "main", "ui.html")

PAGES = ["dashboard", "lighting", "images", "printer", "network", "system", "logs", "setup"]
SLOT = "<!--@@%s@@-->"


def die(msg):
    print(f"build: {msg}", file=sys.stderr)
    sys.exit(1)


def read(p, mode="r"):
    with open(p, mode, encoding=None if "b" in mode else "utf-8") as fh:
        return fh.read()


def sha256(data):
    return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def rel(p):
    return os.path.relpath(p, ROOT)


# ---------------------------------------------------------------------------------------
# Vendor rows: the README is the claim; the file is checked against it before splicing.
# ---------------------------------------------------------------------------------------

def vendored(dep, fname):
    p = os.path.join(VENDOR, dep, fname)
    readme = read(os.path.join(VENDOR, dep, "README.md"))
    m = re.search(r"`" + re.escape(fname) + r"`\s*\|[^|]*sha256\s*`([0-9a-f]{64})`", readme)
    if not m:
        die(f"vendor/{dep}/README.md states no sha256 for {fname}; nothing ships without a row")
    data = read(p, "rb")
    got = sha256(data)
    if got != m.group(1):
        die(f"vendor/{dep}/{fname} sha256 {got[:16]}... does not match its README {m.group(1)[:16]}...")
    return data.decode("utf-8")


# ---------------------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------------------

def notice_block():
    """Third-party notices travel inside the served page, because the device serves one
    file and whoever holds a flashed device holds no repository."""
    rows = []
    for dep in sorted(os.listdir(VENDOR)):
        rp = os.path.join(VENDOR, dep, "README.md")
        if not os.path.isfile(rp):
            continue
        readme = read(rp)
        title = readme.splitlines()[0].lstrip("# ").strip()
        lic = re.search(r"\|\s*licence\s*\|\s*([^|]+)\|", readme)
        src = re.search(r"\|\s*(?:source|licence source)\s*\|\s*(\S+)", readme)
        rows.append(f"  {title}: {lic.group(1).strip() if lic else '?'}; {src.group(1) if src else ''}")
    return ("<!--\n  This page carries third-party components under their own licences. The\n"
            "  licence texts are in firmware/main/vendor/ in the source repository.\n" + "\n".join(rows) +
            "\n  Everything else is MIT, copyright Jeremy Kenedy.\n-->\n")


def favicons_block():
    def data_url(name, mime):
        return f"data:{mime};base64," + base64.b64encode(read(os.path.join(ART, name), "rb")).decode()
    return (f'<link rel="icon" type="image/png" sizes="32x32" href="{data_url("favicon-32.png", "image/png")}">\n'
            f'<link rel="icon" type="image/png" sizes="16x16" href="{data_url("favicon-16.png", "image/png")}">\n'
            f'<link rel="apple-touch-icon" sizes="180x180" href="{data_url("apple-touch-icon-180.png", "image/png")}">')


def mark_svg(name, cls):
    svg = read(os.path.join(ART, name))
    svg = re.sub(r"<!--.*?-->\s*", "", svg, flags=re.S)
    svg = re.sub(r'<svg ([^>]*?)width="\d+" height="\d+"', r'<svg \1', svg, count=1)
    return svg.replace("<svg ", f'<svg class="{cls}" aria-hidden="true" ', 1).strip()


def sprite_block():
    """One inline sprite, a build artifact of two sets: Heroicons from vendor/heroicons/outline/
    (pristine upstream files, gated by their README's sha256) and the project's own icons from
    tools/ui/src/icons/ (Jeremy Kenedy's, MIT, tools/ui/src/ARTWORK.md). Both get the ps-icon-
    prefix. The sprite's hash fingerprints the mixture and is evidence about neither set
    (docs/ARCHITECTURE.md). Returns (html, sha256, count)."""
    symbols = []
    hero = os.path.join(VENDOR, "heroicons", "outline")
    ours = os.path.join(SRC, "icons")
    hero_readme = read(os.path.join(VENDOR, "heroicons", "README.md"))
    for d, prefix in ((hero, "ps-icon-"), (ours, "ps-icon-")):
        if not os.path.isdir(d):
            continue
        for f in sorted(os.listdir(d)):
            if not f.endswith(".svg"):
                continue
            if d == hero:
                m = re.search(r"`outline/" + re.escape(f) + r"`\s*\|\s*`([0-9a-f]{64})`", hero_readme)
                if not m:
                    die(f"vendor/heroicons/outline/{f} has no row in its README; nothing ships without a row")
                if sha256(read(os.path.join(d, f), "rb")) != m.group(1):
                    die(f"vendor/heroicons/outline/{f} does not match the sha256 its README states")
            svg = read(os.path.join(d, f))
            inner = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.S)
            vb = re.search(r'viewBox="([^"]+)"', svg)
            if not inner or not vb:
                die(f"icon {rel(os.path.join(d, f))} has no viewBox or body")
            name = prefix + f[:-4]
            if d == hero:
                # Heroicons files carry only path data; the set's presentation is the outline set's
                symbols.append(f'<symbol id="{name}" viewBox="{vb.group(1)}" fill="none" stroke="currentColor" '
                               f'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">{inner.group(1).strip()}</symbol>')
            else:
                # the project's own icons: every element carries its own attributes (tools/ui/normalize_icons.py),
                # so the symbol imposes nothing, and a butt cap stays a butt cap
                body = re.sub(r"\s*\n\s*", "", inner.group(1).strip())
                symbols.append(f'<symbol id="{name}" viewBox="{vb.group(1)}">{body}</symbol>')
    html = '<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">' + "".join(symbols) + "</svg>"
    return html, sha256(html), len(symbols)


def pages_block():
    out = []
    for name in PAGES:
        p = os.path.join(SRC, "pages", f"{name}.html")
        if not os.path.isfile(p):
            continue
        out.append(f"<!-- page: {name} -->\n" + read(p).strip())
    if not out:
        die("no pages found under tools/ui/src/pages/")
    return "\n".join(out)


def strings_block(mode):
    """THE SEAM. See the module docstring."""
    if mode == "inline":
        r = subprocess.run([sys.executable, os.path.join(HERE, "i18n.py"), "strings"], capture_output=True, text=True)
        if r.returncode != 0:
            die("string table did not build:\n" + r.stdout + r.stderr)
        js = read(os.path.join(I18N, "ps_strings.js"))
        return f"<script>\n{js}\n</script>"
    if mode == "fetch":
        die("--strings fetch is the deferred path: a <script src> per language served by the firmware. "
            "Not built until the dump says flash is tight. See docs/ROADMAP.md, languages.")
    die(f"unknown strings mode {mode}")


def modules_block():
    d = os.path.join(SRC, "modules")
    out = []
    for f in sorted(os.listdir(d)):          # filename order is load order; 00-core.js first
        if f.endswith(".js"):
            out.append(f"<script>\n// module: {f}\n{read(os.path.join(d, f)).strip()}\n</script>")
    return "\n".join(out)


# ---------------------------------------------------------------------------------------
# Assemble
# ---------------------------------------------------------------------------------------

def assemble(strings_mode):
    # provenance of the marks, by re-running their generator
    r = subprocess.run([sys.executable, os.path.join(ROOT, "tools", "art", "gen_marks.py"), "--check"], capture_output=True, text=True)
    if r.returncode != 0:
        die("art/ does not match its generator:\n" + r.stdout)

    # i18n: every element tagged, every key namespaced, then derive the English table
    for sub in ("check", "collect"):
        r = subprocess.run([sys.executable, os.path.join(HERE, "i18n.py"), sub], capture_output=True, text=True)
        if r.returncode != 0:
            die(f"i18n {sub} failed:\n" + r.stdout + r.stderr)
        if r.stdout.strip():
            print(r.stdout.strip())

    frame = read(os.path.join(SRC, "frame.html"))
    sprite, sprite_sha, n_icons = sprite_block()
    pieces = {
        "NOTICE": notice_block(),
        "FAVICONS": favicons_block(),
        "BEER_CSS": "<style>\n" + vendored("beercss", "beer.min.css") + "\n</style>",
        "COLORIS_CSS": "<style>\n" + vendored("coloris", "coloris.min.css") + "\n</style>",
        "THEME_CSS": "<style>\n" + read(os.path.join(SRC, "css", "theme.css")) + "\n</style>",
        "APP_CSS": "<style>\n" + read(os.path.join(SRC, "css", "app.css")) + "\n</style>",
        "SPRITE": sprite,
        "MARK_LIGHT": mark_svg("mark-light.svg", "ps-mark ps-mark-light"),
        "MARK_DARK": mark_svg("mark-dark.svg", "ps-mark ps-mark-dark"),
        "PAGES": pages_block(),
        "GLOBAL": read(os.path.join(SRC, "global.html")).strip(),
        "STRINGS": strings_block(strings_mode),
        "BEER_JS": '<script type="module">\n' + vendored("beercss", "beer.min.js") + "\n</script>",
        "COLORIS_JS": "<script>\n" + vendored("coloris", "coloris.min.js") + "\n</script>",
        "MODULES": modules_block(),
    }
    html = frame
    for name, body in pieces.items():
        slot = SLOT % name
        if html.count(slot) != 1:
            die(f"frame.html must contain the slot {slot} exactly once (found {html.count(slot)})")
        html = html.replace(slot, body)
    left = re.findall(r"<!--@@[A-Z_]+@@-->", html)
    if left:
        die(f"slots left unreplaced: {left}")

    # -------- structural asserts on the OUTPUT --------
    cards = re.findall(r'<article[^>]*\bdata-ps-card\b[^>]*\bid="(ps-card-[a-z0-9-]+)"', html)
    cards2 = re.findall(r'<article[^>]*\bid="(ps-card-[a-z0-9-]+)"[^>]*\bdata-ps-card\b', html)
    card_ids = set(cards) | set(cards2)
    all_articles = re.findall(r'<article[^>]*\bid="(ps-card-[a-z0-9-]+)"', html)
    for a in all_articles:
        if a not in card_ids:
            die(f"card {a} lacks data-ps-card; a card without it paints over every other page")
    navs = set(re.findall(r'data-ps-nav="([a-z0-9-]+)"', html))
    for n in navs:
        if f"ps-card-{n}" not in card_ids:
            die(f"nav target {n} names no card")
    if re.search(r'\son[a-z]+="', html):
        die("inline on*= handler in output; modules wire their own listeners")
    if re.search(r"\b(id_|c_)[a-z]", html):
        die("id_ or c_ token in output; standing rule 8")
    ext = re.findall(r'(?:src|href)="(https?://[^"]+)"', html)
    ext = [e for e in ext if not e.startswith("http://www.w3.org/")]
    if ext:
        die(f"external asset reference in output; the device serves one file: {ext[:3]}")

    # -------- every key used is backed by English --------
    import json
    en = json.loads(read(os.path.join(I18N, "en.json")))
    used = set(re.findall(r'data-ps-str(?:-title|-placeholder|-aria)?="(ps_[a-z0-9_]+)"', html))
    used |= set(re.findall(r"\b(?:tr|pill)\(\s*['\"](ps_[a-z0-9_]+)['\"]", html))   # PS.tr(key), PS.pill(key)
    used |= set(re.findall(r"\bkey:\s*['\"](ps_[a-z0-9_]+)['\"]", html))            # dialog button keys
    missing = sorted(k for k in used if k not in en)
    if missing:
        die(f"keys used in the page but absent from en.json: {missing[:10]}")

    return html, {"sprite_sha256": sprite_sha, "icons": n_icons, "keys_used": len(used)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true", help="assemble and compare with the committed output")
    ap.add_argument("--strings", default="inline", choices=["inline", "fetch"], help="the seam. inline today")
    args = ap.parse_args()

    html, info = assemble(args.strings)
    data = html.encode("utf-8")
    gz = subprocess.run(["gzip", "-9", "-n", "-c"], input=data, capture_output=True).stdout

    if args.check:
        if not os.path.exists(OUT) or read(OUT, "rb") != data:
            print("DRIFT: firmware/main/ui.html is not what the build produces. Rebuild and commit.")
            return 1
        print("firmware/main/ui.html matches the build")
        return 0

    with open(OUT, "wb") as fh:
        fh.write(data)
    print(f"  wrote {rel(OUT)}")
    print(f"  size  {len(data):,} B   gzip -9 -n  {len(gz):,} B   sha256 {sha256(data)[:16]}...")
    print(f"  sprite: {info['icons']} icons, sha256 {info['sprite_sha256']}")
    print(f"  i18n keys used by the page: {info['keys_used']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
