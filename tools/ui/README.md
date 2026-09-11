# tools/ui

The mock device, the harnesses that run against it, and (from Q3) the page build.

Standing rule 9: nothing here ever talks to real hardware. Every harness runs against the
mock, and the mock is the only thing any harness is allowed to connect to.

## Layout

| Path | What |
|---|---|
| `mock/mockdev.js` | the mock Panda Status P2. HTTP serves the page, `/ws` speaks the protocol, a fixture is the device state. Its header lists every fact it reproduces, every inference it makes, and every lie it can tell |
| `mock/fixtures/` | device state documents. Scrubbed: `<PLACEHOLDER>` tokens for every secret-shaped field, documentation addresses only |
| `harness/wire.js` | proves the mock speaks the protocol, at the socket, before any page trusts it |
| `harness/nows.js` | proves the mock refuses the upgrade under `PS_NO_WS=1` |
| `harness/run.sh` | one harness against one fresh mock; returns the harness exit code |
| `harness/sweep.sh` | the table of every harness x fixture x env; the only place that pairing lives |

Dependencies live under `private/uiwork/` (gitignored) and reach the scripts through
`NODE_PATH`, which `run.sh` sets relative to the repo root. Playwright, when the browser
harnesses arrive, goes there too and never into a tracked `package.json`.
See `docs/DECISIONS.md` D-013.

## Setup, once per checkout

```bash
mkdir -p private/uiwork
cat > private/uiwork/package.json <<'EOF'
{ "name": "pandastatusos-uiwork", "private": true, "dependencies": { "ws": "^8.18.0" } }
EOF
(cd private/uiwork && npm install)
```

Node 22 or newer: the harnesses use the built-in `WebSocket` client and `fetch`.

## Running

```bash
tools/ui/harness/sweep.sh                    # everything
tools/ui/harness/sweep.sh wire               # rows whose harness matches "wire"
tools/ui/harness/run.sh p2-idle.json wire.js # one harness, one fixture
tools/ui/harness/run.sh p2-idle.json wire.js PS_DELAY=800   # with a lie
```

To drive the mock by hand:

```bash
NODE_PATH=private/uiwork/node_modules PS_STATE=p2-idle.json node tools/ui/mock/mockdev.js
# then open http://127.0.0.1:8199/ or connect a WebSocket to ws://127.0.0.1:8199/ws
```

## What the mock reproduces

From `docs/protocol-websocket.md`, with the measured connect-time capture as the fixture
shape: one WebSocket at `/ws`; a connect push of exactly six roots in one frame; zero idle
traffic; the `device_wakeup: 1` envelope on every inbound frame; the two colour formats in
`list2`, neither normalised; all five enums; the three reset commands with their real
semantics, including that `rgb_reset` is a no-op in Music mode; the fifteen stage GIF
slots; `block`/`blocklist`; the HTTP surface with its 405s, its 302s, and the upload with
per-type size caps.

## What the mock guesses, and how to flip each guess

The bench session has not run. Six behaviours the doc leaves open are implemented as a
default plus an environment knob; `docs/DECISIONS.md` D-014 lists them. When ladder reads
A to D come back, each becomes a fact or a fix.

## How the mock lies

Every knob is an environment variable, off by default, listed in the header of
`mock/mockdev.js`. The important ones: `PS_DELAY` (late push), `PS_DEAF` (nothing either
way for a while), `PS_NO_WS` (upgrade refused), `PS_NO_PUSH` (socket accepted, nothing
sent), `PS_DROP_AFTER` (socket terminated mid-session), `PS_MALFORMED` (a frame that is
not JSON), `PS_UNKNOWN_ENUM` (values outside every enum), `PS_PRINTER_OFFLINE_AFTER`
(printer drops mid-print), `PS_NOECHO` (writes apply but are never echoed). A harness can
also set any knob at runtime with `POST /__knob`.

## Debug endpoints

Present only in the mock, never protocol: `GET /__sent` (every frame the device received,
in order, with whether it carried the envelope), `GET /__pushed`, `GET /__state`,
`POST /__reset`, `POST /__knob`. Page harnesses assert what the device received by reading
`/__sent`, so no harness has to reach into the page's own JavaScript to find out.

## Writing a harness

Behaviour only. Click a control, assert the exact frame at `/__sent`, including
`device_wakeup`. Assert text, state, aria, and frames. Do not assert padding, alignment,
font sizes, or anything the design system will legitimately change: the sibling project
had ten harnesses policing panel geometry on a CSS system that then changed, and forty
green harnesses while the phone navigation was completely dead.

Print `N passed, M failed` at the end for the human, and exit nonzero on any failure for
the sweep. The exit code is the verdict.

Every harness in the sweep table walks both themes and both widths once a page exists.
Add the row when you add the harness; a harness that is not in the table is never run.
