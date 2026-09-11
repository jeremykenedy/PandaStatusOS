# Stock capture run sheet, Panda Status P2

Written from scratch for the P2. The previous sheet described the V1/V2 product, which
had a different model entirely: seven effects, three speed settings, and six printer
states. It is archived as superseded and none of it applies here.

One session, while the unit is still factory. Nothing here is USB. Phase 0 step b,
first USB contact, waits for explicit go.

# BENCH LADDER

No prose. Work down. Line numbers here are **bench steps**, not section numbers.
Detail lives in the lettered map below the block.

```
 0  Open UI. Snippet. __wsCapAttach(). Click something. Confirm tx AND rx.
 1  ./tools/read-config.sh read-1-session-start      mark: read-1-session-start
 2  Settings page. Record img_version. Count the LEDs.
 3  H2D mode. Set state index 2 to #00FFAA.          mark: write-test-index2
 4  ./tools/read-config.sh read-2-after-write-test   mark: read-2-after-write-test
 5  Confirm the write took. Note bar colour at idle.
 6  Brightness Music:  0 25 50 75 100                mark: brightness-music-<v>
 7  Brightness H2D:    0 25 50 75 100                mark: brightness-h2d-<v>
 8  ./tools/read-config.sh read-3-after-brightness   mark: read-3-after-brightness
 9  Speed H2D:         0 25 50 75 100                mark: speed-h2d-<v>
10  Music: confirm speed slider is DISABLED.
11  ./tools/read-config.sh read-4-after-speed        mark: read-4-after-speed
12  Block model. Read only. Count blocks, note range.
13  ./tools/read-config.sh read-5-after-block        mark: read-5-after-block
14  Theme card. Capture ws_theme.preview and .list.  mark: theme-card
15  ./tools/read-config.sh read-6-after-theme        mark: read-6-after-theme
16  START PRINT.
17  Each stage: mark stage-<n>-<gifname>. Log GIF + printer stage + bar.
18  PAUSE mid print. Look for #00FFAA.               mark: state-paused
19  Let it finish.                                   mark: state-finished
20  Error only if safe. Else write UNCAPTURED.       mark: state-error
21  ./tools/read-config.sh read-7-after-print        mark: read-7-after-print
22  __wsCap.save('ws-capture-session.jsonl')
23  ./tools/read-config.sh ladder-A-baseline         mark: ladder-A-baseline
24  CONFIRM H2D IS SELECTED.  (rgb_reset is a no-op in Music)
25  Fire Reset Settings -> Confirm.                  mark: ladder-fire-rgb_reset
26  ./tools/read-config.sh ladder-B-after-rgb_reset  mark: ladder-B-after-rgb_reset
27  Change hostname, OK the success dialog. Sends reset.  mark: ladder-fire-reset
28  Device restarts. DIALOG WILL APPEAR. DO NOT CLICK OK. Save first.
29  ./tools/read-config.sh ladder-C-after-reset      mark: ladder-C-after-reset
30  Wi-Fi credentials in hand? If no, STOP.
31  Fire Factory Reset -> YES.                       mark: ladder-fire-factory_reset
32  ./tools/read-config.sh ladder-D-after-factory_reset
33  If that read failed: re-onboard, then
    ./tools/read-config.sh ladder-D-after-reonboard
34  Re-onboard Wi-Fi. Record recovered secrets to forbidden-strings.txt.
35  Redact every raw capture. Leave the raws untouched.
```

**A read never touches the browser socket. It costs nothing. It cannot raise the
dialog.** Only bench lines 28 and 31 restart the device.

`./tools/read-config.sh --list` prints the valid names. A typo is refused, not guessed.

### Where the detail lives

| Bench lines | Section |
|---|---|
| 0 | §0 Rig verification |
| 1 | §1 Config read #1 |
| 2 | §2 img_version and LED count |
| 3 to 5 | §3 State colour write test |
| 6 to 8 | §4 Brightness sweep |
| 9 to 11 | §5 Speed sweep |
| 12 to 13 | §6 Block model |
| 14 to 15 | §7 GIF / theme channel |
| 16 to 21 | §8 One short print |
| 22 | §9 Save |
| 23 to 33 | §10 The reset ladder |
| 34 to 35 | §11 Re-onboard |

Read the **PRE-FLIGHT ANNEX** once before starting. It lists the controls that send
nothing, so a dead control is not mistaken for a failed capture.

## Fixed strings

Type these. Do not compose them.

### Read names, for `./tools/read-config.sh <name>`

```
read-1-session-start
read-2-after-write-test
read-3-after-brightness
read-4-after-speed
read-5-after-block
read-6-after-theme
read-7-after-print
ladder-A-baseline
ladder-B-after-rgb_reset
ladder-C-after-reset
ladder-D-after-factory_reset
ladder-D-after-reonboard
```

Each writes to `/Users/jeremykenedy/backups/PandaStatus/ws-capture/<name>.jsonl`.
The script refuses an unknown name and refuses to overwrite an existing file.

### Mark strings, for `__wsCap.mark('...')`

Every read name above is also a mark string. Fire the mark in the browser at the moment
you run the read, so the two timelines line up. Plus these:

```
write-test-index2
write-test-index0
write-test-index1

brightness-music-0     brightness-h2d-0
brightness-music-25    brightness-h2d-25
brightness-music-50    brightness-h2d-50
brightness-music-75    brightness-h2d-75
brightness-music-100   brightness-h2d-100

speed-h2d-0
speed-h2d-25
speed-h2d-50
speed-h2d-75
speed-h2d-100
speed-music-disabled-confirmed

theme-card
block-model

stage-1-<gifname>      ... one per stage, numbered in the order they occur
state-paused
state-finished
state-error

ladder-fire-rgb_reset
ladder-fire-reset
ladder-fire-factory_reset
```

Only `stage-N-<gifname>` needs composing, and only because the stage order is unknown
until it happens. Everything else is a literal.

---

---

# ⛔ READ THIS FIRST ⛔

## IF A DIALOG SAYING THE CONNECTION IS NOT OPEN APPEARS

# ### DO NOT CLICK OK ###

The device's own UI reacts to a closed socket by raising this dialog, and wiring its OK
button to a full page navigation. Measured, and it is the mechanism that matters here:
socket close raises the modal, OK reloads the document.

**Clicking OK reloads the page. A reload destroys the entire in-memory capture.**
Mid-session that is the difference between having the capture and losing it.

If the dialog appears: leave it on screen, call `__wsCap.save()` immediately to get
what you have onto disk, and only then decide what to do.

## `__wsCapAttach()` IS THE DEFAULT MODE FROM HERE ON

Never reopen the socket to capture it. Attach to the one the page already has.
Wrap mode requires a reload and a reload is the thing that kills the capture.

---

## Artifacts

Everything lands outside the repo under `/Users/jeremykenedy/backups/PandaStatus/`.

| Dir | Contents |
|---|---|
| `reference-video/` | footage |
| `ws-capture/` | WebSocket JSONL. **Secrets-bearing.** Treat like the NVS dump. |
| `stock-ui/` | the device's own UI file, already captured |
| `reference-firmware/` | published V1/V2 images, reference only |

The captures contain live credentials in plaintext. Confirmed: the connect-time push
carries the station and AP network keys, the printer serial and the printer access
code. Never paste a frame into a commit, an issue, or a doc. Use
`tools/redact_ws.py` to make a working copy and leave the raw file untouched.

## Order

```
0.  Rig verification, staged
1.  Config read #1, session start
2.  img_version, LED count
3.  STATE COLOUR WRITE TEST          <- first write, before anything else
4.  Brightness sweep, both modes
5.  Speed sweep, H2D only
6.  Block model enumeration
7.  GIF / theme channel
8.  One short print, 15-stage capture
9.  Save
10. Reset ladder: read -> rgb_reset -> read -> reset -> read -> factory_reset -> read
11. Re-onboard
```

**The write test goes first.** It changes what every later observation means. Running
the print before knowing what index 2 is means re-reading every stage observation
afterwards against a mapping that was still a guess when it was recorded.

**The reset ladder goes last and runs in ascending order of destruction**, with a full
config read between each rung. `rgb_reset` may answer Gate 3 for the lighting defaults
without touching Wi-Fi at all, which gets the answer before the onboarding is burned.
`factory_reset` is last because it ends the session.

## 0. Rig verification, staged

**0a. Browser alone.** Open the UI at `<DEVICE_HOST>`. Confirm it loads and updates.

**0b. Attach.** DevTools > Sources > Snippets, paste `tools/ws-capture-snippet.js`, run
it, then run `__wsCapAttach()`. No reload. Confirm `__wsCap.rx()` and `__wsCap.tx()`
both go above zero after one deliberate interaction.

### That click also closes an open instrument question

On 2026-08-27 a rig test recorded `tx: 1` shortly after attaching, and both directions
were reported proven on that basis. That page later navigated and the log was lost, so
the frame cannot be re-examined. The comment-aware sweep in the annex then established
that **no unprompted send path exists in this UI**, which leaves that frame unexplained.

So this click is not a formality:

- **One tx, plausible shape** (single JSON object, one root, `device_wakeup: 1` present)
  → the earlier frame was an interaction that was not accounted for. Wrapper is sound.
  Note which interaction produced it and proceed.
- **No tx, or more than one, or malformed**
  → **the wrapper is at fault. STOP. Do not proceed to step 1.** Every outbound capture
  in the session depends on it, and a one-shot session is the wrong place to discover
  an instrument fault. Suspects in order: the `ws.send` rebind not surviving, the page
  holding a cached reference to the original bound `send`, or double counting from both
  the rebind and an event path.

Write the result down either way.

Pick a click that changes nothing if you can. If every available control writes, prefer
the smallest write you intend to make anyway, and mark it.

**0c. Logger, the continuous stream.** Tested against this device on 2026-08-27: a
second client did **not** displace the browser. Window global, DOM node and in-page
capture all survived, socket stayed OPEN, no dialog, no navigation.

```
python3 tools/ws_logger.py ws://<DEVICE_HOST>/ws \
  -o /Users/jeremykenedy/backups/PandaStatus/ws-capture/device-stream.jsonl
```

Server to client only. Browser to device comes only from the snippet. Run both.

**Note:** this continuous logger is separate from the point-in-time reads.
`./tools/read-config.sh <name>` opens its own short-lived client per read. The whole
read path was rehearsed end to end against the device on 2026-08-27, including the
unknown-name refusal, the overwrite refusal and the redaction step, and the rehearsal
output was deleted. The first real read will not be the first time those paths run.

**0d. Video rig.** Locked exposure, locked WB, locked focus, fixed camera, 60fps+, LEDs
individually distinguishable, dark even room.

## 1. Config read #1

`__wsCap.mark('config-1-session-start')`. The device pushes the full config on connect,
so a fresh attach is the read. Save.

## 2. img_version and LED count

**a. `settings.img_version`.** The UI handles this field but the connect-time push did
not contain it. Visit the settings page with capture running and see whether it arrives.
If it never does, record that as "not emitted", which is itself a finding.

img_version: `________________`

**b. LED count.** Still needs your eyes. Not published: the BTT wiki spec page lists
ESP32-C3-MINI, 96mm x 17mm, Type-C 5V 3A, and no LED count.

LED count: `________`  Method: `physical count / other: ____________`

**INFERENCE, do not rely on it, use only as a sanity check:** the wiki quotes a 540mA
peak figure. At roughly 20mA per channel that is a loose upper bound only, and the
wiki's own peak and standby figures look transposed. Count them.

## 3. STATE COLOUR WRITE TEST, the first write of the session

Everything after this depends on the answer, so it goes first.

**The artifact contradicts itself on index 2.** Two places label the three states idle,
printing and error, and the client-side reset path sets index 2 to red, which fits error.
A third place, a stale comment, labels index 2 as pause instead.

The pause label is almost certainly left over from the six-state V1/V2 model. Almost certainly is not proven, and static reading cannot settle
it. Three colours, three states, one write test.

### Method

1. Be in **H2D mode**. Music mode has no state colours.
2. `__wsCap.mark('write-test-index2')`
3. Set **index 2** to a colour used nowhere else. `#00FFAA` is a good choice: it is
   nothing's default, it is not red, white or the current blue, and it is unmistakable
   on the bar.
4. **Read the config back and confirm it took** before observing anything. If the write
   did not land, everything after it is noise.
5. Observe the bar in **idle**.
6. Trigger a **pause** during the print at step 8.
7. Trigger an **error** if it can be forced safely.
8. Whichever state shows `#00FFAA` is what index 2 actually is.

Outbound shape:
`{"settings":{"rgb_info_mode":<m>,"rgb_rgba":<...>,"rgb_state_index":2,"device_wakeup":1}}`

| Observation | Bar colour seen | Is it #00FFAA? |
|---|---|---|
| idle, immediately after write | | |
| paused, during print | | |
| error, if forced | | |

**Result: index 2 is `____________`**  (error / pause / something else)

Steps 5 through 7 span the print, so this test opens here and closes at step 8. Note
what the bar does at idle now, then carry the colour into the print.

Optionally repeat for index 0 and index 1 to confirm the whole mapping rather than just
the disputed slot.

| Index | Colour set | State that changed | Confirms |
|---|---|---|---|
| 0 | | | |
| 1 | | | |
| 2 | `#00FFAA` | | |

Record the original colours before overwriting so the pre-reset state is reconstructable,
or note explicitly that you did not, so config read #2 stays interpretable.

## 4. Brightness sweep, both modes

Slider is `min=0 max=100 step=5`, 21 positions, default 50. Sample at **0, 25, 50, 75,
100**. Record the number the UI shows, not a label.

Brightness exists in **both** modes. Do the sweep twice, once per mode.

| Mode | 0 | 25 | 50 | 75 | 100 |
|---|---|---|---|---|---|
| Music | [ ] | [ ] | [ ] | [ ] | [ ] |
| H2D | [ ] | [ ] | [ ] | [ ] | [ ] |

`__wsCap.mark('brightness-<mode>-<value>')` before each. Save after each.

Outbound shape is `{"settings":{"rgb_info_brightness":<v>,"device_wakeup":1}}`.

## 5. Speed sweep, H2D only

**Correction to the earlier plan: speed is not gone.** The P2 has a speed slider,
`min=0 max=100 step=5`, **default 100**. It sends `settings.rgb_info_speed`.

It is **disabled in Music mode**: the Music branch disables the slider outright, and the
artifact's own comments confirm the speed bar is H2D only. The client-side reset path
resets the speed entry for index 1 only.

So sweep speed in **H2D only**, at 0, 25, 50, 75, 100.

| Mode | 0 | 25 | 50 | 75 | 100 |
|---|---|---|---|---|---|
| H2D | [ ] | [ ] | [ ] | [ ] | [ ] |
| Music | slider disabled, confirm and record that it is | | | | |

**Open discrepancy to resolve here.** The UI reads a `speed` key out of each `list2`
entry, but the device's push contained **no `speed` key** in either entry. Watch config
read #2 after moving the speed slider: if `speed` appears in `list2`, it is persisted
and simply absent at defaults. If it never appears, the firmware accepts
`rgb_info_speed` without reporting it back, which a clone has to replicate exactly.

## 6. Block model

New, and the plan never had it. `block.blocklist` currently has one entry:
`{"blockID": 0, "blockrgba": "#FFFFFFFF"}`.

Outbound is the block colour picker's confirm, sending `{blockID, blockrgba}`.

Read-only for this pass. Enumerate what the UI exposes:

- How many block entries does the UI offer? `________`
- Is blockID selectable, and what range? `________`
- What does one block map to physically: whole bar, a segment, a zone? `________`
- Does `blocklist` grow in a later config read? `________`

Do not guess what a block is. Record what the UI shows and what the bar does.

## 7. GIF / theme channel

**Established, do not retry:** there is **no HTTP GET route** for the GIFs. Every path
except `/` and `/ota` returns a 302 captive-portal redirect. 15 probes, all redirected.

### The irreplaceable surface

**The 15 GIFs plus the firmware are the entire irreplaceable surface of this device.**
None of the GIFs is reachable over the network. None is published anywhere. No P2 image
exists in the BTT repo or on the wiki. If they are lost they are lost permanently.

Consequences, carried into Phase 0:

- Each of the 15 slots gets **its own sha256** and **its own line in `RESTORE.md`**.
- The img partition gets the **same three-read, two-must-agree rule as the firmware**.
  See `firmware/SAFETY.md`. It is not a lesser artifact because it holds pictures.
- `settings.img_version` is **recorded before the dump**, at step 2. Without it the
  extracted images cannot be tied to a version.

### What to capture live, here

- Visit the theme card with capture running. `ws_theme.preview` and `ws_theme.list` have
  never been seen on the wire.
- `ws_theme.list` entries are `{gif, rgba}`, filtered against the 15 slot names.
- Record which of the 15 the UI actually shows, and any per-GIF colour.

| Slot | Shown in UI | rgba | Notes |
|---|---|---|---|
| standby | | | |
| nozzle_heating | | | |
| bed_heating | | | |
| bed_leveling | | | |
| homing | | | |
| nozzle_cleaning | | | |
| calibrating_flow | | | |
| xy_mesh_mode_sweep | | | |
| filament_check_location | | | |
| filament_cut | | | |
| filament_pull_back_cur | | | |
| filament_push_new | | | |
| filament_purge_old | | | |
| printing_ok | | | |
| printing | | | |

**Do not upload anything.** `POST /ota` with `OTA-Type` writes flash. Uploading a GIF
overwrites a slot that cannot be recovered.

## 8. One short print: 15 stages against 3 colours

This is the real architecture of the device and it was invisible until the UI file was
read. **The display runs at print-stage granularity, 15 slots. The bar runs at three.**

The 15 slots, in the order the artifact lists them:

```
standby              nozzle_heating          bed_heating
bed_leveling         homing                  nozzle_cleaning
calibrating_flow     xy_mesh_mode_sweep      filament_check_location
filament_cut         filament_pull_back_cur  filament_push_new
filament_purge_old   printing_ok             printing
```

### Two questions this step exists to answer

**a. Which of the 15 actually fire on a normal job, and in what order.**

The list is what the firmware *can* show. A normal job will not hit all 15. Several are
clearly AMS or filament-change stages that a single-colour print never reaches.

Record them **in the order they occur**, not in list order. Number them as they happen.

| # | GIF shown | Printer's reported stage, verbatim | Bar colour | Bar state |
|---|---|---|---|---|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |
| 5 | | | | |
| 6 | | | | |
| 7 | | | | |
| 8 | | | | |

Add rows as needed. Mark every transition: `__wsCap.mark('stage-<n>-<gifname>')`.

At the end, list the slots that **never fired**. A slot that never fires on a normal job
is a finding, not a gap.

Never fired: `________________________________________________`

**b. What the bar does during each one.**

Fill the bar columns above for every stage. The specific thing being measured: **does
the bar change at all between stages that share a bar state?**

If the bar holds one colour across ten different display stages, that is the answer and
it is worth stating plainly.

### What this means, and what NOT to do about it

If the bar is genuinely three states while the display walks 15 stages, then **per-stage
bar colour is the single biggest customization this device can take.**

**That is a Phase 2 plus item, not a clone item. Record the mapping. Build nothing.**
The parity rule: no customization until every Phase 2 gate passes. Writing it down is
the job here. Wanting to build it is not a reason to start.

### Pause and error

Trigger the **pause** here, and watch for `#00FFAA` from the step 3 write test. That
observation closes step 3.

**Error.** Do not risk hardware to force it. If it cannot be provoked safely, mark it
**UNCAPTURED**. Record what the bar shows and what the printer reports as two separate
observations. Do not assume any given fault maps to a particular colour index; that
mapping is what is being measured.

`printer.state` for reference is the **binding** state, not the print stage:
`1 invalid info, 2 connecting, 3 connected, 4 ip err, 5 sn err, 6 access code,
7 unknown err`. The print stage arrives by another route. Identifying that route is part
of this capture.

## 9. Save

`__wsCap.save('ws-capture-session.jsonl')`, move it to `ws-capture/`. Confirm the logger
file is non-empty. Then make redacted working copies:

```
python3 tools/redact_ws.py <raw>.jsonl -o private/analysis/<name>.redacted.jsonl
```

## 10. The reset ladder

Three distinct commands land on `settings`. They are **not** the same thing. Full
enumeration with evidence is in `docs/protocol-websocket.md`.

| Command | Wire | UI trigger | What its dialog claims |
|---|---|---|---|
| `rgb_reset` | `{"settings":{"rgb_reset":1,"device_wakeup":1}}` | the reset button on the RGB card, then its confirm | claims to reset all settings, but every value its path touches is lighting |
| `reset` | `{"settings":{"reset":1,"device_wakeup":1}}` | no button. Fires after `set_hostname` / `set_hotspot_ip` succeed | nothing. It is a **restart** |
| `factory_reset` | `{"settings":{"factory_reset":1,"device_wakeup":1}}` | the Factory Reset button on the settings card, then its confirm | the only one of the three that claims to erase all data |

Ascending order of destruction is **INFERENCE** from dialog copy and code path. The
artifact supports it and does not prove it. Firing them in order with a read between each turns
the inference into measurement.

### ⚠ `rgb_reset` DOES NOTHING IN MUSIC MODE ⚠

**FACT.** The `rgb_reset` path carries a guard ahead of its send: when the selected mode
is Music, it returns before transmitting.

In Music mode the sliders repaint locally and **nothing is sent to the device**. The
config read after would show no change, which looks exactly like "the command had no
effect" when in fact no command was issued.

**Be in H2D mode before firing rgb_reset.**

### The ladder

Mark and save at every rung. Do not skip a read.

| # | Action | Mark | Done |
|---|---|---|---|
| 1 | **Config read A**, baseline before any reset | `reset-ladder-A-baseline` | [ ] |
| 2 | Confirm H2D mode is selected | `reset-ladder-h2d-confirmed` | [ ] |
| 3 | Fire **`rgb_reset`** | `reset-ladder-fire-rgb_reset` | [ ] |
| 4 | **Config read B** | `reset-ladder-B-after-rgb_reset` | [ ] |
| 5 | Fire **`reset`** | `reset-ladder-fire-reset` | [ ] |
| 6 | **Config read C** (after it comes back up) | `reset-ladder-C-after-reset` | [ ] |
| 7 | Fire **`factory_reset`** | `reset-ladder-fire-factory_reset` | [ ] |
| 8 | **Config read D** | `reset-ladder-D-after-factory_reset` | [ ] |

### What each diff answers

**A vs B** — what `rgb_reset` actually touches. If only lighting fields move, the
lighting defaults are established **without having wiped Wi-Fi**, and Gate 3's lighting
half is answered while the session is still alive. This is the whole reason the ladder
exists.

Fields to check moved or did not: `list2[].brightness`, `list2[].rgb_rgba`,
`list2[].speed`, `current_mode`. Fields that must **not** move if the command is
lighting-only: `wifi`, `ap`, `printer`, `sta.hostname`, `settings.language`.

**B vs C** — whether `reset` preserves configuration. Expect no field changes and a
reconnect. If configuration moves across a `reset`, the name is wrong and that is a
significant finding.

**C vs D** — what `factory_reset` erases beyond what `rgb_reset` already did. This is
the total-versus-partial answer.

### Reboot handling, rungs 5 and 7

Both `reset` and `factory_reset` are expected to restart the device.

- The socket will close. **The reload dialog will appear. DO NOT CLICK OK.**
  `__wsCap.save()` first, then deal with it.
- The logger's last frames before the close may hold applied values. **Do not clear
  those files.**
- After `factory_reset` the device is expected to drop Wi-Fi and come back in AP mode.
  If config read D is impossible on the same connection, re-onboard at step 11 first and
  take read D after, marking it `reset-ladder-D-after-reonboard`.

Have the Wi-Fi credentials to hand **before rung 7**.

### Reference: the UI's client-side reset expectations

```
brightness[0] Music = 50      color[0] idle     = #FFFFFF
brightness[1] H2D   = 50      color[1] printing = #FFFFFF
speed[1]      H2D   = 100     color[2] error    = #FF0000
```

**UI values, not compiled-in firmware defaults.** If the device reports something
different, the device wins and the difference is the finding. Gate 3 compares against
what the device reports, never against this table.

## 11. Re-onboard

Have the credentials to hand **before** step 11. Anything recovered goes into
`private/secrets/` and into `forbidden-strings.txt`.

---

# PRE-FLIGHT ANNEX

Read before the session. Both lists are derived from the device's own UI file,
sha256 `3837146860e8e7f5...`, comment-aware. FACT means read directly out of the file.

## A. Controls that produce NO wire traffic

Every entry here is a place where the capture would record "I did X, nothing happened"
when the truth is "X was never sent". Verified by stripping JS comments and re-running
the call-site enumeration, then diffing against the naive scan.

### A1. Dead controls: the send is commented out entirely

**FACT.** Three call sites exist only inside comment blocks. They never execute.

| Control | Would have sent | Reality |
|---|---|---|
| RGB on/off checkbox | `settings.rgb_info_mode` + `on` | **handler body commented out** |
| Follow checkbox | `settings.rgb_info_mode` + `follow` | **handler body commented out** |
| Printing UI type select | `settings.printing_ui_type` | **send commented out**; the handler computes an index and discards it |

**Consequence: `settings.on`, `settings.follow` and `settings.printing_ui_type` are
never sent by this UI.** All three are still handled *inbound*, so the firmware may emit
them, but nothing in the browser can set them.

This corrects `docs/protocol-websocket.md` as first written. The original enumeration
regex-matched inside comments and listed all three as live outbound messages. They are
not.

Practical effect: toggling those checkboxes or changing the printing UI type will look
like a no-op in the capture, because it is one.

### A2. Guards that suppress a live send

| Control | Guard | Effect |
|---|---|---|
| Reset Settings, RGB card | returns when the selected mode is Music, ahead of the send | **FACT.** In Music mode `rgb_reset` is never sent. Covered at step 10. |
| Wi-Fi Connect button | returns when nothing is selected in the network list | **FACT.** Pressing Connect with no scanned network list sends nothing. Scan first. |
| Mode select (Music / H2D) | sends only when the chosen value resolves against the mode list | **FACT.** With the two shipped options it will resolve, so this should not bite. |

### A3. Sends that require a confirmation click first

Not suppression, but the wire traffic is deferred until a second click. If the dialog is
dismissed or cancelled, nothing is sent.

| Control | Sends on confirm |
|---|---|
| AP toggle, **turning OFF only** | `ap.on = 0` |
| AP settings confirm | `ap.ssid`, `password`, `ip` |
| Printer **unbind** | `printer.disconnect = 1` |
| Factory Reset | `settings.factory_reset = 1` |
| Reset Settings | `settings.rgb_reset = 1`, subject to A2 |

**FACT:** turning the AP **on** sends immediately with no dialog. Only turning it off
asks. The asymmetry is real.

### A4. Cosmetic bug, harmless but confusing in logs

**FACT.** The printer bind handler logs a console message whose text says no printer list
is present, but the condition it sits under is the opposite one.

The console line fires when a printer *is* selected. Ignore it; it does not indicate a
failure.

## B. Traffic that fires without you touching anything

Idle traffic measured at zero, so anything here would otherwise read as a
device-initiated state push when it is the page talking to itself.

### B1. Result: the page never speaks unprompted

**FACT**, all four verified against the live-code copy:

| Path | Sends? |
|---|---|
| page load: the seven initialisers it runs (asset load, language and card and page navigation, colour setup, socket init) | **No.** None of them is a sender. |
| socket open handler | **No.** Logs a line and nothing else. |
| the inbound dispatcher, whole body | **No.** Never invokes any sender. No echo, no ack, no auto-reply. |
| all three timer sites | **No.** A header text animation at 1700ms, and two scan counters at 1000ms. None sends. |
| document-level click and visibilitychange listeners | **No.** Neither sends. |

**So every frame in the `tx` direction is caused by a click.** If an unexplained `tx`
appears in the capture, it is not the page idling. Treat it as a finding.

### B2. The one send that can feel unprompted

**FACT.** The restart request sends `settings.reset = 1` and is wired **only** as the
OK handler of the dialog raised after `set_hostname` or `set_hotspot_ip` succeed.

Clicking OK on what looks like a success notification **sends a restart command**.
It is a click, so it belongs in A3, but it is the one place where dismissing a
notification is not a passive act. Worth knowing before hostname changes.

### B3. Unresolved, stated rather than papered over

During the first rig test on 2026-08-27 the capture recorded `tx: 1` shortly after
attaching, and I reported both directions as proven on that basis. That page later
navigated and the log was lost, so **that frame can no longer be examined.**

Given B1, no unprompted send path exists in the file. So either the frame came from an
interaction not accounted for, or the count was an artifact of the wrapper installed at
the time. **It is unexplained.**

Practical effect on the session: **do not treat outbound capture as proven until a
deliberate click produces a `tx` you can see.** Step 0b requires exactly that.

## C. How a config read is actually obtained

This sat under eight ladder rungs, so it was checked directly rather than assumed.

### C1. There is no request-side read command

**FACT.** All 15 live send call sites are setters or actions. There is no
`get`, `query`, `read`, `status` or `sync` command in the outbound surface. The UI never
asks for config; it only ever receives it.

`device_wakeup: 1` rides on every outbound message, but whether the firmware treats it
as a re-emit trigger is firmware behaviour and is **not** visible in this artifact.
Unverified either way.

### C2. What the device does emit

**FACT, measured.** The device pushes the full config on connect, all six roots
(`wifi`, `sta`, `ap`, `printer`, `settings`, `block`), to the connecting client.

**FACT, measured.** It does **not** broadcast to other connected clients. During three
external reads the browser's own socket received exactly **zero** frames.

### C3. The read mechanism: a second client, not a reconnect

**A read costs nothing. It does not touch the browser socket at all.**

```
python3 tools/ws_logger.py ws://<DEVICE_HOST>/ws -o <read-name>.jsonl
```

A fresh client connects, receives the connect-time push, and disconnects.

**Measured 2026-08-27, browser tab open and attached throughout three consecutive reads:**

| Check | Result |
|---|---|
| Browser socket state after | **OPEN** |
| `close` events seen by the browser | **0** |
| Reload dialog raised | **no** |
| Page navigation | **none**, `performance.now()` ran 9.7s to 54.4s unbroken |
| Window global and DOM probes | **both survived** |
| In-page capture object | **survived** |
| Frames the browser received during the reads | **0** |
| Full config returned to the reader | **yes, all 3, six roots each** |

**So the ladder does not cost eight socket cycles and the sheet does not have to handle
the dialog eight times. It handles it zero times.** The dialog only ever appears when
the *browser's own* socket closes, which reads never cause. It remains a live hazard at
rungs 5 and 7, where the device itself restarts.

### C4. Consequence for marks

Ladder reads land in the **logger's** files, not in the in-page capture, because the
browser sees nothing during them. So:

- Call `__wsCap.mark('reset-ladder-A-baseline')` in the browser **at the moment** you
  fire the external read, so the two timelines can be lined up afterwards.
- Give each read its own output filename. Do not append them all into one file.


## Sign-off

- [ ] Rig verified, attach mode, both `tx` and `rx` proven
- [ ] Config read #1, session start
- [ ] `img_version` recorded, or recorded as not emitted
- [ ] LED count recorded, with method
- [ ] **Write test: index 2 identity settled by observation, not by reading the source**
- [ ] Brightness sweep, both modes, 5 points each
- [ ] Speed sweep H2D, 5 points; Music slider confirmed disabled
- [ ] `list2[i].speed` discrepancy resolved either way
- [ ] Block model enumerated
- [ ] `ws_theme.preview` and `ws_theme.list` captured
- [ ] Stage order recorded as it happened, plus the list of slots that never fired
- [ ] Bar behaviour recorded per stage
- [ ] Error state captured or explicitly UNCAPTURED
- [ ] Reset ladder: reads A, B, C, D all captured
- [ ] H2D confirmed selected before `rgb_reset` fired
- [ ] A vs B diff recorded: what `rgb_reset` actually touches
- [ ] Redacted working copies made, raw files untouched
- [ ] Device back on Wi-Fi
- [ ] Recovered secrets in `forbidden-strings.txt`

Only then does Phase 0 step b, first USB contact, become discussable.

## Carried into Phase 0

- 15 GIF slots each get their own sha256 and their own `RESTORE.md` line.
- The img partition gets the three-read, two-must-agree rule, same as firmware.
- `img_version` must already be recorded before the dump starts.
- Per-stage bar colour is a **Phase 2 plus** idea. Recorded, not built.
