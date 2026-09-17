# Beer CSS 5.0.3

The UI's layout, components and Material 3 token system. Used unmodified.

| | |
|---|---|
| version | 5.0.3 |
| licence | MIT, `LICENSE.txt` here, copied from the package verbatim |
| source | https://github.com/beercss/beercss |
| obtained from | the npm registry tarball `beercss-5.0.3.tgz`, files `dist/cdn/beer.min.css` and `dist/cdn/beer.min.js` |
| `beer.min.css` | 87,944 B, sha256 `9415a6ee147efc95a8713e2c1a3c8c387c7f78c6b34ada6dc309ef0d18f34de7` |
| `beer.min.js` | 18,668 B, sha256 `992306080b2ad5d0f21a812b473d3d8b26fe5b9a731e29035853d79a766f640f` |

**What ships.** The page build reads both files from this directory and splices them into
the served page. The two hashes above are of the files as vendored. If the build ever trims
the stylesheet, the trim is "rules removed, no rule rewritten, nothing added", and the
trimmed artifact's own hash is recorded in the build output alongside this one so both are
checkable.

**Verification.** `shasum -a 256 firmware/main/vendor/beercss/*` reproduces the two hashes
above. The `beer.min.js` hash also matches the copy the sibling project vendored, which
independently confirms the npm tarball is the pristine upstream build.

**Update procedure.** Replace both files from the new release's `dist/cdn/`, update the
version and both hashes here in the same commit, re-run the contrast harnesses on both
themes.
