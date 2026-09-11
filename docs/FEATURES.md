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
| 3 | `effect_colours` | the effect's own four colours: lit and unlit, each for printing and for otherwise, instead of the state colour (A3) | off | A2; "printing" is a job running, preparing or paused, INFERENCE until the capture |
| 4 | `effect_params` | the effect's own brightness, speed and direction as one setting, over the factory's sliders and over A1's per-state brightness (A4) | off | A2 |
| 5 | `effect_ramp` | the brightness sweeps each cycle from the effect's own value to a second one, then starts over, for effects that set it (A5) | off | A4 |
| 6 | `fx_progress` | the progress bar effect may be chosen: the bar fills with `print.mc_percent` (INFERENCE from the report) (A6) | off | A2; a printer bound |
| 7 | `fx_progress_anim` | the animated progress effect: the fill with a chase and a breathing tip (A7) | off | A2; a printer bound |
| 8 | `fx_barber` | the barber pole through the fill, with its band width in the effect's `aux` (A8) | off | A2; a printer bound |
| 9 | `fx_hue_ramp` | the colour ramp across the print: one colour from the unlit colour to the lit colour, by hue (A9) | off | A2; a printer bound |
| 10 | `fx_temp` | the temperature gradient may be chosen: one colour between the unlit colour at the cold end and the lit colour at the hot end, following one of the printer's temperatures (`nozzle_temper`, `bed_temper`, `chamber_temper`, INFERENCE from the report), with the ends in `config.temp_gradient` (A10) | off | A2; a printer bound |
| 11 | `hot_warning` | a layer, not an effect: while the watched temperature (nozzle, bed or chamber) is at or past a threshold, one colour pulses over whatever the bar shows, in both modes, on a two-second period (A11) | off | a printer bound; nothing else, it sits over the placeholder as readily as over an effect |
| 12 | `error_flash` | a layer: while the bar state is error, one colour strobes over whatever the bar shows, in both modes, at its own brightness and rate; drawn after the hot warning so an error outranks it (A12) | off | the bar state the printer already drives |
| 13 | `preview` | the live preview: `POST /api/preview` pins the bar to a chosen state (idle, printing or error), with a progress, temperatures and a print stage if given, for up to ten minutes; the effects that read the print, the layers and the per-stage rows follow the pin; nothing is stored (A13, B3) | off | nothing; with the switch off the route answers 302 like any unknown path |
| 14 | `presets` | the named effects: an editor that saves an effect with its colours as stops, timing and direction under a name, up to eight, and copies one into any state; adds the two palette effects (`Colour stops`, still and scrolling) that lay the four colours across the bar (A14) | off | A2 to use one; A3 for the palette effects to read their stops |
| 15 | `stage_effects` | a named effect per print stage, fifteen rows in their own blob; a row without one inherits its bar state's effect (B1, B2). The stage is `print.stg_cur` with `gcode_state` mapped onto the fifteen display slots (INFERENCE, `ps_stage_from_report`) | off | A2; A14 to have a named effect to assign; a printer bound |

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
subset of an object's keys, and the whole three-object array is required.
`config.temp_gradient` is `{source, lo, hi}`: the reading the gradient follows (0 nozzle,
1 bed, 2 chamber) and its two ends in degrees Celsius, 0 to 500; any subset of its keys
overlays the stored setting, and it is one setting for every state that runs the gradient.
`config.hot_warning` is `{source, threshold, colour}`: the reading the layer watches, the
threshold in degrees Celsius (0 to 500) and the colour as `#RRGGBBAA`; any subset overlays.
`config.error_flash` is `{colour, brightness, speed}`: the colour as `#RRGGBBAA`, the
brightness 0 to 100, and the rate 0 to 100 on the engine's speed scale (the half period
runs from 500 ms at 0 to 16 ms at 100); any subset overlays.

The live preview (A13) has its own route, because a pin is not a setting:

```
GET  /api/preview    {"active":false,"state":0,"percent":-1,"temps":[-1000,-1000,-1000],"remaining":0}
POST /api/preview    {"state":1,"percent":40,"temps":[210,60,35],"stage":7,"seconds":30}: taken whole or refused (400)
                     {"seconds":0} clears the pin; the answer is the document above, plus "stage"
```

`state` is 0 idle, 1 printing, 2 error and is required unless `seconds` is 0; `percent`
0 to 100, `temps` (three readings, 0 to 500) and `stage` (a display slot, 0 to 14; B3)
are optional and stand in for the live values only where given; `seconds` is 0 to 600,
30 by default. With a stage pinned, the per-stage row for that slot renders as it would
in that stage, so all fifteen rows can be seen without fifteen prints. While the pin is live the
renderer reads it in place of the live state, so the effect chosen for that state, the
progress effects, the gradient and both layers show as they would; the live state is
untouched underneath and shows through when the pin expires or is cleared. While bit 13
is off the route answers 302 like any unknown path, so a device at parity has no such
route.

The named effects (A14) have their own route and their own blob (`presets`, see
[CONFIG.md](CONFIG.md)):

```
GET  /api/presets    {"presets":[{"effect":23,"brightness":50,…,"colours":[…],"name":"Ocean"}],"max":8}
POST /api/presets    {"presets":[…]}: the whole list replaced, taken whole or refused (400)
                     {"apply":{"name":"Ocean","state":2}}: the named preset copied into that state's effect
```

A preset is a `state_effects` object plus a `name` of one to fifteen characters, unique
in the list; its `effect` must be allowed under the bits in force when it is saved, and
again when it is applied, like any other. Applying copies it into `config.state_effects`,
where it is then an ordinary entry; the page re-reads the features document. The two
palette effects (ids 22 and 23) read the four colours as stops in order, the unlit ones
only while their `opt` bit says they are set; without `effect_colours` a palette has one
stop, the state colour, and is a solid. While bit 14 is off the route answers 302.

The per-stage rows (B1, B2) have their own route and blob (`stages`, [CONFIG.md](CONFIG.md)):

```
GET  /api/stages     {"stages":[{"slot":"standby","set":false,"name":"","effect":0,…,"colours":[…]},… fifteen],"current":0}
POST /api/stages     {"assign":{"stage":7,"name":"Ocean"}}: the named preset copied into row 7, with its name
                     {"clear":{"stage":7}}: row 7 inherits its state's effect again
                     {"stages":[… fifteen rows {set, name?, …fx} …]}: the whole table, whole or refused
```

`current` is the stage the device believes the printer is in, as a slot index (INFERENCE
until the capture). A set row stands in for the state's `state_effects` entry in the
resolve, and every other bit reads it the same way (colours under A3, params under A4,
its effect id under its own switch, falling back to solid). Assigning copies the preset,
so a preset edited or deleted later leaves the row as it was; the row keeps the name it
was assigned from. While bit 15 is off the route answers 302. Which keys the
renderer reads depends on which bits are on (A2 reads `effect`; A3 to A5 read the rest),
so a setting can be made before its switch exists and takes effect when it does. An
effect id that changes must be allowed under the bits the same document leaves in force:
the seventeen that need no live input come with `state_effects`, and each effect that reads
the print waits for its own switch. Echoing a stored id back is never refused. A switch
going off takes its effects with it: a stored id that needed the bit falls back to solid
in the config, so the page's next whole-table POST is not refused for carrying it; the
seventeen wait for `state_effects` to come back.

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
