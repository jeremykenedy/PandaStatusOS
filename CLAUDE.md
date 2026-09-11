# PandaStatusOS: Panda Status P2 Factory Clone

Clean-room reimplementation of the BIGTREETECH Panda Status P2 firmware, written from
the observed behaviour of a stock unit. New project. Unrelated to PandaVent or
DragonVent.

Repo is intended to be public.

Not affiliated with, endorsed by, or supported by Shenzhen BIGTREE Technology Co., Ltd.,
BIQU or BIGTREETECH. This is a reimplementation, not a modification of their firmware.
"Panda Status" is their product name, used here only to identify the hardware this runs
on. Bambu Lab, AMS and P2S are Bambu Lab's.

## STANDING RULES

These are not defaults. They are not overridable by good intentions. They apply from
message one of every session.

### Rule 0. Flashing requires explicit per-message authorization.
Nothing is flashed unless Jeremy says so in that message, with the cable connected.
A first install over stock cannot self-revert. The full flash dump is the only revert
path. No "I'll just flash to test." No flashing implied by an earlier yes.

### Rule 1. Nothing is pushed without Jeremy saying push.
No `git push`. No remote add. No PR. No release.

### Rule 2. Secret hygiene. The repo is public.
- Scan for secrets before every commit. The pre-commit hook enforces this, including
  inside gzip members.
- The NVS partition contains live Wi-Fi credentials. It never enters the repo, not
  even gitignored. It lives outside the repo entirely.
- Flash dumps live outside the repo entirely, at /Users/jeremykenedy/backups/PandaStatus/.
  Not in .claude/work/. Not in private/.
- Anything committed to docs/ is scrubbed of credentials, MAC, and serial first.
- Confidential values live in .claude/work/secrets/ and are referenced in docs/ by
  name only, never by value. Example: write `<WIFI_SSID>`, never the SSID itself.

### Rule 3. Never credit Claude.
All commits are authored `Jeremy Kenedy <jeremykenedy@gmail.com>`. One n in Kenedy.
No Co-Authored-By. No "Generated with". No AI attribution anywhere in the repo,
commit messages, or docs.

### Rule 4. Working files never get committed.
All working files, notes, scratch output, and anything confidential live in
`.claude/work/` and are never committed.

```
.claude/work/notes/      running notes, findings, decisions
.claude/work/scratch/    throwaway scripts, disassembly output, diffs
.claude/work/secrets/    Wi-Fi creds, MAC, serial numbers, printer access code, tokens
.claude/work/analysis/   extracted strings, symbol maps, offset tables
```

`private/` is the second gitignored area, for things that are working material rather
than secrets: the page build system, the harnesses, and factory reference material.

The pre-commit hook hard fails if any path under `.claude/work/` or `private/` is
staged. The hook is committed. Its output is not.

### Rule 5. Factory parity is the default. Features live behind flags that default off.
**Amended 2026-09-10, authorized by Jeremy for the autonomous run.** The original rule
forbade all feature work until every Phase 2 gate passed. The amendment:

- **Factory parity remains the DEFAULT configuration.** Out of the box the clone behaves
  like the factory application. A fresh device, a factory-reset device, and a device with
  no config all land on parity.
- **Every feature beyond parity sits behind a config flag that DEFAULTS OFF.**
- A feature may be built, tested against the mock, documented, and committed. It may not
  change default behaviour, and it may not be enabled by anything other than the owner
  turning its flag on.
- **The gates still exist and still must pass.** A feature that breaks a gate is a bug in
  the feature, not a reason to move the gate.
- No "while I'm in here." A feature is a feature; it gets its own flag, harness, docs
  entry, i18n keys and commit.

`docs/ROADMAP.md` is the catalogue of what may be built. `docs/FEATURES.md` records every
flag, its default, and its dependencies.

### Rule 6. No BIQU material ever enters this repository.
No BIQU or BIGTREETECH code, assets, strings, branding, translations, artwork, icons,
or anything derived from them. Not temporarily. Not gitignored. Not on a branch. Not
in a commit that is later amended.

- Factory reference material lives **outside the tree**, under
  /Users/jeremykenedy/backups/PandaStatus/.
- Interface facts are not material: field names, message roots, enum values, wire
  shapes, stage names, endpoint paths, header formats, published file sizes, offsets
  and sha256 values may be recorded, because they are facts about an interface rather
  than expression.
- Their expression is material: their source code, their comments in any language,
  their UI copy, their i18n keys paired with their values, their identifiers quoted as
  code, their artwork.
- Every behavioural finding is restated in this project's own words. Keep the finding,
  never the lines that implement it.
- A shared misspelling is the fingerprint that proves copying. If one appears, it is a
  defect, not a coincidence.

### Rule 7. The string table is this project's own work.
The UI ships in 24 languages. English is the only hand-authored table; every other
language is translated from our English.

- Every key name is minted by this project, from this project's own pages.
- Every English value is written for this project.
- No key name, no English value and no translation is inherited from any other project
  or vendor, including any earlier project of Jeremy's.
- The table gets a spell check as a residue check, because a shared misspelling is
  evidence of copying.

### Rule 8. Our element IDs and class names never use the `id_` or `c_` prefixes.

The factory page names things `id_*` and `c_*`. Those two prefixes are therefore a
reliable signal of their material, and the residue checks treat both as **absolute**: any
`id_`-prefixed or `c_`-prefixed token anywhere in the tracked tree is a failure, with no
allowlist and no exemption.

That only stays true if our own markup never uses them. So the convention is decided now,
before the page exists:

| Thing | Convention | Example |
|---|---|---|
| element ID | `ps-<area>-<control>` | `ps-light-brightness`, `ps-net-ssid` |
| CSS class | `ps-<block>`, `ps-<block>-<part>` | `ps-card`, `ps-card-header` |
| data attribute | `data-ps-<name>` | `data-ps-str` for a translated node |
| JS global, if one is unavoidable | `PS_<NAME>` | `PS_STRINGS` |

**Hyphens, not underscores, and a two-letter project prefix.** That is not a style
preference: `ps-` cannot match `\bid_[a-z]` or `\bc_[a-z]` under any circumstance, so the
two checks stay absolute forever without anyone having to think about it.

**Do not add our own names to an allowlist instead.** An allowlist that grows every time a
control is added is a check that decays to nothing, and a decayed check is how the factory's
element IDs reached a commit in the first place. Adopting a convention costs nothing today
and removes the need for the exemption permanently.

### Rule 9. Zero device contact during an unsupervised run.
**Added 2026-09-10 for the autonomous run, authorized by Jeremy.** When Jeremy is not
present to supervise, the hardware is off limits entirely, including read-only operations:

- Do not connect to the Panda Status device by IP or by hostname.
- Do not run the WebSocket logger, the config reader, the UI fetcher, or the MQTT capture
  against real hardware.
- Do not touch USB. Do not touch the printer. Do not touch the Panda Vent.
- Everything is built and tested against the mock device, and nothing else.

Rule 0 already forbids flashing without per-message authorization. Rule 9 extends that to
every byte in either direction while nobody is watching. A read that goes wrong
unsupervised cannot be stopped, and the bench session is one-shot.

### Rule 10. Decide, record, continue.
**Added 2026-09-10 for the autonomous run, authorized by Jeremy.** When an unsupervised
run hits ambiguity it does not stop. It makes the call, writes it to `docs/DECISIONS.md`
with the reasoning and whether the decision is cheap or expensive to reverse, and keeps
going.

A decision recorded and wrong is recoverable in the morning. A night spent blocked is
not. The only things that stop an unsupervised run are Rules 0 through 9.

Every entry in `docs/DECISIONS.md` carries: the date, what was decided, the alternatives
considered, why this one, the reversal cost, and what evidence would change it.

## PHASES

Each phase ends with a STOP and a report. The next phase does not begin until Jeremy
says go.

### Phase 0. Back up and prove the restore path.
Nothing else happens until this is done.

- a. Record the stock unit on video. This is the only chance to capture stock
     behaviour while the unit is factory. The P2's surface is:
     - **Two modes**, Music and H2D, selected by `settings.current_mode`.
     - **Three bar states**: idle, printing, error, addressed by `rgb_state_index`.
     - **Brightness** 0..100 step 5, default 50, live in **both** modes.
     - **Speed** 0..100 step 5, default 100, live in **H2D only**; the slider is
       disabled in Music mode.
     - **15 stage GIFs** on the display, driven by print stage, not by bar state.
     Capture: each mode; each of the three bar states; brightness at 0, 25, 50, 75,
     100 in both modes; speed at 0, 25, 50, 75, 100 in H2D; and every GIF stage that
     fires during one short print, in the order it occurs.
     Saved to `backups/reference-video/`. The run sheet is
     `backups/stock-capture-runsheet.md`.
- b. Identify hardware. esptool chip_id, flash_id, flash size, MAC. The product is
     confirmed P2 from the device's own served UI; the chip has **not** been confirmed
     off silicon. Flash size is unknown and no number in this repo establishes it.
- c. Full flash dump, offset 0 through full flash size, to
     `/Users/jeremykenedy/backups/PandaStatus/stock-full.bin`. Outside the repo.
- d. Second dump to a different filename. sha256 both. They must match. If not, dump
     again until two consecutive reads agree. Never proceed on a single read. The img
     partition gets the same rule as the app.
- e. Parse the partition table from the dump. Dump each partition to its own file.
     Record offsets, sizes, sha256 for every one. Write `backups/SHA256SUMS` and
     `backups/RESTORE.md` with the exact esptool write_flash command that restores
     this state, every offset spelled out.
- f. Verify the extracted app image parses: 0xE9 magic, segment count, esp_app_desc
     at 0x20, project name, version, IDF version, build date. Print them.
- g. Download published reference binaries. They are app images only, no bootloader
     and no partition table, so they are a reference and NOT a restore path. All
     published images are V1/V2; none is a P2 restore path. Diff the dumped app
     against them and report any match. They stay outside the tree.

The 15 GIF assets plus the firmware are the entire irreplaceable surface of this
device. None of the GIFs is reachable over HTTP and none is published anywhere. Each
slot gets its own sha256 and its own line in `RESTORE.md`. `settings.img_version` is
recorded before the dump starts.

### Phase 1. Recover the factory application. Static analysis only.
- Derive DROM and IROM vaddr to file offset mapping from image segment headers.
  Do not hardcode a base address. Confirm against at least four independent string refs.
- Locate the web UI in the image: check for an embedded, compressed blob first, then
  any spiffs, littlefs or fatfs partition. It is **reference material** and stays
  outside the tree under Rule 6. What comes back into `docs/` is the interface it
  implies, never its bytes.
- Recover the protocol surface: the printer MQTT client, the Home Assistant discovery
  topics, and what the web UI speaks. `docs/protocol-websocket.md` already enumerates
  the browser-side surface from the served page: 6 outbound roots, 8 inbound roots, the
  `device_wakeup` envelope, 5 enums, and the three reset commands. Phase 1 confirms
  that against the firmware and adds the MQTT and Home Assistant halves.
- Pin the renderer. Target is ESP32-C3, so use riscv32-esp-elf-objdump or Ghidra with
  the RISC-V loader, not a blind scan. What to recover, against the real device model:
  - How **Music** mode drives the bar. It is audio reactive and no static config
    describes it. Expect a real-time path with a microphone input.
  - How **H2D** mode maps the three state colours onto the strip, and what the speed
    value 0..100 actually controls there.
  - The **two colour formats** the device emits in `list2`: index 0 bare `RRGGBB`,
    index 1 `#RRGGBBAA`. A clone reproduces both and normalises neither.
  - The **15 stage GIF** mapping: which print stage selects which slot, and how the
    bar behaves across stages that share a bar state.
  - The **LED count**, which is unknown and not published. Expect it from the RMT
    strip encoder configuration.
- Read factory defaults off the live device using the factory app's own reset commands.
  The reset ladder in the run sheet does this in ascending order of destruction, with a
  full config read between each rung. Record in a table.

Everything recovered goes to `docs/` with the evidence for each fact. Anything not
proven is marked INFERENCE, not fact.

### Phase 2. Build the clone. ESP-IDF v5.3.1 to match the factory build.
Gates. All must pass before any customization. Each is reported pass or fail
individually. A partial is never reported as a pass.

1. **Functional equivalence of the UI.** Every control the factory UI exposes is
   present in the clone and reaches the device with the same wire message. Verified by
   a harness that asserts **what the device receives**, not how the page looks: for
   each control, drive it and assert the exact JSON frame on the wire, including the
   `device_wakeup: 1` envelope. Not pixel identity. Not their file. Controls that are
   dead in the factory UI send nothing, so there is nothing to match; they are recorded
   as dead and left dead until every gate is green.
2. Clone's state document, seeded from the device, is exactly equal to what the device
   emits.
3. Clone's compiled-in defaults are exactly equal to what the device reports after its
   own factory reset. Zero differences.
4. Every inbound message shape handled.
5. Bar behaviour matches the Phase 0 reference video: both modes, all three states,
   the brightness and speed sweep points, and the GIF stage sequence, on frame timing.

## EVIDENCE STANDARD

Every claim in `docs/` cites where it came from: file, offset, instruction address, or
the command that produced it. A claim without evidence is labeled INFERENCE. Confident
and wrong is worse than "not verified yet."
