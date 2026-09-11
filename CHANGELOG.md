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

### Features, each behind a switch that defaults off

- The clone's own JSON route, `/api/features`: the page discovers a clone by its 200 where
  the factory answers 302, and shows a Features card on the System page only then. The
  socket document stays the factory's (D-033).
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

- Eight pages speaking the factory wire protocol frame for frame: dashboard, lighting,
  images, printer, network, system, logs, setup.
- Both themes as Material 3 token pairs; phone and desktop layouts; a contrast harness
  over every page in both.
- Twenty-five languages, validated against English on every build; Arabic and Hebrew
  right to left.
- An event log in the page with credentials replaced by their length before storage.
- Vendored Beer CSS 5.0.3, Coloris 0.25.0 and ten Heroicons 2.2.0, each gated by sha256.

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
  station and hotspot, the RMT strip driver, a placeholder renderer, OTA for firmware
  and animations with rollback, and the printer's MQTT link.
- A partition table generated from one number and marked PROVISIONAL until a unit's
  flash has been read.

### The tools

- A mock device with knobs for every lie a device can tell, and a wire harness that
  proves the mock before any page trusts it.
- Page harnesses that drive every control and assert the exact frame the device
  receives; a resilience harness with one lie per row; thirty-five sweep rows in all.
- A pre-commit hook that keeps secrets and the vendor's expression out, with a
  57-case suite; a residue sweep over the tracked tree.
- Tools to capture the printer's MQTT report stream and redact it, not yet run against
  a printer.

### Documentation

- The restore document written before the first install; the pre-flash gate; the
  decisions log (D-001 onward); the roadmap; this set.
- The publishing checklist, which gates the flip from private to public. Its history
  checks are the load-bearing part: every commit ever pushed becomes visible that day.
