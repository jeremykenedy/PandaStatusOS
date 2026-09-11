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
| 1 | `state_brightness` | one brightness per bar state (idle, printing, error) in each mode, instead of the factory's one per mode (A1) | off | nothing beyond the bar state the printer already drives |
| 2 | `state_effects` | in H2D, each bar state runs an effect from the engine in the state's colour instead of a solid fill (A2); seventeen effects that need no live input | off | the bar state; the LED count is PROVISIONAL, so the shapes are right and the scale is not yet |
| 3 | `effect_colours` | reserved for A3: the effect's own four colours | off | A2 |
| 4 | `effect_params` | reserved for A4: the effect's own brightness, speed and direction | off | A2 |
| 5 | `effect_ramp` | reserved for A5: the brightness ramp | off | A4 |

## How a feature reaches the page

The socket document is the factory's and stays byte-exact (gate 2). Features live on the
clone's own JSON route instead (D-033):

```
GET  /api/features   {"build":"…","features":{"state_brightness":false},
                      "config":{"state_brightness":[[50,50,50],[50,50,50]]}}
POST /api/features   {"features":{…}} and/or {"config":{…}}: taken whole or refused whole (400)
```

`config.state_effects` is three objects, one per bar state, each `{effect, brightness,
speed, bright_end, opt, aux, colours[4]}` in the engine's model; a POST may carry any
subset of an object's keys, and the whole three-object array is required. Which keys the
renderer reads depends on which bits are on (A2 reads `effect`; A3 to A5 will read the
rest), so a setting can be made before its switch exists and takes effect when it does.

The factory answers 302 to that path like any unknown one, so the page knows which device
it is talking to by the 200: against the factory it shows nothing the factory page would
not, and sends nothing the factory page would not. Against the clone the System page shows
a Features card with one switch per row of the table above, and each feature's own controls
appear on their page while its switch is on. The switches and their settings are part of the
config blob ([CONFIG.md](CONFIG.md)): they survive a restart and go with a factory reset.

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

## Required, and therefore not behind a flag

Two things the factory does not have and every build of the clone carries. They are not
features in the sense above: neither changes what the device does, both exist so that a
flash can be proven and a revert path can be taken, and a revert path that is off by
default is not a revert path. Both are invisible to the page and to the wire (D-029).

| What | Where | Why it is always on |
|---|---|---|
| `GET /backup`, the whole flash as bytes, `X-Flash-Size` before the body, station interface only | `firmware/main/ps_backup.c` | the only revert path this hardware has is a full flash image, and the factory offers no way to take one |
| `X-Build` on `GET /` and `GET /backup`, the build identifier | `firmware/main/ps_ws.c` | the factory's `/ota` answers 200 whether or not an upload landed; `tools/fw/ota-install.sh` proves a flash by this header and the served page |

## Reserved

| Bit | Reserved for |
|---|---|
| 0 | the Panda Vent bridge, unbound by default ([PANDAVENT-BRIDGE.md](PANDAVENT-BRIDGE.md)) |
