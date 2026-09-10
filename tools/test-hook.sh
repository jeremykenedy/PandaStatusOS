#!/usr/bin/env bash
#
# Regression suite for .githooks/pre-commit.
#
# The hook is the only thing standing between a live Wi-Fi key and a public repo, so
# it gets a test. Every case below is a fake value. No real secret appears here.
#
# Isolation matters: the suite unstages the working set first, tests one file at a
# time, then restores. Without that, an unrelated staged file fails the hook and every
# result reads BLOCK regardless of the case under test. That exact mistake produced a
# wrong diagnosis once already.
#
# Run:  make test-hook
cd /Users/jeremykenedy/sites/PandaStatus
SAVED=$(git diff --cached --name-only)
git reset -q
pass=0; fail=0
check() {
  printf '%s\n' "$2" > docs/_t.md
  git add -f docs/_t.md 2>/dev/null
  if ./.githooks/pre-commit >/dev/null 2>&1; then got=PASS; else got=BLOCK; fi
  git reset -q >/dev/null 2>&1; rm -f docs/_t.md
  if [ "$got" = "$3" ]; then printf '  OK    %-48s %s\n' "$1" "$got"; pass=$((pass+1))
  else printf '  FAIL  %-48s got=%s want=%s\n' "$1" "$got" "$3"; fail=$((fail+1)); fi
}
echo "=== MUST BLOCK ==="
check "bare password assignment"   'wifi_password = hunter2swordfish'            BLOCK
check "json quoted password"       '"password": "sup3rs3cret99"'                 BLOCK
check "backticked key real value"  '`password` = sup3rs3cret99'                  BLOCK
check "backticked key json value"  '`password`: "sup3rs3cret99"'                 BLOCK
check "access_code assignment"     'access_code: 12345678'                       BLOCK
check "json access_code"           '"access_code": "8chr4bcd"'                   BLOCK
check "ssid assignment"            'ssid = MyHomeNetwork'                        BLOCK
check "json ssid"                  '"ssid": "MyHomeNet"'                         BLOCK
check "MAC address"                'MAC 3C:84:27:AA:BB:CC'                       BLOCK
check "wifi psk proximity"         'the wifi uses psk abcdefghijkl'              BLOCK
check "bearer token"               'Authorization: Bearer abcdefghij0123456789'  BLOCK
check "private key"                '-----BEGIN RSA PRIVATE KEY-----'             BLOCK
check "github token"               'ghp_abcdefghijklmnop0123456789'              BLOCK
check "serial assignment"          'serial: 0309CA123456789'                     BLOCK
echo
echo "=== MUST PASS, legitimate protocol docs ==="
check "field names in table row"   '| `Connect button` | `ssid`, `password` |'        PASS
check "inbound field list"         '| `wifi` | `ssid`, `password`, `scan`, `list` |'   PASS
check "redaction marker"           '"password": "<REDACTED str len=20>"'               PASS
check "placeholder token"          'connect to <DEVICE_HOST> now'                      PASS
check "empty marker"               '"ssid": "<EMPTY>"'                                 PASS
check "prose naming a field"       'The `access_code` field is 8 characters.'          PASS
check "plain prose no backtick"    'The access code field is eight characters long.'   PASS

# --- vendor residue, not secrets ---------------------------------------------
# Element IDs and CSS class names are names inside THEIR document, not names on the
# wire, so they are their expression and must never appear in the tracked tree. This
# class was missed by an earlier sweep that only looked for wire fields and function
# names, and a stale shot list carried id_btn1..id_btn6 into a commit as a result.
# The hook blocks what it can see; tools/residue-sweep.sh is the full check.
echo
echo "=== vendor residue: element IDs and class names ==="
check "vendor element ID"          'set every state with `id_btn1` on the RGB card'   BLOCK
check "vendor element ID, bare"    'the id_settings_rgb_type select offers two modes'  BLOCK
check "vendor CSS class"           'the swatch carries class c_readonly in the markup' BLOCK
check "our own wire field passes"  '| `rgb_state_index` | addresses colour per state |' PASS
# Rule 8 conformance. Our own convention is ps-<area>-<control> and ps-<block>,
# hyphenated, which cannot match the id_ or c_ patterns. These four prove the blocks
# above stay absolute WITHOUT ever needing an allowlist entry for our own markup.
check "our element ID passes"      'the slider is `ps-light-brightness` on the page'   PASS
check "our CSS class passes"       'the card wrapper carries class `ps-card-header`'   PASS
check "our data attribute passes"  'every translated node carries data-ps-str'         PASS
check "our JS global passes"       'the table is exposed as PS_STRINGS'                PASS

# --- gzip-aware scan ---------------------------------------------------------
# A credential compressed is still a credential published. The hook inflates gzip
# members and scans what is inside. Detection is by magic bytes, so a gzip under a
# name that does not say .gz is still caught: that is the case this block exists
# for, because the obvious one would be caught by the extension alone.
echo
echo "=== gzip-aware scan ==="
gzcheck() {                      # name, payload, target filename, want
  printf '%s\n' "$2" | gzip -c > "$3"
  git add -f "$3" 2>/dev/null
  if ./.githooks/pre-commit >/dev/null 2>&1; then got=PASS; else got=BLOCK; fi
  git reset -q >/dev/null 2>&1; rm -f "$3"
  if [ "$got" = "$4" ]; then printf '  OK    %-48s %s\n' "$1" "$got"; pass=$((pass+1))
  else printf '  FAIL  %-48s got=%s want=%s\n' "$1" "$got" "$4"; fail=$((fail+1)); fi
}
gzcheck "secret inside .gz"        '"password": "sup3rs3cret99"'   docs/_t.html.gz BLOCK
gzcheck "secret inside gz, no .gz name" 'ssid = MyHomeNetwork'     docs/_t.dat     BLOCK
gzcheck "MAC inside .gz"           'MAC 3C:84:27:AA:BB:CC'         docs/_t.html.gz BLOCK
gzcheck "clean page inside .gz"    'a page with no credentials'    docs/_t.html.gz PASS

# --- binary files ------------------------------------------------------------
# A PNG's bytes decoded as text can spell CJK codepoints by chance and once blocked a
# commit. Binary files skip the CJK text scan only; every other scan still sees them.
echo
echo "=== binary files ==="
bincheck() {                     # name, source file, target, want
  cp "$2" "$3"; git add -f "$3" 2>/dev/null
  if ./.githooks/pre-commit >/dev/null 2>&1; then got=PASS; else got=BLOCK; fi
  git reset -q >/dev/null 2>&1; rm -f "$3"
  if [ "$got" = "$4" ]; then printf '  OK    %-48s %s\n' "$1" "$got"; pass=$((pass+1))
  else printf '  FAIL  %-48s got=%s want=%s\n' "$1" "$got" "$4"; fail=$((fail+1)); fi
}
[ -f art/apple-touch-icon-180.png ] && bincheck "generated PNG passes" art/apple-touch-icon-180.png docs/_t.png PASS

# --- literal forbidden-strings scan -----------------------------------------
# Tested with a throwaway sentinel. The real values are never written into this
# file: that is the whole point of the mechanism being tested, and an earlier
# draft of this suite hardcoded the live host and was correctly blocked by the
# very scan it was testing.
echo
echo "=== literal forbidden-strings scan ==="
FORBIDDEN=.claude/work/secrets/forbidden-strings.txt
SENTINEL='ZZ-HOOK-TEST-SENTINEL-DO-NOT-USE'
if [ -f "$FORBIDDEN" ]; then
  cp "$FORBIDDEN" "$FORBIDDEN.testbak"
  printf '%s\n' "$SENTINEL" >> "$FORBIDDEN"
  check "sentinel from forbidden-strings" "a line containing $SENTINEL here" BLOCK
  mv -f "$FORBIDDEN.testbak" "$FORBIDDEN"
  if grep -qF "$SENTINEL" "$FORBIDDEN"; then
    echo "  FAIL  forbidden-strings.txt not restored cleanly"; fail=$((fail+1))
  else
    echo "  OK    forbidden-strings.txt restored unchanged"; pass=$((pass+1))
  fi
else
  echo "  SKIP  no forbidden-strings.txt present"
fi

echo
echo "  passed=$pass failed=$fail"
[ "$fail" -eq 0 ] && echo "  ALL GOOD" || echo "  REGRESSION"
# restore
[ -n "$SAVED" ] && echo "$SAVED" | while read -r f; do [ -e "$f" ] && git add "$f"; done
git add -u 2>/dev/null
