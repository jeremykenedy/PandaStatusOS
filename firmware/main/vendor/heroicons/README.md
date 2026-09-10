# Heroicons 2.2.0, outline, 24 px

The interface icons. Outline set, 24 x 24 grid, 1.5 stroke, by Tailwind Labs. Path data
used unmodified.

| | |
|---|---|
| version | 2.2.0 |
| licence | MIT, `LICENSE.txt` here, copied from the package verbatim |
| source | https://github.com/tailwindlabs/heroicons |
| obtained from | the npm registry tarball for `heroicons@2.2.0`, directory `24/outline/` |
| vendored SVGs | the files listed below, each byte-identical to upstream 2.2.0 `24/outline/` |
| sha256 of the sprite | printed by `tools/ui/build/build.py` on every build; it changes whenever an icon is added, so the build output is where it is recorded |

| File | sha256 |
|---|---|
| `outline/chevron-down.svg` | `2eacb6cecd8f1ab845a2a8417074b0dab9fd9612cdf56d76be45b82adb2933f5` |
| `outline/cog-6-tooth.svg` | `aee6f966b9491c2a8aed12bdc20193affe259964930ae6e2e264f0dc26e163fb` |
| `outline/cube.svg` | `7414e9c49119a02ca7c5fa10dd662e708c06bab1b03a57c33dce6c62a2c765f6` |
| `outline/document-text.svg` | `71f9dc980c507b7cfd044b7b322790f826e69cffcb6b06802c898502328a85b5` |
| `outline/home.svg` | `bf22818e3638f217e824ff26c8ffaf2ef014803982ca7c430e6c3c20915b185a` |
| `outline/light-bulb.svg` | `9c46baf011e3e38f45992459e4a692a972426e2e3478fa2f3d6514e0e318066f` |
| `outline/moon.svg` | `4dfd046e7cc6747a64b7656d5eec90907fe1eec8e7a1d3467ca25f6e599d3908` |
| `outline/photo.svg` | `7097d901bd73841390a5a73f99193af198d3392bc84371e7063e520956eb7360` |
| `outline/sun.svg` | `e55df00558e838b63e6aeebc4af511b37a427f739ce1c4a63a8116a558b1b12e` |
| `outline/wifi.svg` | `c998d3d83a06f9b763d1a6ff497bc60eb293de7e98b2a93557b4542722828217` |

**What ships.** Not these files directly. The page build assembles one inline SVG sprite
from the SVGs in `outline/`, one `<symbol>` per icon, so one inline block replaces a
network request per icon that the device could not serve anyway. The sprite is what
ships, so the sprite is what gets hashed. Until the first build, this row is the licence
and the rule; the hash line is filled in the same commit that first produces the sprite.

**The rule for `outline/`.** Every file in it is byte-identical to the file of the same
name in upstream 2.2.0's `24/outline/`. Nothing is edited. Any icon this project draws
itself is not a Heroicon, does not go in this directory, and is covered by the repository
licence under its own name with a `ps-` prefix.

**Verification.** `shasum -a 256 firmware/main/vendor/heroicons/outline/*.svg` reproduces the
table. Against upstream: download `heroicons-2.2.0.tgz` from the npm registry and `cmp` the
file against `package/24/outline/<name>.svg`. The build checks every file here against this
table before assembling the sprite; an icon with no row does not ship.
