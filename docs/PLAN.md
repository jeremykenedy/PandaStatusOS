# The plan: phases and gates

The work is staged in three phases. Each ends with a report, and the next does not
begin until the maintainer says so. Nothing in any phase touches the device without the
flashing rule being met (`firmware/SAFETY.md`).

## Phase 0. Back up and prove the restore path

Nothing else happens until this is done.

- Record the stock unit on video: both modes, the three bar states, brightness at 0, 25,
  50, 75 and 100 in both modes, speed at the same points in H2D, and every stage
  animation that fires during one short print, in order. The run sheet is
  `backups/stock-capture-runsheet.md`.
- Identify the hardware: chip id, flash id, flash size, MAC.
- Take a full flash image, offset 0 through the full flash size, outside the repository.
- Take it twice to two files; the two must agree, or read again until two consecutive
  reads do. Never proceed on a single read.
- Parse the partition table from the image, record every partition's offset, size and
  sha256, and write `backups/RESTORE.md` with the exact restore command, every offset
  spelled out.
- Verify the extracted app image parses: the magic, the segment count, the app
  descriptor with its project name, version, framework version and build date.
- Compare the image against every published reference binary and report any match.

The fifteen stage animations plus the firmware are the entire irreplaceable surface of
this device: none of the animations is served over HTTP and none is published anywhere.

## Phase 1. Recover the factory application, by static analysis only

- Derive the flash-to-address mapping from the image's own segment headers, confirmed
  against independent string references; never a hardcoded base.
- Locate the web page inside the image; it is reference material and stays outside the
  tree. What comes back is the interface it implies, never its bytes.
- Recover the protocol surface: the browser side (`docs/protocol-websocket.md`), the
  printer side and any discovery topics.
- Pin the renderer: how Music mode reacts to sound, how H2D lays the three colours on
  the strip and what the speed value drives, the two colour formats, the stage-to-slot
  mapping, and the LED count from the strip driver's configuration.
- Read the factory defaults off the live device with its own reset commands, one rung at
  a time, and record them in a table.

Everything recovered goes to `docs/` with its evidence. Anything not proven is marked
INFERENCE.

## Phase 2. Build the clone

ESP-IDF v5.3.1, to match the factory build. Five gates, each reported pass or fail on its
own; a partial is never a pass:

1. **Functional equivalence of the page.** Every control the factory page exposes is
   present and reaches the device with the same wire message, verified by a harness that
   asserts what the device receives, frame for frame, envelope included. Controls that
   are dead in the factory page send nothing and stay dead.
2. The clone's state document, seeded from the device, is exactly what the device emits.
3. The clone's compiled-in defaults equal what the device reports after its own factory
   reset. Zero differences.
4. Every inbound message shape is handled.
5. The bar matches the Phase 0 reference video: both modes, all three states, the sweep
   points, and the stage sequence, on frame timing.

Features beyond parity are built behind flags that default off
([FEATURES.md](FEATURES.md)) and never move a gate.

## The evidence standard

Every claim in `docs/` cites where it came from: a file, an offset, an instruction
address, or the command that produced it. A claim without evidence is labelled
INFERENCE. Confident and wrong is worse than not verified yet.
