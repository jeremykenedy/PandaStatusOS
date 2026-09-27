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
TXT  id=<16 hex>   kind=status|vent   ver=1   name=<the friendly name; a label, not the hostname>
```

`id` is the device's identity: the first 8 bytes of sha256 over its Wi-Fi station MAC,
stable across address changes and across factory resets of the *other* device. A
device finds peers by browsing the service; the page lists them by `name` and `kind`.

Manual entry is the fallback and works the same way the printer bind does: type a host
name or an address, and the device fetches `GET /bridge/id` from it, which answers the
same fields as the TXT record.

### The scan, as the device half does it — BUILT 2026-09-27

A scan has to turn up the vents that exist today, not only the ones running a bridge, or
the owner presses Scan on a network with two vents on it and reads "0 vents found". So
`ps_bridge.c do_scan()` looks three times:

1. **The bridge record.** A browse of `_pandabridge._tcp` for 3 s; every `kind=vent` is a
   vent running a firmware with the bridge half, listed with its `id` and `fw` `bridge`.
2. **Every web server on the network, and the factory's name.** A browse of `_http._tcp`
   (PandaVentOS advertises one, instance = its hostname, port 80), plus a query for the
   host name `PandaVent`, which is the factory firmware's default (`PandaVent.local`). Port
   80 only, this unit's own address skipped, duplicates dropped, at most 8 candidates.
3. **A sniff of each candidate's stock socket.** A 1.5 s TCP connect and an upgrade to `/ws`
   (the stock vent socket, kept by PandaVentOS too) and up to 1.5 s of reading whatever the
   vent pushes first. The stock document has a root only a vent has, `rgb_mode`; a
   PandaVentOS adds `settings.os_name: "PandaVentOS"`, printed by cJSON_Print, so the key and
   the value are separated by a colon and a tab, and the sniff matches the key, blanks, one
   colon, blanks, then the value (the first cut matched the unformatted spelling and called
   both of the owner's PandaVentOS vents factory). `rgb_mode` alone makes it `fw` `factory`;
   with the name, `fw` `pandaventos`; a web server with neither is not a vent and is not
   listed. The byte stream is scanned as it arrives, with the last 31 bytes kept
   across reads so a key split by a read boundary is still seen, and no JSON is parsed: a
   sniff is a question, not a parse of a document this firmware does not otherwise know.

Each entry in `found` carries `fw` (`bridge`, `factory`, `pandaventos`, or `unknown`), and the
page prints the factory firmware and PandaVentOS after the name, because binding either
one gets `link` 7: a web server answered at the address and had no `/bridge` to upgrade to.
The device says so rather than dialling a socket that is not there, and tries again after
the unpaired wait (30 s), so a vent that is reflashed with the bridge half is picked up
without a page visit. The mock is told what the firmware sniffs (`PS_VENTS_STOCK`), and
`t-bridge.js` binds one to see the 7.

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

**How many hellos, and over which nonce** (settled 2026-09-26, when the device half was
written and found the mocks would greet each other for ever). On each socket:

1. The status side opens with `hello`. It has no peer nonce yet, so when it holds a token
   its `auth` is over its **own** nonce; the vent accepts a first proof over either nonce.
2. The vent answers with its one `hello` for that socket: `pair: true` when it holds no
   token for that identity, otherwise `auth` over the status side's nonce.
3. The status side checks that proof and answers with its **second** `hello`, `auth` over
   the vent's nonce. The vent checks it and answers with its current `vent` frame, never
   with another `hello`. Neither side answers a `hello` after that.

Every derivation hashes the hex strings concatenated, not the bytes they spell; both mocks
are JavaScript and concatenate strings, and the firmware follows them.

## Binding and rebinding

A device binds to an identity, never to an address. On every connect, and every time
the socket drops, it re-resolves the peer: mDNS first, the last known address second.
When a peer comes back at a new address under the same `id`, the bind survives without
a page visit. This is the shape the printer's address-change logic has, applied to a
peer whose identity is a fact rather than a guess.

What the device half actually does (`firmware/main/ps_bridge.c`, 2026-09-26): the order is
mDNS by identity (a browse of `_pandabridge._tcp`, picking the record whose `id` is the
bound one), then the name or address that was typed (an address as it stands, a name asked
of mDNS and then of DNS), then the last address the vent answered at. Whatever answered is
stored as that last address. A vent bound by address alone has no identity until its first
`hello`; the identity is adopted from that and is the bind from then on, and a different
identity answering at the bound address is reported (`link` 5) rather than followed.

Reconnects back off from 2 s to 30 s. A vent that will not have this device (a `bye`, a proof
that fails, a pairing code that lapses or is cancelled) is tried again after 30 s, which with
the minute the code stands means an unpaired binding left alone offers a fresh code for a
minute of every minute and a half until it is confirmed or unbound. A socket that opens and
says nothing for 10 s, or a paired vent silent for 90 s (three missed heartbeats), is dropped
and dialled again.

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

### `light`, asking rather than telling

```json
{ "light": { "seq": 10, "request": true } }
```

The same root with `request` instead of a payload means "send me yours". The peer answers
with its own `light` frame, above. This is what the colour copy is made of: one ask, one
answer, and the copy is made from what came back. Added 2026-09-26, because the copies were
agreed in this document before they had frames, and a copy cannot be built out of a
subscription that does not exist.

### `fx`, one bar state's effect, either direction

```json
{ "fx": { "seq": 11, "request": true, "state": 1 } }
{ "fx": { "seq": 12, "state": 1, "effect": 19, "brightness": 80, "speed": 50,
          "opt": 16, "aux": 4, "colours": ["#FFFFFFFF", "#000000FF", "#FF0000FF", "#00FF00FF"] } }
```

`state` is 0 idle, 1 printing, 2 error, the three bar states both devices have. The reply
carries the effect exactly as the sender holds it: its id, its four colours, its timing, its
options (the direction bit among them) and its one spare byte. The receiver applies it as its
own or refuses it whole, and an effect id the receiver's feature bits do not allow is refused
with the reason rather than downgraded, which is the rule this document already sets.

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

## What the mock vent does — BUILT 2026-09-26

`tools/ui/mock/mockvent.js` answers `GET /bridge/id`, speaks the exchange above on a socket
at `/bridge`, sends `vent` frames on every change and on a heartbeat, takes `open`, `close`
and `policy`, keeps the `light` frames it is sent, and lies on demand the way `mockdev.js`
does: `PV_SLOW`, `PV_SILENT`, `PV_GONE`, `PV_WRONG_ID`, `PV_WRONG_TOKEN`, `PV_NO_PAIR`,
`PV_NO_ACK`, `PV_DROP_AFTER`. It does not advertise itself over mDNS: a node process cannot
be made to answer for a device that is not there, so discovery is proved on the device side
and this end is bound by address, which is the contract's own fallback.

`tools/ui/harness/vent.js` plays the status side by hand, frame by frame, and holds the mock
to the document: the identity over HTTP, the first hello and its pairing code, the token both
ends derive, a returning peer proving itself without sending the token, the three commands
and their acks, an unknown command refused rather than ignored, a light frame kept as sent, a
peer whose proof fails told `bye {unpaired}` and closed, a command from a socket that never
said hello refused outright, the heartbeat, and the three silences. Thirty-two assertions, a
row in the sweep (`PS_WITH_VENT=1`).

`ps_bridge.c` is written against this same exchange, and if the two disagree one of them is
wrong in a way that can be pointed at. The real vent is not touched during any of it.

### The first conversation: the bench

The device half and the mock have not yet spoken. The job, in order, with nothing else on the
network at risk:

1. `PV_HOST=0.0.0.0 PV_PORT=80 node tools/ui/mock/mockvent.js` on the Mac. Port 80 because
   the contract puts `/bridge` on the peer's port 80 and the device dials nothing else; a
   low port needs the Mac's permission, which is the Mac's business and not the protocol's.
2. On the device's page: the bridge switch on, the vent bound by the Mac's address, the six
   digits read off the page and off the mock's log (`pair_code`), confirmed on the page (the
   mock confirms on its own).
3. Watch: `link` 3, the vent card on the dashboard saying `closed` and the mock's chamber,
   `POST /__vent {"state":"open"}` followed on the card without a page visit, both copies
   landing, the mock's `PV_DROP_AFTER` and `PV_SILENT` knobs bringing the link down and the
   device bringing it back on its own, the device's log saying each of these in its words.
4. Only then step 4 below.

## Order of work

1. This document, agreed by both projects. **Done.**
2. The mock vent. **Done 2026-09-26**, with the harness that holds it to the document.
3. PandaStatusOS side: the flag, discovery, pairing, `vent` in and `light` out, on the page
   behind the flag, with harnesses and screenshots. **The page half is done, 2026-09-26**:
   the card, the scan, the bind, the pairing code, the link, the two copies and the unbind,
   driven through `mockdev.js`, which holds a REAL bridge client rather than a pretence of
   one. `t-bridge.js` runs the three processes together, 32 assertions, a row in the sweep.
   **The device half is written, 2026-09-26**: `ps_bridge.c` holds the task, the socket,
   the hello and pairing exchange, the reconnects, the mDNS record and browse, `/api/bridge`
   and `/bridge/id`; `ps_bridge_proto.c` and `ps_sha256.c` are its pure parts, host-tested
   against node's numbers and RFC 6455's own frames (`bridge_test.c`, 32 assertions); the
   binding is its own NVS blob (`ps_bridge_cfg_t`, `cfg_test.c`). Bit 0 is inside
   `PS_FEAT_KNOWN` and in the features table, so the switch on the page is the device's.
   **Not yet exercised against a vent**: the mock vent listens on the loopback only, so the
   device half has been built to the same frames the mock speaks and has not spoken to it;
   the first conversation is the bench job below, before the real vent is touched.
4. Vent side, in its own repository, against a mock status.
5. Shared printer state and backups, last, because they carry the most consequence.

## Where it lives on the page

The vent is bound the way the printer is bound, on the same page and in the same shape:
a card headed "Bind a vent", with a search that finds vents on the network, a name, an
address and an Unbind. It sits under the existing "Bind to a printer" card, so the two
bindings this device has are read top to bottom in one place.

That page stops being called **Printer** and becomes **Bindings** when the vent card
lands, because by then it holds two of them and neither name covers the other. The nav
entry, both navs, the card title and the page's translation key all move together; the
card id stays `ps-card-printer` so the router and every harness that names it keep
working, which is the usual trade: the name a person reads changes, the name the code
uses does not.

The two copy switches agreed above (colours vent to status, effect vent to status) live
inside the vent card, not on the Lighting page: they are part of what being bound to a
vent means, and a person who has not bound one should not be offered them.

## The vent on the dashboard — BUILT 2026-09-26 (the page half)

Jeremy, 17 Sep 2026: once a vent is bound there is a vent card on the dashboard, beside
the printer's, showing what the vent is doing. Same shape as every other card on that
page: a title, a list of rows, values that come from the vent's own reports and nothing
invented. Not drawn at all while no vent is bound, the way the AMS card is not drawn when
the printer describes no AMS.

Built: `ps-card-vent-status` on the dashboard, drawn only while the link is up and a report
has arrived. Four rows, each present only if the vent sent it: the state in words (the five
the contract names, and a state this page does not know is a dash rather than the vent's own
token, which would be English on a page in Polish), the chamber, which way the policy is
deciding, and a fault code when there is one. `t-bridge.js` walks it, including a vent that
moves on its own while the page is open and is followed without the page being told anything.

## A page for the vent's own settings

Jeremy, 17 Sep 2026: control, as opposed to status, gets a page of its own rather than a
card. Vent behaviour is changed there.

The complication is that a vent on the network may be running one of three firmwares, and
they do not share a surface:

| What it is running | What this page has to do |
|---|---|
| the factory's own | speak what the factory unit serves, and offer only what that surface actually exposes |
| PandaVentOS | speak its surface, which is this family's own and is documented in that repository |
| DragonVent | speak its surface; the Dragon Center repository on GitHub is where it is written down |

So the page is one destination with three faces, chosen by what the bound vent says it is,
and a vent that will not say gets the smallest honest face rather than a guess. Which
firmware a vent is running has to come out of discovery or pairing, not out of a setting a
person is asked to fill in.

Unwritten until each surface has been read the way this project reads a surface: from a
running unit, or from a repository that is ours to read. Nothing here is a claim about
what any of the three offers.
