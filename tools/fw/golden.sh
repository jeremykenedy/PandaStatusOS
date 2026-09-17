#!/usr/bin/env bash
#
# golden.sh: take, verify and record full flash images ("goldens") of a Panda Status P2.
#
#   tools/fw/golden.sh http <host> [--note TEXT]
#       over the network, from the clone's GET /backup. About 17 seconds on the vent. The
#       factory firmware has no such endpoint, so this only works once the clone is installed.
#   tools/fw/golden.sh usb [--stock] [--port DEV] [--reads N] [--note TEXT]
#       over the cable with esptool, N independent reads (default 3) to N files. --stock files
#       the reads under stock/, which is what preflight.sh gates on: the factory firmware,
#       taken BEFORE anything is written. Read-only on the device.
#   tools/fw/golden.sh verify <image.bin>
#       hash it against its .sha256 and parse it again.
#   tools/fw/golden.sh copy <image.bin> <dest-dir | host:/dest-dir>
#       the off-machine copy: copy it, hash it THERE, record path and hash in OFFMACHINE.tsv
#       beside the source. preflight.sh check 4 reads that record. A destination of the form
#       host:/path goes over ssh, which is what "off this machine" usually means.
#
# The rules, from firmware/SAFETY.md, each one paid for on the Panda Vent:
#   - a golden is taken BEFORE any flash, never after. A backup taken after the damage is
#     not a backup
#   - every image is chmod 444 on capture; new captures get new names; nothing is overwritten
#   - both app slots are read and recorded. An OTA writes only the inactive slot, so a
#     golden taken right after one flash still holds whatever was there before in the
#     other half: flash the same image twice before a golden meant as a restore point
#   - goldens are never committed. NVS inside them carries the Wi-Fi password, the printer
#     serial and its access code in plaintext. They live under the backup root below, outside
#     every repository
#
# Files: <root>/{stock,goldens}/GOLDEN-<timestamp>-full-<size>.bin with a .sha256 beside each,
# <root>/MANIFEST.tsv (one line per capture: time, file, sha256, size, method, both slots,
# animations found, note), <root>/stock/RESTORE-THIS-UNIT.txt (the unit's MAC, chip and flash
# size, written once and checked on every later USB read), <root>/*/OFFMACHINE.tsv.
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
MODE="${1:-}"; shift || true
NOTE=""; PORT=""; READS=3; STOCK=0
die() { echo "golden: $*" >&2; exit 1; }
fsize() { wc -c < "$1" | tr -d ' '; }          # BSD and GNU stat disagree on flags; wc does not

record_capture() {   # <file> <method> <note>   verify structure, hash, 444, manifest
    local f="$1" method="$2" note="$3" dir base info sha size
    dir="$(dirname "$f")"; base="$(basename "$f")"
    info="$($FI inspect "$f")" || { echo "$info"; die "$base does not parse as a flash image; kept as $base for inspection, NOT recorded"; }
    echo "$info"
    sha="$(shasum -a 256 "$f" | awk '{print $1}')"; size="$(fsize "$f")"
    printf '%s  %s\n' "$sha" "$base" > "${f%.bin}.sha256"
    chmod 444 "$f" "${f%.bin}.sha256"
    local slots gifs same
    slots="$(echo "$info" | awk -F'  +' '/^  (ota_|factory|app)/{printf "%s ", $0}' | tr -s ' ' | sed 's/^ //')"
    gifs="$(echo "$info" | awk '/animations found/{print $NF}')"
    same="$(echo "$info" | awk '/both slots the same build/{print $NF}')"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$(date +%Y-%m-%dT%H:%M:%S%z)" "${f#$ROOT/}" "$sha" "$size" "$method" "slots_same_build=$same" "animations=$gifs" "$note" >> "$ROOT/MANIFEST.tsv"
    echo
    echo "recorded: $f"
    echo "          sha256 $sha, $size bytes, chmod 444, manifest line appended"
    [ "$same" = "yes" ] || echo "NOTE: the two app slots differ. A rollback boots the other one. Flash the same image twice before a golden meant as a restore point."
}

case "$MODE" in
http)
    HOST="${1:-}"; shift || true
    while [ $# -gt 0 ]; do case "$1" in --note) NOTE="$2"; shift 2;; *) die "unknown option $1";; esac; done
    [ -n "$HOST" ] || die "usage: golden.sh http <host> [--note TEXT]"
    mkdir -p "$ROOT/goldens"
    TS="$(date +%Y%m%d-%H%M%S)"; TMP="$ROOT/goldens/.incoming-$TS.bin"; HDR="$ROOT/goldens/.incoming-$TS.hdr"
    echo "pulling the whole flash from http://$HOST/backup ..."
    curl -sS --fail -m 900 -D "$HDR" -o "$TMP" "http://$HOST/backup" || { rm -f "$TMP" "$HDR"; die "GET /backup failed (the factory firmware has no /backup; is the clone installed, and is this the station address, not the hotspot?)"; }
    WANT="$(awk 'tolower($1)=="x-flash-size:"{gsub(/\r/,"",$2); print $2}' "$HDR")"
    BUILD="$(awk 'tolower($1)=="x-build:"{gsub(/\r/,"",$2); print $2}' "$HDR")"
    GOT="$(fsize "$TMP")"; rm -f "$HDR"
    [ -n "$WANT" ] || { rm -f "$TMP"; die "no X-Flash-Size header: not the clone's /backup"; }
    [ "$GOT" = "$WANT" ] || { rm -f "$TMP"; die "SHORT READ: got $GOT bytes, the device promised $WANT. Not kept."; }
    SIZE_MB=$((GOT / 1048576))
    OUT="$ROOT/goldens/GOLDEN-$TS-full-${SIZE_MB}MB.bin"
    [ -e "$OUT" ] && die "$OUT already exists; nothing is overwritten"
    mv "$TMP" "$OUT"
    echo "received $GOT bytes, device build ${BUILD:-unknown}"
    record_capture "$OUT" "http:$HOST build=${BUILD:-unknown}" "$NOTE"
    ;;
usb)
    while [ $# -gt 0 ]; do case "$1" in --stock) STOCK=1; shift;; --port) PORT="$2"; shift 2;; --reads) READS="$2"; shift 2;; --note) NOTE="$2"; shift 2;; *) die "unknown option $1";; esac; done
    command -v esptool.py >/dev/null 2>&1 || . ~/esp/esp-idf/export.sh >/dev/null 2>&1 || true
    ESPTOOL="python3 -m esptool"
    $ESPTOOL version >/dev/null 2>&1 || die "esptool is not available; run . ~/esp/esp-idf/export.sh first"
    # esptool v4 spells its subcommands and reset modes with underscores, v5 with hyphens.
    # Ask this esptool which it speaks. The backup is not the place to find out that a
    # subcommand name changed: on v4 the hyphenated spelling exits with a usage error, the
    # chip name parses as empty, and the script stops before reading a single byte.
    if $ESPTOOL --help 2>&1 | grep -q 'read_flash'; then U=_; else U=-; fi
    if $ESPTOOL --help 2>&1 | grep -q 'default_reset'; then R=_; else R=-; fi
    SUB_CHIP="chip${U}id"; SUB_FLASH="flash${U}id"; SUB_MAC="read${U}mac"; SUB_READ="read${U}flash"
    BEFORE="default${R}reset"; AFTER="no${R}reset"
    if [ -z "$PORT" ]; then
        set +u; PORTS=( /dev/cu.usbmodem* /dev/cu.usbserial* /dev/cu.wchusbserial* /dev/cu.SLAB_USBtoUART* ); set -u
        PORTS=( $(for p in "${PORTS[@]}"; do [ -e "$p" ] && echo "$p"; done) )
        [ "${#PORTS[@]}" -eq 1 ] || die "found ${#PORTS[@]} serial ports (${PORTS[*]:-none}); pass --port"
        PORT="${PORTS[0]}"
    fi
    DEST="$ROOT/goldens"; [ "$STOCK" = 1 ] && DEST="$ROOT/stock"
    mkdir -p "$DEST"
    echo "identifying the chip on $PORT (read-only) ..."
    CHIP="$($ESPTOOL --chip auto --port "$PORT" "$SUB_CHIP" 2>&1 | awk -F'Chip is ' '/Chip is/{print $2}' | awk '{print $1}')"
    [ -n "$CHIP" ] || die "the chip id gave no chip; is the device in download mode and the cable a data cable?"
    case "$CHIP" in ESP32-C3*) ;; *) die "the chip id reports '$CHIP', not an ESP32-C3. Every assumption in this repository is about the C3. Stopping.";; esac
    FLASH="$($ESPTOOL --chip auto --port "$PORT" "$SUB_FLASH" 2>&1 | awk -F'Detected flash size: ' '/Detected flash size/{print $2}' | awk '{print $1}')"
    MAC="$($ESPTOOL --chip auto --port "$PORT" "$SUB_MAC" 2>&1 | awk '/^MAC:/{print tolower($2)}' | head -1)"
    [ -n "$FLASH" ] && [ -n "$MAC" ] || die "the flash id or the MAC read gave nothing"
    case "$FLASH" in 2MB) BYTES=0x200000;; 4MB) BYTES=0x400000;; 8MB) BYTES=0x800000;; 16MB) BYTES=0x1000000;; *) die "unexpected flash size '$FLASH'";; esac
    echo "chip $CHIP, flash $FLASH, MAC recorded (not printed)"
    UNIT="$ROOT/stock/RESTORE-THIS-UNIT.txt"
    if [ -f "$UNIT" ]; then
        REC="$(awk -F= '/^MAC=/{print tolower($2)}' "$UNIT")"
        [ "$REC" = "$MAC" ] || die "this unit's MAC differs from the one recorded in $UNIT. Not the unit the stock dump came from. Stopping."
    elif [ "$STOCK" = 1 ]; then
        mkdir -p "$ROOT/stock"
        printf 'MAC=%s\nCHIP=%s\nFLASH_SIZE=%s\nTAKEN=%s\n' "$MAC" "$CHIP" "$FLASH" "$(date +%Y-%m-%dT%H:%M:%S%z)" > "$UNIT"
        chmod 444 "$UNIT"; echo "wrote $UNIT"
    fi
    HASHES=()
    for i in $(seq 1 "$READS"); do
        TS="$(date +%Y%m%d-%H%M%S)"; OUT="$DEST/GOLDEN-$TS-full-$FLASH.bin"
        [ -e "$OUT" ] && { sleep 1; TS="$(date +%Y%m%d-%H%M%S)"; OUT="$DEST/GOLDEN-$TS-full-$FLASH.bin"; }
        echo; echo "read $i of $READS: 0x0 .. $BYTES -> $OUT (minutes; do not unplug)"
        $ESPTOOL --chip esp32c3 --port "$PORT" -b 460800 --before "$BEFORE" --after "$AFTER" "$SUB_READ" 0 "$BYTES" "$OUT" || die "read $i failed; the file, if any, is left for inspection"
        record_capture "$OUT" "usb:$PORT read$i/$READS" "$NOTE"
        HASHES+=( "$(awk '{print $1}' "${OUT%.bin}.sha256")" )
    done
    echo; echo "reads: ${#HASHES[@]}, distinct hashes: $(printf '%s\n' "${HASHES[@]}" | sort -u | wc -l | tr -d ' ')"
    if [ "$(printf '%s\n' "${HASHES[@]}" | sort | uniq -c | awk '$1>=2' | wc -l | tr -d ' ')" -ge 1 ]; then
        echo "at least two reads agree. Next: golden.sh copy <one of them> <off-machine dir>"
    else
        echo "NO TWO READS AGREE. Read again, at a lower baud if it keeps happening. Nothing is verified yet." ; exit 1
    fi
    ;;
verify)
    F="${1:-}"; [ -f "$F" ] || die "usage: golden.sh verify <image.bin>"
    ( cd "$(dirname "$F")" && shasum -a 256 -c "$(basename "${F%.bin}.sha256")" ) || die "hash mismatch or no .sha256: do not trust $F"
    $FI inspect "$F"
    ;;
copy)
    F="${1:-}"; DEST="${2:-}"; [ -f "$F" ] && [ -n "$DEST" ] || die "usage: golden.sh copy <image.bin> <dest-dir | host:/dest-dir>"
    # A destination with a colon and no local directory of that name is a host: scp it and
    # hash it over there, which is the whole point of an off-machine copy. The remote may
    # spell the hasher either way, so ask it for both.
    case "$DEST" in
      *:*) if [ ! -d "$DEST" ]; then
             RHOST="${DEST%%:*}"; RPATH="${DEST#*:}"; RT="$RPATH/$(basename "$F")"
             ssh -o BatchMode=yes "$RHOST" "mkdir -p '$RPATH'" || die "cannot create $RPATH on $RHOST"
             ssh -o BatchMode=yes "$RHOST" "test -e '$RT'" && die "$DEST/$(basename "$F") already exists; nothing is overwritten"
             scp -q "$F" "$RHOST:$RT" && scp -q "${F%.bin}.sha256" "$RHOST:${RT%.bin}.sha256" || die "copy to $RHOST failed"
             SRC="$(awk '{print $1}' "${F%.bin}.sha256")"
             THERE="$(ssh -o BatchMode=yes "$RHOST" "sha256sum '$RT' 2>/dev/null || shasum -a 256 '$RT'" | awk '{print $1}')"
             [ -n "$THERE" ] || die "could not hash the copy on $RHOST; it is left in place, verify it by hand"
             [ "$SRC" = "$THERE" ] || die "the copy hashes differently on $RHOST; it is left in place, do not trust it"
             ssh -o BatchMode=yes "$RHOST" "chmod 444 '$RT' '${RT%.bin}.sha256'" || true
             printf '%s\t%s\t%s\t%s\n' "$THERE" "$RHOST:$RT" "$(date +%Y-%m-%dT%H:%M:%S%z)" "$(hostname)" >> "$(dirname "$F")/OFFMACHINE.tsv"
             echo "copied and re-hashed on $RHOST: $RT"; echo "recorded in $(dirname "$F")/OFFMACHINE.tsv"
             exit 0
           fi ;;
    esac
    mkdir -p "$DEST" || die "cannot create $DEST"
    T="$DEST/$(basename "$F")"; [ -e "$T" ] && die "$T already exists; nothing is overwritten"
    cp "$F" "$T" && cp "${F%.bin}.sha256" "${T%.bin}.sha256" || die "copy failed"
    SRC="$(awk '{print $1}' "${F%.bin}.sha256")"; THERE="$(shasum -a 256 "$T" | awk '{print $1}')"
    [ "$SRC" = "$THERE" ] || { rm -f "$T"; die "the copy hashes differently at the destination; removed"; }
    chmod 444 "$T" "${T%.bin}.sha256"
    printf '%s\t%s\t%s\t%s\n' "$THERE" "$T" "$(date +%Y-%m-%dT%H:%M:%S%z)" "$(hostname)" >> "$(dirname "$F")/OFFMACHINE.tsv"
    echo "copied and re-hashed at the destination: $T"; echo "recorded in $(dirname "$F")/OFFMACHINE.tsv"
    ;;
*)
    sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'; exit 2;;
esac
