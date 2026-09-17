#!/usr/bin/env bash
#
# Vendor residue sweep over the whole tracked tree.
#
# The pre-commit hook blocks residue in what is being STAGED. This sweeps what is
# already COMMITTED, which is the check that catches a class the hook's pattern list
# did not know about yet. Run it after any change to docs, and before any release.
#
# The clean-room rule (CONTRIBUTING.md) draws the line at whether a name is on the WIRE or inside THEIR
# DOCUMENT:
#
#   Interface fact, keep    anything a clone must transmit or receive. Wire field
#                           names, message roots, enum values, endpoint paths, header
#                           names, stage slot names, published file hashes and sizes.
#
#   Their expression, go    anything that is a name inside their document rather than
#                           a name on the wire. Element IDs, CSS class names, function
#                           names, variable names, their comments, their UI copy, and
#                           values lifted out of their markup as a table of their
#                           design choices.
#
# Element IDs were the class that slipped through: an earlier sweep tested wire fields
# and function names only, and a stale shot list carried six id_-prefixed element IDs
# plus a column of their swatch values into a commit. Hence this file.
#
# Run:  make residue   (or: bash tools/residue-sweep.sh)
# Exit: 0 if clean, 1 if anything matched.

cd "$(git rev-parse --show-toplevel)" || exit 2

python3 - "$@" <<'PY'
import subprocess, re, sys

files = subprocess.run(['git','ls-files'], capture_output=True, text=True).stdout.split()

# These files DEFINE the patterns, so they contain them by necessity.
SKIP = {'.githooks/pre-commit', 'tools/test-hook.sh', 'tools/residue-sweep.sh'}

# No line anywhere is exempt from any check.
ALLOW = []

# One category has to be able to name what it bans, and the two documents that state the
# standing rules do exactly that: "No Co-Authored-By. No Generated with." is the rule, not a
# breach of it. Those two files are exempt from THAT ONE category and from nothing else, the
# same reason this file and the hook exempt themselves. Any other file carrying a trailer is
# still a hit, including a commit template, a workflow or a README.
PER_CATEGORY_SKIP = {'attribution trailers': {'AGENTS.md', 'CLAUDE.md'}}

CHECKS = [
 ("their element IDs",          r'\bid_[a-z][a-zA-Z0-9_]*\b'),
 ("their CSS class names",      r'\bc_[a-z][a-zA-Z0-9_]*\b'),
 ("their function/var names",
  r'\b(ws_send_data|ws_send_json|ws_on_close|ws_on_open|ws_on_message|show_ws_not_open'
  r'|html_require_refresh|dialog_create|resetSettings|updateUIAfterReset|rgb_color_list'
  r'|rgb_brightness_list|rgb_speed_list|colorButton_id|g_websocket|g_rgb_type_str'
  r'|g_gif_name|g_lang_resources|ota_btn_click|ota_file_selected|speedSlider'
  r'|device_req_restart|show_pop_factory|createRandomColor|createwhiteColorBlocks'
  r'|hello_frame|rgba_colors|load_img|language_navigate|card_navigate|page_navigate'
  r'|ws_init|btn_wifi_connect_click|btn_printer_bind_click|rgb_type_select_change'
  r'|hsl_picker_confirm|page_navigate_color_confirm|language_set_by_id|brightness_change'
  r'|speedslider_change|checkbox_rgb_clicked|checkbox_follow_clicked'
  r'|printing_ui_type_select_change)\b'),
 ("wrong-device wire fields",   r'\bh2d_mode\b'),
 ("values lifted from markup",  r'\bf8a323\b|\b00ff2a\b'),
 ("their code shapes",          r'location\.href\s*=\s*location\.href|\bconst states\s*=|```js\b'),
 ("CJK source text",            r'[一-龥ぁ-ヿ가-힣]'),
 ("their UI copy",
  r'reset all settings to default|erase all data on the|unless instructed by a technician'
  r'|Factory reset ok|should not exceed|have not list|Connection opened'),
 ("their i18n key/value pairs",
  r'\b(note_factory|confirm_reset_message|ap_off_confirm|ap_change_confirm|note_unbind_info'
  r'|factory_reset_ok|note_title|ws_not_open|note_ok|reset_settings|rgb_mode[0-2]'
  r'|rgb_btn[1-6]|rgb_info_mode[0-6]|rgb_warn1|lang_next|card_printer|card_settings'
  r'|reset_default|response_err)\b|Advance Mode|Warning Hot Mode'),
 ("their misspellings",         r'\b(overide|siwtch|foloow)\b'),
 ("verbatim attestation",       r'verbatim from|are verbatim'),
 ("V1/V2 model claims",         r'seven effects available|19 shots|six printer states, indexed'),
 # color_cycle, with the underscore, is THEIR spelling of it. The concept is universal;
 # that exact token is how their markup writes it, so it stays a standalone trigger.
 ("their color_cycle spelling",  r'\bcolor_cycle\b'),
 # The esptool subcommand that erases the whole chip. Nothing in this repository runs it, ever:
 # on the Panda Vent the factory firmware was lost to one write that touched the bootloader and
 # partition table, and the P2 has no published image at all (firmware/SAFETY.md). The token is
 # forbidden outright, in scripts, docs and Makefile alike, so it cannot be reached by habit.
 ("whole-chip erase command",   r'\berase[_-]flash\b'),
 # Commits and files carry one author and no tool trailer of any kind. A generated file's
 # own "Generated by tools/..." provenance note is not a trailer and is not matched.
 ("attribution trailers",
  r'\bco-authored\b|Generated with|Co-Authored-By'),
]

# ---------------------------------------------------------------------------
# The V1/V2 effect LIST, matched as a set rather than word by word.
#
# WHY THIS IS NOT A WORDLIST, AND MUST NOT BECOME ONE AGAIN:
# breathing, rainbow, marquee, strobing, static and wave are the standard vocabulary of
# every addressable-LED project there is. WLED, FastLED and Adafruit all ship a breathing
# effect and a rainbow effect. Those words are not BIQU's expression and they are not
# ownable. An earlier revision of this sweep blocked them individually, which would have
# failed the moment this project wrote its own breathing effect -- and the obvious move
# then is to weaken the check. A check that has to be weakened to do normal work stops
# being read, which is exactly how the element IDs got through in the first place.
#
# What is actually residue is the V1/V2 DOCTRINE: the claim that this device has seven
# named effects, or that specific ordered list presented as its effect set. The P2 has
# two modes. This project now has its own effect engine (ps_fx.c, Jeremy's, from the
# vent) with seventeen and more effects that share six of those generic words, so "three
# of the words together" can no longer tell theirs from ours and was made precise (D-034):
# the vendor's fingerprint is its SEVEN in ITS ORDER, or its spelling `color_cycle` beside
# any other name of the list. This project writes "hue cycle", never the vendor's token,
# and lists its effects in its own order.
EFFECT_SET = r'\b(static|breathing|strobing|wave|marquee|color_cycle|rainbow)\b'
EFFECT_ORDER = r'\bstatic\b.{0,40}\bbreathing\b.{0,40}\bstrobing\b.{0,40}\bwave\b.{0,40}\bmarquee\b.{0,40}\bcolor_cycle\b.{0,40}\brainbow\b'
def effect_hit(names, text):
    return ('color_cycle' in names and len(names) >= 2) or re.search(EFFECT_ORDER, text) is not None

def effect_set_rows(files):
    rows = []
    for f in files:
        try:
            lines = open(f, encoding='utf-8', errors='replace').read().split('\n')
        except OSError:
            continue
        # per line
        for i, line in enumerate(lines, 1):
            if effect_hit(set(m.lower() for m in re.findall(EFFECT_SET, line)), line):
                rows.append((f, i, line.strip()[:88]))
        # per contiguous markdown table block
        start, seen, block = None, set(), []
        for i, line in enumerate(lines + [''], 1):
            if line.lstrip().startswith('|'):
                if start is None:
                    start, seen, block = i, set(), []
                seen.update(m.lower() for m in re.findall(EFFECT_SET, line)); block.append(line)
            else:
                if start is not None and effect_hit(seen, ' '.join(block)):
                    rows.append((f, start, f'markdown table carries the V1/V2 effect list: {", ".join(sorted(seen))}'))
                start, seen, block = None, set(), []
    return rows

scanned = [f for f in files if f not in SKIP]
print(f"residue sweep: {len(scanned)} tracked files "
      f"({len(files) - len(scanned)} pattern-definition files excluded)\n")
print(f"{'CATEGORY':30s} {'HITS':>5s}")
print("-" * 78)

# A binary file decoded as text produces byte runs that can spell anything by chance: a
# PNG once tripped the CJK check, and a screenshot's compressed pixels once spelled a c_
# token (D-032). An identifier or a credential hidden in a binary is still an identifier
# or a credential, and it lives in a printable string; three bytes of image data do not.
# So a binary is scanned as the printable runs `strings -n 8` would show, and the CJK
# check, which is about text, skips it entirely. Nothing is exempted: a real token in a
# real string inside a binary still fails.
def is_binary(path):
    try:
        return b'\x00' in open(path, 'rb').read(8192)
    except OSError:
        return False

def text_of(path):
    if is_binary(path):
        runs = re.findall(rb'[\x20-\x7e]{8,}', open(path, 'rb').read())
        return "\n".join(r.decode('ascii') for r in runs)
    return open(path, encoding='utf-8', errors='replace').read()

# Our own translations live in tools/ui/i18n/<lang>.json and, once built, on the one line
# of the page that is the generated string table. CJK there is our work; the check for
# THEIR strings is the "their i18n key/value pairs" category, which reads those files
# whole. CJK anywhere else is still source text and still a hit.
def is_translation(path, line):
    return (path.startswith("tools/ui/i18n/") or line.startswith("var PS_STRINGS = ")
            or re.search(r"`(zh-Hans|zh-Hant|ja|ko)`", line) is not None)   # a language named in its own script

grand = 0
for name, pat in CHECKS:
    rows = []
    for f in scanned:
        if name == "CJK source text" and is_binary(f):
            continue
        try:
            t = text_of(f)
        except OSError:
            continue
        for i, line in enumerate(t.split('\n'), 1):
            if not re.search(pat, line):
                continue
            if any(a in line for a in ALLOW):
                continue
            if f in PER_CATEGORY_SKIP.get(name, ()):
                continue
            if name == "CJK source text" and is_translation(f, line):
                continue
            rows.append((f, i, line.strip()[:88]))
    grand += len(rows)
    print(f"{name:30s} {len(rows):5d}  {'' if rows else 'ZERO'}")
    for f, i, line in rows:
        print(f"{'':36s}{f}:{i}: {line}")

rows = effect_set_rows(scanned)
grand += len(rows)
print(f"{'V1/V2 effect list as a set':30s} {len(rows):5d}  {'' if rows else 'ZERO'}")
for f, i, line in rows:
    print(f"{'':36s}{f}:{i}: {line}")

# SVG export furniture. A HYGIENE check, not a provenance one: the project's own icons are
# Illustrator exports normalised by tools/ui/normalize_icons.py, which strips the export's
# id="Layer_1", enable-background and the .stN class block. Their appearance in a tracked
# SVG means unprocessed artwork was committed, and nothing else; it is not evidence about
# who drew it or where it came from, and nobody should later read it as such.
SVG_FURNITURE = r'id="Layer_1"|enable-background|\.st\d+\s*\{'
rows = []
for f in scanned:
    if not f.endswith('.svg'):
        continue
    try:
        t = open(f, encoding='utf-8', errors='replace').read()
    except OSError:
        continue
    for i, line in enumerate(t.split('\n'), 1):
        if re.search(SVG_FURNITURE, line):
            rows.append((f, i, line.strip()[:88]))
grand += len(rows)
print(f"{'SVG export furniture (hygiene)':30s} {len(rows):5d}  {'' if rows else 'ZERO'}")
for f, i, line in rows:
    print(f"{'':36s}{f}:{i}: {line}")

print("-" * 78)
print(f"{'TOTAL':30s} {grand:5d}")
print("\nCLEAN" if grand == 0 else "\nRESIDUE PRESENT")
sys.exit(0 if grand == 0 else 1)
PY
