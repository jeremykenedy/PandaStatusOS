#!/usr/bin/env python3
"""Write firmware/partitions.csv from the stock partition table inside a flash dump.

    python3 tools/fw/partitions_from_dump.py <image.bin>            write firmware/partitions.csv
    python3 tools/fw/partitions_from_dump.py <image.bin> --check    compare, exit 1 on drift

The clone is built against the table it will run inside (D-028): the first install is an
OTA into one of the stock app slots, the bootloader and the table on the chip stay the
factory's, and the app's own partition lookups (the images partition above all) must name
what is actually there. So the CSV is read out of the dump, never generated. The header
records which image it came from; tools/fw/preflight.sh check 7 compares the two again on
the day.
"""
import os, sys, datetime
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import flashimage as fi

ROOT = os.environ.get("PS_REPO_ROOT") or os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "firmware", "partitions.csv")

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 1: sys.exit(__doc__)
    img = open(args[0], "rb").read()
    entries, md5_ok = fi.parse_table(img)
    if md5_ok is False: sys.exit("the image's partition table fails its own MD5; not writing anything from it")
    if "--check" in sys.argv:
        txt = open(OUT).read()
        if "PROVISIONAL" in txt: print("firmware/partitions.csv is still PROVISIONAL"); return 1
        ok = fi.same_table(fi.parse_csv(txt), entries)
        print("firmware/partitions.csv matches the dump's table" if ok else "firmware/partitions.csv DIFFERS from the dump's table")
        return 0 if ok else 1
    sha = fi.sha256(img)
    header = [f"# FROM DUMP sha256 {sha}, written {datetime.date.today().isoformat()} by tools/fw/partitions_from_dump.py.",
              "# This is the stock partition table read out of the unit's flash. The clone is built against",
              "# it and installed into one of its app slots over OTA (D-028). Do not edit; regenerate from",
              "# the dump. tools/fw/preflight.sh check 7 compares this file against the dump again."]
    open(OUT, "w").write(fi.table_csv(entries, header))
    print(f"wrote {OUT} from {args[0]} ({len(entries)} partitions)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
