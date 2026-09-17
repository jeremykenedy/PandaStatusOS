# The Panda Vent bridge

A protocol between two devices on the same LAN: a Panda Status P2 running PandaStatusOS
and a Panda Vent running PandaVentOS. Both ends are this project's family, so
this is a specification written from scratch; nothing in it is lifted from either
factory firmware. It is **not built yet**. This document is the contract the two sides
build against, and the PandaStatusOS side is built against a mock vent before either touches
the other.

Unbound is the default. The bridge lives behind feature bit 0 of `ps_cfg_t.features`
([FEATURES.md](FEATURES.md)), which defaults off; with the bit off no service is
advertised, no socket is opened and nothing on the page mentions it.

## What it is for

| Capability | Direction | The bar or the page gets |
|---|---|---|
| vent state on the bar | vent to status | open, closed, sealing, moving, as a colour or a layer over the base effect |
| policy visible without a browser | vent to status | when the vent is overriding its policy (material-aware sealing), the bar says so |
| chamber temperature as a ramp | vent to status | the vent already reads it; the bar shows it as a colour ramp between two configurable ends |
| the vent's colours, copied | vent to status | the three bar-state colours the vent is set to, written into this device's own three, so a pair on one bench matches without being set up twice |
| the vent's effect, copied | vent to status | the effect a vent bar state runs, written into the matching state here, with its colours, its timing and its direction |

### Copying, and why it is a copy rather than a follow

Jeremy, 2026-09-17. Two of the rows above are not a live feed. They are **one-time
copies**, run when somebody asks for them, and each is its own switch:

  - **Sync colours from the vent.** Reads the vent's three bar-state colours and writes
    them into this device's three, for the mode being edited.
  - **Sync the effect from the vent.** Reads the effect on one vent bar state and writes
    it into the matching state here: the effect id, its four colours, its speed, its
    direction and its band width.

They are copies, not a subscription, because a subscription makes one device the owner of
the other's settings and there is no good answer to what happens when both are edited. A
copy has an obvious meaning, an obvious moment, and an obvious undo: copy again, or set it
back by hand. The page says what it is about to overwrite before it does it.

**The reverse is a later job on the vent's side.** Status to vent, same two operations, is
built into PandaVentOS after these land, so the same contract is exercised from both ends
before either is called done. Nothing here assumes the vent can already be asked; the vent
gains a route for this and this device gains one too, and the direction of any one copy is
whichever end the person pressed.

An effect copied from a vent may name an effect id this device's feature bits do not allow.
That is refused with the reason, not silently downgraded to something else: a bar quietly
showing a different effect from the one that was copied is worse than a copy that did not
happen.
| vent errors on the bar | vent to status | an error on the vent surfaces as the bar's error state |
| status drives the vent | status to vent | open, close, and the policy toggle, from the PandaStatusOS page, so control lives in one place |
| shared printer state | either way | one device polls the printer's MQTT and pushes what it reads to the other, halving the load on the printer |
| coordinated lighting | either way | the same state colours and mode on both bars |
| each the other's backup | either way | a device holds the other's configuration blob and can hand it back |

## Discovery

Each device advertises one mDNS service:

```
_pandabridge._tcp.local
TXT  id=<16 hex>   kind=status|vent   ver=1   name=<hostname>
```

`id` is the device's identity: the first 8 bytes of sha256 over its Wi-Fi station MAC,
stable across address changes and across factory resets of the *other* device. A
device finds peers by browsing the service; the page lists them by `name` and `kind`.

Manual entry is the fallback and works the same way the printer bind does: type a host
name or an address, and the device fetches `GET /bridge/id` from it, which answers the
same fields as the TXT record.

## Pairing

Pairing is a one-time exchange that produces a shared token. Both devices show the
same six-digit code on their pages for sixty seconds; the person confirms on both.

1. PandaStatusOS opens the socket and sends `hello` with its identity and a random nonce.
2. Vent answers `hello` with its identity, its nonce, and `pair: true` if it has no
   token for that identity.
3. Both compute `code = decimal(sha256(nonce_a ‖ nonce_b ‖ identity_a ‖ identity_b)) mod 1000000`
   and show it.
4. On confirmation at both ends, each sends `pair {confirm: true}`; both store
   `token = sha256(nonce_a ‖ nonce_b ‖ identity_a ‖ identity_b ‖ "pandabridge")` against the
   peer's identity.

After pairing, every `hello` carries `auth = sha256(token ‖ nonce_peer)`, computed over
the nonce the peer just sent, so the token itself never travels. A `hello` that fails
the check is answered with `bye {reason: "unpaired"}` and the socket closes.

## Binding and rebinding

A device binds to an identity, never to an address. On every connect, and every time
the socket drops, it re-resolves the peer: mDNS first, the last known address second.
When a peer comes back at a new address under the same `id`, the bind survives without
a page visit. This is the shape the printer's address-change logic has, applied to a
peer whose identity is a fact rather than a guess.

## Transport

WebSocket at `/bridge` on the peer's port 80, JSON text frames, one root per frame,
each carrying `seq`, a counter per direction. The receiver answers every frame that
changes something with `ack {seq, ok}`; frames that only inform are not acknowledged.

Nothing on this link is encrypted. It is a LAN link between two devices the same person
owns, authenticated by the pairing token. The configuration backup is the one payload
that carries secrets; see below.

## Frames

### `hello`

```json
{ "hello": { "seq": 1, "ver": 1, "id": "<16 hex>", "kind": "status", "name": "pandastatusos",
             "nonce": "<32 hex>", "auth": "<64 hex>", "caps": ["vent_state", "printer_state", "light", "backup"] } }
```

`caps` lists what the sender can consume and produce. A device sends only the roots the
peer listed.

### `vent`, vent to status

```json
{ "vent": { "seq": 7, "state": "sealing", "policy": { "override": true, "reason": "material" },
            "chamber_c": 41.5, "error": null } }
```

`state` is one of `open`, `closed`, `sealing`, `moving`, `unknown`. `error` is `null`
or a short code the vent defines. Sent on every change and at least every 30 seconds.

### `vent`, status to vent

```json
{ "vent": { "seq": 8, "command": "open" } }
```

`command` is `open`, `close`, or `policy` with `"override": true|false`. The vent
answers with `ack` and then with its own `vent` frame when the state has changed.

### `printer`, either direction

```json
{ "printer": { "seq": 9, "sn": "<PRINTER_SN>", "state": "printing", "stage": "printing",
               "progress": 42, "error": null, "polled_by": "<16 hex>" } }
```

The device named in `polled_by` holds the MQTT session; the other subscribes to it
through this frame and does not open its own. Which one polls is decided at pairing
(the one that was already bound to the printer) and can be changed from either page.
`stage` uses the fifteen slot names the status device already has.

### `light`, either direction

```json
{ "light": { "seq": 10, "mode": 1, "brightness": 50,
             "colours": ["#FFFFFFFF", "#1B00FFFF", "#FF0000FF"] } }
```

Sent when coordinated lighting is on at the sender; the receiver applies it as if it
had come from its own page, so the same three state colours and mode show on both bars.

### `backup`, either direction

```json
{ "backup": { "seq": 11, "kind": "vent", "version": 13, "sha256": "<64 hex>", "bytes": "<base64>" } }
```

An opaque configuration blob, stored as received, handed back on request
(`{ "backup": { "seq": 12, "request": true } }`). The blob carries the peer's Wi-Fi
credentials and printer access code, so a device that holds a backup holds secrets: the
page says so where the feature is turned on, and the blob is never shown or exported
by the holder.

### `ack` and `bye`

```json
{ "ack": { "seq": 8, "ok": true } }
{ "bye": { "reason": "unpaired" } }
```

## On the bar

Vent state is a **layer** over the base effect, not a replacement for it: the printer's
state colour stays the base, and the vent's state is drawn on top the way the roadmap's
hot-warning threshold is. Which segment, colour and pattern each vent state gets is
configuration on the status side, with defaults that keep the bar readable from across
a room: sealing pulses, moving sweeps, an error strobes the error colour.

## What the mock vent does

`tools/ui/mock/mockvent.js` (to be written with the PandaStatusOS side) advertises itself,
answers the pairing exchange, sends `vent` frames on a timer, accepts commands and
echoes the state change, and lies on demand like `mockdev.js`: slow, silent, gone,
wrong identity, wrong token. The PandaStatusOS side is built and tested against it; the real
vent is never touched during that work.

## Order of work

1. This document, agreed by both projects.
2. The mock vent.
3. PandaStatusOS side: the flag, discovery, pairing, `vent` in and `light` out, on the page
   behind the flag, with harnesses and screenshots.
4. Vent side, in its own repository, against a mock status.
5. Shared printer state and backups, last, because they carry the most consequence.
