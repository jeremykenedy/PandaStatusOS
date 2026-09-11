/* Config blob: one NVS entry, a magic that is the version, matched first, corroborated
 * by size. Defaults are written first, then the stored layout is overlaid field by field,
 * never by a prefix copy: a struct that grows in the middle moves every byte after it.
 *
 * The chain below has one arm today. The day a second layout exists:
 *   1. copy the current ps_cfg_t into this file as ps_cfg_v1_t, static, with its own
 *      _Static_assert on the literal size, referencing NO live type and NO live count;
 *   2. define PS_CFG_MAGIC_V2, point PS_CFG_MAGIC at it;
 *   3. add the v1 arm: defaults, overlay every v1 field, set what v2 added, save;
 *   4. extend firmware/test/host/cfg_test.c with a v1 blob that must survive.
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

/* The layout is pinned to a literal. If this fails, the layout changed: freeze, bump,
 * migrate; do not edit the number. */
_Static_assert(sizeof(ps_cfg_t) == PS_CFG_SIZE, "ps_cfg_t changed size: freeze v1, bump the magic, add a migration arm");
_Static_assert(offsetof(ps_cfg_t, magic) == 0, "magic must be the first field of every stored layout");
_Static_assert(offsetof(ps_cfg_t, features) == 4, "features moved");
_Static_assert(offsetof(ps_cfg_t, mode) == 340, "mode[] moved");
_Static_assert(offsetof(ps_cfg_t, block) == 372, "block[] moved");
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
 * factory reset (CLAUDE.md, Phase 1, last bullet). Until that read, these are the values
 * the factory page expects after a lighting reset (docs/protocol-websocket.md) and the
 * mock's factory fixture. Writes through c only. */
void ps_cfg_factory_defaults(ps_cfg_t *c)
{
    memset(c, 0, sizeof(*c));
    c->magic = PS_CFG_MAGIC;
    c->features = 0;                                   /* parity */
    /* The factory's default hostname and hotspot name are unknown until the bench session
     * reads them (JEREMY-QUEUE item 3). Under the parity rule both defaults must match the
     * factory; these are placeholders until then, and the hotspot name is deliberately not
     * renamed with the project (D-027). */
    set_str(c->hostname, sizeof c->hostname, "pandastatusos");
    set_str(c->ap_ssid, sizeof c->ap_ssid, "PandaStatus");
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
    }
    /* strings must terminate: a blob from a different build could carry a full array */
    c->wifi_ssid[sizeof c->wifi_ssid - 1] = 0;         c->wifi_password[sizeof c->wifi_password - 1] = 0;
    c->ap_ssid[sizeof c->ap_ssid - 1] = 0;             c->ap_password[sizeof c->ap_password - 1] = 0;
    c->hostname[sizeof c->hostname - 1] = 0;           c->printer_name[sizeof c->printer_name - 1] = 0;
    c->printer_sn[sizeof c->printer_sn - 1] = 0;       c->printer_access_code[sizeof c->printer_access_code - 1] = 0;
    c->language[sizeof c->language - 1] = 0;
}

int ps_cfg_load(ps_cfg_t *c)
{
    ps_cfg_factory_defaults(c);                        /* the no-blob and bad-blob paths cost nothing more */
    nvs_handle_t h;
    esp_err_t err = nvs_open(PS_CFG_NVS_NS, NVS_READONLY, &h);
    if (err != ESP_OK) { ESP_LOGI(TAG, "no config namespace yet, defaults"); return 0; }
    union { ps_cfg_t v1; uint8_t raw[PS_CFG_NVS_BUDGET]; } stored;
    size_t size = sizeof(stored);
    err = nvs_get_blob(h, PS_CFG_NVS_KEY, &stored, &size);
    nvs_close(h);
    if (err != ESP_OK) { ESP_LOGI(TAG, "no config blob, defaults"); return 0; }

    /* newest first; a future v2 arm goes ABOVE this one */
    if (size == sizeof(ps_cfg_t) && stored.v1.magic == PS_CFG_MAGIC_V1) {
        memcpy(c, &stored.v1, sizeof(*c));             /* the current layout: whole, then clamped */
        ps_cfg_clamp(c);
        return 0;
    }
    ESP_LOGW(TAG, "config blob not recognised (magic %08x, %u bytes), defaults", (unsigned)stored.v1.magic, (unsigned)size);
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
