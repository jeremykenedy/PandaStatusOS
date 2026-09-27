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
| Printer fans and print speed over `printer_ctl` | Built and taken out the same day (2026-09-26): the printer refuses both without Developer Mode, and the owner had every control that cannot work removed (D-052 to D-054). The fan speeds and the running level stay on the page as readings. The lamp stays as a control, `t-pctl.js` |
| Render stats on the page | The Renderer card on the Logs page, `GET /api/render`, `t-render.js` (2026-09-26) |
| A master direction, exclusive-or with the effect's own | Bit 21 `bar_flip`, applied to the finished frame, `fx_test.c` (2026-09-26) |
| `pixels.js`: contrast from the pixels that were painted | `tools/ui/harness/pixels.js`, 842 regions, both themes, both widths, three CVD simulations, with a control sample (2026-09-26) |
| A static page of every card at once, for laying out | `tools/ui/harness/mockpage.js` -> `private/uiwork/ui-mock.html` (2026-09-26) |

## What has not

Each of these exists on the vent and does not exist here. The numbers are stable: a done
item keeps its number and says so, so that a list written against this file still reads.

### 1. Printer controls, beyond the one lamp — DONE 2026-09-26

Built, then taken out the same day. Three fan sliders (`{fan,percent}`, `M106 P1|P2|P3
S0..255`) and a four-level speed control (`{speed}`, `print_speed` "1".."4") went in beside
the lamp, and on the owner's printer every one of them came back `mqtt message verify
failed`: both ride the `print` envelope, which this firmware takes only signed, and only
Developer Mode under LAN Only Mode turns that check off (D-052). The owner had every control
that cannot work removed (D-053, D-054). What remains of the item: `apply_printer_ctl()` takes
`{light,on}` alone and ignores the two old shapes; the fan speeds and the running level are
readings on the printer card and the job strip; the firmware logs the printer's answer to any
command, in the printer's words. `t-pctl.js` is the harness, 21 assertions, and the mock keeps
`printer_ctl` (recorded always, the lamp echoed under `PS_PCTL_ECHO`), a `printer.status` on
the printing fixture, `speed_level` on `/api/print`, and a `/__printer_status` debug route so
a harness can make the printer report whatever it likes.

Two faults came out of writing it, both older than this item:

- **The focus rule was freezing controls.** `setChecked(id, on, guardFocus)` refused to write
  a switch that had focus, and the light settle did the same. A switch that has just been
  clicked HAS focus and keeps it, so a lamp the printer refused, or a hotspot that dropped on
  its own, went on being drawn the way the last finger left it for as long as the page stayed
  open. The guard is gone from all three switches; what protects a command in flight is the
  bounded settle window, which ends with the device winning. `t-pctl.js` C7 asserts the
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

The vent runs forty harnesses. This tree ran fifteen when this was written and runs
twenty-two now. The gap was not coverage of the same things, it was whole classes of check
that did not exist here; each is a row below, and the four faults the new rows found on their
first run are written in their rows:

| Vent harness | What it catches | Here |
|---|---|---|
| `pixels.js` | text painted the colour of the ground beneath it, per region, both themes, every page | DONE 2026-09-26: 842 regions, and what it found is below |
| `i18n` | a key that resolves to nothing at runtime | DONE 2026-09-26: `t-i18n.js`, the page itself in all twenty-four languages, every card active and nothing hidden: no bare key, no `undefined`, every English key carried, `<html lang>` and `dir` right, and what JavaScript painted (a switch label, the effect list, the stage list, the top chip, a link word) in the language chosen. Found that a language pick left every string written at render time in the old language until something redrew it; `set_language()` now redraws the core's cards from the merged document and the modules from their own (98 checks) |
| `undefcheck` | the string "undefined" reaching the page | folded into `pixels.js`: nothing painted may read as a bare key, as `undefined` or as `NaN`; `t-i18n.js` asks the same of every language |
| `quietload` | anything written to the console on a cold load | DONE 2026-09-26: `t-quiet.js`, both fixtures, both themes, both widths, every page: console output of any type, page errors, requests that did not complete, responses of 400 or worse (20 checks a row) |
| `slowload`, `slowland` | a device that answers late, and one that does not answer at all | DONE 2026-09-26: `t-slow.js`, three rows. Found that a silent socket was reopened every two seconds for ever, the retry count reset on each open, so a device slower than that to send its first frame could never be used; it is reopened five times now and the sixth socket is held. Found the chip blank before the first frame and saying "waiting" over a live page on any device without `/api/print`; the chip is drawn at boot and, once the device talks, says the link's own word until the print document comes |
| `navsize`, `align`, `cursors`, `fontcheck` | the chrome's own geometry, alignment, pointer and font | DONE 2026-09-26: `t-layout.js` (the rail and the bottom bar seven entries at one size; card titles on one edge per kind and column) and `t-chrome.js` (every pressable thing shows the pointer and nothing disabled does; the embedded Roboto is loaded and honoured) |
| `marks`, `herocheck` | the artwork as it actually renders | DONE 2026-09-26: `t-chrome.js`: this theme's mark decoded and on screen with the other away, every icon pointing at a symbol the sprite carries, the theme button through its three states and back |
| `topbar` | the state dot through its transition, without racing the device's own push | DONE 2026-09-26: `t-topbar.js`: waiting, the link's word, idle, a print at a stage and a percentage, the next report, the print's end, a failed link, the socket gone; every change made through the mock and waited for. Found that the device never pushed the printer root after connect (the lamp, fans, spools and state word on the dashboard were whatever the printer had said when the page opened): `ps_printer.c` pushes it when a report changes the status, at most once a second, and the page asks for the print document on each push instead of on its idle half-minute |
| `coldstart`, `layout` | first paint, and the page's shape | DONE 2026-09-26: `t-layout.js`: the first state on screen inside 2.5 s with the top bar in place and one card active; nothing on any card wider than the screen, no sideways scroll, at 360 and 1280 in both themes |

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

- **The second of the three: the vent card on the dashboard.** Drawn only once a vent is bound
  AND talking, beside the printer's, the way the AMS card is not drawn when the printer
  describes no spools. Its state in words rather than the vent's own token, the chamber if the
  vent sent one, which way its policy is deciding, and a fault only when the vent reports one.
  Nothing in it is invented and no row is drawn for a value that has not arrived.

- **The device half, 2026-09-26**: `ps_bridge.c`, with `ps_bridge_proto.c` and `ps_sha256.c`
  as its host-tested pure parts (`bridge_test.c`, 32 assertions) and the binding in a blob of
  its own (`cfg_test.c`). The task, the socket, the mDNS record and browse, the pairing, the
  reconnects, `/api/bridge` and `/bridge/id`; bit 0 inside the known mask and in the features
  table, so the switch on the page is the device's (D-056). Writing it found the mocks would
  have greeted each other for ever on a reconnect; the contract now counts hellos and both
  mocks follow it. **Not yet spoken to a vent**: the bench job in the contract document comes
  first, against the mock vent listening on the network, before the real vent is touched.

Item 10 (the vent settings page, three firmwares) stays unwritten until each of the three
surfaces has been read the way this project reads a surface.

## The owner's list, 2026-09-26

Asked for by name, written down before any of it was started so that none of it gets lost
behind whichever one takes the longest. Each line is updated as it lands.

| # | Asked for | Status |
|---|---|---|
| O1 | While an effect is kept inside the printed part, the unfilled part runs an effect of its own (any effect that does not draw the progress), in the unlit colour, defaulting to solid, which with the unlit colour left dark is off; and, the owner's second word, beside the three progress effects too | DONE 2026-09-26, completed 2026-09-27: `fx_unlit` per state, any of the twenty-one effects that do not draw the progress, offered under the switch and beside the progress bar, the animated one and the barber pole, where it runs on the part their fill has not reached (`ps_fx_progress_lit`), D-055, D-058, `fx_test.c`, `t-inprog.js` |
| O2 | Kept inside the printed part defaults to on | DONE 2026-09-26, completed 2026-09-27: on in the factory defaults and, through the effect's `flags` byte, on once for every stored blob that predates the option, so it reaches the device this was asked for; it applies only while a job is on so an idle bar still fills, D-055, D-058 |
| O3 | The printer page shows which Bambu printer it is (the model) | DONE 2026-09-26: the printer's own SSDP model code, `printer.model` on the wire, named on the Bindings page (`N7` is the P2S; nine codes known, an unknown one is shown as itself), `t-model.js` |
| O4 | The dashboard shows the humidity inside the printer, the way it shows the AMS humidity | NOT POSSIBLE: a full report captured from the P2S on 2026-09-26 (337 distinct fields) carries humidity for the AMS only (`ams.ams[].humidity`, `humidity_raw`); the printer reports no chamber humidity, so there is nothing to show. Asked again 2026-09-26 and re-verified against the capture (46 messages, 336 field paths): the chamber block is a temperature and a state, nothing else, D-058 |
| O5 | The AMS card on a phone: two trays by two, and the material readable rather than cut after a letter or two | DONE 2026-09-26: two columns under 600px, the chip text wraps instead of being cut, `t-ams.js` G1 and G2 |
| O6 | A Celsius or Fahrenheit switch on the Settings page, Celsius by default; every temperature on the display follows it | DONE 2026-09-27: a segment on the Settings card's Appearance block, kept on the device (`temp_unit`, `config.temp_unit`, in the settings file) so every browser reads the same unit; the device holds °C and the page converts every reading and the three degree fields on the Lighting page, both ways; D-058, `cfg_test.c`, `t-units.js` |
| O7 | An empty AMS slot keeps its badge and says None; an AMS that is there but holds nothing says Empty | DONE 2026-09-27: every described slot stays in `trays`, an empty one flagged (`tray_exist_bits` when sent); `ams_units` in `status`; the badge says None, a unit holding nothing says Empty; D-061, `t-ams.js` E0a..E0f |
| O8 | A Door row on the dashboard's printer card, with an icon, open or closed, and it must be RIGHT (the vent's is wrong: it always says open) | DONE 2026-09-27: `status.door_open` from `home_flag` bit 23 (not `stat`, the vent's mistake), checked live against the printer with the door shut, logged on every change; two icons; D-061, `t-topbar.js` K1..K3 |

O1 and O2, revisited the same day: the first cut applied the default to new devices only (an
existing device's stored effects kept the bit clear, so the switch read off on the one device
this was asked for) and offered seventeen effects for the unfilled part rather than every
effect that does not draw the progress; nor was the unfilled part offered beside the three
effects that draw the progress themselves, which leave exactly that part of the bar dark.
All three fixed 2026-09-27 (D-058). From the same review: the vent scan found nothing on a
network with two vents on it, because it looked for the bridge record alone; it now finds the
factory firmware and PandaVentOS by their stock socket and says, on a bind, that there is no
bridge there yet (`link` 7). The Device name save sent the vent's key and took nothing; it
sends the hostname; and that was wrong too, reversed under D-060: the vent has a label and
an address, and so does this device now (`settings.device_name`, blob v5). Saving the label
restarts nothing; the host name's dialog says the address the device will answer at. The
Bindings page's labels and the Settings page's card spacing, both
called out from screenshots, are fixed in `project.css`, and a pass over every page by eye
afterwards (D-059) made the label and spacing rules one rule for the whole app: every
labelled field floats its label, a padded block inside a card keeps the card's rhythm, and a
note with nothing to say draws nothing.

## Catalogued elsewhere, still open

[ROADMAP.md](ROADMAP.md) holds the rest: AMS tray colour mirroring onto the bar, layer or
ETA as a ramp, Home Assistant entities, Music mode, Klipper and Moonraker. Klipper is the
one capability the vent has not matched either.
