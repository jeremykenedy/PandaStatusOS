# Architecture

Three parts: the firmware, the page it serves, and the tools that build and test both
without a device.

## Firmware

ESP-IDF v5.3.1, target ESP32-C3. One component, `firmware/main/`, with one shared header.

| File | Owns |
|---|---|
| `ps.h` | the wire enums as facts, the stored config `ps_cfg_t`, the live state `ps_state_t`, and every module's interface |
| `ps_main.c` | `app_main`: NVS, config, then the modules in dependency order; the recursive state lock; `ps_restart()` |
| `ps_cfg.c` | one NVS blob: defaults first, stored layout overlaid, matched by magic and corroborated by size; clamps; the migration chain |
| `ps_state.c` | the six-root document as JSON, and the inbound dispatcher that applies each root and returns what changed |
| `ps_ws.c` | the HTTP server: the page, the upload endpoint, the captive redirect, and the WebSocket |
| `ps_wifi.c` | station and hotspot, the station enum from the IDF's events, scans, hostname |
| `ps_led.c` | the strip on the RMT transmitter |
| `ps_effect.c` | the 30 fps render task |
| `ps_printer.c` | the printer's MQTT broker: bind, subscribe, the full-report request, the bar state |
| `ps_ota.c` | the three upload targets: firmware, image pack, one animation slot |

### The state and its lock

`g_ps` is the one state document: the stored config plus the live values (station state
and address, scan results, printer state, bar state, image version). It is guarded by a
recursive mutex, `ps_lock()` / `ps_unlock()`. Every task that reads or writes it takes the
lock; the dispatcher runs with it held; the renderer copies what it needs under the lock
and releases it before touching the strip.

### Tasks

| Task | Source | Does |
|---|---|---|
| main | `app_main` | brings everything up, then returns |
| httpd | `esp_http_server` | serves the page and the upload, owns the sockets, applies inbound frames, sends every outbound frame (other tasks queue work onto it) |
| ps_effect | `ps_effect.c` | renders a frame every 33 ms, or sooner when notified |
| mqtt | `esp-mqtt` | the printer link; its events update the printer and bar state under the lock |
| wifi / event loop | ESP-IDF | station and scan events, under the lock |
| esp_timer | ESP-IDF | the Wi-Fi retry, the printer scan's completion, the delayed restart after a firmware update |

The rule that keeps this simple: **only the httpd task writes to a socket.** `ps_ws_push()`
and `ps_ws_response()` copy the text and queue it with `httpd_queue_work()`, so any task
may call them.

### What happens on the wire

1. A browser opens `/ws`. The server pushes all six roots in one frame.
2. The browser sends a single-root frame with `device_wakeup: 1`. The dispatcher applies
   it under the lock, saves the config if it changed, notifies the renderer, and returns
   the roots that changed.
3. If anything changed, the whole document goes back to the sender. This is the mock's
   reading of the factory behaviour (D-014) until the bench capture confirms it.
4. Commands that need an answer (`set_hostname`, `set_ap`, `set_hotspot_ip`,
   `factory_reset`, the uploads) send a `response` frame; the page decides what to show.

[PROTOCOL.md](PROTOCOL.md) has the whole surface.

### Storage

One NVS blob, 492 bytes, pinned by `_Static_assert` to its size and its array offsets so
the host tests and the target agree byte for byte. Its magic is its version. A layout
change means freezing the old struct inside `ps_cfg.c`, bumping the magic, adding an arm
to the chain and a blob to the host test. [CONFIG.md](CONFIG.md) lists every key.

The partition table is generated from one number, the flash size, and is PROVISIONAL
until a unit's flash has been read: two app slots, an `images` partition of custom type
0x40 for the stage animations, coredump last.

## The page

One file, `firmware/main/ui.html`, embedded gzipped. It is built, not written:

```
tools/ui/src/frame.html           the shell: head, top bar, rail, main, bottom bar
tools/ui/src/global.html          the dialog, the toast, the file input
tools/ui/src/pages/*.html         one card per page
tools/ui/src/modules/*.js         one module per page, plus 00-core.js
tools/ui/src/css/theme.css        the Material 3 token pairs, both themes
tools/ui/src/css/app.css          layout and the project's own components
firmware/main/vendor/...          Beer CSS, Coloris, Heroicons, gated by sha256
tools/ui/i18n/*.json              the string tables
        |
        v  tools/ui/build/build.py
firmware/main/ui.html             committed; --check proves reproducibility
        |
        v  CMake, gzip -9 -n
firmware/main/ui.html.gz          derived, gitignored, embedded
```

The build fills named slots in the frame, splices each vendored file only if its sha256
matches its README, minces the Heroicons into one sprite, derives the English table from
the markup, validates every other table against it, and refuses a page that fails any of
its checks ([BUILDING.md](BUILDING.md)).

### The core module

`00-core.js` is the substrate every page shares: the socket and the one send function
(which appends `device_wakeup: 1`), the merged state document, the i18n runtime with its
one accessor `PS.tr()`, hash routing between cards, the dialog, the toast, the top-bar
pill, the response root, the theme, the upload function, and the event ring the Logs
page reads. Page modules register on `PS.on('state', ...)` and call `PS.send()`; they
own nothing in the core.

### The seam

Strings reach the page through exactly one accessor and one build function.
`strings_block()` in the build decides inline versus fetched; inline today, with all 25
languages in the page at 145 KB gzip. If the flash dump shows a tight partition, the
fetch path is one build flag and no call site changes (D-016, D-025).

## The tools

| Tool | What |
|---|---|
| `tools/ui/mock/mockdev.js` | a device that speaks the protocol, with knobs that make it slow, silent, gone or wrong |
| `tools/ui/harness/wire.js` | proves the mock against the protocol document before any page trusts it |
| `tools/ui/harness/page-*.js` | one harness per page: drives each control, asserts the exact frame |
| `tools/ui/harness/contrast.js` | every page, both themes, both widths, WCAG ratios from composited grounds |
| `tools/ui/harness/resilience.js` | one mock lie per sweep row |
| `tools/ui/harness/sweep.sh` | the one table of harness, fixture and environment |
| `firmware/test/host/` | the config and state modules compiled on the host against a fake NVS and the IDF's cJSON |
| `tools/fw/gen_partitions.py` | the partition table from one number |
| `tools/art/gen_marks.py` | the marks from primitives, with `--check` |
| `tools/residue-sweep.sh`, `tools/test-hook.sh` | the clean-room sweep and the hook's suite |
| `tools/capture-mqtt.py`, `tools/redact_mqtt.py` | capture the printer's report stream to disk, then redact it for the tree |
