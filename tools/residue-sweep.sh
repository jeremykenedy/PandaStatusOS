#!/usr/bin/env bash
#
# Vendor residue sweep over the whole tracked tree.
#
# The pre-commit hook blocks residue in what is being STAGED. This sweeps what is
# already COMMITTED, which is the check that catches a class the hook's pattern list
# did not know about yet. Run it after any change to docs, and before any release.
#
# Standing rule 6 draws the line at whether a name is on the WIRE or inside THEIR
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

# A rule has to be able to state what it forbids. Standing rule 3 names the attribution
# forms it bans, so that one line is exempt from the attribution check. Kept as an exact
# literal rather than a loose pattern: any real attribution still fails, including a
# reworded version of this same line.
ALLOW = [
    'No Co-Authored-By. No "Generated with". No AI attribution anywhere in the repo,',
]

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
 ("AI attribution",
  r'\b(anthropic|co-authored|copilot|codex)\b|Generated with|Co-Authored-By'),
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
# two modes. So the trigger is three or more of the list appearing together, on one line
# or inside one markdown table, which is what a lifted effect table looks like and what
# our own single-effect prose never does.
EFFECT_SET = r'\b(static|breathing|strobing|wave|marquee|color_cycle|rainbow)\b'
EFFECT_MIN = 3

def effect_set_rows(files):
    rows = []
    for f in files:
        try:
            lines = open(f, encoding='utf-8', errors='replace').read().split('\n')
        except OSError:
            continue
        # per line
        for i, line in enumerate(lines, 1):
            if len(set(m.lower() for m in re.findall(EFFECT_SET, line))) >= EFFECT_MIN:
                rows.append((f, i, line.strip()[:88]))
        # per contiguous markdown table block
        start, seen = None, set()
        for i, line in enumerate(lines + [''], 1):
            if line.lstrip().startswith('|'):
                if start is None:
                    start, seen = i, set()
                seen.update(m.lower() for m in re.findall(EFFECT_SET, line))
            else:
                if start is not None and len(seen) >= EFFECT_MIN:
                    rows.append((f, start, f'markdown table carries {len(seen)} of the '
                                          f'V1/V2 effect list: {", ".join(sorted(seen))}'))
                start, seen = None, set()
    return rows

scanned = [f for f in files if f not in SKIP]
print(f"residue sweep: {len(scanned)} tracked files "
      f"({len(files) - len(scanned)} pattern-definition files excluded)\n")
print(f"{'CATEGORY':30s} {'HITS':>5s}")
print("-" * 78)

grand = 0
for name, pat in CHECKS:
    rows = []
    for f in scanned:
        try:
            t = open(f, encoding='utf-8', errors='replace').read()
        except OSError:
            continue
        for i, line in enumerate(t.split('\n'), 1):
            if not re.search(pat, line):
                continue
            if any(a in line for a in ALLOW):
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

print("-" * 78)
print(f"{'TOTAL':30s} {grand:5d}")
print("\nCLEAN" if grand == 0 else "\nRESIDUE PRESENT")
sys.exit(0 if grand == 0 else 1)
PY
