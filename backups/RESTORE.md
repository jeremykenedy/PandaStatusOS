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
/Users/jeremykenedy/backups/PandaStatus-autorun-<timestamp>.tgz    at each checkpoint
```

Each is a plain `tar -czf` of the whole `PandaStatus/` directory taken from its parent,
so it contains `PandaStatus/.git/`, `PandaStatus/private/` (the working area, including
`secrets/`) and every tracked file. Newest timestamp is newest state.

Every tarball's sha256 is recorded in the working notes under `private/` at the time it
was taken. **If the tarball you are about to trust has no recorded sha256, or the hash does
not match, do not use it.** Find an older one that verifies.

## A.2 Verify before extracting

```bash
cd /Users/jeremykenedy/backups
shasum -a 256 PandaStatus-autorun-<timestamp>.tgz
# compare against the value recorded in the working notes for that timestamp

tar -tzf PandaStatus-autorun-<timestamp>.tgz | grep -c '^PandaStatus/\.git/'          # must be > 0
tar -tzf PandaStatus-autorun-<timestamp>.tgz | grep -c '^PandaStatus/private/'        # must be > 0
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

# PART B. Restore the DEVICE

Three restores, separated by what they write. **None of the three is safe to run without a
verified dump of the stock firmware**, and `tools/fw/preflight.sh` refuses all three until
one exists. The first two need no cable. Only the third writes the bootloader and the
partition table, and it exists to put a verified golden back, for nothing else.

| | Writes | Over | Needs | Use when |
|---|---|---|---|---|
| **B.4 app only, OTA** | one app slot | the network | the stock app image cut out of the dump | the clone runs and you want the factory app back |
| **B.5 app only, USB** | one app slot, at the offset from the dump's table | the cable | `tools/fw/usb-app-write.sh` | the device will not boot, so it cannot serve `/ota` |
| **B.6 the whole image** | every region, 0x0 to the end | the cable | the agreed golden, its hash verified now | the bootloader, the table, NVS or the images are damaged |

## B.0 STATUS OF THIS SECTION

```
╔══════════════════════════════════════════════════════════════════════════════════╗
║                                                                                  ║
║   PENDING DUMP.  No flash dump has been taken from this unit yet.                ║
║                                                                                  ║
║   Every value below marked  <PENDING DUMP>  is unknown today and is filled in    ║
║   from the partition table inside the first verified dump. Until then this       ║
║   section is a TEMPLATE. It cannot be executed, and tools/fw/preflight.sh        ║
║   check 6 refuses every flash while a single placeholder remains.                ║
║                                                                                  ║
║   Do not guess a value to make a command runnable. A guessed offset written to   ║
║   flash is how a recoverable device becomes an unrecoverable one.                ║
║                                                                                  ║
╚══════════════════════════════════════════════════════════════════════════════════╝
```

What IS known today, and where it was established:

| Fact | Value | Source |
|---|---|---|
| Product | Panda Status **P2** | device's own served page title and `settings.fw_version`, `firmware/SAFETY.md` |
| Chip family | ESP32-C3 | vendor spec page lists ESP32-C3-MINI, `backups/stock-capture-runsheet.md`. **Not yet confirmed off silicon.** |
| Flash size | **`<PENDING DUMP>`** | nothing in this repo establishes it; `flash-id` at the bench |
| Partition table | **`<PENDING DUMP>`** | parsed from the dump at offset 0x8000 by `tools/fw/flashimage.py` |
| Stock app's IDF version | **`<PENDING DUMP>`** | `esp_app_desc` in the dump, printed by `preflight.sh` |
| Backup root | `/Users/jeremykenedy/backups/PandaStatus/` | `docs/PLAN.md`, Phase 0 |

## B.1 What a complete backup set looks like

All under `/Users/jeremykenedy/backups/PandaStatus/`, **outside every repository**, written
and checked by `tools/fw/golden.sh`:

```
stock/                              the factory firmware, taken BEFORE any flash, over the cable
    GOLDEN-<ts>-full-<size>.bin     one file per read, three reads, chmod 444, never overwritten
    GOLDEN-<ts>-full-<size>.sha256  beside each; "sha256  filename", checked with shasum -c
    RESTORE-THIS-UNIT.txt           MAC=, CHIP=, FLASH_SIZE=, TAKEN=; written once, checked on every later read
    OFFMACHINE.tsv                  sha256, path, when, host: the copy that is not on this Mac
    ANIMATIONS.sha256               fifteen lines, "sha256  slot_name", one per stage slot, from B.9
goldens/                            every later capture (over the network once the clone runs)
    GOLDEN-<ts>-full-<size>.bin     same rules
MANIFEST.tsv                        one line per capture: time, file, sha256, size, method, both slots, animations, note
flash-log.txt                       every run of ota-install.sh and usb-app-write.sh, with its verdict
```

`preflight.sh` reads `stock/`, and only `stock/`, for its eight checks (`firmware/SAFETY.md`).
`goldens/` is where the clone's own restore points go; they are goldens of a modified device
and never satisfy the stock checks.

## B.2 Before touching anything

```
make preflight
```

Eight PASS lines, or stop. The one that catches the most mistakes: **the dump must be from
THIS unit**, by MAC. `ota-install.sh` checks it through the ARP table; `usb-app-write.sh`
and `golden.sh usb` check it through `read-mac`. A dump from a different unit restores that
unit's credentials and printer binding onto this one, and silently the wrong image if the
units differ.

## B.3 Identify the chip and the flash, read-only

```
python3 -m esptool --chip auto --port <PORT> chip-id
python3 -m esptool --chip auto --port <PORT> flash-id
python3 -m esptool --chip auto --port <PORT> read-mac
```

Expect an ESP32-C3. If not, **stop**: every assumption in this repository is wrong and
nothing below applies. The flash size must match `RESTORE-THIS-UNIT.txt`; so must the MAC.
`golden.sh usb` runs all three and refuses on a mismatch before it reads anything.

## B.4 App only, over OTA: the stock app back, no cable

The clone is running and you want the factory application back in the boot slot. Cut the
stock app out of the agreed dump and send it the way any update is sent:

```
cd /Users/jeremykenedy/backups/PandaStatus/stock
python3 ~/sites/PandaStatus/tools/fw/flashimage.py inspect GOLDEN-<ts>-full-<size>.bin      # which slot held the stock app
python3 ~/sites/PandaStatus/tools/fw/flashimage.py extract GOLDEN-<ts>-full-<size>.bin <PENDING DUMP: stock app slot name> stock-app.bin
~/sites/PandaStatus/tools/fw/ota-install.sh <host> stock-app.bin
```

`extract` cuts the slot at the end of the app image inside it. The install script proves
the result the same way it proves a clone install: afterwards the device must serve the
page the stock app carries and no `X-Build` header, because the factory has none. The
factory's page is embedded raw, and the script hashes the raw document from `<!DOCTYPE` to
`</html>`; if the factory serves it with any trailing bytes the hash differs and the
script reports NOT LANDED for a restore that did land. INFERENCE until seen once: if that
happens, open the page; the title reads "Panda Status P2" and `settings.fw_version` reads
`V1.0.0`, and that is the verification.

This writes one app slot. NVS keeps the network and the printer binding; the images keep
the animations; the clone stays in the other slot as the rollback target.

## B.5 App only, over USB: one slot, one offset from the dump

The device will not boot, so it cannot serve `/ota`:

```
~/sites/PandaStatus/tools/fw/usb-app-write.sh /Users/jeremykenedy/backups/PandaStatus/stock/stock-app.bin --port <PORT>
```

The script runs the gate, checks chip, flash size and MAC, reads the slot offsets out of the
stock dump's partition table, reads `otadata` off the device to learn which slot the
bootloader boots, writes the image there, and reads it back to verify. `--slot <name>`
names another slot. It never writes anything else. **The flashing rule applies**: only when the
maintainer says so in that message.

The offsets, once the dump exists:

| Slot | Offset | Size |
|---|---|---|
| `<PENDING DUMP: first app slot>` | `<PENDING DUMP>` | `<PENDING DUMP>` |
| `<PENDING DUMP: second app slot, if any>` | `<PENDING DUMP>` | `<PENDING DUMP>` |
| otadata | `<PENDING DUMP>` | `<PENDING DUMP>` |

## B.6 The whole image: the only restore that writes the bootloader and the table

For a device whose bootloader, partition table, NVS or images are damaged. This is the one
write in this project that touches 0x0 and 0x8000, and it exists only to put a verified
golden back.

```
cd /Users/jeremykenedy/backups/PandaStatus/stock

# 1. The gate, then the hash of the exact file about to be written, now.
make -C ~/sites/PandaStatus preflight
shasum -a 256 -c GOLDEN-<ts>-full-<size>.sha256

# 2. Write it. The flash size is the one in RESTORE-THIS-UNIT.txt and the one flash-id reports.
python3 -m esptool --chip esp32c3 --port <PORT> -b 460800 \
    --before default_reset --after hard_reset \
    write-flash --flash-size <PENDING DUMP: 4MB / 8MB / 16MB> \
    0x0 GOLDEN-<ts>-full-<size>.bin
```

**The flashing rule applies to step 2.** It runs only with Jeremy's authorization in that message and
the cable confirmed connected. If your esptool prints `write_flash` (underscore) in its
help, you have an older version; both spellings are accepted.

Then read it back. A write that completes without error is not a verified restore:

```
python3 -m esptool --chip esp32c3 --port <PORT> -b 460800 read-flash 0x0 <PENDING DUMP: size in bytes> /tmp/readback.bin
shasum -a 256 /tmp/readback.bin GOLDEN-<ts>-full-<size>.bin      # identical
```

Then power-cycle and confirm the device serves its page at the hostname it had, with
`settings.fw_version` reading `V1.0.0` and the page title reading "Panda Status P2".

## B.7 If the device will not boot after a write

Do not power-cycle repeatedly. Do not re-run the same write blind.

1. **Leave it powered and connected.** A device that still enumerates over USB is
   recoverable. Power cycles are what turn a bad flash into a brick when the bootloader
   region is the part that is wrong, and nothing in this project writes that region
   except B.6.
2. **Record exactly what was run and its full output.** `flash-log.txt` under the backup
   root has every run of the scripts; add the esptool version.
3. **Check it still enumerates:** `python3 -m esptool --chip auto --port <PORT> chip-id`.
   If the device needs download mode by hand, hold its boot button while applying power,
   then release; the exact button is recorded in `SESSION-STATE.md` once identified.
4. An app that will not boot: **B.5**, the stock app into the boot slot. The bootloader
   and table are untouched by any OTA, so this is usually enough.
5. Anything else: **B.6**, after re-verifying the hash. Do not try to be clever with
   partial writes on a device that is not booting.
6. If `chip-id` does not respond in any mode, stop. Wait for Jeremy.

## B.8 If the dump is missing or fails verification

Be precise about which case you are in.

**Case 1: one of the three reads fails its `.sha256`.** Use one of the others; two must
agree, and three were taken so one corruption does not cost the backup. Keep the failed
file; do not delete evidence.

**Case 2: no two reads agree, and the device is still factory.** Nothing has been written.
Read again (`golden.sh usb --stock`), at a lower baud rate if it keeps happening, until two
consecutive reads match. A flash read can be corrupt and still complete without error.

**Case 3: the dump is missing, and the device is still factory.** Stop. Nothing is lost
yet. Take the dump per `firmware/SAFETY.md`. Do not flash anything. Do not "test" anything.
The device in your hand is the only copy of its firmware.

**Case 4: the dump is missing or fails verification, and the device has been written to.**
If the write was an OTA, the stock app is still in the other slot: `golden.sh http` takes a
golden of the device as it is, and `flashimage.py extract` cuts the stock app out of it. That
app, the bootloader and the table are then recoverable; the animations too, since no OTA of
firmware touches the images partition. If the write was B.6 with a bad image, there is no
recovery to factory. Say so plainly; do not flash a V1/V2 image hoping it is close enough
(a different board, app-only, no bootloader, no table, no NVS). What remains is running this
project's firmware. Record the loss in `SESSION-STATE.md`.

**Case 5: the off-machine copy is the only copy left.** Verify its `.sha256` before
trusting it. Copy it back, verify again, then proceed as Case 1.

## B.9 The fifteen animations

They live in the images partition, are not reachable over HTTP, and are not published. They
are as irreplaceable as the firmware. `python3 tools/fw/flashimage.py gifs <golden>` lists
every whole GIF in the image outside the app slots, with offset, length and sha256; the
mapping from those to the fifteen slot names is established in Phase 1 and written into
`stock/ANIMATIONS.sha256`, one line per slot. They are restored by B.6, and identified
individually by that file when a damaged slot must be found.

Never `POST /ota` with an `OTA-Type` naming a slot before the dump exists and verifies. It
overwrites a slot that cannot be recovered.

---

## What this document is not

It is not authorization. The flashing rule in `firmware/SAFETY.md` governs every
write, every time, per message. This document tells you how. It never tells you that you
may.
