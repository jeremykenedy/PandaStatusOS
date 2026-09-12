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
#include "esp_system.h"
#include "esp_flash.h"
#include "esp_timer.h"
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
    { "hot_warning",      PS_FEAT_HOT_WARNING },
    { "error_flash",      PS_FEAT_ERROR_FLASH },
    { "preview",          PS_FEAT_PREVIEW },
    { "presets",          PS_FEAT_PRESETS },
    { "stage_effects",    PS_FEAT_STAGE_EFFECTS },
    { "config_io",        PS_FEAT_CONFIG_IO },
    { "restart",          PS_FEAT_RESTART },
    { "auto_rebind",      PS_FEAT_AUTO_REBIND },
    { "diagnostics",      PS_FEAT_DIAGNOSTICS },
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
    cJSON *hw = cJSON_AddObjectToObject(cfg, "hot_warning");             /* A11: the layer's source, threshold and colour */
    cJSON_AddNumberToObject(hw, "source", g_ps.cfg.hot_src);
    cJSON_AddNumberToObject(hw, "threshold", g_ps.cfg.hot_c);
    { char w[10]; ps_rgba_to_wire(g_ps.cfg.hot_colour, PS_MODE_H2D, w); cJSON_AddStringToObject(hw, "colour", w); }
    cJSON *ef = cJSON_AddObjectToObject(cfg, "error_flash");             /* A12: the layer's colour, brightness and rate */
    { char w[10]; ps_rgba_to_wire(g_ps.cfg.err_colour, PS_MODE_H2D, w); cJSON_AddStringToObject(ef, "colour", w); }
    cJSON_AddNumberToObject(ef, "brightness", g_ps.cfg.err_brightness);
    cJSON_AddNumberToObject(ef, "speed", g_ps.cfg.err_speed);
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
    int hw_src, hw_c; ps_rgba_t hw_colour; bool have_hw = false;
    int ef_brightness, ef_speed; ps_rgba_t ef_colour; bool have_ef = false;
    ps_lock();
    uint32_t after = (g_ps.cfg.features | set) & ~clear;               /* the bits this document leaves in force */
    tg_src = g_ps.cfg.temp_src; tg_lo = g_ps.cfg.temp_lo; tg_hi = g_ps.cfg.temp_hi;   /* partial objects overlay the stored values */
    hw_src = g_ps.cfg.hot_src; hw_c = g_ps.cfg.hot_c; hw_colour = g_ps.cfg.hot_colour;
    ef_brightness = g_ps.cfg.err_brightness; ef_speed = g_ps.cfg.err_speed; ef_colour = g_ps.cfg.err_colour;
    ps_unlock();
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
            } else if (it->string && !strcmp(it->string, "hot_warning")) {
                if (!cJSON_IsObject(it)) { cJSON_Delete(root); return -1; }
                for (cJSON *k = it->child; k; k = k->next) {
                    if (!k->string) { cJSON_Delete(root); return -1; }
                    if (!strcmp(k->string, "colour")) { if (!cJSON_IsString(k) || !ps_rgba_from_wire(k->valuestring, &hw_colour)) { cJSON_Delete(root); return -1; } continue; }
                    if (!cJSON_IsNumber(k) || k->valuedouble < 0) { cJSON_Delete(root); return -1; }
                    int v = (int)k->valuedouble;
                    if      (!strcmp(k->string, "source"))    { if (v >= PS_TEMP_COUNT) { cJSON_Delete(root); return -1; } hw_src = v; }
                    else if (!strcmp(k->string, "threshold")) { if (v > PS_TEMP_MAX) { cJSON_Delete(root); return -1; } hw_c = v; }
                    else { cJSON_Delete(root); return -1; }
                }
                have_hw = true;
            } else if (it->string && !strcmp(it->string, "error_flash")) {
                if (!cJSON_IsObject(it)) { cJSON_Delete(root); return -1; }
                for (cJSON *k = it->child; k; k = k->next) {
                    if (!k->string) { cJSON_Delete(root); return -1; }
                    if (!strcmp(k->string, "colour")) { if (!cJSON_IsString(k) || !ps_rgba_from_wire(k->valuestring, &ef_colour)) { cJSON_Delete(root); return -1; } continue; }
                    if (!cJSON_IsNumber(k) || k->valuedouble < 0 || k->valuedouble > 100) { cJSON_Delete(root); return -1; }
                    int v = (int)k->valuedouble;
                    if      (!strcmp(k->string, "brightness")) ef_brightness = v;
                    else if (!strcmp(k->string, "speed"))      ef_speed = v;
                    else { cJSON_Delete(root); return -1; }
                }
                have_ef = true;
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
    if (have_hw && (g_ps.cfg.hot_src != hw_src || g_ps.cfg.hot_c != hw_c || memcmp(&g_ps.cfg.hot_colour, &hw_colour, sizeof hw_colour) != 0)) {
        g_ps.cfg.hot_src = (uint8_t)hw_src; g_ps.cfg.hot_c = (int16_t)hw_c; g_ps.cfg.hot_colour = hw_colour; changed = true;
    }
    if (have_ef && (g_ps.cfg.err_brightness != ef_brightness || g_ps.cfg.err_speed != ef_speed || memcmp(&g_ps.cfg.err_colour, &ef_colour, sizeof ef_colour) != 0)) {
        g_ps.cfg.err_brightness = (uint8_t)ef_brightness; g_ps.cfg.err_speed = (uint8_t)ef_speed; g_ps.cfg.err_colour = ef_colour; changed = true;
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

/* ---- A13: the live preview. A pinned printer state for a number of seconds, so a setting
 * can be seen without running a print. Nothing is stored; the renderer reads the pin in
 * place of the live state while it is live and the live state shows through afterwards. ---- */
#define PS_PREVIEW_MAX_S 600
char *ps_preview_json(void)
{
    cJSON *doc = cJSON_CreateObject();
    if (!doc) return NULL;
    int64_t now = esp_timer_get_time();
    ps_lock();
    bool active = g_ps.pin_active && now < g_ps.pin_until_us;
    int remaining = active ? (int)((g_ps.pin_until_us - now + 999999) / 1000000) : 0;
    cJSON_AddBoolToObject(doc, "active", active);
    cJSON_AddNumberToObject(doc, "state", g_ps.pin_state);
    cJSON_AddNumberToObject(doc, "percent", g_ps.pin_percent);
    cJSON *tp = cJSON_AddArrayToObject(doc, "temps");
    for (int i = 0; i < PS_TEMP_COUNT; i++) cJSON_AddItemToArray(tp, cJSON_CreateNumber(g_ps.pin_temp[i]));
    cJSON_AddNumberToObject(doc, "remaining", remaining);
    cJSON_AddNumberToObject(doc, "stage", g_ps.pin_stage);                /* B3: -1 while the pin follows the state */
    ps_unlock();
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return s;
}

int ps_preview_apply(const char *json, size_t len)
{
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root || !cJSON_IsObject(root)) { cJSON_Delete(root); return -1; }
    int state = -1, percent = -1, seconds = 30, stage = -1; int16_t temps[PS_TEMP_COUNT];
    for (int i = 0; i < PS_TEMP_COUNT; i++) temps[i] = PS_TEMP_NONE;
    for (cJSON *k = root->child; k; k = k->next) {
        if (!k->string) { cJSON_Delete(root); return -1; }
        if (!strcmp(k->string, "temps")) {
            if (!cJSON_IsArray(k) || cJSON_GetArraySize(k) != PS_TEMP_COUNT) { cJSON_Delete(root); return -1; }
            for (int i = 0; i < PS_TEMP_COUNT; i++) {
                cJSON *v = cJSON_GetArrayItem(k, i);
                if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > PS_TEMP_MAX) { cJSON_Delete(root); return -1; }
                temps[i] = (int16_t)v->valuedouble;
            }
            continue;
        }
        if (!cJSON_IsNumber(k) || k->valuedouble < 0) { cJSON_Delete(root); return -1; }
        int v = (int)k->valuedouble;
        if      (!strcmp(k->string, "state"))   { if (v > PS_BAR_ERROR) { cJSON_Delete(root); return -1; } state = v; }
        else if (!strcmp(k->string, "percent")) { if (v > 100) { cJSON_Delete(root); return -1; } percent = v; }
        else if (!strcmp(k->string, "seconds")) { if (v > PS_PREVIEW_MAX_S) { cJSON_Delete(root); return -1; } seconds = v; }
        else if (!strcmp(k->string, "stage"))   { if (v >= PS_GIF_SLOTS) { cJSON_Delete(root); return -1; } stage = v; }   /* B3: a display slot to pin as well */
        else { cJSON_Delete(root); return -1; }
    }
    cJSON_Delete(root);
    if (seconds > 0 && state < 0) return -1;                    /* a pin needs a state; a clear needs nothing */
    ps_lock();
    if (seconds == 0) { g_ps.pin_active = 0; g_ps.pin_stage = -1; }
    else {
        g_ps.pin_active = 1; g_ps.pin_state = (uint8_t)state; g_ps.pin_percent = (int16_t)percent; g_ps.pin_stage = (int8_t)stage;
        memcpy(g_ps.pin_temp, temps, sizeof temps);
        g_ps.pin_until_us = esp_timer_get_time() + (int64_t)seconds * 1000000;
    }
    ps_unlock();
    ps_effect_notify();
    ESP_LOGI(TAG, "preview %s", seconds ? "pinned" : "cleared");
    return 0;
}

static esp_err_t send_preview(httpd_req_t *req)
{
    char *s = ps_preview_json();
    if (!s) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s);
    return e;
}
static bool preview_on(void) { ps_lock(); bool on = (g_ps.cfg.features & PS_FEAT_PREVIEW) != 0; ps_unlock(); return on; }

int ps_api_preview_get(httpd_req_t *req)
{
    if (!preview_on()) return ps_http_redirect_portal(req);    /* with the switch off the route does not exist */
    return send_preview(req);
}

int ps_api_preview_post(httpd_req_t *req)
{
    if (!preview_on()) return ps_http_redirect_portal(req);
    if (req->content_len == 0 || req->content_len > 512) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "body", HTTPD_RESP_USE_STRLEN); }
    char buf[513]; size_t got = 0;
    while (got < req->content_len) {
        int n = httpd_req_recv(req, buf + got, req->content_len - got);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (n <= 0) return ESP_FAIL;
        got += (size_t)n;
    }
    buf[got] = 0;
    if (ps_preview_apply(buf, got) != 0) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN); }
    return send_preview(req);
}

/* ---- A14: the named effects. The whole list is replaced at once (taken whole or refused
 * whole, names unique, at most eight), or one named preset is copied into one bar state's
 * effect, which is then a plain state_effects entry. ---- */
/* the whole list from its JSON array, validated, into *out; the array's objects are consumed */
static bool presets_parse_list(cJSON *list, uint32_t feat, ps_presets_t *out)
{
    int n = cJSON_GetArraySize(list);
    if (!cJSON_IsArray(list) || n > PS_PRESETS_MAX) return false;
    memset(out, 0, sizeof *out); out->magic = PS_PRESETS_MAGIC;
    for (int i = 0; i < n; i++) {
        cJSON *o = cJSON_GetArrayItem(list, i);
        if (!cJSON_IsObject(o)) return false;
        cJSON *nm = cJSON_DetachItemFromObjectCaseSensitive(o, "name");          /* the name is not an effect field */
        bool ok = nm && cJSON_IsString(nm) && nm->valuestring[0] && strlen(nm->valuestring) < PS_PRESET_NAME;
        for (int j = 0; ok && j < i; j++) if (!strcmp(out->p[j].name, nm->valuestring)) ok = false;   /* names are unique */
        if (ok) strncpy(out->p[i].name, nm->valuestring, PS_PRESET_NAME - 1);
        cJSON_Delete(nm);
        if (!ok) return false;
        ps_fx_cfg_t f; memset(&f, 0, sizeof f); f.brightness = 50; f.speed = 100;   /* a fresh preset starts solid white at the parity numbers */
        for (int c = 0; c < 4; c++) f.colour[c] = (ps_rgba_t){ 0xFF, 0xFF, 0xFF, 0xFF };
        if (!fx_parse(o, &f, feat)) return false;
        out->p[i].fx = f;
    }
    out->count = (uint8_t)n;
    return true;
}

char *ps_presets_json(void)
{
    cJSON *doc = cJSON_CreateObject();
    if (!doc) return NULL;
    cJSON *arr = cJSON_AddArrayToObject(doc, "presets");
    ps_lock();
    for (int i = 0; i < g_ps.presets.count; i++) {
        cJSON *o = fx_json(&g_ps.presets.p[i].fx);
        cJSON_AddStringToObject(o, "name", g_ps.presets.p[i].name);
        cJSON_AddItemToArray(arr, o);
    }
    ps_unlock();
    cJSON_AddNumberToObject(doc, "max", PS_PRESETS_MAX);
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return s;
}

int ps_presets_apply(const char *json, size_t len)
{
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root || !cJSON_IsObject(root)) { cJSON_Delete(root); return -1; }
    cJSON *list = cJSON_GetObjectItemCaseSensitive(root, "presets");
    cJSON *ap = cJSON_GetObjectItemCaseSensitive(root, "apply");
    if ((!list && !ap) || (list && ap) || (list && !cJSON_IsArray(list)) || (ap && !cJSON_IsObject(ap))) { cJSON_Delete(root); return -1; }
    ps_lock(); uint32_t feat = g_ps.cfg.features; ps_unlock();
    if (list) {
        ps_presets_t s;
        if (!presets_parse_list(list, feat, &s)) { cJSON_Delete(root); return -1; }
        cJSON_Delete(root);
        ps_presets_clamp(&s);
        ps_lock(); g_ps.presets = s; ps_unlock();
        ps_presets_save(&s);
        ESP_LOGI(TAG, "presets: %d saved", (int)s.count);
        return 0;
    }
    cJSON *nm = cJSON_GetObjectItemCaseSensitive(ap, "name"), *st = cJSON_GetObjectItemCaseSensitive(ap, "state");
    if (!cJSON_IsString(nm) || !cJSON_IsNumber(st) || st->valuedouble < 0 || st->valuedouble > PS_BAR_ERROR) { cJSON_Delete(root); return -1; }
    int state = (int)st->valuedouble, found = -1;
    ps_lock();
    for (int i = 0; i < g_ps.presets.count; i++) if (!strcmp(g_ps.presets.p[i].name, nm->valuestring)) { found = i; break; }
    bool ok = found >= 0 && ps_fx_allowed(g_ps.cfg.features, g_ps.presets.p[found].fx.effect);   /* its effect needs its switch, like any other */
    if (ok) { g_ps.cfg.fx[state] = g_ps.presets.p[found].fx; ps_cfg_save(&g_ps.cfg); }
    ps_unlock();
    cJSON_Delete(root);
    if (!ok) return -1;
    ps_effect_notify();
    ESP_LOGI(TAG, "preset applied to state %d", state);
    return 0;
}

static esp_err_t send_presets(httpd_req_t *req)
{
    char *s = ps_presets_json();
    if (!s) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s);
    return e;
}
static bool presets_on(void) { ps_lock(); bool on = (g_ps.cfg.features & PS_FEAT_PRESETS) != 0; ps_unlock(); return on; }

int ps_api_presets_get(httpd_req_t *req)
{
    if (!presets_on()) return ps_http_redirect_portal(req);
    return send_presets(req);
}

int ps_api_presets_post(httpd_req_t *req)
{
    if (!presets_on()) return ps_http_redirect_portal(req);
    if (req->content_len == 0 || req->content_len > 4096) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "body", HTTPD_RESP_USE_STRLEN); }
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
    int rc = ps_presets_apply(buf, got);
    free(buf);
    if (rc != 0) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN); }
    return send_presets(req);
}

/* ---- B1, B2: the per-stage rows. A row is assigned a named effect (a copy, with the name),
 * cleared back to inheriting, or the whole table is replaced at once. ---- */
/* the whole table from its JSON array of fifteen rows, validated over *s (which carries the
 * stored rows the objects overlay); the array's objects are consumed */
static bool stages_parse_table(cJSON *tb, uint32_t feat, ps_stages_t *s)
{
    if (!cJSON_IsArray(tb) || cJSON_GetArraySize(tb) != PS_GIF_SLOTS) return false;
    for (int i = 0; i < PS_GIF_SLOTS; i++) {
        cJSON *o = cJSON_GetArrayItem(tb, i);
        if (!cJSON_IsObject(o)) return false;
        cJSON *set = cJSON_DetachItemFromObjectCaseSensitive(o, "set");
        cJSON *nm = cJSON_DetachItemFromObjectCaseSensitive(o, "name");
        cJSON *sl = cJSON_DetachItemFromObjectCaseSensitive(o, "slot");     /* the slot name is informational; ignored if echoed */
        bool ok = set && cJSON_IsBool(set) && (!nm || (cJSON_IsString(nm) && strlen(nm->valuestring) < PS_PRESET_NAME));
        ps_stage_row_t r = s->row[i];
        if (ok) {
            r.set = cJSON_IsTrue(set) ? 1 : 0;
            if (nm) { memset(r.name, 0, sizeof r.name); strncpy(r.name, nm->valuestring, PS_PRESET_NAME - 1); }
            ok = fx_parse(o, &r.fx, feat);
        }
        cJSON_Delete(set); cJSON_Delete(nm); cJSON_Delete(sl);
        if (!ok) return false;
        s->row[i] = r;
    }
    return true;
}

char *ps_stages_json(void)
{
    cJSON *doc = cJSON_CreateObject();
    if (!doc) return NULL;
    cJSON *arr = cJSON_AddArrayToObject(doc, "stages");
    ps_lock();
    for (int i = 0; i < PS_GIF_SLOTS; i++) {
        const ps_stage_row_t *r = &g_ps.stages.row[i];
        cJSON *o = fx_json(&r->fx);
        cJSON_AddStringToObject(o, "slot", ps_gif_slot_names[i]);
        cJSON_AddBoolToObject(o, "set", r->set != 0);
        cJSON_AddStringToObject(o, "name", r->name);
        cJSON_AddItemToArray(arr, o);
    }
    cJSON_AddNumberToObject(doc, "current", g_ps.stage);
    ps_unlock();
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return s;
}

int ps_stages_apply(const char *json, size_t len)
{
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root || !cJSON_IsObject(root)) { cJSON_Delete(root); return -1; }
    cJSON *as = cJSON_GetObjectItemCaseSensitive(root, "assign");
    cJSON *cl = cJSON_GetObjectItemCaseSensitive(root, "clear");
    cJSON *tb = cJSON_GetObjectItemCaseSensitive(root, "stages");
    int given = (as ? 1 : 0) + (cl ? 1 : 0) + (tb ? 1 : 0);
    if (given != 1) { cJSON_Delete(root); return -1; }
    ps_lock(); uint32_t feat = g_ps.cfg.features; ps_unlock();
    ps_stages_t s; ps_lock(); s = g_ps.stages; ps_unlock();
    if (tb) {
        if (!stages_parse_table(tb, feat, &s)) { cJSON_Delete(root); return -1; }
    } else if (as) {
        cJSON *st = cJSON_GetObjectItemCaseSensitive(as, "stage"), *nm = cJSON_GetObjectItemCaseSensitive(as, "name");
        if (!cJSON_IsObject(as) || !cJSON_IsNumber(st) || st->valuedouble < 0 || st->valuedouble >= PS_GIF_SLOTS || !cJSON_IsString(nm)) { cJSON_Delete(root); return -1; }
        int stage = (int)st->valuedouble, found = -1;
        ps_lock();
        for (int i = 0; i < g_ps.presets.count; i++) if (!strcmp(g_ps.presets.p[i].name, nm->valuestring)) { found = i; break; }
        bool ok = found >= 0 && ps_fx_allowed(g_ps.cfg.features, g_ps.presets.p[found].fx.effect);
        if (ok) { s.row[stage].set = 1; s.row[stage].fx = g_ps.presets.p[found].fx; memset(s.row[stage].name, 0, PS_PRESET_NAME); strncpy(s.row[stage].name, g_ps.presets.p[found].name, PS_PRESET_NAME - 1); }
        ps_unlock();
        if (!ok) { cJSON_Delete(root); return -1; }
    } else {
        cJSON *st = cJSON_GetObjectItemCaseSensitive(cl, "stage");
        if (!cJSON_IsObject(cl) || !cJSON_IsNumber(st) || st->valuedouble < 0 || st->valuedouble >= PS_GIF_SLOTS) { cJSON_Delete(root); return -1; }
        int stage = (int)st->valuedouble;
        s.row[stage].set = 0; memset(s.row[stage].name, 0, PS_PRESET_NAME);
    }
    cJSON_Delete(root);
    ps_stages_clamp(&s);
    ps_lock(); g_ps.stages = s; ps_unlock();
    ps_stages_save(&s);
    ps_effect_notify();
    return 0;
}

static esp_err_t send_stages(httpd_req_t *req)
{
    char *s = ps_stages_json();
    if (!s) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s);
    return e;
}
static bool stages_on(void) { ps_lock(); bool on = (g_ps.cfg.features & PS_FEAT_STAGE_EFFECTS) != 0; ps_unlock(); return on; }

int ps_api_stages_get(httpd_req_t *req)
{
    if (!stages_on()) return ps_http_redirect_portal(req);
    return send_stages(req);
}

int ps_api_stages_post(httpd_req_t *req)
{
    if (!stages_on()) return ps_http_redirect_portal(req);
    if (req->content_len == 0 || req->content_len > 8192) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "body", HTTPD_RESP_USE_STRLEN); }
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
    int rc = ps_stages_apply(buf, got);
    free(buf);
    if (rc != 0) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN); }
    return send_stages(req);
}

/* ---- C2: the read-only surface every clone answers, like /api/features (D-033, D-041):
 * identification for whoever is helping (curl /api/info), and the six-root state document
 * as JSON over HTTP for tools, the same document the socket pushes on connect. /api/info
 * carries no network name, address, serial or credential; /api/state carries exactly what
 * the socket gives any client on the network, no more. ---- */
static esp_err_t send_json(httpd_req_t *req, char *s)
{
    if (!s) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s);
    return e;
}

int ps_api_info_get(httpd_req_t *req)
{
    cJSON *doc = cJSON_CreateObject();
    if (!doc) return send_json(req, NULL);
    uint32_t flash = 0; esp_flash_get_physical_size(NULL, &flash);
    ps_lock(); uint32_t feat = g_ps.cfg.features; uint8_t mode = g_ps.cfg.current_mode; ps_unlock();
    cJSON_AddStringToObject(doc, "product", "PandaStatusOS");
    cJSON_AddStringToObject(doc, "build", ps_build_id());
    cJSON_AddStringToObject(doc, "version", PS_FW_VERSION);
    cJSON_AddStringToObject(doc, "idf", esp_get_idf_version());
    cJSON_AddNumberToObject(doc, "uptime_s", (double)(esp_timer_get_time() / 1000000));
    cJSON_AddNumberToObject(doc, "heap_free", (double)esp_get_free_heap_size());
    cJSON_AddNumberToObject(doc, "flash_size", (double)flash);
    cJSON_AddNumberToObject(doc, "leds", CONFIG_PS_LED_COUNT);
    cJSON_AddNumberToObject(doc, "mode", mode);
    cJSON_AddNumberToObject(doc, "features", (double)feat);
    cJSON_AddStringToObject(doc, "config_layout", "PS04");
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return send_json(req, s);
}

/* The state document with the three secrets taken out.
 *
 * The socket carries them, because the factory's socket carries them and the page's fields are
 * filled from that push; that is parity and it is documented. This route is NOT the factory's.
 * It is the clone's own, it answers an unauthenticated GET from anyone who can reach port 80,
 * and it was handing out the Wi-Fi password, the hotspot password and the printer's access code
 * to all of them. A second, easier copy of a secret is a second place to lose it.
 *
 * What goes: wifi.password, ap.password, printer.access_code, each replaced by an empty string
 * rather than removed, so the document keeps its shape and anything reading it still finds the
 * field. The printer serial stays: it is on a sticker and the printer broadcasts it to the whole
 * network in its own announcement, so withholding it here would protect nothing. */
static void redact_secret(cJSON *root, const char *branch, const char *field)
{
    cJSON *b = cJSON_GetObjectItem(root, branch);
    if (!cJSON_IsObject(b)) return;
    cJSON *f = cJSON_GetObjectItem(b, field);
    if (cJSON_IsString(f)) cJSON_SetValuestring(f, "");
}

int ps_api_state_get(httpd_req_t *req)
{
    ps_lock();
    char *s = ps_state_json(PS_ROOT_ALL);
    ps_unlock();
    if (!s) return send_json(req, s);
    cJSON *doc = cJSON_Parse(s);
    cJSON_free(s);
    if (!doc) return send_json(req, NULL);
    redact_secret(doc, "wifi", "password");
    redact_secret(doc, "ap", "password");
    redact_secret(doc, "printer", "access_code");
    char *out = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return send_json(req, out);
}

/* ---- C3: the settings as one document. The export carries everything the device stores
 * except the three passwords (Wi-Fi, hotspot, printer access code): a file has a life of its
 * own. The import takes the same document, with or without those three, whole or refused:
 * every section is validated before anything is written (D-042). ---- */
static void ip_to_str(const uint8_t ip[4], char *out, size_t n) { if (ip[0] || ip[1] || ip[2] || ip[3]) snprintf(out, n, "%u.%u.%u.%u", ip[0], ip[1], ip[2], ip[3]); else out[0] = 0; }
static bool ip_from_str(const char *s, uint8_t out[4])
{
    if (!s) return false;
    if (!s[0]) { memset(out, 0, 4); return true; }
    unsigned a, b, c, d; char tail;
    if (sscanf(s, "%u.%u.%u.%u%c", &a, &b, &c, &d, &tail) != 4 || a > 255 || b > 255 || c > 255 || d > 255) return false;
    out[0] = (uint8_t)a; out[1] = (uint8_t)b; out[2] = (uint8_t)c; out[3] = (uint8_t)d;
    return true;
}
static cJSON *wire_colour(ps_rgba_t c) { char w[10]; ps_rgba_to_wire(c, PS_MODE_H2D, w); return cJSON_CreateString(w); }

char *ps_config_json(void)
{
    cJSON *doc = cJSON_CreateObject();
    if (!doc) return NULL;
    char ip[16];
    ps_lock();
    const ps_cfg_t *c = &g_ps.cfg;
    cJSON_AddStringToObject(doc, "layout", "PS04");
    cJSON_AddNumberToObject(doc, "features", (double)c->features);
    cJSON *wifi = cJSON_AddObjectToObject(doc, "wifi"); cJSON_AddStringToObject(wifi, "ssid", c->wifi_ssid);
    cJSON *ap = cJSON_AddObjectToObject(doc, "ap"); cJSON_AddStringToObject(ap, "ssid", c->ap_ssid); ip_to_str(c->ap_ip, ip, sizeof ip); cJSON_AddStringToObject(ap, "ip", ip); cJSON_AddNumberToObject(ap, "on", c->ap_on);
    cJSON_AddStringToObject(doc, "hostname", c->hostname);
    cJSON *pr = cJSON_AddObjectToObject(doc, "printer"); cJSON_AddStringToObject(pr, "name", c->printer_name); cJSON_AddStringToObject(pr, "sn", c->printer_sn); ip_to_str(c->printer_ip, ip, sizeof ip); cJSON_AddStringToObject(pr, "ip", ip);
    cJSON_AddStringToObject(doc, "language", c->language);
    cJSON_AddNumberToObject(doc, "mode", c->current_mode);
    cJSON *modes = cJSON_AddArrayToObject(doc, "modes");
    for (int m = 0; m < 2; m++) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddNumberToObject(o, "brightness", c->mode[m].brightness); cJSON_AddNumberToObject(o, "speed", c->mode[m].speed);
        cJSON *cols = cJSON_AddArrayToObject(o, "colours"); for (int i = 0; i < 3; i++) cJSON_AddItemToArray(cols, wire_colour(c->mode[m].colour[i]));
        cJSON_AddItemToArray(modes, o);
    }
    cJSON *blocks = cJSON_AddArrayToObject(doc, "blocks");
    for (int i = 0; i < c->block_count && i < PS_BLOCKS_MAX; i++) { cJSON *o = cJSON_CreateObject(); cJSON_AddNumberToObject(o, "id", c->block[i].id); cJSON_AddItemToObject(o, "colour", wire_colour(c->block[i].colour)); cJSON_AddItemToArray(blocks, o); }
    cJSON *sb = cJSON_AddArrayToObject(doc, "state_brightness");
    for (int m = 0; m < 2; m++) { cJSON *row = cJSON_CreateArray(); for (int i = 0; i < 3; i++) cJSON_AddItemToArray(row, cJSON_CreateNumber(c->state_brightness[m][i])); cJSON_AddItemToArray(sb, row); }
    cJSON *se = cJSON_AddArrayToObject(doc, "state_effects"); for (int s = 0; s < 3; s++) cJSON_AddItemToArray(se, fx_json(&c->fx[s]));
    cJSON *tg = cJSON_AddObjectToObject(doc, "temp_gradient"); cJSON_AddNumberToObject(tg, "source", c->temp_src); cJSON_AddNumberToObject(tg, "lo", c->temp_lo); cJSON_AddNumberToObject(tg, "hi", c->temp_hi);
    cJSON *hw = cJSON_AddObjectToObject(doc, "hot_warning"); cJSON_AddNumberToObject(hw, "source", c->hot_src); cJSON_AddNumberToObject(hw, "threshold", c->hot_c); cJSON_AddItemToObject(hw, "colour", wire_colour(c->hot_colour));
    cJSON *ef = cJSON_AddObjectToObject(doc, "error_flash"); cJSON_AddItemToObject(ef, "colour", wire_colour(c->err_colour)); cJSON_AddNumberToObject(ef, "brightness", c->err_brightness); cJSON_AddNumberToObject(ef, "speed", c->err_speed);
    cJSON *pl = cJSON_AddArrayToObject(doc, "presets");
    for (int i = 0; i < g_ps.presets.count; i++) { cJSON *o = fx_json(&g_ps.presets.p[i].fx); cJSON_AddStringToObject(o, "name", g_ps.presets.p[i].name); cJSON_AddItemToArray(pl, o); }
    cJSON *st = cJSON_AddArrayToObject(doc, "stages");
    for (int i = 0; i < PS_GIF_SLOTS; i++) { const ps_stage_row_t *r = &g_ps.stages.row[i]; cJSON *o = fx_json(&r->fx); cJSON_AddStringToObject(o, "slot", ps_gif_slot_names[i]); cJSON_AddBoolToObject(o, "set", r->set != 0); cJSON_AddStringToObject(o, "name", r->name); cJSON_AddItemToArray(st, o); }
    ps_unlock();
    char *s = cJSON_PrintUnformatted(doc);
    cJSON_Delete(doc);
    return s;
}

static bool take_str(cJSON *o, const char *k, char *dst, size_t n, bool *present)
{
    cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k);
    if (!v) return true;
    if (!cJSON_IsString(v) || strlen(v->valuestring) >= n) return false;
    memset(dst, 0, n); strncpy(dst, v->valuestring, n - 1);
    if (present) *present = true;
    return true;
}
static bool only_keys(cJSON *o, const char *const *keys, int nkeys)
{
    for (cJSON *k = o->child; k; k = k->next) {
        bool known = false;
        for (int i = 0; i < nkeys; i++) if (k->string && !strcmp(k->string, keys[i])) known = true;
        if (!known) return false;
    }
    return true;
}

int ps_config_apply(const char *json, size_t len)
{
    static const char *const TOP[] = { "layout", "features", "wifi", "ap", "hostname", "printer", "language", "mode", "modes", "blocks",
                                       "state_brightness", "state_effects", "temp_gradient", "hot_warning", "error_flash", "presets", "stages" };
    static const char *const WIFI_K[] = { "ssid", "password" }, *const AP_K[] = { "ssid", "password", "ip", "on" },
                      *const PR_K[] = { "name", "sn", "ip", "access_code" }, *const MODE_K[] = { "brightness", "speed", "colours" }, *const BLK_K[] = { "id", "colour" };
    cJSON *root = cJSON_ParseWithLength(json, len);
    if (!root || !cJSON_IsObject(root) || !only_keys(root, TOP, 17)) { cJSON_Delete(root); return -1; }
    ps_cfg_t next; ps_lock(); next = g_ps.cfg; ps_unlock();
    /* 1. the parity fields, validated into a copy */
    cJSON *v;
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "features"))) {
        if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > (double)PS_FEAT_KNOWN) goto refuse;
        next.features = (uint32_t)v->valuedouble & PS_FEAT_KNOWN;
    }
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "wifi"))) {
        if (!cJSON_IsObject(v) || !only_keys(v, WIFI_K, 2)) goto refuse;
        if (!take_str(v, "ssid", next.wifi_ssid, sizeof next.wifi_ssid, NULL) || !take_str(v, "password", next.wifi_password, sizeof next.wifi_password, NULL)) goto refuse;
    }
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "ap"))) {
        if (!cJSON_IsObject(v) || !only_keys(v, AP_K, 4)) goto refuse;
        if (!take_str(v, "ssid", next.ap_ssid, sizeof next.ap_ssid, NULL) || !take_str(v, "password", next.ap_password, sizeof next.ap_password, NULL)) goto refuse;
        cJSON *ip = cJSON_GetObjectItemCaseSensitive(v, "ip"), *on = cJSON_GetObjectItemCaseSensitive(v, "on");
        if (ip && (!cJSON_IsString(ip) || !ip_from_str(ip->valuestring, next.ap_ip))) goto refuse;
        if (on) { if (!cJSON_IsNumber(on) || (on->valuedouble != 0 && on->valuedouble != 1)) goto refuse; next.ap_on = (uint8_t)on->valuedouble; }
    }
    if (!take_str(root, "hostname", next.hostname, sizeof next.hostname, NULL)) goto refuse;
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "printer"))) {
        if (!cJSON_IsObject(v) || !only_keys(v, PR_K, 4)) goto refuse;
        if (!take_str(v, "name", next.printer_name, sizeof next.printer_name, NULL) || !take_str(v, "sn", next.printer_sn, sizeof next.printer_sn, NULL)
            || !take_str(v, "access_code", next.printer_access_code, sizeof next.printer_access_code, NULL)) goto refuse;
        cJSON *ip = cJSON_GetObjectItemCaseSensitive(v, "ip");
        if (ip && (!cJSON_IsString(ip) || !ip_from_str(ip->valuestring, next.printer_ip))) goto refuse;
    }
    if (!take_str(root, "language", next.language, sizeof next.language, NULL)) goto refuse;
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "mode"))) { if (!cJSON_IsNumber(v) || (v->valuedouble != 0 && v->valuedouble != 1)) goto refuse; next.current_mode = (uint8_t)v->valuedouble; }
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "modes"))) {
        if (!cJSON_IsArray(v) || cJSON_GetArraySize(v) != 2) goto refuse;
        for (int m = 0; m < 2; m++) {
            cJSON *o = cJSON_GetArrayItem(v, m);
            if (!cJSON_IsObject(o) || !only_keys(o, MODE_K, 3)) goto refuse;
            cJSON *b = cJSON_GetObjectItemCaseSensitive(o, "brightness"), *s = cJSON_GetObjectItemCaseSensitive(o, "speed"), *cols = cJSON_GetObjectItemCaseSensitive(o, "colours");
            if (b) { if (!cJSON_IsNumber(b) || b->valuedouble < 0 || b->valuedouble > 100) goto refuse; next.mode[m].brightness = (uint8_t)b->valuedouble; }
            if (s) { if (!cJSON_IsNumber(s) || s->valuedouble < 0 || s->valuedouble > 100) goto refuse; next.mode[m].speed = (uint8_t)s->valuedouble; }
            if (cols) {
                if (!cJSON_IsArray(cols) || cJSON_GetArraySize(cols) != 3) goto refuse;
                for (int i = 0; i < 3; i++) { cJSON *cs = cJSON_GetArrayItem(cols, i); if (!cJSON_IsString(cs) || !ps_rgba_from_wire(cs->valuestring, &next.mode[m].colour[i])) goto refuse; }
            }
        }
    }
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "blocks"))) {
        if (!cJSON_IsArray(v) || cJSON_GetArraySize(v) > PS_BLOCKS_MAX) goto refuse;
        int n = cJSON_GetArraySize(v);
        for (int i = 0; i < n; i++) {
            cJSON *o = cJSON_GetArrayItem(v, i);
            if (!cJSON_IsObject(o) || !only_keys(o, BLK_K, 2)) goto refuse;
            cJSON *id = cJSON_GetObjectItemCaseSensitive(o, "id"), *cs = cJSON_GetObjectItemCaseSensitive(o, "colour");
            if (!cJSON_IsNumber(id) || id->valuedouble < 0 || id->valuedouble > 255 || !cJSON_IsString(cs)) goto refuse;
            next.block[i].id = (uint8_t)id->valuedouble;
            if (!ps_rgba_from_wire(cs->valuestring, &next.block[i].colour)) goto refuse;
        }
        next.block_count = (uint8_t)n;
    }
    /* 2. the named effects and the stage rows, validated into copies under the bits the document brings */
    ps_presets_t presets; bool have_presets = false;
    ps_stages_t stages; bool have_stages = false;
    ps_lock(); stages = g_ps.stages; ps_unlock();
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "presets"))) { if (!presets_parse_list(v, next.features, &presets)) goto refuse; have_presets = true; }
    if ((v = cJSON_GetObjectItemCaseSensitive(root, "stages")))  { if (!stages_parse_table(v, next.features, &stages)) goto refuse; have_stages = true; }
    /* 3. the feature settings go through the features route's own whole-or-refuse parse, with the switches
     *    the document brings, so an effect id is judged against the bits the import turns on */
    {
        cJSON *sub = cJSON_CreateObject(), *f = cJSON_AddObjectToObject(sub, "features"), *cfg = cJSON_AddObjectToObject(sub, "config");
        for (size_t i = 0; i < N_FEATURES; i++) cJSON_AddBoolToObject(f, FEATURES[i].name, (next.features & FEATURES[i].bit) != 0);
        static const char *const CFG_K[] = { "state_brightness", "state_effects", "temp_gradient", "hot_warning", "error_flash" };
        for (int i = 0; i < 5; i++) { cJSON *item = cJSON_DetachItemFromObjectCaseSensitive(root, CFG_K[i]); if (item) cJSON_AddItemToObject(cfg, CFG_K[i], item); }
        char *s = cJSON_PrintUnformatted(sub); cJSON_Delete(sub);
        int rc = s ? ps_features_apply(s, strlen(s)) : -1;
        cJSON_free(s);
        if (rc != 0) goto refuse;                                       /* nothing has been written yet */
    }
    cJSON_Delete(root);
    /* 4. everything validated: write the rest */
    ps_lock();
    uint32_t feat_now = g_ps.cfg.features;                              /* set by step 3, with the switch-off fallbacks applied */
    ps_fx_cfg_t fx_now[3]; memcpy(fx_now, g_ps.cfg.fx, sizeof fx_now);
    uint8_t sb_now[2][3]; memcpy(sb_now, g_ps.cfg.state_brightness, sizeof sb_now);
    int16_t tlo = g_ps.cfg.temp_lo, thi = g_ps.cfg.temp_hi, hc = g_ps.cfg.hot_c; uint8_t tsrc = g_ps.cfg.temp_src, hsrc = g_ps.cfg.hot_src, eb = g_ps.cfg.err_brightness, es = g_ps.cfg.err_speed;
    ps_rgba_t hcol = g_ps.cfg.hot_colour, ecol = g_ps.cfg.err_colour;
    next.features = feat_now; memcpy(next.fx, fx_now, sizeof next.fx); memcpy(next.state_brightness, sb_now, sizeof next.state_brightness);
    next.temp_lo = tlo; next.temp_hi = thi; next.hot_c = hc; next.temp_src = tsrc; next.hot_src = hsrc; next.err_brightness = eb; next.err_speed = es; next.hot_colour = hcol; next.err_colour = ecol;
    ps_cfg_clamp(&next);
    g_ps.cfg = next;
    ps_cfg_save(&g_ps.cfg);
    if (have_presets) { ps_presets_clamp(&presets); g_ps.presets = presets; ps_presets_save(&presets); }
    if (have_stages)  { ps_stages_clamp(&stages);   g_ps.stages = stages;   ps_stages_save(&stages); }
    ps_unlock();
    ps_effect_notify();
    ps_ws_push(PS_ROOT_ALL, -1);                                        /* every client sees the imported document */
    ESP_LOGI(TAG, "settings imported");
    return 0;
refuse:
    cJSON_Delete(root);
    return -1;
}

static bool config_on(void) { ps_lock(); bool on = (g_ps.cfg.features & PS_FEAT_CONFIG_IO) != 0; ps_unlock(); return on; }

int ps_api_config_get(httpd_req_t *req)
{
    if (!config_on()) return ps_http_redirect_portal(req);
    char *s = ps_config_json();
    if (!s) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_set_hdr(req, "Content-Disposition", "attachment; filename=\"pandastatusos-settings.json\"");
    esp_err_t e = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s);
    return e;
}

int ps_api_config_post(httpd_req_t *req)
{
    if (!config_on()) return ps_http_redirect_portal(req);
    if (req->content_len == 0 || req->content_len > 16384) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "body", HTTPD_RESP_USE_STRLEN); }
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
    int rc = ps_config_apply(buf, got);
    free(buf);
    if (rc != 0) { httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN); }
    char *s = ps_config_json();
    if (!s) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, s, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s);
    return e;
}

/* ---- C4: a plain restart, named what it is. The factory's own restart is a socket command
 * called reset; this route restarts and erases nothing. The answer leaves first. ---- */
static void api_restart_cb(void *arg) { (void)arg; ps_restart("api/restart"); }
static bool restart_on(void) { ps_lock(); bool on = (g_ps.cfg.features & PS_FEAT_RESTART) != 0; ps_unlock(); return on; }

int ps_api_restart_post(httpd_req_t *req)
{
    if (!restart_on()) return ps_http_redirect_portal(req);
    char drain[64]; size_t left = req->content_len;                    /* the route takes no document */
    while (left) {
        int n = httpd_req_recv(req, drain, left < sizeof drain ? left : sizeof drain);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (n <= 0) return ESP_FAIL;
        left -= (size_t)n;
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, "{\"restarting\":true}", HTTPD_RESP_USE_STRLEN);
    const esp_timer_create_args_t ta = { .callback = api_restart_cb, .name = "ps_api_restart" };
    esp_timer_handle_t h;
    if (esp_timer_create(&ta, &h) == ESP_OK) esp_timer_start_once(h, 300000);   /* let the answer leave */
    return e;
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
