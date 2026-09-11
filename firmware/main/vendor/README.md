# Vendored third-party components

**The rule: nothing ships without a row here.**

Every third-party component compiled into, embedded in, or served by this firmware gets
its own subdirectory under `firmware/main/vendor/`, and that subdirectory holds:

| File | What it is |
|---|---|
| `LICENSE.txt` | the component's own licence text, copied from upstream verbatim |
| `README.md` | version, licence, source URL, and the sha256 of **exactly what ships** |

If it is in the image, it has a row. If it has no row, it does not ship. There is no
third category.

## What "exactly what ships" means

The sha256 has to fingerprint the bytes that reach the device, not the bytes that were
downloaded. Those differ whenever the build transforms a dependency:

- A file vendored byte for byte: hash the file in this directory.
- A script or stylesheet spliced into the served page: hash the spliced block as it
  appears in the page, and say in the README that the hash covers the block rather than
  a file on disk.
- A subset, minified build, or anything with rules or symbols removed: hash the
  processed artifact, and state plainly what was removed. "Upstream with unused rules
  dropped, no rule rewritten" is a real and checkable claim. "Roughly upstream" is not.

If a component has no file in its directory because the build splices it straight into
the page, the README says so and explains where the licence travels instead. A licence
that asks for its notice to travel with the software is satisfied by the notice reaching
whoever holds a flashed device, not only whoever holds this repository.

## A row is a claim, so it must be checkable

Each README states its hash and its version. A reader with the repo and the built image
must be able to verify both. When a dependency is updated, the version and the hash
change in the same commit as the dependency.

## Licences are not all the same shape

Several common dependencies carry obligations that differ from this repository's MIT
terms: OFL for fonts, MPL-2.0 for some libraries, Apache-2.0's NOTICE requirement. Where
that is true, the component's README says so explicitly, so nobody reuses it from here
assuming MIT applies.

## What does not belong here

This directory is for third-party material this project is entitled to redistribute
under a licence. It is **not** a place for factory reference material. Under standing
the clean-room rule, no BIQU or BIGTREETECH code, asset, string, translation, or artwork enters this
repository in any form, vendored or otherwise. Factory reference material lives outside
the tree.

## Current components

| Directory | What | Version | Licence | Ships as |
|---|---|---|---|---|
| `beercss/` | layout, components, Material 3 tokens | 5.0.3 | MIT | two files, vendored pristine, hashed |
| `coloris/` | colour picker | 0.25.0 | MIT | two files, vendored pristine, hashed |
| `heroicons/` | interface icons, outline 24 | 2.2.0 | MIT | an assembled sprite; hash PENDING BUILD |
| `roboto/` | typeface | PENDING Q7 | **OFL-1.1** | woff2 subsets; PENDING Q7 |

Each directory's own `README.md` carries the hashes and the verification command.
