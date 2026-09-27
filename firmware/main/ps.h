/* PandaStatusOS, the Panda Status P2 clone: the one header every module shares.
 *
 * Interface facts (wire fields, roots, enums, endpoints, caps) are from
 * docs/protocol-websocket.md. Anything marked PROVISIONAL or INFERENCE is not a fact yet.
 * The parity rule: the wire behaviour is the factory's; every departure sits behind a
 * feature bit in ps_cfg_t.features that defaults to zero. */
#ifndef PS_H
#define PS_H
#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>

/* ---------------------------------------------------------------- enums, FACT ---- */
enum ps_sta_state     { PS_STA_NOSSID = 1, PS_STA_CONNECTING = 2, PS_STA_CONNECTED = 3, PS_STA_RECONNECTING = 4, PS_STA_PASSWORD = 5 };
enum ps_printer_state { PS_PRN_INVALID = 1, PS_PRN_CONNECTING = 2, PS_PRN_CONNECTED = 3, PS_PRN_IP_ERR = 4, PS_PRN_SN_ERR = 5, PS_PRN_ACCESS_CODE = 6, PS_PRN_UNKNOWN_ERR = 7 };
enum ps_printer_scan  { PS_PSCAN_IDLE = 0, PS_PSCAN_SCANNING = 1, PS_PSCAN_DONE = 2, PS_PSCAN_IP_CHANGE = 3, PS_PSCAN_SN_MISMATCH = 4, PS_PSCAN_IP_UNCHANGED = 5, PS_PSCAN_NEW_IP = 6 };
enum ps_wifi_scan     { PS_WSCAN_IDLE = 0, PS_WSCAN_SCANNING = 1, PS_WSCAN_DONE = 2 };
enum ps_mode          { PS_MODE_MUSIC = 0, PS_MODE_H2D = 1 };
enum ps_bar_state     { PS_BAR_IDLE = 0, PS_BAR_PRINTING = 1, PS_BAR_ERROR = 2 };

/* the fifteen stage animation slots, in the device's order, FACT */
#define PS_GIF_SLOTS 15
extern const char *const ps_gif_slot_names[PS_GIF_SLOTS];

/* upload caps per OTA-Type, FACT as constants, shared framework values, not layout evidence */
#define PS_CAP_OTA_FW   0x480000u
#define PS_CAP_OTA_IMG  0x6E0000u
#define PS_CAP_GIF      0x180000u

/* What settings.fw_version and /api/info report. The stock unit read V1.0.0 on
 * 2026-08-27 (docs/protocol-websocket.md, which keeps that number because it is a
 * record of the factory and not of this). This is 2.0.0 because none of the factory
 * application is in here: it is a reimplementation from the outside, and a version
 * that reads like the firmware it replaced would say the opposite. */
#define PS_FW_VERSION   "V2.0.0"

/* ---------------------------------------------------------- the stored config ---- */
/* Fixed-width members only, laid out so the host tests and the target agree on every
 * offset. When the layout changes: freeze THIS struct as ps_cfg_v1_t inside ps_cfg.c,
 * bump the magic, add an arm to the chain, extend the host test. Never let a frozen
 * struct reference a live type or a live count. */
#define PS_CFG_MAGIC_V1  0x50533031u   /* 'P' 'S' '0' '1': the first layout, 492 bytes, frozen in ps_cfg.c */
#define PS_CFG_MAGIC_V2  0x50533032u   /* 'P' 'S' '0' '2': v1 plus state_brightness, 500 bytes, frozen in ps_cfg.c */
#define PS_CFG_MAGIC_V3  0x50533033u   /* 'P' 'S' '0' '3': v2 plus the per-state effects, 572 bytes, frozen in ps_cfg.c */
#define PS_CFG_MAGIC_V4  0x50533034u   /* 'P' 'S' '0' '4': v3 plus the temperature fields and the two layers, 592 bytes, frozen in ps_cfg.c */
#define PS_CFG_MAGIC_V5  0x50533035u   /* 'P' 'S' '0' '5': v4 plus the device's friendly name */
#define PS_CFG_MAGIC     PS_CFG_MAGIC_V5

/* feature bits in ps_cfg_t.features. Every one defaults to 0 and leaves the device at
 * factory parity; docs/FEATURES.md is the table. */
#define PS_FEAT_BRIDGE            (1u << 0)   /* the vent bridge (ps_bridge.c, docs/PANDAVENT-BRIDGE.md) */
#define PS_FEAT_STATE_BRIGHTNESS  (1u << 1)   /* A1: one brightness per bar state instead of one per mode */
#define PS_FEAT_STATE_EFFECTS     (1u << 2)   /* A2: an effect per bar state in H2D, in the state's colour */
#define PS_FEAT_EFFECT_COLOURS    (1u << 3)   /* A3, reserved: the effect's own four colours */
#define PS_FEAT_EFFECT_PARAMS     (1u << 4)   /* A4, reserved: the effect's own brightness, speed, direction */
#define PS_FEAT_EFFECT_RAMP       (1u << 5)   /* A5: the brightness ramp */
#define PS_FEAT_FX_PROGRESS       (1u << 6)   /* A6: the progress bar effect may be chosen */
#define PS_FEAT_FX_PROGRESS_ANIM  (1u << 7)   /* A7: the animated progress effect */
#define PS_FEAT_FX_BARBER         (1u << 8)   /* A8: the barber pole, with its band width */
#define PS_FEAT_FX_HUE_RAMP       (1u << 9)   /* A9: the colour ramp across the print */
#define PS_FEAT_FX_TEMP           (1u << 10)  /* A10: the temperature gradient may be chosen */
#define PS_FEAT_HOT_WARNING       (1u << 11)  /* A11, reserved: the hot warning layer */
#define PS_FEAT_ERROR_FLASH       (1u << 12)  /* A12: the error flash layer */
#define PS_FEAT_PREVIEW           (1u << 13)  /* A13: the live preview route, a pinned printer state */
#define PS_FEAT_PRESETS           (1u << 14)  /* A14: the named effects and the two palette effects */
#define PS_FEAT_STAGE_EFFECTS     (1u << 15)  /* B1, B2: an effect per print stage, inheriting the bar state's */
#define PS_FEAT_CONFIG_IO         (1u << 16)  /* C3: settings export and import as one JSON document */
#define PS_FEAT_RESTART           (1u << 17)  /* C4: a plain restart, named what it is, on its own route */
#define PS_FEAT_AUTO_REBIND       (1u << 18)  /* C7: after the bound printer moves, find it again by serial */
#define PS_FEAT_DIAGNOSTICS       (1u << 19)  /* C8: why it is not working, blinked on the bar */
#define PS_FEAT_STATIC_IP         (1u << 20)  /* C9: a fixed address on the house network instead of DHCP */
#define PS_FEAT_BAR_FLIP          (1u << 21)  /* D1: the bar is drawn the other way round, for a unit mounted upside down */
/* Every switch bit defined above, bit 0 included now that ps_bridge.c stands behind it (it
 * was masked out while nothing did). Derived from the highest one rather than written out,
 * because it was written out: C9 took bit 20 and the mask stayed at bit 19, so
 * ps_config_apply() refused any settings file exported from a device with the fixed address
 * switched on. The import is all-or-nothing, so one bit outside the mask threw away the whole
 * document. Move PS_FEAT_LAST when the next bit is taken and the mask follows; cfg_test.c
 * fails if it does not. */
#define PS_FEAT_LAST              PS_FEAT_BAR_FLIP
#define PS_FEAT_KNOWN             (PS_FEAT_LAST | (PS_FEAT_LAST - 1u))

/* which of the printer's temperatures a feature follows (INFERENCE: the report's
 * nozzle_temper, bed_temper and chamber_temper, the fields the vent reads) */
enum ps_temp_src { PS_TEMP_NOZZLE = 0, PS_TEMP_BED, PS_TEMP_CHAMBER, PS_TEMP_COUNT };
#define PS_TEMP_NONE  (-1000)          /* no reading yet; below any cold end, so a gradient holds its cold colour */
#define PS_TEMP_MAX   500              /* the ends and thresholds are bounded here, degrees C */

typedef struct { uint8_t r, g, b, a; } ps_rgba_t;

/* ---- the effects (ps_fx.c). Ids are this project's; the engine is Jeremy's, from the vent. ---- */
enum ps_fx {
    PS_FX_STATIC = 0, PS_FX_BREATHING, PS_FX_STROBING, PS_FX_WAVE, PS_FX_MARQUEE, PS_FX_HUE_CYCLE, PS_FX_RAINBOW,
    PS_FX_CYLON, PS_FX_BOUNCE, PS_FX_MARQUEE_OUT, PS_FX_MARQUEE_IN, PS_FX_FILL_OUT, PS_FX_FILL_IN,
    PS_FX_BOUNCE_OUT, PS_FX_BOUNCE_IN, PS_FX_BOUNCE_FILL_OUT, PS_FX_BOUNCE_FILL_IN,
    PS_FX_PROGRESS, PS_FX_PROGRESS_ANIM, PS_FX_BARBER, PS_FX_TEMP_GRADIENT,
    PS_FX_PROGRESS_HUE,
    PS_FX_PALETTE, PS_FX_PALETTE_SCROLL,   /* A14: the four colours as stops across the strip, still and scrolling */
    PS_FX_COUNT
};
#define PS_FX_SELECTABLE 17    /* A2 offers ids 0..16, the ones that need no live input; the rest arrive with their features */
bool ps_fx_allowed(uint32_t features, int fx);   /* may this effect be chosen under these bits? */
/* A4, kept inside the progress. The three effects that draw the print's progress already fill only
 * that part, so the option means nothing to them. The span is the part a print has filled, the
 * way those three draw it: from pixel 0 up, or down from the far end when the effect runs
 * backwards; percent is clamped to 0..100 and a missing one (negative) fills nothing. */
bool ps_fx_draws_progress(int fx);
void ps_fx_progress_span(int percent, int n, bool reverse, int *off, int *len);
/* O1: may this effect run on the unfilled part? Anything that does not draw the progress,
 * under its own switch; a second progress bar on the part the progress has not reached is
 * not a thing. */
bool ps_fx_unlit_ok(int fx);
void ps_fx_fill(ps_rgba_t *px, int n, ps_rgba_t colour, uint8_t bright100);   /* one colour, scaled */
/* A11: a layer over whatever the base rendered, pure in time: one colour pulsing in and out
 * on a fixed period, at its own brightness. At the trough the base shows untouched; at the
 * peak the strip is the colour. */
void ps_fx_layer_pulse(ps_rgba_t *px, int n, ps_rgba_t colour, uint8_t bright100, uint32_t now_ms, uint32_t period_ms);
/* A12: a strobe over the base, pure in time: hard on (the strip is the colour at its brightness)
 * for one half period, hard off (the base untouched) for the next. Returns whether it is on. */
bool ps_fx_layer_strobe(ps_rgba_t *px, int n, ps_rgba_t colour, uint8_t bright100, uint32_t now_ms, uint32_t half_ms);

#define PS_FX_RAMP_STEPS 100

/* one effect's stored parameters; the vent's model. Which fields are read depends on the
 * feature bits: A2 reads effect; A3 the colours; A4 brightness, speed and the reverse bit;
 * A5 bright_end. Everything else stays the factory's. */
#define PS_FX_OPT_BG_PRINTING  0x01   /* colour[2] is set: the inactive colour while printing */
#define PS_FX_OPT_BG_IDLE      0x02   /* colour[3] is set: the inactive colour while not printing */
#define PS_FX_OPT_RAMP         0x04   /* bright_end is set */
#define PS_FX_OPT_AUX          0x08   /* aux is set (the pole's band width, for the effects that read it) */
#define PS_FX_OPT_REVERSE      0x10   /* this effect runs the other way round */
#define PS_FX_OPT_IN_PROGRESS  0x20   /* this effect runs inside the printed part of the bar only (A4) */
#define PS_FX_OPT_ALL          0x3F   /* every opt bit this build knows; anything above is refused */
/* flags: what has been decided about this entry, as opposed to what it is set to. A blob
 * written before the kept-inside option existed carries opt without 0x20 and no way to tell
 * "turned off" from "never offered"; the flag is the way. It is set when the option's default
 * is applied on load and whenever the page writes opt, so the default lands once (O2) and a
 * choice to turn it off is kept. */
#define PS_FX_FLAG_INPROG_SET  0x01
typedef struct {
    uint8_t   effect;                  /* enum ps_fx */
    uint8_t   brightness;              /* 0..100 */
    uint8_t   speed;                   /* 0..100 */
    uint8_t   bright_end;              /* 0..100, the ramp's end */
    uint8_t   opt;                     /* PS_FX_OPT_* */
    uint8_t   aux;
    uint8_t   fx_unlit;                /* O1: the effect on the part the print has not filled, while this one is kept
                                          inside the progress or draws it; any effect that does not draw the progress,
                                          in the unlit colour. Was padding, so every stored blob reads 0, which is solid. */
    uint8_t   flags;                   /* PS_FX_FLAG_*; was padding, so every stored blob reads 0 */
    ps_rgba_t colour[4];               /* active printing, active not printing, inactive printing, inactive not printing */
} ps_fx_cfg_t;                         /* 24 bytes */

/* the engine's live inputs; a negative reading means none */
typedef struct { int percent; int temp_c; int temp_lo; int temp_hi; } ps_fx_in_t;

/* every effect's animation phase, owned by whoever renders; ps_fx_phase_init() before the first frame */
typedef struct {
    float breath_phase, breath_step; bool strobe_on;
    float marquee_pos, bounce_pos, bounce_dir, cylon_pos, cylon_dir;
    float split_pos, fill_pos, sbounce_pos, sbounce_dir, sfill_pos, sfill_dir;
    float progress_shown, wave_pos, cycle_hue, rainbow_phase;
    int   chase_pos, anim_breath, barber_pos, ramp_step;
    float palette_pos;                  /* A14: the scrolling palette's offset, 0..1 of the strip */
} ps_fx_phase_t;

uint32_t ps_fx_period(uint8_t speed);                              /* ms per frame for this speed */
void     ps_fx_phase_init(ps_fx_phase_t *p);
/* How many pixels one of the three progress effects has lit this frame, from its own eased
 * fill, so the unfilled part's effect starts where the fill stops rather than a pixel off. */
int      ps_fx_progress_lit(const ps_fx_phase_t *p, int fx, int n);
/* A14: the palette effects: the stops laid across the strip piecewise-linear (PS_FX_PALETTE), or
 * wrapped round and scrolling (PS_FX_PALETTE_SCROLL); one stop is a solid, none is dark */
uint32_t ps_fx_render_palette(int fx, const ps_rgba_t *stops, int nstops, uint8_t bright100, uint8_t speed, bool reverse,
                              ps_fx_phase_t *p, ps_rgba_t *px, int n);
uint8_t  ps_fx_ramp(ps_fx_phase_t *p, uint8_t bright, int bright_end);   /* bright_end < 0: no ramp */
/* fills px[0..n-1], advances the phase once, returns the ms to wait before the next frame */
/* D1: the finished frame, end for end, in place.
 *
 * This is the master flip, and it is applied to the FRAME rather than passed into the engine
 * on purpose. Every effect's own direction is a coordinate flip inside the render, so flipping
 * the output of one composes with it exactly as exclusive-or: an effect already running
 * backwards on a bar that is mounted upside down comes out running forwards, and neither of
 * the two silently wins. It also catches what the engine never sees, which is the placeholder
 * fill, the diagnostic pattern and both layers.
 *
 * The bar has an odd number of pixels, so the middle one stays where it is. fx_test.c pins
 * both that and the composition. */
void ps_fx_flip(ps_rgba_t *px, size_t n);

uint32_t ps_fx_render(int fx, ps_rgba_t colour, ps_rgba_t bg, uint8_t bright100, uint8_t speed, bool reverse,
                      int band, const ps_fx_in_t *in, ps_fx_phase_t *p, ps_rgba_t *px, int n);
#define PS_CFG_NVS_NS    "ps"
#define PS_CFG_NVS_KEY   "cfg"
#define PS_BLOCKS_MAX    15            /* PROVISIONAL: the block list's true bound is a bench fact */


typedef struct {                       /* one lighting mode: settings.list2[mode] */
    uint8_t   brightness;              /* 0..100 step 5 */
    uint8_t   speed;                   /* 0..100 step 5, H2D only */
    uint8_t   _pad[2];
    ps_rgba_t colour[3];               /* idle, printing, error */
} ps_mode_cfg_t;

typedef struct {                       /* one block: {blockID, blockrgba} */
    uint8_t   id;
    uint8_t   _pad[3];
    ps_rgba_t colour;
} ps_block_cfg_t;

typedef struct {
    uint32_t  magic;                   /* PS_CFG_MAGIC, first, always */
    uint32_t  features;                /* feature bits, every one defaulting to 0: factory parity */
    char      wifi_ssid[33];
    char      wifi_password[65];
    char      ap_ssid[33];
    char      ap_password[65];
    char      hostname[33];
    char      printer_name[33];
    char      printer_sn[33];
    char      printer_access_code[17];
    char      language[8];
    uint8_t   ap_ip[4];
    uint8_t   printer_ip[4];
    uint8_t   ap_on;
    uint8_t   current_mode;            /* enum ps_mode */
    uint8_t   block_count;
    uint8_t   _pad0;
    ps_mode_cfg_t   mode[2];
    ps_block_cfg_t  block[PS_BLOCKS_MAX];
    /* ---- v2, PS02: the Phase A fields. Each is read only while its feature bit is set,
     * so a default blob and a migrated blob both leave the device at parity. ---- */
    uint8_t   state_brightness[2][3];  /* A1: [mode][bar state], 0..100 */
    uint8_t   _pad1[2];
    /* ---- v3, PS03 ---- */
    ps_fx_cfg_t fx[3];                 /* A2 to A5: the effect per bar state, H2D */
    /* ---- v4, PS04: the temperature gradient's inputs and the two layers' settings. Laid
     * down together so A10 to A12 share one migration; each is read only under its bit. ---- */
    int16_t   temp_lo, temp_hi;        /* A10: the gradient's ends, degrees C */
    uint8_t   temp_src;                /* A10: enum ps_temp_src, the reading the gradient follows */
    uint8_t   hot_src;                 /* A11: enum ps_temp_src, the reading the hot warning watches */
    int16_t   hot_c;                   /* A11: the threshold, degrees C */
    ps_rgba_t hot_colour;              /* A11: the layer's colour */
    ps_rgba_t err_colour;              /* A12: the error flash's colour */
    uint8_t   err_brightness;          /* A12: 0..100 */
    uint8_t   err_speed;               /* A12: the strobe rate as the engine's speed, 0..100 */
    uint8_t   temp_unit;               /* O6: what the page shows temperatures in, PS_UNIT_*; the device itself only ever
                                          holds degrees C. Was padding, so every stored blob reads 0, which is Celsius. */
    uint8_t   _pad2;
    /* ---- v5, PS05: the friendly name (D-060). What the bar above the page and the vent
     * bridge call this unit; a label, not an address. The hostname above is the network's
     * name for it and stays what it was: the two are different things, and saving a label
     * must never rename a device on the network or restart it. Empty means the default
     * (ps_device_name() says which), so a fresh blob and a migrated one both read
     * "Panda Status" without carrying the string. ---- */
    char      device_name[33];         /* UTF-8, cut at a character boundary, no control characters */
    uint8_t   _pad3[3];
} ps_cfg_t;
#define PS_UNIT_C 0
#define PS_UNIT_F 1
#define PS_DEVICE_NAME_DEFAULT "Panda Status"

/* the whole blob and its NVS budget; both pinned in ps_cfg.c and in the host test */
#define PS_CFG_SIZE      628
#define PS_CFG_NVS_BUDGET 2048

/* A14: the named effects, a second blob under the same namespace with its own magic and
 * size, so the config layout does not move for them. Eight presets of forty bytes each. */
#define PS_PRESETS_NVS_KEY "presets"
#define PS_PRESETS_MAGIC   0x50535031u   /* 'P' 'S' 'P' '1' */
#define PS_PRESETS_MAX     8
#define PS_PRESET_NAME     16            /* fifteen characters and the terminator */
typedef struct { char name[PS_PRESET_NAME]; ps_fx_cfg_t fx; } ps_preset_t;                                          /* 40 bytes */
typedef struct { uint32_t magic; uint8_t count; uint8_t _pad[3]; ps_preset_t p[PS_PRESETS_MAX]; } ps_presets_t;    /* 328 bytes */
#define PS_PRESETS_SIZE    328
int  ps_presets_load(ps_presets_t *s);   /* the stored list, or an empty one; never fails the boot */
int  ps_presets_save(const ps_presets_t *s);
void ps_presets_clamp(ps_presets_t *s);

/* B1, B2: an effect per print stage, in its own blob. A row that is not set inherits the bar
 * state's effect; a set row is a state_effects entry with the name it was assigned from. */
/* C9: the fixed address, its own blob under the same namespace with its own magic and size,
 * so ps_cfg_t does not move and needs no fifth migration arm. Every field is stored whether
 * the switch is on or not, so turning it off and on again does not lose what was typed. */
#define PS_NETCFG_NVS_KEY  "netcfg"
#define PS_NETCFG_MAGIC    0x50534e31u   /* 'P' 'S' 'N' '1' */
typedef struct {
    uint32_t magic;
    uint8_t  on;                 /* use these instead of DHCP */
    uint8_t  _pad[3];
    uint8_t  ip[4], mask[4], gw[4], dns[4];
} ps_netcfg_t;                                                                        /* 24 bytes */

int  ps_netcfg_load(ps_netcfg_t *s);     /* the stored address, or an empty one; never fails the boot */
int  ps_netcfg_save(const ps_netcfg_t *s);
void ps_netcfg_clamp(ps_netcfg_t *s);
/* Hand the running STA interface the stored address, or put it back on DHCP. Called once the
 * interface exists and again whenever the setting changes; the change takes effect on the
 * next association, which the caller triggers. */
void ps_wifi_apply_netcfg(void);

/* Bit 0: the vent binding (docs/PANDAVENT-BRIDGE.md), its own blob under the same namespace.
 * A device binds to an identity, never to an address: `id` is the bind once the vent has said
 * who it is, `host` is what was typed to reach it the first time, and `ip` is the last address
 * it answered at, tried after mDNS has been asked and before giving up. The token is what
 * pairing produced; it is never shown by /api/bridge and never exported by /api/config, so a
 * settings file carries the switch but not the pairing, which has to be done again in person. */
#define PS_BRIDGE_NVS_KEY  "bridge"
#define PS_BRIDGE_MAGIC    0x50534231u   /* 'P' 'S' 'B' '1' */
typedef struct {
    uint32_t magic;
    uint8_t  bound;              /* a vent is bound: host, id or ip below says where */
    uint8_t  paired;             /* token holds what pairing produced */
    uint8_t  _pad[2];
    char     id[17];             /* the vent's identity, 16 hex; "" until it has said */
    char     name[33];           /* what it calls itself, from its hello */
    char     host[64];           /* what was typed: a name or an address */
    char     token[65];          /* 64 hex */
    uint8_t  ip[4];              /* the last address it answered at, 0.0.0.0 for none */
} ps_bridge_cfg_t;                                                                    /* 192 bytes */
#define PS_BRIDGE_SIZE     192
int  ps_bridge_cfg_load(ps_bridge_cfg_t *s);   /* the stored binding, or none; never fails the boot */
int  ps_bridge_cfg_save(const ps_bridge_cfg_t *s);
void ps_bridge_cfg_clamp(ps_bridge_cfg_t *s);

#define PS_STAGES_NVS_KEY  "stages"
#define PS_STAGES_MAGIC    0x50535331u   /* 'P' 'S' 'S' '1' */
typedef struct { uint8_t set; uint8_t _pad[3]; char name[PS_PRESET_NAME]; ps_fx_cfg_t fx; } ps_stage_row_t;   /* 44 bytes */
typedef struct { uint32_t magic; ps_stage_row_t row[PS_GIF_SLOTS]; } ps_stages_t;                             /* 664 bytes */
#define PS_STAGES_SIZE     664
int  ps_stages_load(ps_stages_t *s);     /* the stored rows, or none set; never fails the boot */
int  ps_stages_save(const ps_stages_t *s);
void ps_stages_clamp(ps_stages_t *s);

/* what to render this frame, from the config and the live state, honouring every feature
 * bit (A1 to A5); fx < 0 means the placeholder in the state's colour. Pure, in ps_fx.c,
 * host-tested. */
typedef struct { int fx; ps_rgba_t colour, bg; uint8_t brightness, speed; bool reverse; int bright_end; int band;
                 ps_rgba_t stops[4]; int nstops;
                 bool in_progress; int fx_unlit; } ps_fx_pick_t;
                 /* stops: the palette effects' colours, in order (A14); in_progress: draw inside the
                    printed part only, which is only ever so while a job is on (A4); fx_unlit: the
                    effect on the unfilled part then, or beside one of the three progress draws while
                    a job is on, in the unlit colour, -1 for the plain fill (O1) */
void ps_fx_resolve(const ps_cfg_t *c, uint8_t mode, uint8_t st, bool job_active, ps_fx_pick_t *out);
/* the same with a per-stage row (B1, B2): a set row replaces the state's entry while bit 15 is on;
 * NULL or an unset row inherits the state's, which is what the plain resolve does */
void ps_fx_resolve_stage(const ps_cfg_t *c, uint8_t mode, uint8_t st, bool job_active, const ps_stage_row_t *row, ps_fx_pick_t *out);
/* INFERENCE: the print stage as one of the fifteen display slots, from the report's gcode_state
 * and stg_cur; pure, host-tested; the MQTT capture corrects its table */
uint8_t ps_stage_from_report(const char *gcode_state, int stg_cur);

/* ---------------------------------------------------------- the live state ---- */
typedef struct { char ssid[33]; int8_t rssi; } ps_wifi_hit_t;          /* INFERENCE shape */
/* INFERENCE shape. `sn` is the clone's own: the wire's printer.list carries name and ip only
 * (parity), and the serial is used inside the device to match a moved printer (C7). */
typedef struct { char name[33]; char ip[16]; char sn[33]; char model[16]; } ps_printer_hit_t;   /* model: the code the printer announces, e.g. N7 */

/* C7: what a rebind scan concluded. The numbers are the wire's own printer.scan states
 * (4 sn not matched, 5 ip not changed, 6 new ip applied), so the page needs nothing new. */
/* A printer's own SSDP announcement, read into a hit. Pure, in ps_ssdp.c, host-tested.
 * Returns 1 and fills out when the datagram is a live Bambu 3D printer announcement carrying
 * an address, 0 otherwise. Established by listening on a real network, not from a document:
 * multicast 239.255.255.250, UDP 2021, NT urn:bambulab-com:device:3dprinter:1. */
int ps_ssdp_parse_printer(const char *buf, size_t len, ps_printer_hit_t *out);
void ps_printer_discover_start(void);   /* the always-on listener for those announcements */
bool ps_printer_model_of(const char *sn, char *out, size_t n);   /* the code that serial announced, if heard */
#define PS_SSDP_GROUP  "239.255.255.250"
#define PS_SSDP_PORT   2021        /* where both units were observed announcing */
#define PS_SSDP_PORT2  1990        /* what their own Host header claims; listened to as well */

enum ps_rebind { PS_REBIND_NO_MATCH = PS_PSCAN_SN_MISMATCH, PS_REBIND_UNCHANGED = PS_PSCAN_IP_UNCHANGED, PS_REBIND_MOVED = PS_PSCAN_NEW_IP };
/* pure, in ps_rebind.c, host-tested: which of the three a scan's hits amount to, and where to */
int ps_rebind_decide(const char *bound_sn, const uint8_t bound_ip[4], const ps_printer_hit_t *hits, int n, uint8_t out_ip[4]);
#define PS_REBIND_AFTER_FAILS 3        /* consecutive transport failures before a rebind scan is worth running */

/* One AMS tray, as print.ams.ams[].tray[] describes it. Kept in the live state only, never
 * stored: it is what the printer is doing, not a setting. */
#define PS_TRAYS_MAX 4
typedef struct {
    int8_t    id;              /* the tray's own index, 0..3 */
    int8_t    remain;          /* percent left, -1 when the printer does not say */
    uint8_t   empty;           /* O7: the slot is there and holds nothing (the exist bit clear, or nothing described) */
    uint8_t   has_colour;
    ps_rgba_t colour;
    char      type[12];        /* PLA, PETG, ABS ... */
    char      sub[20];         /* the variant, when there is one */
} ps_tray_t;

typedef struct {
    ps_cfg_t cfg;                      /* the stored part */
    /* sta */
    uint8_t  sta_state;                /* enum ps_sta_state */
    uint8_t  auth_err_reason;          /* the device sends it; meaning unknown */
    char     sta_ip[16];
    /* wifi scan */
    uint8_t  wifi_scan;                /* enum ps_wifi_scan */
    uint8_t  wifi_hits;
    ps_wifi_hit_t wifi_list[16];
    /* printer */
    uint8_t  printer_state;            /* enum ps_printer_state */
    uint8_t  printer_scan;             /* enum ps_printer_scan */
    uint8_t  printer_hits;
    ps_printer_hit_t printer_list[8];
    uint8_t  bar_state;                /* enum ps_bar_state, driven by the printer */
    uint8_t  job_active;               /* INFERENCE: a job is running, preparing or paused; the printing/not-printing crossing for A3's colours */
    int16_t  print_percent;            /* INFERENCE: print.mc_percent from the report, -1 until one arrives; the progress effects' input */
    int16_t  temp_c[PS_TEMP_COUNT];    /* INFERENCE: nozzle_temper, bed_temper, chamber_temper from the report, PS_TEMP_NONE until one arrives */
    /* What the print IS, beyond how far through it is. The bar never needed these: the
     * effects read a percentage and a stage and nothing else. The page does, because a
     * strip that says 37% and nothing else does not say what is printing. All INFERENCE
     * from the same report the percentage comes from, and each carries its own "none". */
    char     job_name[64];             /* print.subtask_name, empty until one arrives */
    int16_t  layer_num;                /* print.layer_num, -1 until one arrives */
    int16_t  layer_total;              /* print.total_layer_num, -1 until one arrives */
    int32_t  remain_min;               /* print.mc_remaining_time, minutes, -1 until one arrives */
    int8_t   spd_lvl;                  /* print.spd_lvl, 1..4, -1 until one arrives */
    /* print.lights_report: the printer names each light and its mode. 1 on, 0 off, -1 while
     * the printer has never mentioned it, which is not the same as off and is not shown as
     * off. A printer with no work light simply never names one. */
    int8_t   light_chamber;
    int8_t   light_work;
    /* The rest of what the same report says, kept so the Printer card has something to show.
     * Every one of these is -1 (or an empty string) until the printer has actually sent it,
     * and an absent key in a partial report leaves the last value alone. */
    int8_t   fan_part, fan_aux, fan_chamber;     /* percent, 0..100 */
    int8_t   filament_in;                        /* the external spool sensor */
    int8_t   door_open;                          /* O8: -1 unknown, 0 shut, 1 open; home_flag bit 23 */
    int8_t   ams_units;                          /* O7: how many AMS units the printer describes, -1 until it has said */
    int8_t   ams_humidity;                       /* the AMS's own 1..5 level */
    int8_t   ams_humidity_pct;                   /* a real relative humidity, when the unit sends one; -1 otherwise */
    int16_t  ams_temp_c;
    /* The first AMS unit's four trays, as the printer reports them: every slot it describes,
     * an empty one flagged as empty (O7) so the page can say so rather than leave a gap. A
     * field it leaves out of a tray it does describe is empty, and the page draws empty as
     * unknown rather than as zero. tray_now is the one loaded, -1 when the printer names
     * none. */
    ps_tray_t trays[PS_TRAYS_MAX];
    int8_t   tray_count;
    int8_t   tray_now;
    char     gcode_state[12];                    /* IDLE, RUNNING, PAUSE, FINISH, FAILED, PREPARE */
    char     hms_code[20];                       /* the first fault the printer is reporting */
    char     printer_rssi[10];                   /* the printer's own signal, as it words it */
    char     nozzle_type[16];
    char     nozzle_dia[8];
    /* A13: a pinned printer state the renderer reads instead of the live one while the pin
     * is live (bit 13). Nothing here is stored; the live state is untouched underneath. */
    uint8_t  pin_active;
    uint8_t  pin_state;                /* enum ps_bar_state */
    int16_t  pin_percent;              /* -1 for none */
    int16_t  pin_temp[PS_TEMP_COUNT];  /* PS_TEMP_NONE where the pin gives none: the live reading shows through */
    int64_t  pin_until_us;             /* esp_timer time the pin expires */
    ps_presets_t presets;              /* A14: the named effects, loaded at boot */
    ps_stages_t  stages;               /* B1, B2: the per-stage rows, loaded at boot */
    ps_netcfg_t  netcfg;               /* C9: the fixed address, loaded at boot */
    uint8_t  stage;                    /* INFERENCE: the current print stage as a display slot 0..14 (ps_stage_from_report) */
    int16_t  stg_cur;                  /* INFERENCE: print.stg_cur from the report, -1 until one arrives */
    int8_t   pin_stage;                /* B3: the pinned stage while the pin is live, -1 for none */
    /* images */
    char     img_version[16];          /* empty until an image pack says otherwise */
} ps_state_t;

/* roots, as a mask for "what changed" */
#define PS_ROOT_WIFI     (1u << 0)
#define PS_ROOT_STA      (1u << 1)
#define PS_ROOT_AP       (1u << 2)
#define PS_ROOT_PRINTER  (1u << 3)
#define PS_ROOT_SETTINGS (1u << 4)
#define PS_ROOT_BLOCK    (1u << 5)
#define PS_ROOT_ALL      0x3Fu

extern ps_state_t g_ps;                /* guarded by ps_lock()/ps_unlock() */
void ps_lock(void);
void ps_unlock(void);

/* ---------------------------------------------------------------- ps_cfg.c ---- */
void ps_cfg_factory_defaults(ps_cfg_t *c);   /* writes through c ONLY; touches no global */
void ps_cfg_clamp(ps_cfg_t *c);              /* after load: indices and ranges read from flash */
/* The friendly name (v5). set: empty or "default" clears it, anything else is copied cut
 * at 32 bytes on a UTF-8 boundary with control characters dropped and the ends trimmed;
 * touches c ONLY, saves nothing. get: what to show, the stored name or the default. */
void ps_cfg_set_device_name(ps_cfg_t *c, const char *v);
const char *ps_cfg_device_name(const ps_cfg_t *c);
int  ps_cfg_load(ps_cfg_t *c);               /* defaults first, then overlay from NVS; 0 ok */
int  ps_cfg_save(const ps_cfg_t *c);         /* 0 ok */
int  ps_cfg_erase(void);                     /* factory_reset */
/* colour as the wire carries it: mode 0 "RRGGBB", mode 1 "#RRGGBBAA" (FACT); out >= 10 bytes */
void ps_rgba_to_wire(ps_rgba_t c, uint8_t mode, char *out);
bool ps_rgba_from_wire(const char *s, ps_rgba_t *out);   /* accepts both forms, any case */

/* -------------------------------------------------------------- ps_state.c ---- */
void  ps_state_init(void);
char *ps_state_json(uint32_t roots);         /* the document for these roots; caller frees */
/* apply one inbound frame; returns the roots that changed (0 = nothing to push),
 * and may queue a response through ps_ws_response() */
uint32_t ps_state_apply(const char *json, size_t len, int client);

/* ----------------------------------------------------------------- ps_ws.c ---- */
int  ps_ws_start(void);
void ps_ws_push(uint32_t roots, int client);         /* client < 0: every client */
bool ps_ws_alive(uint32_t within_ms);                /* did the server run a queued ping in time? (the guard) */
void ps_ws_feed(void);                               /* a long transfer on the server task says it is moving */
void ps_ws_response(const char *type, bool ok, const char *gif, int client);

/* --------------------------------------------------------------- ps_wifi.c ---- */
int  ps_wifi_start(void);
void ps_wifi_scan(void);
void ps_wifi_connect(const char *ssid, const char *password);
void ps_wifi_set_hostname(const char *hostname);
void ps_wifi_ap_apply(void);                          /* from g_ps.cfg.ap_* */

/* ---------------------------------------------------------------- ps_led.c ---- */
int  ps_led_init(void);
void ps_led_write(const ps_rgba_t *px, size_t n);
/* Transmits the RMT driver refused, since boot. A refusal is silent on the bar: the strip
 * simply keeps showing the last frame that did land, which from across a room is the same
 * sight as a renderer that has stopped and as a strip that is not wired up. */
uint32_t ps_led_push_failures(void);
#if CONFIG_PS_LED_PIN_WALK
void ps_led_pin_walk(void);   /* diagnostic: never returns; the blink count names the GPIO */
#endif     /* n <= CONFIG_PS_LED_COUNT */

/* ------------------------------------------------------------- ps_effect.c ---- */
void ps_effect_start(void);
void ps_effect_notify(void);                          /* config or bar state changed */

/* C8, counted here and read on the Logs page: what the renderer is actually doing.
 *
 * A bar showing the wrong thing, a renderer that has stopped, a driver refusing every
 * transmit and a strip that was never wired up all look identical from across the room, and
 * until now the only way to tell them apart was a serial cable. These four numbers do it.
 *
 * `fps` is measured over the window since the last time anyone asked, not since boot: a
 * lifetime average can never move again once it has settled, so it would go on saying thirty
 * for hours after the renderer stopped. -1 means nobody has asked recently enough to know.
 *
 * `kind` says what drew the frame, because for most of them there is no effect number: a
 * diagnostic has the bar (and that is itself the answer to "why is it red"), the placeholder
 * is a solid colour, and only the engine draws a PS_FX_*. */
#define PS_RENDER_NONE   0     /* nothing has been drawn yet */
#define PS_RENDER_FX     1     /* the effect engine; `effect` says which */
#define PS_RENDER_SOLID  2     /* the placeholder: the state's own colour, solid */
#define PS_RENDER_DIAG   3     /* C8 has the bar; nothing else is being drawn */
typedef struct {
    uint32_t frames;           /* frames rendered since boot */
    uint32_t push_failed;      /* ps_led_push_failures() at the same moment */
    int      kind;             /* PS_RENDER_* */
    int      effect;           /* PS_FX_* when kind is PS_RENDER_FX, else -1 */
    uint32_t interval_ms;      /* what the last frame asked to wait before the next */
    int      fps;              /* over the window since this was last read, -1 unknown */
} ps_render_stats_t;
void ps_effect_stats(ps_render_stats_t *out);

/* ------------------------------------------------------------ ps_printer.c ---- */
/* The MQTT client is driven by one task of its own and nothing else touches it: bind, unbind
 * and the printer commands below post to that task and return at once, so they are safe to
 * call with ps_lock held. See ps_printer.c for the deadlock that is why. */
void ps_printer_init(void);                           /* the client's task; before the web server */
int  ps_printer_start(void);
void ps_printer_bind(void);                           /* from g_ps.cfg.printer_*, queued */
void ps_printer_unbind(void);                         /* queued */
void ps_printer_scan(void);
void ps_printer_discover(void);       /* start a scan; finds nothing until a mechanism is documented */
void ps_printer_moved_maybe(void);    /* C7: count a transport failure and start a rebind scan at the threshold */

/* ---- The captive portal, in ps_portal.c: the hotspot opens its own setup page. ---- */
void ps_portal_start(void);                             /* the DNS responder for the hotspot */
bool ps_portal_addr_on_ap(uint32_t addr_host_order);    /* is this address on the hotspot's /24? */
void ps_wifi_apply_hostname(void);                      /* re-apply the name and the responder */

/* ---- The two names a device answers to. Both pure, in ps_netname.c, host-tested. ---- */
/* The hotspot's name when nothing is stored: this prefix and the six MAC bytes, uppercase
 * hex, no separators. Derived once on first boot and then stored, so it never moves. */
#define PS_AP_SSID_PREFIX      "Panda_Status_"
#define PS_HOSTNAME_LABEL_MAX  63                 /* one DNS label, and .local is the domain */
void ps_ap_ssid_from_mac(char *out, size_t n, const uint8_t mac[6]);
/* Reduces whatever was typed to one DNS label in place: trailing dots and blanks go, every
 * trailing ".local" goes, anything outside [A-Za-z0-9-] becomes a hyphen, leading and
 * trailing hyphens go, and the result is cut to 63 bytes. */
void ps_hostname_sanitise(char *s, size_t n);

/* ps_ota.c: the bytes one GIF slot may take on this unit, 0 when there is no images
 * partition. Plain size_t, no HTTP type, so it belongs here rather than with the routes. */
size_t ps_ota_slot_cap(void);

/* ps_printer.c: ask the bound printer to switch one of its lights. node is "chamber_light"
 * or "work_light", on is 0 or 1. Returns 0 when the command was queued for the client's task,
 * -1 when it was refused or the queue was full; the task logs whether it was sent. The
 * printer answers in its own telemetry, not here, so nothing is assumed to have worked. */
int ps_printer_light_set(const char *node, int on);

/* ps_log.c: the last lines the device wrote to itself, kept in RAM so the page can show
 * them. Scrubbed on the way in, never on the way out. */
void   ps_log_init(void);
void   ps_log_clear(void);
size_t ps_log_dump(char *out, size_t n);

/* ---- C8: why it is not working, blinked on the bar. Both pure, in ps_diag.c, host-tested. ---- */
typedef struct { bool active; ps_rgba_t colour; uint8_t blinks; } ps_diag_t;
#define PS_DIAG_BRIGHT   60            /* a diagnostic is for reading across a room, not for matching the mode */
#define PS_DIAG_ON_MS    180
#define PS_DIAG_OFF_MS   180
#define PS_DIAG_PAUSE_MS 1200
/* which fault the bar should be saying, if any; the network outranks the printer */
bool ps_diag_pick(uint8_t sta_state, uint8_t printer_state, ps_diag_t *out);
/* the blink group for this instant; returns the milliseconds until the frame changes */
uint32_t ps_diag_render(const ps_diag_t *d, uint32_t now_ms, ps_rgba_t *px, int n);

/* ---------------------------------------------------------------- ps_ota.c ---- */
/* type is the OTA-Type header value: "ota_fw", "ota_img" or a slot name; returns 0 ok */
int  ps_ota_begin(const char *type, size_t declared_len, void **ctx);
int  ps_ota_write(void *ctx, const void *data, size_t len);
int  ps_ota_end(void *ctx, bool ok);
void ps_ota_confirm_boot(void);                       /* once the server is up: cancel rollback */

/* ---------------------------------------------------------------- ps_api.c ---- */
/* /api/features: the clone's own JSON route, the one place a feature is switched on and its
 * settings are read or written. The socket document stays the factory's (docs/ARCHITECTURE.md). */
char *ps_features_json(void);                          /* caller frees with cJSON_free */
int   ps_features_apply(const char *json, size_t len); /* 0 ok, -1 refused; saves and notifies */

/* ------------------------------------------------------------- ps_backup.c ---- */
/* GET /backup: the whole flash as bytes, X-Flash-Size before the body, station interface
 * only. The handler signature is esp_http_server's; declared here as a pointer-free name
 * so ps.h stays free of that header. */
struct httpd_req; typedef struct httpd_req httpd_req_t;
int ps_backup_get(httpd_req_t *req);   /* esp_err_t */
int ps_api_features_get(httpd_req_t *req);
int ps_api_features_post(httpd_req_t *req);
int ps_api_preview_get(httpd_req_t *req);             /* A13: GET/POST /api/preview; a 302 like any unknown path while bit 13 is off */
int ps_api_preview_post(httpd_req_t *req);
int ps_preview_apply(const char *json, size_t len);   /* the pin from its JSON, whole or refused; 0 on success */
char *ps_preview_json(void);                          /* the pin as the page reads it; cJSON_free() it */
int ps_http_redirect_portal(httpd_req_t *req);        /* the wildcard's answer, for a route that must look absent */
/* A request body read whole, or -1 once the client has gone quiet for PS_HTTP_RECV_TIMEOUTS
 * receive timeouts in a row (ps_ws.c says why a loop that just retries is a hung server). */
#define PS_HTTP_RECV_TIMEOUTS 3
int ps_http_recv_all(httpd_req_t *req, char *buf, size_t len);
int  ps_api_print_get(httpd_req_t *req);              /* the clone's own: what the printer reports, which the factory document omits */
int  ps_api_render_get(httpd_req_t *req);             /* C8: what the renderer is doing; 302 while the diagnostics bit is off */
int  ps_portal_page(httpd_req_t *req);                /* esp_err_t: the small setup page a captive sheet can render */
bool ps_portal_req_from_ap(httpd_req_t *req);         /* is this client on the hotspot rather than the house network? */
int ps_api_restart_post(httpd_req_t *req);            /* C4: POST /api/restart, a plain restart; a 302 while bit 17 is off */
int ps_api_config_get(httpd_req_t *req);              /* C3: GET/POST /api/config, the settings as one document; a 302 while bit 16 is off */
int ps_api_config_post(httpd_req_t *req);
char *ps_config_json(void);                           /* the export: everything stored except the three passwords; cJSON_free() it */
int ps_config_apply(const char *json, size_t len);    /* the import, whole or refused; 0 on success */
int ps_api_info_get(httpd_req_t *req);                /* C2: GET /api/info, identification; always answered by a clone */
int ps_api_state_get(httpd_req_t *req);               /* C2: GET /api/state, the six-root document as JSON; always answered */
int ps_api_stages_get(httpd_req_t *req);              /* B1, B2: GET/POST /api/stages; a 302 while bit 15 is off */
int ps_api_stages_post(httpd_req_t *req);
int ps_stages_apply(const char *json, size_t len);    /* assign a named effect to a stage, clear one, or the whole table; 0 on success */
char *ps_stages_json(void);                           /* the rows and the current stage as the page reads them; cJSON_free() it */
int ps_api_presets_get(httpd_req_t *req);             /* A14: GET/POST /api/presets; a 302 while bit 14 is off */
int ps_api_presets_post(httpd_req_t *req);
int ps_presets_apply(const char *json, size_t len);   /* the whole list, or one preset into one state; 0 on success */
char *ps_presets_json(void);                          /* the list as the page reads it; cJSON_free() it */
int ps_api_logs_get(httpd_req_t *req);                /* the clone's own: GET /api/logs, the RAM ring as text */
int ps_api_logs_delete(httpd_req_t *req);             /* DELETE /api/logs, empties the ring */

/* ------------------------------------------------------------- ps_sha256.c ---- */
/* SHA-256 from FIPS 180-4, in software, so the bridge's arithmetic has a host test that
 * needs no IDF. ps_hex writes 2n lowercase hex digits and a terminator. */
typedef struct { uint32_t h[8]; uint64_t len; uint8_t buf[64]; size_t n; } ps_sha256_t;
void ps_sha256_init(ps_sha256_t *c);
void ps_sha256_update(ps_sha256_t *c, const void *data, size_t len);
void ps_sha256_final(ps_sha256_t *c, uint8_t out[32]);
void ps_sha256(const void *data, size_t len, uint8_t out[32]);
void ps_hex(const uint8_t *in, size_t n, char *out);

/* ------------------------------------------------------- ps_bridge_proto.c ---- */
/* The vent bridge's pure parts (docs/PANDAVENT-BRIDGE.md): pairing arithmetic over the hex
 * strings, RFC 6455 client framing, and the reading of a vent report. Host-tested. */
void ps_bridge_code(const char *na, const char *nb, const char *ia, const char *ib, char out[7]);
void ps_bridge_token(const char *na, const char *nb, const char *ia, const char *ib, char out[65]);
void ps_bridge_auth(const char *token_hex, const char *nonce_hex, char out[65]);
void ps_bridge_identity(const uint8_t mac[6], char out[17]);

enum { PS_WS_CONT = 0x0, PS_WS_TEXT = 0x1, PS_WS_BINARY = 0x2, PS_WS_CLOSE = 0x8, PS_WS_PING = 0x9, PS_WS_PONG = 0xA };
typedef struct {
    bool     fin, masked;
    uint8_t  opcode;
    uint8_t  mask[4];
    uint64_t len;              /* payload bytes */
    size_t   header;           /* bytes before the payload */
    const uint8_t *payload;    /* into the parsed buffer, unmasked in place */
} ps_ws_frame_t;
/* One masked client frame, FIN set; the bytes written, or 0 when it does not fit. */
size_t ps_ws_encode(uint8_t opcode, const uint8_t *payload, size_t len, const uint8_t mask[4], uint8_t *out, size_t cap);
/* The first frame in buf: its whole size when all of it is there, 0 when more is needed,
 * -1 when it is not a frame a client can accept. A masked payload is unmasked in place. */
int ps_ws_parse(uint8_t *buf, size_t len, ps_ws_frame_t *f);

enum { PS_VENT_UNKNOWN = 0, PS_VENT_OPEN = 1, PS_VENT_CLOSED = 2, PS_VENT_SEALING = 3, PS_VENT_MOVING = 4 };
typedef struct {
    uint8_t state;             /* PS_VENT_*; a state name this device does not know is UNKNOWN */
    bool    have_chamber;
    bool    have_policy;
    bool    override;          /* the vent's policy is deciding from the filament loaded */
    float   chamber_c;
    char    reason[16];        /* "" when the vent gave none */
    char    error[16];         /* "" when the vent reports no fault */
} ps_vent_report_t;
const char *ps_vent_state_name(int s);
struct cJSON;
int ps_bridge_vent_parse(const struct cJSON *body, ps_vent_report_t *out);   /* 0, or -1: not a report */

/* ------------------------------------------------------------- ps_bridge.c ---- */
/* Bit 0. The task idles while the bit is off; with it on it holds the socket to the bound
 * vent, reconnects on its own, and re-finds a vent that moved by its identity. */
void ps_bridge_start(void);
void ps_bridge_notify(void);                          /* the bit, or the binding, changed */
int  ps_api_bridge_get(httpd_req_t *req);             /* the page's view of the bridge; 302 while bit 0 is off */
int  ps_api_bridge_post(httpd_req_t *req);            /* scan, bind, pair, unbind, copy */
int  ps_bridge_id_get(httpd_req_t *req);              /* GET /bridge/id: this device, for a peer binding it by hand */

/* ------------------------------------------------------------------ utility ---- */
void ps_restart(const char *why);
const char *ps_build_id(void);         /* 16 hex chars: the first 8 bytes of the app ELF sha256 */
#endif
