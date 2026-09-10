#!/usr/bin/env bash
#
# Run every harness against every fixture and environment it is meant to face.
#
#     tools/ui/harness/sweep.sh            run the whole table
#     tools/ui/harness/sweep.sh wire       run only rows whose harness name contains "wire"
#
# The table below is the ONLY place a harness/fixture/env pairing lives. On the sibling
# project a slow-device test was passed by hand once with an env var typed into a shell,
# then forgotten, and it quietly passed forever against a device that answered instantly.
# The env column is here so that cannot happen: if a harness needs a lie, the lie is in
# the row.
#
# Verdict is the harness exit code, per row. Output text is displayed, never parsed.
# Rows run strictly one at a time: they share a port and the mock mutates state.
#
# Row format:   fixture | harness | env (space-separated KEY=VALUE, or empty)

set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FILTER="${1:-}"

ROWS=(
  # --- the mock itself, before anything trusts it ---
  "p2-idle.json      | wire.js | "
  "p2-printing.json  | wire.js | "
  # The mock under PS_NO_WS cannot be exercised by wire.js (it needs the socket); that
  # mode is covered by nows.js, which asserts the upgrade is refused.
  "p2-idle.json      | nows.js | PS_NO_WS=1"
  # --- pages, in the browser. One row per lie the page must survive. ---
  "p2-idle.json      | page-lighting.js | "
  "p2-idle.json      | page-lighting.js | PS_EMIT_SPEED=1"
)

pass=0; fail=0; failed=()
for row in "${ROWS[@]}"; do
    IFS='|' read -r fixture harness env <<< "$row"
    fixture="$(echo "$fixture" | xargs)"; harness="$(echo "$harness" | xargs)"; env="$(echo "$env" | xargs)"
    [ -n "$FILTER" ] && [[ "$harness" != *"$FILTER"* ]] && continue
    # shellcheck disable=SC2086
    if "$HERE/run.sh" "$fixture" "$harness" $env; then
        pass=$((pass+1))
    else
        fail=$((fail+1)); failed+=("$harness against $fixture ${env:+[$env]}")
    fi
    echo
done

echo "sweep: $pass passed, $fail failed"
for f in "${failed[@]:-}"; do [ -n "$f" ] && echo "  FAILED: $f"; done
[ "$fail" -eq 0 ]
