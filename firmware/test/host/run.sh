#!/usr/bin/env bash
# Build and run the host tests: the config module and the effect engine with plain gcc, and the state module
# with the IDF's own cJSON when an IDF checkout is present (IDF_PATH, else ~/esp/esp-idf).
# No device, no toolchain.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${TMPDIR:-/tmp}/ps_host_test"
gcc -std=c11 -Wall -Wextra -Werror -I "$HERE/stub" -I "$HERE/../../main" -o "$OUT-cfg" "$HERE/cfg_test.c"
"$OUT-cfg"
echo
gcc -std=c11 -Wall -Wextra -Werror -I "$HERE/stub" -I "$HERE/../../main" -o "$OUT-fx" "$HERE/fx_test.c" "$HERE/../../main/ps_fx.c" -lm
"$OUT-fx"
echo
gcc -std=c11 -Wall -Wextra -Werror -I "$HERE/stub" -I "$HERE/../../main" -o "$OUT-rebind" "$HERE/rebind_test.c" "$HERE/../../main/ps_rebind.c"
"$OUT-rebind"
echo
gcc -std=c11 -Wall -Wextra -Werror -I "$HERE/stub" -I "$HERE/../../main" -o "$OUT-diag" "$HERE/diag_test.c" "$HERE/../../main/ps_diag.c"
"$OUT-diag"
IDF="${IDF_PATH:-$HOME/esp/esp-idf}"
if [ -f "$IDF/components/json/cJSON/cJSON.c" ]; then
    echo
    gcc -std=c11 -Wall -Wextra -Werror -Wno-unused-parameter -I "$HERE/stub" -I "$HERE/../../main" -I "$IDF/components/json/cJSON" \
        -o "$OUT-state" "$HERE/state_test.c" "$IDF/components/json/cJSON/cJSON.c"
    "$OUT-state"
else
    echo "state_test.c skipped: no ESP-IDF checkout at $IDF (set IDF_PATH)"; exit 0
fi
