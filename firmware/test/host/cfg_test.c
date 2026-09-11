/* Host test for firmware/main/ps_cfg.c: the real file is included, so the blobs built here
 * are the shapes the firmware reads, not a copy. A fake NVS holds one blob per key.
 *
 *   bash firmware/test/host/run.sh      (or: make test-fw)
 *
 * Nothing here takes a device, a network or a serial cable. */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include "esp_err.h"
#include "nvs.h"

/* ---- fake NVS: a handful of keyed blobs ---- */
static struct { char key[16]; uint8_t data[4096]; size_t len; bool used; } store[8];
static int opened;
esp_err_t nvs_open(const char *ns, nvs_open_mode_t mode, nvs_handle_t *out) { (void)ns; (void)mode; *out = 1; opened++; return ESP_OK; }
static int find(const char *key) { for (int i = 0; i < 8; i++) if (store[i].used && !strcmp(store[i].key, key)) return i; return -1; }
esp_err_t nvs_get_blob(nvs_handle_t h, const char *key, void *out, size_t *len) {
    (void)h; int i = find(key); if (i < 0) return ESP_ERR_NVS_NOT_FOUND;
    if (out) { if (*len < store[i].len) return ESP_FAIL; memcpy(out, store[i].data, store[i].len); }
    *len = store[i].len; return ESP_OK;
}
esp_err_t nvs_set_blob(nvs_handle_t h, const char *key, const void *in, size_t len) {
    (void)h; int i = find(key); if (i < 0) for (i = 0; i < 8 && store[i].used; i++) {}
    if (i >= 8 || len > sizeof store[i].data) return ESP_FAIL;
    store[i].used = true; strncpy(store[i].key, key, 15); memcpy(store[i].data, in, len); store[i].len = len; return ESP_OK;
}
esp_err_t nvs_erase_all(nvs_handle_t h) { (void)h; memset(store, 0, sizeof store); return ESP_OK; }
esp_err_t nvs_commit(nvs_handle_t h) { (void)h; return ESP_OK; }
void nvs_close(nvs_handle_t h) { (void)h; opened--; }
static void wipe(void) { memset(store, 0, sizeof store); }
static void put(const void *blob, size_t len) { nvs_set_blob(1, "cfg", blob, len); }

/* the real module */
#include "ps_cfg.c"

static int pass, fail;
static void t(const char *name, int ok, long got) { if (ok) { pass++; printf("  ok    %s\n", name); } else { fail++; printf("  FAIL  %s   got: %ld\n", name, got); } }

static void fill_distinct(ps_cfg_t *c) {
    ps_cfg_factory_defaults(c);
    strcpy(c->wifi_ssid, "<T_SSID>"); strcpy(c->wifi_password, "<T_WIFI_PW>");
    strcpy(c->ap_ssid, "<T_AP>"); strcpy(c->ap_password, "<T_AP_PW>");
    strcpy(c->hostname, "t-host"); strcpy(c->printer_name, "T Printer"); strcpy(c->printer_sn, "<T_SN>"); strcpy(c->printer_access_code, "<T_CODE>");
    strcpy(c->language, "de"); c->ap_ip[3] = 9; c->printer_ip[0] = 192; c->printer_ip[1] = 0; c->printer_ip[2] = 2; c->printer_ip[3] = 20;
    c->ap_on = 0; c->current_mode = PS_MODE_MUSIC; c->features = 0x5;
    for (int m = 0; m < 2; m++) { c->mode[m].brightness = (uint8_t)(20 + 30 * m); c->mode[m].speed = (uint8_t)(35 + 30 * m); for (int i = 0; i < 3; i++) c->mode[m].colour[i] = (ps_rgba_t){ (uint8_t)(m * 100 + i), (uint8_t)(i * 40), (uint8_t)(200 - i), (uint8_t)(0x80 + m) }; }
    c->block_count = 3; for (int i = 0; i < 3; i++) { c->block[i].id = (uint8_t)(i * 2); c->block[i].colour = (ps_rgba_t){ (uint8_t)i, (uint8_t)(i + 1), (uint8_t)(i + 2), 0xFF }; }
}

int main(void)
{
    ps_cfg_t c, d, e;
    printf("sizeof(ps_cfg_t) = %zu, mode at %zu, block at %zu\n", sizeof(ps_cfg_t), offsetof(ps_cfg_t, mode), offsetof(ps_cfg_t, block));
    t("layout pinned to the literal in ps.h", sizeof(ps_cfg_t) == PS_CFG_SIZE, (long)sizeof(ps_cfg_t));

    /* 1. no blob: defaults */
    wipe(); memset(&c, 0xAA, sizeof c);
    t("load with no blob returns 0", ps_cfg_load(&c) == 0, 0);
    t("  and leaves the factory magic", c.magic == PS_CFG_MAGIC, c.magic);
    t("  and the factory hostname", !strcmp(c.hostname, "pandastatusos"), 0);
    t("  and H2D at 50%", c.current_mode == PS_MODE_H2D && c.mode[1].brightness == 50, c.mode[1].brightness);
    t("  and every feature bit off", c.features == 0, c.features);
    t("  every nvs handle closed", opened == 0, opened);

    /* 2. defaults write through the pointer only, and are idempotent */
    ps_cfg_factory_defaults(&d); ps_cfg_factory_defaults(&e);
    t("defaults are deterministic", memcmp(&d, &e, sizeof d) == 0, 0);

    /* 3. a v1 blob with a distinct value in every field survives a load */
    wipe(); fill_distinct(&d); put(&d, sizeof d);
    memset(&c, 0, sizeof c); ps_cfg_load(&c);
    t("v1 blob survives whole", memcmp(&c, &d, sizeof c) == 0, 0);
    t("  strings intact", !strcmp(c.wifi_password, "<T_WIFI_PW>") && !strcmp(c.printer_access_code, "<T_CODE>"), 0);
    t("  colours intact", c.mode[1].colour[2].r == 102 && c.mode[1].colour[2].a == 0x81, c.mode[1].colour[2].r);
    t("  blocks intact", c.block_count == 3 && c.block[2].id == 4 && c.block[2].colour.b == 4, c.block[2].id);

    /* 4. junk falls back to defaults: wrong magic, short blob, long blob, garbage */
    wipe(); fill_distinct(&d); d.magic = 0x12345678; put(&d, sizeof d); ps_cfg_load(&c);
    t("wrong magic: defaults", !strcmp(c.hostname, "pandastatusos") && c.magic == PS_CFG_MAGIC, 0);
    wipe(); fill_distinct(&d); put(&d, sizeof d - 8); ps_cfg_load(&c);
    t("short blob: defaults", !strcmp(c.hostname, "pandastatusos"), 0);
    wipe(); { uint8_t big[sizeof d + 16]; memcpy(big, &d, sizeof d); memset(big + sizeof d, 0, 16); put(big, sizeof big); } ps_cfg_load(&c);
    t("long blob: defaults", !strcmp(c.hostname, "pandastatusos"), 0);
    wipe(); { uint8_t junk[sizeof d]; for (size_t i = 0; i < sizeof junk; i++) junk[i] = (uint8_t)(i * 7 + 3); put(junk, sizeof junk); } ps_cfg_load(&c);
    t("garbage of the right size: defaults", !strcmp(c.hostname, "pandastatusos") && c.magic == PS_CFG_MAGIC, 0);

    /* 5. save then load is the identity, twice */
    wipe(); fill_distinct(&d); t("save returns 0", ps_cfg_save(&d) == 0, 0);
    ps_cfg_load(&c); t("load after save is identical", memcmp(&c, &d, sizeof c) == 0, 0);
    ps_cfg_save(&c); ps_cfg_load(&e); t("second round trip is identical", memcmp(&e, &d, sizeof e) == 0, 0);

    /* 6. values read from flash are clamped, with unterminated strings terminated */
    wipe(); fill_distinct(&d); d.current_mode = 7; d.block_count = 99; d.mode[0].brightness = 250; d.mode[1].speed = 101; d.ap_on = 2;
    memset(d.hostname, 'h', sizeof d.hostname); memset(d.printer_access_code, 'c', sizeof d.printer_access_code);
    put(&d, sizeof d); ps_cfg_load(&c);
    t("mode index clamped", c.current_mode == PS_MODE_H2D, c.current_mode);
    t("block count clamped", c.block_count == PS_BLOCKS_MAX, c.block_count);
    t("brightness and speed clamped", c.mode[0].brightness == 100 && c.mode[1].speed == 100, c.mode[0].brightness);
    t("ap_on clamped", c.ap_on == 1, c.ap_on);
    t("strings terminated", strlen(c.hostname) == sizeof c.hostname - 1 && strlen(c.printer_access_code) == sizeof c.printer_access_code - 1, (long)strlen(c.hostname));

    /* 7. erase */
    wipe(); fill_distinct(&d); put(&d, sizeof d); ps_cfg_erase(); ps_cfg_load(&c);
    t("erase then load: defaults", !strcmp(c.hostname, "pandastatusos"), 0);

    /* 8. colour on the wire */
    char w[10]; ps_rgba_t x = { 0xFF, 0x00, 0xAA, 0x80 };
    ps_rgba_to_wire(x, PS_MODE_MUSIC, w); t("mode 0 colour is bare RRGGBB", !strcmp(w, "FF00AA"), 0);
    ps_rgba_to_wire(x, PS_MODE_H2D, w);   t("mode 1 colour is #RRGGBBAA", !strcmp(w, "#FF00AA80"), 0);
    ps_rgba_t y;
    t("parses bare lowercase", ps_rgba_from_wire("ff00aa", &y) && y.r == 0xFF && y.b == 0xAA && y.a == 0xFF, y.a);
    t("parses #RRGGBBAA", ps_rgba_from_wire("#1B00FF80", &y) && y.r == 0x1B && y.g == 0 && y.b == 0xFF && y.a == 0x80, y.a);
    t("parses 8 hex without #", ps_rgba_from_wire("1B00FF80", &y) && y.a == 0x80, y.a);
    t("rejects the wrong length", !ps_rgba_from_wire("#12345", &y) && !ps_rgba_from_wire("", &y) && !ps_rgba_from_wire(NULL, &y), 0);
    t("rejects non-hex", !ps_rgba_from_wire("GG0000", &y), 0);

    /* 9. the v1 layout migrates: a 492-byte PS01 blob loads, every field survives, the v2
     *    field takes its default, and the blob is written back as v2 so it runs once */
    {
        ps_cfg_v1_t o; memset(&o, 0, sizeof o);
        fill_distinct(&d);
        memcpy(&o, &d, sizeof o);                      /* the v1 layout is the first 492 bytes of v2 */
        o.magic = PS_CFG_MAGIC_V1;
        wipe(); put(&o, sizeof o);
        t("v1 blob is 492 bytes", sizeof o == 492, (long)sizeof o);
        memset(&c, 0xAA, sizeof c);
        t("load of a v1 blob returns 0", ps_cfg_load(&c) == 0, 0);
        t("v1 -> v3: every v1 field survives", !strcmp(c.hostname, "t-host") && c.features == 0x5 && c.current_mode == PS_MODE_MUSIC && c.block_count == 3
          && c.mode[1].speed == 65 && c.mode[1].colour[2].a == 0x81 && c.block[2].colour.b == 4 && !strcmp(c.printer_access_code, "<T_CODE>") && c.printer_ip[3] == 20, c.mode[1].speed);
        t("v1 -> v3: the v2 field takes its default", c.state_brightness[0][0] == 50 && c.state_brightness[1][2] == 50, c.state_brightness[1][2]);
        t("v1 -> v3: the effects take their defaults in the migrated H2D colours", c.fx[0].effect == PS_FX_STATIC && c.fx[2].colour[0].r == 102 && c.fx[2].colour[1].a == 0x81 && c.fx[1].colour[2].r == 0 && c.fx[1].speed == 100, c.fx[2].colour[0].r);
        t("v1 -> v3: the magic is now v3", c.magic == PS_CFG_MAGIC_V3, (long)c.magic);
        size_t n = 0; nvs_get_blob(1, "cfg", NULL, &n);
        t("v1 -> v3: saved back as a v3 blob", n == sizeof(ps_cfg_t), (long)n);
        memset(&e, 0, sizeof e); ps_cfg_load(&e);
        t("the migrated blob loads again as v3 with the same values", !strcmp(e.hostname, "t-host") && e.magic == PS_CFG_MAGIC_V3 && e.state_brightness[0][0] == 50 && e.mode[1].speed == 65, e.mode[1].speed);
    }

    /* 9b. the v2 layout migrates the same way, carrying its own field */
    {
        ps_cfg_v2_t o; memset(&o, 0, sizeof o);
        fill_distinct(&d); d.state_brightness[1][1] = 77; d.state_brightness[0][2] = 9;
        memcpy(&o, &d, sizeof o);                      /* the v2 layout is the first 500 bytes of v3 */
        o.magic = PS_CFG_MAGIC_V2;
        wipe(); put(&o, sizeof o);
        t("v2 blob is 500 bytes", sizeof o == 500, (long)sizeof o);
        memset(&c, 0xAA, sizeof c);
        t("load of a v2 blob returns 0", ps_cfg_load(&c) == 0, 0);
        t("v2 -> v3: every v2 field survives", !strcmp(c.hostname, "t-host") && c.features == 0x5 && c.state_brightness[1][1] == 77 && c.state_brightness[0][2] == 9 && c.block[2].colour.b == 4, c.state_brightness[1][1]);
        t("v2 -> v3: the effects take their defaults in the migrated H2D colours", c.fx[1].effect == PS_FX_STATIC && c.fx[1].colour[0].r == 101 && c.fx[1].colour[1].r == 101 && c.fx[0].brightness == 50, c.fx[1].colour[0].r);
        t("v2 -> v3: the magic is now v3", c.magic == PS_CFG_MAGIC_V3, (long)c.magic);
        size_t n = 0; nvs_get_blob(1, "cfg", NULL, &n);
        t("v2 -> v3: saved back as a v3 blob", n == sizeof(ps_cfg_t), (long)n);
    }

    /* 10. the v2 field: round trip and clamp */
    fill_distinct(&d); d.state_brightness[1][1] = 80; d.state_brightness[0][2] = 5; wipe(); put(&d, sizeof d); ps_cfg_load(&c);
    t("state_brightness round-trips", c.state_brightness[1][1] == 80 && c.state_brightness[0][2] == 5, c.state_brightness[1][1]);
    fill_distinct(&d); d.state_brightness[0][1] = 250; wipe(); put(&d, sizeof d); ps_cfg_load(&c);
    t("state_brightness clamped to 100", c.state_brightness[0][1] == 100, c.state_brightness[0][1]);
    t("a fresh default leaves the feature bits at zero and the per-state values at the global default", (ps_cfg_factory_defaults(&d), d.features == 0 && d.state_brightness[1][1] == 50), d.features);

    /* 11. the v3 block: round trip and clamp */
    fill_distinct(&d); d.fx[1].effect = PS_FX_WAVE; d.fx[1].brightness = 20; d.fx[2].opt = 0x11; d.fx[0].colour[3] = (ps_rgba_t){ 1, 2, 3, 4 };
    wipe(); put(&d, sizeof d); ps_cfg_load(&c);
    t("state effects round-trip", c.fx[1].effect == PS_FX_WAVE && c.fx[1].brightness == 20 && c.fx[2].opt == 0x11 && c.fx[0].colour[3].b == 3, c.fx[1].effect);
    fill_distinct(&d); d.fx[0].effect = 200; d.fx[1].brightness = 250; d.fx[2].bright_end = 101; wipe(); put(&d, sizeof d); ps_cfg_load(&c);
    t("an effect id out of range clamps to solid, the numbers to 100", c.fx[0].effect == PS_FX_STATIC && c.fx[1].brightness == 100 && c.fx[2].bright_end == 100, c.fx[0].effect);
    t("a fresh default's effects are solid in the H2D colours with the inactive colours black", (ps_cfg_factory_defaults(&d), d.fx[2].effect == PS_FX_STATIC && d.fx[2].colour[0].r == 0xFF && d.fx[2].colour[0].g == 0 && d.fx[2].colour[2].r == 0), d.fx[2].colour[0].g);

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
