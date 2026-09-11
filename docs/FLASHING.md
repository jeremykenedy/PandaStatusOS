# Flashing

**Nothing in this repository has been flashed to a device.** This page describes the
procedure the project is built to follow; the numbers in it are the PROVISIONAL
partition table's and change the day a unit's flash is read. Do not flash from this
page until [backups/RESTORE.md](../backups/RESTORE.md) Part B has real values in it.

## The one rule

A first install over the factory firmware cannot self-revert. The factory image is not
published anywhere, so the full flash dump you take first is the only way back. Read
[firmware/SAFETY.md](../firmware/SAFETY.md); it ends with the gate every flash passes
through.

## Before the first install

1. Identify the chip and the flash size, read-only: `esptool.py chip_id`, `flash_id`.
   The chip is expected to be an ESP32-C3; that expectation has not been confirmed off
   silicon.
2. Dump the whole flash to a file outside the repository. Dump it again to a second
   file. The two sha256 values must match; if they do not, dump until two consecutive
   reads agree.
3. Record `settings.img_version` from the page, and the fifteen animation slots' hashes
   from the dump, per RESTORE.md. The animations are recoverable from nowhere else.
4. Regenerate the partition table for the flash size the chip reported, and rebuild.

## The first install, over the cable

The first install writes the bootloader, the partition table and the app; OTA cannot do
that. `idf.py build` writes the exact command to `firmware/build/flash_args`; with the
PROVISIONAL 4 MB table it is, in substance:

```
esptool.py --chip esp32c3 --before default_reset --after hard_reset write_flash \
    --flash_mode dio --flash_size 4MB --flash_freq 80m \
    0x0     build/bootloader/bootloader.bin \
    0x8000  build/partition_table/partition-table.bin \
    0xf000  build/ota_data_initial.bin \
    0x20000 build/pandastatusos.bin
```

Standing rule 0: this runs only when the maintainer says so in that message, with the
cable connected. It is never run from a script, a make target, or a habit.

After the first boot the device raises its hotspot (the placeholder name `PandaStatus`,
open, 192.168.4.1; the factory's own hotspot name is a bench-session fact, D-027) and its page shows the setup card, because it has no network.

## Updates, over the network

Once the clone is on the unit, firmware updates go through the System page: choose the
new `pandastatusos.bin`, it is sent at once as `POST /ota` with `OTA-Type: ota_fw`, the
device answers on the socket, and restarts into the new slot. Rollback is enabled: an
image that fails to bring the web server up boots the previous slot on the next reset,
so a bad build costs a power cycle, not a cable.

The image pack and single animations go the same way with `OTA-Type: ota_img` or a slot
name, into the `images` partition. The caps (4.5 MB, 6.875 MB, 1.5 MB) are the factory
page's constants and are enforced before and during the write.

## Going back to the factory firmware

Write the dump from step 2 back over the whole flash, verify, and reboot. The command,
with every offset, is in [backups/RESTORE.md](../backups/RESTORE.md) Part B, which is
completed from the dump before the first install and not after.

## Between the two: the partition table changes

The PROVISIONAL table puts two app slots of 0x180000 at 0x20000 and 0x1a0000, `images`
after them, and `coredump` in the last 4 KiB. The factory table is whatever the dump
says. They will differ, which is why the first install writes the partition table and
why going back writes the whole flash and not just an app slot.
