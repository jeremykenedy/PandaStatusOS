# Configuration

Everything the device remembers across a power cycle lives in one NVS blob, namespace
`ps`, key `cfg`, laid out by `ps_cfg_t` in `firmware/main/ps.h`. The layout is version 3,
magic `0x50533033` ("PS03"), 572 bytes, pinned by `_Static_assert` to that size and to
the offsets of its arrays so the host tests and the target agree byte for byte. Versions 1
("PS01", 492 bytes) and 2 ("PS02", 500 bytes) are frozen inside `ps_cfg.c`; a v1 or v2 blob
is migrated on its first load, field by field, and written back as v3, and the host test
proves every field survives both paths.

Defaults are **PROVISIONAL**: they are the values the factory page expects after a
lighting reset and the mock's factory fixture, not values read off a device. Phase 2
gate 3 replaces them with what a stock unit reports after its own factory reset, and
this table with it.

## The keys

| Key | Type | Range | Default | Since | Set by |
|---|---|---|---|---|---|
| `magic` | u32 | `0x50533031` | that | v1 | the firmware; it is the layout's version |
| `features` | u32 bitfield | any | 0, every flag off | v1 | [FEATURES.md](FEATURES.md), through `POST /api/features` |
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
| `state_brightness[2][3]` | u8 | 0 to 100 | 50 everywhere, the same as the global default | v2 | `POST /api/features` `config.state_brightness`; read by the renderer only while feature bit 1 is set (A1) |
| `fx[3].effect` | u8 | an `enum ps_fx` id the bits allow: below 17 with bit 2; 17, 18, 19 and 21 with bits 6 to 9 (A6 to A9) | 0, solid | v3 | `POST /api/features` `config.state_effects[].effect`; read in H2D while bit 2 is set (A2); an id whose own bit goes off is written back to 0 |
| `fx[3].brightness`, `.speed` | u8 | 0 to 100 | 50, 100 | v3 | `config.state_effects[]`; read while bit 4 is set (A4), with `opt` bit 0x10 as the direction and `aux` as the band width when `opt` bit 0x08 is set |
| `fx[3].bright_end` | u8 | 0 to 100 | 0 | v3 | `config.state_effects[]`; read while bits 4 and 5 are set and `opt` bit 0x04 is set (A5) |
| `fx[3].opt`, `.aux` | u8 | option bits (0x01, 0x02 unlit colours set; 0x04 ramp; 0x08 aux set; 0x10 reverse), one number for the effect that reads it | 0 | v3 | `config.state_effects[]`; A3 to A5 |
| `fx[3].colour[4]` | RGBA | any | the H2D state colour for the two lit entries, black for the two unlit ones | v3 | `config.state_effects[].colours`, `#RRGGBBAA`; read while bit 3 is set (A3): `[0]` lit and `[2]` unlit while a job is on, `[1]` and `[3]` otherwise; an unlit entry counts only while its `opt` bit (1 or 2) is set |

The colour indices are 0 idle, 1 printing, 2 error. The mode indices are 0 Music,
1 H2D. Colours are stored as four bytes and written to the wire in the format the
factory uses for each mode: bare `RRGGBB` for Music, `#RRGGBBAA` for H2D.

## What happens on load

1. `ps_cfg_factory_defaults()` fills the struct. This function writes through its pointer
   and touches no global, so it can be called on a scratch struct to read a default.
2. The stored blob is read into a buffer the size of the NVS budget.
3. The chain, newest layout first: if the size matches the layout and the magic matches,
   the layout is copied whole (v3, the current one) or overlaid field by field (v1 and v2:
   every stored field by name onto the defaults, the newer fields at their defaults, the
   effects' active colours taken from the migrated H2D colours, then saved back as v3).
4. `ps_cfg_clamp()` bounds every value that is used as an index or a range: the mode,
   the block count, brightness, speed, `ap_on`, and terminates every string. A blob
   written by a corrupt or newer image cannot become an array subscript.
5. Anything unrecognised leaves the defaults in place and logs the magic and size it saw.

## Changing the layout

The instructions are in `ps_cfg.c` above the chain, and the host test enforces them:

1. Copy the current `ps_cfg_t` into `ps_cfg.c` as `ps_cfg_v3_t`, `static`, with its own
   `_Static_assert` on the literal size, referencing no live type and no live count
   (`ps_cfg_v1_t` and `ps_cfg_v2_t` there are the model).
2. Define `PS_CFG_MAGIC_V4` and point `PS_CFG_MAGIC` at it.
3. Add the v3 arm above the v2 arm: defaults, overlay every v3 field, set what v4 added, save.
4. Extend `firmware/test/host/cfg_test.c` with a v3 blob that must survive.

A frozen struct that points at a live type is correct only by luck.

## The budget

The blob is written twice during a rewrite (NVS keeps the old copy until the new one is
committed), so the budget is twice the blob plus a page of slack (2,048 bytes for the
572-byte v3 blob), against a 0x6000-byte partition shared with nothing else the firmware
stores. A blob over budget saves
silently-failing and a reboot loses everything; the assert makes that a compile error.

## Reading and writing it on the host

`make test-fw` compiles the real `ps_cfg.c` against a fake NVS: no blob, wrong magic,
short blob, long blob, garbage of the right size, save and load twice, every clamp, erase,
the colour formats on the wire, and a v1 blob that must come through the migration whole.

## What is not in the blob

The Wi-Fi library's own credential store is disabled (`WIFI_STORAGE_RAM`); the one place
a credential lives on the device is this blob. The theme preference lives in the
browser. The event log lives in the page. The animations live in the `images` partition.
