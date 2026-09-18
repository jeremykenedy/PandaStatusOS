# Changelog

## Unreleased

Everything so far. No release has been made and no device has been flashed.

### The name

- The project is PandaStatusOS (D-027). The firmware image reports it in `esp_app_desc`
  and builds as `pandastatusos.bin`; the page's title and brand say it. The hardware is
  still BIGTREETECH's Panda Status P2 wherever it is named. The product name is a token
  in every string table, filled in by the page, never translated.
- The hotspot's default name is a placeholder pending the bench session; the factory's
  own name is a parity fact, not a branding choice.
- A device with no configuration calls itself `status` and advertises itself over multicast
  DNS, so `http://status.local` reaches it (D-046, D-047). A name typed with `.local` on the
  end has it stripped, because the name is one DNS label and the domain is the responder's to
  append; the sanitiser runs on the way in and again on the way out, and is host-tested.
- The first run works the way the sibling project's does (D-047). The hotspot names itself from
  the device's own MAC and keeps the name, so two units are never the same network. It carries
  a password by default rather than standing open. Joining it opens the setup page by itself:
  the device answers DNS for its own hotspot, so a phone's connectivity check is redirected into
  the 302 that was already there, and the captive sheet gets seven kilobytes of plain HTML it
  can actually render instead of the megabyte application, with the full interface one link away.
- Two defects in that same path, fixed with it: the scan-done handler put sixteen scan records
  on the event task's small stack, which overflows it, and a scan in APSTA with the default dwell
  dropped the WebSocket of the page doing the scanning.

### Found by running it on the hardware

- `GET /api/state` was handing the Wi-Fi password, the hotspot password and the printer's
  access code to anyone who could reach port 80, with nothing asked of them. The socket carries
  those because the factory's socket does and the page's fields are filled from that push; this
  route is the clone's own addition, so a second and easier copy of a secret was a second place
  to lose it. The three fields now come back empty and keep their shape. The printer serial
  stays, because it is on a sticker and the printer broadcasts it to the whole network itself.

- The page kept saying the connection was lost. The socket pool was the IDF's default of ten
  and the demand is at least thirteen: the page server's eight, the captive portal's DNS
  listener, two for printer discovery, the multicast responder and the printer's MQTT link.
  The pool was raised in `sdkconfig.defaults`, but that file only seeds a *fresh*
  configuration and the generated `sdkconfig` already existed, so the change had never taken
  effect. Regenerating it applied exactly three settings and lost nothing.
- Switches showed the word inside them. Beer CSS draws checkboxes, radios and switches with
  Material Symbols ligatures, `content:"check"` and `content:"radio_button_checked"`; this
  project ships Roboto and no icon font, so the browser printed the ligature name. All three
  controls are drawn here now with a border and a gradient, which costs nothing and adds no
  second font to a page already over a megabyte.
- The left rail and the top bar are one surface. Beer gives the rail `--surface` and the bars
  `--surface-container`, which met at a visible seam in both themes.
- The screenshots in the README are from the running device, and the mock disclaimer is gone.
  Every identifier is replaced before the shutter.

- Printer discovery works. A printer announces itself over SSDP multicast and the device now
  listens for it continuously, so Scan lists what is actually on the network: name, address and
  serial. Selecting one fills all three and leaves the caret in the access code, which is the
  one field no printer broadcasts. The parser is pure and host-tested against the real
  datagrams, including the DLNA servers that share the same multicast group and must not be
  mistaken for printers (D-048).
- Every route is registered. httpd's handler cap defaults to eight, this server has
  twenty-two, and a registration past the cap is refused rather than fatal. Nobody checked the
  result, so the last fourteen routes were dropped on every boot: the three wildcards went
  first, which is why a phone's captive probe met a 404 instead of the redirect that opens the
  setup page, and the whole features, presets, stages, config and restart API answered 404 on
  hardware while passing against the mock.
- The USB recovery tool asked esptool which spelling it speaks, instead of assuming. esptool v4
  uses underscores and v5 hyphens, the two are not interchangeable, and the installed one is
  v4: every call in the tool that exists for a device that will not boot would have failed on
  its first line. The restore document also stopped claiming both spellings work.

### Found by using it

- The dashboard says what the printer is actually doing. The report carries more than the
  six roots do, and it is all on the page now: both fan speeds and the chamber fan, the
  nozzle fitted and its diameter, whether filament is loaded, the fault code, the
  printer's own signal strength, the print stage by name, and the speed level. The chamber
  temperature comes from the report's own ctc block, which is where that printer puts it.
- The AMS has a card: humidity as a bar and a percentage where the printer gives a real
  one, its temperature, and a chip per spool showing the material and the colour the
  printer reports, with the loaded one ringed. A slot the printer describes as empty is
  not drawn, because an empty chip is not information.
- The printer's chamber light is a control, not a reading. It reports its own state and
  the switch follows it; the work light is read and not published, because the printer
  names that node whether the lamp exists or not.
- Each bar state's row carries a button that holds the bar at that state for fifteen
  seconds, on the unit, with nothing to set first. Same route and same clock as the
  preview card below it, so whichever state is live is the one wearing the fill.
- The hot warning watched the nozzle at 50 °C by default, which is true for the whole of
  every print: the warning layer ran over the progress bar for hours and read as the bar
  being broken. It watches the chamber now.
- The wall of cards is multi-column again. As a grid the dashboard stood open with five
  hundred pixels of nothing beside the printer card, because a grid row is as tall as its
  tallest member. What had made multicol overlap was never the spanning card, it was a top
  margin that collapses across a column break.
- A phone no longer cuts anything off. The Current print strip wraps instead of being
  clipped at the card's edge, the top bar can shrink below the width of everything in it,
  a list row's value wraps rather than pushing its own label out, and the humidity bar
  narrows below 360px so the word beside it can be read.
- `PS_FEAT_KNOWN` was a literal that stopped at bit 19 while C9 took bit 20, so a settings
  file exported from a device with the fixed address on was refused whole on import. The
  mask is derived from the highest bit and the host test fails if a bit falls outside it.
- The Logs page showed the IDF's own colour escapes as text on every line. They come out
  on the way in.

### Features, each behind a switch that defaults off

- C9, a fixed address, behind `static_ip`: an address, mask, gateway and DNS of this
  device's own on the house network instead of whatever DHCP hands out, applied at boot
  and before every association, in a blob of its own beside the config. Turning it off
  puts the DHCP client back without a restart.

- The clone's own JSON route, `/api/features`: the page discovers a clone by its 200 where
  the factory answers 302, and shows a Features card on the Settings page only then. The
  socket document stays the factory's (D-033).
- C8, fault codes on the bar behind `diagnostics`: amber for the network, blue for the
  printer, a count of blinks for the reason, replacing what the bar would otherwise show
  while the fault holds; the codes are in the troubleshooting document (D-045).
- C7, find the printer again after it moves, behind `auto_rebind`: three consecutive
  transport failures start a scan, and a hit carrying the bound serial at a new address is
  saved and bound, reported through the wire's own scan states. The decision is pure and
  host-tested; discovery was the one open hole until D-048 closed it.
- C5 and C6 recorded as met by parity: the hostname is stored and applied without a
  switch, and `printer.disconnect` unbinds live without a restart.
- C4, a plain restart behind `restart`: `POST /api/restart` and a Restart button on the
  Settings page, named what it does and erasing nothing (D-043).
- C3, the settings as one file, behind `config_io`: export everything stored except the
  three passwords, import the same document whole or refused, every client pushed the
  result; Export and Import on the Settings page (D-042).
- C2, the JSON API as one surface: `GET /api/info` (identification, no network name or
  credential) and `GET /api/state` (the six-root document over HTTP), answered by every
  clone; `docs/API.md` documents every route and the rules they follow; an API harness
  runs twice in the sweep, as the factory and as the clone (D-041).
- B3, the stage-aware preview: the pin takes a print stage as well, so every per-stage
  row can be seen without a print; a stage select in the preview tile.
- B1 and B2, effects per stage with inheritance, behind `stage_effects`: fifteen rows,
  one per display slot, each a named effect copied in or the bar state's effect when
  unset, in their own blob; the stage from the printer's report by an INFERENCE table
  (D-040).
- A14, the named effects, behind `presets`: an editor that saves an effect with its
  colours as stops, timing and direction under a name, eight of them in their own blob,
  and copies one into any state; two palette effects that lay the colours across the bar,
  still and scrolling (D-039).
- A13, the live preview, behind `preview`: `POST /api/preview` pins the bar to a chosen
  state, progress and temperatures for up to ten minutes so a setting can be seen without
  a print; nothing is stored, and the route answers 302 while the switch is off (D-038).
- A12, the error flash, behind `error_flash`: a strobe of one colour at its own brightness
  and rate over whatever the bar shows while the printer reports an error, in both modes,
  drawn above the hot warning.
- A11, the hot warning, behind `hot_warning`: the first layer, a pulse of one colour over
  whatever the bar shows while the nozzle, bed or chamber is at or past a threshold, in
  both modes (D-037).
- A10, the temperature gradient, behind `fx_temp`: one colour between the unlit and the
  lit colour, following the nozzle, bed or chamber temperature between two configurable
  ends; the three temperatures from the report reach the engine. The config blob moves to
  layout v4, which also carries the fields for the hot warning and the error flash (D-036);
  v1 to v3 migrate.
- A6 to A9, the effects that read the print, each behind its own switch: the progress
  bar, the animated progress, the barber pole with its band width, and the colour ramp
  across the print by hue; the print percentage from the report reaches the engine.
- A5, the brightness ramp: each cycle the brightness sweeps from the effect's own value
  to a second one, behind `effect_ramp`, for the effects that set it.
- A4, the effect's own brightness, speed and direction as one setting, behind
  `effect_params`; the factory's sliders and the per-state brightness step aside for
  effects while it is on.
- A3, effect colours: each effect's own lit and unlit colours, each for printing and for
  otherwise, behind `effect_colours`; the resolve that decides what every bit takes over
  from the factory now lives in the engine and is host-tested.
- A2, an effect per state: the effect engine (Jeremy's, from PandaVentOS, pure C and
  host-tested) behind the `state_effects` switch; in H2D each state runs one of seventeen
  effects in its own colour. The config blob moves to layout v3; v1 and v2 migrate.
- A1, per-state brightness: one brightness for idle, one for printing, one for error, in
  each mode, on the Lighting page while the switch is on. The config blob moves to layout
  v2 with a v1 migration proven by the host test.

### The artwork

- Jeremy's drawn icon set lands as project source (`tools/ui/src/icons/`), normalised on
  import so it themes with `currentColor` and carries no export furniture; three stage
  icons drawn by a committed generator; every print stage, the Printer destination and
  the printer itself now show their icons. Heroicons stay for generic chrome (D-031).
- The family mark: Jeremy's panda face over the light bar, generated with the favicons
  and the touch icon (D-030); the README banner generated from the page's own tokens.
- The residue sweep gains a hygiene check for unprocessed SVG exports.

### The page

- Seven pages speaking the factory wire protocol frame for frame, plus the first-run page:
  dashboard, lighting, printer, Wi-Fi, hotspot, settings, logs, setup. The stage images,
  the network and the system pages of the first arrangement are cards on those now.
- Both themes as Material 3 token pairs; phone and desktop layouts; a contrast harness
  over every page in both.
- Twenty-four languages, validated against English on every build, with the build counting
  how many of each table's values are still identical to English; Arabic right to left.
- An event log in the page with credentials replaced by their length before storage.
- Vendored Beer CSS 5.0.3, iro.js 5.5.2 and ten Heroicons 2.2.0, each gated by sha256.
  Coloris 0.25.0 was the colour picker before iro.js and is vendored, unused, with its
  licence.

### The flash safety protocol

- The first install is an OTA into a stock app slot over the network; nothing in the
  repository writes the bootloader or the partition table, or erases the chip (D-028).
- `tools/fw/preflight.sh`, the gate every flash path calls first: eight checks on the
  stock dump, no override. `tools/fw/ota-install.sh` proves a flash landed by build id
  and served page instead of trusting a 200. `tools/fw/golden.sh` takes, verifies and
  records full flash images, read-only files, never overwritten. `tools/fw/usb-app-write.sh`
  for a device that will not boot: one slot, the offset read from the dump.
  `tools/fw/partitions_from_dump.py` builds the clone against the stock table.
- `GET /backup` in the firmware: the whole flash over Wi-Fi, `X-Flash-Size` ahead of the
  body, station interface only (D-029). `X-Build` on `GET /`.
- A test suite for all of it against a synthetic image and the mock (`make test-flash-tools`).
- `firmware/SAFETY.md` rewritten as a gate, leading with the Panda Vent outcome that is the
  reason for it; `backups/RESTORE.md` Part B separates the three restores.

### The firmware

- ESP-IDF v5.3.1 project for the ESP32-C3: config blob with a pinned layout and host
  tests, the state document and inbound dispatcher, the HTTP and WebSocket server, Wi-Fi
  station and hotspot, the RMT strip driver, an effect engine of twenty-four effects with
  a solid placeholder for Music mode alone, OTA for firmware and animations with rollback,
  and the printer's MQTT link.
- A partition table generated from one number and marked PROVISIONAL until a unit's
  flash has been read.

### The tools

- A mock device with knobs for every lie a device can tell, and a wire harness that
  proves the mock before any page trusts it.
- Harnesses that drive every control and assert the exact frame the device receives, one
  per card behind a switch, plus the wire, the API as factory and as clone, the rebind
  decision and contrast in both themes at both widths: thirteen sweep rows, 404 checks.
- A pre-commit hook that keeps secrets and the vendor's expression out, with a 69-case
  suite; a residue sweep over the tracked tree.
- Tools to capture the printer's MQTT report stream and redact it, not yet run against
  a printer.

### Documentation

- The restore document written before the first install; the pre-flash gate; the
  decisions log (D-001 onward); the roadmap; this set.
- The publishing checklist, which gates the flip from private to public. Its history
  checks are the load-bearing part: every commit ever pushed becomes visible that day.
