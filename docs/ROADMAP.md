# Roadmap

**This is a catalogue, not a work queue.** Standing rule 5 holds: nothing on this list
gets built until every Phase 2 gate is green. Writing an item down is not scheduling it.

Each item carries what it does, what it depends on, and whether that dependency is
**PROVEN** or **UNKNOWN** today. PROVEN means established with evidence recorded in
`docs/`. UNKNOWN means the dependency has not been established and the item cannot be
sized, let alone built.

Nothing here is built from BIQU material. Rule 6 applies to every item on this page:
what the factory device does is a fact we may reimplement; how it does it is theirs.

---

## TIER 1. Parity plus

Things the factory hardware already does, that the factory UI exposes badly or not at
all. These are the cheapest capability gains on the device because the firmware side may
already exist.

### `settings.on`

**What it does.** An RGB on/off. Turn the bar off without changing mode, colour or
brightness, and back on to exactly what it was.

**Depends on.** Whether the firmware honours `settings.on` on receipt.

**Status: UNKNOWN, and deliberately untested.** PROVEN: the field is handled on the
inbound path, and the factory browser cannot send it because its handler body is
commented out. That means BTT shipped a control surface and disabled the UI in front of
it. What is UNKNOWN is whether the firmware still acts on it.

**How it gets tested.** After the dump, never before. Testing means sending a message
the factory UI never sends, and doing that while the unit is still stock risks the one
irreplaceable state we have. The dump is the safety net that makes the test affordable.

### `settings.follow`

**What it does.** Unknown by name. A "follow" mode whose semantics are not determinable
from the served page.

**Depends on.** Both whether the firmware honours it **and** what it means. Two unknowns,
not one.

**Status: UNKNOWN.** PROVEN: handled inbound, unreachable from the factory browser, same
commented-out handler as `settings.on`. Everything else is open. Do not guess a meaning
from the name; the device contradicts itself elsewhere on exactly this kind of inference
(see the index-2 state label in `protocol-websocket.md`).

### `settings.printing_ui_type`

**What it does.** Selects a display mode. The only shipped option is `progress_gif`.

**Depends on.** Whether other values exist and whether the firmware accepts them.

**Status: UNKNOWN.** PROVEN: the select exists, its send is commented out, and its handler
computes an index and discards it. The single shipped option hints at other modes the
firmware may still accept, but a hint is not a value. Until the firmware is read, the set
of valid values is unknown and sending a guess is a write to an unknown surface.

### Per-state brightness

**BUILT (A1, D-033).** Feature bit 1, `state_brightness`, off by default; the switch on the
System page, the three sliders on the Lighting page while it is on ([FEATURES.md](FEATURES.md)).

**What it does.** A brightness per bar state instead of one global brightness. Dim idle,
bright printing, full-brightness error.

**Depends on.** Nothing new. The state index already exists on the wire.

**Status: PROVEN dependency, and this is the most buildable Tier 1 item.** PROVEN: the
factory carries brightness per *mode* (`list2[i].brightness`, two entries) and addresses
colour per *state* (`rgb_state_index`, three states). Brightness is not addressed per
state anywhere. The mechanism to extend it already exists because state addressing already
exists; this is a config shape change on our side, not a discovery.

### Speed in Music mode

**What it does.** Make the speed control live in Music mode, where the factory UI disables
it.

**Depends on.** Whether Music mode has any rate the value could drive.

**Status: UNKNOWN, and likely blocked on something deeper.** PROVEN: the slider is
disabled in Music mode by the factory UI, and the factory reset path resets the speed
entry for index 1 only, never index 0, so the factory treats Music as having no speed
state at all. That is two independent signals that the value is meaningless there. If
Music mode is audio reactive, its rate comes from the audio and there may be no rate for a
slider to set. This item probably resolves as "correctly disabled" rather than as a
feature. Resolves with the Music renderer, which is Tier 3.

---

## TIER 2. Additive, no new hardware knowledge required

Everything here is buildable from what the protocol already establishes. None of it needs
the dump, with the two exceptions flagged inline.

### Device backup over Wi-Fi, and the flash gate

**BUILT (D-028, D-029).** `GET /backup` streams the whole flash with `X-Flash-Size` ahead of
the body, station interface only; `X-Build` on `GET /` identifies the build. The install
path is an OTA into a stock app slot gated by `tools/fw/preflight.sh`, and
`tools/fw/golden.sh` turns the endpoint into verified, read-only restore points. Required
for the first release, not a flag: a revert path that is off by default is not a revert
path ([FEATURES.md](FEATURES.md)). Still open: reading the factory's Wi-Fi credentials out
of its NVS on the clone's first boot, so the first install stays on the network; that needs
the dump to learn the layout.

### Per-stage colour

**What it does.** Give each of the 15 print stages its own bar colour, instead of
collapsing them into three states.

**Depends on.** The stage feed that already drives the GIF display.

**Status: PROVEN, and this is the single largest capability gap on the device.** PROVEN:
the display runs at 15-stage granularity while the bar runs at three states. The 15 slot
names are recorded. The firmware already knows which stage it is in, because it selects
the GIF. So the information exists inside the device and the bar simply does not use it.

**The caveat that sizes the work.** Which of the 15 actually fire on a normal job, and in
what order, is **UNKNOWN** until the Phase 0 print capture. Several are clearly AMS or
filament-change stages a single-colour print never reaches. Build against the captured
order, not against the list order.

### More than seven effects

**BUILT (A2, D-034).** Feature bit 2, `state_effects`: the engine from PandaVentOS,
seventeen effects selectable per bar state in H2D, the rest of the engine waiting on their
inputs ([FEATURES.md](FEATURES.md)).

**What it does.** Progress bar driven by real print progress, animated progress,
barber-pole stripe, temperature gradient, error strobe with configurable colour and rate.

**Depends on.** A renderer of our own, and for progress, a progress value.

**Status: mixed.** The renderer is ours to write, so that half is PROVEN-by-construction.
The progress value is **UNKNOWN**: the browser-side protocol carries no progress field, so
progress must come from the printer MQTT side, which Phase 1 has not yet read. Until then,
a progress bar has nothing to render.

**Note on counting.** "Seven effects" is the V1/V2 model and does not describe this device.
The P2 has two modes and three bar states. The comparison that matters is against two
modes, not seven effects.

### Per-effect brightness, speed and direction

**What it does.** Move brightness, speed and direction from per-state to per-effect, so
each effect carries its own.

**Depends on.** Nothing new on the wire; a config shape change on our side.

**Status: PROVEN dependency.** One caution: the factory emits two different colour formats
in `list2`, bare `RRGGBB` at index 0 and `#RRGGBBAA` at index 1. Any config reshape keeps
both and normalises neither, or Gate 2 fails.

### Multi-zone

**What it does.** Split the strip into segments with independent jobs: one for state, one
for progress, one for temperature.

**Depends on.** The block model, and the LED count.

**Status: UNKNOWN on both.** PROVEN: a `block` root exists with `blockID` and `blockrgba`,
and `blocklist` currently holds exactly one entry. What a block maps to physically, whole
bar or segment or zone, is **UNKNOWN** and is a read-only enumeration task on the Phase 0
run sheet. The LED count is **UNKNOWN** and not published; it resolves at the dump. Without
the count there is no way to compute segment boundaries, so this is gated on Tier 3's LED
count even though the rest of it is additive.

### AMS tray colour mirroring

**What it does.** Mirror the loaded filament's colour onto the bar, so the light matches
the spool.

**Depends on.** The printer MQTT client, and the AMS report.

**Status: UNKNOWN.** The printer reports loaded filament colour over MQTT; that is general
Bambu LAN behaviour, not something established here. This repo has read the browser-side
protocol only. The MQTT half is Phase 1 work and nothing about it is recorded yet.

### Layer or ETA as a ramp along the bar

**What it does.** Encode progress spatially: the bar fills as the print advances, by layer
or by time remaining.

**Depends on.** A layer or ETA value from the printer, and the LED count to map a fraction
onto pixels.

**Status: UNKNOWN on both.** Same MQTT gap as AMS, plus the LED count gap.

### Live preview with a pinned printer state

**What it does.** Pin the UI to a chosen printer state so lighting can be configured
without running a print.

**Depends on.** Our own state machine being separable from the real feed.

**Status: PROVEN-by-construction, and it is the highest-leverage development tool on this
list.** Every other lighting item is otherwise only testable during a real print, which is
a slow and non-repeatable test loop. Build this early in Tier 2 and everything after it
gets cheaper to verify.

### Render stats

**What it does.** Report frames, fps, interval and dropped pushes.

**Depends on.** Our own renderer.

**Status: PROVEN-by-construction.** Worth noting it is also the instrument that makes
Gate 5 checkable: matching the reference video on frame timing is much easier to argue
with a frame counter than by eye.

### Device log viewer

**What it does.** A live device log on its own page.

**Depends on.** A log transport. The factory has none: the protocol carries no log root.

**Status: PROVEN that it does not exist today, so this is purely additive.** It needs a new
inbound root of our own. That is a divergence from the factory surface, so it waits for the
gates like everything else.

### Plain restart, separated honestly from the two resets

**What it does.** Offer a restart as a restart, with its own button and its own wording.

**Depends on.** Nothing. The command already exists.

**Status: PROVEN, and it is a correctness fix more than a feature.** PROVEN: `reset` is a
restart, not a reset. Its only callers are the success handlers for `set_hostname` and
`set_hotspot_ip`; it has no button and is never presented to the user. Meanwhile the
button labelled as resetting settings sends `rgb_reset`, whose dialog is worded as though
it restores everything while every value it touches is lighting. Three commands, one of
them mislabelled, one of them invisible. Naming them honestly costs nothing.

### NVS hostname, live printer unbind, DHCP-move auto-rebind by serial

**What it does.** Persist the hostname; unbind a printer without a restart; when a bound
printer changes address, find it again by serial.

**Depends on.** For hostname and unbind: nothing, both commands exist. For auto-rebind: the
scan-and-match behaviour.

**Status: mostly PROVEN.** `sta.hostname` and `printer.disconnect` both exist on the wire.
Auto-rebind is partly PROVEN in an interesting way: `printer.scan` already enumerates
`sn not matched`, `ip not changed` and `new ip applied`, which means the factory firmware
already contains address-change logic. Whether it rebinds automatically is **UNKNOWN**, but
the states are evidence that the machinery is there.

### Home Assistant entity expansion

**What it does.** Expose progress, layer, temperatures and ETA as Home Assistant entities.

**Depends on.** The discovery scaffolding, and the same printer telemetry as the items
above.

**Status: UNKNOWN.** The discovery scaffolding is believed to exist in the firmware but
that belief is not yet recorded as a fact in `docs/` — Phase 1 has not read the MQTT or
Home Assistant halves. Until it has, treat the scaffolding as INFERENCE.

### Custom stage GIFs

**What it does.** Let the owner replace any of the 15 stage animations.

**Depends on.** The img OTA channel, and the GIF format the display accepts.

**Status: PROVEN channel, UNKNOWN format.** PROVEN: `POST /ota` with `OTA-Type` set to a
slot name is the upload path, and the upload surface carries a per-GIF size cap. The
format is **UNKNOWN**: the upload path has a dimension check expecting at most 240x240, but
it is disabled in shipped code, so it may describe the display or may be stale.

**The hazard that makes this last, not first.** Uploading to a slot overwrites an asset
that cannot be recovered. The 15 GIFs are unreachable over HTTP and unpublished, so the
dump is the only copy that will ever exist. No upload before the dump is verified, and
then only to a slot whose original is hashed and stored.

---

## TIER 3. Needs facts we do not have

### Anything gated on LED count

**Depends on.** The LED count.

**Status: UNKNOWN.** Not published: the vendor spec page lists the module, the board
dimensions and the power input, and no LED count. The wiki quotes a peak current figure,
but that is a loose upper bound at best and the page's own peak and standby numbers look
transposed, so it cannot be used to derive a count. Resolves at the dump, from the RMT
strip encoder configuration. Until then: multi-zone, any spatial ramp, and anything that
maps a fraction onto pixels cannot be designed, only sketched.

A physical count during Phase 0 is worth doing anyway, as a cross-check against whatever
the encoder says.

### Anything gated on flash headroom

**Depends on.** Total flash size and the partition table.

**Status: UNKNOWN, and the available numbers are actively misleading.**

The OTA size caps are **not evidence of layout**. Two independent reasons:

1. The per-GIF cap allows 15 × 1.5 MB = 22.5 MB of GIFs into a region the same upload
   surface caps at 6.875 MB. At least one of those constants is a round guard with no
   relationship to partition geometry.
2. `0x480000` appears identically in the factory V1 page, on a device whose entire
   published app image is about 1.38 MB. A constant that does not change between products
   is a shared framework value describing neither.

So the fw cap is a shared constant, not a measurement, and nothing in this repository
establishes flash size. Resolves at the dump: `esptool flash-id` gives the part size in
one command, and the partition table at offset 0x8000 gives every partition's type,
subtype, offset and size, which settles the app slot count, the real app partition size,
whether a filesystem partition holds the web UI, and whether a coredump partition exists.

Until that runs, no item can be accepted or rejected on size grounds, including the
language list below.

### Music mode reimplementation

**What it does.** Reimplement the audio-reactive mode.

**Depends on.** A microphone input, a real-time renderer, and a verification method.

**Status: UNKNOWN on all three, and it is the hardest item here.** No static config
describes it: the protocol carries brightness for Music mode and nothing else, and the
factory reset path does not even reset a speed for it. Whatever drives Music mode is not
in the configuration surface, which means it is in the renderer and only the firmware read
will show it.

**Verification is the real problem, not the renderer.** "It reacts to music" is not a
test. A repeatable audio input is required: same track, same distance, same volume, same
room, recorded alongside the bar so the light and the audio can be aligned frame by frame.
Without that rig, there is no way to tell a correct reimplementation from a plausible one,
and Gate 5 has nothing to compare against. Build the rig before the renderer.

### Klipper or Moonraker support

**What it does.** Drive the device from a Klipper or Moonraker host instead of a Bambu
printer.

**Depends on.** An abstraction between the printer client and the renderer that does not
exist yet, plus a second protocol implementation.

**Status: UNKNOWN, and furthest out.** It is not gated on a missing fact about this device;
it is gated on the clone existing first and having a seam to insert a second source behind.
Nothing about it is blocked by the dump. It is last because it is largest.

---

## LANGUAGES: a requirement, not a feature

The shipped UI is 24 languages. This is a constraint on every page that is built, not an
item to schedule.

### The rules

- **Every key name is minted by this project**, from this project's own pages. Nothing
  inherited from any other project or vendor, including earlier projects of Jeremy's.
- **Every English value is written for this project.**
- **Translations are produced from our own English**, which is what makes them our own
  work rather than a derivative of someone else's table.
- **No vendor key, no vendor English string, no vendor translation, and no vendor
  misspelling ever appears.**
- **The string table gets a spell check as a residue check.** A shared misspelling is the
  fingerprint that proves copying: independent authors do not arrive at the same typo.
  A spell check over the English table is therefore not a quality pass, it is a
  provenance test, and it is the cheapest one available.
- **RTL support for Arabic**, and for Hebrew if it is included. The whole layout mirrors,
  not only the text direction.
- CJK needs its own font subset handling. See the budget below.

### The numbers

**Source and its limits.** There is no measured string table for this project yet, because
it has not been written. The numbers below are scaled from a **measured analogue**: a
24-language, 402-key table from a comparable single-page ESP32 firmware UI. They are the
right order of magnitude and they are not measurements of this project. Re-measure once
the English table exists.

Per-language raw JSON, 402 keys, grouped by script:

| Script group | Languages | n | Total | Mean per language |
|---|---|---:|---:|---:|
| Latin | en es fr de it pt nl pl id fil vi | 11 | 257,820 B | 23,438 B |
| CJK | zh ja ko yue | 4 | 94,103 B | 23,525 B |
| Cyrillic + Greek | ru uk sr el | 4 | 132,982 B | 33,245 B |
| RTL | ar | 1 | 28,920 B | 28,920 B |
| Indic + Thai | hi bn pa th | 4 | 162,199 B | 40,549 B |
| **All 24** | | **24** | **676,024 B** | **28,167 B** |

Compressed, using a gzip ratio of 0.322 measured on a comparable whole page, and 0.25 as
the better-case figure a pure JSON table should reach:

| | Raw | Gzipped at 25% | Gzipped at 32% |
|---|---:|---:|---:|
| English only | 21,197 B | 5,299 B | 6,825 B |
| All 24 languages | 676,024 B | 169,006 B | 217,679 B |
| **Cost of the other 23** | **654,827 B** | **~164,000 B** | **~211,000 B** |

**The headline number: about 165 to 215 KB gzipped for 24 languages, against about 6 KB
for English alone.** The language tables are the largest single component of the page, by
a wide margin, and they are roughly 30x the cost of shipping English only.

Note the counter-intuitive row: CJK is **not** the expensive group. Its mean is the same
as Latin, because CJK says more per character and the 3-byte UTF-8 encoding is offset by
needing far fewer characters. Indic and Thai are the expensive group at 40 KB mean, 73%
above Latin. If the list is ever trimmed for size, that is where the bytes are.

### CJK font subsetting, and the number you asked for

**I cannot give you a flash budget, and that is the answer.** The numerator is estimable;
the denominator is unknown. Total flash size is not established anywhere in this repo, and
the OTA caps do not establish it. Any statement of the form "the language tables cost N%
of available flash" would be invented. That resolves at the dump and not before.

What can be said about the font side:

- A comparable project embedded five Latin, Cyrillic, Greek and Vietnamese subsets for
  about **128 KB of woff2**, covering its entire non-CJK language set.
- CJK is a different problem in kind. A full CJK face is megabytes and is not embeddable
  on a device in this class. The only viable approach is a **subset containing exactly the
  glyphs the string table uses**, generated from the table as a build step so it cannot
  drift out of step with the strings.
- For a 402-key table across four CJK languages, the distinct glyph count is plausibly in
  the high hundreds to low thousands. At woff2 densities that is roughly **25 to 60 KB per
  CJK script**, so perhaps **50 to 150 KB** for the CJK group. **That range is an estimate,
  not a measurement.** It is measurable cheaply and exactly once the English table and its
  translations exist: generate the subset, measure the file. Do that before committing to
  the language list.
- The fallback, which costs zero bytes, is to embed no CJK face and let those languages
  fall through to the reader's own system font. A phone or desktop that displays Chinese
  already has a Chinese font. This is what the comparable project did for every language
  outside its five embedded subsets, and it is the right default until flash size is known.

**Rough total, clearly labelled as an estimate:** 165 to 215 KB gzipped for the tables,
plus 128 KB for non-CJK fonts, plus 0 to 150 KB for CJK fonts depending on the
subset-versus-fallback decision. Call it **300 to 500 KB** of the served page devoted to
internationalisation. Against a served page that the factory keeps at 278,771 bytes total,
that is the single biggest architectural decision on this list.

### Is splitting the tables out of the first load worth it?

**Yes. It is deferred by rule 5, not blocked by Gate 1, and it gets designed for now even
though it is not enabled now.**

PROVEN: the factory device serves **exactly one document**. `GET /` returns the page and
`POST /ota` accepts an upload; every other path tried returned a 302 redirect to the
captive portal, across 15 probes. There is no second route.

**What that does and does not mean.** It means the factory has no mechanism to fetch a
language table separately. It does **not** mean our clone is forbidden from adding one.

Gate 1 is an **equivalence** rule: every control the factory UI exposes is present and
reaches the device with the same wire message. Adding a `GET` route that serves a language
table adds no control, removes no control, and changes no wire message. **It does not fail
Gate 1.** An earlier draft of this section claimed it did; that was an over-read of the
gate, and the distinction matters for the next paragraph.

What defers the split is **rule 5**: no customization until every Phase 2 gate is green.
That is a scheduling rule. So the split is a Tier 2 item waiting its turn, not an
architectural impossibility, and the reason it waits is the calendar rather than the gate.

Consequences, in order:

1. **The first build carries all languages in the single document.** Not because a split
   would fail a gate, but because rule 5 puts it after the gates.
2. **When it is done, the win is large.** This is close to the best possible case for lazy
   loading: one language is needed per viewer, 24 are shipped, the tables are the largest
   component, and the selected language is known before the page needs any string. Serving
   one table instead of 24 removes roughly 160 to 210 KB from first load.
3. **It may not be optional.** If the dump shows tight flash, carrying 24 tables in the app
   image may simply not fit, and the split stops being an optimisation and becomes a
   requirement. That is the single question the dump answers that most changes this page.

### Architectural note: design for the split now, enable it later

Because point 3 can turn the split from a nice-to-have into a requirement, the page build
is designed for it from the first line, and **this is a design constraint rather than a
feature on the list.**

**The rule: the language tables reach the page through exactly one seam.** One place in the
build decides whether a table is inlined into the document or fetched at runtime, and one
place in the page asks for a table without knowing which of those happened. Nothing else in
the page touches the tables directly.

With that seam in place, switching from inline to fetched is a build flag and a route. The
string lookup does not change, the key names do not change, no page markup changes, and no
control changes. Without it, the same switch is a rewrite of every call site that reads a
string, in a page where the string table is the largest component.

**Designing for it costs nothing today.** Routing table access through one accessor is what
a reasonable implementation does anyway; it is the shape that makes the runtime fallback
chain, the RTL handling and the spell-check residue pass possible in one place as well.
**Retrofitting it later costs a lot**, and it would be retrofitted under the worst
conditions: after the dump has just revealed that the tables do not fit, with the gates
already passed and the page already written.

So: build the seam in the first implementation, ship it inline, and leave the fetched path
unbuilt behind it until rule 5 releases it or the flash budget forces it.

**The order that follows from all of this:** write the English table first, measure it,
generate the CJK subset and measure that, and only then choose the language list. Choosing
24 languages before measuring is choosing a number before knowing its cost.
