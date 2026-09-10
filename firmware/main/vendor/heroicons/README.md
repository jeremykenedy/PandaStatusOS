# Heroicons 2.2.0, outline, 24 px

The interface icons. Outline set, 24 x 24 grid, 1.5 stroke, by Tailwind Labs. Path data
used unmodified.

| | |
|---|---|
| version | 2.2.0 |
| licence | MIT, `LICENSE.txt` here, copied from the package verbatim |
| source | https://github.com/tailwindlabs/heroicons |
| obtained from | the npm registry tarball for `heroicons@2.2.0`, directory `24/outline/` |
| vendored SVGs | `outline/*.svg`, **none yet**, added one at a time as pages need them |
| sha256 of the sprite | **PENDING BUILD**, filled the first time the page build assembles the sprite |

**What ships.** Not these files directly. The page build assembles one inline SVG sprite
from the SVGs in `outline/`, one `<symbol>` per icon, so one inline block replaces a
network request per icon that the device could not serve anyway. The sprite is what
ships, so the sprite is what gets hashed. Until the first build, this row is the licence
and the rule; the hash line is filled in the same commit that first produces the sprite.

**The rule for `outline/`.** Every file in it is byte-identical to the file of the same
name in upstream 2.2.0's `24/outline/`. Nothing is edited. Any icon this project draws
itself is not a Heroicon, does not go in this directory, and is covered by the repository
licence under its own name with a `ps-` prefix.

**Verification.** For any vendored SVG: download `heroicons-2.2.0.tgz` from the npm
registry and `cmp` the file against `package/24/outline/<name>.svg`.
