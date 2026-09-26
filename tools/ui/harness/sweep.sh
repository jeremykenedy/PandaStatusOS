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
#
# The nine page-*.js rows and the eight resilience.js rows that stood here are gone with
# their harnesses. They were written against the UI this project replaced and addressed it
# by its old conventions (data-ps-card, ps-waiting, a PS namespace, ids that no longer
# exist), so not one of them could pass and none had for some time. A row that cannot pass
# teaches nothing and hides the rows that can. What replaced them is below, and what they
# used to cover for the page as a whole is covered by contrast.js across both themes and
# both widths, plus the t-*.js rows card by card.

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

  # --- the other end of the bridge, before the device side exists to trust it: the mock vent
  # is played against by hand, frame by frame, as the firmware will have to (PANDAVENT-BRIDGE)
  "p2-idle.json      | vent.js | PS_WITH_VENT=1"

  # --- the JSON API (C2): against the factory every /api path is a 302; against the clone the
  # read-only routes answer and the gated ones answer only while their switch is on ---
  "p2-idle.json      | api.js | "
  "p2-idle.json      | api.js | PS_CLONE=1"

  # --- the bound printer moves (C7): all three conclusions, on the wire's own scan states ---
  "p2-idle.json      | rebind.js | PS_CLONE=1"

  # --- the design system: every page, both themes, both widths, the furniture ---
  "p2-idle.json      | contrast.js | "
  # and the same question asked of the pixels that were actually painted, which is the only
  # way to see a gradient, a plate, a shadow or a cover: every page, both themes, both widths,
  # each region also measured through the three dichromacies
  "p2-idle.json      | pixels.js | "

  # --- the page, card by card, against the clone's own routes ---
  "p2-idle.json      | t-ams.js      | PS_CLONE=1"
  "p2-idle.json      | t-stages.js   | PS_CLONE=1"
  "p2-idle.json      | t-preview.js  | PS_CLONE=1"
  "p2-idle.json      | t-staticip.js | PS_CLONE=1"
  "p2-idle.json      | t-configio.js | PS_CLONE=1"
  # the stage images card, both branches: a unit with nowhere to put one (the zero above,
  # inside t-stages.js) and a unit that has room
  "p2-idle.json      | t-images.js   | PS_CLONE=1 PS_IMG_SLOT_BYTES=98304"
  # the printer controls, on the one fixture whose printer is actually printing: the rows
  # exist per fan the printer named, a drag sends one command, and the speed level comes
  # from the print document rather than the printer's status
  "p2-printing.json  | t-pctl.js     | PS_CLONE=1 PS_PRINT_PERCENT=37 PS_PRINT_SPEED=2"
  # the vent card on the Bindings page, with a real vent at the other end of a real socket:
  # three processes, nothing simulated in between
  "p2-idle.json      | t-bridge.js   | PS_CLONE=1 PS_WITH_VENT=1 PS_VENTS=pandaventos@127.0.0.1:8299"
  # C8 on the page: the renderer's own numbers, and the poll that has to stop when the card
  # closes, which is invisible from the page and obvious from the mock's request log
  "p2-idle.json      | t-render.js   | PS_CLONE=1"
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
