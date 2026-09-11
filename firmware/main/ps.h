/* Panda Status P2 clone: the one header every module shares.
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
#define PS_CFG_MAGIC_V1  0x50533031u   /* 'P' 'S' '0' '1' */
#define PS_CFG_MAGIC     PS_CFG_MAGIC_V1
#define PS_CFG_NVS_NS    "ps"
#define PS_CFG_NVS_KEY   "cfg"
#define PS_BLOCKS_MAX    15            /* PROVISIONAL: the block list's true bound is a bench fact */

typedef struct { uint8_t r, g, b, a; } ps_rgba_t;

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
} ps_cfg_t;

/* the whole blob and its NVS budget; both pinned in ps_cfg.c and in the host test */
#define PS_CFG_SIZE      492
#define PS_CFG_NVS_BUDGET 1600

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

/* ------------------------------------------------------------------ utility ---- */
void ps_restart(const char *why);
#endif
