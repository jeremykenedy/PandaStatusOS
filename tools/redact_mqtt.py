#!/usr/bin/env python3
"""
Make a redacted working copy of an MQTT capture. Standard library only.

Raw captures from tools/capture-mqtt.py carry the printer serial, and may carry job
names, file names and task identifiers. The raw file is handled like the NVS dump and the
WebSocket captures: outside the repo, never referenced by value.

This produces a redacted copy safe to read, quote in analysis, and reason over. It never
prints a sensitive value and never writes one to the output. Sensitive scalars become a
type-and-length descriptor, so shape analysis still works:

    "sn": "<REDACTED str len=15>"

**What is deliberately NOT redacted, because it is the point of the capture.** Field
names, message shapes, enum values, temperatures, progress, layer counts, stage and state
values, fan speeds, filament types and tray colours all survive intact. Those are
interface facts under standing rule 6 and the whole reason the capture exists. Redacting
them would produce a clean file with no evidence in it.

The raw input file is opened read-only and never modified.

Usage:
    python3 tools/redact_mqtt.py in.jsonl -o out.redacted.jsonl
    python3 tools/redact_mqtt.py in.jsonl -o out.jsonl --also-key foo --keep-key bar
"""

import argparse
import json
import re
import sys

# Key names whose VALUES are sensitive. Matched case-insensitively against the key.
# Anchored where a loose match would eat a field we need: ^sn$ must not catch "sn" inside
# a longer key, and "name" is far too broad to use bare.
DEFAULT_SENSITIVE = [
    # identity of the machine
    r"^sn$", r"^dev_?sn$", r"serial",
    # credentials, if the printer ever echoes one
    r"pass", r"passwd", r"password", r"psk", r"pwd",
    r"access_?code", r"token", r"secret", r"api[_-]?key",
    # network location
    r"^ip$", r"^mac$", r"^dev_?ip$",
    # job and file identity. The names say what is being printed and sometimes who for.
    r"subtask_name", r"subtask_id", r"task_?id", r"job_?id",
    r"gcode_file", r"^file$", r"project_?id", r"profile_?id", r"design_?id",
    r"^url$", r"^md5$",
    # per-spool unique ids. The tray's type and colour stay; its serial number does not.
    r"tray_uuid", r"tag_uid", r"^tray_?id_?name$",
    # account identity
    r"user_?id", r"^uid$", r"^nickname$",
]

# Keys that look sensitive by pattern but are interface facts we must keep. Checked first.
DEFAULT_KEEP = [
    r"^tray_type$", r"^tray_color$", r"^tray_colour$", r"^tray_now$", r"^tray_pre$",
    r"^tray_tar$", r"^tray_sub_brands$", r"^tray_weight$", r"^tray_diameter$",
    r"^tray_temp$", r"^tray_time$", r"^remain$", r"^bed_type$",
    r"^nozzle_type$", r"^nozzle_diameter$",
]


def describe(v):
    if v == "" or v is None:
        return "<EMPTY>"
    if isinstance(v, str):
        return f"<REDACTED str len={len(v)}>"
    if isinstance(v, bool):
        return "<REDACTED bool>"
    if isinstance(v, (int, float)):
        return f"<REDACTED {type(v).__name__}>"
    if isinstance(v, list):
        return f"<REDACTED list len={len(v)}>"
    if isinstance(v, dict):
        return f"<REDACTED object keys={len(v)}>"
    return "<REDACTED>"


def redact(obj, rx_sens, rx_keep, stats):
    if isinstance(obj, list):
        return [redact(v, rx_sens, rx_keep, stats) for v in obj]
    if not isinstance(obj, dict):
        return obj
    out = {}
    for k, v in obj.items():
        key = str(k)
        if rx_keep.search(key):
            out[k] = redact(v, rx_sens, rx_keep, stats)
        elif rx_sens.search(key):
            out[k] = describe(v)
            stats[key] = stats.get(key, 0) + 1
        else:
            out[k] = redact(v, rx_sens, rx_keep, stats)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--also-key", action="append", default=[],
                    help="extra key-name regex to treat as sensitive, repeatable")
    ap.add_argument("--keep-key", action="append", default=[],
                    help="extra key-name regex to preserve, repeatable. Wins over sensitive.")
    args = ap.parse_args()

    if args.out == args.infile:
        sys.exit("refusing to overwrite the raw capture")

    rx_sens = re.compile("|".join(DEFAULT_SENSITIVE + args.also_key), re.I)
    rx_keep = re.compile("|".join(DEFAULT_KEEP + args.keep_key), re.I)

    n_lines = n_rx = n_evt = n_redacted = n_bad = 0
    stats = {}

    with open(args.infile, "r", encoding="utf-8") as fin, \
         open(args.out, "w", encoding="utf-8") as fout:
        for line in fin:
            line = line.strip()
            if not line:
                continue
            n_lines += 1
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                n_bad += 1
                fout.write(json.dumps({"dir": "evt", "event": "unparsable_line"}) + "\n")
                continue

            if rec.get("dir") == "rx":
                n_rx += 1
            elif rec.get("dir") == "evt":
                n_evt += 1

            before = json.dumps(rec, sort_keys=True)
            # The envelope itself carries the host and the serial-bearing topic.
            for field in ("host", "topic"):
                if isinstance(rec.get(field), str) and rec[field]:
                    rec[field] = describe(rec[field]) if field == "host" else \
                        re.sub(r"[A-Za-z0-9]{8,}", "<REDACTED_SERIAL>", rec[field])
            for field in ("topic_report", "topic_request"):
                if isinstance(rec.get(field), str):
                    rec[field] = re.sub(r"[A-Za-z0-9]{8,}", "<REDACTED_SERIAL>", rec[field])
            # A raw payload that would not parse is opaque bytes; drop it rather than
            # carrying base64 of something unexamined into a readable file.
            if "raw_b64" in rec:
                rec["raw_b64"] = f"<REDACTED base64 len={len(rec['raw_b64'])}>"
            if "payload" in rec:
                rec["payload"] = redact(rec["payload"], rx_sens, rx_keep, stats)
            if json.dumps(rec, sort_keys=True) != before:
                n_redacted += 1
            fout.write(json.dumps(rec, ensure_ascii=False) + "\n")

    print(f"lines                {n_lines}")
    print(f"  report messages    {n_rx}")
    print(f"  events             {n_evt}")
    print(f"  unparsable         {n_bad}")
    print(f"records with at least one redaction  {n_redacted}")
    if stats:
        print("\nredacted keys, by occurrence:")
        for k, c in sorted(stats.items(), key=lambda kv: (-kv[1], kv[0])):
            print(f"  {c:6d}  {k}")
    else:
        print("\nno sensitive keys matched. If this was a real capture, check the key list.")
    print(f"\nwrote -> {args.out}")
    print("raw input untouched")


if __name__ == "__main__":
    main()
