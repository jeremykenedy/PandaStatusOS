#!/usr/bin/env python3
"""Flash images of the Panda Status P2: read them, check them, and gate on them.

Standard library only. Every script in tools/fw/ calls this, and it runs on its own:

    flashimage.py inspect  <image.bin> [--json]     partition table, each app slot's identity, the animations
    flashimage.py appdesc  <app.bin>                one app image: project, version, IDF, build id, page sha256
    flashimage.py extract  <image.bin> <name> <out> one partition's bytes; an app slot is cut at the app image's end
    flashimage.py csv      <image.bin>              the image's partition table as an ESP-IDF CSV
    flashimage.py gifs     <image.bin>              every animation outside the app slots: offset, length, sha256
    flashimage.py otadata  <otadata.bin> <n_slots>  which slot the bootloader boots, from a read of otadata
    flashimage.py encode   <table.csv> <out.bin>    encode a CSV table (synthetic images for the tests)
    flashimage.py preflight --backups DIR --repo ROOT   the gate. tools/fw/preflight.sh is the entry point

Layout facts are ESP-IDF v5.3.1's (esp_flash_partitions.h, esp_app_desc.h, esp_ota_ops.h):
a 32-byte partition entry with magic 0x50AA at 0x8000, an MD5 entry with magic 0xEBEB, the
app image magic 0xE9 as a slot's first byte, esp_app_desc_t at slot + 0x20 with magic
0xABCD5432 and the ELF sha256 at +144, and otadata as two 32-byte entries 0x1000 apart whose
CRC is crc32 over the sequence number with initial 0xFFFFFFFF. Nothing here assumes the
P2's own layout: it is read out of the image every time.
"""
import argparse, hashlib, json, os, re, struct, sys, zlib

PT_OFFSET, ENTRY = 0x8000, 32
PT_MAGIC, MD5_MAGIC = b"\xaa\x50", b"\xeb\xeb"
APP_MAGIC, DESC_OFF, DESC_MAGIC = 0xE9, 0x20, 0xABCD5432
TABLE_BYTES = 0xC00

# The fifteen stage animation slots, in the device's order (docs/protocol-websocket.md, FACT;
# firmware/main/ps_cfg.c carries the same list and tools/fw/test-flash-tools.sh checks they agree).
SLOTS = ["standby", "nozzle_heating", "bed_heating", "bed_leveling", "homing", "nozzle_cleaning",
         "calibrating_flow", "xy_mesh_mode_sweep", "filament_check_location", "filament_cut",
         "filament_pull_back_cur", "filament_push_new", "filament_purge_old", "printing_ok", "printing"]

TYPE_NAMES = {0: "app", 1: "data"}
SUB_NAMES = {
    "app": {0: "factory", 0x20: "test", **{0x10 + i: f"ota_{i}" for i in range(16)}},
    "data": {0: "ota", 1: "phy", 2: "nvs", 3: "coredump", 4: "nvs_keys", 5: "efuse", 6: "undefined",
             0x80: "esphttpd", 0x81: "fat", 0x82: "spiffs", 0x83: "littlefs"},
}

def sha256(b): return hashlib.sha256(b).hexdigest()
def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

# ------------------------------------------------------------------ the partition table ----
def parse_table(img, base=PT_OFFSET):
    """Entries at base until the magic stops; the MD5 entry, when present, is verified."""
    entries, raw, off, md5_ok = [], b"", base, None
    while off + ENTRY <= len(img):
        e = img[off:off + ENTRY]
        if e[:2] == MD5_MAGIC:
            md5_ok = hashlib.md5(raw).digest() == e[16:32]
            break
        if e[:2] != PT_MAGIC: break
        typ, sub, poff, psize = struct.unpack_from("<BBII", e, 2)
        name = e[12:28].split(b"\0", 1)[0].decode("ascii", "replace")
        flags = struct.unpack_from("<I", e, 28)[0]
        tname = TYPE_NAMES.get(typ, f"0x{typ:02x}")
        sname = SUB_NAMES.get(tname, {}).get(sub, f"0x{sub:02x}")
        entries.append({"name": name, "type": typ, "subtype": sub, "offset": poff, "size": psize, "flags": flags,
                        "type_name": tname, "subtype_name": sname})
        raw += e; off += ENTRY
    if not entries: raise ValueError(f"no partition table at 0x{base:x}")
    return entries, md5_ok

def table_csv(entries, header_lines=()):
    out = list(header_lines) + ["# Name,     Type, SubType,  Offset,   Size,     Flags"]
    for e in entries:
        t = e["type_name"] if e["type"] in TYPE_NAMES else f"0x{e['type']:02x}"
        s = e["subtype_name"] if not e["subtype_name"].startswith("0x") else e["subtype_name"]
        f = "encrypted" if e["flags"] & 1 else ""
        out.append(f"{e['name'] + ',':<11s}{t + ',':<6s}{s + ',':<10s}0x{e['offset']:x}, 0x{e['size']:x}, {f}")
    return "\n".join(out) + "\n"

def _num(s):
    s = s.strip().lower()
    if s.endswith("k"): return int(s[:-1], 0) * 1024
    if s.endswith("m"): return int(s[:-1], 0) * 1024 * 1024
    return int(s, 0)

def parse_csv(text):
    """ESP-IDF's CSV: name, type, subtype, offset, size, flags. Names or numbers for type/subtype."""
    entries = []
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if not line: continue
        f = [x.strip() for x in line.split(",")]
        while len(f) < 6: f.append("")
        name, typ, sub, off, size, flags = f[:6]
        tnum = {"app": 0, "data": 1}.get(typ.lower(), None)
        if tnum is None: tnum = int(typ, 0)
        tname = TYPE_NAMES.get(tnum, f"0x{tnum:02x}")
        rev = {v: k for k, v in SUB_NAMES.get(tname, {}).items()}
        snum = rev.get(sub.lower(), None)
        if snum is None: snum = int(sub, 0) if sub else 0
        entries.append({"name": name, "type": tnum, "subtype": snum, "offset": _num(off) if off else None,
                        "size": _num(size), "flags": 1 if "encrypted" in flags else 0,
                        "type_name": tname, "subtype_name": SUB_NAMES.get(tname, {}).get(snum, f"0x{snum:02x}")})
    # offsets left blank in a CSV follow the previous partition, app partitions 0x10000 aligned
    pos = PT_OFFSET + TABLE_BYTES
    for e in entries:
        if e["offset"] is None:
            align = 0x10000 if e["type"] == 0 else 0x1000
            pos = (pos + align - 1) // align * align
            e["offset"] = pos
        pos = e["offset"] + e["size"]
    return entries

def encode_table(entries):
    raw = b""
    for e in entries:
        raw += PT_MAGIC + struct.pack("<BBII", e["type"], e["subtype"], e["offset"], e["size"]) \
               + e["name"].encode()[:16].ljust(16, b"\0") + struct.pack("<I", e["flags"])
    raw += MD5_MAGIC + b"\xff" * 14 + hashlib.md5(raw).digest()
    return raw.ljust(TABLE_BYTES, b"\xff")

def same_table(a, b):
    key = lambda e: (e["name"], e["type"], e["subtype"], e["offset"], e["size"])
    return [key(e) for e in a] == [key(e) for e in b]

# ------------------------------------------------------------------------- app images ----
def app_desc(blob, base=0):
    """esp_app_desc_t at base + 0x20, or None if this is not an app image."""
    if len(blob) < base + DESC_OFF + 176 or blob[base] != APP_MAGIC: return None
    magic, = struct.unpack_from("<I", blob, base + DESC_OFF)
    if magic != DESC_MAGIC: return None
    s = lambda o, n: blob[base + DESC_OFF + o: base + DESC_OFF + o + n].split(b"\0", 1)[0].decode("ascii", "replace")
    elf = blob[base + DESC_OFF + 144: base + DESC_OFF + 176]
    return {"version": s(16, 32), "project": s(48, 32), "time": s(80, 16), "date": s(96, 16),
            "idf": s(112, 32), "build": elf[:8].hex(), "elf_sha256": elf.hex()}

def _gzip_member(blob, i):
    """Decompress the gzip member at blob[i:]; returns the bytes or None."""
    if blob[i:i + 3] != b"\x1f\x8b\x08": return None
    flg, p = blob[i + 3], i + 10
    if flg & 4: p += 2 + struct.unpack_from("<H", blob, p)[0]
    if flg & 8: p = blob.index(b"\0", p) + 1
    if flg & 16: p = blob.index(b"\0", p) + 1
    if flg & 2: p += 2
    d = zlib.decompressobj(-15)
    try:
        out = d.decompress(blob[p:p + (8 << 20)])
    except zlib.error:
        return None
    return out if d.eof else None

def page_from_app(blob):
    """(kind, bytes) of the page an app image carries: the largest gzip member that is an HTML
    page, decompressed ("gzip", what the clone serves); else the raw HTML document embedded as
    text ("raw", what the factory app serves, from <!DOCTYPE or <html to the last </html>);
    else (None, None)."""
    best, i = None, blob.find(b"\x1f\x8b\x08")
    while i >= 0:
        out = _gzip_member(blob, i)
        if out and b"<title>" in out and (best is None or len(out) > len(best)): best = out
        i = blob.find(b"\x1f\x8b\x08", i + 1)
    if best is not None: return "gzip", best
    start = blob.find(b"<!DOCTYPE html")
    if start < 0: start = blob.find(b"<!doctype html")
    if start < 0: start = blob.find(b"<html")
    end = blob.rfind(b"</html>")
    if 0 <= start < end: return "raw", blob[start:end + 7]
    return None, None

def extract(img, name):
    """The bytes of the partition called name, trimmed of trailing erased (0xFF) bytes only when
    it is an app slot, where the image ends where the app image ends."""
    entries, _ = parse_table(img)
    for e in entries:
        if e["name"] == name:
            return e, img[e["offset"]:e["offset"] + e["size"]]
    raise KeyError(name)

def app_image_length(blob):
    """The length of an ESP app image: the segments, the checksum byte at the next 16-byte
    boundary, and the appended sha256 when the header says one is there."""
    if len(blob) < 24 or blob[0] != APP_MAGIC: return None
    nseg, hash_appended = blob[1], blob[23]
    p = 24
    for _ in range(nseg):
        if p + 8 > len(blob): return None
        _, n = struct.unpack_from("<II", blob, p)
        p += 8 + n
    p = (p + 16) // 16 * 16       # padding then the checksum byte in the last byte of the 16
    if hash_appended: p += 32
    return p if p <= len(blob) else None

# ------------------------------------------------------------------------ animations ----
def gif_length(b, i):
    """Walk one GIF starting at b[i]; its length, or None if it is not a whole GIF."""
    if b[i:i + 6] not in (b"GIF89a", b"GIF87a"): return None
    p = i + 6
    if p + 7 > len(b): return None
    flags = b[p + 4]; p += 7
    if flags & 0x80: p += 3 * (2 << (flags & 7))
    while True:
        if p >= len(b): return None
        t = b[p]; p += 1
        if t == 0x3B: return p - i
        if t == 0x21:
            p += 1
            while True:
                if p >= len(b): return None
                n = b[p]; p += 1
                if n == 0: break
                p += n
        elif t == 0x2C:
            if p + 9 > len(b): return None
            lf = b[p + 8]; p += 9
            if lf & 0x80: p += 3 * (2 << (lf & 7))
            p += 1
            while True:
                if p >= len(b): return None
                n = b[p]; p += 1
                if n == 0: break
                p += n
        else:
            return None

def gif_scan(img, entries):
    """Whole GIFs in every partition that is not an app slot, NVS, otadata, PHY or coredump."""
    skip = {("data", "nvs"), ("data", "ota"), ("data", "phy"), ("data", "coredump"), ("data", "nvs_keys")}
    found = []
    for e in entries:
        if e["type_name"] == "app" or (e["type_name"], e["subtype_name"]) in skip: continue
        lo, hi = e["offset"], min(e["offset"] + e["size"], len(img))
        i = img.find(b"GIF8", lo, hi)
        while 0 <= i < hi:
            n = gif_length(img, i)
            if n and i + n <= hi:
                w, h = struct.unpack_from("<HH", img, i + 6)
                found.append({"partition": e["name"], "offset": i, "length": n, "sha256": sha256(img[i:i + n]), "width": w, "height": h})
                i = img.find(b"GIF8", i + n, hi)
            else:
                i = img.find(b"GIF8", i + 1, hi)
    return found

# ---------------------------------------------------------------------------- otadata ----
def otadata_active(blob, n_slots):
    """(active slot index or None, [entry, entry]) from an otadata partition read."""
    ents = []
    for base in (0, 0x1000):
        if base + 32 > len(blob): ents.append(None); continue
        seq, = struct.unpack_from("<I", blob, base)
        state, crc = struct.unpack_from("<II", blob, base + 24)
        valid = seq != 0xFFFFFFFF and crc == (zlib.crc32(blob[base:base + 4], 0xFFFFFFFF) & 0xFFFFFFFF)
        ents.append({"seq": seq, "state": state, "crc_ok": valid})
    valid = [e for e in ents if e and e["crc_ok"]]
    if not valid or n_slots == 0: return None, ents
    seq = max(e["seq"] for e in valid)
    return (seq - 1) % n_slots, ents

# ----------------------------------------------------------------------------- inspect ----
def inspect(img):
    entries, md5_ok = parse_table(img)
    apps = []
    for e in entries:
        if e["type_name"] != "app": continue
        d = app_desc(img, e["offset"]) if e["offset"] + DESC_OFF + 176 <= len(img) else None
        apps.append({"name": e["name"], "offset": e["offset"], "size": e["size"], "desc": d})
    gifs = gif_scan(img, entries)
    ids = [f"{a['name']}={a['desc']['project']}/{a['desc']['version']}/{a['desc']['build']}" if a["desc"] else f"{a['name']}=empty" for a in apps]
    builds = {a["desc"]["build"] for a in apps if a["desc"]}
    return {"size": len(img), "sha256": sha256(img), "bootloader_magic": bool(img) and img[0] == APP_MAGIC,
            "table": entries, "md5_ok": md5_ok, "apps": apps, "gifs": gifs,
            "slot_summary": " ".join(ids), "same_build": len(apps) >= 2 and len(builds) == 1 and all(a["desc"] for a in apps)}

def print_inspect(r):
    print(f"image: {r['size']} bytes  sha256 {r['sha256']}")
    print(f"bootloader magic at 0x0: {'yes' if r['bootloader_magic'] else 'NO'}    partition table md5: {'ok' if r['md5_ok'] else 'absent' if r['md5_ok'] is None else 'BAD'}")
    print("partitions:")
    for e in r["table"]:
        print(f"  {e['name']:<12s} {e['type_name']:<5s} {e['subtype_name']:<9s} 0x{e['offset']:06x}  0x{e['size']:06x}")
    print("app slots:")
    for a in r["apps"]:
        d = a["desc"]
        print(f"  {a['name']:<8s} 0x{a['offset']:06x}  " + (f"{d['project']} {d['version']}  idf {d['idf']}  built {d['date']} {d['time']}  build {d['build']}" if d else "no app image (no 0xE9 / esp_app_desc)"))
    print(f"both slots the same build: {'yes' if r['same_build'] else 'no'}")
    print(f"animations found outside the app slots: {len(r['gifs'])}")
    for g in r["gifs"]:
        print(f"  {g['partition']:<10s} 0x{g['offset']:06x}  {g['length']:>8d} B  {g['width']}x{g['height']}  {g['sha256']}")

# --------------------------------------------------------------------------- preflight ----
def preflight(backups, repo):
    """The gate. Every check runs; the verdict is all of them. Returns the exit code."""
    stock = os.path.join(backups, "stock")
    results = []
    def check(name, ok, detail): results.append((name, bool(ok), detail))

    # 1. a stock dump exists outside the repository, each file with a sha256 that verifies now
    files = sorted(f for f in os.listdir(stock) if f.startswith("GOLDEN-") and f.endswith(".bin")) if os.path.isdir(stock) else []
    hashes = {}
    bad = []
    for f in files:
        p = os.path.join(stock, f)
        h = sha256_file(p)
        side = p[:-4] + ".sha256"
        try:
            rec = open(side).read().split()[0]
        except OSError:
            rec = None
        if rec != h: bad.append(f"{f}: {'no .sha256' if rec is None else 'sha256 differs from its record'}")
        else: hashes[f] = h
    check("1 stock dump present, every file verifies against its .sha256", files and not bad,
          f"{len(files)} file(s) in {stock}" + (("; " + "; ".join(bad)) if bad else "") if files else f"no GOLDEN-*.bin in {stock}")

    # 2. two independent reads agree byte for byte
    groups = {}
    for f, h in hashes.items(): groups.setdefault(h, []).append(f)
    agreed = [h for h, fs in groups.items() if len(fs) >= 2]
    check("2 at least two reads agree byte for byte", len(agreed) == 1,
          (f"{len(groups[agreed[0]])} files share {agreed[0][:16]}" if len(agreed) == 1 else
           "no two files share a sha256" if not agreed else f"{len(agreed)} different agreed images; keep one set in stock/"))
    img, sha = None, agreed[0] if len(agreed) == 1 else None
    if sha:
        with open(os.path.join(stock, groups[sha][0]), "rb") as fh: img = fh.read()

    # 3. the dump parses
    if img is not None:
        try:
            r = inspect(img)
            apps_ok = bool(r["apps"]) and all(a["desc"] for a in r["apps"])
            detail = f"{len(r['table'])} partitions, md5 {'ok' if r['md5_ok'] else 'absent' if r['md5_ok'] is None else 'BAD'}; " + r["slot_summary"]
            check("3 the dump parses: table at 0x8000, every app slot 0xE9 with esp_app_desc at +0x20",
                  r["bootloader_magic"] and r["md5_ok"] is not False and apps_ok, detail)
            table = r["table"]
        except Exception as e:
            check("3 the dump parses: table at 0x8000, every app slot 0xE9 with esp_app_desc at +0x20", False, str(e)); table = None
    else:
        check("3 the dump parses: table at 0x8000, every app slot 0xE9 with esp_app_desc at +0x20", False, "no agreed image to parse"); table = None

    # 4. a copy off this machine, recorded by path and sha256; re-hashed when reachable
    off = os.path.join(stock, "OFFMACHINE.tsv")
    rows = [l.rstrip("\n").split("\t") for l in open(off)] if os.path.isfile(off) else []
    hit = [r for r in rows if len(r) >= 2 and r[0] == sha] if sha else []
    if not hit:
        check("4 a copy exists off this machine, recorded in stock/OFFMACHINE.tsv", False,
              "no OFFMACHINE.tsv" if not rows else "no line records the agreed image's sha256")
    else:
        path = hit[0][1]
        if os.path.isfile(path):
            ok = sha256_file(path) == sha
            check("4 a copy exists off this machine, recorded in stock/OFFMACHINE.tsv", ok, f"{path}: re-hashed now, {'matches' if ok else 'DIFFERS'}")
        else:
            check("4 a copy exists off this machine, recorded in stock/OFFMACHINE.tsv", True, f"{path}: recorded {hit[0][2] if len(hit[0]) > 2 else ''}, not reachable from here now")

    # 5. the fifteen animation slots each have a recorded sha256, by name
    anim = os.path.join(stock, "ANIMATIONS.sha256")
    names, problems = [], []
    if os.path.isfile(anim):
        for l in open(anim):
            l = l.strip()
            if not l or l.startswith("#"): continue
            parts = l.split()
            if len(parts) != 2 or not re.fullmatch(r"[0-9a-f]{64}", parts[0]): problems.append(f"bad line: {l[:40]}"); continue
            names.append(parts[1])
        missing = [s for s in SLOTS if s not in names]
        extra = [n for n in names if n not in SLOTS]
        dup = [n for n in set(names) if names.count(n) > 1]
        if missing: problems.append(f"missing {', '.join(missing)}")
        if extra: problems.append(f"not a slot: {', '.join(extra)}")
        if dup: problems.append(f"repeated: {', '.join(dup)}")
        check("5 the fifteen animation slots each have their own recorded sha256", not problems and len(names) == 15,
              f"{len(names)} of 15 recorded" + ("; " + "; ".join(problems) if problems else ""))
    else:
        check("5 the fifteen animation slots each have their own recorded sha256", False, "no stock/ANIMATIONS.sha256")

    # 6. RESTORE.md Part B carries no placeholder
    rmd = os.path.join(repo, "backups", "RESTORE.md")
    try:
        n = open(rmd).read().count("<PENDING DUMP")
        check("6 backups/RESTORE.md has no PENDING DUMP placeholder left", n == 0, f"{n} placeholder(s)" if n else "none")
    except OSError:
        check("6 backups/RESTORE.md has no PENDING DUMP placeholder left", False, f"{rmd} not found")

    # 7. the clone is built against the stock partition table, not a generated one
    pcsv = os.path.join(repo, "firmware", "partitions.csv")
    try:
        txt = open(pcsv).read()
        if "PROVISIONAL" in txt:
            check("7 firmware/partitions.csv is the stock table read from the dump", False, "still PROVISIONAL (generated, not read from a dump)")
        elif table is None:
            check("7 firmware/partitions.csv is the stock table read from the dump", False, "no agreed image to compare against")
        else:
            ok = same_table(parse_csv(txt), table)
            check("7 firmware/partitions.csv is the stock table read from the dump", ok, "matches the agreed image's table" if ok else "differs from the agreed image's table")
    except OSError:
        check("7 firmware/partitions.csv is the stock table read from the dump", False, f"{pcsv} not found")

    # 8. the unit the dump came from is recorded, so a flash can be refused on another unit
    unit = os.path.join(stock, "RESTORE-THIS-UNIT.txt")
    mac = None
    if os.path.isfile(unit):
        m = re.search(r"^MAC=([0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5})\s*$", open(unit).read(), re.M)
        mac = m.group(1).lower() if m else None
    check("8 stock/RESTORE-THIS-UNIT.txt records the unit's MAC", mac is not None, "recorded" if mac else "missing or no MAC= line")

    width = max(len(n) for n, _, _ in results)
    for name, ok, detail in results:
        print(f"  {'PASS' if ok else 'FAIL'}  {name:<{width}s}  {detail}")
    failed = [n for n, ok, _ in results if not ok]
    if failed:
        print(f"\nPREFLIGHT REFUSED: {len(failed)} check(s) failed. Nothing is flashed. There is no override.")
        return 1
    print(f"\nPREFLIGHT PASSED: agreed stock image sha256 {sha}")
    return 0

# --------------------------------------------------------------------------------- CLI ----
def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("inspect"); s.add_argument("image"); s.add_argument("--json", action="store_true")
    s = sub.add_parser("appdesc"); s.add_argument("app")
    s = sub.add_parser("extract"); s.add_argument("image"); s.add_argument("partition"); s.add_argument("out")
    s = sub.add_parser("csv"); s.add_argument("image")
    s = sub.add_parser("gifs"); s.add_argument("image")
    s = sub.add_parser("otadata"); s.add_argument("blob"); s.add_argument("n_slots", type=int)
    s = sub.add_parser("encode"); s.add_argument("csv"); s.add_argument("out")
    s = sub.add_parser("preflight"); s.add_argument("--backups", required=True); s.add_argument("--repo", required=True)
    a = ap.parse_args()
    if a.cmd == "inspect":
        r = inspect(open(a.image, "rb").read())
        print(json.dumps(r) if a.json else "", end="") if a.json else print_inspect(r)
        return 0
    if a.cmd == "appdesc":
        blob = open(a.app, "rb").read()
        d = app_desc(blob)
        if not d: print("NOT_AN_APP_IMAGE=1"); return 1
        kind, page = page_from_app(blob)
        for k in ("project", "version", "idf", "date", "time", "build", "elf_sha256"): print(f"{k.upper()}={d[k]}")
        print(f"SIZE={len(blob)}")
        print(f"PAGE_KIND={kind or 'none'}")
        print(f"PAGE_SHA256={sha256(page) if page else 'none'}")
        print(f"PAGE_BYTES={len(page) if page else 0}")
        return 0
    if a.cmd == "extract":
        img = open(a.image, "rb").read()
        e, blob = extract(img, a.partition)
        if e["type_name"] == "app":
            n = app_image_length(blob)
            if n is None: print(f"{a.partition} does not hold a whole app image", file=sys.stderr); return 1
            blob = blob[:n]
        open(a.out, "wb").write(blob)
        print(f"wrote {len(blob)} bytes of {a.partition} (0x{e['offset']:x}) to {a.out}")
        return 0
    if a.cmd == "csv":
        img = open(a.image, "rb").read()
        entries, _ = parse_table(img)
        sys.stdout.write(table_csv(entries)); return 0
    if a.cmd == "gifs":
        img = open(a.image, "rb").read()
        entries, _ = parse_table(img)
        for g in gif_scan(img, entries): print(f"{g['sha256']}  0x{g['offset']:06x}  {g['length']}  {g['width']}x{g['height']}  {g['partition']}")
        return 0
    if a.cmd == "otadata":
        blob = open(a.blob, "rb").read()
        active, ents = otadata_active(blob, a.n_slots)
        for i, e in enumerate(ents): print(f"entry {i}: " + (f"seq {e['seq']} state 0x{e['state']:x} crc {'ok' if e['crc_ok'] else 'bad'}" if e else "absent"))
        print(f"ACTIVE={active if active is not None else 'none'}"); return 0
    if a.cmd == "encode":
        open(a.out, "wb").write(encode_table(parse_csv(open(a.csv).read()))); return 0
    if a.cmd == "preflight":
        return preflight(a.backups, a.repo)

if __name__ == "__main__":
    sys.exit(main())
