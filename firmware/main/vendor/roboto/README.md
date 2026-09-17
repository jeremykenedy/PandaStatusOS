# Roboto (vendored as embedded woff2, no source file here)

The typeface is Roboto 3.015, the variable face, embedded in `ui.html` as
five `data:` URLs.

| | |
|---|---|
| version | 3.015 |
| licence | **SIL Open Font License 1.1** (`OFL.txt` here) |
| copyright | Copyright 2011 The Roboto Project Authors |
| source | https://github.com/googlefonts/roboto-classic |
| subsets | latin, latin-ext, vietnamese, cyrillic, greek |
| total | about 128 KB of woff2 |
| sha256 of the `@font-face` block | `0eeb0b584234b72bcb9984718d188f4f274c861dd5b08b998e9c4cbc60f6dc0d` |

**The licence is OFL, not Apache-2.0.** Roboto has two lineages and they are
licensed differently: the older one is Apache-2.0, and Roboto 3 -- the variable
face this project embeds -- is OFL-1.1. The name table of all five embedded
subsets names the OFL and points at openfontlicense.org, and `OFL.txt` here is
the copy from the font's own repository, its first line matching that name
table exactly. Anyone reusing the font from this repository is bound by the
OFL, which is a different set of obligations from the rest of the tree.

Only five subsets are embedded because the device has 4 MB of flash in total.
The other languages the interface speaks fall through to the reader's own
system font.
