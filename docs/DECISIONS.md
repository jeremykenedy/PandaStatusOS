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

---

*Entries continue below as the run proceeds.*
