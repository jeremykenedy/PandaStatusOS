# Flashing

**Nothing in this repository has been flashed to a device.** This page is the procedure the
project is built to follow. Every path on it goes through `tools/fw/preflight.sh`, which
refuses until a verified dump of the stock firmware exists; today it refuses on every check,
and that is correct. Read [firmware/SAFETY.md](../firmware/SAFETY.md) first: it says why.

## The one rule

**The first install never writes the bootloader or the partition table.** It is an OTA
into one of the stock firmware's own app slots, over the network, through the `POST /ota`
endpoint the factory firmware already serves. The bootloader, the partition table, NVS and
the images partition stay exactly as the factory left them, and the stock app stays in the
other slot. There is no cable in the first install at all.

That means the clone is built against the stock partition table, read out of the dump
(`tools/fw/partitions_from_dump.py`), never against a table this repository generates. The
committed `firmware/partitions.csv` is PROVISIONAL and is for host builds and the mock only;
the gate refuses while it says so.

## Before the first install

In this order, each step recorded (the run sheet is `backups/stock-capture-runsheet.md`):

1. Reference capture of the stock unit: video and WebSocket, while it is still running.
2. Identify the chip, read-only: `chip-id`, `flash-id`, `read-mac`. An ESP32-C3, or stop.
3. The stock golden, three reads over the cable, to three files, under
   `/Users/jeremykenedy/backups/PandaStatus/stock/`:
   ```
   tools/fw/golden.sh usb --stock --reads 3
   ```
   It identifies the chip, records the unit's MAC once, hashes and parses every read, sets
   them read-only, and says whether two agree. Read `settings.img_version` off the page
   before this and write it down.
4. The copy off this machine:
   ```
   tools/fw/golden.sh copy /Users/jeremykenedy/backups/PandaStatus/stock/GOLDEN-<ts>-full-<size>.bin <elsewhere>
   ```
5. The animations: `python3 tools/fw/flashimage.py gifs <the agreed read>` lists every whole
   GIF in the image with its sha256. Which one is which slot is a Phase 1 fact; once known,
   `stock/ANIMATIONS.sha256` gets one line per slot name.
6. The partition table into the build, and the restore document completed from it:
   ```
   python3 tools/fw/partitions_from_dump.py <the agreed read>
   ```
   then `backups/RESTORE.md` Part B, every PENDING DUMP filled from the same table, then
   `idf.py build`.
7. `make preflight` passes all eight checks.

## The first install, and every update after it

```
tools/fw/ota-install.sh <host> firmware/build/pandastatusos.bin
```

The script runs the gate, reads the image's identity (`esp_app_desc`: project, version,
build id, and the page it carries), checks that the unit answering at `<host>` has the MAC
the dump came from, records the device's build id and served-page hash, POSTs the image
with `OTA-Type: ota_fw`, waits for the device to come back, and reads both identifiers
again. It reports **FLASHED** only when the device now reports the image's build id and
serves the image's page, and both moved. Anything else is **NOT LANDED**.

The reason for that ceremony: the stock `/ota` answers 200 with an empty body whether the
upload landed or not. Three Panda Vent builds were each reported as flashed by their 200,
and none had landed. A 200 is recorded and means nothing.

Rule 0 governs this command like any other flash: it runs when the maintainer says so in
that message, and not before. Every run is appended to `flash-log.txt` under the backup
root.

**The first install changes the network.** The clone has no Wi-Fi credentials (it does not
read the factory's NVS; that layout is a Phase 1 fact), so it comes back on its own hotspot
(placeholder name `PandaStatus`, open, 192.168.4.1; the factory's own names are a
bench-session fact, D-027) showing the setup card. The address that took the upload never
answers again, and the script says so after 180 s. Join the hotspot and finish the proof
from there:

```
tools/fw/ota-install.sh verify 192.168.4.1
```

It re-reads the build id and the page against the expectation the upload recorded, and
gives the same FLASHED or NOT LANDED. Then set up Wi-Fi on the setup card; every later
install stays on the network and needs no second step.

## After the first install

1. A golden of the new state, over the network, while the stock app is still in the other
   slot:
   ```
   tools/fw/golden.sh http <host>
   ```
   This one is worth keeping for exactly that reason. `GET /backup` streams the whole flash
   with `X-Flash-Size` ahead of the body; a short read is refused and not kept. It answers
   only on the station interface, never over the hotspot (D-029).
2. The same image once more (`ota-install.sh` again with a fresh build), so both app slots
   hold the clone, then another golden. That golden is the clone's restore point. A golden
   taken after a single OTA has the previous image one rollback away from live.

Updates thereafter are the same command, or the System page, which sends the same request.
The image pack and single animations go the same way with `OTA-Type: ota_img` or a slot
name, into the images partition, under the caps the factory page enforces (4.5 MB firmware,
6.875 MB pack, 1.5 MB per animation).

## If the device will not boot

The one situation the network cannot reach. Then, and only then, the cable:

```
tools/fw/usb-app-write.sh firmware/build/pandastatusos.bin
```

It runs the gate, checks chip, flash size and MAC against the record, reads the app slot
offsets out of the stock dump's table and `otadata` off the device to learn which slot the
bootloader boots, writes the image to that slot at that offset, and reads the slot back to
verify. Nothing else is written: not 0x0, not 0x8000, not NVS, not the images.

## Going back to the factory firmware

Three restores, in order of how much they write, in [backups/RESTORE.md](../backups/RESTORE.md)
Part B: the stock app back over OTA, the stock app back over USB into one slot, and the
whole image back over USB. None of the three is safe without a verified dump. Only the
third writes the bootloader and the partition table, and it exists to put a verified golden
back, for nothing else.

## What never happens

- No `make` target flashes. None will be added.
- Nothing in this repository erases the chip; the token for it fails `make residue`.
- Nothing writes 0x0 or 0x8000 except the whole-image restore of a verified golden.
- Nothing is flashed without the gate, and the gate has no override.
