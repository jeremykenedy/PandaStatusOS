/* /api/features: the clone's own JSON route, and the one place a feature is switched on.
 *
 * The factory serves two routes and answers everything else with a 302 to its own page;
 * this one answers 200 with JSON, which is how the page tells a clone from the factory
 * without a single change to the socket document (D-033). Every feature defaults off,
 * and a device with every bit clear is at parity on the wire and on the bar.
 *
 *   GET  /api/features   {"build":"…","features":{"state_brightness":false},
 *                         "config":{"state_brightness":[[50,50,50],[50,50,50]]}}
 *   POST /api/features   {"features":{…}} and/or {"config":{…}}: applied whole or refused
 *                         whole (400); the answer is the same document as GET
 *
 * Feature switches and their settings live in the config blob (ps_cfg.c), so they survive
 * a restart and go with a factory reset. */
#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_http_server.h"
#include "cJSON.h"
#include "ps.h"

static const char *TAG = "ps_api";

static const struct { const char *name; uint32_t bit; } FEATURES[] = {
    { "state_brightness", PS_FEAT_STATE_BRIGHTNESS },
};
#define N_FEATURES (sizeof FEATURES / sizeof FEATURES[0])

char *ps_features_json(void)
{
    cJSON *doc = cJSON_CreateObject();
    if (!doc) return NULL;
    cJSON_AddStringToObject(doc, "build", ps_build_id());
    cJSON *f = cJSON_AddObjectToObject(doc, "features");
    cJSON *cfg = cJSON_AddObjectToObject(doc, "config");
    cJSON *sb = cJSON_AddArrayToObject(cfg, "state_brightness");
    ps_lock();
    for (size_t i = 0; i < N_FEATURES; i++) cJSON_AddBoolToObject(f, FEATURES[i].name, (g_ps.cfg.features & FEATURES[i].bit) != 0);
    for (int m = 0; m < 2; m++) {
        cJSON *row = cJSON_CreateArray();
        for (int i = 0; i < 3; i++) cJSON_AddItemToArray(row, cJSON_CreateNumber(g_ps.cfg.state_brightness[m][i]));
        cJSON_AddItemToArray(sb, row);
    }
    ps_unlock();
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return s;
}

/* validate everything first, then apply everything: a document is taken whole or refused whole */
int ps_features_apply(const char *json, size_t len)
{
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root || !cJSON_IsObject(root)) { cJSON_Delete(root); return -1; }
    cJSON *f = cJSON_GetObjectItemCaseSensitive(root, "features");
    cJSON *cfg = cJSON_GetObjectItemCaseSensitive(root, "config");
    if ((!f && !cfg) || (f && !cJSON_IsObject(f)) || (cfg && !cJSON_IsObject(cfg))) { cJSON_Delete(root); return -1; }

    uint32_t set = 0, clear = 0;
    if (f) {
        for (cJSON *it = f->child; it; it = it->next) {
            size_t k;
            for (k = 0; k < N_FEATURES; k++) if (it->string && !strcmp(it->string, FEATURES[k].name)) break;
            if (k == N_FEATURES || !cJSON_IsBool(it)) { cJSON_Delete(root); return -1; }
            if (cJSON_IsTrue(it)) set |= FEATURES[k].bit; else clear |= FEATURES[k].bit;
        }
    }
    uint8_t sb[2][3]; bool have_sb = false;
    if (cfg) {
        for (cJSON *it = cfg->child; it; it = it->next) {
            if (it->string && !strcmp(it->string, "state_brightness")) {
                if (!cJSON_IsArray(it) || cJSON_GetArraySize(it) != 2) { cJSON_Delete(root); return -1; }
                for (int m = 0; m < 2; m++) {
                    cJSON *row = cJSON_GetArrayItem(it, m);
                    if (!cJSON_IsArray(row) || cJSON_GetArraySize(row) != 3) { cJSON_Delete(root); return -1; }
                    for (int i = 0; i < 3; i++) {
                        cJSON *v = cJSON_GetArrayItem(row, i);
                        if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > 100) { cJSON_Delete(root); return -1; }
                        sb[m][i] = (uint8_t)v->valuedouble;
                    }
                }
                have_sb = true;
            } else { cJSON_Delete(root); return -1; }         /* an unknown setting is refused, not ignored */
        }
    }
    cJSON_Delete(root);

    bool changed = false;
    ps_lock();
    uint32_t before = g_ps.cfg.features;
    g_ps.cfg.features = (g_ps.cfg.features | set) & ~clear;
    changed = g_ps.cfg.features != before;
    if (have_sb && memcmp(g_ps.cfg.state_brightness, sb, sizeof sb) != 0) { memcpy(g_ps.cfg.state_brightness, sb, sizeof sb); changed = true; }
    if (changed) ps_cfg_save(&g_ps.cfg);
    ps_unlock();
    if (changed) { ps_effect_notify(); ESP_LOGI(TAG, "features 0x%08x", (unsigned)g_ps.cfg.features); }
    return 0;
}

static esp_err_t send_doc(httpd_req_t *req)
{
    char *s = ps_features_json();
    if (!s) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s);
    return e;
}

esp_err_t ps_api_features_get(httpd_req_t *req) { return send_doc(req); }

esp_err_t ps_api_features_post(httpd_req_t *req)
{
    if (req->content_len == 0 || req->content_len > 2048) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "body", HTTPD_RESP_USE_STRLEN); }
    char *buf = malloc(req->content_len + 1);
    if (!buf) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    size_t got = 0;
    while (got < req->content_len) {
        int n = httpd_req_recv(req, buf + got, req->content_len - got);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (n <= 0) { free(buf); return ESP_FAIL; }
        got += (size_t)n;
    }
    buf[got] = 0;
    int rc = ps_features_apply(buf, got);
    free(buf);
    if (rc != 0) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN); }
    return send_doc(req);
}
