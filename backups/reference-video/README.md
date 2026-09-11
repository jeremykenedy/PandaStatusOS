# Stock reference video

This is the only capture of the factory bar behaviour while the device is still factory.
Once anything is written to flash it cannot be recaptured. See `firmware/SAFETY.md`.

Phase 2 gate 5 compares the clone against this footage on frame timing. That gate is only
as good as this footage. Shoot it for measurement, not for looks.

**The footage itself does not live in this repo.** It goes to
`/Users/jeremykenedy/backups/PandaStatus/reference-video/`, next to the flash dumps.
This repo keeps this document and, later, the frame timing data derived from the footage
under `backups/reference-video/timing/`. `.gitignore` enforces it.

## Capture settings

Frame timing is recovered by counting frames, so the frame rate has to be known and
constant.

- 60 fps or higher, fixed. Not "auto". 120 fps is better for anything that flashes fast.
- Lock exposure, lock white balance, lock focus. Autoexposure hunting corrupts
  brightness curves, which is exactly what a brightness sweep encodes.
- Fixed camera position. Tripod or braced. No pans, no zoom, no reframing mid-shot.
- Fill the frame with the LED bar. Every LED must be individually distinguishable, or
  spatial behaviour cannot be measured.
- Dark, even room. No flicker sources. Avoid any light that beats against the shutter.
- Hold each shot at least 15 seconds so several full periods are captured. A slow period
  at a low speed value may be long. When in doubt, hold longer.
- Say the mark name out loud at the start of each shot, or hold a written card in frame.
  Filenames get confused, audio does not.

## What to shoot

**The shot list is not here. It is in `backups/stock-capture-runsheet.md`, and that is
the only place it exists.**

This document describes *how* to shoot. The run sheet describes *what* to shoot, in the
order it has to happen, interleaved with the config reads that make each observation
interpretable.

That split is deliberate and it is not a style preference. The shot list previously lived
in both files, they drifted, and the copy here went stale describing a different product's
model entirely. One source of truth, pointed at from everywhere else.

Work the run sheet's **BENCH LADDER** top to bottom with the camera running. Every step
that changes what the bar does carries a `mark:` string, and those marks are what let the
footage, the WebSocket capture and the config reads be lined up afterwards.

The bar surface being captured, for camera-setup purposes only:

- two modes, Music and H2D
- three bar states: idle, printing, error
- brightness across both modes
- speed in H2D only, disabled in Music
- fifteen stage animations on the display during a print

## Naming

**Name each clip after the run sheet mark it captures.** Same string, `.mp4` extension.
That is the whole convention, and it exists so no separate mapping table has to be kept
in step.

| Run sheet mark | Clip filename |
|---|---|
| `write-test-index2` | `write-test-index2.mp4` |
| `brightness-music-50` | `brightness-music-50.mp4` |
| `brightness-h2d-50` | `brightness-h2d-50.mp4` |
| `speed-h2d-75` | `speed-h2d-75.mp4` |
| `speed-music-disabled-confirmed` | `speed-music-disabled-confirmed.mp4` |
| `theme-card` | `theme-card.mp4` |
| `stage-3-bed_heating` | `stage-3-bed_heating.mp4` |
| `state-paused` | `state-paused.mp4` |
| `state-finished` | `state-finished.mp4` |
| `state-error` | `state-error.mp4` |

Stage clips carry the occurrence number the run sheet assigns them, not a list position,
because which stages fire on a normal job and in what order is not known until it happens.

One long continuous take is acceptable and often better than 20 clips, provided the marks
are called out loud on the audio track. If you shoot continuous, name the file for the
session and keep the mark timestamps with it.

## What does not go in this repo

The footage. Any still frame taken from it. Any measurement that has not been reduced to
timing data. Under the clean-room rule, nothing read out of the factory application's own
markup or code goes here either: this document records how to point a camera at the
hardware, and the run sheet records what the hardware does.
