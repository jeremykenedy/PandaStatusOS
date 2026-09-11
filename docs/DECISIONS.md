# Decisions

Every non-obvious call made on this project, with the reasoning, so a later reader can
tell a deliberate choice from an accident and can reverse it knowing what it cost.

Under standing rule 10, an unsupervised run does not stop on ambiguity. It decides,
records the decision here, and continues. A decision recorded and wrong is recoverable.
A night spent blocked is not.

Each entry carries: the date, what was decided, the alternatives, why this one, the
reversal cost, and what evidence would change it. Entries are never deleted; a reversed
decision gets a new entry pointing back.

Reversal cost scale: **cheap** is an edit and a commit; **moderate** touches several files
or a stored format; **expensive** changes a wire shape, a stored config layout, or anything
already flashed to a device.

---

## D-001 RESTORE.md is written now as a template, not later as a fact sheet

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** `backups/RESTORE.md` is written in full today, with every value the dump will
supply marked `<PENDING DUMP>` inside a box that cannot be missed, rather than deferred
until the dump exists.

**Alternatives.** Write it after Phase 0 step e, when every offset is real.

**Why.** The prose around the offsets — what to do when the device will not boot, what to
do when the dump fails verification, the statement that no P2 image exists anywhere — is
the part that has to be right, and it is the part that gets written badly in a panic.
Writing it while nothing is on fire is the only way to write it carefully. The offsets are
a fill-in.

**Would change it.** Nothing; the pending markers are removed as the dump fills them.

## D-002 Full-image restore is the primary path; per-partition is the fallback

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** `RESTORE.md` Part B leads with writing the whole verified image to offset 0,
and presents the per-partition command second.

**Alternatives.** Per-partition first, as the more surgical option.

**Why.** A full-image write restores the bootloader, partition table, every slot, the
image partition and NVS in one command with one hash to verify. It has no offset to get
wrong. Per-partition restores need every offset correct and are the path where a typo
bricks the device. The surgical option is kept for the case where one partition is
genuinely all that needs putting back.

**Would change it.** A flash part large enough that a full write is impractically slow.
Flash size is unknown today.

## D-003 esptool commands use the hyphenated subcommand form

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** `read-flash`, `write-flash`, `chip-id`, `flash-id`, `read-mac`, with one note
that older esptool prints the underscore form.

**Why.** The sibling project's README and this repo's SAFETY.md already use the hyphenated
form; consistency across the two documents a person reads under stress matters more than
either spelling. Both forms are accepted by current esptool.

## D-004 The pre-flash gate is twelve lines, each a yes-or-closed

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** `firmware/SAFETY.md` replaces its seven-item checklist with a twelve-line
gate that must be walked in full, with a written record of the twelve answers and the
date before the write command is typed.

**Why.** The run brief named five rules that had to be individually present: three reads,
two must agree, off-machine copy, the img partition rule, and the fifteen GIFs. The old
list folded several of those into one line, which is how a line gets half-answered. One
rule per line, one yes per line, and a written record so that if something goes wrong the
answers given are what gets read. The chip check and the "no published fallback,
acknowledged" line were added because both are the kind of fact that is known and then
not consciously held at the moment it matters.

**Also fixed.** The document said "after all six" about an eight-item list. Stale count.

## D-005 Rule amendments are recorded as dated amendments, not silent rewrites

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** The amended Rule 5 and the new Rules 9 and 10 each carry the date and the
words "authorized by Jeremy for the autonomous run" in the rule text itself.

**Alternatives.** Rewrite the rules in place so they read as if they had always said this.

**Why.** A reader comparing the history of `CLAUDE.md` should be able to see that the
parity-first rule was relaxed on a specific day under a specific authorization, not assume
the project never held it. The rules are the contract; changes to the contract are dated.

## D-006 Part 2 reading notes are staged outside the repo, then moved in

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** The ten porting notes from reading the sibling project are written to the
session scratchpad first, then copied into `.claude/work/notes/pandavent/` after the
Part 0 backup tarball has verified.

**Why.** The backup tars `.claude/` while it runs. Agents writing into `.claude/work/notes/`
during that tar would race it. Writing elsewhere and moving afterwards costs one `cp` and
removes the race entirely.

## D-007 Part 0 and Part 1 are one commit

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** The restore document, the pre-flash gate, the rule amendments, and this file's
creation land together as the run's foundation commit, before the queue starts.

**Alternatives.** One commit per file.

**Why.** They are one change in meaning: "this run is now authorized and its safety net is
in place." Splitting them would produce commits whose intermediate states describe a run
that is half-authorized. Queue items Q1 onward commit individually, as the brief requires.

## D-008 Colour picker: Coloris, not Pickr, not iro.js

**Date** 2026-09-10 · **Reversal** moderate once pages bind to it; cheap before that

**Decided.** `@melloware/coloris` 0.25.0, MIT, zero runtime dependencies.

**Alternatives.** `@simonwep/pickr` 1.10.2, also MIT and dependency-free. `iro.js`, which
the sibling project used, is MPL-2.0.

**Why.** Measured from the npm tarballs, minified and gzipped with `gzip -9 -n`:
Coloris is 5,381 B of JS plus 2,080 B of CSS, **7,461 B total**; Pickr is 8,259 B plus its
smallest theme at 1,993 B, **10,252 B total**. On a single-file page where every byte is
flash, the smaller one wins a tie on features. Coloris also attaches to an existing
`<input>` and leaves it a real form field, which keeps the value reachable by the contrast
and wire harnesses; Pickr replaces the element with its own widget. iro.js is excluded on
licence alone: MPL-2.0's file-level copyleft is the wrong shape for a deliverable that is
one spliced HTML file.

**Would change it.** A picker feature Coloris cannot do that a page needs. None is known.

## D-009 Vendored files live in firmware/main/vendor/<dep>/, and the build reads them from there

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** Pristine upstream files are committed inside each dependency's vendor
directory, next to its `LICENSE.txt` and `README.md`, and the page build reads its inputs
from those paths and nowhere else.

**Alternatives.** Keep only licence text in `vendor/` and fetch or splice from elsewhere, as
the sibling did for three of its four dependencies.

**Why.** "Nothing ships without a row" becomes mechanically true: a dependency the build
can see is, by construction, one that has a directory, and a directory without a README is
a visible defect rather than an absence. It also makes the sha256 in each README a hash of
a file anyone can run `shasum` on, not of a block inside a page. The exceptions are the
two that are transformed before shipping: the Heroicons sprite is assembled from the
subset of SVGs the pages actually use, so its row hashes the assembled sprite and is
filled when the sprite is first built; the Roboto row hashes the woff2 subsets, which are
chosen in Q7 after the string table is measured.

## D-010 Marks and favicon are generated from primitives by a committed script, SVG plus stdlib-rasterised PNG

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** `tools/art/gen_marks.py` draws the mark as SVG from a handful of shapes and
rasterises the favicon and touch icon to PNG with a small standard-library encoder, all
deterministically. Provenance is proven by re-running the script and diffing, never by
assertion.

**Alternatives.** Hand-drawn SVG; a raster sheet from a design tool; reuse the sibling's
marks.

**Why.** The sibling shipped four panda PNGs whose author could not be established, inline
in a public page. That is the single worst provenance row in its audit and it is not
repeatable here. A generator that reproduces its output byte-exactly is the only form of
artwork whose origin is checkable by a stranger.

## D-011 The mark is a light bar, not a panda

**Date** 2026-09-10 · **Reversal** cheap · **Superseded by D-030** the same evening, once
provenance of the panda was settled by its author.

**Decided.** The mark depicts what the product is: a short horizontal bar of round LEDs
with a progress fill. No panda, no bear, no face.

**Why.** The vendor's brand is a panda. Any panda mark on this project invites the
question the sibling could not answer, however independently it was drawn. A light bar is
the device itself, it is trivially original, and it reads at 16 px.

## D-012 Binary files skip the CJK text check; the check was made precise, not exempted

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** In both the residue sweep and the pre-commit hook, a file containing a NUL byte
in its first 8 KiB is treated as binary and skipped by the CJK-source-text check only. Every
ASCII-pattern check still runs on it.

**What happened.** The first Q1 commit was refused by `make residue` with two "CJK source
text" hits in `art/apple-touch-icon-180.png`. The sweep had decoded the PNG's bytes as text
with replacement, and two byte runs happened to form CJK codepoints. The gate was right to
refuse an unexplained hit; the hit was a check imprecision, not residue.

**Alternatives.** Exempt `art/`; exempt `*.png`; keep the check and accept manual override.

**Why.** Part 4 of the run brief: a check that has to be weakened to do normal work stops
being read. An exemption by path would grow with every asset. Skipping the CJK check on
binaries is the precise statement of what was wrong: binary bytes are not source text, so
a text-only check has nothing to say about them. Identifiers and credentials in a binary
are still caught, because those scans still run. A regression case in `make test-hook`
stages a real PNG and expects PASS.

## D-013 Where the mock, harnesses and build system live, and where their dependencies live

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** Source is tracked; dependencies are not.
- `tools/ui/mock/` the mock device (Node, needs the `ws` package), tracked.
- `tools/ui/harness/` harness sources (Node; the browser ones need Playwright), tracked, with
  **no `package.json` in the tree**.
- `tools/ui/build/` the page assembler (Python, standard library), tracked.
- `private/uiwork/` gitignored: the dev `package.json`, `node_modules/`, screenshots, real
  captures, scratch. `tools/ui/harness/run.sh` sets `NODE_PATH` to it, relative to the repo root.

**Alternatives.** Everything under `private/uiwork/`, as the run brief's Q3 wording says; or a
tracked `package.json` listing Playwright.

**Why.** Three constraints pull in different directions. The brief says commit after every
item and says contributors must be able to build and run the harnesses; a mock nobody can
check out is not a mock. The standing rule that Playwright never enters a tracked
`package.json` is absolute. And the brief's reason for `private/` is quarantine of material
that has been near vendor files. Nothing written tonight is ported by copying; it is written
fresh from the porting notes, so it is clean-room from birth and has nothing to quarantine.
Tracking the source and ignoring the dependencies satisfies all three. `README.md`'s
`private/` table is corrected to match.

**Also decided here: fixture hygiene.** Every secret-shaped field in a tracked fixture is a
`<PLACEHOLDER>` token, which the hook's allowlist accepts and the page renders harmlessly;
every address is a documentation address. The redacted capture in the working area, which
holds the owner's real LAN addresses and hostname, is never copied into a fixture.

## D-014 What the mock assumes where the bench has not measured

**Date** 2026-09-10 · **Reversal** cheap, each is one knob

**Decided.** Six behaviours the protocol doc leaves open are implemented as a default plus an
environment knob for the other reading, so the bench can flip each without a code change:

| Open question | Default | Knob |
|---|---|---|
| change push carries all six roots or only the changed one | all six | `PS_PUSH_CHANGED_ONLY` |
| change push reaches other clients | sender only, matching measured connect behaviour | `PS_BROADCAST` |
| `rgb_reset` received in Music mode | no-op, no push, matching the observed end-to-end behaviour | `PS_RGB_RESET_MUSIC_APPLIES` |
| `rgb_info_speed` echoed back in `list2` | stored, not emitted, matching the observed push | `PS_EMIT_SPEED` |
| `img_version` in the connect push | absent, matching the observed push | `PS_IMG_VERSION` |
| a GIF upload's response | `{type:"ota_img", ok, gif:<slot>}` | none; INFERENCE stated in the header |

**Why.** A mock that picks one reading silently becomes a spec by accident. Each default is
the reading closest to what was measured; each knob makes the other reading one env var
away; the mock's header lists all of them as INFERENCE. When ladder reads A to D come back,
each row here becomes a fact or a fix.

**Would change it.** The bench session, item by item.

## D-015 Two secret patterns made precise; code that handles a field is not a leak

**Date** 2026-09-10 · **Reversal** cheap

**What happened.** The pre-commit hook refused the Q2 commit on seven hits in the mock and the
wire harness: `w.password = String(m.password)`, the property path `d.wifi.password`, a test
frame `{ ssid: 'net', password: 'pw' }`, and the enum label `password error`. The residue
sweep had passed. Every hit was code that stores or names the field, not code that contains
a value.

**Decided.** The credential-assignment pattern now requires the value to end at a literal
boundary: a quote, punctuation, whitespace, or end of line. `String(` ends in `(` and is an
identifier, not a value. The network-key proximity heuristic now requires a value-shaped
token of eight or more characters after the keyword; the bare words on one line are a field
path or a label. Six regression cases added, four negative and two positive, so both patterns
still catch a quoted sixteen-character value assigned to a password field, and a network key
written beside a value with no separator.

**A note on this entry itself.** Its first draft quoted the two positive test fixtures
verbatim to illustrate what still blocks, and the hook refused the commit on exactly those
two lines. That was correct: a document that contains a credential-shaped literal is
indistinguishable from a leak, whatever the surrounding prose says. The examples now are
descriptions.

**Alternatives.** Exempt `tools/ui/`; exempt `*.js`.

**Why.** Part 4 of the run brief, third time tonight: a check that has to be weakened to do
normal work stops being read. An exemption by path would have to grow with every harness
and every module that handles a credential field, which is most of the page. The precise
statement of what was wrong fits in one regex each.

## D-016 The page build: one source of truth, explicit keys, the seam, and what the build refuses

**Date** 2026-09-10 · **Reversal** moderate once translations exist

**Decided.**
- `firmware/main/ui.html` is an OUTPUT of `tools/ui/build/build.py` and is committed. Nobody
  edits it. Its gzip is CMake's job (`gzip -9 -n`) and is gitignored.
- i18n keys are **explicit in the markup** (`data-ps-str="ps_<page>_<what>"`), not minted from
  the English text. An English edit then never renames a key and orphans its translations,
  and a translator keys on something stable. `i18n.py mint` adds a first key to a forgotten
  element; it never reuses or fuzzy-matches.
- `en.json` is **derived from the markup** every build (plus `js_strings.json` for strings
  only JavaScript uses), never accumulated. The English lives where it is read.
- Other languages are validated against English on every build: missing, extra, or
  placeholder-mismatched keys fail the build. The language list is the set of files present.
- **The seam** is `strings_block()` in the assembler: the one function that decides inline
  versus fetched. Inline today; `--strings fetch` fails with a message naming the deferred
  path. `PS.tr()` in the core module is the one runtime accessor.
- The build refuses: marks that drift from their generator; a vendored file whose sha256
  differs from its README; any untagged text; any key not in `en.json`; any `id_` or `c_`
  token; any inline `on*=`; any external asset reference; a card without `data-ps-card`; a
  nav target with no card; an unreplaced slot.

**Alternatives.** Mint keys from English (the sibling's way); accumulate `en.json`; hand-edit
the built page for quick fixes.

**Why.** Each refusal is a bug the sibling shipped, and each is cheaper to catch at build
time than in a screenshot. Explicit keys cost a few seconds per element and remove a whole
class of translation drift. The seam costs one function today and saves rewriting every
call site if the dump says flash is tight.

---

## D-017 Page furniture lives inside main; the hidden attribute always wins

**Date** 2026-09-10 · **Reversal** cheap

**Decided.**
- Beer CSS lays `<body>` out as a grid with named areas for `nav.left/right/top/bottom`,
  `header`, `main`, `footer`. Any other in-flow child of `<body>` is auto-placed into a spare
  cell of that grid and takes width from the page. So: the only in-flow children of
  `<body>` are Beer's areas. Everything else shared by every page is either inside `<main>`
  (the waiting and fault banners) or out of flow (the dialog, the toast, the file input;
  all `position: fixed` or `display: none` until used). The build's frame is the one place
  this shape is written.
- `[hidden] { display: none !important; }` in `app.css`. Any author `display` rule beats the
  UA's `[hidden]`, so a component whose class says `display: flex` was visible while hidden.
  The narrower rule for cards is replaced by this one.

**Evidence.** The first phone-width screenshot of the lighting page: the fault banner
(hidden, but `display: flex`) was placed in the grid's left column at full width, and the
top bar, `main` and the bottom bar were 16 px wide beside it. 77 of the harness's
assertions still passed; none of them measures a width, by design (Q8), and the page was
unusable. Q6's screenshot rule exists for exactly this.

**Alternatives.** Position the banners `fixed`; give the banners a Beer area class they do
not belong to; assert widths in the harness.

**Why.** Fixed banners cover content, and every page would need a spacer. Borrowing a Beer
area name is a lie the next Beer release breaks. Width assertions are the styling police Q8
forbids. Putting the shared furniture where the layout system expects it costs nothing and
holds for every page after this one.

---

## D-018 Coloris is bound to our own attributes, unwrapped

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** Colour fields carry `data-ps-colour` or `data-ps-block` (Rule 8), never
Coloris's own `data-coloris`. Coloris binds those selectors explicitly with `wrap: false`
on **every** bind call, including the re-bind after block fields are created.

**Evidence.** Coloris initialises itself on `DOMContentLoaded` and wraps every
`[data-coloris]` field in a div of its own with a swatch button. That wrapper puts the
input one level below Beer's `.field > input` selector, so Beer stopped styling the three
state colour fields while it styled the dynamically created block field, which Coloris had
never seen. `wrap` is read per bind call (`coloris.min.js`: `case "el": ... !1 !== t.wrap &&
H(t.el)`), so a global `wrap: false` does not exist.

**Alternatives.** Keep `data-coloris` and set `wrap: false` before load (there is no
before-load hook that reaches the auto-init); restyle Coloris's wrapper to look like a Beer
field (two components pretending to be one).

**Why.** The swatch is ours (the `.ps-dot` in Beer's prefix slot, showing the colour the
device holds), the input is Beer's, the picker is Coloris's. One job each.

---

## D-019 Images page: a preview is the file chosen here, and only the size guard runs

**Date** 2026-09-10 · **Reversal** cheap

**Decided.**
- A slot's preview is the file chosen in this browser, held as an object URL for the life
  of the page. The device has no route that serves a slot's current animation
  (`docs/protocol-websocket.md`, HTTP surface), so there is nothing else a preview could
  be, and the page says so in its help text instead of showing a placeholder that looks
  like device state.
- The per-slot size guard runs in the browser before any request, naming the limit in MB.
  That is what the factory UI does (FACT: the constant is compared against the file size
  and rendered into the rejection). The 240 x 240 dimension check does **not** run: it is
  disabled in the shipped factory UI, and Rule 5 says parity by default. If it comes back
  it is a flag that defaults off.
- The device's answer (`response {type:"ota_img", ok, gif}`) is the verdict a slot shows.
  On the mock it arrives on the socket before the HTTP status does, so an HTTP failure
  never overwrites a verdict already shown; the verdict overwrites the HTTP status.
- Each slot's status line carries its i18n key as it changes, so a language switch
  repaints it correctly instead of resetting it to idle.

**Alternatives.** Render a stage image from our own assets as a stand-in; enforce
240 x 240 because it is probably what the display wants; treat HTTP 200 as success.

**Why.** A stand-in image is a lie about device state, the exact fault the dashboard note
warns about. The dimension rule is a factory rule the factory does not enforce, and
enforcing it would refuse files the stock unit accepts. HTTP 200 only says the body
arrived; the device's own answer says whether it was taken.

---

## D-020 Printer page: what is shown from the push, what the form sends

**Date** 2026-09-10 · **Reversal** cheap

**Decided.**
- The bound printer's name, state, serial number and address are shown because the device
  sends them. The factory UI handles only `name`, `state`, `scan`, `list`; showing two more
  fields the push already carries changes nothing on the wire. The access code is never
  shown, never pre-filled, and the harness asserts it appears nowhere in the page.
- The bind form starts empty and is not pre-filled from the device. Bind sends exactly the
  four typed values, in the documented order `name, sn, access_code, ip`, with no
  validation: the factory UI's validation is unknown, and refusing in the browser what the
  device would accept is a divergence. The device reports the result as `printer.state`.
- Scan sends `{scan: 1}` and unbind, after its confirm, `{disconnect: 1}`. The values are
  the wire harness's reading of the protocol doc (which names the fields, not the values)
  and are INFERENCE until the bench capture shows the factory frames.
- The seven `printer.state` labels are the dashboard's keys, reused, so they are translated
  once. The seven `printer.scan` labels are the page's own.
- A found printer's Use button fills name and address and sends nothing.

**Alternatives.** Pre-fill the form from the push; validate the serial number's shape
(the pre-commit hook knows it); hide the serial number as if it were a secret.

**Why.** The serial number is identity, not a credential, and the owner reads it off the
printer's own screen; hiding it would only make the page harder to check against the
printer. Validation and pre-fill are both cheap to add behind a flag once the bench
capture says what the factory does.

---

## D-021 Network page: which fields are pre-filled from the push

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** The hostname field and the three hotspot fields are pre-filled from the push
while the user has not typed in them; the Wi-Fi name and password fields are never
pre-filled. The wire is unaffected either way: a button sends what its fields hold when it
is pressed.

**Evidence.** The protocol doc's inbound table: the factory UI handles `sta.hostname` and
`ap.ssid`, `ap.password`, `ap.ip`, `ap.on` inbound, and handles `wifi.ssid` and
`wifi.password` inbound too. Handling a field inbound is most plausibly showing it in its
form, so pre-filling those forms is the likely factory behaviour; INFERENCE until the bench
capture. The Wi-Fi password is the exception on purpose: the device sends it, but putting
a network's password into a form on every page load, on a page that is served without
authentication, is a worse default than typing it once. The harness asserts the Wi-Fi
password from the push appears nowhere in the page.

**Also.** `sta.auth_err_reason`, which the device sends and the factory UI ignores, is
shown as a bare reason code when non-zero. Its meaning is unknown until the bench; the
label says "reason code" and nothing more.

**Alternatives.** Pre-fill nothing; pre-fill everything including the Wi-Fi password.

**Why.** Nothing pre-filled makes the hotspot form a memory test; everything pre-filled
puts a credential on screen by default. The split follows what each field is for.

---

## D-022 The secret scan strips our own i18n keys before it judges a line

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** In the pre-commit hook's pattern scan, a line that matches a pattern is
re-tested with every `ps_<page>_<what>` token removed. If the match vanishes, it lived
inside one of our i18n key names and the line passes. Four regression cases pin it, two of
them the exact lines that were refused.

**Evidence.** The network page's keys `ps_network_ap_password`, `ps_network_ap_ssid`,
`ps_network_connect_password`, `ps_network_connect_ssid` end in credential words, and
`"ps_network_ap_password": "Hotspot password"` matches the assignment pattern: keyword,
colon, quote, six or more plain characters, a boundary. The hook refused `en.json` and the
built page. Neither line assigns anything.

**Alternatives.** Rename the keys to dodge the words (`ps_network_ap_secret`); exempt
`tools/ui/i18n/` and `firmware/main/ui.html`; anchor the keyword to a word boundary (which
would also stop catching `wifi_password = ...`, a real leak shape).

**Why.** Part 4 of the run brief, again: fix the check's precision, never add an exemption.
Renaming keys to fool a scanner leaves the scanner wrong and the names worse. The strip
is exact: only tokens that follow standing rule 8's naming are removed, and the literal
known-secret scan still reads every line whole.

---

## D-023 The logs page shows a ring the core masks at the source

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** The core keeps a ring of 200 socket events. Inbound frames are stored as
their root names only. Outbound frames are stored with their members, except that a
member named `password` or `access_code` is replaced by its length before the entry
exists. The logs page formats that ring and nothing else; it never sees a frame.

**Evidence.** The connect-time push carries `wifi.password`, `ap.password` and
`printer.access_code` in clear (protocol doc, inbound table; the mock's scrubbed fixtures
model it). A log that stored frames would put three credentials one Copy button away from
a chat message. The harness asserts the values are absent from the page and from the ring
in memory.

**Also.** The page repaints only while it is the page in view; a busy socket must not
repaint a hidden `<pre>` two hundred lines long on every frame.

**Alternatives.** Log everything and mask on display; log nothing; no logs page.

**Why.** Masking on display leaves the values in memory for the next bug to expose.
Logging nothing gives up the one diagnostic a user can paste into a bug report. The brief
lists the page; this shape is the one that cannot leak by construction.

---

## D-024 The setup page: when it shows itself, and what it is

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** One card, three steps: language, Wi-Fi (scan, pick, password, connect), idle
colour for the current mode. Not in the nav. It shows itself when the first state
document says `sta.state` is 1 and `wifi.ssid` is empty, the browser session has not
pressed Finish, and no other page was asked for by hash. Finish sets a session flag and
goes to the dashboard; `#setup` stays reachable by its address at any time.

**Evidence.** `sta.state` 1 is "nossid" in the enum (protocol doc): the device has no
network configured, which is what a unit out of the box looks like, and what a factory
reset returns it to (the mock's factory fixture models both). Whether the factory UI has a
first-run flow at all, and what it asks, is **unknown**: INFERENCE, to be checked against
the stock unit after its own factory reset on the bench.

**Wire.** Every frame this page sends is one another page sends, with the same members:
`settings.language`, `wifi.scan`, `wifi.ssid` + `password`, and the idle colour as
`settings.rgb_info_mode` + `rgb_rgba` + `rgb_state_index` 0. Nothing new on the wire, so
nothing for a flag to gate.

**Alternatives.** A modal wizard that blocks the other pages; a persistent (localStorage)
"done" flag; no first-run page, just the dashboard.

**Why.** A blocking wizard fights a user who knows the device. A persistent flag would hide
the page from the next owner of the same browser after a factory reset; a session flag
resets when the tab does, and the device's own state decides the rest. The brief calls
this the first thing a new owner sees, so it gets the same page treatment as everything
else, contrast scrutiny included.

---

## D-025 Twenty-four languages ship inline; the seam stays built

**Date** 2026-09-10 · **Reversal** cheap (one build flag once the seam's fetch path exists)

**Measured, before choosing.** English: 248 keys, 13,425 B raw, 3,461 B gzip. Simplified
Chinese 3,960 B gzip, Traditional 3,926 B: a CJK table costs about 14% more than English
after compression, not less. Five languages inline took the page from 62,386 B to 76,087 B
gzip, 3.4 KB per language. Twenty-five languages project to roughly 145 KB gzip for the
whole page.

**Decided.** All twenty-four translations (four CJK, twenty others, two right-to-left) ship
inline through `strings_block()`. 145 KB gzip is half the size of the factory page, which
the device serves uncompressed at 278,771 B, so the page is not the flash question. The
seam (D-016) is kept as built and unbuilt: if the dump shows a tight partition, the fetch
path is one build flag away and no call site changes.

**Alternatives.** Fewer languages; fetch per language now.

**Why.** The brief's number was chosen after its cost was measured, which is what it asked
for, and the cost is small on every reading of the flash size that is possible.

---

## D-026 Firmware skeleton: what is pinned, what is provisional, what is deferred

**Date** 2026-09-10 · **Reversal** noted per item

**Decided.**
- `firmware/partitions.csv` is GENERATED by `tools/fw/gen_partitions.py` from one number,
  the flash size, and says PROVISIONAL in its header until Phase 0 reads the real size.
  Two app slots of 0x180000, then `images` (custom type 0x40) takes the rest, coredump
  last. Reversal: one command.
- The stored config `ps_cfg_t` uses fixed-width members only and is pinned by
  `_Static_assert` to a literal size (492) and to the offsets of its arrays, so the host
  test and the target agree byte for byte and a layout change cannot pass unnoticed. The
  magic is the version; the chain is newest-first; defaults are written first and the
  stored layout overlaid; every index read from flash is clamped with its reason. The
  host test includes the real `ps_cfg.c`. Reversal: freeze, bump, migrate, as the file says.
- Defaults are PROVISIONAL: they are the factory page's post-reset expectations and the
  mock's factory fixture, not values read off the device. Gate 3 replaces them.
- `features` is a 32-bit field of flags, all zero: standing rule 5's "every feature behind
  a flag that defaults off" has a home before any feature exists.
- OTA rollback is enabled in `sdkconfig.defaults`: a bad image boots the last good slot.
  This is not on the wire and costs the owner nothing; the alternative on a device with no
  published image is a brick.
- Home Assistant discovery is deferred: the factory page exposes no broker setting, so
  whatever the factory firmware publishes has no configuration surface here to mirror.
  Recorded as a gap for the MQTT capture and Phase 1, not built blind.
- Nothing here flashes. `idf.py build` is the only target; standing rule 0 holds.

**Why.** Each of these is the cheapest shape that cannot be quietly wrong: a generated
table cannot drift from its input, a pinned struct cannot drift from its tests, a flag
field cannot be forgotten, a rollback cannot be regretted.

---

## D-027 The project is PandaStatusOS; the hardware stays Panda Status P2

**Date** 2026-09-10 · **Reversal** cheap (the name lives in a handful of places, listed)

**Decided.** The firmware and this repository are **PandaStatusOS**, on the precedent of
PandaVentOS. "Panda Status" and "Panda Status P2" remain BIGTREETECH's product name and
identify the hardware, exactly as the disclaimer draws the line.

**What changed.** `project(pandastatusos)` in `firmware/CMakeLists.txt`, so `esp_app_desc`
inside the image and the binary's filename (`pandastatusos.bin`) carry the name; the page's
`<title>` and brand; the MQTT client id and the capture tools' identities; the default
hostname placeholder; the Kconfig menu; the titles of README, CLAUDE.md and the hook; the
bridge document's prose; the working notes.

**The product name in the string tables.** It appeared in two keys in every language,
embedded in translated sentences. It is now the token `{product}` in every table: the
build derives the English value with the token, refuses any table that writes the name
out, and emits `PS_PRODUCT`; the page's one string accessor fills the token in. The
markup carries the literal for first paint. A rename is now one constant in the build
and two lines of markup, and no translation can split, transliterate or misspell it.

**What deliberately did not change.** The directory (`sites/PandaStatus`, as PandaVent's
is `sites/PandaVent`); the `ps_` and `ps-` and `PS_` conventions (they read correctly and
touch every file); the commit history; every "Panda Status P2" that names the hardware;
BIGTREETECH's own repository path and published filenames quoted in `SAFETY.md`; the
backup tarball names, which are the directory's.

**Left open, on purpose: the hotspot name.** The placeholder `ap_ssid` default is still
`PandaStatus`. What the factory names its hotspot is a bench-session fact, and under the
parity rule the default must match it; renaming the placeholder now would be a branding
decision dressed as a rename. The same holds for the default hostname, whose placeholder
was renamed with the project because it had to be something. Both are on JEREMY-QUEUE
item 3.

## D-028 The first install is an OTA into a stock app slot; nothing ever writes the bootloader or the partition table

**Date** 2026-09-10 · **Reversal** expensive, and not offered · **Authorized by** Jeremy, PM direction

**Decided.** The first install of the clone goes through the factory firmware's own
`POST /ota`, over the network, into one of its app slots. No cable. The bootloader at 0x0,
the partition table at 0x8000, NVS and the images partition are never written by anything
in this repository except the whole-image restore of a verified golden. The clone is
therefore built against the stock partition table, read out of the dump by
`tools/fw/partitions_from_dump.py`; the generated table is PROVISIONAL and for host builds
only. `tools/fw/preflight.sh` gates every flash path on eight checks with no override, the
whole-chip erase token is forbidden by the residue sweep, and there is no `make` target
that flashes.

**Alternatives.** The cable-first install this project documented until today (bootloader,
table and app written together from `flash_args`). Rejected because it is the exact
operation that lost the Panda Vent's factory firmware on 2026-08-30, and the P2 has no
published image of any kind to fall back on.

**Why.** An OTA writes one slot and leaves the stock app in the other as the bootloader's
fallback. Everything irreplaceable stays untouched by construction, not by care.

**What would change it.** Nothing about the rule. The mechanics change when the dump shows
the stock table: the slot names, the images partition's real label and type, and whether
the stock bootloader honours rollback (recorded as INFERENCE in `firmware/SAFETY.md`).

## D-029 GET /backup answers on the station interface only, and the build identifier is a header

**Date** 2026-09-10 · **Reversal** cheap (one function in `ps_backup.c`; one header line in `ps_ws.c`)

**Decided.** `GET /backup` streams the whole flash but refuses requests that arrive on the
hotspot's address (403). `GET /` and `GET /backup` carry `X-Build`, the first eight bytes of
the app ELF's sha256 from `esp_app_desc`, as a response header.

**Alternatives.** Serve the backup on every interface, as the vent does; put the build
identifier in the WebSocket `settings` root; a token or password on `/backup`.

**Why.** The image carries NVS, and NVS carries the Wi-Fi password and the printer's access
code in plaintext. The factory keeps its hotspot up by default and open (`ap_on` 1, no
password), so on every interface the endpoint would hand the home network's password to
anyone in radio range without their ever joining the network. The vent's LAN exposure was
accepted knowingly; this one is wider and was not asked for, so the hotspot is excluded and
the owner backs up from the network the device is on. A header is chosen over a wire field
because gate 2 requires the state document to equal the device's exactly; a header is
invisible to the page, the wire and the harnesses. A token was not chosen because the
device has no authentication anywhere and one secret on one route would be theatre.

**What would change it.** Jeremy deciding the hotspot exposure is acceptable (delete
`via_hotspot()`), or the device growing authentication (then `/backup` uses it).

## D-030 The mark is the family mark: Jeremy's panda face over this product's light bar

**Date** 2026-09-10 · **Reversal** cheap (one function in `tools/art/gen_marks.py`) · **Supersedes** D-011

**Decided.** The mark, the favicons and the touch icon are generated from Jeremy Kenedy's
panda primitives (the same ones his PandaVentOS banner draws) with the light bar under the
face. The vent carries the face alone; the Status carries the face over its bar. The
favicon was designed at 16 px first.

**Alternatives.** The bar alone (D-011); the vent's panda unchanged; the bar as a headband
across the forehead. All four were rendered at 16, 64 and 180 on both grounds
(`gen_marks.py --options`) and looked at.

**Why.** D-011 avoided the panda because its author could not be established; that is
settled: the panda is Jeremy's and crosses freely (Rule 6 as clarified). What remains is
the design question he raised: two products with one favicon are indistinguishable as two
tabs, two repositories, two pages. A shared silhouette says one project line; a
per-product element tells them apart. The bar is the Status's identity and reads at 16 px
as a coloured strip under the face; the headband merged with the ears at 16 px.

**What would change it.** Jeremy preferring another option; each is one line to switch.

## D-031 The drawn icon set is project source, normalised on import; stages get icons

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** Jeremy's nine drawn icons (from PandaVent's working files) are project source
under `tools/ui/src/icons/`, first-party under this repository's MIT licence, never under
`vendor/`. `tools/ui/normalize_icons.py` rewrites each Illustrator export on import: the
twenty-class stylesheet becomes the three or four attributes each element actually uses,
`#010000` becomes `currentColor`, the export furniture goes, the geometry and every stroke
width stay exactly as drawn. Stroke weights were not changed: rendered beside Heroicons
at 24 px the two sets read as one, so nothing moved. Three stage icons neither set had
(`bed-level`, `mesh`, `flow`) are drawn by `tools/ui/gen_icons.py` on the same grid at the
same weight, provenance by regeneration. Each of the fifteen stage slots shows its stage's
icon until a file is chosen; the Printer destination shows the printer.

**The real count.** PandaVent's sprite carries 51 symbols: 36 are Heroicons 2.2.0 outline
paths (several under other names), 8 are Jeremy's 96-grid drawings (`spool` is a file but
was never in the sprite), and 6 grid-24 symbols match no Heroicons 2.0.18, 2.1.1, 2.1.5 or
2.2.0 file. Which of those six are his is recorded in `tools/ui/src/ARTWORK.md`.

## D-032 Binaries are swept as their printable runs; the checklist skips its own text

**Date** 2026-09-10 · **Reversal** cheap

**Decided.** The residue sweep scans a binary file as the printable runs `strings -n 8`
would show and nothing else; the CJK check skips binaries entirely (D-012). The
publishing checklist's path scan no longer counts `.py` and `.sh` sources named after
what they read as dump artifacts, and its MPL search skips the checklist file itself.

**Why.** A README screenshot's compressed pixels spelled a `c_` token and the sweep
reported CSS residue in a PNG; `tools/fw/partitions_from_dump.py` tripped the path scan
on the word "dump"; the checklist's own MPL command matched its own line. None was a
finding about the tree, and each check was made precise rather than weakened: a real
identifier in a real string inside a binary still fails, a real dump by path still fails.
The same evening the sweep failed on that PNG in the moment before a commit, and the
commit went ahead because the sequence did not gate on it; that is recorded here so the
lesson is not lost: gate on the sweep's exit code, not on reading its last line.

## D-033 Features reach the page through the clone's own JSON route, never through the socket document

**Date** 2026-09-10 · **Reversal** moderate (the route is one file; the page's discovery is one function)

**Decided.** Feature switches and their settings live at `GET`/`POST /api/features`, a JSON
document taken whole or refused whole. The page probes it once on load; the factory's 302
means "the factory", a 200 means "the clone", and only then does anything beyond the
factory page appear. The WebSocket document stays byte-exact.

**Alternatives.** A seventh root in the connect push (breaks gate 2: the state document
must equal what the device emits); a clone-only root sent only while a feature is on (the
page could never offer the first switch); a feature field inside `settings` (a wire
difference on every connect).

**Why.** Gate 2 and Rule 5 both want the wire to be the factory's by default, and the page
still needs a way to learn that a switch exists. A route the factory answers with a
redirect gives the page that knowledge at the cost of one request the factory ignores,
and it is the seed of the JSON API the queue asks for (C2). The mock carries the same
route behind `PS_CLONE=1`, so every feature is proven against both devices: against the
factory the harness asserts that nothing appears and nothing is sent.

**What would change it.** The bench showing the factory answers `/api/*` with something
other than the redirect; then the path moves.

## D-034 The effect engine is the vent's, ported as pure C; the sweep's effect-list check names the vendor's fingerprint

**Date** 2026-09-10 · **Reversal** moderate (the engine is one file; the check is one regex)

**Decided.** `ps_fx.c` is PandaVentOS's effect engine, Jeremy Kenedy's own work, adapted to
one strip and this project's colour type, with this project's effect ids and this
project's English names for them ("Solid", "Hue cycle", "Scanner", and so on; Rule 7). It
compiles without the IDF so the host test drives the shipping body. Effects that need a
live input (progress, temperature) are in the engine but not yet selectable; each arrives
with its feature and its input.

The residue sweep's "effect list as a set" check fired on any three of the vendor's seven
effect names appearing together. This project now has seventeen effects of its own that
share six of those generic English words, so that rule could no longer tell the vendor's
table from ours; it was made precise, not weakened: the vendor's fingerprint is its seven
in its own order, or its own spelling of the colour-cycle effect (the American spelling
with an underscore, which the sweep also forbids on its own) beside any other name of the
list. This project writes "hue cycle" and lists its effects in its own order.

**Alternatives.** Writing an engine from scratch (the queue asks for the vent's model, and
the vent's engine is his); different words for the six shared effects (contortion for
the reader, and the words are not ownable).

**Why.** The queue names the vent's model as the target for Phase A, and both ends are
Jeremy's.

**What would change it.** Phase 1 recovering the factory's H2D animation: it becomes the
placeholder's replacement, not an effect, and stays outside the engine.

---

## D-035 An effect that reads the print waits for its own switch; a switch going off takes its effects with it

**Date** 2026-09-10 · **Reversal** cheap (one predicate in the engine, mirrored in the mock; one loop in the apply path)

**Decided.** The seventeen effects that need no live input come with `state_effects`
(A2). Each effect that reads the print has its own bit (6 progress bar, 7 animated
progress, 8 barber pole, 9 colour ramp; 10 reserved for the temperature gradient), and
`ps_fx_allowed(features, id)` is the one place that says which ids the bits in force
allow. Three rules follow from it, in the firmware and in the mock alike:

1. `POST /api/features` refuses an effect id that **changes** to one the document's own
   bits do not allow (400, the whole document). Echoing a stored id back is never a
   change, so a client can always return what it read.
2. A switch going off writes every stored id that needed it back to solid (0), so what is
   stored is always something the bits in force can render, and the page's next
   whole-table POST is not refused for carrying an id that was legal a moment ago. The
   seventeen are left alone when `state_effects` goes off: they wait for it to come back.
3. The renderer falls back to solid for any stored id its bits do not allow, which after
   rule 2 only happens to a blob written by another build.

The colour ramp (A9, id 21, this project's own effect, not in the vent's engine) runs
the whole strip as one colour from the unlit colour at 0% to the lit colour at 100%,
interpolated by hue the short way round so the ramp passes through the wheel rather
than through grey. With no unlit colour set it starts a third of the wheel behind the
lit colour, so green is reached through red and yellow, and blue through green and
cyan. With no reading it holds the start, because a print that has not reported is not
done.

**Alternatives.** One switch for all four (the queue lists them as four items with four
flags, and a flag per item is Rule 5); validating ids against the bits before the
document (a document that turns a switch on and picks its effect in one POST would be
refused); leaving stored ids in place when a switch goes off (the first whole-table POST
after that is refused, and the page cannot recover from it, which the harness found:
the reload check after the J block failed on a stored 17); refusing an unchanged id
(a client that echoes the document it read would be refused under a switch it did not
touch); the ramp through RGB (passes through grey between complementary colours).

**Why.** The page posts the whole three-state table on every change, so the stored table
has to stay acceptable under the bits in force or the page wedges. Rule 2 keeps the
invariant and rule 1 keeps the refusal precise.

**What would change it.** The capture showing `print.mc_percent` is not the field, or
not the scale, the progress effects read (INFERENCE today; they would follow the field).

---

## D-036 Layout v4 carries the fields for A10, A11 and A12 at once; a temperature feature names its source

**Date** 2026-09-10 · **Reversal** cheap for the defaults and the route, expensive for the layout (a fifth layout is one more frozen struct and one more arm; the fields are twenty bytes and can stay unused)

**Decided.** The config blob moves to v4 ("PS04", 592 bytes) with three groups of fields
laid down together: the temperature gradient's source and ends (A10), the hot warning's
source, threshold and colour (A11), and the error flash's colour, brightness and rate
(A12). A10 is built on it now; A11 and A12 arrive with their bits and read fields that
already exist, so Phase A needs one migration for the three, not three. Every field is
read only under its bit, so a v3 blob migrated to v4 leaves the device exactly where it
was.

Each temperature feature names which reading it follows (nozzle, bed or chamber; the
report's `nozzle_temper`, `bed_temper` and `chamber_temper`, INFERENCE, the fields the
vent reads from the same stream). One threshold cannot serve a nozzle at 220 and a bed at
60, so the gradient and the hot warning each carry their own source rather than sharing
one. The gradient's defaults follow the nozzle from 25 to 250 degrees; the hot warning's
default watches the nozzle past 50 degrees, in red; the error flash defaults to red at
the parity brightness and half rate. The degrees are bounded at 0 to 500 in the clamp,
the route and the mock.

A stored temperature is a whole degree, `PS_TEMP_NONE` (-1000) until the first report,
which sits below any cold end so a gradient with no reading holds its cold colour.

**Alternatives.** One layout per feature (three migrations and three frozen structs in
one phase); one shared temperature source (the nozzle-versus-bed problem above); ends as
u8 like the vent's (a 300-degree hotend would not fit).

**Why.** A frozen struct per layout is the migration recipe's cost, and three in one
phase is three chances to get a frozen struct wrong; the fields are cheap and the bits
keep them inert until their feature exists.

**What would change it.** The capture showing the report carries the temperatures under
other names or another scale (the parser follows the field; the layout stays), or A11 or
A12 needing a field the twenty bytes do not have (then v5, by the recipe).

---

## D-037 A layer is drawn over the base frame in time, in both modes, at its colour's own brightness

**Date** 2026-09-10 · **Reversal** cheap (one function in the engine and one block in the renderer per layer)

**Decided.** The hot warning (A11) is the first layer: a function in the engine that
takes the frame the base just rendered, placeholder or effect, and pulses one colour over
it, pure in wall-clock time (`now_ms` on a fixed two-second period) rather than in frames,
so a static base pulses at the same rate as an animated one. While a layer is active the
renderer's wait is capped at thirty frames a second whatever the base asked for. A layer
draws in both modes, because the point of a warning is that it shows whatever the bar is
doing. At the trough the base is untouched; at the peak the strip is the layer's colour
at that colour's own value, not scaled by the mode brightness or the per-state
brightness: the owner chooses a darker colour for a quieter warning. The threshold is
compared with the whole degree the report carries, at or past it.

Layers stack in order of urgency: the error flash (A12) draws after the hot warning so
an error outranks a warning. The flash is hard on for one half period and hard off for
the next, the base showing through the off half; its rate is the engine's speed scale
(`ps_fx_period`, 500 ms at 0 to 16 ms at 100, the half period), so one number means the
same thing here as on an effect. While it is active the renderer's wait is capped at that
half period as well, so a slow flash is not sampled at a rate that misses its edges.

**Alternatives.** The warning as an effect id (replaces the base, which the queue rules
out); scaled by the mode brightness (a warning at brightness 0 would not show); a phase
advanced per frame (a solid base at 500 ms per frame would pulse in steps).

**Why.** The queue asks for a layer "rather than replacing" the base; time-based rendering
is what makes that true over every base.

**What would change it.** Phase 1 recovering the factory's own error behaviour, if it
has one: parity would then decide what the default error rendering is, and the layer would
stay a feature over it.

---

*Entries continue below as the run proceeds.*
