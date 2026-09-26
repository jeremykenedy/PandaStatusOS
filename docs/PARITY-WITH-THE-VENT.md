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
| Twenty-four languages, every key complete | Twenty-four, 404 keys |
| Printer fans and print speed over `printer_ctl` | Three fan sliders and four speed levels on the Printer controls card, `t-pctl.js` (2026-09-26) |
| Render stats on the page | The Renderer card on the Logs page, `GET /api/render`, `t-render.js` (2026-09-26) |
| A master direction, exclusive-or with the effect's own | Bit 21 `bar_flip`, applied to the finished frame, `fx_test.c` (2026-09-26) |
| `pixels.js`: contrast from the pixels that were painted | `tools/ui/harness/pixels.js`, 842 regions, both themes, both widths, three CVD simulations, with a control sample (2026-09-26) |
| A static page of every card at once, for laying out | `tools/ui/harness/mockpage.js` -> `private/uiwork/ui-mock.html` (2026-09-26) |

## What has not

Each of these exists on the vent and does not exist here. The numbers are stable: a done
item keeps its number and says so, so that a list written against this file still reads.

### 1. Printer controls, beyond the one lamp — DONE 2026-09-26

`apply_printer_ctl()` now takes three shapes: `{fan,percent}`, `{speed}` and the `{light,on}`
it already had. The card carries a slider per fan the printer has actually named and a
four-level speed control, `ps_printer_fan_set()` sends `M106 P1|P2|P3 S0..255` and
`ps_printer_speed_set()` sends `print_speed` with "1".."4", both inside the `print` envelope
that Developer Mode under LAN Only Mode gates. `t-pctl.js` is the harness, 41 assertions,
and the mock grew `printer_ctl` (recorded always, echoed under `PS_PCTL_ECHO`), a
`printer.status` on the printing fixture, `speed_level` on `/api/print`, and a
`/__printer_status` debug route so a harness can make the printer report whatever it likes.

Two faults came out of writing it, both older than this item:

- **The focus rule was freezing controls.** `setChecked(id, on, guardFocus)` refused to write
  a switch that had focus, and the light settle did the same. A switch that has just been
  clicked HAS focus and keeps it, so a lamp the printer refused, or a hotspot that dropped on
  its own, went on being drawn the way the last finger left it for as long as the page stayed
  open. The guard is gone from all three switches; what protects a command in flight is the
  bounded settle window, which ends with the device winning. The same reasoning is why the fan
  sliders are held by module 3b's window and not by focus: `t-pctl.js` D0 and I5 assert the
  control still has focus at the moment the device is allowed to win, so the rule cannot come
  back unnoticed.
- **A stale firmware binary was passing a page check.** `test-flash-tools.sh` compared the
  page embedded in `firmware/build` with `firmware/main/ui.html` through an unquoted `eval` of
  `appdesc` output, and `DATE=Sep 25 2026` made the shell run `25` as a command. The row could
  only ever have been read as a page mismatch. Values are quoted now.

The fan scale is the printer's, not ours: it reports fans in fifteenths, so the sliders step
by 1 and land where the printer says rather than snapping to a five.

### 2. The camera

The vent has a Camera page and a harness for it. There is no camera anywhere in this
tree. The envelope is one of the two that need no signature, so this is reachable.

### 3. Render stats — DONE 2026-09-26

Frames, frames per second, the interval and refused pushes, counted where the work happens
(`ps_effect.c`, `ps_led.c`) and read on the Logs page, which is the page whose whole purpose
is that every possible cause looks the same from the outside. `GET /api/render` carries them,
behind the diagnostics bit, because this is the same capability as the blinks on the bar and
answers the same question.

Two things here are deliberate and worth keeping:

- **`fps` is a rate, not a lifetime average.** It is measured over the window between reads.
  An average since boot settles at thirty and then can never move again, so it would go on
  saying thirty for hours after the renderer stopped, which is precisely the fault this is
  for. The cost is that two clients polling at once each narrow the other's window and both
  read low; that is written down in `ps_api.c` rather than guarded, because the guard would
  be a lock in the renderer's path.
- **The poll stops when the card closes**, and `t-render.js` E3 asserts it from the mock's
  request log. A poll left running behind a closed card is invisible from the page, and on
  this device it would also be narrowing the fps window of whoever IS looking.

The vent puts the same numbers on its Status page and reads them out of its status root; here
they are a route, because the socket document is pinned to the factory's six roots.

### 4. What a segment is — the direction is DONE 2026-09-26, the segment model is a decision

The vent has three things under this heading, and they are not the same size on this
hardware.

**Direction: done.** The vent's three-way flip is master, per-strip, per-effect, combined by
exclusive-or so that no one of them silently wins. Per-effect was already here. The master is
now bit 21 `bar_flip`, applied to the finished frame in `ps_effect.c` after the base, both
layers and the diagnostic, so one switch turns the whole bar round and nothing else has to
know about it. `fx_test.c` pins both halves: the arithmetic (end for end, and the middle pixel
of an odd bar stays put) and the property that makes it a flip rather than a direction, which
is that the progress bar rendered backwards and then flipped is byte for byte the progress bar
rendered forwards.

**Per-strip: does not apply, and that is a fact rather than a gap.** The vent drives two
physical outputs, which is why it has a count and a flip per strip. This device drives one:
GPIO 5, twenty-five pixels, both read out of the stock firmware
([HARDWARE-FACTS.md](HARDWARE-FACTS.md)). There is no second strip to give its own count or
its own direction to.

**The segment model: a decision, not a missing implementation.** The factory's `block` root
is stored and reported here and drawn by nothing, and the reason is now written down: the
device reports exactly ONE block, id 0, `#FFFFFFFF`, in the observed connect-time push and in
all three fixtures. A segment on this hardware, as the factory means it, is the whole bar. So
there is nothing to divide and nothing being missed.

What the vent's layout buys that this does not have is the other thing: a bar deliberately
CUT UP by its owner, twelve pixels showing the print and thirteen showing the nozzle
temperature, say. That is not parity with the factory's blocks and not a port of the vent's
per-strip counts; it is a feature of this project's own, and a large one: a segment table in
its own NVS blob, a resolve and a phase per segment, an editor, a route and its harnesses.
It is Jeremy's call whether that is wanted, and it is the one place under this heading where
building without asking would mean inventing semantics for a root that belongs to the factory.
The renderer now has the seam for it: the flip is applied where a per-segment transform would
go.

### 5. The harness classes this suite does not have

The vent runs forty harnesses. This tree runs fifteen. The gap is not coverage of the
same things, it is whole classes of check that do not exist here:

| Vent harness | What it catches | Here |
|---|---|---|
| `pixels.js` | text painted the colour of the ground beneath it, per region, both themes, every page | DONE 2026-09-26: 842 regions, and what it found is below |
| `i18n` | a key that resolves to nothing at runtime | the build checks the tables; the page is never walked |
| `undefcheck` | the string "undefined" reaching the page | folded into `pixels.js`: nothing painted may read as a bare key, as `undefined` or as `NaN` |
| `quietload` | anything written to the console on a cold load | only inside other harnesses |
| `slowload`, `slowland` | a device that answers late, and one that does not answer at all | `nows.js` covers the socket refusing, nothing covers slow |
| `navsize`, `align`, `cursors`, `fontcheck` | the chrome's own geometry, alignment, pointer and font | nothing |
| `marks`, `herocheck` | the artwork as it actually renders | nothing |
| `topbar` | the state dot through its transition, without racing the device's own push | nothing |
| `coldstart`, `layout` | first paint, and the page's shape | nothing |

`pixels.js` is the one that matters most. On the vent it was 3932 regions and it is what
found that the light theme had never been rendered under a check at all.

Here it was the dark theme, and it was worse than that. Writing it turned up four faults in
the harness suite itself, each of which had been quietly making the suite agree with the page:

1. **The dark theme had never been rendered.** The page kept its theme preference under
   `pv_theme`, the sibling project's prefix, while the harness sets `ps_theme`. The page never
   saw the preference and fell back to its default, which is light, so all four "dark" rows of
   `contrast.js` measured the light theme against itself and passed. The key is `ps_theme` now,
   the two others beside it (`ps_nav`, `ps_lang`) with it, and `build_firmware.py` fails the
   build on a storage key that is not this project's. Both harnesses now prove the theme landed
   before measuring anything through it.
2. **Six of the eight pages it walked do not exist.** `contrast.js` asked for dashboard,
   lighting, images, network, system and setup, which are another tree's names; this page has
   status, theme, printer, sta, ap, settings and logs. `waitCard` returned true for a card that
   is not there (with nothing active, every card agrees that it is not the active one), so the
   harness walked on and measured whatever was already on screen, eight times, printing the
   names it had asked for. Thirty-two of its rows were one page. `waitCard` now requires the
   card to exist, and both harnesses treat it not coming up as a failure of its own.
3. **The Logs page was showing the page's own source.** A device without `/api/logs` answers
   the 302 that every absent route answers, the browser follows it, and the XHR comes back with
   a 200 carrying the whole UI, which went straight into the log view: a megabyte of HTML in a
   `<pre>`. The log is `text/plain` and nothing else is, and that is now the test. The renderer
   card had the same shape and stops polling once the route has said it is not there.
4. **Two thirds of the string table was a vent's.** 201 keys that nothing on this page reaches:
   a flap, its endstops, its material policy, two LED strips, a camera. And fourteen keys that
   the page does reach and that called this device a vent, in every dialog an owner sees, in
   all twenty-four languages. The fourteen are rewritten and the 201 are gone, which took the
   page from 1450 KB to 1208 KB and the firmware from 19% free to 24%.

### 6. The light-theme faults the vent found — CHECKED 2026-09-26, one of them was here

Every one of these was found on the vent by looking at the light theme properly. Nothing here
had looked, and on this device it is the dark theme that had never been rendered under a check
(item 5). Now that both themes are measured, each of the seven has an answer:

| The vent's fault | Here |
|---|---|
| a fixed hex where an M3 container pair belongs | one, in `project.css`: the clear button on a colour swatch, opaque dark on purpose because it sits over a colour the owner picked and 45% over a pale swatch measured 3.4:1 through protanopia. Written down where it is. `app.css` has none; `theme.css` is the token file and is nothing but hexes |
| white washes doing edges, tracks and grooves | none. No `rgba(255,255,255,…)` in any sheet |
| fields and selects with a border and a height and no colours | measured rather than assumed: `contrast.js` reads every field's own colour and its border, in both themes, and holds the border to 3:1 as a boundary |
| a select arrow drawn as a white triangle | nothing draws one: no `data:image/svg` in any sheet. The browser draws it, which is the next row |
| **`color-scheme` never set** | **it was not set here either.** Everything the page does not draw itself reads that property: the select's arrow and its dropdown, scrollbars, focus rings, a number field's spin buttons. Without it the browser assumes light, so on the dark theme all of it came out light chrome on a dark page. Set now in all three theme states (`theme.css`), including the auto one |
| an `<img>` whose colour is baked in | two, and handled: the mark is a pair of base64 PNGs, one drawn for each theme, swapped by CSS in all three states (default, explicit, and system preference) |
| duplicate rules where the later copy shadows the earlier fixed one | none, and no longer possible to add quietly: `tools/ui/css_check.py` runs in the build and fails it on any selector that declares the same property twice in the same context |

### 7. A static mock of the page — DONE 2026-09-26

`tools/ui/harness/mockpage.js` drives the mock once with every switch on and a printer that
is printing, then writes the DOM as it stands with every card made active, everything that was
hidden shown, and every script removed. What comes out is `private/uiwork/ui-mock.html`: one
file that opens in any browser with no device, no server and no network, showing every card of
every page with real values in it. It is a picture and says so on itself; nothing in it works.

It earned its keep on the first run. With everything shown at once it is plain that the fault
banner (`.banner`, `position: fixed; inset: 0 0 auto 0`) is drawn OVER the top bar rather than
above it, so for as long as a save is failing the printer's name, the state chip and the print
percentage are behind it. That is a deliberate banner that cannot be dismissed, and covering
the one line that says what the printer is doing is the cost nobody had looked at. Left as it
is, written down here, because it is a design decision and not a defect.

## The vent bridge

Separate from parity, and its own document: [PANDAVENT-BRIDGE.md](PANDAVENT-BRIDGE.md).
Three things were asked for: the two copy switches inside a bind-a-vent card, a vent status
card on the dashboard, and a vent settings page that has to speak to three different
firmwares (the factory's, PandaVent OS's, and DragonVent's).

That document sets the order of work. Steps 2 and the page half of 3 are done:

- **The mock vent** (`tools/ui/mock/mockvent.js`), with `tools/ui/harness/vent.js` holding it
  to the contract in 32 assertions and a row in the sweep.
- **The first of the three things asked for**: a vent is bound the way a printer is, on the
  same page, which is now called Bindings in both navs because it holds two of them. The card
  carries the scan, the address, the bind and unbind, the six-digit pairing code with the
  device's own countdown, the link in the device's words, and the two copy buttons, which
  appear only once a vent is actually talking. `mockdev.js` holds a real bridge client for
  this, not a pretence of one: `t-bridge.js` runs the page, the device and the vent together,
  32 assertions, nothing simulated in between.
- The two frames the copies are made of (`light {request}` and `fx`) were missing from the
  contract, which described the copies before they had a wire. They are written into it now.

**The device half is not built**: `ps_bridge.c` does not exist. Items 9 (the vent card on the
dashboard) and 10 (the vent settings page, three firmwares) are still open, and 10 stays
unwritten until each of the three surfaces has been read the way this project reads a
surface.

## Catalogued elsewhere, still open

[ROADMAP.md](ROADMAP.md) holds the rest: AMS tray colour mirroring onto the bar, layer or
ETA as a ramp, Home Assistant entities, Music mode, Klipper and Moonraker. Klipper is the
one capability the vent has not matched either.
