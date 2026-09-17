#!/usr/bin/env bash
#
# Copy the chosen README screenshots out of private/uiwork/shots/ into docs/screenshots/.
# The harnesses write every page at both themes and both widths on every run; this is the
# set the README shows, and the only place that choice is written down. Run after the
# sweep, then commit docs/screenshots/.
#
#     tools/ui/harness/readme-shots.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
SRC="$ROOT/private/uiwork/shots"; DST="$ROOT/docs/screenshots"
mkdir -p "$DST"
copy() { [ -f "$SRC/$1" ] || { echo "missing $SRC/$1 (run the sweep first)" >&2; exit 1; }; cp "$SRC/$1" "$DST/$2"; echo "  $2"; }
copy dashboard-p2-idle-light-1280.png   dashboard-light.png
copy dashboard-p2-idle-dark-1280.png    dashboard-dark.png
copy lighting-light-1280.png            lighting-light.png
copy lighting-dark-390.png              lighting-dark-phone.png
copy images-dark-1280.png               images-dark.png
copy printer-light-1280.png             printer-light.png
copy network-dark-1280.png              network-dark.png
copy system-light-1280.png              system-light.png
copy logs-dark-1280-after-drive.png     logs-dark.png
copy setup-factory-light-390.png        setup-light-phone.png
echo "docs/screenshots/ updated"
