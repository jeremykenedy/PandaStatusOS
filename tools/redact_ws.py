#!/usr/bin/env python3
"""
Make a redacted working copy of a WebSocket capture. Standard library only.

Raw captures from this device carry live credentials in plaintext: the station and
AP network keys, the printer serial, and the printer access code. The raw file is
handled like the NVS dump, outside the repo, never referenced by value.

This produces a redacted copy safe to read, quote in analysis, and reason over. It
never prints a secret value and never writes one to the output. Sensitive scalars
become a type-and-length descriptor so shape analysis still works:

    "password": "<REDACTED str len=20>"

The raw input file is opened read-only and never modified.

Usage:
    python3 tools/redact_ws.py in.jsonl -o out.redacted.jsonl
    python3 tools/redact_ws.py in.jsonl -o out.jsonl --also-key foo --also-key bar
"""

import argparse
import json
import re
import sys

# Key names whose VALUES are secret. Matched case-insensitively against the key.
DEFAULT_SENSITIVE = [
    r"pass", r"passwd", r"password", r"psk", r"pwd",
    r"ssid",
    r"access_?code", r"code$",
    r"^sn$", r"serial",
    r"token", r"secret", r"api[_-]?key",
    r"mac",
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


def redact(obj, rx):
    if isinstance(obj, list):
        return [redact(v, rx) for v in obj]
    if not isinstance(obj, dict):
        return obj
    out = {}
    for k, v in obj.items():
        if rx.search(str(k)):
            out[k] = describe(v)
        else:
            out[k] = redact(v, rx)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("infile")
    ap.add_argument("-o", "--out", required=True)
    ap.add_argument("--also-key", action="append", default=[],
                    help="extra key-name regex to treat as sensitive, repeatable")
    args = ap.parse_args()

    if args.out == args.infile:
        sys.exit("refusing to overwrite the raw capture")

    rx = re.compile("|".join(DEFAULT_SENSITIVE + args.also_key), re.I)

    n_lines = n_frames = n_redacted = 0
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
                fout.write(json.dumps({"dir": "evt", "event": "unparsable_line"}) + "\n")
                continue
            # The frame payload itself is a JSON string in "data".
            if rec.get("kind") == "text" and isinstance(rec.get("data"), str):
                try:
                    payload = json.loads(rec["data"])
                except json.JSONDecodeError:
                    payload = None
                if payload is not None:
                    before = json.dumps(payload, sort_keys=True)
                    cleaned = redact(payload, rx)
                    after = json.dumps(cleaned, sort_keys=True)
                    if before != after:
                        n_redacted += 1
                    rec["data"] = cleaned          # store as an object, easier to read
                    rec["data_was_json"] = True
                    n_frames += 1
            fout.write(json.dumps(rec) + "\n")

    print(f"lines      {n_lines}")
    print(f"json frames{'':1}{n_frames}")
    print(f"frames with at least one redaction  {n_redacted}")
    print(f"wrote -> {args.out}")
    print("raw input untouched")


if __name__ == "__main__":
    main()
