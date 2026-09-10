#!/usr/bin/env python3
"""
The i18n mechanism. Standard library only. One module, four subcommands, one language list.

    python3 tools/ui/build/i18n.py check      every text-bearing element is keyed; exit 1 if not
    python3 tools/ui/build/i18n.py mint PAGE  add keys to untagged elements in one page (authoring aid)
    python3 tools/ui/build/i18n.py collect    derive tools/ui/i18n/en.json from the markup + js_strings.json
    python3 tools/ui/build/i18n.py strings    validate every other language against English, emit ps_strings.js

Standing rule 7. Every key is minted by this project from this project's own pages. Every
English value is written for this project: it lives in the markup, and en.json is DERIVED
from the markup every build, never accumulated (accumulating once shrank a table and left
75 strings printing their own key). The other languages are translated from en.json and
validated against it: a missing key, an extra key, or a placeholder mismatch fails the
build, so a half-translated table cannot ship.

Keys are explicit in the markup, not minted from the English text. ps_<page>_<what>. That
way an English edit does not rename the key and orphan 23 translations, and a translator
keys on something stable. `mint` exists to add a first key to an element you forgot; it
never reuses, never fuzzy-matches (a 0.72 similarity tier once put a door-state key on an
unrelated "Open" button; a wrong translation is worse than a missing one).

Attributes the mechanism knows: data-ps-str (textContent), data-ps-str-title (title),
data-ps-str-placeholder (placeholder), data-ps-str-aria (aria-label). The runtime accessor
is one function in 00-core.js; nothing else in the page touches the table.

Language list: English plus every <lang>.json present in tools/ui/i18n/. One source. RTL
languages are listed once here and once nowhere else.
"""

import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
SRC = os.path.join(ROOT, "tools", "ui", "src")
I18N = os.path.join(ROOT, "tools", "ui", "i18n")
PAGES_DIR = os.path.join(SRC, "pages")

KEY = re.compile(r"^ps_[a-z0-9]+(?:_[a-z0-9]+)*$")
RTL = ["ar", "he", "fa", "ur"]

# Elements whose whole text content is a translatable string.
TEXT_TAGS = "span|div|h1|h2|h3|h4|h5|h6|button|label|option|a|p|li|td|th|summary|legend|small|strong|em|figcaption"
ELEM = re.compile(r"<(" + TEXT_TAGS + r")\b([^>]*)>([^<]+)</\1>", re.S)
# Text that is data, not language: numbers, hex colours, units, placeholders, tokens.
DATA = re.compile(r"^\s*(?:[-+]?\d[\d.,:%°]*\s*(?:ms|s|min|h|%|°C|B|KB|MB|px|V|mA)?|#?[0-9A-Fa-f]{6,8}|<[A-Z_]+>|[\W_]+|\{\{.*\}\})\s*$")
ATTR = re.compile(r'\b(title|placeholder|aria-label)="([^"]*)"')


def sources():
    for f in sorted(os.listdir(PAGES_DIR)):
        if f.endswith(".html"):
            yield f[:-5], os.path.join(PAGES_DIR, f)
    for f in ("global.html", "frame.html"):
        yield f[:-5], os.path.join(SRC, f)


def strip_comments(s):
    return re.sub(r"<!--.*?-->", lambda m: " " * len(m.group(0)), s, flags=re.S)


def line_of(text, pos):
    return text.count("\n", 0, pos) + 1


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")
    return s[:32].rstrip("_") or "text"


# ---------------------------------------------------------------------------------------

def cmd_check():
    problems = []
    for page, path in sources():
        raw = open(path, encoding="utf-8").read()
        text = strip_comments(raw)
        for m in ELEM.finditer(text):
            tag, attrs, inner = m.group(1), m.group(2), m.group(3)
            if not inner.strip() or DATA.match(inner) or len(inner.strip()) < 2:
                continue
            if "data-ps-str=" in attrs or "data-ps-no-i18n" in attrs:
                k = re.search(r'data-ps-str="([^"]*)"', attrs)
                if k and not KEY.match(k.group(1)):
                    problems.append(f"{page}.html:{line_of(text, m.start())}: key {k.group(1)!r} is not ps_<page>_<what>")
                continue
            problems.append(f"{page}.html:{line_of(text, m.start())}: untranslated text in <{tag}>: {inner.strip()[:50]!r}")
        for m in ATTR.finditer(text):
            name, val = m.group(1), m.group(2)
            if not val.strip() or DATA.match(val):
                continue
            # the element's tag must carry the matching data-ps-str-<kind>
            start = text.rfind("<", 0, m.start())
            end = text.find(">", m.end())
            tag_text = text[start:end]
            kind = {"title": "title", "placeholder": "placeholder", "aria-label": "aria"}[name]
            if f"data-ps-str-{kind}=" not in tag_text and "data-ps-no-i18n" not in tag_text:
                problems.append(f"{page}.html:{line_of(text, m.start())}: untranslated {name}=: {val[:40]!r}")
    for k in re.findall(r'data-ps-str(?:-title|-placeholder|-aria)?="([^"]+)"', "".join(open(p, encoding="utf-8").read() for _, p in sources())):
        if not KEY.match(k):
            problems.append(f"key {k!r} is not ps_<page>_<what>")
    if problems:
        print("i18n check: untranslated or badly keyed text:")
        for p in problems:
            print("  " + p)
        return 1
    print("i18n check: every text-bearing element is keyed")
    return 0


def cmd_mint(page):
    path = os.path.join(PAGES_DIR, f"{page}.html") if page not in ("global", "frame") else os.path.join(SRC, f"{page}.html")
    raw = open(path, encoding="utf-8").read()
    seen = set(re.findall(r'data-ps-str="([^"]+)"', raw))
    n = 0

    def repl(m):
        nonlocal n
        tag, attrs, inner = m.group(1), m.group(2), m.group(3)
        if not inner.strip() or DATA.match(inner) or len(inner.strip()) < 2 or "data-ps-str=" in attrs or "data-ps-no-i18n" in attrs:
            return m.group(0)
        base = f"ps_{page}_{slug(inner)}"; key = base; i = 2
        while key in seen:
            key = f"{base}_{i}"; i += 1
        seen.add(key); n += 1
        return f'<{tag}{attrs} data-ps-str="{key}">{inner}</{tag}>'

    out = ELEM.sub(repl, raw)
    if n:
        open(path, "w", encoding="utf-8").write(out)
    print(f"mint: {n} key(s) added to {page}.html")
    return 0


def cmd_collect():
    en = {}
    dup = []
    for page, path in sources():
        text = strip_comments(open(path, encoding="utf-8").read())
        for m in ELEM.finditer(text):
            k = re.search(r'data-ps-str="([^"]+)"', m.group(2))
            if k:
                val = re.sub(r"\s+", " ", m.group(3)).strip()
                if k.group(1) in en and en[k.group(1)] != val:
                    dup.append((k.group(1), en[k.group(1)], val))
                en[k.group(1)] = val
        for m in re.finditer(r'<[^>]*\bdata-ps-str-(title|placeholder|aria)="([^"]+)"[^>]*>', text):
            kind, key = m.group(1), m.group(2)
            attr = {"title": "title", "placeholder": "placeholder", "aria": "aria-label"}[kind]
            v = re.search(r'\b' + attr + r'="([^"]*)"', m.group(0))
            if v:
                en[key] = v.group(1)
    js_path = os.path.join(I18N, "js_strings.json")
    if os.path.isfile(js_path):
        for k, v in json.load(open(js_path, encoding="utf-8")).items():
            if not KEY.match(k):
                print(f"collect: js_strings.json key {k!r} is not ps_<page>_<what>"); return 1
            en[k] = v
    if dup:
        print("collect: one key, two English texts:")
        for k, a, b in dup:
            print(f"  {k}: {a!r} vs {b!r}")
        return 1
    prev_path = os.path.join(I18N, "en.json")
    prev = json.load(open(prev_path, encoding="utf-8")) if os.path.isfile(prev_path) else {}
    new = sorted(set(en) - set(prev)); gone = sorted(set(prev) - set(en))
    os.makedirs(I18N, exist_ok=True)
    with open(prev_path, "w", encoding="utf-8") as fh:
        json.dump(dict(sorted(en.items())), fh, indent=2, ensure_ascii=False); fh.write("\n")
    msg = f"collect: {len(en)} English strings"
    if new: msg += f", {len(new)} new"
    if gone: msg += f", {len(gone)} gone ({', '.join(gone[:5])}{'...' if len(gone) > 5 else ''})"
    print(msg)
    return 0


PLACEHOLDER = re.compile(r"\{[a-z_]+\}|%[sd]")


def cmd_strings():
    en = json.load(open(os.path.join(I18N, "en.json"), encoding="utf-8"))
    langs = ["en"] + sorted(f[:-5] for f in os.listdir(I18N) if f.endswith(".json") and f not in ("en.json", "js_strings.json"))
    table = {"en": en}
    problems = []
    for lang in langs[1:]:
        t = json.load(open(os.path.join(I18N, f"{lang}.json"), encoding="utf-8"))
        missing = sorted(k for k in en if not str(t.get(k, "")).strip())
        extra = sorted(k for k in t if k not in en)
        if missing: problems.append(f"{lang}: {len(missing)} missing ({', '.join(missing[:4])}...)")
        if extra: problems.append(f"{lang}: {len(extra)} extra ({', '.join(extra[:4])}...)")
        for k in en:
            if k in t and set(PLACEHOLDER.findall(en[k])) != set(PLACEHOLDER.findall(str(t[k]))):
                problems.append(f"{lang}: placeholder mismatch in {k}")
        table[lang] = {k: t[k] for k in en if k in t}
    if problems:
        print("strings: the table cannot ship:")
        for p in problems: print("  " + p)
        return 1
    js = ("// generated by tools/ui/build/i18n.py; do not edit\n"
          f"var PS_STRING_LANGS = {json.dumps(langs)};\n"
          f"var PS_RTL_LANGS = {json.dumps([l for l in RTL if l in langs])};\n"
          f"var PS_STRINGS = {json.dumps(table, ensure_ascii=False, separators=(',', ':'), sort_keys=True)};\n")
    with open(os.path.join(I18N, "ps_strings.js"), "w", encoding="utf-8") as fh:
        fh.write(js)
    print(f"strings: {len(en)} keys x {len(langs)} language(s), {len(js.encode()):,} B")
    return 0


def main():
    if len(sys.argv) < 2:
        print(__doc__); return 2
    cmd = sys.argv[1]
    if cmd == "check": return cmd_check()
    if cmd == "mint": return cmd_mint(sys.argv[2])
    if cmd == "collect": return cmd_collect()
    if cmd == "strings": return cmd_strings()
    print(__doc__); return 2


if __name__ == "__main__":
    sys.exit(main())
