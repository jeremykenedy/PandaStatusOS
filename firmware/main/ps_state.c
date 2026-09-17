/* The state document and the inbound dispatcher. Every shape here is from
 * docs/protocol-websocket.md; the INFERENCE marks are the mock's (tools/ui/mock, D-014)
 * and fall to the bench capture. */
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include "esp_log.h"
#include "cJSON.h"
#include "esp_wifi.h"
#include "esp_timer.h"
#include "ps.h"

static const char *TAG = "ps_state";
ps_state_t g_ps;

void ps_state_init(void)
{
    memset(&g_ps, 0, sizeof g_ps);
    g_ps.print_percent = -1;                          /* after the memset: no report yet */
    g_ps.layer_num = g_ps.layer_total = -1;
    g_ps.remain_min = -1;
    g_ps.spd_lvl = -1;
    g_ps.light_chamber = g_ps.light_work = -1;
    g_ps.fan_part = g_ps.fan_aux = g_ps.fan_chamber = -1;
    g_ps.filament_in = -1;
    g_ps.ams_humidity = -1;
    g_ps.ams_temp_c = PS_TEMP_NONE;
    g_ps.gcode_state[0] = g_ps.hms_code[0] = g_ps.printer_rssi[0] = 0;
    g_ps.nozzle_type[0] = g_ps.nozzle_dia[0] = 0;
    for (int i = 0; i < PS_TEMP_COUNT; i++) g_ps.temp_c[i] = PS_TEMP_NONE;
    ps_cfg_load(&g_ps.cfg);
    ps_presets_load(&g_ps.presets);                   /* A14: the named effects, or an empty list */
    ps_stages_load(&g_ps.stages);                     /* B1, B2: the per-stage rows, or none set */
    ps_netcfg_load(&g_ps.netcfg);                     /* C9: the fixed address, or DHCP */
    g_ps.stg_cur = -1; g_ps.stage = 0; g_ps.pin_stage = -1;
    g_ps.sta_state = g_ps.cfg.wifi_ssid[0] ? PS_STA_CONNECTING : PS_STA_NOSSID;
    g_ps.printer_state = g_ps.cfg.printer_sn[0] || g_ps.cfg.printer_ip[0] ? PS_PRN_CONNECTING : PS_PRN_INVALID;
    g_ps.printer_scan = PS_PSCAN_IDLE;
    g_ps.wifi_scan = PS_WSCAN_IDLE;
    g_ps.bar_state = PS_BAR_IDLE;
}

static void ip_str(const uint8_t ip[4], char *out, size_t n) { if (ip[0] || ip[1] || ip[2] || ip[3]) snprintf(out, n, "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]); else out[0] = 0; }
static bool ip_parse(const char *s, uint8_t out[4]) { unsigned a, b, c, d; if (!s || sscanf(s, "%u.%u.%u.%u", &a, &b, &c, &d) != 4 || a > 255 || b > 255 || c > 255 || d > 255) return false; out[0] = a; out[1] = b; out[2] = c; out[3] = d; return true; }

/* ---- the document ---- */
static cJSON *root_wifi(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "ssid", g_ps.cfg.wifi_ssid);
    cJSON_AddStringToObject(o, "password", g_ps.cfg.wifi_password);   /* FACT: the push carries it */
    cJSON_AddNumberToObject(o, "scan", g_ps.wifi_scan);
    if (g_ps.wifi_scan == PS_WSCAN_DONE) {
        cJSON *l = cJSON_AddArrayToObject(o, "list");                   /* entry shape INFERENCE */
        for (int i = 0; i < g_ps.wifi_hits; i++) { cJSON *e = cJSON_CreateObject(); cJSON_AddStringToObject(e, "ssid", g_ps.wifi_list[i].ssid); cJSON_AddNumberToObject(e, "rssi", g_ps.wifi_list[i].rssi); cJSON_AddItemToArray(l, e); }
    }
    return o;
}
static cJSON *root_sta(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "ip", g_ps.sta_ip);
    cJSON_AddStringToObject(o, "hostname", g_ps.cfg.hostname);
    cJSON_AddNumberToObject(o, "state", g_ps.sta_state);
    cJSON_AddNumberToObject(o, "auth_err_reason", g_ps.auth_err_reason);
    /* The signal, when there is a link to have one. An addition of the clone's own: the
     * factory's document does not carry it, and the socket document is pinned to the
     * factory's six ROOTS, not to their exact members, so a member the page needs and the
     * device already knows belongs here rather than on a route of its own. 0 means the
     * radio gave no reading, which a bar of dBm cannot be confused with. */
    if (g_ps.sta_state == PS_STA_CONNECTED) {
        wifi_ap_record_t ap;
        if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) cJSON_AddNumberToObject(o, "rssi", ap.rssi);
    }
    return o;
}
static cJSON *root_ap(void)
{
    char ip[16]; ip_str(g_ps.cfg.ap_ip, ip, sizeof ip);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "ssid", g_ps.cfg.ap_ssid);
    cJSON_AddStringToObject(o, "password", g_ps.cfg.ap_password);
    cJSON_AddStringToObject(o, "ip", ip);
    cJSON_AddNumberToObject(o, "on", g_ps.cfg.ap_on);
    return o;
}
static cJSON *root_printer(void)
{
    char ip[16]; ip_str(g_ps.cfg.printer_ip, ip, sizeof ip);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "name", g_ps.cfg.printer_name);
    cJSON_AddStringToObject(o, "sn", g_ps.cfg.printer_sn);
    cJSON_AddStringToObject(o, "access_code", g_ps.cfg.printer_access_code);
    cJSON_AddStringToObject(o, "ip", ip);
    cJSON_AddNumberToObject(o, "state", g_ps.printer_state);
    cJSON_AddNumberToObject(o, "scan", g_ps.printer_scan);
    if (g_ps.printer_scan == PS_PSCAN_DONE) {
        cJSON *l = cJSON_AddArrayToObject(o, "list");                   /* entry shape INFERENCE */
        for (int i = 0; i < g_ps.printer_hits; i++) { cJSON *e = cJSON_CreateObject(); cJSON_AddStringToObject(e, "name", g_ps.printer_list[i].name); cJSON_AddStringToObject(e, "ip", g_ps.printer_list[i].ip);
            /* the serial as well: the announcement carries it, and it is what the bind form
               otherwise makes a person copy off the printer by hand. The factory's own list
               shape is an INFERENCE and was never seen carrying anything, because the factory
               has no discovery either. */
            cJSON_AddStringToObject(e, "sn", g_ps.printer_list[i].sn); cJSON_AddItemToArray(l, e); }
    }
    /* What the printer says it is doing, as opposed to what it is called. Only the members
     * the printer has actually reported go in: a light it never mentioned is absent, and the
     * page draws an absent light as unknown rather than as off. */
    cJSON *st = cJSON_AddObjectToObject(o, "status");
    if (g_ps.light_chamber >= 0) cJSON_AddNumberToObject(st, "printer_light", g_ps.light_chamber);
    /* work_light is read but not published. The printer this device is built against names a
     * work_light node in its report and has no such lamp: the node is in the report whether
     * the machine has the light or not, so publishing it put a second switch on the card for
     * a light that does not exist. One lamp, one switch. */
    if (g_ps.temp_c[PS_TEMP_NOZZLE]  != PS_TEMP_NONE) cJSON_AddNumberToObject(st, "nozzle_temp", g_ps.temp_c[PS_TEMP_NOZZLE]);
    if (g_ps.temp_c[PS_TEMP_BED]     != PS_TEMP_NONE) cJSON_AddNumberToObject(st, "bed_temp", g_ps.temp_c[PS_TEMP_BED]);
    if (g_ps.temp_c[PS_TEMP_CHAMBER] != PS_TEMP_NONE) cJSON_AddNumberToObject(st, "chamber_temp", g_ps.temp_c[PS_TEMP_CHAMBER]);
    if (g_ps.fan_part    >= 0) cJSON_AddNumberToObject(st, "fan_part", g_ps.fan_part);
    if (g_ps.fan_aux     >= 0) cJSON_AddNumberToObject(st, "fan_aux", g_ps.fan_aux);
    if (g_ps.fan_chamber >= 0) cJSON_AddNumberToObject(st, "fan_chamber", g_ps.fan_chamber);
    if (g_ps.filament_in >= 0) cJSON_AddNumberToObject(st, "filament_in", g_ps.filament_in);
    if (g_ps.ams_humidity >= 0) cJSON_AddNumberToObject(st, "ams_humidity", g_ps.ams_humidity);
    if (g_ps.ams_temp_c != PS_TEMP_NONE) cJSON_AddNumberToObject(st, "ams_temp", g_ps.ams_temp_c);
    /* The page holds the six state words and their translations by number, so the printer's
     * word is turned into that number here rather than sending a word the page cannot name.
     * SLICING sits with PREPARE: both are the printer getting ready. */
    if (g_ps.gcode_state[0]) {
        const char *g = g_ps.gcode_state; int ds = -1;
        if      (!strcmp(g, "IDLE"))    ds = 0;
        else if (!strcmp(g, "PREPARE") || !strcmp(g, "SLICING")) ds = 1;
        else if (!strcmp(g, "RUNNING")) ds = 2;
        else if (!strcmp(g, "PAUSE"))   ds = 3;
        else if (!strcmp(g, "FINISH"))  ds = 4;
        else if (!strcmp(g, "FAILED"))  ds = 5;
        if (ds >= 0) cJSON_AddNumberToObject(st, "device_state", ds);
    }
    if (g_ps.hms_code[0])     cJSON_AddStringToObject(st, "hms_code", g_ps.hms_code);
    if (g_ps.printer_rssi[0]) cJSON_AddStringToObject(st, "printer_rssi", g_ps.printer_rssi);
    if (g_ps.nozzle_dia[0])   cJSON_AddStringToObject(st, "nozzle_dia", g_ps.nozzle_dia);
    /* The page reads the nozzle as the letter code it has words for: the material letter, and
     * a flow letter when there is one. The printer names the material in full, so it is the
     * first letter of that word that carries over, and nothing is invented for flow. */
    if (g_ps.nozzle_type[0]) {
        char kind[3] = { 0, 0, 0 };
        if      (!strncmp(g_ps.nozzle_type, "hardened", 8))  kind[0] = 'H';
        else if (!strncmp(g_ps.nozzle_type, "stainless", 9)) kind[0] = 'S';
        if (kind[0]) cJSON_AddStringToObject(st, "nozzle_kind", kind);
        else cJSON_AddStringToObject(st, "nozzle_kind", g_ps.nozzle_type);
    }
    /* This device's own signal belongs on the same card, beside the printer's, because the
     * card is about the link between the two. It is read where the sta root reads it. */
    { wifi_ap_record_t ap; if (g_ps.sta_state == PS_STA_CONNECTED && esp_wifi_sta_get_ap_info(&ap) == ESP_OK) cJSON_AddNumberToObject(st, "wifi_rssi", ap.rssi); }
    cJSON_AddNumberToObject(st, "uptime_s", (double)(esp_timer_get_time() / 1000000));
    return o;
}
static cJSON *root_settings(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON *l2 = cJSON_AddArrayToObject(o, "list2");
    for (int m = 0; m < 2; m++) {
        cJSON *e = cJSON_CreateObject();
        cJSON_AddNumberToObject(e, "brightness", g_ps.cfg.mode[m].brightness);
        /* Speed goes out too. The factory's observed push had no speed key, and leaving it
         * out to match meant the page's own Speed row read as a dash forever while the
         * slider beside it moved a value the device was storing. This is the clone's own
         * addition, not parity: a page that cannot read back what it just wrote is broken,
         * and nothing in the factory page reads this key. */
        cJSON_AddNumberToObject(e, "speed", g_ps.cfg.mode[m].speed);
        cJSON *c = cJSON_AddArrayToObject(e, "rgb_rgba");
        for (int i = 0; i < 3; i++) { char w[10]; ps_rgba_to_wire(g_ps.cfg.mode[m].colour[i], (uint8_t)m, w); cJSON_AddItemToArray(c, cJSON_CreateString(w)); }
        cJSON_AddItemToArray(l2, e);
    }
    cJSON_AddNumberToObject(o, "current_mode", g_ps.cfg.current_mode);
    cJSON_AddStringToObject(o, "fw_version", PS_FW_VERSION);
    cJSON_AddStringToObject(o, "language", g_ps.cfg.language);
    if (g_ps.img_version[0]) cJSON_AddStringToObject(o, "img_version", g_ps.img_version);   /* never observed; sent only once known */
    return o;
}
static cJSON *root_block(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON *l = cJSON_AddArrayToObject(o, "blocklist");
    for (int i = 0; i < g_ps.cfg.block_count; i++) {
        cJSON *e = cJSON_CreateObject(); char w[10];
        cJSON_AddNumberToObject(e, "blockID", g_ps.cfg.block[i].id);
        ps_rgba_to_wire(g_ps.cfg.block[i].colour, PS_MODE_H2D, w);     /* blockrgba is #RRGGBBAA, FACT */
        cJSON_AddStringToObject(e, "blockrgba", w);
        cJSON_AddItemToArray(l, e);
    }
    return o;
}

char *ps_state_json(uint32_t roots)
{
    cJSON *doc = cJSON_CreateObject();
    if (roots & PS_ROOT_WIFI)     cJSON_AddItemToObject(doc, "wifi", root_wifi());
    if (roots & PS_ROOT_STA)      cJSON_AddItemToObject(doc, "sta", root_sta());
    if (roots & PS_ROOT_AP)       cJSON_AddItemToObject(doc, "ap", root_ap());
    if (roots & PS_ROOT_PRINTER)  cJSON_AddItemToObject(doc, "printer", root_printer());
    if (roots & PS_ROOT_SETTINGS) cJSON_AddItemToObject(doc, "settings", root_settings());
    if (roots & PS_ROOT_BLOCK)    cJSON_AddItemToObject(doc, "block", root_block());
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return s;
}

/* ---- inbound ---- */
static int num(cJSON *o, const char *k, int dflt) { cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k); return cJSON_IsNumber(v) ? (int)v->valuedouble : dflt; }
static const char *str(cJSON *o, const char *k) { cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k); return cJSON_IsString(v) ? v->valuestring : NULL; }
static bool has(cJSON *o, const char *k) { return cJSON_GetObjectItemCaseSensitive(o, k) != NULL; }
static void copy_str(char *dst, size_t n, const char *src) { if (!src) return; strncpy(dst, src, n - 1); dst[n - 1] = 0; }
static int clamp100(int v) { return v < 0 ? 0 : v > 100 ? 100 : v; }

static uint32_t apply_settings(cJSON *m, int client)
{
    ps_cfg_t *c = &g_ps.cfg;
    if (has(m, "rgb_reset")) {
        /* FACT: the factory page never sends this in Music mode. What the device does with it
         * there is INFERENCE (mock: no-op); here it is honoured only in H2D. */
        if (c->current_mode == PS_MODE_MUSIC) return 0;
        ps_cfg_t d; ps_cfg_factory_defaults(&d);
        for (int i = 0; i < 2; i++) c->mode[i] = d.mode[i];
        ps_cfg_save(c); ps_effect_notify();
        return PS_ROOT_SETTINGS;
    }
    if (has(m, "reset")) { ps_restart("settings.reset"); return 0; }
    if (has(m, "factory_reset")) {
        ps_ws_response("factory_reset", true, NULL, client);
        ps_cfg_erase();
        ps_restart("settings.factory_reset");
        return 0;
    }
    uint32_t changed = 0;
    const char *rgba = str(m, "rgb_rgba");
    if (has(m, "rgb_info_mode") && !rgba) {
        int v = num(m, "rgb_info_mode", -1);
        if (v == PS_MODE_MUSIC || v == PS_MODE_H2D) { c->current_mode = (uint8_t)v; changed |= PS_ROOT_SETTINGS; }
    }
    if (has(m, "rgb_info_brightness")) { c->mode[c->current_mode].brightness = (uint8_t)clamp100(num(m, "rgb_info_brightness", 0)); changed |= PS_ROOT_SETTINGS; }
    if (has(m, "rgb_info_speed")) { c->mode[c->current_mode].speed = (uint8_t)clamp100(num(m, "rgb_info_speed", 0)); changed |= PS_ROOT_SETTINGS; }
    if (rgba && has(m, "rgb_state_index")) {
        int idx = num(m, "rgb_state_index", -1);
        int tgt = has(m, "rgb_info_mode") ? num(m, "rgb_info_mode", -1) : c->current_mode;
        ps_rgba_t col;
        if (idx >= 0 && idx < 3 && (tgt == 0 || tgt == 1) && ps_rgba_from_wire(rgba, &col)) { c->mode[tgt].colour[idx] = col; changed |= PS_ROOT_SETTINGS; }
    }
    const char *lang = str(m, "language");
    if (lang) { copy_str(c->language, sizeof c->language, lang); changed |= PS_ROOT_SETTINGS; }
    /* settings.on, settings.follow, settings.printing_ui_type: handled inbound by the factory
     * page, sent by no control of it (FACT). Not honoured here: the parity rule. */
    if (changed) { ps_cfg_save(c); ps_effect_notify(); }
    return changed;
}

static uint32_t apply_wifi(cJSON *m, int client)
{
    (void)client;
    if (has(m, "scan")) { ps_wifi_scan(); return PS_ROOT_WIFI; }
    const char *ssid = str(m, "ssid");
    if (ssid) {
        copy_str(g_ps.cfg.wifi_ssid, sizeof g_ps.cfg.wifi_ssid, ssid);
        const char *pw = str(m, "password"); if (pw) copy_str(g_ps.cfg.wifi_password, sizeof g_ps.cfg.wifi_password, pw);
        ps_cfg_save(&g_ps.cfg);
        g_ps.sta_state = PS_STA_CONNECTING;
        ps_wifi_connect(g_ps.cfg.wifi_ssid, g_ps.cfg.wifi_password);
        return PS_ROOT_WIFI | PS_ROOT_STA;
    }
    return 0;
}

static uint32_t apply_sta(cJSON *m, int client)
{
    const char *h = str(m, "hostname");
    if (h) {
        copy_str(g_ps.cfg.hostname, sizeof g_ps.cfg.hostname, h);
        bool ok = ps_cfg_save(&g_ps.cfg) == 0;
        ps_wifi_set_hostname(g_ps.cfg.hostname);
        ps_ws_response("set_hostname", ok, NULL, client);   /* the page's OK then sends settings.reset */
    }
    return 0;
}

static uint32_t apply_ap(cJSON *m, int client)
{
    ps_cfg_t *c = &g_ps.cfg;
    if (has(m, "on") && !has(m, "ssid")) {
        int v = num(m, "on", -1);
        if (v == 0 || v == 1) { c->ap_on = (uint8_t)v; ps_cfg_save(c); ps_wifi_ap_apply(); return PS_ROOT_AP; }
        return 0;
    }
    const char *ssid = str(m, "ssid");
    if (ssid) {
        uint8_t ip[4]; bool ip_changed = false;
        const char *ips = str(m, "ip");
        if (ips && ip_parse(ips, ip) && memcmp(ip, c->ap_ip, 4) != 0) { memcpy(c->ap_ip, ip, 4); ip_changed = true; }
        copy_str(c->ap_ssid, sizeof c->ap_ssid, ssid);
        const char *pw = str(m, "password"); if (pw) copy_str(c->ap_password, sizeof c->ap_password, pw);
        bool ok = ps_cfg_save(c) == 0;
        ps_wifi_ap_apply();
        /* which response an ap message earns: INFERENCE (D-014): set_hotspot_ip when the
         * address changed, else set_ap. The page restarts the device on set_hotspot_ip. */
        ps_ws_response(ip_changed ? "set_hotspot_ip" : "set_ap", ok, NULL, client);
    }
    return 0;
}

static uint32_t apply_printer(cJSON *m, int client)
{
    (void)client;
    ps_cfg_t *c = &g_ps.cfg;
    if (has(m, "scan")) { ps_printer_scan(); return PS_ROOT_PRINTER; }
    if (has(m, "disconnect")) { ps_printer_unbind(); g_ps.printer_state = PS_PRN_INVALID; return PS_ROOT_PRINTER; }
    if (has(m, "sn") || has(m, "ip")) {
        copy_str(c->printer_name, sizeof c->printer_name, str(m, "name"));
        copy_str(c->printer_sn, sizeof c->printer_sn, str(m, "sn"));
        copy_str(c->printer_access_code, sizeof c->printer_access_code, str(m, "access_code"));
        const char *ips = str(m, "ip"); uint8_t ip[4] = { 0, 0, 0, 0 };
        if (ips && ip_parse(ips, ip)) memcpy(c->printer_ip, ip, 4); else memset(c->printer_ip, 0, 4);
        ps_cfg_save(c);
        g_ps.printer_state = PS_PRN_CONNECTING;
        ps_printer_bind();
        return PS_ROOT_PRINTER;
    }
    return 0;
}

/* The page asking the printer to switch a light: { light:"chamber_light"|"work_light", on:0|1 }.
 *
 * Nothing is stored and no root is marked changed. The command goes to the printer and the
 * printer's own telemetry is what moves the switch back on the page, so a command the printer
 * refuses leaves the page showing the truth rather than the request. The page holds the
 * flipped switch against stale pushes for a few seconds on its own. */
static uint32_t apply_printer_ctl(cJSON *m, int client)
{
    (void)client;
    const char *light = str(m, "light");
    if (!light || !has(m, "on")) return 0;
    int on = num(m, "on", -1);
    if (on != 0 && on != 1) return 0;
    ps_printer_light_set(light, on);
    return 0;
}

static uint32_t apply_block(cJSON *m, int client)
{
    (void)client;
    if (!has(m, "blockID") || !has(m, "blockrgba")) return 0;
    int id = num(m, "blockID", -1); ps_rgba_t col;
    if (id < 0 || id > 255 || !ps_rgba_from_wire(str(m, "blockrgba"), &col)) return 0;
    ps_cfg_t *c = &g_ps.cfg;
    for (int i = 0; i < c->block_count; i++) if (c->block[i].id == id) { c->block[i].colour = col; ps_cfg_save(c); ps_effect_notify(); return PS_ROOT_BLOCK; }
    if (c->block_count < PS_BLOCKS_MAX) { c->block[c->block_count].id = (uint8_t)id; c->block[c->block_count].colour = col; c->block_count++; ps_cfg_save(c); ps_effect_notify(); return PS_ROOT_BLOCK; }
    return 0;
}

uint32_t ps_state_apply(const char *json, size_t len, int client)
{
    cJSON *frame = cJSON_ParseWithLength(json, len);
    if (!frame) { ESP_LOGW(TAG, "inbound frame is not JSON"); return 0; }
    uint32_t changed = 0;
    for (cJSON *root = frame->child; root; root = root->next) {
        if (!cJSON_IsObject(root)) continue;
        /* device_wakeup:1 rides on every frame the factory page sends (FACT); its absence
         * is logged and the frame is honoured anyway, the mock's default. */
        if (!has(root, "device_wakeup")) ESP_LOGW(TAG, "%s without device_wakeup", root->string);
        if (!strcmp(root->string, "settings")) changed |= apply_settings(root, client);
        else if (!strcmp(root->string, "wifi")) changed |= apply_wifi(root, client);
        else if (!strcmp(root->string, "sta")) changed |= apply_sta(root, client);
        else if (!strcmp(root->string, "ap")) changed |= apply_ap(root, client);
        else if (!strcmp(root->string, "printer")) changed |= apply_printer(root, client);
        else if (!strcmp(root->string, "block")) changed |= apply_block(root, client);
        else if (!strcmp(root->string, "printer_ctl")) changed |= apply_printer_ctl(root, client);
        else ESP_LOGW(TAG, "unknown root %s", root->string);
    }
    cJSON_Delete(frame);
    return changed;
}
