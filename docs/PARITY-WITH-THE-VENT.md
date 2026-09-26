# Parity with the vent

The governing instruction on this project is that PandaStatus's page must look and work
the way PandaVent OS's does, and that the lessons from that project come across with it.
This file is the list. It is checked against both trees, not remembered: every "has" and
"has not" below was verified in the source on 2026-09-25.

PandaVent OS is the reference. Its own record is in the maintainer's project notes: the
features beyond its clone, the faults it found, and its harness suite.

## What has come across

| From the vent | Here |
|---|---|
| Four colours per effect (lit/unlit × two conditions) | A3, `effect_colours` |
| Optional brightness ramp | A5, `effect_ramp` |
| Temperature gradient, both ends configurable | A10, `fx_temp` |
| Configurable hot-warning threshold | A11, `hot_warning` |
| Configurable error flash: colour, brightness, rate | A12, `error_flash` |
| Live preview with a pinned printer state | A13, `preview`, plus a fifteen second button on every state row |
| Device log viewer | The Logs page |
| Top bar with printer state and percent | The top bar |
| Plain restart, separate from the two resets | C4, `restart` |
| Status page with full telemetry | The dashboard: print, printer, AMS, lighting |
| RAM animation upload, no flash to persist it to | Stage images, held in memory, gone after a restart |
| Named effects saved and copied between states | A14, `presets` |
| More than seven effects | Twenty-four |
| Per-effect brightness, speed and direction | A4, `effect_params` |
| Twenty-four languages, every key complete | Twenty-four, 590 keys |

## What has not

Each of these exists on the vent and does not exist here. None is started.

### 1. Printer controls, beyond the one lamp

The vent drives the printer's fans and its print speed over `printer_ctl`, and has three
harnesses for it. Here, `apply_printer_ctl()` reads one key, `light`, and nothing else:
the Printer controls card is a single switch. The same envelope rules apply, so what the
vent does is what is possible: `system.*` and `camera.*` are not signature-checked,
`print.*` is, and Developer Mode under LAN Only Mode is the switch that makes writes
land at all.

### 2. The camera

The vent has a Camera page and a harness for it. There is no camera anywhere in this
tree. The envelope is one of the two that need no signature, so this is reachable.

### 3. Render stats

Frames, frames per second, the interval and dropped pushes, on the page. The vent has
them and they are how it proved a dropped frame on every page load was real. Nothing
here counts a frame.

### 4. What a segment is

The vent has per-strip LED counts, a contiguous "one long run" layout, and a three-way
direction (master, per-strip, per-effect). Here the strip is one run of twenty-five and
the factory's `block` root is stored, reported and drawn by nothing: the Lights card
says so in its own text. Direction here is per-effect only.

### 5. The harness classes this suite does not have

The vent runs forty harnesses. This tree runs thirteen. The gap is not coverage of the
same things, it is whole classes of check that do not exist here:

| Vent harness | What it catches | Here |
|---|---|---|
| `pixels.js` | text painted the colour of the ground beneath it, per region, both themes, every page | nothing. `contrast.js` measures 44 pairs |
| `i18n` | a key that resolves to nothing at runtime | the build checks the tables; the page is never walked |
| `undefcheck` | the string "undefined" reaching the page | nothing |
| `quietload` | anything written to the console on a cold load | only inside other harnesses |
| `slowload`, `slowland` | a device that answers late, and one that does not answer at all | `nows.js` covers the socket refusing, nothing covers slow |
| `navsize`, `align`, `cursors`, `fontcheck` | the chrome's own geometry, alignment, pointer and font | nothing |
| `marks`, `herocheck` | the artwork as it actually renders | nothing |
| `topbar` | the state dot through its transition, without racing the device's own push | nothing |
| `coldstart`, `layout` | first paint, and the page's shape | nothing |

`pixels.js` is the one that matters most. On the vent it was 3932 regions and it is what
found that the light theme had never been rendered under a check at all.

### 6. The light-theme faults the vent found, unchecked here

Every one of these was found on the vent by looking at the light theme properly. Whether
this tree has them is unknown, because nothing here has looked:

- a fixed hex where an M3 container pair belongs
- white washes (`rgba(255,255,255,.04)` and up) doing edges, tracks and grooves, which
  are a hairline on dark and nothing on light
- fields and selects with a border and a height and no colours, so the browser paints
  them white on white
- a select arrow drawn as a white triangle
- `color-scheme` never set, so native dropdowns and scrollbars come out wrong
- an `<img>` whose colour is baked into a base64 SVG, which no stylesheet can reach
- duplicate rules where the later copy shadows the earlier fixed one

### 7. A static mock of the page

The vent generates `ui-mock.html`: every card visible at once, no scripts, for laying
out. There is no equivalent here, so laying out a card means driving the mock device.

## The vent bridge

Separate from parity, and its own document: [PANDAVENT-BRIDGE.md](PANDAVENT-BRIDGE.md).
Three things were asked for and none is built: the two copy switches inside a bind-a-vent
card, a vent status card on the dashboard, and a vent settings page that has to speak to
three different firmwares (the factory's, PandaVent OS's, and DragonVent's).

## Catalogued elsewhere, still open

[ROADMAP.md](ROADMAP.md) holds the rest: AMS tray colour mirroring onto the bar, layer or
ETA as a ramp, Home Assistant entities, Music mode, Klipper and Moonraker. Klipper is the
one capability the vent has not matched either.
