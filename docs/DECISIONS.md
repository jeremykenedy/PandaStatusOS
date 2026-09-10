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

**Date** 2026-09-10 · **Reversal** cheap

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

---

*Entries continue below as the run proceeds.*
