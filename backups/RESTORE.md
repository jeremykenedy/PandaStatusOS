# RESTORE

How to put things back. Two halves: the **repository** and the **device**. They are
unrelated operations and neither depends on the other.

Written for someone who is not the author and has no context. If a step is unclear, that
is a defect in this document; stop and fix the document before acting on it.

---

## THE FACT THAT GOVERNS EVERYTHING BELOW

**No Panda Status P2 firmware image is published anywhere, by anyone.**

Checked 2026-08-27 and recorded in `firmware/SAFETY.md`: BIGTREETECH's GitHub publishes
four images and all four are V1/V2; the wiki's P2 release page lists one entry with no
download link. There is no vendor image, no community image, and no published binary for
this hardware.

So the full flash dump taken from this unit is **the only revert path that will ever
exist for it.** Not the best one. The only one. Every rule in this document about three
reads, off-machine copies and verification exists because losing the dump means the
factory firmware is gone from the world, not just from this device.

---

# PART A. Restore the REPOSITORY from a tarball

## A.1 Where the tarballs are

```
/Users/jeremykenedy/backups/PandaStatus-preNUKE-<timestamp>.tgz    before the history reset
/Users/jeremykenedy/backups/PandaStatus-autorun-<timestamp>.tgz    at each autonomous-run checkpoint
```

Each is a plain `tar -czf` of the whole `PandaStatus/` directory taken from its parent,
so it contains `PandaStatus/.git/`, `PandaStatus/.claude/` (the working area, including
`secrets/`) and every tracked file. Newest timestamp is newest state.

Every tarball's sha256 is recorded in `.claude/work/notes/SESSION-STATE.md` at the time it
was taken. **If the tarball you are about to trust has no recorded sha256, or the hash does
not match, do not use it.** Find an older one that verifies.

## A.2 Verify before extracting

```bash
cd /Users/jeremykenedy/backups
shasum -a 256 PandaStatus-autorun-<timestamp>.tgz
# compare against the value recorded in SESSION-STATE.md for that timestamp

tar -tzf PandaStatus-autorun-<timestamp>.tgz | grep -c '^PandaStatus/\.git/'          # must be > 0
tar -tzf PandaStatus-autorun-<timestamp>.tgz | grep -c '^PandaStatus/\.claude/work/'  # must be > 0
```

## A.3 Extract to a FRESH location, never over the existing tree

```bash
mkdir -p /Users/jeremykenedy/restore-test
cd /Users/jeremykenedy/restore-test
tar -xzf /Users/jeremykenedy/backups/PandaStatus-autorun-<timestamp>.tgz
cd PandaStatus
```

Extracting over the live tree mixes two states and you cannot tell which file came from
where. Extract beside it, verify, then decide.

## A.4 Verify the extracted repository

```bash
git rev-parse HEAD                       # the commit you expected to restore to
git rev-list --count HEAD                # the commit count you expected
git status --porcelain                   # must be empty: the tarball was taken from a clean tree
git fsck --full                          # must report no errors
git log --format='%an <%ae>' | sort -u   # exactly one line: Jeremy Kenedy <jeremykenedy@gmail.com>
```

Then re-arm the hooks, because `core.hooksPath` is repo-local config and a fresh extract
has it but a fresh clone would not:

```bash
make hooks
make check-hooks      # "pre-commit hook active"
make test-hook        # all cases pass
make residue          # CLEAN
```

## A.5 Swap in, if that is the decision

```bash
mv /Users/jeremykenedy/sites/PandaStatus /Users/jeremykenedy/sites/PandaStatus.broken-<timestamp>
mv /Users/jeremykenedy/restore-test/PandaStatus /Users/jeremykenedy/sites/PandaStatus
```

Keep the `.broken-` copy until you are certain. Disk is cheap.

## A.6 What the tarball does NOT contain

- **Flash dumps.** They live at `/Users/jeremykenedy/backups/PandaStatus/` and are never
  inside the repo tree, so they are never inside a repo tarball. See Part B.
- **The NVS partition.** Same location, same rule, and it holds live credentials.
- **The `private/` contents.** Gitignored; present on disk and therefore in the tarball,
  but not in git history.

---

# PART B. Restore the DEVICE to factory

## B.0 STATUS OF THIS SECTION

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║   PENDING DUMP.  No flash dump has been taken from this unit yet.                ║
║                                                                                  ║
║   Every value below marked  <PENDING DUMP>  is unknown today and is filled in    ║
║   by Phase 0 step e, when the partition table is parsed out of the first         ║
║   verified dump. Until then this section is a TEMPLATE. It cannot be executed.  ║
║                                                                                  ║
║   Do not guess a value to make a command runnable. A guessed offset written to   ║
║   flash is how a recoverable device becomes an unrecoverable one.                ║
║                                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

What IS known today, and where it was established:

| Fact | Value | Source |
|---|---|---|
| Product | Panda Status **P2** | device's own served page title and `settings.fw_version`, `firmware/SAFETY.md:19-20` |
| Chip family | ESP32-C3 | vendor spec page lists ESP32-C3-MINI, `backups/stock-capture-runsheet.md`. **Not yet confirmed off silicon.** |
| Flash size | **`<PENDING DUMP>`** | nothing in this repo establishes it. The OTA upload caps in the UI are shared framework constants and are not evidence. |
| Partition table | **`<PENDING DUMP>`** | parsed from the dump at offset 0x8000, Phase 0 step e |
| Dump location | `/Users/jeremykenedy/backups/PandaStatus/` | `CLAUDE.md` Phase 0 step c |

## B.1 What a complete backup set looks like

All at `/Users/jeremykenedy/backups/PandaStatus/`, **outside the repo**:

```
stock-full-1.bin                  first full read,  offset 0 through <FLASH_SIZE>
stock-full-2.bin                  second full read, different filename
stock-full-3.bin                  third full read
stock-full.bin                    the agreed copy: identical to at least two of the above
SHA256SUMS                        sha256 of every file above and every partition file below
partitions/
    bootloader.bin                offset 0x0            <PENDING DUMP> size
    partition-table.bin           offset 0x8000         <PENDING DUMP> size
    <name>.bin                    one per partition     <PENDING DUMP> offsets and sizes
    nvs.bin                       LIVE CREDENTIALS. Never leaves this directory.
img/
    <slot>.gif                    one per stage slot, 15 expected, each hashed
    img_version.txt               settings.img_version as read off the live device BEFORE the dump
RESTORE-THIS-UNIT.txt             MAC address of the unit these came from
```

A second copy of the whole directory lives **off this machine**. Where, and when it was
last synced, is recorded in `SESSION-STATE.md`. A dump that exists on one disk is one disk
failure away from being no dump.

## B.2 Before touching the cable

Walk `firmware/SAFETY.md` "PRE-FLASH GATE" top to bottom. Every line. It is a gate, not a
reminder. If any line is false, stop.

The one that catches the most mistakes: **the dump must be from THIS unit.** Verify by MAC,
read off the device now and compared to `RESTORE-THIS-UNIT.txt`. A dump from a different
unit restores that unit's Wi-Fi credentials and printer binding onto this one, and
silently the wrong factory image if the units differ.

## B.3 Identify the chip and flash, read-only

```bash
python3 -m esptool --chip auto --port <PORT> chip-id
python3 -m esptool --chip auto --port <PORT> flash-id
python3 -m esptool --chip auto --port <PORT> read-mac
```

Expect `chip-id` to report an ESP32-C3. If it does not, **stop**: every assumption in this
repo about the target is wrong and nothing below applies. `flash-id` reports the flash
size; it must match `<FLASH_SIZE>` recorded with the dump. `read-mac` must match
`RESTORE-THIS-UNIT.txt`.

These are reads. They are not flashing and do not need Rule 0 authorization, but they wait
for the phase gate that precedes them.

## B.4 The restore command, full image

The simplest and safest restore is the whole image back to offset 0. It restores the
bootloader, partition table, every app slot, the image partition, **and NVS**, which is
what puts the Wi-Fi credentials and printer binding back.

```bash
cd /Users/jeremykenedy/backups/PandaStatus

# 1. Verify the dump you are about to write. Do not skip this.
shasum -a 256 -c SHA256SUMS

# 2. Write it. <FLASH_SIZE> is the value flash-id reported AND the value recorded with the dump.
python3 -m esptool --chip esp32c3 --port <PORT> -b 460800 \
    write-flash --flash-size <PENDING DUMP: e.g. 4MB / 8MB / 16MB> \
    0x0 stock-full.bin
```

**Rule 0 applies to step 2.** It runs only with Jeremy's authorization in that message and
the cable confirmed connected.

If your esptool prints `write_flash` (underscore) in its help, you have an older version;
the underscore form is accepted by both.

## B.5 The restore command, per partition

Used when only one partition needs putting back, or when the full image fails to write.
Every offset and size comes from the parsed partition table and is recorded here in
Phase 0 step e.

```bash
cd /Users/jeremykenedy/backups/PandaStatus/partitions
shasum -a 256 -c ../SHA256SUMS

python3 -m esptool --chip esp32c3 --port <PORT> -b 460800 write-flash \
    0x0      bootloader.bin          \
    0x8000   partition-table.bin     \
    <PENDING DUMP: offset>  <PENDING DUMP: otadata or equivalent>.bin   \
    <PENDING DUMP: offset>  <PENDING DUMP: nvs>.bin                     \
    <PENDING DUMP: offset>  <PENDING DUMP: app slot 0>.bin              \
    <PENDING DUMP: offset>  <PENDING DUMP: app slot 1, if any>.bin      \
    <PENDING DUMP: offset>  <PENDING DUMP: img partition>.bin           \
    <PENDING DUMP: offset>  <PENDING DUMP: any further partition>.bin
```

The table above is filled in completely, one row per partition the dump actually
contains, **before** this document is considered finished. A row that says
`<PENDING DUMP>` at restore time means this section was never completed and the full-image
command in B.4 is the one to use.

## B.6 Verify the restore

A write that completes without error is not a verified restore. Read it back.

```bash
python3 -m esptool --chip esp32c3 --port <PORT> -b 460800 \
    read-flash 0x0 <FLASH_SIZE> /tmp/readback.bin
shasum -a 256 /tmp/readback.bin stock-full.bin
```

The two hashes must be identical. Then power-cycle and confirm the device serves its page
at the hostname it had before, with `settings.fw_version` reading `V1.0.0`, and the factory
UI's title reading Panda Status P2.

## B.7 If the device will not boot after a flash

Do not power-cycle repeatedly. Do not re-run the same write blind.

1. **Leave it powered and connected.** A device that still enumerates over USB is
   recoverable. Power cycles are what turn a bad flash into a brick when the bootloader
   region is the part that is wrong.
2. **Record exactly what was run and its full output**, including the esptool version.
3. **Check it still enumerates:** `python3 -m esptool --chip auto --port <PORT> chip-id`.
   If this works, the download mode is alive and a full restore from B.4 will recover it.
   If the device needs to be put into download mode by hand, hold its boot/IO9 button while
   applying power, then release; the exact button depends on the board and is recorded in
   `SESSION-STATE.md` once it has been identified on this unit.
4. **Full-image restore, B.4**, after re-verifying `SHA256SUMS`. Do not try to be clever
   with partial writes on a device that is not booting.
5. **Read back and compare, B.6.**
6. If `chip-id` does not respond in any mode, stop. Wait for Jeremy. Adding more writes on
   top of a device that is not enumerating cannot help and can hurt.

## B.8 If the dump is missing or fails verification

This is the scenario every rule exists to prevent. Be precise about which case you are in.

**Case 1: `SHA256SUMS` exists, one of the three reads fails to verify.**
Use one of the other two. Two reads must agree; three were taken so that one corruption
does not cost the backup. Record which file failed and keep it; do not delete evidence.

**Case 2: The three reads do not agree with each other, and the device is still factory.**
Nothing has been written yet. Read again, with a lower baud rate (`-b 115200`), until two
consecutive reads match byte for byte. Then take one more. A flash read can be corrupt and
still complete without error; disagreement is the read failing, not the flash.

**Case 3: The dump is missing or unreadable, and the device is still factory.**
Stop. Nothing is lost yet. Take the dump per Phase 0 before anything else happens. Do not
flash anything. Do not "test" anything. The device in your hand is the only copy of its
firmware.

**Case 4: The dump is missing or fails verification, and the device has already been
written to.**
There is no recovery to factory. Say so plainly. Do not pretend otherwise and do not flash a
V1/V2 image hoping it is close enough: it is a different board and the published images are
app-only with no bootloader, partition table or NVS. What remains possible is running this
project's firmware, which is the whole reason the clone exists. Record the loss in
`SESSION-STATE.md` so nobody later mistakes a clone for the factory image.

**Case 5: The off-machine copy is the only copy left.**
Verify its `SHA256SUMS` before trusting it. Copy it back, verify again, then proceed as
Case 1.

## B.9 The 15 images

The stage GIFs live in flash, are not reachable over HTTP, and are not published. They are
as irreplaceable as the firmware. They are restored as part of the img partition in B.4 or
B.5, and individually hashed in `SHA256SUMS` so that a damaged slot can be identified.

Never `POST /ota` with an `OTA-Type` naming a slot before the dump exists and verifies. It
overwrites a slot that cannot be recovered.

---

## What this document is not

It is not authorization. Rule 0 in `CLAUDE.md` and `firmware/SAFETY.md` governs every
write, every time, per message, with the cable connected. This document tells you how. It
never tells you that you may.
