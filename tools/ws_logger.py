#!/usr/bin/env python3
"""
Panda Status stock WebSocket logger. Standard library only, no pip install.

Insurance for the one-shot stock capture window. The DevTools snippet
(tools/ws-capture-snippet.js) captures BOTH directions but holds the log in page
memory until you export it. This writes server->client frames straight to disk as
they arrive, so a tab crash or an accidental reload does not cost the capture.

Limitation, stated plainly: this is its own client. It sees what the DEVICE sends.
It cannot see what the browser sends. For browser->device frames the DevTools
snippet is the only source. Run both.

Risk to know about: some ESP32 WebSocket servers cap concurrent clients. If opening
this connection disturbs the browser UI, close this and rely on the snippet alone.
Test it BEFORE the print starts, not during.

Usage:
    python3 tools/ws_logger.py ws://<host>/ws -o /path/to/out.jsonl
    python3 tools/ws_logger.py <host>          # scheme and /ws assumed

Ctrl-C to stop. Every frame is flushed immediately.
"""

import argparse
import base64
import json
import os
import socket
import sys
import time
from urllib.parse import urlparse


def handshake(sock, host, port, path):
    key = base64.b64encode(os.urandom(16)).decode()
    req = (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        "Sec-WebSocket-Version: 13\r\n"
        "\r\n"
    )
    sock.sendall(req.encode())
    buf = b""
    while b"\r\n\r\n" not in buf:
        chunk = sock.recv(4096)
        if not chunk:
            raise ConnectionError("server closed during handshake")
        buf += chunk
    head, _, rest = buf.partition(b"\r\n\r\n")
    status = head.split(b"\r\n", 1)[0].decode(errors="replace")
    if b" 101" not in head.split(b"\r\n", 1)[0]:
        raise ConnectionError(f"upgrade refused: {status}")
    return rest


def recv_exact(sock, n, carry):
    while len(carry) < n:
        chunk = sock.recv(65536)
        if not chunk:
            raise ConnectionError("server closed")
        carry += chunk
    return carry[:n], carry[n:]


def frames(sock, carry):
    """Yield (opcode, payload) with fragmentation reassembled."""
    frag_op, frag_buf = None, b""
    while True:
        hdr, carry = recv_exact(sock, 2, carry)
        fin = bool(hdr[0] & 0x80)
        opcode = hdr[0] & 0x0F
        masked = bool(hdr[1] & 0x80)
        length = hdr[1] & 0x7F
        if length == 126:
            ext, carry = recv_exact(sock, 2, carry)
            length = int.from_bytes(ext, "big")
        elif length == 127:
            ext, carry = recv_exact(sock, 8, carry)
            length = int.from_bytes(ext, "big")
        mask = b""
        if masked:
            mask, carry = recv_exact(sock, 4, carry)
        payload, carry = recv_exact(sock, length, carry)
        if masked:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))

        if opcode == 0x8:  # close
            yield ("close", payload)
            return
        if opcode == 0x9:  # ping -> pong, masked, empty-safe
            m = os.urandom(4)
            body = bytes(b ^ m[i % 4] for i, b in enumerate(payload))
            hdr_out = bytes([0x8A, 0x80 | len(payload)]) if len(payload) < 126 else None
            if hdr_out:
                sock.sendall(hdr_out + m + body)
            yield ("ping", payload)
            continue
        if opcode == 0xA:
            yield ("pong", payload)
            continue

        if opcode == 0x0:  # continuation of a fragmented message
            frag_buf += payload
            if fin:
                op, data = frag_op, frag_buf
                frag_op, frag_buf = None, b""
                yield ("text" if op == 0x1 else "binary", data)
            continue
        if not fin:
            frag_op, frag_buf = opcode, payload
            continue
        yield ("text" if opcode == 0x1 else "binary", payload)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("target", help="ws://host/ws, or just the host")
    ap.add_argument("-o", "--out", required=True, help="output .jsonl path")
    args = ap.parse_args()

    t = args.target
    if "://" not in t:
        t = "ws://" + t
    u = urlparse(t)
    host = u.hostname
    port = u.port or 80
    path = u.path or "/ws"

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    sock = socket.create_connection((host, port), timeout=15)
    sock.settimeout(None)
    carry = handshake(sock, host, port, path)
    t0 = time.time()

    print(f"connected {host}:{port}{path} -> {args.out}", file=sys.stderr)
    print("server->client only. Browser->device needs the DevTools snippet.", file=sys.stderr)

    n = 0
    with open(args.out, "a", encoding="utf-8") as fh:
        def emit(rec):
            nonlocal n
            rec["t"] = time.time()
            rec["rel_ms"] = int((rec["t"] - t0) * 1000)
            fh.write(json.dumps(rec) + "\n")
            fh.flush()
            n += 1

        emit({"dir": "evt", "event": "open", "url": f"ws://{host}:{port}{path}"})
        try:
            for kind, payload in frames(sock, carry):
                if kind == "text":
                    emit({"dir": "rx", "kind": "text", "data": payload.decode("utf-8", "replace")})
                elif kind == "binary":
                    emit({"dir": "rx", "kind": "binary", "hex": payload.hex()})
                elif kind == "close":
                    emit({"dir": "evt", "event": "close"})
                    break
                else:
                    emit({"dir": "evt", "event": kind})
        except KeyboardInterrupt:
            emit({"dir": "evt", "event": "stopped_by_user"})
        except Exception as exc:
            emit({"dir": "evt", "event": "error", "detail": repr(exc)})
            raise
        finally:
            print(f"\n{n} records -> {args.out}", file=sys.stderr)


if __name__ == "__main__":
    main()
