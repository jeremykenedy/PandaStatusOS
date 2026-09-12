# The JSON API

The factory serves two routes: the page at `/` and the upload at `/ota`; everything else
is a 302 to the captive portal ([PROTOCOL.md](PROTOCOL.md)). The clone keeps that, and
adds a JSON surface under `/api/` for the page, for tools and for whoever is helping.
Every route below is unauthenticated on the network, like the factory's socket; nothing
here is reachable from outside it, and nothing here is stored except through the
documents that say they store.

## Discovery

A client probes `GET /api/features`. The factory answers 302; the clone answers 200. The
page does exactly this once on load and shows nothing beyond the factory page until it
sees the 200 (D-033). Two more read-only routes are always answered by a clone:

| Route | Answer |
|---|---|
| `GET /api/info` | identification: `{"product":"PandaStatusOS","build":"<16 hex>","version":"V1.0.0","idf":"v5.3.1","uptime_s":n,"heap_free":n,"flash_size":n,"leds":n,"mode":0 or 1,"features":<the switch bits as a number>,"config_layout":"PS04"}`. No network name, address, serial or credential. |
| `GET /api/state` | the six-root state document the socket pushes on connect (`wifi`, `sta`, `ap`, `printer`, `settings`, `block`), as JSON over HTTP, for tools and for gate 2. **Three fields are emptied here and nowhere else:** `wifi.password`, `ap.password` and `printer.access_code`. The socket still carries them, because the factory's socket does and the page's fields are filled from that push; this route is the clone's own, answers an unauthenticated GET from anyone who can reach port 80, and a second copy of a secret is a second place to lose it. The fields keep their shape and come back empty. The printer serial stays: it is on a sticker and the printer broadcasts it to the whole network itself. |

`build` is the first eight bytes of the app image's ELF sha256, the same value `X-Build`
carries on `GET /`; `tools/fw/ota-install.sh` proves an install by it.

## The rules every write route follows

- **Whole or refused.** A document is applied entirely or answered `400` with nothing
  applied: an unknown key, a value out of range, a colour that is not `#RRGGBBAA`, an
  array of the wrong length.
- **The answer is the document.** A successful POST answers the same document a GET of
  that route would, after the change.
- **A gated route does not exist while its switch is off.** It answers the same 302 as
  any unknown path, so a device at parity has nothing to find.
- **A switch going off takes its dependents with it.** A stored effect id that needed the
  switch falls back to solid (D-035).

## The routes

| Route | Switch | Body | See |
|---|---|---|---|
| `GET`/`POST /api/features` | none (discovery) | `{"features":{name:bool…}}` and/or `{"config":{…}}` | [FEATURES.md](FEATURES.md) |
| `GET`/`POST /api/preview` | bit 13 `preview` | `{"state":0..2,"percent"?,"temps"?,"stage"?,"seconds":0..600}`; `{"seconds":0}` clears | [FEATURES.md](FEATURES.md), A13 and B3 |
| `GET`/`POST /api/presets` | bit 14 `presets` | `{"presets":[…]}` or `{"apply":{"name","state"}}` | [FEATURES.md](FEATURES.md), A14 |
| `GET`/`POST /api/stages` | bit 15 `stage_effects` | `{"assign":{"stage","name"}}`, `{"clear":{"stage"}}` or `{"stages":[…15]}` | [FEATURES.md](FEATURES.md), B1 and B2 |
| `GET`/`POST /api/config` | bit 16 `config_io` | the settings as one document: the export leaves the three passwords out, the import takes them if given; whole or refused; the answer is the export | C3, D-042 |
| `POST /api/restart` | bit 17 `restart` | no document; answers `{"restarting":true}`, then restarts about 300 ms later with every setting kept | C4, D-043 |
| `GET /backup` | none (required) | the whole flash, `X-Flash-Size` before the body; station interface only | [FLASHING.md](FLASHING.md), D-029 |

## Examples

```
curl -s http://<device>/api/info
curl -s http://<device>/api/state | python3 -m json.tool
curl -s -X POST http://<device>/api/features -H 'Content-Type: application/json' \
     -d '{"features":{"state_brightness":true}}'
curl -s -X POST http://<device>/api/preview -H 'Content-Type: application/json' \
     -d '{"state":1,"percent":40,"seconds":30}'
```

## What is proven where

`tools/ui/harness/api.js` runs twice in the sweep: against the mock as the factory
(every `/api` path 302, POST included) and as the clone (the documents, the gating, the
refusals). The mock's routes mirror the firmware's validation; the firmware's own parse
is in `firmware/main/ps_api.c`.
