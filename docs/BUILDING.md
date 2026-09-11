# Building

Two builds: the page, and the firmware that embeds it. Neither needs a device. Nothing
here flashes; that is [FLASHING.md](FLASHING.md).

## The page

```
python3 tools/ui/build/build.py           # writes firmware/main/ui.html
python3 tools/ui/build/build.py --check   # exit 1 if the committed page is not what the build produces
```

Needs Python 3 and `gzip`. The build:

- fills the named slots in `tools/ui/src/frame.html`: the favicons and marks from `art/`,
  the vendored stylesheets and scripts, the theme and app stylesheets, every page card,
  the shared furniture, the string table, and every module;
- splices a vendored file only if its sha256 matches the row in its README, and the
  Heroicons one file at a time into one sprite;
- derives `tools/ui/i18n/en.json` from every `data-ps-str` in the markup plus
  `js_strings.json`, and validates every other table against it: missing keys, extra
  keys, placeholder mismatches;
- emits `tools/ui/i18n/ps_strings.js` (gitignored) and inlines it, all languages, through
  `strings_block()`, the one place that decides inline versus fetched;
- refuses: untagged visible text, a key absent from English, an `id_` or `c_` token, an
  inline `on*=` handler, an external asset reference, a card without `data-ps-card`, a
  nav target with no card, an unreplaced slot;
- prints the size, the gzip size and the sha256.

The gzip the device serves is not committed; CMake derives it on every firmware build
with `gzip -9 -n` so the same input gives byte-identical output.

## The firmware

ESP-IDF v5.3.1, the version the factory build reports. Install it under `~/esp/esp-idf`
and the ESP32-C3 toolchain with `./install.sh esp32c3`.

```
. ~/esp/esp-idf/export.sh
cd firmware
idf.py set-target esp32c3
idf.py build
```

The result is `firmware/build/panda_status.bin` plus the bootloader and partition table
next to it, and `build/flash_args` listing every offset. As of this writing the app is
0x1005d0 bytes with 33% of a 0x180000 slot free.

`sdkconfig` is generated from `sdkconfig.defaults` and is not committed; delete it to
pick up a changed default. `firmware/main/ui.html.gz` is derived and not committed.

### The partition table

`firmware/partitions.csv` is generated, not edited:

```
python3 tools/fw/gen_partitions.py --flash 4MB      # the committed table; PROVISIONAL
python3 tools/fw/gen_partitions.py --flash 16MB     # once the dump says so
python3 tools/fw/gen_partitions.py --check          # exit 1 on drift
make partitions FLASH=8MB
```

The flash size is unknown until a unit's flash has been read. Change it here and in
`sdkconfig.defaults` (`CONFIG_ESPTOOLPY_FLASHSIZE_*`) together.

### Host tests

```
make test-fw
```

Compiles the real `firmware/main/ps_cfg.c` against stub headers and a fake NVS with
plain `gcc`, no toolchain, and runs 32 assertions. When an ESP-IDF checkout is present
(`IDF_PATH`, else `~/esp/esp-idf`) it also compiles the real `ps_state.c` with the IDF's
own cJSON and the other modules replaced by recorders, and runs 41 more: the six-root
document's shape and every inbound frame's effect on the state.

## The marks

```
python3 tools/art/gen_marks.py            # writes art/*.svg and art/*.png
python3 tools/art/gen_marks.py --check    # exit 1 on drift
```

## Everything at once

```
make test-hook && make residue && make test-fw \
  && python3 tools/ui/build/build.py --check \
  && python3 tools/fw/gen_partitions.py --check \
  && python3 tools/art/gen_marks.py --check \
  && tools/ui/harness/sweep.sh
```

The sweep needs the harness dependencies under `private/uiwork/`; see
[CONTRIBUTING.md](../CONTRIBUTING.md).
