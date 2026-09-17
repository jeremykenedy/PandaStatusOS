# Lessons from PandaVent

PandaVent is the gold standard for this project. Its UI took forty harness runs and a long
sequence of shipped bugs to get right. Every one of those bugs cost real time, and every one
of them is preventable here for free, because the fix is already written down and in most
cases already enforced by the build.

This document is not advice. Each numbered item is a bug that actually shipped in the vent,
what it looked like from the outside, and what now stops it. Where the stopper is an assert,
the assert is load bearing: it is not removed, not weakened, and not exempted. A check that
grows an allowlist every time it fires is a check that decays to nothing.

## The build is the memory

**1. A card without `data-card` paints over every other page.**
The vent's lighting page was missing the attribute, so nothing could hide it and it covered
all eight pages below the fold. No harness caught it. A screenshot did.
*Stopped by:* the build asserts every `<section id="ps-card-*">` carries `data-card`.

**2. Navs and cards drift apart in silence.**
Eight bottom-bar entries had no ids and no handler, so on a phone not one page was reachable.
*Stopped by:* the build asserts the set of `data-nav` destinations equals the set of cards,
in both directions. A nav pointing nowhere and a page nothing points at both fail.

**3. Inline handlers rot.**
153 of them, each a second place where behaviour lived.
*Stopped by:* the build refuses any `on*=` attribute in the output. Modules wire their own
listeners by id, which means the id in the markup is a contract with the module.

**4. A key no language carries is invisible in English.**
`tr()` falls back to the key's own English, so five keys shipped showing English to the other
23 languages and looking perfect to the author.
*Stopped by:* the build asserts every key the page uses exists in `en.json`, and the string
build refuses to emit unless every language carries every key with matching placeholders.

**5. Beer lays `<body>` out as a grid with named areas.**
`nav`, `nav`, `header`, `main`, `footer` must be DIRECT children of `<body>`. The sibling
project nested the rail and `<main>` inside an unclosed `<header>`; the top bar floated in
the middle of the document, the rail lost its labels, and `<main>` rendered empty. Nine
rounds of CSS were thrown at it. No CSS could have fixed it.
*Stopped by:* a new assert this project adds, which the vent never had.

**6. Numbers in a README are claims, and an unchecked claim drifts.**
The vent's README said 599 strings for a table that had held 402 for weeks. The string build
printed the real number every run, right beside a document asserting a different one.
*Stopped by:* the build derives each countable claim from the file that settles it and
compares. Prose is not checked. Neither is anything describing somebody else's firmware,
because no file here can settle that.

**7. A step that only sometimes happens is not a build step.**
The page was rebuilt, the `cp` into `firmware/main/` was forgotten, and the firmware embedded
the older page while every check on the newer one read clean.
*Stopped by:* the build writes `firmware/main/ui.html` itself, as its last act.

**8. Generate, then key, then collect. In that order, every time.**
Regenerating a page after its keys are attached throws all of them away, and the page then
prints `ui_the_master_switch_for_both_strips` where the label should be.
*Stopped by:* `prepare.py` owns the order and says so in its own docstring.

## Working inside a framework

**9. Do not convert markup toward a framework. Use its idiom.**
Every round that took existing markup and pushed it toward Beer produced something worse.
The working move is the other direction: take the framework's own structure and put content
in it.

**10. A `grid` child with no size class is broken.**
`<div class="s12 m4 padding">`, always. Tiles without size classes is what produced the
oversized-icon page.

**11. `svg.i` is the icon, and one rule in `project.css` sizes every one of them.**
Renaming the class in the markup while leaving the sizing rule behind is how the icons fell
back to intrinsic size and filled the screen. Never write a second icon sizing rule.

**12. The theme class goes on `<body>`.**
Beer reads it there. The vent wrote it to `documentElement` and the light theme was
unreachable for days. Paint it before the body parses, or a reload flashes the wrong theme
and corrects itself.

**13. Beer's own cascade wins, or yours does. Pick one.**
Rules that reimplement Beer's card, grid, row or nav fight it at equal specificity and the
loser is whichever loaded second. `app.css` is 1,258 bytes in the vent. If yours grows past a
few hundred lines, something already provided has been rewritten.

## Provenance and secrets

**14. Nothing ships without a vendor row.**
Every third-party file has a row naming its licence, its source and its sha256, and the build
checks the file against the row before splicing it. A row is a claim; claims get checked.

**15. Scan for secrets before every commit, including inside the gzip.**
The device serves one compressed file. A scan that only reads the source tree is not a scan.

**16. Artwork provenance is recorded per symbol, not per folder.**
The vent's sprite is 43 Heroicons under MIT and 8 drawn for the project. That split is written
down, because "where did this icon come from" is a question asked years later.

## Process

**17. Patching a broken foundation multiplies the damage.**
Nine consecutive rounds of fixing the sibling project's UI each produced something worse than
the last, because each one preserved the thing that was wrong. Scrapping and re-copying took
under an hour.

**18. Verify by looking, then by asserting. Never by asking.**
Build, serve, screenshot at 390 and 1280, compare. Two of the vent's worst bugs were invisible
to every harness and obvious in a screenshot. Asking a human what it looks like is not
verification and it burns the one person who cannot be replaced.

**19. Get the chrome right before any content exists.**
One stub page, correct frame, screenshots compared. Content added to a broken frame hides what
is wrong with the frame.

**20. Harness paths are portable or they are useless.**
`$HOME/uiwork` and a pinned browser path meant the vent's harnesses ran in exactly one place.
Use `__dirname`, `$(dirname "$0")`, and an environment variable for the browser.

**21. Never run anything while a sweep is live.**
The sweep kills processes by name match. Running a screenshot beside it killed its own mock and
produced failures that were artifacts of the tooling, not the code.
