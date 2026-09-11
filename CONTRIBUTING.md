# Contributing

## The clean-room rule, first

Nothing from BIGTREETECH, BIQU or Bambu Lab enters this repository. Not their code,
not their comments in any language, not their page, not their strings, not their
translations, not their artwork, not their icons. Not temporarily, not gitignored, not
on a branch, not in a commit that is later amended.

What may be recorded is the **interface**: field names, message roots, enum values,
wire shapes, stage names, endpoint paths, header formats, published file sizes and
sha256 values. Those are facts about how the device talks, and a clone has to speak
them. Their **expression** is what stays out: how they wrote it.

A shared misspelling is the fingerprint that proves copying. If one appears, it is a
defect, not a coincidence. The full rule is Rule 6 in [CLAUDE.md](CLAUDE.md).

## The residue sweep

`make residue` reads every tracked file and reports, per category, anything that looks
like the vendor's expression: their element IDs and class names, their function names,
their code shapes, their UI copy, their i18n pairs, their misspellings, the V1/V2 effect
list as a set, and any AI attribution. It exits non-zero on any hit and runs before
every commit. Do not add an allowlist entry to get past it; fix the thing it found.

## The naming convention

Their page names things `id_*` and `c_*`, so those two prefixes are absolute failures
anywhere in the tree, with no exemption. Ours never collide because ours use hyphens:

| Thing | Convention | Example |
|---|---|---|
| element ID | `ps-<area>-<control>` | `ps-lighting-brightness` |
| CSS class | `ps-<block>`, `ps-<block>-<part>` | `ps-tile`, `ps-tile-label` |
| data attribute | `data-ps-<name>` | `data-ps-str` |
| JavaScript global | `PS_<NAME>` | `PS_STRINGS` |
| i18n key | `ps_<page>_<what>` | `ps_network_hostname` |
| C identifier | `ps_<module>_<thing>` | `ps_cfg_load` |

## The pre-commit hook

This repository is public, and the device's own storage holds live Wi-Fi credentials.
The hook is committed; switching it on is repo-local git config and does not survive a
clone:

```
make hooks
```

It refuses a commit that stages anything under `.claude/work/` or `private/`, any
firmware blob or NVS artifact, or content matching a secret pattern: MAC addresses,
credential assignments, bearer tokens, private key blocks, AWS and GitHub tokens, Bambu
printer serials. It reads inside gzip members as well as plain files, because a
credential compressed is still a credential published. `make test-hook` is its
regression suite; a change to the hook comes with a case.

When the hook refuses something legitimate, the fix is a more precise pattern plus a
regression case, never an exemption. Every one of its refinements so far is a commit
whose message says what it learned.

## Building the page

The served page is assembled from `tools/ui/src/` by `tools/ui/build/build.py` into
`firmware/main/ui.html`, which is committed. Edit the sources, rebuild, and commit both:

```
python3 tools/ui/build/build.py          # writes firmware/main/ui.html
python3 tools/ui/build/build.py --check  # proves the committed page is what the build produces
```

The build refuses untagged text, a key missing from the English table, an `id_` or `c_`
token, an inline event handler, an external asset reference, a nav target with no page,
and a vendored file whose sha256 differs from its README. Details in
[docs/BUILDING.md](docs/BUILDING.md).

## Strings

Every visible string in the markup carries a key: `data-ps-str="ps_<page>_<what>"`.
The English table `tools/ui/i18n/en.json` is derived from the markup on every build plus
`js_strings.json` for strings only JavaScript uses; do not edit `en.json` by hand. The
other 24 tables are validated against English on every build. A new key means a new
English value in the markup and a translation in every table before the build passes.

## Running the harnesses

The harnesses run against the mock device in `tools/ui/mock/`, never against hardware.
Playwright is never a dependency of this repository; it lives in a gitignored working
directory:

```
mkdir -p private/uiwork && cd private/uiwork
npm init -y && npm install ws playwright && npx playwright install chromium
cd ../..
tools/ui/harness/sweep.sh                 # the whole table, 30 rows
tools/ui/harness/run.sh p2-idle.json page-lighting.js   # one harness, one fixture
```

The table in `tools/ui/harness/sweep.sh` is the only place a harness, fixture and
environment pairing lives. A harness that needs the mock to lie says so in its row.

Harnesses assert behaviour: a control is driven the way a person drives it, and the
exact frame the device receives is compared byte for byte, `device_wakeup` included.
They never assert padding, alignment or colour values, which the design system is
allowed to change. `contrast.js` is the exception that looks at colour, and it computes
ratios rather than comparing them to fixed values.

Screenshots go to `private/uiwork/shots/` on every run. Look at them. A page can pass
every wire assertion and be sixteen pixels wide.

## Building the firmware

```
. ~/esp/esp-idf/export.sh        # ESP-IDF v5.3.1
cd firmware
idf.py set-target esp32c3
idf.py build
```

`make test-fw` runs the config module's host tests with plain gcc and needs no
toolchain. Nothing in this repository flashes anything; see
[docs/FLASHING.md](docs/FLASHING.md).

## Commits

Every commit is authored by the maintainer, with no co-author trailers and no
attribution of any kind in messages, comments or documents. Commit messages say what
changed and why, in full sentences. `docs/DECISIONS.md` records every decision that
could have gone another way, with its alternatives and its reversal cost.

## What lives outside the tree

Flash dumps, the NVS partition, reference video and anything confidential live outside
the repository entirely. Working notes live in `.claude/work/`, working material in
`private/`; both are gitignored and both are refused by the hook. Credentials, MAC
addresses and serial numbers are referred to in documents by placeholder only:
`<WIFI_SSID>`, `<PRINTER_SN>`, never by value.
