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

### The page

- Eight pages speaking the factory wire protocol frame for frame: dashboard, lighting,
  images, printer, network, system, logs, setup.
- Both themes as Material 3 token pairs; phone and desktop layouts; a contrast harness
  over every page in both.
- Twenty-five languages, validated against English on every build; Arabic and Hebrew
  right to left.
- An event log in the page with credentials replaced by their length before storage.
- Vendored Beer CSS 5.0.3, Coloris 0.25.0 and ten Heroicons 2.2.0, each gated by sha256.

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
  receives; a resilience harness with one lie per row; thirty sweep rows in all.
- A pre-commit hook that keeps secrets and the vendor's expression out, with a
  57-case suite; a residue sweep over the tracked tree.
- Tools to capture the printer's MQTT report stream and redact it, not yet run against
  a printer.

### Documentation

- The restore document written before the first install; the pre-flash gate; the
  decisions log (D-001 onward); the roadmap; this set.
- The publishing checklist, which gates the flip from private to public. Its history
  checks are the load-bearing part: every commit ever pushed becomes visible that day.
