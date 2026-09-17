# The wire surface

Three links: the browser to the device over a WebSocket and a small HTTP surface, and
the device to the printer over MQTT. This page is the map; the detail for the socket is
in [protocol-websocket.md](protocol-websocket.md), which was enumerated from the served
page of a stock unit and marks every claim FACT or INFERENCE.

## Browser to device: WebSocket `/ws`

One socket, JSON text frames, one root per outbound frame, `device_wakeup: 1` appended
to every outbound frame without exception.

| Direction | Roots | Detail |
|---|---|---|
| device to browser, on connect | `wifi`, `sta`, `ap`, `printer`, `settings`, `block`, all in one frame | [Inbound messages](protocol-websocket.md#inbound-messages) |
| device to browser, later | the same six after a change; `response` after a command; `ws_theme` (never observed) | |
| browser to device | `settings`, `wifi`, `sta`, `ap`, `printer`, `block` | [Outbound messages](protocol-websocket.md#outbound-messages-every-call-site) |

There is no read command. The device pushes the document on connect and after a change;
the page never asks.

### The six roots, as the device pushes them

| Root | Fields the factory page handles | Also present in the push |
|---|---|---|
| `wifi` | `ssid`, `password`, `scan`, `list` | |
| `sta` | `ip`, `hostname`, `state` | `auth_err_reason`, observed on a stock unit, not handled by the factory page; shown by this page as a bare reason code |
| `ap` | `ssid`, `password`, `ip`, `on` | |
| `printer` | `name`, `state`, `scan`, `list` | `sn`, `access_code`, `ip`, observed on a stock unit, not handled by the factory page; this page shows the serial number and address and never the access code |
| `settings` | `list2`, `current_mode`, `fw_version`, `img_version`, `language`, `printing_ui_type`, `follow`, `on` | `img_version` was never observed on the wire |
| `block` | `blocklist` | |

`list2` holds one entry per lighting mode: `brightness` and `rgb_rgba`, three colours
for idle, printing and error. Entry 0 (Music) writes colours as bare `RRGGBB`; entry 1
(H2D) writes `#RRGGBBAA`. A clone reproduces both and normalises neither. Whether `speed`
is echoed back is unknown; the observed push had no such key.

### What each control sends

| Control | Frame |
|---|---|
| lighting mode | `settings.rgb_info_mode` |
| brightness | `settings.rgb_info_brightness` |
| speed (H2D only) | `settings.rgb_info_speed` |
| a state colour | `settings.rgb_info_mode`, `rgb_rgba`, `rgb_state_index` |
| language | `settings.language` |
| reset lighting (H2D only) | `settings.rgb_reset` |
| factory reset, after its confirm | `settings.factory_reset` |
| the OK after a hostname or hotspot address change | `settings.reset` (a restart; never a button) |
| Wi-Fi scan | `wifi.scan` |
| Wi-Fi connect | `wifi.ssid`, `password` |
| hostname | `sta.hostname` |
| hotspot on or off | `ap.on` |
| hotspot settings | `ap.ssid`, `password`, `ip` |
| printer scan | `printer.scan` |
| printer bind | `printer.name`, `sn`, `access_code`, `ip` |
| printer unbind, after its confirm | `printer.disconnect` |
| a segment colour | `block.blockID`, `blockrgba` |

### Enumerations

| Field | Values |
|---|---|
| `sta.state` | 1 no ssid, 2 connecting, 3 connected, 4 reconnecting, 5 password error |
| `printer.state` | 1 invalid info, 2 connecting, 3 connected, 4 address error, 5 serial mismatch, 6 access code rejected, 7 unknown error |
| `printer.scan` | 0 idle, 1 scanning, 2 done, 3 checking for an address change, 4 serial not matched, 5 address unchanged, 6 new address applied |
| `wifi.scan` | 0 idle, 1 scanning, 2 done |
| `response.type` | `set_hostname`, `set_ap`, `set_hotspot_ip`, `factory_reset`, `ota_fw`, `ota_img` |

### The three resets

| Frame | What it does |
|---|---|
| `settings.rgb_reset` | lighting only: brightness, speed and the three colours. The factory page never sends it in Music mode |
| `settings.reset` | a restart. Sent only by the page's OK after `set_hostname` or `set_hotspot_ip` succeed |
| `settings.factory_reset` | erases all data, then restarts. Behind a confirm |

## Browser to device: HTTP

| Request | Answer |
|---|---|
| `GET /` | the page, `text/html`, gzip |
| `HEAD /` | 405 |
| `GET /ota` | 405 |
| `POST /ota` | the upload; `OTA-Type` header names the target; body is the file; `Content-Type: application/octet-stream;charset=UTF-8` |
| anything else | 302 to the captive portal |

| `OTA-Type` | Cap | Answer on the socket |
|---|---|---|
| `ota_fw` | 0x480000 bytes | `response` type `ota_fw` |
| `ota_img` | 0x6E0000 bytes | `response` type `ota_img` |
| one of the fifteen slot names | 0x180000 bytes | `response` type `ota_img` with `gif` naming the slot |

The caps are shared framework constants and say nothing about the flash layout. There is
no route that serves an animation back; the fifteen assets are recoverable only from a
flash dump.

The fifteen slots, in the device's order: `standby`, `nozzle_heating`, `bed_heating`,
`bed_leveling`, `homing`, `nozzle_cleaning`, `calibrating_flow`, `xy_mesh_mode_sweep`,
`filament_check_location`, `filament_cut`, `filament_pull_back_cur`, `filament_push_new`,
`filament_purge_old`, `printing_ok`, `printing`.

## Device to printer: MQTT

What is established, confirmed against a working client:

| | |
|---|---|
| transport | TLS on port 8883; the printer's certificate is self-signed, so the server is not verified |
| credentials | username `bblp`, password the printer's access code |
| subscribe | `device/<SN>/report` |
| publish, once, after subscribing | `device/<SN>/request`: `{"pushing":{"sequence_id":"0","command":"pushall","version":1,"push_target":1}}` |

What is **not** established: which fields of the report the device reads, and how they
map to the bar's three states and the fifteen stage animations. That is what
`tools/capture-mqtt.py` exists to record, and the capture has not run. The firmware's
parser is one function marked INFERENCE that the capture will correct.

## Gaps, by name

| Gap | Settled by |
|---|---|
| whether a change-triggered push carries all six roots or only the changed one | the bench capture |
| whether a change-triggered push reaches other clients | the bench capture (measured once: the connect push does not) |
| what the device does with `rgb_reset` in Music mode | the bench capture |
| whether `speed` is echoed in `list2` | the bench capture |
| which `response` an `ap` message earns when the address does and does not change | the bench capture |
| the shape of `wifi.list` and `printer.list` entries | the bench capture |
| the report fields that drive the bar and the animations | the MQTT capture |
| `ws_theme`, never observed | a visit to the factory theme page during the bench |
| Home Assistant discovery | the MQTT capture and Phase 1 |
