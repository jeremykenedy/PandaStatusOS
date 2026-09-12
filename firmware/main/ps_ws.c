/* The one HTTP server and the WebSocket. Facts (docs/protocol-websocket.md, HTTP surface
 * and Inbound messages): GET / is the page; HEAD / and GET /ota answer 405; POST /ota is
 * the upload with an OTA-Type header; every other path is a 302; the socket is /ws and the
 * connect-time push carries all six roots in one frame.
 *
 * Two things the factory does not have, both maintenance surfaces that the page and the
 * wire never see: an X-Build header on GET / (the build identifier) and GET /backup, the
 * whole flash as bytes (ps_backup.c). Neither changes what the device does; both exist so
 * that a flash can be proven to have landed and so that a revert path can be taken.
 *
 * INFERENCE, carried from the mock (D-014): after an inbound frame changes something, the
 * whole six-root document goes back to the sender only. Responses go where the module that
 * raised them says: the sender for a command, every client for an upload.
 *
 * Sending is always done on the server task: any task may call ps_ws_push() or
 * ps_ws_response(); the text is copied, queued with httpd_queue_work(), and written with
 * httpd_ws_send_frame_async() from there. */
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <unistd.h>
#include "esp_log.h"
#include "esp_http_server.h"
#include "esp_app_desc.h"
#include "cJSON.h"
#include "ps.h"

static const char *TAG = "ps_ws";
static httpd_handle_t s_hd;
static int s_clients[CONFIG_PS_WS_MAX_CLIENTS];

extern const uint8_t ui_html_gz_start[] asm("_binary_ui_html_gz_start");
extern const uint8_t ui_html_gz_end[]   asm("_binary_ui_html_gz_end");

/* ---- the client table: socket descriptors of open WebSockets ---- */
static void client_add(int fd)
{
    for (int i = 0; i < CONFIG_PS_WS_MAX_CLIENTS; i++) if (s_clients[i] == fd) return;
    for (int i = 0; i < CONFIG_PS_WS_MAX_CLIENTS; i++) if (s_clients[i] < 0) { s_clients[i] = fd; ESP_LOGI(TAG, "connect fd %d", fd); return; }
    ESP_LOGW(TAG, "client table full, fd %d not tracked", fd);
}
static void client_del(int fd)
{
    for (int i = 0; i < CONFIG_PS_WS_MAX_CLIENTS; i++) if (s_clients[i] == fd) { s_clients[i] = -1; ESP_LOGI(TAG, "close fd %d", fd); }
}
static void on_close(httpd_handle_t hd, int fd)
{
    (void)hd;
    client_del(fd);
    close(fd);                                         /* a custom close_fn owns the socket */
}

/* ---- sending, on the server task ---- */
typedef struct { int fd; size_t len; char text[]; } send_job_t;
static void send_work(void *arg)
{
    send_job_t *j = arg;
    httpd_ws_frame_t f = { .final = true, .fragmented = false, .type = HTTPD_WS_TYPE_TEXT, .payload = (uint8_t *)j->text, .len = j->len };
    esp_err_t e = httpd_ws_send_frame_async(s_hd, j->fd, &f);
    if (e != ESP_OK) ESP_LOGW(TAG, "send to fd %d failed: %d", j->fd, (int)e);
    free(j);
}
static void send_text(int fd, const char *text, size_t len)
{
    if (!s_hd) return;
    send_job_t *j = malloc(sizeof *j + len);
    if (!j) { ESP_LOGE(TAG, "no memory for a %u byte frame", (unsigned)len); return; }
    j->fd = fd; j->len = len; memcpy(j->text, text, len);
    if (httpd_queue_work(s_hd, send_work, j) != ESP_OK) free(j);
}
static void send_to(int client, const char *text, size_t len)
{
    if (client >= 0) { send_text(client, text, len); return; }
    for (int i = 0; i < CONFIG_PS_WS_MAX_CLIENTS; i++) if (s_clients[i] >= 0) send_text(s_clients[i], text, len);
}

void ps_ws_push(uint32_t roots, int client)
{
    ps_lock();
    char *doc = ps_state_json(roots);
    ps_unlock();
    if (!doc) return;
    send_to(client, doc, strlen(doc));
    ESP_LOGI(TAG, "push roots 0x%02x to %s", (unsigned)roots, client < 0 ? "all" : "sender");
    cJSON_free(doc);
}

void ps_ws_response(const char *type, bool ok, const char *gif, int client)
{
    char buf[96];
    int n = gif ? snprintf(buf, sizeof buf, "{\"response\":{\"type\":\"%s\",\"ok\":%d,\"gif\":\"%s\"}}", type, ok ? 1 : 0, gif)
                : snprintf(buf, sizeof buf, "{\"response\":{\"type\":\"%s\",\"ok\":%d}}", type, ok ? 1 : 0);
    if (n <= 0 || n >= (int)sizeof buf) return;
    send_to(client, buf, (size_t)n);
    ESP_LOGI(TAG, "response %s ok=%d", type, ok ? 1 : 0);
}

/* ---- the build identifier ---- */
/* The first eight bytes of the ELF's sha256 that ESP-IDF stamps into esp_app_desc, as hex.
 * It is unique per build, readable off the binary before it is sent and off the device
 * after (X-Build on GET / and on GET /backup), which is how tools/fw/ota-install.sh tells a
 * flash that landed from a 200 that meant nothing. The page and the wire carry nothing
 * new: a header is invisible to both. */
const char *ps_build_id(void)
{
    static char id[17];
    if (!id[0]) {
        const esp_app_desc_t *d = esp_app_get_description();
        for (int i = 0; i < 8; i++) snprintf(id + 2 * i, 3, "%02x", d->app_elf_sha256[i]);
    }
    return id;
}

/* ---- HTTP ---- */
static esp_err_t page_get(httpd_req_t *req)
{
    /* A client on the hotspot is almost always a captive sheet, and a captive sheet cannot
       render this page: it is over a megabyte, with a typeface and 25 languages in it. Such a
       client gets the small setup page instead. "?full=1" is the way past that for anything
       that can render the real thing, and the setup page links to it. A client on the network
       the device joined always gets the application. */
    if (ps_portal_req_from_ap(req)) {
        char q[64];
        bool full = (httpd_req_get_url_query_str(req, q, sizeof q) == ESP_OK) && strstr(q, "full=1");
        if (!full) return ps_portal_page(req);
    }
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Content-Encoding", "gzip");
    httpd_resp_set_hdr(req, "Cache-Control", "no-cache");
    httpd_resp_set_hdr(req, "X-Build", ps_build_id());
    return httpd_resp_send(req, (const char *)ui_html_gz_start, ui_html_gz_end - ui_html_gz_start);
}
static esp_err_t not_allowed(httpd_req_t *req)
{
    httpd_resp_set_status(req, "405 Method Not Allowed");
    return httpd_resp_send(req, NULL, 0);
}
static esp_err_t redirect_portal(httpd_req_t *req)
{
    char url[40];
    ps_lock();
    snprintf(url, sizeof url, "http://%u.%u.%u.%u/", g_ps.cfg.ap_ip[0], g_ps.cfg.ap_ip[1], g_ps.cfg.ap_ip[2], g_ps.cfg.ap_ip[3]);
    ps_unlock();
    httpd_resp_set_status(req, "302 Found");
    httpd_resp_set_hdr(req, "Location", url);
    return httpd_resp_send(req, NULL, 0);
}
int ps_http_redirect_portal(httpd_req_t *req) { return redirect_portal(req); }   /* for a route that must look absent (A13) */

static esp_err_t ota_post(httpd_req_t *req)
{
    char type[40];
    if (httpd_req_get_hdr_value_str(req, "OTA-Type", type, sizeof type) != ESP_OK) {
        httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "no OTA-Type", HTTPD_RESP_USE_STRLEN);
    }
    void *ctx = NULL;
    if (ps_ota_begin(type, req->content_len, &ctx) != 0) {
        httpd_resp_set_status(req, "400 Bad Request"); return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN);
    }
    ESP_LOGI(TAG, "upload %s, %u bytes", type, (unsigned)req->content_len);
    char *buf = malloc(4096);
    if (!buf) { ps_ota_end(ctx, false); httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    size_t left = req->content_len; bool ok = true;
    while (left > 0) {
        int n = httpd_req_recv(req, buf, left < 4096 ? left : 4096);
        if (n == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (n <= 0) { ok = false; break; }
        if (ps_ota_write(ctx, buf, (size_t)n) != 0) { ok = false; break; }
        left -= (size_t)n;
    }
    free(buf);
    int end = ps_ota_end(ctx, ok);
    if (!ok || end != 0) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN); }
    return httpd_resp_send(req, "ok", HTTPD_RESP_USE_STRLEN);
}

/* ---- the socket ---- */
static esp_err_t ws_handler(httpd_req_t *req)
{
    int fd = httpd_req_to_sockfd(req);
    if (req->method == HTTP_GET) {                     /* the handshake just completed */
        client_add(fd);
        ps_ws_push(PS_ROOT_ALL, fd);                   /* FACT: six roots, one frame, on connect */
        return ESP_OK;
    }
    httpd_ws_frame_t ws;
    memset(&ws, 0, sizeof ws);
    ws.type = HTTPD_WS_TYPE_TEXT;
    esp_err_t e = httpd_ws_recv_frame(req, &ws, 0);   /* length first */
    if (e != ESP_OK) { ESP_LOGW(TAG, "recv len: %d", (int)e); return e; }
    if (ws.len == 0) return ESP_OK;
    if (ws.len > 4096) { ESP_LOGW(TAG, "frame of %u bytes dropped", (unsigned)ws.len); return ESP_OK; }
    uint8_t *buf = calloc(1, ws.len + 1);
    if (!buf) return ESP_ERR_NO_MEM;
    ws.payload = buf;
    e = httpd_ws_recv_frame(req, &ws, ws.len);
    if (e != ESP_OK) { free(buf); ESP_LOGW(TAG, "recv: %d", (int)e); return e; }
    if (ws.type == HTTPD_WS_TYPE_TEXT) {
        ps_lock();
        uint32_t changed = ps_state_apply((const char *)buf, ws.len, fd);
        ps_unlock();
        ESP_LOGI(TAG, "inbound from fd %d, changed 0x%02x", fd, (unsigned)changed);
        if (changed) ps_ws_push(PS_ROOT_ALL, fd);      /* INFERENCE: whole document, sender only */
    }
    free(buf);
    return ESP_OK;
}

int ps_ws_start(void)
{
    for (int i = 0; i < CONFIG_PS_WS_MAX_CLIENTS; i++) s_clients[i] = -1;
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.uri_match_fn = httpd_uri_match_wildcard;
    cfg.close_fn = on_close;
    cfg.max_open_sockets = CONFIG_PS_WS_MAX_CLIENTS + 3;
    cfg.lru_purge_enable = true;
    cfg.stack_size = 8192;
    esp_err_t e = httpd_start(&s_hd, &cfg);
    if (e != ESP_OK) { ESP_LOGE(TAG, "httpd_start: %d", (int)e); s_hd = NULL; return -1; }

    /* specific routes first; the wildcard last, because matching runs in registration order */
    httpd_uri_t page   = { .uri = "/",    .method = HTTP_GET,  .handler = page_get };
    httpd_uri_t head   = { .uri = "/",    .method = HTTP_HEAD, .handler = not_allowed };
    httpd_uri_t otaget = { .uri = "/ota", .method = HTTP_GET,  .handler = not_allowed };
    httpd_uri_t ota    = { .uri = "/ota", .method = HTTP_POST, .handler = ota_post };
    httpd_uri_t ws     = { .uri = "/ws",  .method = HTTP_GET,  .handler = ws_handler, .is_websocket = true };
    httpd_uri_t backup = { .uri = "/backup", .method = HTTP_GET, .handler = ps_backup_get };   /* the clone's own; the factory has none */
    httpd_uri_t info_g = { .uri = "/api/info",     .method = HTTP_GET,  .handler = ps_api_info_get };       /* the clone's own (ps_api.c), always answered */
    httpd_uri_t st_g   = { .uri = "/api/state",    .method = HTTP_GET,  .handler = ps_api_state_get };
    httpd_uri_t api_g  = { .uri = "/api/features", .method = HTTP_GET,  .handler = ps_api_features_get };   /* the clone's own (ps_api.c) */
    httpd_uri_t api_p  = { .uri = "/api/features", .method = HTTP_POST, .handler = ps_api_features_post };
    httpd_uri_t pv_g   = { .uri = "/api/preview",  .method = HTTP_GET,  .handler = ps_api_preview_get };    /* A13; answers 302 while its bit is off */
    httpd_uri_t pv_p   = { .uri = "/api/preview",  .method = HTTP_POST, .handler = ps_api_preview_post };
    httpd_uri_t pr_g   = { .uri = "/api/presets",  .method = HTTP_GET,  .handler = ps_api_presets_get };    /* A14; answers 302 while its bit is off */
    httpd_uri_t pr_p   = { .uri = "/api/presets",  .method = HTTP_POST, .handler = ps_api_presets_post };
    httpd_uri_t sg_g   = { .uri = "/api/stages",   .method = HTTP_GET,  .handler = ps_api_stages_get };     /* B1, B2; answers 302 while its bit is off */
    httpd_uri_t sg_p   = { .uri = "/api/stages",   .method = HTTP_POST, .handler = ps_api_stages_post };
    httpd_uri_t cf_g   = { .uri = "/api/config",   .method = HTTP_GET,  .handler = ps_api_config_get };     /* C3; answers 302 while its bit is off */
    httpd_uri_t cf_p   = { .uri = "/api/config",   .method = HTTP_POST, .handler = ps_api_config_post };
    httpd_uri_t rs_p   = { .uri = "/api/restart",  .method = HTTP_POST, .handler = ps_api_restart_post };   /* C4; answers 302 while its bit is off */
    /* The wildcard answers every client, not only the hotspot's. That is parity: the factory
       answers 302 to any path it does not serve, and every gated route leans on it to look
       absent while its switch is off. It is also what makes a phone's captive probe open the
       setup page, once ps_portal.c is answering DNS for the hotspot. Do not narrow it. */
    httpd_uri_t any_g  = { .uri = "/*",   .method = HTTP_GET,  .handler = redirect_portal };
    httpd_uri_t any_p  = { .uri = "/*",   .method = HTTP_POST, .handler = redirect_portal };
    httpd_uri_t any_h  = { .uri = "/*",   .method = HTTP_HEAD, .handler = redirect_portal };
    httpd_register_uri_handler(s_hd, &page);
    httpd_register_uri_handler(s_hd, &head);
    httpd_register_uri_handler(s_hd, &otaget);
    httpd_register_uri_handler(s_hd, &ota);
    httpd_register_uri_handler(s_hd, &ws);
    httpd_register_uri_handler(s_hd, &backup);
    httpd_register_uri_handler(s_hd, &info_g);
    httpd_register_uri_handler(s_hd, &st_g);
    httpd_register_uri_handler(s_hd, &api_g);
    httpd_register_uri_handler(s_hd, &api_p);
    httpd_register_uri_handler(s_hd, &pv_g);
    httpd_register_uri_handler(s_hd, &pv_p);
    httpd_register_uri_handler(s_hd, &pr_g);
    httpd_register_uri_handler(s_hd, &pr_p);
    httpd_register_uri_handler(s_hd, &sg_g);
    httpd_register_uri_handler(s_hd, &sg_p);
    httpd_register_uri_handler(s_hd, &cf_g);
    httpd_register_uri_handler(s_hd, &cf_p);
    httpd_register_uri_handler(s_hd, &rs_p);
    httpd_register_uri_handler(s_hd, &any_g);
    httpd_register_uri_handler(s_hd, &any_p);
    httpd_register_uri_handler(s_hd, &any_h);
    ESP_LOGI(TAG, "listening on :80, page %u bytes gzip", (unsigned)(ui_html_gz_end - ui_html_gz_start));
    return 0;
}
