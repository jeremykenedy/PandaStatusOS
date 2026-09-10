#!/usr/bin/env bash
#
# One config read, to a pre-named file in the canonical location.
#
# A read opens a SECOND short-lived client. It does not touch the browser's socket,
# does not raise the reload dialog, and does not cost a socket cycle. Measured.
#
# Usage:   ./tools/read-config.sh <name>
#          ./tools/read-config.sh --list
#
# The name must be one of the fixed set below. A typo fails loudly rather than
# writing a session artifact to a path nobody looks in afterwards.

set -uo pipefail

OUTDIR="/Users/jeremykenedy/backups/PandaStatus/ws-capture"
HOST_FILE="$(dirname "$0")/../.claude/work/secrets/device-host.txt"
LOGGER="$(dirname "$0")/ws_logger.py"

NAMES=(
  read-1-session-start
  read-2-after-write-test
  read-3-after-brightness
  read-4-after-speed
  read-5-after-block
  read-6-after-theme
  read-7-after-print
  ladder-A-baseline
  ladder-B-after-rgb_reset
  ladder-C-after-reset
  ladder-D-after-factory_reset
  ladder-D-after-reonboard
  dryrun-delete-me
)

if [ "${1:-}" = "--list" ] || [ $# -eq 0 ]; then
    printf 'Valid read names:\n'
    for n in "${NAMES[@]}"; do printf '  %s\n' "$n"; done
    printf '\nOutput goes to %s/<name>.jsonl\n' "$OUTDIR"
    [ $# -eq 0 ] && exit 1 || exit 0
fi

NAME="$1"
ok=0
for n in "${NAMES[@]}"; do [ "$n" = "$NAME" ] && ok=1; done
if [ "$ok" -ne 1 ]; then
    printf 'ERROR: "%s" is not a known read name.\n\n' "$NAME" >&2
    "$0" --list >&2
    exit 1
fi

# Device host lives in the working area, never in the repo.
if [ ! -f "$HOST_FILE" ]; then
    printf 'ERROR: %s not found.\n' "$HOST_FILE" >&2
    printf 'Create it containing just the device host, one line, no scheme.\n' >&2
    exit 1
fi
HOST="$(tr -d '[:space:]' < "$HOST_FILE")"
[ -n "$HOST" ] || { echo "ERROR: device host file is empty" >&2; exit 1; }

mkdir -p "$OUTDIR"
OUT="$OUTDIR/$NAME.jsonl"

if [ -e "$OUT" ]; then
    printf 'REFUSING: %s already exists.\n' "$OUT" >&2
    printf 'Reads are one-shot. Move or rename the existing file first.\n' >&2
    exit 1
fi

printf '  read : %s\n' "$NAME"
printf '  mark : __wsCap.mark(%s) in the browser NOW\n' "'$NAME'"
printf '  out  : %s\n\n' "$OUT"

timeout 12 python3 "$LOGGER" "ws://$HOST/ws" -o "$OUT" 2>&1 | sed 's/^/  /'

if [ ! -s "$OUT" ]; then
    printf '\n  EMPTY. The read captured nothing. Do not proceed.\n' >&2
    exit 1
fi

python3 - "$OUT" <<'PY'
import json, sys
p = sys.argv[1]
n = 0; roots = None
for line in open(p):
    r = json.loads(line); n += 1
    if r.get("kind") == "text":
        try: roots = sorted(json.loads(r["data"]).keys())
        except Exception: pass
print(f"\n  records    {n}")
print(f"  roots      {roots}")
if roots and len(roots) >= 6:
    print("  RESULT     full config captured")
else:
    print("  RESULT     INCOMPLETE, expected 6 roots. Do not proceed on this read.")
PY

printf '\n  This file holds live credentials in plaintext. It stays outside the repo.\n'
printf '  Redact a working copy with:\n'
printf '    python3 tools/redact_ws.py %s \\\n      -o .claude/work/analysis/%s.redacted.jsonl\n' "$OUT" "$NAME"
