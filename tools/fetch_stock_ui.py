#!/usr/bin/env python3
"""
Fetch the stock web UI blob off the device, byte for byte. Standard library only.

This is the Gate 1 artifact. Gate 1 compares the clone's UI against THE DEVICE'S
file, not against a blob extracted from a published image the unit may not even be
running.

Saves the response body exactly as transmitted. ESP32 firmware typically stores the
UI pre-gzipped in flash and serves those bytes straight out, so the raw compressed
body is the closest thing to the on-flash file that can be obtained without USB.

http.client is used deliberately: it dechunks but does NOT decompress, which is what
we want. requests and urllib helpers can transparently decompress and silently
destroy the artifact.

Writes, for a path like "/":
    index.raw            body exactly as transmitted (gzipped, if served that way)
    index.decoded        gunzipped, for reading. Only if Content-Encoding was gzip.
    index.headers.json   status, reason, every response header, sha256 of both files

Usage:
    python3 tools/fetch_stock_ui.py <DEVICE_HOST> -o /path/to/stock-ui/
    python3 tools/fetch_stock_ui.py <DEVICE_HOST> -o out/ --path /settings.html
"""

import argparse
import gzip
import hashlib
import http.client
import json
import os
import re
import sys
import zlib


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def slug(path):
    s = path.strip("/") or "index"
    return re.sub(r"[^A-Za-z0-9._-]", "_", s)


def fetch(host, port, path, accept_gzip=True, timeout=20):
    conn = http.client.HTTPConnection(host, port, timeout=timeout)
    headers = {"Accept": "*/*", "User-Agent": "panda-status-stock-capture/1"}
    if accept_gzip:
        headers["Accept-Encoding"] = "gzip, deflate"
    else:
        headers["Accept-Encoding"] = "identity"
    conn.request("GET", path, headers=headers)
    resp = conn.getresponse()
    body = resp.read()          # dechunked, NOT decompressed
    meta = {
        "status": resp.status,
        "reason": resp.reason,
        "headers": dict(resp.getheaders()),
        "requested_path": path,
        "accept_encoding_sent": headers["Accept-Encoding"],
        "body_bytes": len(body),
    }
    conn.close()
    return body, meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("host", help="device host or IP")
    ap.add_argument("-p", "--port", type=int, default=80)
    ap.add_argument("--path", default="/", help="path to fetch, default /")
    ap.add_argument("-o", "--out", required=True, help="output directory")
    ap.add_argument("--no-gzip", action="store_true",
                    help="request identity encoding instead, to see what the server does")
    args = ap.parse_args()

    os.makedirs(args.out, exist_ok=True)
    base = os.path.join(args.out, slug(args.path))

    body, meta = fetch(args.host, args.port, args.path, accept_gzip=not args.no_gzip)

    if meta["status"] != 200:
        print(f"HTTP {meta['status']} {meta['reason']} for {args.path}", file=sys.stderr)

    raw_path = base + ".raw"
    with open(raw_path, "wb") as fh:
        fh.write(body)
    meta["raw_file"] = os.path.basename(raw_path)
    meta["raw_sha256"] = sha256_file(raw_path)

    enc = (meta["headers"].get("Content-Encoding")
           or meta["headers"].get("content-encoding") or "").lower()
    meta["content_encoding"] = enc or "identity"

    if enc == "gzip" or body[:2] == b"\x1f\x8b":
        try:
            decoded = gzip.decompress(body)
        except Exception as exc:
            decoded, meta["decode_error"] = None, repr(exc)
    elif enc == "deflate":
        try:
            decoded = zlib.decompress(body)
        except zlib.error:
            try:
                decoded = zlib.decompress(body, -zlib.MAX_WBITS)
            except Exception as exc:
                decoded, meta["decode_error"] = None, repr(exc)
    else:
        decoded = None

    if decoded is not None:
        dec_path = base + ".decoded"
        with open(dec_path, "wb") as fh:
            fh.write(decoded)
        meta["decoded_file"] = os.path.basename(dec_path)
        meta["decoded_bytes"] = len(decoded)
        meta["decoded_sha256"] = sha256_file(dec_path)

    # Surface referenced assets so nothing gets left on the device. This runs whether
    # or not the body was compressed: a server that serves identity still references
    # assets, and skipping this for identity silently under-collects the Gate 1 set.
    body_for_refs = decoded if decoded is not None else body
    text = body_for_refs.decode("utf-8", "replace")
    refs = sorted(set(re.findall(r'(?:src|href)\s*=\s*["\']([^"\']+)["\']', text)))
    meta["referenced_assets"] = [r for r in refs if not r.startswith(("http:", "https:", "data:", "#", "javascript:"))]
    meta["referenced_assets_external"] = [r for r in refs if r.startswith(("http:", "https:"))]

    with open(base + ".headers.json", "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2, sort_keys=True)

    print(f"path            {args.path}")
    print(f"status          {meta['status']} {meta['reason']}")
    print(f"content-encoding{'':1}{meta['content_encoding']}")
    print(f"raw bytes       {meta['body_bytes']}")
    print(f"raw sha256      {meta['raw_sha256']}")
    if decoded is not None:
        print(f"decoded bytes   {meta['decoded_bytes']}")
        print(f"decoded sha256  {meta['decoded_sha256']}")
    if meta.get("referenced_assets"):
        print("referenced assets, fetch each with --path:")
        for r in meta["referenced_assets"]:
            print("   ", r)
    else:
        print("referenced assets  none, the page is self-contained")
    if meta.get("referenced_assets_external"):
        print("EXTERNAL references (not on device):")
        for r in meta["referenced_assets_external"]:
            print("   ", r)
    print(f"\nwrote -> {args.out}")


if __name__ == "__main__":
    main()
