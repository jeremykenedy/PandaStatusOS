#!/usr/bin/env bash
#
# preflight.sh: the gate every flash path calls first.
#
# It refuses unless ALL of these pass, and it prints which one did not:
#   1. a full dump of the stock firmware exists outside the repository, each file verified
#      against its own .sha256 now, not remembered
#   2. at least two independent reads of it exist and their sha256 match byte for byte
#   3. that image parses: partition table at 0x8000, every partition enumerated, every app
#      slot with the 0xE9 image magic and esp_app_desc at +0x20
#   4. a copy exists off this machine, recorded by path and sha256 in stock/OFFMACHINE.tsv,
#      re-hashed when the path is reachable
#   5. the fifteen animation slots each have their own recorded sha256, by name
#   6. backups/RESTORE.md Part B carries no PENDING DUMP placeholder
#   7. firmware/partitions.csv is the stock partition table read from that dump, not a
#      generated one: the clone is built against the layout it will run inside
#   8. the unit the dump came from is recorded by MAC, so a flash can refuse another unit
#
# There is no override flag and no --force. A check that can be waived is not a gate, and
# the reason this file exists is recorded in firmware/SAFETY.md: on the Panda Vent, one
# flash without a verified full dump made the factory firmware unrecoverable for good.
#
# Where it looks. PS_BACKUPS_DIR relocates the backup root (default below) and PS_REPO_ROOT
# the repository; both exist so tools/fw/test-flash-tools.sh can point the gate at synthetic
# data. Pointing them at fake data lies to yourself, not to the gate.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="${PS_REPO_ROOT:-$(cd "$HERE/../.." && pwd)}"
BACKUPS="${PS_BACKUPS_DIR:-/Users/jeremykenedy/backups/PandaStatus}"
echo "preflight: stock dump at $BACKUPS/stock, repository at $ROOT"
exec python3 "$HERE/flashimage.py" preflight --backups "$BACKUPS" --repo "$ROOT"
