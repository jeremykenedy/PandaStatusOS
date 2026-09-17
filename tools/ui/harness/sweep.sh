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
  "p2-idle.json      | page-dashboard.js | "
  "factory-defaults.json | page-dashboard.js | "
  "p2-idle.json      | page-lighting.js | "
  "p2-idle.json      | page-lighting.js | PS_EMIT_SPEED=1"
  "p2-idle.json      | page-images.js | "
  "p2-idle.json      | page-images.js | PS_OTA_REFUSE=1"
  "p2-idle.json      | page-images.js | PS_IMG_VERSION=1"
  "p2-idle.json      | page-images.js | PS_THEME_ON_CONNECT=1"
  "p2-idle.json      | page-printer.js | "
  "p2-idle.json      | page-printer.js | PS_PRINTER_FAIL=6"
  "p2-idle.json      | page-network.js | "
  "p2-idle.json      | page-network.js | PS_WIFI_FAIL=1"
  "p2-idle.json      | page-system.js | "
  "p2-idle.json      | page-system.js | PS_IMG_VERSION=1"
  "p2-idle.json      | page-system.js | PS_OTA_REFUSE=1"
  "p2-idle.json      | page-logs.js | "
  "factory-defaults.json | page-setup.js | "
  "p2-idle.json      | page-setup.js | "
  # --- features (D-033): against the factory (no route, 302) nothing appears and nothing is
  #     sent; against the clone (PS_CLONE=1) the switches and their settings, exact bodies ---
  # --- the JSON API (C2): against the factory every /api path is a 302; against the clone the
  # read-only routes answer and the gated ones answer only while their switch is on ---
  "p2-idle.json      | api.js | "
  "p2-idle.json      | api.js | PS_CLONE=1"
  # --- the bound printer moves (C7): all three conclusions, on the wire's own scan states ---
  "p2-idle.json      | rebind.js | PS_CLONE=1"
  "p2-idle.json      | page-features.js | "
  "p2-idle.json      | page-features.js | PS_CLONE=1"
  # --- the push policy is INFERENCE (D-014). The pages must hold under either reading:
  #     only the changed root comes back, or every client hears every change. ---
  "p2-idle.json      | page-lighting.js | PS_PUSH_CHANGED_ONLY=1"
  "p2-idle.json      | page-network.js | PS_PUSH_CHANGED_ONLY=1"
  "p2-idle.json      | page-printer.js | PS_BROADCAST=1"
  # --- the design system: every page, both themes, both widths, the furniture ---
  "p2-idle.json      | contrast.js | "
  # --- what the page survives. One lie per row, named in the row. ---
  "p2-idle.json      | resilience.js | "
  "p2-idle.json      | resilience.js | PS_DROP_AFTER=1500"
  "p2-idle.json      | resilience.js | PS_MALFORMED=1"
  "p2-idle.json      | resilience.js | PS_UNKNOWN_ENUM=1"
  "p2-idle.json      | resilience.js | PS_DELAY=2500"
  "p2-idle.json      | resilience.js | PS_NO_PUSH=1"
  "p2-idle.json      | resilience.js | PS_PRINTER_OFFLINE_AFTER=1000"
  "p2-idle.json      | resilience.js | PS_SLOW=800"
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
