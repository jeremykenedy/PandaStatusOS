# SAFETY

Read before any operation that touches the device.

## THE ONE RULE THAT MATTERS

**A first install over stock cannot self-revert.**

The stock unit ships with the factory application and a factory bootloader and
partition table. Once anything is written over that flash, the factory image is gone
from the device. There is no recovery partition, no factory-reset-to-stock, no OTA
rollback to a slot that still holds the original. The device cannot put itself back.

**The full flash dump is the only revert path.** If the dump is missing, unverified,
or was taken from a different unit, the stock firmware is unrecoverable.

### For this unit that is literal, not rhetorical

This is a **Panda Status P2**, confirmed 2026-08-27 from the device's own served UI
(`<title>Panda Status P2</title>`) and from `settings.fw_version` = `V1.0.0`.

**No P2 firmware image is published anywhere.** Checked 2026-08-27:

- `github.com/bigtreetech/Panda_Status/Firmware` contains v1.0.0, v1.0.1, v1.0.2 and
  v2.0.0. All are V1/V2 images. Their embedded UI, where present, is titled
  "Panda Status V1". None is a P2 image.
- The BTT wiki P2 firmware release notes page lists exactly one entry, `v1.0.0-release`,
  "Initial factory firmware release", and offers **no download link of any kind**.

So there is no vendor fallback, no community image, and no published binary to fall back
on. For the V1/V2 units a botched flash is an inconvenience. For this unit it is
permanent. The dump is not the best revert path, it is the **only one in existence**.

### Consequence: three reads, not two

1. Take **three** independent full-flash reads.
2. **Two must agree byte for byte** before the third is even considered redundant.
3. If any two disagree, keep reading until two consecutive reads match, then take one
   more.
4. **One copy goes off this machine.** A dump that exists only on the Mac is one disk
   failure away from being no dump at all.

### The img partition gets the same rule

The device carries 15 GIF assets, one per print stage. **None is reachable over
HTTP** (every path but `/` and `/ota` returns a captive-portal redirect) and **none is
published anywhere**. They are as irreplaceable as the firmware.

- The img partition gets the **same three-read, two-must-agree** treatment as the app.
- Each of the 15 slots gets **its own sha256** and **its own line in `RESTORE.md`**.
- `settings.img_version` is recorded **before** the dump, off the live device, or the
  extracted images cannot be tied to a version afterwards.
- Uploading a GIF via `POST /ota` with `OTA-Type: <slot>` **overwrites a slot that
  cannot be recovered**. Never upload before the dump exists and verifies.

The firmware plus these 15 images are the entire irreplaceable surface of this unit.

## RULE 0. Flashing requires explicit per-message authorization.

Nothing is flashed unless Jeremy says so in that message, with the cable connected.

- Authorization does not carry over from a previous message.
- Authorization does not carry over from a previous session.
- "Go ahead with Phase 2" is not flash authorization.
- "Yes" to a different question is not flash authorization.
- No flashing to test. No flashing to check. No flashing because it seemed implied.

Read operations (chip_id, flash_id, read_flash, read_mac) are not flashing and are not
covered by this rule, but they still wait for the phase gate that precedes them.

## PRE-FLASH GATE

This is a gate, not a checklist. It is walked in full, in order, **before every first
flash over factory**, by a person, out loud or in writing. Every line is a yes or the gate
is closed. There is no partial pass, no "mostly", and no authority that waives a line.

A line that cannot be answered yes is answered "closed", and the session moves to
something else. Nothing here is ever skipped because the cable is already plugged in.

```
 1. AUTHORIZATION.   Jeremy authorized THIS flash, in THIS message, naming it.      [ ]
 2. CABLE.           Connected, and he confirmed it in the same message.             [ ]
 3. THREE READS.     Three independent full-flash reads exist on disk,
                     taken at offset 0 through the full flash size flash-id
                     reported, each under its own filename.                        [ ]
 4. TWO MUST AGREE.  At least two of the three are byte-identical, proven by
                     sha256 just now, not remembered from earlier.                  [ ]
 5. OFF-MACHINE.     One verified copy of the whole backup set exists on a
                     device that is not this Mac, and its SHA256SUMS verified
                     there. A dump on one disk is not a backup.                     [ ]
 6. IMG PARTITION.   The image partition had the same three-read, two-agree
                     treatment as the app, and settings.img_version was read
                     off the live device and recorded BEFORE the dump.              [ ]
 7. FIFTEEN GIFs.    All fifteen stage images are extracted, each hashed, each
                     with its own line in SHA256SUMS and RESTORE.md. They exist
                     nowhere else in the world. None has been uploaded over.        [ ]
 8. THIS UNIT.       The MAC read off the device now matches the MAC recorded
                     with the dump. The dump is from this unit, proven, not
                     assumed.                                                       [ ]
 9. RESTORE.md.      backups/RESTORE.md Part B carries no <PENDING DUMP> marker.
                     Every offset is real, every command is complete, and it was
                     read through end to end today.                                 [ ]
10. CHIP.            chip-id reported an ESP32-C3 and flash-id reported the flash
                     size the dump was taken at. If either differs, everything
                     this repo assumes about the target is wrong. Gate closed.      [ ]
11. READABLE NOW.    The dump files at /Users/jeremykenedy/backups/PandaStatus/
                     are readable at this moment, not "were there last week".       [ ]
12. NO PUBLISHED FALLBACK, ACKNOWLEDGED.
                     No P2 image exists anywhere. If this flash goes wrong and the
                     dump is bad, the factory firmware is gone from the world. The
                     person flashing has read this line and says so.                [ ]
```

**Twelve yes, or the gate is closed.** Write the twelve answers down with the date before
the write command is typed. That record is what gets read if something goes wrong.

## READ-BEFORE-WRITE ORDER

The order is not negotiable.

1. Video and WebSocket reference capture of the stock unit. Once flashed, the stock
   behaviour is gone and cannot be recaptured. See
   `backups/stock-capture-runsheet.md`.
2. Hardware identification. **Already established as P2 from the UI**, and to be
   confirmed against esptool at step b. V1/V2 and P2 are different boards. Flashing a
   V1/V2 image to a P2 or the reverse is a hardware-level mistake, not a software one,
   and there is no published P2 image to flash in any case.
3. Full dump.
4. Second full dump. sha256 both. They must match. A single read is not a backup. A
   flash read can be corrupt and still complete without error.
5. **Third full dump**, per the no-published-fallback rule above.
6. **One copy moved off this machine.**
7. Partition table parsed, every partition dumped and hashed. The GIF assets live in
   flash and are not retrievable over HTTP, so they get their own sha256 entries and
   their own line in `RESTORE.md`.
8. Restore command written down and reviewed.

Only after all eight is a write even discussable.

## NVS

The NVS partition contains live Wi-Fi credentials and likely the printer access code
and serial.

- It never enters the repo. Not committed, not gitignored, not in `.claude/work/`.
- It lives only at /Users/jeremykenedy/backups/PandaStatus/.
- It is never pasted into chat, docs, commit messages, or issue text.
- Values recovered from it are referenced by name in `docs/` (`<WIFI_SSID>`,
  `<PRINTER_ACCESS_CODE>`, `<DEVICE_MAC>`, `<DEVICE_SERIAL>`), never by value.
- Restoring NVS is part of the restore path. Restoring an app image without NVS leaves
  the device unable to rejoin the network.

## THE PUBLISHED BINARIES ARE NOT A RESTORE PATH

https://github.com/bigtreetech/Panda_Status/tree/master/Firmware ships application
images only. No bootloader. No partition table. No NVS.

Writing one of those to a wiped device does not restore it. They are useful for one
thing: comparing against the dumped app image to confirm which published version this
unit shipped with. Treat them as reference, never as recovery.

Published reference images, all four verified by download on 2026-08-27. **All are
V1/V2. None is a P2 restore path. None is any kind of restore path.**

| Version | File | bytes | sha256 |
|---|---|---|---|
| v1.0.0 | panda_status_v1.0.0.bin | 1446384 | f317a8a76f1b575467bec007a9768e7951c51603dfdf9de68c4152721a573732 |
| v1.0.1 | panda_status_v1.0.1.bin | 1447808 | b12127a83f8ed035a310097e7ecc2fdc4a66edc0071942d810068e996bd62228 |
| v1.0.2 | panda_status_v1.0.2.bin | 1452224 | eede7abf5e824f31d071bcd962c428cce112706086fa642989c33f95dc9d5358 |
| v2.0.0 | panda_status_v1.0.3.bin | 1246784 | e77549a31714cfa14e3632713e10232c93604eb4a84d0ce37434c7fab08e6c9a |

The v2.0.0 directory contains a file named v1.0.3. That is upstream's real naming,
verified against the repo listing, not a transcription error.

Only the v2.0.0 image carries an embedded web UI: a gzip member at file offset 109996
whose FNAME field is `xindex.html`, raw deflate payload starting at 110018, inflating
to 313,255 bytes titled "Panda Status V1". That resolves where the `xindex.html` string
comes from. The device on hand serves a different, uncompressed, 278,771 byte file
titled "Panda Status P2".

## IF SOMETHING GOES WRONG MID-WRITE

Do not power cycle and hope. Do not re-run the same command blind.

1. Stop. Leave the device powered and connected.
2. Report exactly what command was run and its full output.
3. Wait for Jeremy.

An interrupted write leaves partial flash. The recovery is a full restore from the
verified dump per `backups/RESTORE.md`, which requires the device to still enumerate in
download mode. Adding more writes on top of a failed write can make that harder.
