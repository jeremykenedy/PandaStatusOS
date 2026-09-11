#!/usr/bin/env python3
"""
Capture the printer's MQTT report stream to disk, one JSON object per line.

WHY THIS EXISTS
The Panda Status device receives a full telemetry report from the printer over MQTT and,
from what is known, consumes four fields of it: stage, state, progress and error.
Everything else in that report is already arriving at the device and being discarded.
That gap is the evidence base for most of the roadmap's Tier 2, and it cannot be captured
any other way: the report goes printer to device, so the device's own WebSocket never
carries it. This tool connects to the printer directly as a second client.

SCOPE. This talks to the PRINTER. The Panda Status device is not involved and is not
touched. Nothing is flashed. Standing rule 0 is not in play.

    *** THIS TOOL PUBLISHES. It is not a purely passive subscribe. ***

    On connect it sends exactly one request, a full-report request, so the first
    message captured is a complete state snapshot rather than whichever partial
    update happens to arrive next. Every Bambu client does this on connect and it
    is harmless, but it is a write to the printer's request topic and it is stated
    here rather than buried. Nothing else is ever published. Pass --no-pushall to
    subscribe silently and wait for the printer to volunteer a report instead.

TLS. Port 8883, TLS required. The printer serves a SELF-SIGNED certificate, so there is
no CA that could validate it and certificate verification is disabled. That is a
deliberate, documented choice, not an oversight:
  - The connection is to a fixed private-LAN address on the operator's own network.
  - The printer is the only party that holds its own key; there is no CA to trust.
  - Refusing to connect without verification would mean not capturing at all.
The encryption still applies; only the identity check is skipped. Do not copy this
pattern into anything that talks to the internet.

SECRETS. The printer host, serial and access code are read from
.claude/work/secrets/printer.txt, never from the command line and never from the repo.
That mirrors how tools/read-config.sh reads the device host. Run with no arguments to
see the file template.

CONFIRMED AGAINST. Every protocol constant below was checked against
the Panda Vent project's own Bambu client (pv_bambu.c), which talks to a bound
Bambu printer over this same LAN link and is known working on hardware. Protocol facts
only were taken from it; no code.

    report topic      device/<serial>/report                     pv_bambu.c:1051
    request topic     device/<serial>/request                    pv_bambu.c:1052
    port / scheme     8883, mqtts                                pv_bambu.c:1054
    username          bblp, password = the LAN access code       pv_bambu.c:1057-1058
    TLS               self-signed per-device cert, no verify     pv_bambu.c:1-2
    full-report req   {"pushing":{"sequence_id":"0",
                       "command":"pushall","version":1,
                       "push_target":1}}                         pv_bambu.c:27-29

    Two operational facts from the same source, worth knowing before the first run:
    - A P-series full report is about 19 KB (pv_bambu.c:1059). The first message will
      be large; that is the snapshot, not a fault.
    - A WRONG SERIAL STILL CONNECTS. The broker authenticates the access code, not the
      topic, so a bad serial produces a clean connect and then silence on the report
      topic (pv_bambu.c:1074-1075). The zero-message diagnostic below says so.

OUTPUT. ~/backups/PandaStatus/mqtt-capture/<name>.jsonl, outside the
repo. The raw capture will contain the printer serial and may contain job and file names.
Treat it like the WebSocket captures and the NVS dump. Make a scrubbed copy with
tools/redact_mqtt.py before quoting anything from it.

Each line is flushed as it is written, so a crash or a pulled cable costs only the
message in flight.

Usage:
    python3 tools/capture-mqtt.py <name>
    python3 tools/capture-mqtt.py <name> --seconds 900
    python3 tools/capture-mqtt.py --list
"""

import argparse
import base64
import json
import os
import re
import ssl
import sys
import time

SECRETS = ".claude/work/secrets/printer.txt"
OUTDIR = os.path.expanduser("~/backups/PandaStatus/mqtt-capture")   # outside the repository, per CLAUDE.md rule 2

TEMPLATE = """\
# Printer connection details for tools/capture-mqtt.py.
# This file is gitignored and never committed. One key per line, key = value.
#
# host          the printer's address on your LAN, no scheme, no port
# serial        the printer serial, used to build the MQTT topics
# access_code   the LAN-mode access code from the printer's network screen
#
# The four below are CONFIRMED against firmware that talks to a bound Bambu printer over
# the same LAN link (see CONFIRMED AGAINST in the tool's docstring). They stay
# overridable here so a different printer generation can be handled without editing
# code. Leave them commented to accept the defaults shown.
#
# port            = 8883
# username        = bblp
# topic_report    = device/{serial}/report
# topic_request   = device/{serial}/request

host        =
serial      =
access_code =
"""

# Confirmed constants (see CONFIRMED AGAINST in the docstring). Still overridable from
# the secrets file so a different printer generation can be handled without an edit.
DEFAULTS = {
    "port": "8883",
    "username": "bblp",
    "topic_report": "device/{serial}/report",
    "topic_request": "device/{serial}/request",
}

REQUIRED = ("host", "serial", "access_code")

# The full-report request. Shape confirmed against pv_bambu.c:27-29, where it is what a
# bound printer answers. "version" and "push_target" were missing from the first draft of
# this tool and were added on that confirmation.
PUSHALL = {"pushing": {"sequence_id": "0", "command": "pushall",
                       "version": 1, "push_target": 1}}

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def load_secrets(path):
    if not os.path.isfile(path):
        sys.stderr.write(
            f"ERROR: {path} not found.\n\n"
            f"Create it with this shape, fill in the three values, and keep it out of\n"
            f"the repo (it is gitignored, and the pre-commit hook refuses it):\n\n"
            + "".join("    " + l + "\n" for l in TEMPLATE.splitlines())
        )
        sys.exit(1)

    cfg = dict(DEFAULTS)
    with open(path, encoding="utf-8") as fh:
        for lineno, raw in enumerate(fh, 1):
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if "=" not in line:
                sys.exit(f"ERROR: {path}:{lineno}: expected 'key = value'")
            k, v = line.split("=", 1)
            cfg[k.strip()] = v.strip()

    missing = [k for k in REQUIRED if not cfg.get(k)]
    if missing:
        sys.exit(
            f"ERROR: {path} is missing a value for: {', '.join(missing)}\n"
            f"       Fill them in. Values never go on the command line."
        )
    try:
        cfg["port"] = int(cfg["port"])
    except ValueError:
        sys.exit(f"ERROR: {path}: port must be a number")
    for key in ("topic_report", "topic_request"):
        cfg[key] = cfg[key].replace("{serial}", cfg["serial"])
    return cfg


def make_client(client_id):
    """paho 2.x requires an explicit callback API version; 1.x does not accept it."""
    import paho.mqtt.client as mqtt

    if hasattr(mqtt, "CallbackAPIVersion"):
        return mqtt.Client(
            callback_api_version=mqtt.CallbackAPIVersion.VERSION2, client_id=client_id
        )
    return mqtt.Client(client_id=client_id)


def main():
    ap = argparse.ArgumentParser(add_help=True)
    ap.add_argument("name", nargs="?", help="capture name, becomes <name>.jsonl")
    ap.add_argument("--seconds", type=float, default=0,
                    help="stop after N seconds. Default: run until Ctrl-C")
    ap.add_argument("--no-pushall", action="store_true",
                    help="do not publish the full-report request. Pure subscribe.")
    ap.add_argument("--secrets", default=SECRETS,
                    help="path to the secrets file. For rehearsal against a test broker.")
    ap.add_argument("--out-dir", default=OUTDIR,
                    help="output directory. For rehearsal against a test broker.")
    ap.add_argument("--no-tls", action="store_true",
                    help="plaintext. Rehearsal only; the printer requires TLS.")
    ap.add_argument("--list", action="store_true", help="show the secrets template and exit")
    args = ap.parse_args()

    if args.list:
        print(TEMPLATE)
        print(f"Output goes to {OUTDIR}/<name>.jsonl")
        return 0
    if not args.name:
        ap.print_usage(sys.stderr)
        sys.stderr.write("\nERROR: a capture name is required. --list shows the setup.\n")
        return 1
    if not NAME_RE.match(args.name):
        sys.stderr.write(
            f"ERROR: '{args.name}' is not a usable capture name.\n"
            "       Letters, digits, dot, dash, underscore. No slashes.\n"
        )
        return 1

    cfg = load_secrets(args.secrets)

    os.makedirs(args.out_dir, exist_ok=True)
    out_path = os.path.join(args.out_dir, args.name + ".jsonl")
    if os.path.exists(out_path):
        sys.stderr.write(
            f"REFUSING: {out_path} already exists.\n"
            "          Captures are one-shot. Move or rename the existing file first.\n"
        )
        return 1

    print(f"  capture : {args.name}")
    print(f"  host    : {cfg['host']}:{cfg['port']}  "
          f"{'TLS, verification disabled (self-signed)' if not args.no_tls else 'PLAINTEXT (rehearsal)'}")
    print(f"  subscribe: {cfg['topic_report']}")
    if args.no_pushall:
        print("  publish : none (--no-pushall)")
    else:
        print(f"  publish : {cfg['topic_request']}  <- one full-report request at connect")
    print(f"  out     : {out_path}\n")

    fh = open(out_path, "w", encoding="utf-8", buffering=1)
    t0 = time.time()
    counters = {"rx": 0, "bytes": 0, "unparsable": 0, "evt": 0}
    # "connected"/"subscribed" are live flags; "ever_*" are the facts the end-of-run
    # diagnostic needs. The live flags are both false by then, because shutdown
    # disconnects on purpose, and reading them there reported "never connected" for a
    # capture that had connected and subscribed fine.
    state = {"connected": False, "ever_connected": False,
             "subscribed": False, "ever_subscribed": False,
             "rc": None, "refused": None}

    def emit(rec):
        rec.setdefault("t", time.time())
        rec["rel_ms"] = int((rec["t"] - t0) * 1000)
        fh.write(json.dumps(rec, ensure_ascii=False) + "\n")
        fh.flush()
        os.fsync(fh.fileno())

    def on_connect(client, userdata, flags, reason_code, properties=None):
        rc = int(getattr(reason_code, "value", reason_code) or 0)
        name = str(reason_code)
        state["rc"] = rc
        if rc != 0:
            state["refused"] = name
            emit({"dir": "evt", "event": "connect_failed", "rc": rc, "reason": name})
            sys.stdout.flush()
            print(f"\n  *** CONNECT REFUSED BY THE PRINTER: {name} (rc={rc}) ***",
                  file=sys.stderr)
            print("      Nothing will be captured. Check the access code and the serial.",
                  file=sys.stderr)
            return
        state["connected"] = True
        state["ever_connected"] = True
        # Record which certificate actually answered. Verification is disabled, so this
        # is the only evidence of peer identity the capture will ever hold: it proves a
        # later capture reached the same device, and it is the fingerprint a future
        # pinned-certificate mode would check against.
        fp = None
        try:
            sock = client.socket()
            der = sock.getpeercert(binary_form=True) if hasattr(sock, "getpeercert") else None
            if der:
                import hashlib
                fp = hashlib.sha256(der).hexdigest()
        except Exception:
            pass
        emit({"dir": "evt", "event": "connected", "peer_cert_sha256": fp})
        if fp:
            print(f"  peer cert sha256 {fp[:16]}... (recorded; verification disabled)")
        client.subscribe(cfg["topic_report"], qos=0)
        emit({"dir": "evt", "event": "subscribe", "topic": cfg["topic_report"]})
        if not args.no_pushall:
            payload = json.dumps(PUSHALL)
            client.publish(cfg["topic_request"], payload, qos=0)
            emit({"dir": "tx", "topic": cfg["topic_request"], "payload": PUSHALL,
                  "note": "full-report request, the only publish this tool makes"})
            print("  -> full-report request published")

    def on_subscribe(client, userdata, mid, reason_codes=None, properties=None):
        state["subscribed"] = True
        state["ever_subscribed"] = True
        print(f"  <- subscribed to {cfg['topic_report']}")

    def on_message(client, userdata, msg):
        counters["rx"] += 1
        counters["bytes"] += len(msg.payload)
        rec = {"dir": "rx", "topic": msg.topic, "bytes": len(msg.payload)}
        try:
            rec["payload"] = json.loads(msg.payload.decode("utf-8"))
        except Exception as exc:
            counters["unparsable"] += 1
            rec["parse_error"] = repr(exc)
            rec["raw_b64"] = base64.b64encode(msg.payload).decode("ascii")
        emit(rec)
        n = counters["rx"]
        if n <= 3 or n % 25 == 0:
            keys = ""
            if isinstance(rec.get("payload"), dict):
                keys = "  roots=" + ",".join(sorted(rec["payload"].keys()))
            print(f"  rx {n:5d}  {len(msg.payload):7d} B{keys}")

    def on_disconnect(client, userdata, *a):
        emit({"dir": "evt", "event": "disconnected"})
        state["connected"] = False

    client = make_client(f"pandastatusos-capture-{int(t0)}")
    client.on_connect = on_connect
    client.on_subscribe = on_subscribe
    client.on_message = on_message
    client.on_disconnect = on_disconnect
    client.username_pw_set(cfg["username"], cfg["access_code"])

    if not args.no_tls:
        # Self-signed certificate on the printer. See the TLS note in the module
        # docstring: encryption stays on, the identity check cannot be performed
        # because no CA exists to perform it against.
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        client.tls_set_context(ctx)

    emit({"dir": "evt", "event": "capture_start",
          "host": cfg["host"], "port": cfg["port"],
          "topic_report": cfg["topic_report"],
          "tls": not args.no_tls, "pushall": not args.no_pushall})

    try:
        client.connect(cfg["host"], cfg["port"], keepalive=60)
    except Exception as exc:
        emit({"dir": "evt", "event": "connect_error", "error": repr(exc)})
        sys.stderr.write(f"\n  CONNECT ERROR: {exc}\n")
        fh.close()
        return 1

    client.loop_start()
    rc = 0
    try:
        deadline = t0 + args.seconds if args.seconds else None
        while True:
            time.sleep(0.25)
            if deadline and time.time() >= deadline:
                print("\n  --seconds reached, stopping.")
                break
    except KeyboardInterrupt:
        print("\n  interrupted, stopping.")
    finally:
        client.loop_stop()
        try:
            client.disconnect()
        except Exception:
            pass
        emit({"dir": "evt", "event": "capture_end", **counters})
        fh.close()

    print(f"\n  messages  {counters['rx']}")
    print(f"  bytes     {counters['bytes']}")
    print(f"  unparsable{'':1}{counters['unparsable']}")
    print(f"  wrote  -> {out_path}")
    if counters["rx"] == 0:
        sys.stdout.flush()
        print("\n  EMPTY. Nothing was captured. Do not treat this as a result.", file=sys.stderr)
        if state["refused"]:
            print(f"  CAUSE: the broker refused the connection: {state['refused']}.",
                  file=sys.stderr)
            print("         The access code or the serial is wrong. Fix the secrets file.",
                  file=sys.stderr)
        elif not state["ever_connected"]:
            print("  CAUSE: never connected. Host unreachable, or wrong port.", file=sys.stderr)
        elif not state["ever_subscribed"]:
            print("  CAUSE: connected but the subscribe never completed.", file=sys.stderr)
        else:
            print("  Connected and subscribed, but the printer published nothing on",
                  file=sys.stderr)
            print(f"  {cfg['topic_report']}.", file=sys.stderr)
            print("  MOST LIKELY: the serial is wrong. The broker authenticates the access",
                  file=sys.stderr)
            print("  code, not the topic, so a bad serial connects cleanly and then hears",
                  file=sys.stderr)
            print("  nothing. Check the serial in the secrets file first.", file=sys.stderr)
            if args.no_pushall:
                print("  ALSO: --no-pushall was set, so an idle printer had no reason to",
                      file=sys.stderr)
                print("  send anything.", file=sys.stderr)
        rc = 1
    else:
        print("\n  This file holds the printer serial and may hold job names.")
        print("  It stays outside the repo. Make a scrubbed copy before quoting it:")
        print(f"    python3 tools/redact_mqtt.py {out_path} \\")
        print(f"      -o .claude/work/analysis/{args.name}.redacted.jsonl")
    return rc


if __name__ == "__main__":
    sys.exit(main())
