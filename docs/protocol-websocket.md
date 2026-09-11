# Panda Status P2: browser-side protocol

**How this was established:** by reading the web UI the unit serves, as an artifact on
disk. Static reading only. No firmware disassembly. No credential values appear here.

| | |
|---|---|
| Origin | `GET /` from the unit, referenced as `<DEVICE_HOST>` |
| Size | 278,771 bytes |
| sha256 | `3837146860e8e7f5f71903bf47387559a772e19f27cac9138859990bbbcec5cb` |
| Encoding | identity, uncompressed, self-contained, zero external assets |
| Firmware | `settings.fw_version` = `V1.0.0` |
| Retrieved | 2026-08-27 |

**FACT** means established from that artifact. **INFERENCE** means a reading that has
not been proven and must not be treated as settled.

This document records the interface: message roots, field names, enum values, wire
shapes and measured behaviour. It does not reproduce the factory application's source.

## Transport

**FACT.** One WebSocket, opened to `/ws` on the device's own host. All frames are JSON
text. Every outbound message is a single-root object.

### Outbound envelope

**FACT.** Every outbound message is built by one shared helper, so the wire shape is
uniform:

```json
{ "<root>": { "<field>": <value>, ..., "device_wakeup": 1 } }
```

`device_wakeup: 1` is appended to **every** outbound message with no exception. A clone
that omits it is not faithful.

**FACT.** The send path refuses to transmit when the socket is not OPEN, and raises the
connection-not-open dialog instead. See the reload hazard at the bottom of this document.

## How a config read is obtained

**FACT.** There is **no request-side read command.** All 15 live send sites are setters
or actions. No `get`, `query`, `read`, `status` or `sync` exists in the outbound surface.
The UI never asks for config, it only receives it.

`device_wakeup: 1` rides on every outbound message. Whether the firmware treats it as a
re-emit trigger is firmware behaviour and is **not** visible in this artifact. Unverified.

**FACT, measured.** The device pushes the full config, all six roots, to a client on
connect. It does **not** broadcast to other connected clients: during three external
reads an attached browser socket received zero frames.

**Consequence.** A config read is obtained by opening a **second, short-lived client**,
not by reconnecting the browser. Measured with a browser tab attached throughout three
consecutive reads: browser socket stayed OPEN, zero close events, no reload dialog, no
navigation, in-page state intact, and every read returned all six roots.

This matters because the UI's reaction to its own socket closing is a modal whose OK
button reloads the page. Reads taken on a separate client never trigger it.

## Outbound messages, every call site

**FACT.** Six roots. Enumerated exhaustively by brace-matched parse of every send call
site in the artifact, with comments stripped first.

### root `settings`

| Control that sends it | Fields |
|---|---|
| Brightness slider | `rgb_info_brightness` |
| Speed slider | `rgb_info_speed` |
| Mode select (Music / H2D) | `rgb_info_mode` |
| Colour picker confirm | `rgb_info_mode`, `rgb_rgba`, `rgb_state_index` |
| Language select | `language` |
| Factory Reset, after its confirm | `factory_reset` |
| Reset Settings on the RGB card, after its confirm | `rgb_reset` |
| Restart request, fired by the hostname / hotspot-IP success handler | `reset` |

**Dead controls, corrected 2026-08-27.** Three `settings` senders are commented out in
the shipped artifact and never execute. An earlier revision of this document listed them
as live, because the extraction regex matched inside comments. The enumeration was re-run
with comments stripped.

| Control | Would have sent | Reality |
|---|---|---|
| RGB on/off checkbox | `rgb_info_mode`, `on` | handler body commented out |
| Follow checkbox | `rgb_info_mode`, `follow` | handler body commented out |
| Printing UI type select | `printing_ui_type` | send commented out; the handler computes an index and discards it |

**`settings.on`, `settings.follow` and `settings.printing_ui_type` are never sent by
this UI.** All three remain handled inbound, so the firmware may still emit them, but
no browser action can set them.

### PHASE 2 PLUS: a disabled control surface

**Do not act on this. Recording it only.**

These three fields are handled on the inbound path but unreachable from the browser.
If the firmware still honours them on receipt, then BTT shipped a control surface and
then disabled the UI in front of it:

- `settings.on` — an RGB on/off that cannot be toggled
- `settings.follow` — a "follow" mode whose meaning is not determinable from this artifact
- `settings.printing_ui_type` — a display-mode selector whose only shipped option is
  `progress_gif`, hinting at other modes the firmware may still accept

Whether the firmware honours them is **unknown and untested**. Nothing here proves the
handlers exist on the device side; the inbound handling proves only that the *browser*
would understand them coming back.

**This is a Gate 1 decision, not a capture task.** Gate 1 requires functional
equivalence: every control the factory UI exposes must be present in the clone and must
reach the device with the same wire message. Controls that are dead in the factory UI
send nothing, so there is nothing for the clone to match. Whether to wire them up is a
decision for after every Phase 2 gate passes, under standing rule 5.

Testing whether the firmware honours them would mean sending a message the factory UI
never sends. That is out of scope for the stock capture session and is not on the run
sheet.

### root `wifi`

| Control that sends it | Fields |
|---|---|
| Scan button | `scan` |
| Connect button | `ssid`, `password` |

### root `sta`

| Control that sends it | Fields |
|---|---|
| Set-hostname button | `hostname` |

### root `ap`

| Control that sends it | Fields |
|---|---|
| AP enable checkbox | `on` |
| AP settings confirm | `ssid`, `password`, `ip` |

### root `printer`

| Control that sends it | Fields |
|---|---|
| Scan button | `scan` |
| Bind button | `name`, `sn`, `access_code`, `ip` |
| Unbind, after its confirm | `disconnect` |

### root `block`

| Control that sends it | Fields |
|---|---|
| Block colour picker confirm | `blockID`, `blockrgba` |

## Inbound messages

**FACT.** The inbound dispatcher handles eight top-level roots. A single frame may carry
several. The connect-time push carries six of them at once.

| Root | Fields handled |
|---|---|
| `wifi` | `ssid`, `password`, `scan`, `list` |
| `sta` | `ip`, `hostname`, `state` |
| `ap` | `ssid`, `password`, `ip`, `on` |
| `printer` | `name`, `state`, `scan`, `list` |
| `settings` | `list2`, `current_mode`, `fw_version`, `img_version`, `language`, `printing_ui_type`, `follow`, `on` |
| `block` | `blocklist` |
| `ws_theme` | `preview`, `list` |
| `response` | `type`, `ok`, `gif` |

**Note:** `settings.img_version` is handled by the UI but was **not present** in the
observed connect-time push. Not yet seen on the wire. `ws_theme` and `response` were
likewise not seen, because neither a theme page visit nor a command occurred.

**FACT, observed on the wire, the other way round:** the connect-time push carries two
things the page does **not** handle. `sta` carries `auth_err_reason` (a number; 0 when
connected), and `printer` carries `sn`, `access_code` and `ip` alongside `name`, `state`
and `scan`. The device sends them; the factory page ignores them. This project's page
shows the reason code when non-zero and the printer's serial number and address, and
never shows the access code.

## Enumerations

**FACT.** Values and their meanings, read from the artifact's own dispatch logic.

### `sta.state`
```
1 nossid   2 connecting   3 connected   4 reconnecting   5 password error
```
Observed live: `3`.

### `printer.state`
```
1 invalid info   2 connecting   3 connected   4 ip err
5 sn err         6 access code  7 unknown err
```
Observed live: `3`. Case `0` falls through with case `1`.

### `printer.scan`
```
0 idle   1 scanning   2 done   3 ip_change_scanning
4 sn not matched     5 ip not changed     6 new ip applied
```
Observed live: `5`.

### `wifi.scan`
```
0 idle   1 scanning   2 done
```

### `response.type`
```
set_hostname   set_ap   set_hotspot_ip   factory_reset   ota_fw   ota_img
```
`set_hostname` and `set_hotspot_ip` trigger a restart request on success.

## The RGB model

**FACT.** Two modes, three states. Not seven effects and not six states.

The mode select offers exactly two options, Music and H2D. `settings.current_mode`
selects between them. Observed live: `1`.

`settings.list2` is an array of per-mode config. Observed live shape:

```json
"list2": [
  { "brightness": 50, "rgb_rgba": ["FFFFFF", "FFFFFF", "FFFFFF"] },
  { "brightness": 50, "rgb_rgba": ["#FFFFFFFF", "#1B00FFFF", "#FF0000FF"] }
]
```

**INFERENCE:** index 0 is Music, index 1 is H2D. Supported by the client-side reset
path, which sets the two brightness entries separately and labels them that way, and by
`current_mode: 1` arriving while the mode select reads H2D. Not proven by a write test.

Note the two entries use **different colour formats** in the live data: index 0 is bare
`FFFFFF`, index 1 is `#FFFFFFFF` with a leading hash and an alpha byte. A clone must
reproduce both formats, not normalise them.

### Sliders

**FACT**, from the markup's own attributes:

| Slider | min | max | step | default | display |
|---|---|---|---|---|---|
| Brightness | 0 | 100 | 5 | 50 | value + `%` |
| Speed | 0 | 100 | 5 | 100 | value + `%` |

Both are 0..100 in steps of **5**, so 21 discrete positions each.

**FACT:** speed is disabled in Music mode. The Music branch disables the slider and greys
the thumb. The artifact's own comments confirm the speed bar is H2D only.

**FACT:** the client-side reset path resets the speed entry for index 1 only, never
index 0.

**Discrepancy worth tracking:** the UI reads a `speed` key out of each `list2` entry, but
the observed device push contained **no `speed` key** in either entry. The UI expects a
field the firmware did not send. Either it is not persisted, or it is only emitted under
conditions not yet triggered. Unresolved.

### State index

**FACT.** The colour picker confirm sends `rgb_state_index` alongside `rgb_rgba`, so
colours are addressed by state index.

**FACT.** The three states are idle, printing and error, in that order. The markup
carries one colour item per state, classed accordingly.

**FACT.** The client-side reset path sets:

| Index | State | Colour |
|---|---|---|
| 0 | idle | `#FFFFFF` |
| 1 | printing | `#FFFFFF` |
| 2 | error | `#FF0000` |

**INFERENCE, and flagged deliberately:** index 2 is error. The evidence above says so,
and the live value at index 2 is `#FF0000FF`, which is red. **But** a second, stale
comment elsewhere in the same artifact labels index 2 as pause, left over from the
six-state V1/V2 model. The artifact contradicts itself. Static reading cannot settle it.
Only changing one colour and observing which state moves will.

## The three reset commands

**FACT.** Three distinct commands land on the `settings` root and are frequently
confused. They are separate messages with separate triggers.

| Wire message | What triggers it |
|---|---|
| `{"settings":{"rgb_reset":1,"device_wakeup":1}}` | the Reset Settings button on the RGB card, then its confirm |
| `{"settings":{"reset":1,"device_wakeup":1}}` | never a button. Fires as the OK handler after `set_hostname` or `set_hotspot_ip` succeed |
| `{"settings":{"factory_reset":1,"device_wakeup":1}}` | the Factory Reset button on the settings card, then its confirm |

### What the UI claims each one does

**`rgb_reset`** — **FACT.** Before sending, the client-side path locally resets, and
nothing else:

| What it resets | To |
|---|---|
| brightness, index 0 (Music) | 50 |
| brightness, index 1 (H2D) | 50 |
| speed, index 1 (H2D) only | 100 |
| colour index 0 (idle) | `#FFFFFF` |
| colour index 1 (printing) | `#FFFFFF` |
| colour index 2 (error) | `#FF0000` |

It then repaints and sends `rgb_reset`. Its confirm dialog is worded as though it
restores every setting, but every value the path actually touches is lighting. Nothing
in it touches Wi-Fi, AP, printer binding, hostname or language.

**INFERENCE, not proven:** `rgb_reset` resets only the lighting config on the device.
The client-side path is lighting-only and the command name says lighting, but what the
firmware does on receipt is not visible from this artifact. A config read before and
after is the only proof.

**`reset`** — **FACT.** It is a **restart**, not a reset. The only two callers are the
success handlers for `set_hostname` and `set_hotspot_ip`, both of which need a reboot to
apply. It is never presented to the user as a reset and has no button.

**INFERENCE:** `reset` reboots and preserves configuration. It is named `reset` on the
wire but its only role is to apply a setting that requires a restart.

**`factory_reset`** — **FACT.** Its confirm dialog is the only one of the three that
warns of total data loss on the device, and it tells the reader not to use the function
without being told to by a technician. `factory_reset` is one of the types in the
`response` enum, so the device acknowledges it.

### Ordering

**INFERENCE**, from dialog copy and code path only, ascending by destruction:

```
rgb_reset      lighting only, no reboot claimed
reset          reboot, configuration preserved
factory_reset  erases all data, then restarts
```

The artifact supports this ordering but does not prove it. Firing them in this order with
a full config read between each turns the inference into measurement.

### FIRING QUIRK, and it will silently waste a step

**FACT.** The `rgb_reset` path has a guard ahead of its send: when the selected mode is
Music, it returns before transmitting. **In Music mode `rgb_reset` is never sent.** The
sliders repaint locally and nothing reaches the device.

**Be in H2D mode when firing `rgb_reset`, or it does nothing and the config read after it
will show no change, which reads exactly like "the command had no effect".**

## The GIF / theme channel

**FACT.** The P2 drives a GIF display, not only an LED bar. The printing-UI-type select
has exactly one option, value `progress_gif`.

**FACT.** The artifact enumerates **15** GIF slots:

```
standby              nozzle_heating       bed_heating
bed_leveling         homing               nozzle_cleaning
calibrating_flow     xy_mesh_mode_sweep   filament_check_location
filament_cut         filament_pull_back_cur  filament_push_new
filament_purge_old   printing_ok          printing
```

These are print-stage names, so the display is stage-driven and considerably richer
than the three RGB states.

**FACT.** `ws_theme.list` entries are `{ gif: <name>, rgba: <colour> }` and are filtered
against that slot list before use.

## HTTP surface

**FACT**, probed read-only with GET only.

| Path | Result |
|---|---|
| `GET /` | 200, the UI, 278,771 bytes, identity |
| `HEAD /` | 405 Method Not Allowed |
| `GET /ota` | 405 Method Not Allowed |
| every other path tried | 302, redirect to the captive portal |

Paths probed and redirected: `/gif/standby`, `/gif/standby.gif`, `/standby.gif`,
`/theme/standby.gif`, `/img/standby.gif`, `/gif?name=standby`, `/theme?gif=standby`,
`/gif`, `/theme`, `/img`, `/spiffs/standby.gif`, `/fs/standby.gif`, `/version`,
`/img_version`, `/status`.

**CONCLUSION, FACT: there is no HTTP GET route for the GIF assets.** The device serves
exactly one document and accepts one upload endpoint. The GIFs currently on the device
are not retrievable over the network and must be recovered from the flash dump.

### Upload endpoint

**FACT.** Uploads are `POST` to `ota` with:

| Header | Value |
|---|---|
| `Content-Type` | `application/octet-stream;charset=UTF-8` |
| `OTA-Type` | the target: `ota_fw`, `ota_img`, or a GIF slot name |

The body is the file itself.

### The 0x480000 question, resolved

**FACT.** The upload surface carries three size constants, one per upload type:

| Upload type | Constant | Decimal | |
|---|---|---|---|
| `ota_img` | `0x6E0000` | 7,208,960 | 6.875 MB |
| `ota_fw` | `0x480000` | 4,718,592 | 4.5 MB |
| a GIF slot | `0x180000` | 1,572,864 | 1.5 MB |

**`0x480000` is a maximum upload size, not a partition offset.** The value is passed as a
maximum-size parameter, compared against the selected file's size, and rendered into the
rejection message as megabytes. The earlier reading of it as an OTA partition offset is
withdrawn.

It does not survive as evidence about layout either. The per-GIF constant allows
15 × 1.5 MB = 22.5 MB of GIFs into a region the same surface caps at 6.875 MB, so at
least one of these three numbers is a round guard with no relationship to partition
geometry. **INFERENCE, and the reason these numbers carry no weight:** they are shared
framework constants. The real partition table comes from the dump and nothing before it
settles flash size.

**FACT:** the upload path carries a disabled dimension check expecting GIFs to be at most
**240 x 240**. The check does not run in shipped code, so the firmware may or may not
enforce it.

## Hazard: the UI reloads itself when the socket closes

**FACT.** Any socket close raises a modal, and that modal's OK button performs a full
page navigation. During capture that destroys the in-memory log. Do not click OK on that
dialog. Attach to the live socket rather than reopening one.

## Not covered here

Firmware internals, the renderer, the Music mode DSP, NVS layout, and the partition
table. Those require the dump and were not authorized.
