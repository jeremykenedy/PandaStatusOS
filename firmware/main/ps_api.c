/* /api/features: the clone's own JSON route, and the one place a feature is switched on.
 *
 * The factory serves two routes and answers everything else with a 302 to its own page;
 * this one answers 200 with JSON, which is how the page tells a clone from the factory
 * without a single change to the socket document (D-033). Every feature defaults off,
 * and a device with every bit clear is at parity on the wire and on the bar.
 *
 *   GET  /api/features   {"build":"…","features":{"state_brightness":false,"state_effects":false},
 *                         "config":{"state_brightness":[[50,50,50],[50,50,50]],
 *                                   "state_effects":[{effect,brightness,speed,bright_end,opt,aux,colours[4]} x3]}}
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
    { "state_effects",    PS_FEAT_STATE_EFFECTS },
    { "effect_colours",   PS_FEAT_EFFECT_COLOURS },
    { "effect_params",    PS_FEAT_EFFECT_PARAMS },
    { "effect_ramp",      PS_FEAT_EFFECT_RAMP },
    { "fx_progress",      PS_FEAT_FX_PROGRESS },
    { "fx_progress_anim", PS_FEAT_FX_PROGRESS_ANIM },
    { "fx_barber",        PS_FEAT_FX_BARBER },
    { "fx_hue_ramp",      PS_FEAT_FX_HUE_RAMP },
    { "fx_temp",          PS_FEAT_FX_TEMP },
};

static cJSON *fx_json(const ps_fx_cfg_t *f)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "effect", f->effect);
    cJSON_AddNumberToObject(o, "brightness", f->brightness);
    cJSON_AddNumberToObject(o, "speed", f->speed);
    cJSON_AddNumberToObject(o, "bright_end", f->bright_end);
    cJSON_AddNumberToObject(o, "opt", f->opt);
    cJSON_AddNumberToObject(o, "aux", f->aux);
    cJSON *cols = cJSON_AddArrayToObject(o, "colours");
    for (int i = 0; i < 4; i++) { char w[10]; ps_rgba_to_wire(f->colour[i], PS_MODE_H2D, w); cJSON_AddItemToArray(cols, cJSON_CreateString(w)); }
    return o;
}

/* one stored effect from its JSON: every key optional, any unknown key or bad value refuses */
static bool fx_parse(cJSON *o, ps_fx_cfg_t *f, uint32_t feat)
{
    if (!cJSON_IsObject(o)) return false;
    for (cJSON *it = o->child; it; it = it->next) {
        const char *k = it->string; if (!k) return false;
        if (!strcmp(k, "colours")) {
            if (!cJSON_IsArray(it) || cJSON_GetArraySize(it) != 4) return false;
            for (int i = 0; i < 4; i++) { cJSON *s = cJSON_GetArrayItem(it, i); if (!cJSON_IsString(s) || !ps_rgba_from_wire(s->valuestring, &f->colour[i])) return false; }
            continue;
        }
        if (!cJSON_IsNumber(it) || it->valuedouble < 0) return false;
        int v = (int)it->valuedouble;
        if      (!strcmp(k, "effect"))     { if (v != f->effect && !ps_fx_allowed(feat, v)) return false; f->effect = (uint8_t)v; }   /* echoing the stored id is never a change to refuse */
        else if (!strcmp(k, "brightness")) { if (v > 100) return false; f->brightness = (uint8_t)v; }
        else if (!strcmp(k, "speed"))      { if (v > 100) return false; f->speed = (uint8_t)v; }
        else if (!strcmp(k, "bright_end")) { if (v > 100) return false; f->bright_end = (uint8_t)v; }
        else if (!strcmp(k, "opt"))        { if (v > 0x1F) return false; f->opt = (uint8_t)v; }
        else if (!strcmp(k, "aux"))        { if (v > 255) return false; f->aux = (uint8_t)v; }
        else return false;
    }
    return true;
}
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
    cJSON *se = cJSON_AddArrayToObject(cfg, "state_effects");
    for (int s = 0; s < 3; s++) cJSON_AddItemToArray(se, fx_json(&g_ps.cfg.fx[s]));
    cJSON *tg = cJSON_AddObjectToObject(cfg, "temp_gradient");            /* A10: one setting for every state that runs it */
    cJSON_AddNumberToObject(tg, "source", g_ps.cfg.temp_src);
    cJSON_AddNumberToObject(tg, "lo", g_ps.cfg.temp_lo);
    cJSON_AddNumberToObject(tg, "hi", g_ps.cfg.temp_hi);
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
    ps_fx_cfg_t fx[3]; bool have_fx = false;
    int tg_src, tg_lo, tg_hi; bool have_tg = false;
    ps_lock(); uint32_t after = (g_ps.cfg.features | set) & ~clear; tg_src = g_ps.cfg.temp_src; tg_lo = g_ps.cfg.temp_lo; tg_hi = g_ps.cfg.temp_hi; ps_unlock();   /* the bits this document leaves in force; partial objects overlay the stored values */
    if (cfg) {
        for (cJSON *it = cfg->child; it; it = it->next) {
            if (it->string && !strcmp(it->string, "state_effects")) {
                if (!cJSON_IsArray(it) || cJSON_GetArraySize(it) != 3) { cJSON_Delete(root); return -1; }
                ps_lock(); memcpy(fx, g_ps.cfg.fx, sizeof fx); ps_unlock();   /* partial objects overlay the stored block */
                for (int s = 0; s < 3; s++) if (!fx_parse(cJSON_GetArrayItem(it, s), &fx[s], after)) { cJSON_Delete(root); return -1; }
                have_fx = true;
            } else if (it->string && !strcmp(it->string, "state_brightness")) {
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
            } else if (it->string && !strcmp(it->string, "temp_gradient")) {
                if (!cJSON_IsObject(it)) { cJSON_Delete(root); return -1; }
                for (cJSON *k = it->child; k; k = k->next) {
                    if (!k->string || !cJSON_IsNumber(k) || k->valuedouble < 0) { cJSON_Delete(root); return -1; }
                    int v = (int)k->valuedouble;
                    if      (!strcmp(k->string, "source")) { if (v >= PS_TEMP_COUNT) { cJSON_Delete(root); return -1; } tg_src = v; }
                    else if (!strcmp(k->string, "lo"))     { if (v > PS_TEMP_MAX) { cJSON_Delete(root); return -1; } tg_lo = v; }
                    else if (!strcmp(k->string, "hi"))     { if (v > PS_TEMP_MAX) { cJSON_Delete(root); return -1; } tg_hi = v; }
                    else { cJSON_Delete(root); return -1; }
                }
                have_tg = true;
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
    if (have_fx && memcmp(g_ps.cfg.fx, fx, sizeof fx) != 0) { memcpy(g_ps.cfg.fx, fx, sizeof fx); changed = true; }
    if (have_tg && (g_ps.cfg.temp_src != tg_src || g_ps.cfg.temp_lo != tg_lo || g_ps.cfg.temp_hi != tg_hi)) {
        g_ps.cfg.temp_src = (uint8_t)tg_src; g_ps.cfg.temp_lo = (int16_t)tg_lo; g_ps.cfg.temp_hi = (int16_t)tg_hi; changed = true;
    }
    /* a switch going off takes its effects with it: a stored id that needed the bit falls back to
     * solid, so what is stored is always something the bits in force can render, and the next
     * whole-table POST from the page is not refused for carrying it. The seventeen that come with
     * state_effects are left alone when that switch goes off: they wait for it to come back. */
    for (int s = 0; s < 3; s++)
        if (g_ps.cfg.fx[s].effect >= PS_FX_SELECTABLE && !ps_fx_allowed(g_ps.cfg.features, g_ps.cfg.fx[s].effect)) { g_ps.cfg.fx[s].effect = PS_FX_STATIC; changed = true; }
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
