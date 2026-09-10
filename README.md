# Panda Status

Clean-room reconstruction of the BIGTREETECH Panda Status factory firmware, rebuilt
from a full flash dump of a stock unit.

## Setup

`core.hooksPath` is repo-local git config and does not survive a clone, so the
secret-scanning pre-commit hook is inert until it is switched on. One command:

```
make hooks
```

Verify at any time with `make check-hooks`.

## What the hook blocks

This repo is public. `.githooks/pre-commit` refuses a commit that stages:

- any path under `.claude/work/` or `private/`
- firmware blobs (`.bin`, `.dump`, `.img`, `.nvs`, `.hex`, `.elf`) or any filename
  containing `nvs`
- content matching a secret pattern, including:
  - MAC addresses
  - network credential assignments (SSID, PSK, passphrase, access code)
  - bearer tokens, private key blocks, AWS and GitHub tokens
  - Bambu printer serials
- any literal value listed in `.claude/work/secrets/forbidden-strings.txt`, which is
  itself never committed

The content scan reads **inside gzip members** as well as plain files, detected by magic
bytes rather than by filename, because a credential compressed is still a credential
published. `make test-hook` is the regression suite.

Fix a block by scrubbing the content, not by bypassing the hook.

## What is deliberately not in this repo

| Thing | Where it lives | Why |
|---|---|---|
| Flash dumps | `/Users/jeremykenedy/backups/PandaStatus/` | Contains NVS with live Wi-Fi credentials |
| NVS partition | same, never anywhere else | Live credentials. Not committed, not gitignored, not in the working area |
| Reference video | `/Users/jeremykenedy/backups/PandaStatus/reference-video/` | Size, and a public repo does not need it |
| Working notes | `.claude/work/` | Scratch, analysis, and secrets |
| Build system, harnesses, factory reference | `private/` | Working material. Gitignored in its entirety. See below |

Credentials, MAC, and serials are referenced in `docs/` by placeholder name only
(`<WIFI_SSID>`, `<DEVICE_MAC>`, `<PRINTER_ACCESS_CODE>`), never by value.

## Read before touching the device

`firmware/SAFETY.md`. A first install over stock cannot self-revert. The full flash
dump is the only revert path.

## `private/`, and why a fresh clone does not have it

`private/` is the second gitignored area. It is excluded **in its entirety**, so it is not
in this repository and **a fresh clone has to create it**:

```
mkdir -p private/{build,harness,factory}
```

| Path | What goes there |
|---|---|
| `private/uiwork/package.json`, `node_modules/` | the dev-only dependencies of the mock and the harnesses. Playwright never enters a tracked `package.json` |
| `private/uiwork/shots/` | screenshots, every page, both themes, both widths |
| `private/uiwork/captures/` | anything captured from real hardware, which carries secrets |
| `private/factory/` | factory reference material, consulted and never copied |

The mock device, the harness sources and the page build system are **tracked**, under
`tools/ui/`. They were written fresh for this project from porting notes, so there is nothing
in them to quarantine; what stays out of the tree is their dependencies and their outputs.
See `docs/DECISIONS.md` D-013.

Two independent controls keep it out: `.gitignore` excludes `private/`, and
`.githooks/pre-commit` hard fails if any path under it is staged. One of those being wrong
is survivable; both being wrong is not.

**Why the build system is private.** It reads factory reference material while it works,
which makes it working material rather than product. Working material that has been near
vendor files does not enter a public tree until someone has established, file by file, that
it carries nothing of theirs. That is not theoretical: the project this replaced shipped a
build step whose splice anchor was a vendor identifier, so the step structurally required
the vendor's own page as input.

**Where things actually live**, because the three are easy to confuse:

| Kind | Location |
|---|---|
| Secrets: credentials, MAC, serials, access codes | `.claude/work/secrets/` |
| Working material: build system, harnesses, scratch | `private/` |
| Device images: flash dumps, NVS, reference firmware | **outside the repo**, `/Users/jeremykenedy/backups/PandaStatus/` |

Material does not graduate out of `private/` by being tidied up. It graduates when someone
establishes its provenance and writes that down. A file whose author cannot be established
does not move, however useful it is.

## Rules and phases

`CLAUDE.md`.

## Third-party components

Every dependency compiled into or served by this firmware gets a row under
`firmware/main/vendor/`, holding its licence text and the sha256 of exactly what ships.
Nothing ships without a row. See `firmware/main/vendor/README.md`.

No BIQU or BIGTREETECH code, asset, string, translation or artwork enters this
repository, in any form. Factory reference material lives outside the tree.

## Licence

MIT. See `LICENSE.md`.

Not affiliated with, endorsed by, or supported by Shenzhen BIGTREE Technology Co., Ltd.,
BIQU or BIGTREETECH. This is a reimplementation, not a modification of their firmware.
"Panda Status" is their product name, used here only to identify the hardware this runs
on.
