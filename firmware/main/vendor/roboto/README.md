# Roboto, variable face, woff2 subsets

The typeface, embedded as woff2 `data:` URLs in the served page.

| | |
|---|---|
| licence | **SIL Open Font License 1.1**, `OFL.txt` here. Copyright 2011 The Roboto Project Authors. |
| licence source | https://github.com/googlefonts/roboto-classic, `OFL.txt`, 4,394 B, sha256 `061402327a96aadb0bfb694a960ed289ecd38d383e396243831ab81feb109c41` |
| font source | the woff2 files served by the Google Fonts CSS API for the Roboto family, which exposes nine subsets: latin, latin-ext, cyrillic, cyrillic-ext, greek, greek-ext, vietnamese, math, symbols |
| version | **PENDING Q7**, read from the font's own name table when the subsets are vendored |
| subsets vendored | **PENDING Q7** |
| sha256 per subset | **PENDING Q7** |

**Why pending.** Which subsets ship depends on which languages ship, and the language list
is chosen in Q7 only after the English string table has been written and measured, and
after the CJK subset has been generated and measured. Choosing fonts before that is
choosing a number before knowing its cost. This row exists now so the licence is in place
before a single glyph is embedded, which is the rule: nothing ships without a row.

**The licence is not this repository's licence.** Roboto is OFL-1.1. Everything else in
this tree is MIT. Anyone reusing the font from this repository is bound by `OFL.txt`, which
is a different set of obligations. The OFL is a font licence and does not reach the
software, so the project is honestly described as MIT with vendored dependencies under
their own licences.

**CJK.** A full CJK face is not embeddable on this class of device. If CJK languages ship,
the approach is a subset containing exactly the glyphs the string table uses, generated as
a build step from the table so it cannot drift. That subset, if made, gets its own row
here with its own hash. Until then CJK falls through to the reader's own system font.
