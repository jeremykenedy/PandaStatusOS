# Coloris 0.25.0

The colour picker, attached to the colour `<input>` fields. Used unmodified.

| | |
|---|---|
| version | 0.25.0 |
| licence | MIT, `LICENSE.txt` here, copied from the package verbatim |
| source | https://github.com/melloware/coloris-npm |
| obtained from | the npm registry tarball for `@melloware/coloris@0.25.0`, files `dist/coloris.min.css` and `dist/umd/coloris.min.js` |
| `coloris.min.css` | 8,506 B, sha256 `b5e003381340500620df07a09b982abbfe1a848f9ca7efc4f3b3d91f89b9d83d` |
| `coloris.min.js` | 14,542 B, sha256 `383e42d95fb797b54588e056103bfd93d63fa4005e0104164fd487c93b5676af` |

**Why this one.** See `docs/DECISIONS.md` D-008. Chosen over Pickr on measured size (7,461 B
gzipped against 10,252 B) and because it leaves the field a real `<input>`, which the
harnesses can read. iro.js was excluded on licence: MPL-2.0 is the wrong shape for a
single spliced file.

**What ships.** The page build splices both files into the served page. Hashes above are
of the files as vendored; neither is modified.

**Verification.** `shasum -a 256 firmware/main/vendor/coloris/*` reproduces the hashes.
