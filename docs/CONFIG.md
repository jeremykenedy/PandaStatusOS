# Configuration

Everything the device remembers across a power cycle lives in one NVS blob, namespace
`ps`, key `cfg`, laid out by `ps_cfg_t` in `firmware/main/ps.h`. The layout is version 1,
magic `0x50533031` ("PS01"), 492 bytes, pinned by `_Static_assert` to that size and to
the offsets of its arrays so the host tests and the target agree byte for byte.

Defaults are **PROVISIONAL**: they are the values the factory page expects after a
lighting reset and the mock's factory fixture, not values read off a device. Phase 2
gate 3 replaces them with what a stock unit reports after its own factory reset, and
this table with it.

## The keys

| Key | Type | Range | Default | Since | Set by |
|---|---|---|---|---|---|
| `magic` | u32 | `0x50533031` | that | v1 | the firmware; it is the layout's version |
| `features` | u32 bitfield | any | 0, every flag off | v1 | [FEATURES.md](FEATURES.md); nothing yet |
| `wifi_ssid` | char[33] | up to 32 bytes | empty | v1 | `wifi.ssid` |
| `wifi_password` | char[65] | up to 64 bytes | empty | v1 | `wifi.password` |
| `ap_ssid` | char[33] | up to 32 bytes | `PandaStatus`, a placeholder: the factory's hotspot name is a bench-session fact (D-027) | v1 | `ap.ssid` |
| `ap_password` | char[65] | up to 64 bytes; under 8 means an open hotspot | empty | v1 | `ap.password` |
| `hostname` | char[33] | up to 32 bytes | `pandastatusos`, a placeholder: the factory's default hostname is a bench-session fact (D-027) | v1 | `sta.hostname` |
| `printer_name` | char[33] | up to 32 bytes | empty | v1 | `printer.name` |
| `printer_sn` | char[33] | up to 32 bytes | empty | v1 | `printer.sn` |
| `printer_access_code` | char[17] | up to 16 bytes | empty | v1 | `printer.access_code` |
| `language` | char[8] | a code from the string table | `en` | v1 | `settings.language` |
| `ap_ip` | u8[4] | an IPv4 address | 192.168.4.1 | v1 | `ap.ip` |
| `printer_ip` | u8[4] | an IPv4 address, 0.0.0.0 when unset | 0.0.0.0 | v1 | `printer.ip` |
| `ap_on` | u8 | 0 or 1 | 1 | v1 | `ap.on` |
| `current_mode` | u8 | 0 Music, 1 H2D | 1 | v1 | `settings.rgb_info_mode` |
| `block_count` | u8 | 0 to 15 | 1 | v1 | grows when `block.blockID` names a new segment |
| `mode[2].brightness` | u8 | 0 to 100, the page steps by 5 | 50 in both modes | v1 | `settings.rgb_info_brightness` for the current mode |
| `mode[2].speed` | u8 | 0 to 100, the page steps by 5 | 100 in both modes | v1 | `settings.rgb_info_speed` for the current mode; H2D only on the page |
| `mode[2].colour[3]` | RGBA | any | white, white, red in both modes | v1 | `settings.rgb_rgba` with `rgb_state_index` and, optionally, `rgb_info_mode` |
| `block[15].id` | u8 | 0 to 255 | segment 0 | v1 | `block.blockID` |
| `block[15].colour` | RGBA | any | white | v1 | `block.blockrgba` |

The colour indices are 0 idle, 1 printing, 2 error. The mode indices are 0 Music,
1 H2D. Colours are stored as four bytes and written to the wire in the format the
factory uses for each mode: bare `RRGGBB` for Music, `#RRGGBBAA` for H2D.

## What happens on load

1. `ps_cfg_factory_defaults()` fills the struct. This function writes through its pointer
   and touches no global, so it can be called on a scratch struct to read a default.
2. The stored blob is read into a buffer the size of the NVS budget.
3. The chain, newest layout first: if the size matches the layout and the magic matches,
   the layout is copied whole (v1, the current one) or overlaid field by field (every
   older layout, once one exists).
4. `ps_cfg_clamp()` bounds every value that is used as an index or a range: the mode,
   the block count, brightness, speed, `ap_on`, and terminates every string. A blob
   written by a corrupt or newer image cannot become an array subscript.
5. Anything unrecognised leaves the defaults in place and logs the magic and size it saw.

## Changing the layout

The instructions are in `ps_cfg.c` above the chain, and the host test enforces them:

1. Copy the current `ps_cfg_t` into `ps_cfg.c` as `ps_cfg_v1_t`, `static`, with its own
   `_Static_assert` on the literal size, referencing no live type and no live count.
2. Define `PS_CFG_MAGIC_V2` and point `PS_CFG_MAGIC` at it.
3. Add the v1 arm: defaults, overlay every v1 field, set what v2 added, save.
4. Extend `firmware/test/host/cfg_test.c` with a v1 blob that must survive.

A frozen struct that points at a live type is correct only by luck.

## The budget

The blob is written twice during a rewrite (NVS keeps the old copy until the new one is
committed), so the budget is twice the blob plus a page of slack, against a 0x6000-byte
partition shared with nothing else the firmware stores. A blob over budget saves
silently-failing and a reboot loses everything; the assert makes that a compile error.

## Reading and writing it on the host

`make test-fw` compiles the real `ps_cfg.c` against a fake NVS and runs 32 assertions:
no blob, wrong magic, short blob, long blob, garbage of the right size, save and load
twice, every clamp, erase, and the colour formats on the wire.

## What is not in the blob

The Wi-Fi library's own credential store is disabled (`WIFI_STORAGE_RAM`); the one place
a credential lives on the device is this blob. The theme preference lives in the
browser. The event log lives in the page. The animations live in the `images` partition.
