/* Host test for firmware/main/ps_state.c: the six-root document and the inbound
 * dispatcher, compiled on the host with the real ps_cfg.c and the IDF's own cJSON, and
 * the other modules replaced by recorders. Every shape asserted here is the one the
 * protocol document states and the mock reproduces, so this is gate 2 and gate 4
 * evidence at the level the host can give it: the bytes the firmware would put on the
 * wire, and what each inbound frame does to the state.
 *
 *   bash firmware/test/host/run.sh      (or: make test-fw) */
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <stdbool.h>
#include "esp_err.h"
#include "nvs.h"

/* ---- fake NVS, as in cfg_test.c ---- */
static struct { char key[16]; uint8_t data[4096]; size_t len; bool used; } store[8];
esp_err_t nvs_open(const char *ns, nvs_open_mode_t mode, nvs_handle_t *out) { (void)ns; (void)mode; *out = 1; return ESP_OK; }
static int find(const char *key) { for (int i = 0; i < 8; i++) if (store[i].used && !strcmp(store[i].key, key)) return i; return -1; }
esp_err_t nvs_get_blob(nvs_handle_t h, const char *key, void *out, size_t *len) { (void)h; int i = find(key); if (i < 0) return ESP_ERR_NVS_NOT_FOUND; if (out) { if (*len < store[i].len) return ESP_FAIL; memcpy(out, store[i].data, store[i].len); } *len = store[i].len; return ESP_OK; }
esp_err_t nvs_set_blob(nvs_handle_t h, const char *key, const void *in, size_t len) { (void)h; int i = find(key); if (i < 0) for (i = 0; i < 8 && store[i].used; i++) {} if (i >= 8) return ESP_FAIL; store[i].used = true; strncpy(store[i].key, key, 15); memcpy(store[i].data, in, len); store[i].len = len; return ESP_OK; }
esp_err_t nvs_erase_all(nvs_handle_t h) { (void)h; memset(store, 0, sizeof store); return ESP_OK; }
esp_err_t nvs_commit(nvs_handle_t h) { (void)h; return ESP_OK; }
void nvs_close(nvs_handle_t h) { (void)h; }

/* ---- the real modules under test. Each defines its own static TAG; one TU needs
 * two names for them, so the identifier is renamed around each include. ---- */
#define TAG TAG_cfg
#include "ps_cfg.c"
#undef TAG
#define TAG TAG_state
#include "ps_state.c"
#undef TAG

/* ---- the other modules, as recorders ---- */
static char calls[2048];
static void rec(const char *s) { strncat(calls, s, sizeof calls - strlen(calls) - 1); strncat(calls, ";", sizeof calls - strlen(calls) - 1); }
static char last_response[96];
void ps_lock(void) {}
void ps_unlock(void) {}
void ps_restart(const char *why) { char b[64]; snprintf(b, sizeof b, "restart:%s", why); rec(b); }
void ps_ws_push(uint32_t roots, int client) { (void)roots; (void)client; rec("push"); }
void ps_ws_response(const char *type, bool ok, const char *gif, int client) { (void)client; snprintf(last_response, sizeof last_response, "%s:%d:%s", type, ok ? 1 : 0, gif ? gif : "-"); rec("response"); }
void ps_wifi_scan(void) { rec("wifi_scan"); }
void ps_wifi_connect(const char *ssid, const char *password) { (void)ssid; (void)password; rec("wifi_connect"); }
void ps_wifi_set_hostname(const char *h) { (void)h; rec("hostname"); }
void ps_wifi_ap_apply(void) { rec("ap_apply"); }
void ps_effect_notify(void) { rec("effect"); }
void ps_printer_bind(void) { rec("printer_bind"); }
void ps_printer_unbind(void) { rec("printer_unbind"); }
void ps_printer_scan(void) { rec("printer_scan"); }

static int pass, fail;
static void t(const char *name, int ok, const char *got) { if (ok) { pass++; printf("  ok    %s\n", name); } else { fail++; printf("  FAIL  %s   got: %s\n", name, got ? got : ""); } }
static uint32_t apply(const char *json) { calls[0] = 0; last_response[0] = 0; return ps_state_apply(json, strlen(json), 7); }
static bool called(const char *hay, const char *needle) { return strstr(hay, needle) != NULL; }

int main(void)
{
    memset(store, 0, sizeof store);
    ps_state_init();
    t("fresh device: no ssid so sta.state is 1, no printer so printer.state is 1", g_ps.sta_state == PS_STA_NOSSID && g_ps.printer_state == PS_PRN_INVALID, NULL);

    /* ---- the document ---- */
    char *doc = ps_state_json(PS_ROOT_ALL);
    cJSON *d = cJSON_Parse(doc);
    t("the document parses", d != NULL, doc);
    const char *roots[] = { "wifi", "sta", "ap", "printer", "settings", "block" }; int n = 0;
    for (cJSON *c = d->child; c; c = c->next) n++;
    bool allroots = true; for (int i = 0; i < 6; i++) if (!cJSON_GetObjectItemCaseSensitive(d, roots[i])) allroots = false;
    t("exactly the six roots", n == 6 && allroots, doc);
    cJSON *s = cJSON_GetObjectItemCaseSensitive(d, "settings");
    cJSON *l2 = cJSON_GetObjectItemCaseSensitive(s, "list2");
    t("settings carries list2, current_mode, fw_version, language", l2 && cJSON_GetArraySize(l2) == 2 && cJSON_GetObjectItemCaseSensitive(s, "current_mode") && cJSON_GetObjectItemCaseSensitive(s, "fw_version") && cJSON_GetObjectItemCaseSensitive(s, "language"), doc);
    t("settings does not carry img_version until one is known", cJSON_GetObjectItemCaseSensitive(s, "img_version") == NULL, doc);
    cJSON *e0 = cJSON_GetArrayItem(l2, 0), *e1 = cJSON_GetArrayItem(l2, 1);
    const char *c0 = cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(e0, "rgb_rgba"), 2)->valuestring;
    const char *c1 = cJSON_GetArrayItem(cJSON_GetObjectItemCaseSensitive(e1, "rgb_rgba"), 2)->valuestring;
    t("list2[0] colours are bare RRGGBB", !strcmp(c0, "FF0000"), c0);
    t("list2[1] colours are #RRGGBBAA", !strcmp(c1, "#FF0000FF"), c1);
    t("list2 entries carry brightness and no speed (the observed push)", cJSON_GetObjectItemCaseSensitive(e1, "brightness") && !cJSON_GetObjectItemCaseSensitive(e1, "speed"), doc);
    cJSON *sta = cJSON_GetObjectItemCaseSensitive(d, "sta");
    t("sta carries ip, hostname, state, auth_err_reason", cJSON_GetObjectItemCaseSensitive(sta, "ip") && cJSON_GetObjectItemCaseSensitive(sta, "hostname") && cJSON_GetObjectItemCaseSensitive(sta, "state") && cJSON_GetObjectItemCaseSensitive(sta, "auth_err_reason"), doc);
    cJSON *pr = cJSON_GetObjectItemCaseSensitive(d, "printer");
    t("printer carries name, sn, access_code, ip, state, scan", cJSON_GetObjectItemCaseSensitive(pr, "name") && cJSON_GetObjectItemCaseSensitive(pr, "sn") && cJSON_GetObjectItemCaseSensitive(pr, "access_code") && cJSON_GetObjectItemCaseSensitive(pr, "ip") && cJSON_GetObjectItemCaseSensitive(pr, "state") && cJSON_GetObjectItemCaseSensitive(pr, "scan"), doc);
    t("printer carries no list until a scan finished", cJSON_GetObjectItemCaseSensitive(pr, "list") == NULL, doc);
    cJSON *bl = cJSON_GetObjectItemCaseSensitive(cJSON_GetObjectItemCaseSensitive(d, "block"), "blocklist");
    cJSON *b0 = cJSON_GetArrayItem(bl, 0);
    t("block.blocklist[0] is {blockID, blockrgba #RRGGBBAA}", b0 && cJSON_GetObjectItemCaseSensitive(b0, "blockID")->valuedouble == 0 && !strcmp(cJSON_GetObjectItemCaseSensitive(b0, "blockrgba")->valuestring, "#FFFFFFFF"), doc);
    cJSON_Delete(d); cJSON_free(doc);
    doc = ps_state_json(PS_ROOT_STA); d = cJSON_Parse(doc);
    t("a partial document carries only the roots asked for", d && d->child && !strcmp(d->child->string, "sta") && !d->child->next, doc);
    cJSON_Delete(d); cJSON_free(doc);

    /* ---- inbound: settings ---- */
    uint32_t ch = apply("{\"settings\":{\"rgb_info_mode\":0,\"device_wakeup\":1}}");
    t("rgb_info_mode 0 selects Music, changes settings, saves, notifies the renderer", ch == PS_ROOT_SETTINGS && g_ps.cfg.current_mode == 0 && called(calls, "effect"), calls);
    apply("{\"settings\":{\"rgb_info_brightness\":75,\"device_wakeup\":1}}");
    t("brightness lands on the CURRENT mode (0)", g_ps.cfg.mode[0].brightness == 75 && g_ps.cfg.mode[1].brightness == 50, NULL);
    apply("{\"settings\":{\"rgb_info_brightness\":250,\"device_wakeup\":1}}");
    t("brightness is clamped to 100", g_ps.cfg.mode[0].brightness == 100, NULL);
    apply("{\"settings\":{\"rgb_info_speed\":35,\"device_wakeup\":1}}");
    t("speed lands on the current mode", g_ps.cfg.mode[0].speed == 35, NULL);
    apply("{\"settings\":{\"rgb_info_mode\":1,\"rgb_rgba\":\"#12345680\",\"rgb_state_index\":1,\"device_wakeup\":1}}");
    t("a colour with rgb_info_mode targets that mode, not the current one", g_ps.cfg.mode[1].colour[1].r == 0x12 && g_ps.cfg.mode[1].colour[1].a == 0x80 && g_ps.cfg.current_mode == 0, NULL);
    apply("{\"settings\":{\"rgb_rgba\":\"00FF00\",\"rgb_state_index\":0,\"device_wakeup\":1}}");
    t("a bare colour without a mode targets the current mode", g_ps.cfg.mode[0].colour[0].g == 0xFF && g_ps.cfg.mode[0].colour[0].a == 0xFF, NULL);
    ch = apply("{\"settings\":{\"rgb_rgba\":\"nonsense\",\"rgb_state_index\":0,\"device_wakeup\":1}}");
    t("an unparsable colour changes nothing", ch == 0, NULL);
    apply("{\"settings\":{\"language\":\"de\",\"device_wakeup\":1}}");
    t("language is stored", !strcmp(g_ps.cfg.language, "de"), g_ps.cfg.language);
    ch = apply("{\"settings\":{\"rgb_reset\":1,\"device_wakeup\":1}}");
    t("rgb_reset in Music mode does nothing (INFERENCE, the mock's default)", ch == 0 && g_ps.cfg.mode[0].brightness == 100, NULL);
    apply("{\"settings\":{\"rgb_info_mode\":1,\"device_wakeup\":1}}");
    ch = apply("{\"settings\":{\"rgb_reset\":1,\"device_wakeup\":1}}");
    t("rgb_reset in H2D restores both modes' lighting and nothing else", ch == PS_ROOT_SETTINGS && g_ps.cfg.mode[0].brightness == 50 && g_ps.cfg.mode[1].colour[1].r == 0xFF && !strcmp(g_ps.cfg.language, "de"), NULL);
    ch = apply("{\"settings\":{\"reset\":1,\"device_wakeup\":1}}");
    t("reset is a restart and nothing else", ch == 0 && called(calls, "restart:settings.reset") && !called(calls, "response"), calls);
    ch = apply("{\"settings\":{\"factory_reset\":1,\"device_wakeup\":1}}");
    t("factory_reset answers, erases, restarts", ch == 0 && !strcmp(last_response, "factory_reset:1:-") && called(calls, "restart:settings.factory_reset") && find("cfg") < 0, calls);
    ch = apply("{\"settings\":{\"on\":0,\"follow\":1,\"printing_ui_type\":\"x\",\"device_wakeup\":1}}");
    t("the three dead controls change nothing (standing rule 5)", ch == 0, NULL);

    /* ---- inbound: wifi, sta, ap ---- */
    ps_state_init();
    ch = apply("{\"wifi\":{\"scan\":1,\"device_wakeup\":1}}");
    t("wifi.scan starts a scan and changes wifi", ch == PS_ROOT_WIFI && called(calls, "wifi_scan"), calls);
    ch = apply("{\"wifi\":{\"ssid\":\"<T_SSID>\",\"password\":\"<T_PW>\",\"device_wakeup\":1}}");
    t("wifi.ssid+password stores both, connects, changes wifi and sta", ch == (PS_ROOT_WIFI | PS_ROOT_STA) && !strcmp(g_ps.cfg.wifi_ssid, "<T_SSID>") && !strcmp(g_ps.cfg.wifi_password, "<T_PW>") && called(calls, "wifi_connect") && g_ps.sta_state == PS_STA_CONNECTING, calls);
    ch = apply("{\"sta\":{\"hostname\":\"new-host\",\"device_wakeup\":1}}");
    t("sta.hostname stores, applies, answers set_hostname ok, pushes nothing", ch == 0 && !strcmp(g_ps.cfg.hostname, "new-host") && called(calls, "hostname") && !strcmp(last_response, "set_hostname:1:-"), calls);
    ch = apply("{\"ap\":{\"on\":0,\"device_wakeup\":1}}");
    t("ap.on alone stores, applies, changes ap", ch == PS_ROOT_AP && g_ps.cfg.ap_on == 0 && called(calls, "ap_apply"), calls);
    ch = apply("{\"ap\":{\"ssid\":\"<T_AP>\",\"password\":\"<T_AP_PW>\",\"ip\":\"192.168.4.1\",\"device_wakeup\":1}}");
    t("ap settings with the same address answer set_ap (INFERENCE)", ch == 0 && !strcmp(g_ps.cfg.ap_ssid, "<T_AP>") && !strcmp(last_response, "set_ap:1:-"), last_response);
    ch = apply("{\"ap\":{\"ssid\":\"<T_AP>\",\"password\":\"<T_AP_PW>\",\"ip\":\"192.168.7.1\",\"device_wakeup\":1}}");
    t("ap settings with a new address answer set_hotspot_ip and store it (INFERENCE)", ch == 0 && g_ps.cfg.ap_ip[2] == 7 && !strcmp(last_response, "set_hotspot_ip:1:-"), last_response);

    /* ---- inbound: printer, block ---- */
    ch = apply("{\"printer\":{\"scan\":1,\"device_wakeup\":1}}");
    t("printer.scan starts a scan", ch == PS_ROOT_PRINTER && called(calls, "printer_scan"), calls);
    ch = apply("{\"printer\":{\"name\":\"T\",\"sn\":\"<T_SN>\",\"access_code\":\"<T_CODE>\",\"ip\":\"192.0.2.20\",\"device_wakeup\":1}}");
    t("printer bind stores all four, binds, state 2", ch == PS_ROOT_PRINTER && !strcmp(g_ps.cfg.printer_sn, "<T_SN>") && !strcmp(g_ps.cfg.printer_access_code, "<T_CODE>") && g_ps.cfg.printer_ip[3] == 20 && called(calls, "printer_bind") && g_ps.printer_state == PS_PRN_CONNECTING, calls);
    ch = apply("{\"printer\":{\"disconnect\":1,\"device_wakeup\":1}}");
    t("printer.disconnect unbinds, state 1", ch == PS_ROOT_PRINTER && called(calls, "printer_unbind") && g_ps.printer_state == PS_PRN_INVALID, calls);
    ch = apply("{\"block\":{\"blockID\":0,\"blockrgba\":\"#ABCDEFFF\",\"device_wakeup\":1}}");
    t("block colour for an existing id is stored", ch == PS_ROOT_BLOCK && g_ps.cfg.block[0].colour.r == 0xAB && g_ps.cfg.block_count == 1, NULL);
    ch = apply("{\"block\":{\"blockID\":3,\"blockrgba\":\"#00000080\",\"device_wakeup\":1}}");
    t("block colour for a new id adds an entry", ch == PS_ROOT_BLOCK && g_ps.cfg.block_count == 2 && g_ps.cfg.block[1].id == 3, NULL);

    /* ---- the edges ---- */
    ch = apply("{\"settings\":{\"rgb_info_brightness\":10}}");
    t("a frame without device_wakeup is honoured (logged, not dropped)", ch == PS_ROOT_SETTINGS && g_ps.cfg.mode[1].brightness == 10, NULL);
    ch = apply("{\"settings\":{\"current_mode\":");
    t("a frame that is not JSON changes nothing", ch == 0, NULL);
    ch = apply("{\"nonsense\":{\"x\":1,\"device_wakeup\":1}}");
    t("an unknown root changes nothing", ch == 0, NULL);
    ch = apply("{\"settings\":{\"rgb_info_mode\":1,\"device_wakeup\":1},\"ap\":{\"on\":1,\"device_wakeup\":1}}");
    t("two roots in one frame are both applied", ch == (PS_ROOT_SETTINGS | PS_ROOT_AP) && g_ps.cfg.ap_on == 1, NULL);

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
