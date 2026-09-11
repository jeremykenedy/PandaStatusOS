/* PandaStatusOS, the Panda Status P2 clone: the one header every module shares.
 *
 * Interface facts (wire fields, roots, enums, endpoints, caps) are from
 * docs/protocol-websocket.md. Anything marked PROVISIONAL or INFERENCE is not a fact yet.
 * Standing rule 5: the wire behaviour is the factory's; every departure sits behind a
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

#define PS_FW_VERSION   "V1.0.0"     /* what settings.fw_version reports; the factory's was V1.0.0 */

/* ---------------------------------------------------------- the stored config ---- */
/* Fixed-width members only, laid out so the host tests and the target agree on every
 * offset. When the layout changes: freeze THIS struct as ps_cfg_v1_t inside ps_cfg.c,
 * bump the magic, add an arm to the chain, extend the host test. Never let a frozen
 * struct reference a live type or a live count. */
#define PS_CFG_MAGIC_V1  0x50533031u   /* 'P' 'S' '0' '1': the first layout, 492 bytes, frozen in ps_cfg.c */
#define PS_CFG_MAGIC_V2  0x50533032u   /* 'P' 'S' '0' '2': v1 plus state_brightness, 500 bytes, frozen in ps_cfg.c */
#define PS_CFG_MAGIC_V3  0x50533033u   /* 'P' 'S' '0' '3': v2 plus the per-state effects, 572 bytes, frozen in ps_cfg.c */
#define PS_CFG_MAGIC_V4  0x50533034u   /* 'P' 'S' '0' '4': v3 plus the temperature fields and the two layers */
#define PS_CFG_MAGIC     PS_CFG_MAGIC_V4

/* feature bits in ps_cfg_t.features. Every one defaults to 0 and leaves the device at
 * factory parity; docs/FEATURES.md is the table. Bit 0 is reserved for the vent bridge. */
#define PS_FEAT_BRIDGE            (1u << 0)
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
typedef struct {
    uint8_t   effect;                  /* enum ps_fx */
    uint8_t   brightness;              /* 0..100 */
    uint8_t   speed;                   /* 0..100 */
    uint8_t   bright_end;              /* 0..100, the ramp's end */
    uint8_t   opt;                     /* PS_FX_OPT_* */
    uint8_t   aux;
    uint8_t   _pad[2];
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
/* A14: the palette effects: the stops laid across the strip piecewise-linear (PS_FX_PALETTE), or
 * wrapped round and scrolling (PS_FX_PALETTE_SCROLL); one stop is a solid, none is dark */
uint32_t ps_fx_render_palette(int fx, const ps_rgba_t *stops, int nstops, uint8_t bright100, uint8_t speed, bool reverse,
                              ps_fx_phase_t *p, ps_rgba_t *px, int n);
uint8_t  ps_fx_ramp(ps_fx_phase_t *p, uint8_t bright, int bright_end);   /* bright_end < 0: no ramp */
/* fills px[0..n-1], advances the phase once, returns the ms to wait before the next frame */
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
    uint8_t   _pad2[2];
} ps_cfg_t;

/* the whole blob and its NVS budget; both pinned in ps_cfg.c and in the host test */
#define PS_CFG_SIZE      592
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

/* what to render this frame, from the config and the live state, honouring every feature
 * bit (A1 to A5); fx < 0 means the placeholder in the state's colour. Pure, in ps_fx.c,
 * host-tested. */
typedef struct { int fx; ps_rgba_t colour, bg; uint8_t brightness, speed; bool reverse; int bright_end; int band;
                 ps_rgba_t stops[4]; int nstops; } ps_fx_pick_t;   /* stops: the palette effects' colours, in order (A14) */
void ps_fx_resolve(const ps_cfg_t *c, uint8_t mode, uint8_t st, bool job_active, ps_fx_pick_t *out);

/* ---------------------------------------------------------- the live state ---- */
typedef struct { char ssid[33]; int8_t rssi; } ps_wifi_hit_t;          /* INFERENCE shape */
typedef struct { char name[33]; char ip[16]; } ps_printer_hit_t;       /* INFERENCE shape */

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
    /* A13: a pinned printer state the renderer reads instead of the live one while the pin
     * is live (bit 13). Nothing here is stored; the live state is untouched underneath. */
    uint8_t  pin_active;
    uint8_t  pin_state;                /* enum ps_bar_state */
    int16_t  pin_percent;              /* -1 for none */
    int16_t  pin_temp[PS_TEMP_COUNT];  /* PS_TEMP_NONE where the pin gives none: the live reading shows through */
    int64_t  pin_until_us;             /* esp_timer time the pin expires */
    ps_presets_t presets;              /* A14: the named effects, loaded at boot */
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
void ps_ws_response(const char *type, bool ok, const char *gif, int client);

/* --------------------------------------------------------------- ps_wifi.c ---- */
int  ps_wifi_start(void);
void ps_wifi_scan(void);
void ps_wifi_connect(const char *ssid, const char *password);
void ps_wifi_set_hostname(const char *hostname);
void ps_wifi_ap_apply(void);                          /* from g_ps.cfg.ap_* */

/* ---------------------------------------------------------------- ps_led.c ---- */
int  ps_led_init(void);
void ps_led_write(const ps_rgba_t *px, size_t n);     /* n <= CONFIG_PS_LED_COUNT */

/* ------------------------------------------------------------- ps_effect.c ---- */
void ps_effect_start(void);
void ps_effect_notify(void);                          /* config or bar state changed */

/* ------------------------------------------------------------ ps_printer.c ---- */
int  ps_printer_start(void);
void ps_printer_bind(void);                           /* from g_ps.cfg.printer_* */
void ps_printer_unbind(void);
void ps_printer_scan(void);

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
int ps_api_presets_get(httpd_req_t *req);             /* A14: GET/POST /api/presets; a 302 while bit 14 is off */
int ps_api_presets_post(httpd_req_t *req);
int ps_presets_apply(const char *json, size_t len);   /* the whole list, or one preset into one state; 0 on success */
char *ps_presets_json(void);                          /* the list as the page reads it; cJSON_free() it */

/* ------------------------------------------------------------------ utility ---- */
void ps_restart(const char *why);
const char *ps_build_id(void);         /* 16 hex chars: the first 8 bytes of the app ELF sha256 */
#endif
