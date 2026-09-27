/* Config blob: one NVS entry, a magic that is the version, matched first, corroborated
 * by size. Defaults are written first, then the stored layout is overlaid field by field,
 * never by a prefix copy: a struct that grows in the middle moves every byte after it.
 *
 * The chain below has five arms: v5 (current), v4, v3, v2 and v1 (frozen below). The day a
 * sixth layout exists:
 *   1. copy the current ps_cfg_t into this file as ps_cfg_v5_t, static, with its own
 *      _Static_assert on the literal size, referencing NO live type and NO live count;
 *   2. define PS_CFG_MAGIC_V6, point PS_CFG_MAGIC at it;
 *   3. add the v5 arm: defaults, overlay every v5 field, set what v6 added, save;
 *   4. extend firmware/test/host/cfg_test.c with a v5 blob that must survive.
 * A frozen struct that points at a live type is correct only by luck. Grep this file for
 * the live names before every commit that touches a legacy block. */
#include <string.h>
#include <stdio.h>
#include "esp_err.h"
#include "esp_log.h"
#include "nvs_flash.h"
#include "nvs.h"
#include "ps.h"

static const char *TAG = "ps_cfg";

/* ---- v1, 'PS01', 492 bytes: frozen. Literal counts, private types, no live name. ---- */
typedef struct { uint8_t r, g, b, a; } v1_rgba_t;
typedef struct { uint8_t brightness, speed, _pad[2]; v1_rgba_t colour[3]; } v1_mode_t;
typedef struct { uint8_t id, _pad[3]; v1_rgba_t colour; } v1_block_t;
typedef struct {
    uint32_t magic, features;
    char wifi_ssid[33], wifi_password[65], ap_ssid[33], ap_password[65], hostname[33];
    char printer_name[33], printer_sn[33], printer_access_code[17], language[8];
    uint8_t ap_ip[4], printer_ip[4], ap_on, current_mode, block_count, _pad0;
    v1_mode_t mode[2];
    v1_block_t block[15];
} ps_cfg_v1_t;
_Static_assert(sizeof(ps_cfg_v1_t) == 492, "the v1 layout is frozen at 492 bytes");
_Static_assert(offsetof(ps_cfg_v1_t, mode) == 340 && offsetof(ps_cfg_v1_t, block) == 372, "the v1 layout moved");

/* ---- v2, 'PS02', 500 bytes: frozen. v1 plus state_brightness. ---- */
typedef struct {
    uint32_t magic, features;
    char wifi_ssid[33], wifi_password[65], ap_ssid[33], ap_password[65], hostname[33];
    char printer_name[33], printer_sn[33], printer_access_code[17], language[8];
    uint8_t ap_ip[4], printer_ip[4], ap_on, current_mode, block_count, _pad0;
    v1_mode_t mode[2];
    v1_block_t block[15];
    uint8_t state_brightness[2][3];
    uint8_t _pad1[2];
} ps_cfg_v2_t;
_Static_assert(sizeof(ps_cfg_v2_t) == 500, "the v2 layout is frozen at 500 bytes");
_Static_assert(offsetof(ps_cfg_v2_t, state_brightness) == 492, "the v2 layout moved");

/* ---- v3, 'PS03', 572 bytes: frozen. v2 plus the effect per bar state. ---- */
typedef struct { uint8_t effect, brightness, speed, bright_end, opt, aux, _pad[2]; v1_rgba_t colour[4]; } v3_fx_t;
typedef struct {
    uint32_t magic, features;
    char wifi_ssid[33], wifi_password[65], ap_ssid[33], ap_password[65], hostname[33];
    char printer_name[33], printer_sn[33], printer_access_code[17], language[8];
    uint8_t ap_ip[4], printer_ip[4], ap_on, current_mode, block_count, _pad0;
    v1_mode_t mode[2];
    v1_block_t block[15];
    uint8_t state_brightness[2][3];
    uint8_t _pad1[2];
    v3_fx_t fx[3];
} ps_cfg_v3_t;
_Static_assert(sizeof(ps_cfg_v3_t) == 572, "the v3 layout is frozen at 572 bytes");
_Static_assert(offsetof(ps_cfg_v3_t, fx) == 500 && sizeof(v3_fx_t) == 24, "the v3 layout moved");

/* ---- v4, 'PS04', 592 bytes: frozen. v3 plus the temperature fields and the two layers; the
 * effect entry's two padding bytes had become fx_unlit and flags by then. ---- */
typedef struct { uint8_t effect, brightness, speed, bright_end, opt, aux, fx_unlit, flags; v1_rgba_t colour[4]; } v4_fx_t;
typedef struct {
    uint32_t magic, features;
    char wifi_ssid[33], wifi_password[65], ap_ssid[33], ap_password[65], hostname[33];
    char printer_name[33], printer_sn[33], printer_access_code[17], language[8];
    uint8_t ap_ip[4], printer_ip[4], ap_on, current_mode, block_count, _pad0;
    v1_mode_t mode[2];
    v1_block_t block[15];
    uint8_t state_brightness[2][3];
    uint8_t _pad1[2];
    v4_fx_t fx[3];
    int16_t temp_lo, temp_hi;
    uint8_t temp_src, hot_src;
    int16_t hot_c;
    v1_rgba_t hot_colour, err_colour;
    uint8_t err_brightness, err_speed, temp_unit, _pad2;
} ps_cfg_v4_t;
_Static_assert(sizeof(ps_cfg_v4_t) == 592, "the v4 layout is frozen at 592 bytes");
_Static_assert(offsetof(ps_cfg_v4_t, fx) == 500 && sizeof(v4_fx_t) == 24 && offsetof(ps_cfg_v4_t, temp_lo) == 572 && offsetof(ps_cfg_v4_t, err_speed) == 589, "the v4 layout moved");

/* The fields v1, v2 and v3 share, overlaid by name from a frozen struct onto the live one.
 * One macro, three frozen types: the arms cannot disagree about a field. */
#define OVERLAY_COMMON(c, o) do { \
    (c)->features = (o)->features; \
    memcpy((c)->wifi_ssid, (o)->wifi_ssid, sizeof (c)->wifi_ssid); \
    memcpy((c)->wifi_password, (o)->wifi_password, sizeof (c)->wifi_password); \
    memcpy((c)->ap_ssid, (o)->ap_ssid, sizeof (c)->ap_ssid); \
    memcpy((c)->ap_password, (o)->ap_password, sizeof (c)->ap_password); \
    memcpy((c)->hostname, (o)->hostname, sizeof (c)->hostname); \
    memcpy((c)->printer_name, (o)->printer_name, sizeof (c)->printer_name); \
    memcpy((c)->printer_sn, (o)->printer_sn, sizeof (c)->printer_sn); \
    memcpy((c)->printer_access_code, (o)->printer_access_code, sizeof (c)->printer_access_code); \
    memcpy((c)->language, (o)->language, sizeof (c)->language); \
    memcpy((c)->ap_ip, (o)->ap_ip, 4); memcpy((c)->printer_ip, (o)->printer_ip, 4); \
    (c)->ap_on = (o)->ap_on; (c)->current_mode = (o)->current_mode; (c)->block_count = (o)->block_count; \
    for (int m_ = 0; m_ < 2; m_++) { \
        (c)->mode[m_].brightness = (o)->mode[m_].brightness; (c)->mode[m_].speed = (o)->mode[m_].speed; \
        for (int i_ = 0; i_ < 3; i_++) (c)->mode[m_].colour[i_] = (ps_rgba_t){ (o)->mode[m_].colour[i_].r, (o)->mode[m_].colour[i_].g, (o)->mode[m_].colour[i_].b, (o)->mode[m_].colour[i_].a }; \
    } \
    for (int b_ = 0; b_ < 15; b_++) { (c)->block[b_].id = (o)->block[b_].id; (c)->block[b_].colour = (ps_rgba_t){ (o)->block[b_].colour.r, (o)->block[b_].colour.g, (o)->block[b_].colour.b, (o)->block[b_].colour.a }; } \
} while (0)

/* The layout is pinned to a literal. If this fails, the layout changed: freeze, bump,
 * migrate; do not edit the number. */
_Static_assert(sizeof(ps_cfg_t) == PS_CFG_SIZE, "ps_cfg_t changed size: freeze v1, bump the magic, add a migration arm");
_Static_assert(offsetof(ps_cfg_t, magic) == 0, "magic must be the first field of every stored layout");
_Static_assert(offsetof(ps_cfg_t, features) == 4, "features moved");
_Static_assert(offsetof(ps_cfg_t, mode) == 340, "mode[] moved");
_Static_assert(offsetof(ps_cfg_t, block) == 372, "block[] moved");
_Static_assert(offsetof(ps_cfg_t, state_brightness) == 492, "the v2 fields must follow the v1 layout exactly");
_Static_assert(offsetof(ps_cfg_t, fx) == 500 && sizeof(ps_fx_cfg_t) == 24, "the v3 fields must follow the v2 layout exactly");
_Static_assert(offsetof(ps_cfg_t, temp_lo) == 572 && offsetof(ps_cfg_t, hot_colour) == 580 && offsetof(ps_cfg_t, err_speed) == 589, "the v4 fields must follow the v3 layout exactly");
_Static_assert(offsetof(ps_cfg_t, device_name) == 592, "the v5 field must follow the v4 layout exactly");
_Static_assert(sizeof(ps_mode_cfg_t) == 16 && sizeof(ps_block_cfg_t) == 8 && sizeof(ps_rgba_t) == 4, "sub-struct size changed");
/* NVS keeps the old and the new copy resident during a rewrite; the budget is the blob
 * twice plus a page of slack against a 0x6000 partition shared with Wi-Fi credentials.
 * A blob over budget saves silently-failing and a reboot loses everything. */
_Static_assert(sizeof(ps_cfg_t) * 2 + 512 <= PS_CFG_NVS_BUDGET, "config blob over the NVS budget");

const char *const ps_gif_slot_names[PS_GIF_SLOTS] = {
    "standby", "nozzle_heating", "bed_heating", "bed_leveling", "homing", "nozzle_cleaning",
    "calibrating_flow", "xy_mesh_mode_sweep", "filament_check_location", "filament_cut",
    "filament_pull_back_cur", "filament_push_new", "filament_purge_old", "printing_ok", "printing",
};

static void set_str(char *dst, size_t n, const char *src) { strncpy(dst, src, n - 1); dst[n - 1] = 0; }

/* PROVISIONAL defaults. Phase 2 gate 3 needs the values the device reports after its own
 * factory reset (docs/PLAN.md, Phase 1). Until that read, these are the values
 * the factory page expects after a lighting reset (docs/protocol-websocket.md) and the
 * mock's factory fixture. Writes through c only. */
void ps_cfg_factory_defaults(ps_cfg_t *c)
{
    memset(c, 0, sizeof(*c));
    c->magic = PS_CFG_MAGIC;
    c->features = 0;                                   /* parity */
    /* The hostname is this project's choice, not a parity guess: "status", so a unit answers
     * to the name "status" on the network it joins (D-046). The factory's own default hostname
     * is still unread, and the hotspot name below still waits for the bench session, because
     * what the factory calls its own hotspot is a parity fact rather than a branding one
     * (D-027). Anyone running more than one unit renames them on the Network page. */
    set_str(c->hostname, sizeof c->hostname, "status");
    /* The hotspot name is deliberately left EMPTY here. ps_wifi_start() builds it from this
     * unit's own MAC on first boot and stores it, so two devices are never the same network
     * and the name needs no typing (D-047). A name already stored is never rebuilt. */
    c->ap_ssid[0] = 0;
    /* The hotspot carries a password by default rather than standing open. Under eight
     * characters the radio cannot do WPA2 at all and would fall back to an open network, so
     * the default is nine. It is printed in the README and in the setup page, and it is
     * meant to be changed (D-047). */
    set_str(c->ap_password, sizeof c->ap_password, "987654321");
    c->ap_ip[0] = 192; c->ap_ip[1] = 168; c->ap_ip[2] = 4; c->ap_ip[3] = 1;
    c->ap_on = 1;
    set_str(c->language, sizeof c->language, "en");
    c->current_mode = PS_MODE_H2D;
    for (int m = 0; m < 2; m++) {
        c->mode[m].brightness = 50;
        c->mode[m].speed = 100;
        c->mode[m].colour[PS_BAR_IDLE]     = (ps_rgba_t){ 0xFF, 0xFF, 0xFF, 0xFF };
        c->mode[m].colour[PS_BAR_PRINTING] = (ps_rgba_t){ 0xFF, 0xFF, 0xFF, 0xFF };
        c->mode[m].colour[PS_BAR_ERROR]    = (ps_rgba_t){ 0xFF, 0x00, 0x00, 0xFF };
    }
    c->block_count = 1;
    c->block[0].id = 0;
    c->block[0].colour = (ps_rgba_t){ 0xFF, 0xFF, 0xFF, 0xFF };
    /* v2: read only while PS_FEAT_STATE_BRIGHTNESS is set; equal to the global default so
     * turning the feature on changes nothing until a slider moves */
    for (int m = 0; m < 2; m++) for (int i = 0; i < 3; i++) c->state_brightness[m][i] = 50;
    /* v3: read only while the effect bits are set. The effect is solid, its parameters the
     * parity defaults, its active colours the H2D state colour, its inactive colours unset. */
    for (int s = 0; s < 3; s++) {
        c->fx[s].effect = PS_FX_STATIC; c->fx[s].brightness = 50; c->fx[s].speed = 100;
        c->fx[s].bright_end = 0; c->fx[s].aux = 0; c->fx[s].fx_unlit = PS_FX_STATIC;
        /* O2: kept inside the progress by default. Read only under A4, and only while a job is
         * on, so a default device is still at parity and an idle bar still fills. The flag says
         * the default has been applied, so the clamp does not apply it again. */
        c->fx[s].opt = PS_FX_OPT_IN_PROGRESS; c->fx[s].flags = PS_FX_FLAG_INPROG_SET;
        c->fx[s].colour[0] = c->fx[s].colour[1] = c->mode[PS_MODE_H2D].colour[s];
        c->fx[s].colour[2] = c->fx[s].colour[3] = (ps_rgba_t){ 0, 0, 0, 0xFF };
    }
    /* v4: read only under bits 10 to 12. The gradient follows the nozzle from room
     * temperature to a printing one; the hot warning watches the nozzle past what a hand
     * tolerates, in red; the error flash is red at the parity brightness, at half rate. */
    c->temp_lo = 25; c->temp_hi = 250; c->temp_src = PS_TEMP_NOZZLE;
    /* A11's default watched the NOZZLE at 50 C. A nozzle is over 50 C for the whole of every
     * print, so with the switch on the layer pulsed red over the bar from the first minute
     * of a job to the last, and the effect underneath could not be seen at all. The warning
     * is about the machine being hot to open, so it watches the chamber; a printer with no
     * chamber reading never triggers it, which is the right answer for that machine too. */
    c->hot_src = PS_TEMP_CHAMBER; c->hot_c = 50; c->hot_colour = (ps_rgba_t){ 0xFF, 0, 0, 0xFF };
    c->err_colour = (ps_rgba_t){ 0xFF, 0, 0, 0xFF }; c->err_brightness = 50; c->err_speed = 50;
    c->temp_unit = PS_UNIT_C;                          /* O6: Celsius unless the page is told otherwise */
    c->_pad2 = 0;
    /* v5: no name stored means the default, so the string lives in one place (ps_cfg_device_name) */
    c->device_name[0] = 0;
}

/* The friendly name, the vent's rule (pv_apply.c): empty or the word "default" puts the
 * default back, so the page's reset button does not carry a copy of it. Anything else is
 * taken as typed, within reason: 32 bytes, cut on a UTF-8 character boundary rather than
 * in the middle of one, control characters dropped, spaces at the ends dropped. A name
 * that is nothing but that is the default too. */
void ps_cfg_set_device_name(ps_cfg_t *c, const char *v)
{
    char out[sizeof c->device_name];
    size_t n = 0;
    if (v && v[0] && strcmp(v, "default") != 0) {
        const unsigned char *p = (const unsigned char *)v;
        while (*p) {
            if (*p < 0x20 || *p == 0x7F) { p++; continue; }              /* control characters are not a name */
            size_t len = *p < 0x80 ? 1 : (*p & 0xE0) == 0xC0 ? 2 : (*p & 0xF0) == 0xE0 ? 3 : (*p & 0xF8) == 0xF0 ? 4 : 0;
            size_t have = 0;                                              /* a lead byte and its continuations, whole */
            if (len) for (have = 1; have < len && (p[have] & 0xC0) == 0x80; have++) { }
            if (len == 0 || have < len) { p++; continue; }                /* a stray byte is not a character */
            if (n + len > sizeof out - 1) break;                          /* the cut lands between characters */
            memcpy(out + n, p, len);
            n += len; p += len;
        }
    }
    while (n && out[n - 1] == ' ') n--;
    size_t lead = 0; while (lead < n && out[lead] == ' ') lead++;
    memmove(c->device_name, out + lead, n - lead);
    c->device_name[n - lead] = 0;
}

const char *ps_cfg_device_name(const ps_cfg_t *c)
{
    return c->device_name[0] ? c->device_name : PS_DEVICE_NAME_DEFAULT;
}

/* One stored effect, wherever it lives (a state's entry, a preset, a stage row): the ids
 * are switch indices and the numbers are percentages, so both are bounded; the unfilled
 * part's effect may be anything that does not draw the progress (O1).
 *
 * And the one migration a blob of this layout has (O2): an entry written before the
 * kept-inside option existed carries opt without 0x20 and the flag clear, which is "never
 * offered", not "turned off". It gets the default, on, once; the flag then says so, and an
 * entry the page has written since (the flag set) keeps whatever was chosen. Without this
 * the default reached new devices only, and the one device this was asked for on kept
 * every effect at full width. */
static void fx_clamp(ps_fx_cfg_t *f)
{
    if (f->effect >= PS_FX_COUNT) f->effect = PS_FX_STATIC;
    if (f->brightness > 100) f->brightness = 100;
    if (f->speed > 100) f->speed = 100;
    if (f->bright_end > 100) f->bright_end = 100;
    if (f->fx_unlit >= PS_FX_COUNT || !ps_fx_unlit_ok(f->fx_unlit)) f->fx_unlit = PS_FX_STATIC;
    if (!(f->flags & PS_FX_FLAG_INPROG_SET)) { f->opt |= PS_FX_OPT_IN_PROGRESS; f->flags |= PS_FX_FLAG_INPROG_SET; }
}

/* Every value read from flash that is used as an index or a range is bounded here, with
 * the reason. A blob written by a newer or a corrupt image must not become an array
 * subscript. */
void ps_cfg_clamp(ps_cfg_t *c)
{
    if (c->current_mode > PS_MODE_H2D) c->current_mode = PS_MODE_H2D;      /* array index into mode[] */
    if (c->block_count > PS_BLOCKS_MAX) c->block_count = PS_BLOCKS_MAX;    /* loop bound over block[] */
    if (c->ap_on > 1) c->ap_on = 1;
    for (int m = 0; m < 2; m++) {
        if (c->mode[m].brightness > 100) c->mode[m].brightness = 100;      /* 0..100 by the wire */
        if (c->mode[m].speed > 100) c->mode[m].speed = 100;
        for (int i = 0; i < 3; i++) if (c->state_brightness[m][i] > 100) c->state_brightness[m][i] = 100;
    }
    for (int s = 0; s < 3; s++) fx_clamp(&c->fx[s]);                      /* effect id is a switch index */
    /* v4: the sources index temp_c[], the degrees are bounded, the percentages are 0..100 */
    if (c->temp_src >= PS_TEMP_COUNT) c->temp_src = PS_TEMP_NOZZLE;
    if (c->hot_src >= PS_TEMP_COUNT) c->hot_src = PS_TEMP_NOZZLE;
    if (c->temp_lo < 0) c->temp_lo = 0;
    if (c->temp_lo > PS_TEMP_MAX) c->temp_lo = PS_TEMP_MAX;
    if (c->temp_hi < 0) c->temp_hi = 0;
    if (c->temp_hi > PS_TEMP_MAX) c->temp_hi = PS_TEMP_MAX;
    if (c->hot_c < 0) c->hot_c = 0;
    if (c->hot_c > PS_TEMP_MAX) c->hot_c = PS_TEMP_MAX;
    if (c->err_brightness > 100) c->err_brightness = 100;
    if (c->err_speed > 100) c->err_speed = 100;
    if (c->temp_unit > PS_UNIT_F) c->temp_unit = PS_UNIT_C;                  /* O6: two units, or Celsius */
    /* strings must terminate: a blob from a different build could carry a full array */
    c->wifi_ssid[sizeof c->wifi_ssid - 1] = 0;         c->wifi_password[sizeof c->wifi_password - 1] = 0;
    c->ap_ssid[sizeof c->ap_ssid - 1] = 0;             c->ap_password[sizeof c->ap_password - 1] = 0;
    c->hostname[sizeof c->hostname - 1] = 0;           c->printer_name[sizeof c->printer_name - 1] = 0;
    c->printer_sn[sizeof c->printer_sn - 1] = 0;       c->printer_access_code[sizeof c->printer_access_code - 1] = 0;
    c->language[sizeof c->language - 1] = 0;
    /* v5: the friendly name is re-read through its own setter, so a blob written by
     * another build cannot hand the page a control character or half a character */
    c->device_name[sizeof c->device_name - 1] = 0;
    { char tmp[sizeof c->device_name]; memcpy(tmp, c->device_name, sizeof tmp); ps_cfg_set_device_name(c, tmp); }
}

int ps_cfg_load(ps_cfg_t *c)
{
    ps_cfg_factory_defaults(c);                        /* the no-blob and bad-blob paths cost nothing more */
    nvs_handle_t h;
    esp_err_t err = nvs_open(PS_CFG_NVS_NS, NVS_READONLY, &h);
    if (err != ESP_OK) { ESP_LOGI(TAG, "no config namespace yet, defaults"); return 0; }
    union { ps_cfg_t cur; ps_cfg_v4_t v4; ps_cfg_v3_t v3; ps_cfg_v2_t v2; ps_cfg_v1_t v1; uint32_t magic; uint8_t raw[PS_CFG_NVS_BUDGET]; } stored;
    size_t size = sizeof(stored);
    err = nvs_get_blob(h, PS_CFG_NVS_KEY, &stored, &size);
    nvs_close(h);
    if (err != ESP_OK) { ESP_LOGI(TAG, "no config blob, defaults"); return 0; }

    /* newest first; a future v6 arm goes ABOVE this one */
    if (size == sizeof(ps_cfg_t) && stored.cur.magic == PS_CFG_MAGIC_V5) {
        memcpy(c, &stored.cur, sizeof(*c));            /* the current layout: whole, then clamped */
        ps_cfg_clamp(c);
        return 0;
    }
    /* Older layouts: defaults first (which set every newer field), then every stored field
     * overlaid by name, never by a prefix copy, then saved back so the migration runs once.
     * The effect defaults take the H2D colours AFTER the overlay, so a migrated device's
     * effects start in the colours it already had. */
    if (size == sizeof(ps_cfg_v4_t) && stored.v4.magic == PS_CFG_MAGIC_V4) {
        const ps_cfg_v4_t *o = &stored.v4;
        ps_cfg_factory_defaults(c);
        OVERLAY_COMMON(c, o);
        memcpy(c->state_brightness, o->state_brightness, sizeof c->state_brightness);
        for (int s = 0; s < 3; s++) {
            c->fx[s].effect = o->fx[s].effect; c->fx[s].brightness = o->fx[s].brightness; c->fx[s].speed = o->fx[s].speed;
            c->fx[s].bright_end = o->fx[s].bright_end; c->fx[s].opt = o->fx[s].opt; c->fx[s].aux = o->fx[s].aux;
            c->fx[s].fx_unlit = o->fx[s].fx_unlit; c->fx[s].flags = o->fx[s].flags;
            for (int i = 0; i < 4; i++) c->fx[s].colour[i] = (ps_rgba_t){ o->fx[s].colour[i].r, o->fx[s].colour[i].g, o->fx[s].colour[i].b, o->fx[s].colour[i].a };
        }
        c->temp_lo = o->temp_lo; c->temp_hi = o->temp_hi; c->temp_src = o->temp_src; c->hot_src = o->hot_src; c->hot_c = o->hot_c;
        c->hot_colour = (ps_rgba_t){ o->hot_colour.r, o->hot_colour.g, o->hot_colour.b, o->hot_colour.a };
        c->err_colour = (ps_rgba_t){ o->err_colour.r, o->err_colour.g, o->err_colour.b, o->err_colour.a };
        c->err_brightness = o->err_brightness; c->err_speed = o->err_speed; c->temp_unit = o->temp_unit;
        /* v5 added the friendly name; the defaults left it empty, which reads as the default */
        ps_cfg_clamp(c);
        ESP_LOGI(TAG, "config migrated v4 -> v5");
        ps_cfg_save(c);
        return 0;
    }
    if (size == sizeof(ps_cfg_v3_t) && stored.v3.magic == PS_CFG_MAGIC_V3) {
        const ps_cfg_v3_t *o = &stored.v3;
        ps_cfg_factory_defaults(c);
        OVERLAY_COMMON(c, o);
        memcpy(c->state_brightness, o->state_brightness, sizeof c->state_brightness);
        for (int s = 0; s < 3; s++) {
            c->fx[s].effect = o->fx[s].effect; c->fx[s].brightness = o->fx[s].brightness; c->fx[s].speed = o->fx[s].speed;
            c->fx[s].bright_end = o->fx[s].bright_end; c->fx[s].opt = o->fx[s].opt; c->fx[s].aux = o->fx[s].aux;
            c->fx[s].flags = 0;                        /* a v3 entry never saw the kept-inside option: the clamp gives it the default (O2) */
            for (int i = 0; i < 4; i++) c->fx[s].colour[i] = (ps_rgba_t){ o->fx[s].colour[i].r, o->fx[s].colour[i].g, o->fx[s].colour[i].b, o->fx[s].colour[i].a };
        }
        ps_cfg_clamp(c);
        ESP_LOGI(TAG, "config migrated v3 -> v5");
        ps_cfg_save(c);
        return 0;
    }
    if (size == sizeof(ps_cfg_v2_t) && stored.v2.magic == PS_CFG_MAGIC_V2) {
        const ps_cfg_v2_t *o = &stored.v2;
        ps_cfg_factory_defaults(c);
        OVERLAY_COMMON(c, o);
        memcpy(c->state_brightness, o->state_brightness, sizeof c->state_brightness);
        for (int s = 0; s < 3; s++) c->fx[s].colour[0] = c->fx[s].colour[1] = c->mode[PS_MODE_H2D].colour[s];
        ps_cfg_clamp(c);
        ESP_LOGI(TAG, "config migrated v2 -> v5");
        ps_cfg_save(c);
        return 0;
    }
    if (size == sizeof(ps_cfg_v1_t) && stored.v1.magic == PS_CFG_MAGIC_V1) {
        const ps_cfg_v1_t *o = &stored.v1;
        ps_cfg_factory_defaults(c);
        OVERLAY_COMMON(c, o);
        for (int s = 0; s < 3; s++) c->fx[s].colour[0] = c->fx[s].colour[1] = c->mode[PS_MODE_H2D].colour[s];
        ps_cfg_clamp(c);
        ESP_LOGI(TAG, "config migrated v1 -> v5");
        ps_cfg_save(c);
        return 0;
    }
    ESP_LOGW(TAG, "config blob not recognised (magic %08x, %u bytes), defaults", (unsigned)stored.magic, (unsigned)size);
    return 0;
}

int ps_cfg_save(const ps_cfg_t *c)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(PS_CFG_NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "nvs_open: %d", (int)err); return -1; }
    err = nvs_set_blob(h, PS_CFG_NVS_KEY, c, sizeof(*c));
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "save failed: %d", (int)err); return -1; }
    return 0;
}

int ps_cfg_erase(void)
{
    nvs_handle_t h;
    if (nvs_open(PS_CFG_NVS_NS, NVS_READWRITE, &h) != ESP_OK) return -1;
    esp_err_t err = nvs_erase_all(h);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    return err == ESP_OK ? 0 : -1;
}

/* ---- A14: the named effects, their own blob under the same namespace. Not part of the
 * config layout: it has its own magic and size and is read whole or not at all. ---- */
_Static_assert(sizeof(ps_preset_t) == 40 && sizeof(ps_presets_t) == PS_PRESETS_SIZE, "the presets layout moved");
void ps_presets_clamp(ps_presets_t *s)
{
    s->magic = PS_PRESETS_MAGIC;
    if (s->count > PS_PRESETS_MAX) s->count = PS_PRESETS_MAX;
    for (int i = 0; i < PS_PRESETS_MAX; i++) {
        s->p[i].name[PS_PRESET_NAME - 1] = 0;
        fx_clamp(&s->p[i].fx);
    }
}
/* ---- C9: the fixed address. Same shape as the two blobs below it: magic first, size
 * corroborates, an unrecognised blob is an empty one rather than a failed boot. ---- */
void ps_netcfg_clamp(ps_netcfg_t *s)
{
    s->magic = PS_NETCFG_MAGIC;
    s->on = s->on ? 1 : 0;
    /* An address of all zeros is not an address. Turning the switch on without one would
     * take the interface off DHCP and give it nothing, which is a device nobody can reach,
     * so the switch is held off until there is something to apply. */
    bool have = s->ip[0] || s->ip[1] || s->ip[2] || s->ip[3];
    if (!have) s->on = 0;
    /* A mask of zero is the one field a person is most likely to leave blank; /24 is what
     * the network this device ships onto almost always is, and a wrong mask is a device that
     * answers nothing. Stated rather than guessed at every use. */
    if (!(s->mask[0] || s->mask[1] || s->mask[2] || s->mask[3])) { s->mask[0] = 255; s->mask[1] = 255; s->mask[2] = 255; s->mask[3] = 0; }
}

int ps_netcfg_load(ps_netcfg_t *s)
{
    memset(s, 0, sizeof *s); s->magic = PS_NETCFG_MAGIC;
    nvs_handle_t h;
    if (nvs_open(PS_CFG_NVS_NS, NVS_READONLY, &h) != ESP_OK) return 0;
    ps_netcfg_t stored; size_t size = sizeof stored;
    esp_err_t err = nvs_get_blob(h, PS_NETCFG_NVS_KEY, &stored, &size);
    nvs_close(h);
    if (err != ESP_OK) return 0;
    if (size != sizeof stored || stored.magic != PS_NETCFG_MAGIC) { ESP_LOGW(TAG, "netcfg blob not recognised, DHCP"); return 0; }
    memcpy(s, &stored, sizeof *s);
    ps_netcfg_clamp(s);
    return 0;
}

int ps_netcfg_save(const ps_netcfg_t *s)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(PS_CFG_NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "nvs_open: %d", (int)err); return -1; }
    err = nvs_set_blob(h, PS_NETCFG_NVS_KEY, s, sizeof *s);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "netcfg save: %d", (int)err); return -1; }
    return 0;
}

/* ---- Bit 0: the vent binding. Same shape again. The clamp keeps the blob honest about
 * itself: a token is only ever there while `paired` says so, and a binding with nowhere to
 * connect to is no binding, so the page never shows a bound vent that cannot be reached and
 * the task never dials a name that was never given. ---- */
_Static_assert(sizeof(ps_bridge_cfg_t) == PS_BRIDGE_SIZE, "the bridge blob layout moved");
void ps_bridge_cfg_clamp(ps_bridge_cfg_t *s)
{
    s->magic = PS_BRIDGE_MAGIC;
    s->id[sizeof s->id - 1] = 0; s->name[sizeof s->name - 1] = 0;
    s->host[sizeof s->host - 1] = 0; s->token[sizeof s->token - 1] = 0;
    s->bound = s->bound ? 1 : 0;
    s->paired = s->paired ? 1 : 0;
    /* Identities and tokens are lowercase hex of a fixed length or they are nothing. */
    for (size_t i = 0; s->id[i]; i++) if (!((s->id[i] >= '0' && s->id[i] <= '9') || (s->id[i] >= 'a' && s->id[i] <= 'f'))) { s->id[0] = 0; break; }
    if (s->id[0] && strlen(s->id) != 16) s->id[0] = 0;
    if (s->paired && strlen(s->token) != 64) s->paired = 0;
    if (!s->paired) memset(s->token, 0, sizeof s->token);
    bool have_ip = s->ip[0] || s->ip[1] || s->ip[2] || s->ip[3];
    if (!s->host[0] && !s->id[0] && !have_ip) s->bound = 0;
    if (!s->bound) {
        memset(s->id, 0, sizeof s->id); memset(s->name, 0, sizeof s->name); memset(s->host, 0, sizeof s->host);
        memset(s->token, 0, sizeof s->token); memset(s->ip, 0, sizeof s->ip); s->paired = 0;
    }
}

int ps_bridge_cfg_load(ps_bridge_cfg_t *s)
{
    memset(s, 0, sizeof *s); s->magic = PS_BRIDGE_MAGIC;
    nvs_handle_t h;
    if (nvs_open(PS_CFG_NVS_NS, NVS_READONLY, &h) != ESP_OK) return 0;
    ps_bridge_cfg_t stored; size_t size = sizeof stored;
    esp_err_t err = nvs_get_blob(h, PS_BRIDGE_NVS_KEY, &stored, &size);
    nvs_close(h);
    if (err != ESP_OK) return 0;
    if (size != sizeof stored || stored.magic != PS_BRIDGE_MAGIC) { ESP_LOGW(TAG, "bridge blob not recognised, unbound"); return 0; }
    memcpy(s, &stored, sizeof *s);
    ps_bridge_cfg_clamp(s);
    return 0;
}

int ps_bridge_cfg_save(const ps_bridge_cfg_t *s)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(PS_CFG_NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "nvs_open: %d", (int)err); return -1; }
    err = nvs_set_blob(h, PS_BRIDGE_NVS_KEY, s, sizeof *s);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "bridge save: %d", (int)err); return -1; }
    return 0;
}

int ps_presets_load(ps_presets_t *s)
{
    memset(s, 0, sizeof *s); s->magic = PS_PRESETS_MAGIC;
    nvs_handle_t h;
    if (nvs_open(PS_CFG_NVS_NS, NVS_READONLY, &h) != ESP_OK) return 0;
    ps_presets_t stored; size_t size = sizeof stored;
    esp_err_t err = nvs_get_blob(h, PS_PRESETS_NVS_KEY, &stored, &size);
    nvs_close(h);
    if (err != ESP_OK) return 0;                                   /* none yet, or a size that does not fit: empty */
    if (size != sizeof stored || stored.magic != PS_PRESETS_MAGIC) { ESP_LOGW(TAG, "presets blob not recognised, empty"); return 0; }
    memcpy(s, &stored, sizeof *s);
    ps_presets_clamp(s);
    return 0;
}
int ps_presets_save(const ps_presets_t *s)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(PS_CFG_NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "nvs_open: %d", (int)err); return -1; }
    err = nvs_set_blob(h, PS_PRESETS_NVS_KEY, s, sizeof *s);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "presets save failed: %d", (int)err); return -1; }
    return 0;
}

/* ---- B1, B2: the per-stage rows, their own blob like the presets ---- */
_Static_assert(sizeof(ps_stage_row_t) == 44 && sizeof(ps_stages_t) == PS_STAGES_SIZE, "the stages layout moved");
void ps_stages_clamp(ps_stages_t *s)
{
    s->magic = PS_STAGES_MAGIC;
    for (int i = 0; i < PS_GIF_SLOTS; i++) {
        ps_stage_row_t *r = &s->row[i];
        if (r->set > 1) r->set = 1;
        r->name[PS_PRESET_NAME - 1] = 0;
        fx_clamp(&r->fx);
    }
}
int ps_stages_load(ps_stages_t *s)
{
    memset(s, 0, sizeof *s); s->magic = PS_STAGES_MAGIC;
    nvs_handle_t h;
    if (nvs_open(PS_CFG_NVS_NS, NVS_READONLY, &h) != ESP_OK) return 0;
    ps_stages_t stored; size_t size = sizeof stored;
    esp_err_t err = nvs_get_blob(h, PS_STAGES_NVS_KEY, &stored, &size);
    nvs_close(h);
    if (err != ESP_OK) return 0;
    if (size != sizeof stored || stored.magic != PS_STAGES_MAGIC) { ESP_LOGW(TAG, "stages blob not recognised, none set"); return 0; }
    memcpy(s, &stored, sizeof *s);
    ps_stages_clamp(s);
    return 0;
}
int ps_stages_save(const ps_stages_t *s)
{
    nvs_handle_t h;
    esp_err_t err = nvs_open(PS_CFG_NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "nvs_open: %d", (int)err); return -1; }
    err = nvs_set_blob(h, PS_STAGES_NVS_KEY, s, sizeof *s);
    if (err == ESP_OK) err = nvs_commit(h);
    nvs_close(h);
    if (err != ESP_OK) { ESP_LOGE(TAG, "stages save failed: %d", (int)err); return -1; }
    return 0;
}

/* ---- colour on the wire: list2[0] entries are "RRGGBB", list2[1] entries "#RRGGBBAA" ---- */
void ps_rgba_to_wire(ps_rgba_t c, uint8_t mode, char *out)
{
    if (mode == PS_MODE_MUSIC) snprintf(out, 10, "%02X%02X%02X", c.r, c.g, c.b);
    else snprintf(out, 10, "#%02X%02X%02X%02X", c.r, c.g, c.b, c.a);
}

static int hexv(char ch) { if (ch >= '0' && ch <= '9') return ch - '0'; ch |= 0x20; if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10; return -1; }
bool ps_rgba_from_wire(const char *s, ps_rgba_t *out)
{
    if (!s) return false;
    if (*s == '#') s++;
    size_t n = strlen(s);
    if (n != 6 && n != 8) return false;
    uint8_t v[4] = { 0, 0, 0, 0xFF };
    for (size_t i = 0; i < n; i += 2) {
        int hi = hexv(s[i]), lo = hexv(s[i + 1]);
        if (hi < 0 || lo < 0) return false;
        v[i / 2] = (uint8_t)(hi * 16 + lo);
    }
    out->r = v[0]; out->g = v[1]; out->b = v[2]; out->a = v[3];
    return true;
}
