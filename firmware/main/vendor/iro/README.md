# iro.js (vendored)

The colour wheel on the Lighting page is [iro.js](https://iro.js.org) by James
Daniel, used unmodified.

| | |
|---|---|
| package | `@jaames/iro` |
| version | 5.5.2 |
| file | `dist/iro.min.js` from the npm release, byte for byte |
| licence | Mozilla Public License 2.0 (`LICENSE.txt` here is the project's own copy of the licence text) |
| source | https://github.com/jaames/iro.js |
| sha256 of `iro.min.js` | `5d08eedbac9af7212f5fdf7e336aeb2da87ac47b2364818ad4bbd7fcbdd18d0d` |

The page build splices this file into `ui.html` as its own `<script>` block,
keeping the upstream banner (name, version, licence, URL) at the top of the
block, so the attribution ships inside the firmware image exactly as the
licence asks. Nothing in this directory is edited; to update, replace the file
with the new release's `dist/iro.min.js` and change the version and hash here.
