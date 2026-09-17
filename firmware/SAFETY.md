# SAFETY

Read before any operation that touches the device. This document describes a gate, not
a procedure. The procedures are in [docs/FLASHING.md](../docs/FLASHING.md) and
[backups/RESTORE.md](../backups/RESTORE.md); every one of them passes through the gate
below, and the gate is a script that refuses.

## Why this exists, in plain language

On 2026-08-30 the Panda Vent's factory firmware was made permanently unrecoverable. The
first flash of that project wrote the stock bootloader and partition table along with the
app. Only the app had been backed up. BIQU publishes app images only, so there was nothing
to restore the bootloader or the table from, and the factory firmware was gone from that
unit for good. The cause is written down in that project's own records
(`~/vent-control/goldens/README.md`), and it is the reason for every rule here.

The Panda Status P2 is worse positioned than the vent was. BIQU publishes **no P2 image at
all**, not even an app (checked 2026-08-27: the GitHub firmware directory holds v1.0.0,
v1.0.1, v1.0.2 and v2.0.0, all V1/V2 images titled "Panda Status V1" where they carry a
page; the wiki's P2 release page lists one entry with no download link). The full flash
dump taken from this unit will be the only copy of its firmware in existence. Lose it, or
write over the wrong region before it exists, and the factory firmware is gone from the
world, not just from the device.

## THE RULE

**The first install of PandaStatusOS never writes the bootloader or the partition table.**
There is no version of this task where it needs to.

An OTA writes one app slot. It does not touch 0x0, it does not touch 0x8000, it does not
touch NVS, and it does not touch the images partition holding the fifteen animations. The
stock firmware already serves `POST /ota`. So the first install goes through the factory's
own OTA endpoint, over the network, with no cable connected. The stock app stays in the
other slot, and the bootloader falls back to it if the clone fails to boot.

Consequences, each of them enforced by a script rather than by memory:

- **The clone is built against the stock partition table, read out of the dump.** Not a
  table this repository generates. `firmware/partitions.csv` is PROVISIONAL today and the
  gate refuses while it is; `tools/fw/partitions_from_dump.py` replaces it from the dump.
- **Nothing in this repository writes 0x0 or 0x8000** except the whole-image restore in
  `backups/RESTORE.md`, which exists to put a verified dump back and for nothing else.
- **Nothing in this repository erases the chip.** The esptool subcommand that does is a
  forbidden token in every tracked file (`make residue` fails on it).
- **There is no `make` target that flashes**, and there never will be one. The IDF target
  that writes bootloader, table and app together is exactly the operation that lost the
  vent's firmware, and it must not be reachable by muscle memory at two in the morning.

## THE GATE: tools/fw/preflight.sh

Every flash path calls it first: `tools/fw/ota-install.sh` (the network install),
`tools/fw/usb-app-write.sh` (the cable fallback), and the whole-image restore by hand.
It refuses unless all of these pass, and it prints which one did not:

```
 1. A full dump of the STOCK firmware exists outside the repository, under
    /Users/jeremykenedy/backups/PandaStatus/stock/, and every file verifies against its
    own .sha256 now, not remembered from earlier.
 2. At least two independent reads of it exist and their sha256 match byte for byte.
 3. The agreed image parses: partition table at 0x8000 with its MD5, every partition
    enumerated, every app slot starting with the 0xE9 image magic and carrying
    esp_app_desc at +0x20 (project, version, IDF version, build).
 4. A copy exists off this machine, recorded by path and sha256 in stock/OFFMACHINE.tsv,
    and re-hashed now when the path is reachable. A dump on one disk is not a backup.
 5. The fifteen animation slots each have their own recorded sha256, by name, in
    stock/ANIMATIONS.sha256. They exist nowhere else in the world.
 6. backups/RESTORE.md Part B carries no PENDING DUMP placeholder. Every offset is real.
 7. firmware/partitions.csv is the stock table read from that dump, not a generated one.
 8. The unit the dump came from is recorded by MAC in stock/RESTORE-THIS-UNIT.txt, so a
    flash can refuse a different unit.
```

**There is no override flag and no `--force`.** A check that can be waived is not a gate.
`make preflight` runs it read-only at any time; today it refuses on all eight, because no
dump exists yet, and that is the correct answer.

On top of the gate, the network install refuses a unit whose MAC (from the ARP table)
differs from the recorded one, and the cable fallback refuses a chip that is not an
ESP32-C3, a flash size other than the recorded one, or a MAC other than the recorded one.

## RULE 0. Flashing requires explicit per-message authorization.

Nothing is flashed unless Jeremy says so in that message.

- Authorization does not carry over from a previous message or a previous session.
- "Go ahead with Phase 2" is not flash authorization. "Yes" to a different question is not.
- No flashing to test. No flashing to check. No flashing because it seemed implied.
- The first install is an OTA over the network. It is still a flash, and Rule 0 still
  governs it: the script is run only when that message says to run it.

Read operations (chip-id, flash-id, read-flash, read-mac, GET /backup) are not flashing,
but they wait for the phase gate that precedes them, and they run only with the
maintainer present.

## THE ORDER

1. Video and WebSocket reference capture of the stock unit
   (`backups/stock-capture-runsheet.md`). Once the clone is installed the stock behaviour
   is no longer running; the stock app in the other slot is a file, not a demonstration.
2. Hardware identification, read-only: `chip-id`, `flash-id`, `read-mac`. An ESP32-C3 with
   the flash size the dump will be taken at, or everything this repository assumes is wrong.
3. **The stock golden, three reads:** `tools/fw/golden.sh usb --stock --reads 3`. Each read
   to its own file, each chmod 444, each hashed and parsed; the script says whether two
   agree. `settings.img_version` is read off the page before this and recorded.
4. **The copy off this machine:** `tools/fw/golden.sh copy <agreed read> <somewhere else>`.
5. **The animations:** `tools/fw/flashimage.py gifs <agreed read>` lists every whole GIF in
   the image with its hash; the mapping to the fifteen slot names is a Phase 1 fact and is
   written into `stock/ANIMATIONS.sha256` by hand, one line per slot.
6. **The partition table:** `python3 tools/fw/partitions_from_dump.py <agreed read>`, then
   rebuild. `backups/RESTORE.md` Part B is completed from the same table.
7. `make preflight` passes. Only now is a write discussable.
8. **The first install, over the network:** `tools/fw/ota-install.sh <host> <app.bin>`,
   when Rule 0 says so. The script proves the flash landed or says NOT LANDED.
9. **A golden of the new state**, over the network: `tools/fw/golden.sh http <host>`. This
   one holds the stock app in the other slot and is worth keeping for that reason.
10. The same image once more, so both slots hold it, then another golden: that is the
    restore point for the clone.

## GOLDENS

A golden is the entire flash: bootloader, partition table, otadata, both app slots, the
images partition and NVS. Restoring one puts the device back exactly as it was.

- Taken **before** any flash, never after. A backup taken after the damage is not a backup.
- chmod 444 on capture. New captures get new filenames. Nothing is ever overwritten.
- Both app slots are read and recorded on every capture (`MANIFEST.tsv`). An OTA writes
  only the inactive slot, so a golden taken after one flash still holds whatever was there
  before in the other half. On the vent a test build sat one rollback away from live for
  exactly that reason. Flash the same image twice before a golden meant as a restore point.
- Never committed. NVS inside them carries the Wi-Fi password, the printer serial and its
  access code in plaintext. They live under `/Users/jeremykenedy/backups/PandaStatus/`, and
  nowhere inside any repository.

`GET /backup` in the clone is what makes goldens cheap after the first install: the whole
flash over Wi-Fi in seconds instead of minutes over the cable, byte-identical to an esptool
read (proven on the vent for the bootloader and table; to be proven on the P2 by comparing
the first network golden against the USB stock golden's unchanged regions). It is served on
the station interface only, because the hotspot is open by default and NVS is in the image.

## THE THREE RESTORES

`backups/RESTORE.md` Part B separates them. None of the three is safe to run without a
verified dump; the first two are safe to run without the cable.

| Restore | Writes | Needs | When |
|---|---|---|---|
| App only, over OTA | one app slot | the stock app image extracted from the dump, the network | the clone runs but you want the factory app back |
| App only, over USB | one app slot at the offset from the dump's table | the cable, `tools/fw/usb-app-write.sh` | the device will not boot, so it cannot serve `/ota` |
| The whole image | every region, 0x0 to the end | the cable, the agreed golden, its hash verified now | the bootloader, the table, NVS or the images are damaged |

## IF SOMETHING GOES WRONG MID-WRITE

Do not power cycle and hope. Do not re-run the same command blind.

1. Stop. Leave the device powered and connected.
2. Report exactly what command was run and its full output. `flash-log.txt` under the
   backup root has every run of the install scripts.
3. Wait for Jeremy.

An interrupted OTA leaves a half-written inactive slot and a bootloader that still boots
the other one; the device usually comes back on its own. An interrupted USB write is the
case the whole-image restore exists for, and it requires the device to still enumerate in
download mode. Adding writes on top of a failed write makes that harder.

## THE PUBLISHED BINARIES ARE NOT A RESTORE PATH

https://github.com/bigtreetech/Panda_Status/tree/master/Firmware ships application images
only, all of them V1/V2. No bootloader. No partition table. No NVS. No P2. Writing one of
those to this unit restores nothing and, being a different board's image, may not boot.
They are reference material for comparing against the dumped app, and nothing else.

| Version | File | bytes | sha256 |
|---|---|---|---|
| v1.0.0 | panda_status_v1.0.0.bin | 1446384 | f317a8a76f1b575467bec007a9768e7951c51603dfdf9de68c4152721a573732 |
| v1.0.1 | panda_status_v1.0.1.bin | 1447808 | b12127a83f8ed035a310097e7ecc2fdc4a66edc0071942d810068e996bd62228 |
| v1.0.2 | panda_status_v1.0.2.bin | 1452224 | eede7abf5e824f31d071bcd962c428cce112706086fa642989c33f95dc9d5358 |
| v2.0.0 | panda_status_v1.0.3.bin | 1246784 | e77549a31714cfa14e3632713e10232c93604eb4a84d0ce37434c7fab08e6c9a |

The v2.0.0 directory contains a file named v1.0.3. That is upstream's real naming. Only the
v2.0.0 image carries an embedded page, a gzip member titled "Panda Status V1" at file offset
109996; the unit on hand serves a different, uncompressed page titled "Panda Status P2".

## NVS

The NVS partition holds the live Wi-Fi credentials, the printer serial and the access code.

- It never enters the repository. Not committed, not gitignored, not in `private/`.
- It lives only inside the goldens under `/Users/jeremykenedy/backups/PandaStatus/`.
- Values recovered from it are referenced in `docs/` by name only (`<WIFI_SSID>`,
  `<PRINTER_ACCESS_CODE>`, `<DEVICE_MAC>`, `<DEVICE_SERIAL>`), never by value.
- Restoring NVS is part of the whole-image restore only. An app-only restore leaves NVS as
  it is, which is what keeps the device on the network afterwards.

## WHAT IS STILL INFERENCE

- Whether the stock bootloader honours OTA rollback (an image that boots and then fails to
  confirm itself) or only image validation (an image that fails its checksum). Read from the
  dump's bootloader at Phase 1. Until then, "the bootloader rolls back" means the second
  kind for certain and the first kind if the stock build enabled it.
- Whether an app built with ESP-IDF v5.3.1 boots under the stock bootloader. The dump's
  esp_app_desc says which IDF built the stock app; `tools/fw/preflight.sh` prints it.
- That GET /backup reads back byte-identical on the P2. Proven on the vent; compared on the
  P2 the first time a network golden exists beside the USB one.
