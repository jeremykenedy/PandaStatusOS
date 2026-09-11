# Features and their flags

The default configuration is factory parity: out of the box, after a factory reset, and
with no configuration at all, the device behaves like the factory application. Every
feature beyond parity sits behind a flag that defaults off and can be turned on only by
the owner.

The flags are bits in `ps_cfg_t.features` ([CONFIG.md](CONFIG.md)), a 32-bit field that
exists so the rule has a home before any feature does. Its value is zero.

## The table

| Bit | Flag | What it does | Default | Depends on |
|---|---|---|---|---|
| none yet | | | | |

## What a feature brings with it

A feature is not merged without all five:

1. **A flag** in `features`, defaulting to 0, named in this table with its dependencies.
2. **A harness** row that drives it through the page and asserts what the device receives,
   and one that proves the default configuration still sends exactly the factory frames.
3. **A screenshot** at both themes and both widths if it has any UI, looked at.
4. **A docs entry**: this table, and a section in the page's documentation.
5. **An i18n key set**, minted from our own pages, with a value in every table.

A feature that breaks a gate is a bug in the feature, not a reason to move the gate.

## What is catalogued

[ROADMAP.md](ROADMAP.md) lists what may be built, in tiers by what each item waits on:
things that need no new facts, things that need the bench session, things that need
the LED count or the block semantics, and things that need the flash dump. The three
controls the factory page handles inbound but never sends (`settings.on`,
`settings.follow`, `settings.printing_ui_type`) are recorded there as dead and left dead;
if they are ever wired, it is behind a flag.

## Reserved

| Bit | Reserved for |
|---|---|
| 0 | the Panda Vent bridge, unbound by default ([PANDAVENT-BRIDGE.md](PANDAVENT-BRIDGE.md)) |
