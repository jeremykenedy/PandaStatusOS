#!/usr/bin/env bash
# Build and run the host tests for the config module. Plain gcc, no ESP-IDF, no device.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/ps_cfg_test"
gcc -std=c11 -Wall -Wextra -Werror -I "$HERE/stub" -I "$HERE/../../main" -o "$OUT" "$HERE/cfg_test.c"
"$OUT"
