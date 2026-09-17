#!/usr/bin/env bash
#
# ota-install.sh: install an app image over the network, and PROVE it landed.
#
#   tools/fw/ota-install.sh <host> <app.bin>
#   tools/fw/ota-install.sh verify <host>        the after-probe alone, from where the device is now
#
# This is the first-install path and the normal path after it. It POSTs the image to the
# device's own /ota endpoint, which the factory firmware already serves. An OTA writes one
# app slot and nothing else: not the bootloader at 0x0, not the partition table at 0x8000,
# not NVS, not the images partition holding the fifteen animations. The stock app stays in
# the other slot.
#
# The gate: tools/fw/preflight.sh runs first and its refusal is final. Then the unit is
# checked by MAC against the one the stock dump came from (ARP, so it must be on this LAN).
#
# The proof: the stock /ota answers 200 with an empty body whether the upload landed or
# not. Three Panda Vent builds were each reported flashed and none had landed. So this
# script records the build identifier (X-Build) and the sha256 of the served page before
# the upload, waits for the device to come back, reads both again, and reports FLASHED only
# when both moved to exactly what the image carries. Anything else is NOT LANDED.
#
# Every run is appended to <backup root>/flash-log.txt.
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
LOG="$ROOT/flash-log.txt"; LAST="$ROOT/last-install.txt"; mkdir -p "$ROOT"
say() { printf '%s  %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG"; }
die() { say "STOP: $*"; exit 1; }
probe() {   # sets P_STATUS P_BUILD P_PAGE for the device at $HOST
    local hdr body; hdr="$(mktemp)"; body="$(mktemp)"
    P_STATUS="$(curl -s -m 15 --compressed -D "$hdr" -o "$body" -w '%{http_code}' "http://$HOST/" || echo 000)"
    P_BUILD="$(awk 'tolower($1)=="x-build:"{gsub(/\r/,"",$2); print $2}' "$hdr")"; P_BUILD="${P_BUILD:-none}"
    P_PAGE="$(shasum -a 256 "$body" | awk '{print $1}')"
    rm -f "$hdr" "$body"
}
verdict() {   # EXPECT_BUILD EXPECT_PAGE BEFORE_BUILD BEFORE_PAGE against P_*; exits
    if [ "$P_BUILD" = "$1" ] && [ "$P_PAGE" = "$2" ] && { [ "$3" != "$1" ] || [ "$4" != "$2" ]; }; then
        say "FLASHED: the device now reports build $1 and serves the page the image carries. Both moved."
        say "next: run this same image once more so both app slots hold it, then tools/fw/golden.sh http <host>"
        exit 0
    fi
    say "NOT LANDED: expected build $1 / page ${2:0:16}, device reports build $P_BUILD / page ${P_PAGE:0:16}."
    exit 1
}

# ---- verify mode: the after-probe on its own, from wherever the device is reachable now.
# The first install changes the network: the clone has no Wi-Fi credentials, so it comes
# back on its own hotspot and the address that took the upload never answers again.
if [ "${1:-}" = verify ]; then
    HOST="${2:-}"; [ -n "$HOST" ] || { echo "usage: $0 verify <host>" >&2; exit 2; }
    [ -f "$LAST" ] || die "no $LAST: nothing was sent by this script yet"
    while IFS='=' read -r k v; do declare "L_$k=$v"; done < "$LAST"
    say "verify: $HOST against the upload of $L_WHEN ($L_BIN -> $L_HOST)"
    probe
    [ "$P_STATUS" = 200 ] || die "the device did not answer GET / at $HOST (HTTP $P_STATUS)"
    say "now:    build $P_BUILD, page sha ${P_PAGE:0:16}"
    verdict "$L_EXPECT_BUILD" "$L_EXPECT_PAGE" "$L_BEFORE_BUILD" "$L_BEFORE_PAGE"
fi

HOST="${1:-}"; BIN="${2:-}"
[ -n "$HOST" ] && [ -f "$BIN" ] || { echo "usage: $0 <host> <app.bin>   |   $0 verify <host>" >&2; exit 2; }

say "ota-install: $BIN -> $HOST"
# 1. the gate
bash "$HERE/preflight.sh" | tee -a "$LOG"; [ "${PIPESTATUS[0]}" -eq 0 ] || die "preflight refused; nothing sent"

# 2. what the image is, and what the device must report afterwards
while IFS='=' read -r k v; do [ -n "$k" ] && declare "IMG_$k=$v"; done < <($FI appdesc "$BIN" 2>/dev/null)
[ "${IMG_NOT_AN_APP_IMAGE:-0}" = 1 ] || [ -z "${IMG_BUILD:-}" ] && die "$BIN is not an app image (no 0xE9 / esp_app_desc)"
[ "$IMG_PAGE_SHA256" != none ] || die "$BIN carries no page; the served-page check would be meaningless"
say "image: $IMG_PROJECT $IMG_VERSION, idf $IMG_IDF, built $IMG_DATE $IMG_TIME, build $IMG_BUILD, page sha ${IMG_PAGE_SHA256:0:16}, $IMG_SIZE bytes"
SLOTMIN="$($FI inspect --json "$(ls "$ROOT"/stock/GOLDEN-*.bin | head -1)" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(min(a["size"] for a in r["apps"]))')"
[ "$IMG_SIZE" -le "$SLOTMIN" ] || die "the image ($IMG_SIZE bytes) is larger than the smallest stock app slot ($SLOTMIN bytes)"

# 3. the device before
probe
[ "$P_STATUS" = 200 ] || die "the device did not answer GET / (HTTP $P_STATUS); nothing sent"
say "before: build $P_BUILD, page sha ${P_PAGE:0:16}"

# 4. the unit: the MAC that answered must be the MAC the stock dump came from
IP="$(python3 -c 'import socket,sys; print(socket.gethostbyname(sys.argv[1]))' "${HOST%%:*}" 2>/dev/null || true)"
case "$IP" in 127.*|::1|"") say "unit: $HOST is loopback or unresolved; no unit identity to check (a real device is never at loopback)";;
*)
    WANT="$(awk -F= '/^MAC=/{print tolower($2)}' "$ROOT/stock/RESTORE-THIS-UNIT.txt")"
    GOT="$(arp -n "$IP" 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i ~ /^([0-9a-f]{1,2}:){5}[0-9a-f]{1,2}$/) print tolower($i)}' | head -1)"
    GOT="$(echo "$GOT" | awk -F: '{for(i=1;i<=NF;i++) printf "%s%02s", (i>1?":":""), $i}' | tr ' ' 0)"
    [ -n "$GOT" ] || die "no ARP entry for $IP; run this from the network the device is on"
    [ "$GOT" = "$WANT" ] || die "the device at $IP is not the unit the stock dump came from (MAC differs). Nothing sent."
    say "unit: MAC matches the stock dump's unit";;
esac

# 5. the upload. The status code is recorded and means nothing.
if [ "$P_BUILD" = "$IMG_BUILD" ] && [ "$P_PAGE" = "$IMG_PAGE_SHA256" ]; then
    say "NOT VERIFIABLE: the device already reports this exact build and page. An upload could not be told from no upload. Build a new image (the build id changes on every build) or accept that this run proves nothing."
    exit 2
fi
printf 'WHEN=%s\nHOST=%s\nBIN=%s\nEXPECT_BUILD=%s\nEXPECT_PAGE=%s\nBEFORE_BUILD=%s\nBEFORE_PAGE=%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$HOST" "$BIN" "$IMG_BUILD" "$IMG_PAGE_SHA256" "$P_BUILD" "$P_PAGE" > "$LAST"
say "sending $IMG_SIZE bytes as OTA-Type ota_fw ..."
CODE="$(curl -s -m 600 -X POST -H 'OTA-Type: ota_fw' -H 'Content-Type: application/octet-stream' --data-binary "@$BIN" -o /dev/null -w '%{http_code}' "http://$HOST/ota" || echo 000)"
say "upload answered HTTP $CODE (recorded; not evidence either way)"

# 6. wait for the device to come back, then read both identifiers again
say "waiting for the device to restart ..."
DEADLINE=$(( $(date +%s) + 180 )); sleep 3
while :; do
    probe
    [ "$P_STATUS" = 200 ] && break
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
        say "NOT LANDED (no answer at $HOST within 180 s)."
        say "If this was the FIRST install, that is expected: the clone has no Wi-Fi credentials and is on its own hotspot"
        say "(placeholder name PandaStatus, open, 192.168.4.1). Join it and run:  $0 verify 192.168.4.1"
        say "Otherwise the device may be booting the other slot; check the page by hand before doing anything else."
        exit 1
    fi
    sleep 2
done
say "after:  build $P_BUILD, page sha ${P_PAGE:0:16}"

# 7. the verdict
verdict "$IMG_BUILD" "$IMG_PAGE_SHA256" "$(awk -F= '/^BEFORE_BUILD=/{print $2}' "$LAST")" "$(awk -F= '/^BEFORE_PAGE=/{print $2}' "$LAST")"
