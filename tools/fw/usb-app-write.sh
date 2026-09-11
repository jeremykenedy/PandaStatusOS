#!/usr/bin/env bash
#
# usb-app-write.sh: write ONE app image into ONE app slot over the cable, and nothing else.
#
#   tools/fw/usb-app-write.sh <app.bin> [--port DEV] [--slot NAME]
#
# For the one situation the network path cannot reach: the device will not boot, so it
# cannot serve /ota. This writes the image at the offset of an app slot and verifies it by
# reading the slot back. The offset is read from the partition table inside the verified
# stock dump, never typed and never hardcoded. Which slot: the one the bootloader will boot
# next, read live from otadata, unless --slot names another.
#
# It never writes 0x0 (the bootloader), 0x8000 (the partition table), NVS, otadata or the
# images partition. There is no command in this repository that writes those regions except
# the whole-image restore in backups/RESTORE.md, and none that erases the chip.
#
# Gate: tools/fw/preflight.sh first, then the chip must be an ESP32-C3 with the recorded
# flash size and the recorded MAC. The flashing rule governs the write: it runs only when the
# maintainer says so in that message.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# The backup root. It defaults to the repository's own gitignored working area, so whoever
# runs this gets their images under their own checkout instead of a path with somebody
# else's name in it. Goldens are never committed and cannot be: private/ is ignored,
# private/backups/ is ignored again, and the pre-commit hook refuses ignored paths, the
# .bin extension and anything named like an NVS artifact. PS_BACKUPS_DIR relocates it,
# which is how the test suite points the tools at synthetic data.
ROOT="${PS_BACKUPS_DIR:-$(cd "$HERE/../.." && pwd)/private/backups}"
FI="python3 $HERE/flashimage.py"
BIN="${1:-}"; shift || true
PORT=""; SLOT=""
while [ $# -gt 0 ]; do case "$1" in --port) PORT="$2"; shift 2;; --slot) SLOT="$2"; shift 2;; *) echo "unknown option $1" >&2; exit 2;; esac; done
[ -f "$BIN" ] || { echo "usage: $0 <app.bin> [--port DEV] [--slot NAME]" >&2; exit 2; }
LOG="$ROOT/flash-log.txt"; mkdir -p "$ROOT"
say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { say "STOP: $*"; exit 1; }

say "usb-app-write: $BIN"
bash "$HERE/preflight.sh" | tee -a "$LOG"; [ "${PIPESTATUS[0]}" -eq 0 ] || die "preflight refused; nothing written"
while IFS='=' read -r k v; do [ -n "$k" ] && declare "IMG_$k=$v"; done < <($FI appdesc "$BIN" 2>/dev/null)
[ "${IMG_NOT_AN_APP_IMAGE:-0}" = 1 ] || [ -z "${IMG_BUILD:-}" ] && die "$BIN is not an app image"
say "image: $IMG_PROJECT $IMG_VERSION build $IMG_BUILD, $IMG_SIZE bytes"

command -v esptool.py >/dev/null 2>&1 || . ~/esp/esp-idf/export.sh >/dev/null 2>&1 || true
ESPTOOL="python3 -m esptool"; $ESPTOOL version >/dev/null 2>&1 || die "esptool is not available; run . ~/esp/esp-idf/export.sh first"
if [ -z "$PORT" ]; then
    set +u; PORTS=( /dev/cu.usbmodem* /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/cu.SLAB_USBtoUART* ); set -u
    PORTS=( $(for p in "${PORTS[@]}"; do [ -e "$p" ] && echo "$p"; done) )
    [ "${#PORTS[@]}" -eq 1 ] || die "found ${#PORTS[@]} serial ports (${PORTS[*]:-none}); pass --port"
    PORT="${PORTS[0]}"
fi
UNIT="$ROOT/stock/RESTORE-THIS-UNIT.txt"
CHIP="$($ESPTOOL --chip auto --port "$PORT" chip-id 2>&1 | awk -F'Chip is ' '/Chip is/{print $2}' | awk '{print $1}')"
case "$CHIP" in ESP32-C3*) ;; *) die "chip-id reports '${CHIP:-nothing}', not an ESP32-C3";; esac
FLASH="$($ESPTOOL --chip auto --port "$PORT" flash-id 2>&1 | awk -F'Detected flash size: ' '/Detected flash size/{print $2}' | awk '{print $1}')"
MAC="$($ESPTOOL --chip auto --port "$PORT" read-mac 2>&1 | awk '/^MAC:/{print tolower($2)}' | head -1)"
[ "$MAC" = "$(awk -F= '/^MAC=/{print tolower($2)}' "$UNIT")" ] || die "this unit's MAC differs from the stock dump's unit"
[ "$FLASH" = "$(awk -F= '/^FLASH_SIZE=/{print $2}' "$UNIT")" ] || die "flash size $FLASH differs from the recorded $(awk -F= '/^FLASH_SIZE=/{print $2}' "$UNIT")"
say "unit: ESP32-C3, $FLASH, MAC matches"

# the slots and otadata, from the stock dump's table
STOCKIMG="$(ls "$ROOT"/stock/GOLDEN-*.bin | head -1)"
TABLE="$($FI inspect --json "$STOCKIMG")"
SLOTS_JSON="$(echo "$TABLE" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(json.dumps([[a["name"],a["offset"],a["size"]] for a in r["apps"]]))')"
OTA_OFF="$(echo "$TABLE" | python3 -c 'import json,sys; r=json.load(sys.stdin); e=[p for p in r["table"] if p["type_name"]=="data" and p["subtype_name"]=="ota"]; print(e[0]["offset"] if e else "")')"
OTA_SIZE="$(echo "$TABLE" | python3 -c 'import json,sys; r=json.load(sys.stdin); e=[p for p in r["table"] if p["type_name"]=="data" and p["subtype_name"]=="ota"]; print(e[0]["size"] if e else "")')"
N="$(echo "$SLOTS_JSON" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))')"
[ "$N" -ge 1 ] || die "the stock table has no app slot"
if [ -z "$SLOT" ]; then
    [ -n "$OTA_OFF" ] || die "no otadata partition in the stock table; pass --slot"
    OTATMP="$(mktemp)"
    $ESPTOOL --chip esp32c3 --port "$PORT" -b 460800 --before default_reset --after no_reset read-flash "$OTA_OFF" "$OTA_SIZE" "$OTATMP" >/dev/null 2>&1 || die "could not read otadata"
    ACTIVE="$($FI otadata "$OTATMP" "$(echo "$SLOTS_JSON" | python3 -c 'import json,sys; print(len([s for s in json.load(sys.stdin) if s[0].startswith("ota_")]))')" | awk -F= '/^ACTIVE=/{print $2}')"; rm -f "$OTATMP"
    if [ "$ACTIVE" = none ]; then SLOT="$(echo "$SLOTS_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)[0][0])')"; say "otadata has no valid entry; the bootloader boots the first slot, $SLOT"
    else SLOT="ota_$ACTIVE"; say "otadata says the bootloader boots $SLOT"; fi
fi
read -r OFFSET SIZE <<< "$(echo "$SLOTS_JSON" | python3 -c 'import json,sys; s=[x for x in json.load(sys.stdin) if x[0]==sys.argv[1]]; print(s[0][1], s[0][2]) if s else print("", "")' "$SLOT")"
[ -n "$OFFSET" ] || die "no app slot named $SLOT in the stock table"
[ "$IMG_SIZE" -le "$SIZE" ] || die "the image ($IMG_SIZE bytes) does not fit slot $SLOT ($SIZE bytes)"
say "writing $IMG_SIZE bytes to $SLOT at $(printf '0x%x' "$OFFSET") (the flashing rule: only because the maintainer said so in this message)"
$ESPTOOL --chip esp32c3 --port "$PORT" -b 460800 --before default_reset --after hard_reset write-flash "$(printf '0x%x' "$OFFSET")" "$BIN" || die "write failed; read firmware/SAFETY.md, 'if something goes wrong'"
BACK="$(mktemp)"
$ESPTOOL --chip esp32c3 --port "$PORT" -b 460800 --before default_reset --after hard_reset read-flash "$(printf '0x%x' "$OFFSET")" "$IMG_SIZE" "$BACK" >/dev/null 2>&1 || die "read-back failed"
if cmp -s "$BACK" "$BIN"; then say "VERIFIED: slot $SLOT reads back identical to $BIN"; rm -f "$BACK"; exit 0; fi
rm -f "$BACK"; die "read-back DIFFERS from the image. Do not power-cycle; read firmware/SAFETY.md"
