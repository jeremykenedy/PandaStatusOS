#!/usr/bin/env bash
#
# Run ONE harness against ONE fresh mock. Usage:
#
#     tools/ui/harness/run.sh <fixture> <harness> [KEY=VALUE ...]
#
#     tools/ui/harness/run.sh p2-idle.json wire.js
#     tools/ui/harness/run.sh p2-idle.json wire.js PS_DELAY=800
#
# What it does, and why each step is here:
#   - starts the mock on its own port with the given fixture and env, in the background,
#     and records the PID. It is killed by PID at the end, never by name match: a name
#     match once killed an unrelated process on the sibling project
#   - waits for the mock to answer, polling its debug endpoint, instead of sleeping a
#     fixed time
#   - runs the harness and RETURNS ITS EXIT CODE. That code is the verdict. Nothing here
#     parses harness output for pass/fail text
#   - never runs two harnesses at once: they share a port and the mock mutates state
#
# No absolute paths. Everything is resolved from this script's own location, so it works
# from any checkout on any machine. Dependencies come from private/uiwork/node_modules
# via NODE_PATH (gitignored; see docs/DECISIONS.md D-013). The browser for Playwright
# harnesses comes from PS_CHROME if set, else Playwright's own install.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
MOCK="$ROOT/tools/ui/mock/mockdev.js"
DEPS="$ROOT/private/uiwork/node_modules"
LOGDIR="$ROOT/private/uiwork/logs"

FIXTURE="${1:-}"; HARNESS="${2:-}"; shift 2 2>/dev/null || true
if [ -z "$FIXTURE" ] || [ -z "$HARNESS" ]; then
    echo "usage: $0 <fixture.json> <harness.js> [KEY=VALUE ...]" >&2; exit 2
fi
[ -f "$HERE/$HARNESS" ] || { echo "no such harness: $HERE/$HARNESS" >&2; exit 2; }
[ -d "$DEPS" ] || { echo "no $DEPS. Run: (cd $ROOT/private/uiwork && npm install)" >&2; exit 2; }

# per-run env, KEY=VALUE args become exported variables
for kv in "$@"; do export "$kv"; done
export NODE_PATH="$DEPS${NODE_PATH:+:$NODE_PATH}"
export PS_PORT="${PS_PORT:-8199}"
export PS_STATE="$FIXTURE"
export PS_QUIET=1
mkdir -p "$LOGDIR"
export PS_LOG="$LOGDIR/mock-$(basename "$HARNESS" .js).jsonl"
: > "$PS_LOG"

# refuse to start on top of another mock
if curl -s -m 1 -o /dev/null "http://127.0.0.1:$PS_PORT/__state"; then
    echo "something already answers on port $PS_PORT. Not starting a second mock." >&2; exit 2
fi

node "$MOCK" > "$LOGDIR/mock-stdout.log" 2>&1 &
MOCK_PID=$!
cleanup() { kill "$MOCK_PID" 2>/dev/null; wait "$MOCK_PID" 2>/dev/null; }
trap cleanup EXIT

# wait for the mock, up to ~6 s
for _ in $(seq 1 40); do
    curl -s -m 1 -o /dev/null "http://127.0.0.1:$PS_PORT/__state" && break
    kill -0 "$MOCK_PID" 2>/dev/null || { echo "mock exited early:" >&2; cat "$LOGDIR/mock-stdout.log" >&2; exit 2; }
    sleep 0.15
done
curl -s -m 1 -o /dev/null "http://127.0.0.1:$PS_PORT/__state" || { echo "mock never answered on $PS_PORT" >&2; exit 2; }

printf '== %s  against  %s  %s\n' "$HARNESS" "$FIXTURE" "$*"
node "$HERE/$HARNESS"
RC=$?
exit $RC
