# PandaStatusOS

<p align="center">
    <picture>
        <source media="(prefers-color-scheme: dark)" srcset="art/banner-dark.svg">
        <source media="(prefers-color-scheme: light)" srcset="art/banner-light.svg">
        <img src="art/banner-light.svg" alt="PandaStatusOS" width="880">
    </picture>
</p>

<p align="center">
Clean-room firmware for the BIGTREETECH Panda Status P2, the LED bar that watches a Bambu Lab printer.<br>
Written from the observed behaviour of a stock unit, not from its code, so it can be read, changed and rebuilt by anyone. 25 languages.
</p>

<p align="center">
<sub>PandaStatusOS is not affiliated with, endorsed by, or supported by Shenzhen BIGTREE Technology Co., Ltd., BIQU or BIGTREETECH.<br>
It is a reimplementation, not a modification of their firmware. "Panda Status" is used only to name the hardware it runs on. Bambu Lab, AMS and P2S are Bambu Lab's.</sub>
</p>

<p align="center">
    <a href="https://github.com/jeremykenedy/PandaStatusOS/actions/workflows/ci.yml"><img src="https://github.com/jeremykenedy/PandaStatusOS/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    <a href="LICENSE.md"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"></a>
    <a href="#requirements"><img src="https://img.shields.io/badge/device-Panda%20Status%20P2-8b5cf6" alt="BIGTREETECH Panda Status P2"></a>
    <a href="#requirements"><img src="https://img.shields.io/badge/target-ESP32--C3-blue" alt="Target ESP32-C3"></a>
    <a href="#requirements"><img src="https://img.shields.io/badge/ESP--IDF-v5.3.1-informational" alt="ESP-IDF v5.3.1"></a>
    <a href="#languages"><img src="https://img.shields.io/badge/languages-25-orange" alt="25 languages"></a>
    <a href="#testing"><img src="https://img.shields.io/badge/harness%20rows-38-success" alt="38 harness rows"></a>
    <a href="https://github.com/jeremykenedy/PandaStatusOS/commits/main"><img src="https://img.shields.io/github/last-commit/jeremykenedy/PandaStatusOS" alt="Last commit"></a>
</p>

## Table of Contents

- [Where This Stands](#where-this-stands)
- [The Restore Path Comes First](#the-restore-path-comes-first)
- [What Makes It Different](#what-makes-it-different)
- [Features](#features)
  - [The Page](#the-page)
  - [Lighting](#lighting)
  - [Printer And Device](#printer-and-device)
- [Languages](#languages)
- [Screenshots](#screenshots)
- [What It Does Not Do](#what-it-does-not-do)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Back Up First](#back-up-first)
  - [First Install, Over The Network](#first-install-over-the-network)
  - [Updating](#updating)
  - [Going Back](#going-back)
- [First Time Setup](#first-time-setup)
- [Settings Migration](#settings-migration)
- [Documentation](#documentation)
- [Project Layout](#project-layout)
- [Testing](#testing)
- [Vendored Components](#vendored-components)
- [License](#license)

## Where This Stands

**Built against a mock device. No unit has been flashed.** Every page, every wire frame
and every firmware module in this repository was written from the protocol the stock
unit speaks and tested against a mock that speaks it back. The first flash of real
hardware is a deliberate, separate step, and it has not happened. Until it does, treat
every number about the flash layout as PROVISIONAL; the files say so themselves.

Read [firmware/SAFETY.md](firmware/SAFETY.md) before touching a device. Read the next
section before touching yours.

## The Restore Path Comes First

**No P2 firmware image is published anywhere.** Not by the vendor, not by the
community. The only way back to the factory firmware is a full flash dump taken from
the unit before anything is written to it. There is no fallback, and the device cannot
put itself back.

So the order is fixed: back up, verify the backup twice, and only then install.
[backups/RESTORE.md](backups/RESTORE.md) is the document that gets a unit back to
factory from that dump, with every offset spelled out. It is written before the first
install, not after.

## What Makes It Different

The default configuration is factory parity: out of the box, after a factory reset, and
with no configuration at all, this behaves like the factory application. Everything below
sits behind a switch that defaults off, listed in [docs/FEATURES.md](docs/FEATURES.md).
The factory column says what its own served page offers, which is the surface this was
written from; it is not a claim about code nobody here has read.

| | Factory page | PandaStatusOS |
| --- | :---: | :---: |
| **Effects per bar state** | :x: not on its page | :white_check_mark: **24**, chosen per state |
| **Brightness** | one per mode | :white_check_mark: one per bar state, per mode |
| **Colours per effect** | three state colours per mode | :white_check_mark: four, lit and unlit, printing and otherwise |
| **Speed and direction per effect** | :x: one speed per mode | :white_check_mark: each effect carries its own |
| **Brightness ramp** | :x: | :white_check_mark: sweeps to a second value each cycle |
| **Print progress on the bar** | :x: | :white_check_mark: bar, animated bar, barber pole, colour ramp |
| **Temperature on the bar** | :x: | :white_check_mark: gradient, source and both ends settable |
| **Hot warning** | :x: | :white_check_mark: a pulse over whatever the bar shows |
| **Error flash** | :x: | :white_check_mark: colour, brightness and rate |
| **Per print stage** | display only, 15 stages, bar has 3 states | :white_check_mark: an effect per stage, inheriting its state |
| **Named effects** | :x: | :white_check_mark: 8 saved, applied to any state |
| **Live preview** | :x: | :white_check_mark: pin a state, progress and stage for half a minute |
| **Fault codes on the bar** | :x: | :white_check_mark: blinked, colour for the area, count for the reason |
| **Settings as a file** | :x: | :white_check_mark: export and import, passwords left out |
| **Plain restart** | a socket command named reset, no button | :white_check_mark: a button named what it does |
| **Find a moved printer** | :x: not on its page | :white_check_mark: by serial number |
| **Full flash backup** | :x: no route | :white_check_mark: `GET /backup` over Wi-Fi |
| **Proving a flash landed** | `/ota` answers 200 either way | :white_check_mark: build id and the served page |
| **JSON API** | two routes | :white_check_mark: documented, [docs/API.md](docs/API.md) |
| **Source published** | :x: none, anywhere | :white_check_mark: MIT |

## Features

### The Page

The page the device serves, rebuilt as eight pages that speak the factory's wire
protocol frame for frame:

| Page | What it controls |
| --- | --- |
| **Dashboard** | printer link, network, lighting mode and brightness, firmware, hotspot |
| **Lighting** | Music or H2D mode, brightness and speed, the three state colours per mode, segments, reset |
| **Images** | the fifteen print-stage animations, one upload per slot |
| **Printer** | scan, bind by serial number and address with the access code, unbind |
| **Network** | Wi-Fi scan and connect, hostname, the hotspot's name, password and address |
| **System** | versions, language, theme, firmware and image pack updates, the feature switches, the three resets named honestly |
| **Logs** | what the page and the device said to each other, credentials replaced by their length |
| **Setup** | the first-run page: language, Wi-Fi, idle colour |

Both themes as Material 3 token pairs, phone and desktop layouts, and a contrast harness
over every page in both.

### Lighting

Nineteen switches, every one off by default. The full table with defaults and
dependencies is [docs/FEATURES.md](docs/FEATURES.md).

| Setting | What it does |
| --- | --- |
| **Effect per state** | 24 effects; 17 need no live input, the rest read the print or the printer and wait for their own switch |
| **Effect colours** | lit and unlit, one pair for while a job runs and one for otherwise |
| **Effect parameters** | brightness, speed and direction per effect, over the factory's sliders |
| **Brightness ramp** | the brightness sweeps to a second value each cycle, then starts over |
| **Progress effects** | progress bar, animated progress, barber pole with a band width, and a colour ramp across the print by hue |
| **Temperature gradient** | nozzle, bed or chamber, between two temperatures you set |
| **Layers** | a hot warning and an error flash drawn over whatever the bar shows, in both modes |
| **Named effects** | an editor: the effect, its colours as stops, timing and direction, saved under a name |
| **Per stage** | any of the fifteen display stages gets its own named effect; the rest inherit their bar state |
| **Live preview** | pin a state, a progress and a stage for half a minute and watch it, without running a print |

### Printer And Device

| Setting | What it does |
| --- | --- |
| **Binding** | by serial number and address, with the printer's LAN mode access code |
| **Find a moved printer** | three failures on a bound printer start a scan; a hit carrying the bound serial at a new address is bound |
| **Fault codes** | amber for the network, blue for the printer, a count of blinks for the reason |
| **Settings as a file** | every stored setting out as one JSON document and back in, whole or refused |
| **Restart** | a button, separate from the two resets, erasing nothing |
| **Full flash backup** | `GET /backup`, the whole flash over Wi-Fi, station interface only |
| **JSON API** | `/api/info`, `/api/state` and one route per switch, all documented |

## Languages

Twenty-five. English is the only hand-written table; every other language is translated
from it and checked against it on every build for missing keys, extra keys and
placeholders. A language ships when all 433 strings are in it.

| Language | Native name | Code | |
| --- | --- | :---: | --- |
| Arabic | العربية | `ar` | right to left |
| Chinese, Simplified | 简体中文 | `zh-Hans` | |
| Chinese, Traditional | 繁體中文 | `zh-Hant` | |
| Czech | čeština | `cs` | |
| Danish | Dansk | `da` | |
| Dutch | Nederlands | `nl` | |
| English | English | `en` | |
| Finnish | suomi | `fi` | |
| French | français | `fr` | |
| German | Deutsch | `de` | |
| Greek | Ελληνικά | `el` | |
| Hebrew | עברית | `he` | right to left |
| Hungarian | magyar | `hu` | |
| Italian | italiano | `it` | |
| Japanese | 日本語 | `ja` | |
| Korean | 한국어 | `ko` | |
| Norwegian Bokmål | norsk bokmål | `nb` | |
| Polish | polski | `pl` | |
| Portuguese, Brazil | português do Brasil | `pt-BR` | |
| Romanian | Română | `ro` | |
| Russian | русский | `ru` | |
| Spanish | español | `es` | |
| Swedish | svenska | `sv` | |
| Turkish | Türkçe | `tr` | |
| Ukrainian | українська | `uk` | |

Arabic and Hebrew are right to left. The whole layout mirrors, not just the text.

Pick a language on the setup page, or change it any time from the System page.

## Screenshots

Taken by the harnesses against the mock, never against hardware. Every value on them is
a placeholder.

| Dashboard, light | Dashboard, dark |
| --- | --- |
| <img src="docs/screenshots/dashboard-light.png" alt="Dashboard, light theme" width="420"> | <img src="docs/screenshots/dashboard-dark.png" alt="Dashboard, dark theme" width="420"> |

| Lighting | Printer |
| --- | --- |
| <img src="docs/screenshots/lighting-light.png" alt="Lighting page" width="420"> | <img src="docs/screenshots/printer-light.png" alt="Printer page" width="420"> |

| Network, dark | System |
| --- | --- |
| <img src="docs/screenshots/network-dark.png" alt="Network page, dark theme" width="420"> | <img src="docs/screenshots/system-light.png" alt="System page" width="420"> |

| Images, dark | Logs, dark |
| --- | --- |
| <img src="docs/screenshots/images-dark.png" alt="Images page, dark theme" width="420"> | <img src="docs/screenshots/logs-dark.png" alt="Logs page, dark theme" width="420"> |

| Lighting on a phone | Setup on a phone |
| --- | --- |
| <img src="docs/screenshots/lighting-dark-phone.png" alt="Lighting page on a phone" width="200"> | <img src="docs/screenshots/setup-light-phone.png" alt="Setup page on a phone" width="200"> |

## What It Does Not Do

- **Drive the bar the way the factory does.** The animations, Music mode's reaction to
  sound and the meaning of the speed value are recovered from the stock unit in Phase 1
  (see [docs/PLAN.md](docs/PLAN.md)). Until then the renderer paints the state colour,
  solid, at the set brightness, and says so in its source.
- **Know the flash size or the LED count.** Both are read off a real unit. The partition
  table is generated from one number so the real one is a single command away.
- **Discover printers on the network.** A scan finishes empty until a documented
  mechanism exists; binding by serial number and address works. What happens with a
  scan's results is built and tested, so only the finding is missing.
- **Publish Home Assistant entities.** The factory page exposes no broker setting, so
  there is nothing to mirror yet.
- **Verify the printer's certificate.** The printer presents a self-signed one; the link
  is encrypted but the server is not authenticated. The access code is the secret.
- **No warranty of any kind.** Flashing third-party firmware can void yours. Read
  [firmware/SAFETY.md](firmware/SAFETY.md) and take the full backup it asks for.

## Requirements

| Requirement | Detail |
| --- | --- |
| **Hardware** | BIGTREETECH Panda Status P2, ESP32-C3, RISC-V |
| **Toolchain** | ESP-IDF v5.3.1, the version the factory build reports, target esp32c3 |
| **Page build** | Python 3 and gzip |
| **Harnesses** | Node 22 or newer, and Playwright installed under `private/uiwork/`, never in the repository |
| **Printer** | a Bambu Lab printer on the same network, in LAN Only Mode, with its serial number and access code |

## Installation

There is no one-command installer, and that is deliberate: the first thing that happens
to a unit has to be a backup that nobody can skip.

### Back Up First

Read [firmware/SAFETY.md](firmware/SAFETY.md) first. It is short, and every rule in it is
there because skipping it cost a sibling project its factory firmware for good.

```bash
. ~/esp/esp-idf/export.sh
tools/fw/golden.sh usb --stock --reads 3
```

Three reads of the whole flash over the cable, two of which must agree, hashed, parsed
and set read-only. `tools/fw/preflight.sh` refuses every install until that is complete
and verified, and it has no override.

**Where it writes.** `private/backups/stock/`, inside your own checkout. That directory is
gitignored twice over and the pre-commit hook refuses ignored paths, the `.bin` extension
and anything named like an NVS artifact, so an image cannot reach a commit even with
`git add -f`. `PS_BACKUPS_DIR` moves the root if you would rather keep it elsewhere.

**Read `private/backups/NOTICE.txt` once.** A full image contains the NVS partition, which
holds your Wi-Fi password, your printer's serial number and its access code in plaintext.
Treat the file as that list written down.

**Then put a copy somewhere that is not this machine**, which is the step the gate checks:

```bash
tools/fw/golden.sh copy private/backups/stock/GOLDEN-<stamp>-full-4MB.bin /Volumes/<drive>/panda
tools/fw/golden.sh copy private/backups/stock/GOLDEN-<stamp>-full-4MB.bin you@nas:/path/panda
```

Either form copies the image, hashes it again at the destination, refuses the copy if the
two hashes differ, and records where it went. No P2 image is published by anyone, so this
copy is the only thing standing between a dead flash and a dead device.

### First Install, Over The Network

Build against the unit's own partition table, read from that backup:

```bash
python3 tools/fw/partitions_from_dump.py <the agreed read>
cd firmware && idf.py build
```

Then install:

```bash
tools/fw/ota-install.sh <the unit's address> firmware/build/pandastatusos.bin
```

The first install is an OTA into one of the stock firmware's own app slots. The
bootloader, the partition table, the settings and the animations are never written, and
the stock application stays in the other slot. [docs/FLASHING.md](docs/FLASHING.md) walks
through what it prints and what each verdict means.

### Updating

The System page takes a firmware file, or the same script does it again. Either way the
install is proven rather than assumed: the factory's `/ota` answers 200 whether or not an
upload landed, so the script compares the build identifier and the served page before and
after and says FLASHED or NOT LANDED.

### Going Back

Three ways, in order of how much they write, all spelled out with every offset in
[backups/RESTORE.md](backups/RESTORE.md): the factory app back over the network with no
cable, the factory app into one slot over the cable, and the whole image back over the
cable, which is the only one that touches the bootloader.

The last of those, the one that puts a unit back exactly as it left the factory, is a
single command against the image you took:

```bash
# verify what you are about to write, first, every time
tools/fw/golden.sh verify private/backups/stock/GOLDEN-<stamp>-full-4MB.bin

. ~/esp/esp-idf/export.sh
python3 -m esptool --chip esp32c3 --port <YOUR-PORT> --baud 460800 \
  write_flash 0x0 private/backups/stock/GOLDEN-<stamp>-full-4MB.bin
```

That writes the bootloader, the partition table, both app slots and NVS, so it restores
your Wi-Fi and printer settings along with the firmware. Esptool version 5 spells the
subcommand `write-flash`; version 4 spells it `write_flash`. Do not run it against an
image whose hash you have not just checked. `GET /backup` takes a fresh full
image over Wi-Fi in seconds, so every later restore point costs nothing. The factory image
is the vendor's and is not redistributed here; the copy you took is the only one there is.

## First Time Setup

| Step | What to do |
| :---: | --- |
| 1 | Power the device. With no Wi-Fi stored it raises its own hotspot and serves the setup page. |
| 2 | Join it and open `http://192.168.4.1`. |
| 3 | Pick a language, choose your Wi-Fi, enter its password. |
| 4 | Bind the printer on the Printer page: serial number, address, and its LAN mode access code. |
| 5 | Reach it afterwards at its address on your network. |

The hotspot's name and the default hostname are **placeholders** until a stock unit is
read at the bench: what the factory calls its own hotspot is a parity fact, not a branding
choice, and this project will not guess it (see [docs/DECISIONS.md](docs/DECISIONS.md)).

## Settings Migration

The stored configuration has changed shape four times. Every older layout is frozen in
`firmware/main/ps_cfg.c` and lifted forward field by field on first load, then written
back in the current shape, so updating never asks you to set the device up again. The host
test runs real blobs of every past layout through the real migration, so that claim is
tested rather than believed.

The blob is written twice during a save, so its budget is twice its size plus a page of
slack, and a compile-time assert fails the build if it ever outgrows that. The named
effects and the per-stage rows live in their own blobs beside it, which is why adding them
moved no layout. [docs/CONFIG.md](docs/CONFIG.md) has every key, its range and its default.

## Documentation

| Document | Covers |
| --- | --- |
| [docs/PLAN.md](docs/PLAN.md) | the three phases, the five gates, the evidence standard |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | firmware structure, task model, the page build pipeline |
| [docs/PROTOCOL.md](docs/PROTOCOL.md) | the whole wire surface: WebSocket, HTTP, MQTT |
| [docs/API.md](docs/API.md) | the JSON surface: discovery, the read-only routes, the switches' routes, the rules |
| [docs/CONFIG.md](docs/CONFIG.md) | every stored key, its type, range and default |
| [docs/FEATURES.md](docs/FEATURES.md) | every switch, its default and its dependencies |
| [docs/BUILDING.md](docs/BUILDING.md) | building the page and the firmware |
| [docs/FLASHING.md](docs/FLASHING.md) | the install, what it proves, and what it refuses |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | it does not do the thing. Start here |
| [backups/RESTORE.md](backups/RESTORE.md) | getting a unit back to factory, every offset spelled out |
| [firmware/SAFETY.md](firmware/SAFETY.md) | what will brick the device, and what will not |
| [docs/DECISIONS.md](docs/DECISIONS.md) | every decision, its alternatives, its reversal cost |
| [docs/ROADMAP.md](docs/ROADMAP.md) | what may be built, in tiers, and what each tier waits on |
| [CONTRIBUTING.md](CONTRIBUTING.md) | the standing rules, the clean-room rule, the sweep, the naming convention |
| [CHANGELOG.md](CHANGELOG.md) | what changed |

## Project Layout

| Path | What it is |
| --- | --- |
| `firmware/` | the ESP-IDF project: `main/` modules, `partitions.csv` (generated), host tests under `test/host/` |
| `firmware/main/ui.html` | the served page, BUILT by `tools/ui/build/build.py` and committed; its gzip is derived at build time |
| `firmware/main/vendor/` | every third-party component with its licence and the sha256 of what ships |
| `tools/ui/` | page sources, the build, the string tables, the mock device, the harnesses |
| `tools/fw/` | the flash tools: the gate, the goldens, the install, the partition table |
| `tools/art/`, `art/` | the marks and the banners, generated from primitives |
| `docs/` | everything above, plus the screenshots |
| `backups/` | the restore document and the stock capture run sheet; the dumps live outside the tree |
| `.githooks/` | the pre-commit hook that keeps secrets and vendor material out |
| `private/` | gitignored: working notes, harness dependencies, and `backups/`, where full flash images are written |

## Testing

| Command | What it proves |
| --- | --- |
| `tools/ui/harness/sweep.sh` | 38 rows: every page against the mock at both themes and both widths, every control's exact wire frame, the JSON API as the factory and as a clone, contrast on every page, and one row per lie a device can tell |
| `make test-fw` | on the host, compiling the shipping code with plain gcc: the config blob and its migrations (75), the effect engine (73), the rebind decision (13), the fault codes (24), and the state document and inbound dispatcher against the protocol (41) |
| `make test-hook` | the pre-commit hook's regression suite, including two cases that assert its binary classifier rather than only its effect |
| `make residue` | the tracked tree carries nothing of the vendor's expression |
| `make test-flash-tools` | 55 cases over the flash tools, against a synthetic image and the mock |
| `python3 tools/ui/build/build.py --check` | the committed page is exactly what the build produces, and this README's numbers still match the tree |

The first four of those run on every push
([`.github/workflows/ci.yml`](.github/workflows/ci.yml)). The sweep needs a browser and
runs locally.

## Vendored Components

Nothing ships without a row in
[firmware/main/vendor/README.md](firmware/main/vendor/README.md).

| Component | Version | Licence | Used for |
| --- | :---: | :---: | --- |
| [Beer CSS](https://github.com/beercss/beercss) | 5.0.3 | MIT | the page's components and Material 3 tokens |
| [Coloris](https://github.com/melloware/coloris-npm) | 0.25.0 | MIT | the colour picker |
| [Heroicons](https://github.com/tailwindlabs/heroicons) | 2.2.0 | MIT | outline icons for generic chrome, hashed one by one |
| Roboto | pending | SIL OFL 1.1 | reserved; the page uses the system font until a subset is vendored |

The drawn icons and the marks are first-party work under this repository's licence, not
vendored components; [tools/ui/src/ARTWORK.md](tools/ui/src/ARTWORK.md) records them.

## License

Released under the [MIT license](https://opensource.org/licenses/MIT). The full text is
in [LICENSE.md](LICENSE.md). The vendored components keep their own licences, listed
above and in their directories.
