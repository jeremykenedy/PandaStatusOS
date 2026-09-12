/* The printer link, over the printer's own MQTT broker.
 *
 * FACTS, from the maintainer's capture tool (tools/capture-mqtt.py, whose constants were
 * confirmed against a working client): TLS on port 8883, username "bblp", password = the
 * printer's access code, the report topic device/<SN>/report, the request topic
 * device/<SN>/request, and one request after subscribing:
 *   {"pushing":{"sequence_id":"0","command":"pushall","version":1,"push_target":1}}
 *
 * Security posture, stated plainly: the printer presents a self-signed certificate, so the
 * build skips server verification (CONFIG_ESP_TLS_INSECURE, CONFIG_ESP_TLS_SKIP_SERVER_CERT_VERIFY
 * in sdkconfig.defaults). The link is therefore encrypted but not authenticated on the
 * printer's side; the access code is the secret, and it is never logged.
 *
 * What the report says about the print, and how it maps to the bar's three states, is NOT
 * a fact in this repository: the MQTT capture that would establish the field names has not
 * run (the harnesses never touch hardware). The parser below looks for "print"."gcode_state" and maps it,
 * marked INFERENCE, in one function that the capture will correct.
 *
 * printer.state values and meanings are FACT (protocol doc, Enumerations); which transport
 * error maps to which value is INFERENCE, one line each below. Printer discovery on the
 * LAN: established by listening, not from a document. A printer announces itself over SSDP
 * multicast and ps_ssdp.c reads the announcement; discovery is no longer the open hole it
 * was (D-048). */
#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_mac.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "lwip/sockets.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "ps.h"

static const char *TAG = "ps_printer";
static esp_mqtt_client_handle_t s_client;
static esp_timer_handle_t s_scan_timer;
static char s_topic_report[80], s_topic_request[80], s_uri[48], s_client_id[32];
static char *s_assembly;                        /* a report that arrives in pieces */
static size_t s_assembled;
static int  s_transport_fails;                  /* C7: consecutive "no route" failures since the last connect */
static bool s_rebinding;                        /* C7: this scan was started by the rebind policy, not by the page */

static void set_state(uint8_t st)
{
    ps_lock(); bool changed = g_ps.printer_state != st; g_ps.printer_state = st; ps_unlock();
    if (changed) ps_ws_push(PS_ROOT_PRINTER, -1);
}

/* INFERENCE, pending the capture: RUNNING and PREPARE mean printing, FAILED means error,
 * everything else idle. One place to correct. */
static void apply_report(const char *json, size_t len)
{
    cJSON *doc = cJSON_ParseWithLength(json, len);
    if (!doc) return;
    cJSON *print = cJSON_GetObjectItemCaseSensitive(doc, "print");
    cJSON *gs = print ? cJSON_GetObjectItemCaseSensitive(print, "gcode_state") : NULL;
    static char s_gcode[16];                          /* the last gcode_state seen: a partial report may carry only stg_cur */
    if (cJSON_IsString(gs) && gs->valuestring) { strncpy(s_gcode, gs->valuestring, sizeof s_gcode - 1); s_gcode[sizeof s_gcode - 1] = 0; }
    if (cJSON_IsString(gs) && gs->valuestring) {
        uint8_t bar = PS_BAR_IDLE;
        if (!strcmp(gs->valuestring, "RUNNING") || !strcmp(gs->valuestring, "PREPARE")) bar = PS_BAR_PRINTING;
        else if (!strcmp(gs->valuestring, "FAILED")) bar = PS_BAR_ERROR;
        /* INFERENCE: a job is on while running, preparing or paused; A3's colours cross on it */
        uint8_t job = (bar == PS_BAR_PRINTING || !strcmp(gs->valuestring, "PAUSE")) ? 1 : 0;
        ps_lock(); bool changed = g_ps.bar_state != bar || g_ps.job_active != job; g_ps.bar_state = bar; g_ps.job_active = job; ps_unlock();
        if (changed) { ESP_LOGI(TAG, "bar state %u", bar); ps_effect_notify(); }
    }
    /* INFERENCE, B1: print.stg_cur is the printer's stage code, as the vent reads it; with gcode_state it
     * names one of the fifteen display slots (ps_stage_from_report), which the per-stage rows key on */
    cJSON *sc = print ? cJSON_GetObjectItemCaseSensitive(print, "stg_cur") : NULL;
    if (cJSON_IsNumber(sc) || (cJSON_IsString(gs) && gs->valuestring)) {
        ps_lock();
        if (cJSON_IsNumber(sc)) g_ps.stg_cur = (int16_t)sc->valuedouble;
        uint8_t stage = ps_stage_from_report(s_gcode[0] ? s_gcode : NULL, g_ps.stg_cur);
        bool moved = g_ps.stage != stage; g_ps.stage = stage;
        ps_unlock();
        if (moved) { ESP_LOGI(TAG, "stage %u", stage); ps_effect_notify(); }
    }
    /* INFERENCE: print.mc_percent is the job's percentage, as the vent reads it from the same report */
    cJSON *pc = print ? cJSON_GetObjectItemCaseSensitive(print, "mc_percent") : NULL;
    if (cJSON_IsNumber(pc)) {
        int v = (int)pc->valuedouble; if (v < 0) v = 0; if (v > 100) v = 100;
        ps_lock(); bool moved = g_ps.print_percent != v; g_ps.print_percent = (int16_t)v; ps_unlock();
        if (moved) ps_effect_notify();
    }
    /* INFERENCE: the three temperatures, as the vent reads them from the same report; whole degrees */
    static const char *const TEMP_KEYS[PS_TEMP_COUNT] = { "nozzle_temper", "bed_temper", "chamber_temper" };
    for (int i = 0; print && i < PS_TEMP_COUNT; i++) {
        cJSON *tv = cJSON_GetObjectItemCaseSensitive(print, TEMP_KEYS[i]);
        if (!cJSON_IsNumber(tv)) continue;
        int v = (int)(tv->valuedouble + 0.5); if (v < 0) v = 0; if (v > PS_TEMP_MAX) v = PS_TEMP_MAX;
        ps_lock(); bool moved = g_ps.temp_c[i] != v; g_ps.temp_c[i] = (int16_t)v; ps_unlock();
        if (moved) ps_effect_notify();
    }
    cJSON_Delete(doc);
}

static void on_data(esp_mqtt_event_handle_t ev)
{
    if (ev->topic_len && strncmp(ev->topic, s_topic_report, ev->topic_len) != 0) return;
    if (ev->total_data_len <= ev->data_len && ev->current_data_offset == 0) { apply_report(ev->data, ev->data_len); return; }
    /* pieces: assemble by offset, apply when the last one lands */
    if (ev->current_data_offset == 0) { free(s_assembly); s_assembly = malloc(ev->total_data_len + 1); s_assembled = 0; if (!s_assembly) return; }
    if (!s_assembly || ev->current_data_offset + ev->data_len > ev->total_data_len) return;
    memcpy(s_assembly + ev->current_data_offset, ev->data, ev->data_len);
    s_assembled = ev->current_data_offset + ev->data_len;
    if (s_assembled >= (size_t)ev->total_data_len) { apply_report(s_assembly, s_assembled); free(s_assembly); s_assembly = NULL; s_assembled = 0; }
}

static void on_mqtt(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg; (void)base;
    esp_mqtt_event_handle_t ev = data;
    switch ((esp_mqtt_event_id_t)id) {
    case MQTT_EVENT_CONNECTED:
        esp_mqtt_client_subscribe(s_client, s_topic_report, 0);
        esp_mqtt_client_publish(s_client, s_topic_request, "{\"pushing\":{\"sequence_id\":\"0\",\"command\":\"pushall\",\"version\":1,\"push_target\":1}}", 0, 0, 0);
        ESP_LOGI(TAG, "connected, subscribed, pushall sent");
        s_transport_fails = 0;                   /* C7: the address is good again */
        set_state(PS_PRN_CONNECTED);
        break;
    case MQTT_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "disconnected");
        set_state(PS_PRN_CONNECTING);            /* the client retries on its own */
        break;
    case MQTT_EVENT_ERROR:
        if (ev->error_handle) {
            if (ev->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) set_state(PS_PRN_ACCESS_CODE);   /* INFERENCE: refused = bad credentials */
            else if (ev->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) {
                set_state(PS_PRN_IP_ERR);                                                                          /* INFERENCE: no route, no TLS = wrong address */
                ps_printer_moved_maybe();                                                                          /* C7: enough of these and the printer has probably moved */
            }
            else set_state(PS_PRN_UNKNOWN_ERR);                                                                    /* INFERENCE: the rest */
        }
        break;
    case MQTT_EVENT_DATA:
        on_data(ev);
        break;
    default:
        break;
    }
}

int ps_printer_start(void)
{
    ps_lock(); bool bound = g_ps.cfg.printer_sn[0] && g_ps.cfg.printer_ip[0]; ps_unlock();
    if (bound) ps_printer_bind();
    return 0;
}

/* C7: a transport failure is normal once; a run of them, with the switch on and a printer
 * bound, is the case this feature exists for. The scan that follows reports through the
 * wire's own printer.scan states, so the page shows it without knowing about the feature. */
void ps_printer_moved_maybe(void)
{
    ps_lock();
    bool arm = (g_ps.cfg.features & PS_FEAT_AUTO_REBIND) && g_ps.cfg.printer_sn[0] && !s_rebinding
               && ++s_transport_fails >= PS_REBIND_AFTER_FAILS;
    ps_unlock();
    if (!arm) return;
    ESP_LOGI(TAG, "%d transport failures: looking for the printer by serial", s_transport_fails);
    s_rebinding = true;
    ps_lock(); g_ps.printer_scan = PS_PSCAN_IP_CHANGE; ps_unlock();
    ps_ws_push(PS_ROOT_PRINTER, -1);
    ps_printer_discover();
}

void ps_printer_bind(void)
{
    s_transport_fails = 0;
    ps_printer_unbind();
    ps_lock();
    snprintf(s_uri, sizeof s_uri, "mqtts://%u.%u.%u.%u:8883", g_ps.cfg.printer_ip[0], g_ps.cfg.printer_ip[1], g_ps.cfg.printer_ip[2], g_ps.cfg.printer_ip[3]);
    snprintf(s_topic_report, sizeof s_topic_report, "device/%s/report", g_ps.cfg.printer_sn);
    snprintf(s_topic_request, sizeof s_topic_request, "device/%s/request", g_ps.cfg.printer_sn);
    const char *code = g_ps.cfg.printer_access_code;
    bool usable = g_ps.cfg.printer_sn[0] && g_ps.cfg.printer_ip[0];
    uint8_t mac[6]; esp_read_mac(mac, ESP_MAC_WIFI_STA);
    snprintf(s_client_id, sizeof s_client_id, "pandastatusos-%02x%02x%02x", mac[3], mac[4], mac[5]);
    esp_mqtt_client_config_t mc = {
        .broker.address.uri = s_uri,
        .credentials.username = "bblp",
        .credentials.client_id = s_client_id,
        .credentials.authentication.password = code,
        .network.reconnect_timeout_ms = 5000,
        .session.keepalive = 30,
    };
    if (usable) s_client = esp_mqtt_client_init(&mc);
    ps_unlock();
    if (!usable) { set_state(PS_PRN_INVALID); ESP_LOGW(TAG, "bind without a serial number or an address"); return; }
    if (!s_client) { set_state(PS_PRN_UNKNOWN_ERR); ESP_LOGE(TAG, "client init failed"); return; }
    esp_mqtt_client_register_event(s_client, ESP_EVENT_ANY_ID, on_mqtt, NULL);
    set_state(PS_PRN_CONNECTING);
    esp_mqtt_client_start(s_client);
    ESP_LOGI(TAG, "binding to %s", s_uri);
}

void ps_printer_unbind(void)
{
    if (s_client) { esp_mqtt_client_stop(s_client); esp_mqtt_client_destroy(s_client); s_client = NULL; ESP_LOGI(TAG, "unbound"); }
    free(s_assembly); s_assembly = NULL; s_assembled = 0;
    ps_lock(); g_ps.printer_state = PS_PRN_INVALID; g_ps.bar_state = PS_BAR_IDLE; ps_unlock();
    ps_effect_notify();
}

/* Discovery. Printers announce themselves; nothing here probes addresses one by one.
 *
 * Established by listening on a real network: a Bambu printer sends an SSDP NOTIFY to the
 * multicast group 239.255.255.250 carrying its address, its serial and the name its owner gave
 * it. ps_ssdp.c reads one datagram and is host-tested against the real ones, including the DLNA
 * servers that share the same group and must not be mistaken for printers.
 *
 * The listener runs all the time and keeps its own table. It deliberately does NOT write
 * g_ps.printer_list as announcements arrive: printer.list appears in the state document only
 * once a scan has finished, which is the shape the page and the state test already expect. A
 * scan copies the table across, so pressing Scan reports what has actually been heard instead
 * of depending on a printer announcing itself inside the scan's own window. */
#define SEEN_MAX      (int)(sizeof g_ps.printer_list / sizeof g_ps.printer_list[0])
#define SEEN_FRESH_US (180 * 1000 * 1000LL)     /* three minutes: longer than their announcement gap */

static ps_printer_hit_t s_seen[8];
static int64_t          s_seen_at[8];
static int              s_seen_n;
static SemaphoreHandle_t s_seen_lock;

static void seen_put(const ps_printer_hit_t *h)
{
    if (!s_seen_lock) return;
    xSemaphoreTake(s_seen_lock, portMAX_DELAY);
    int slot = -1;
    for (int i = 0; i < s_seen_n; i++) {
        /* the serial identifies a printer; the address is what moves. With no serial, the
           address is all there is to go on. */
        bool same = h->sn[0] ? !strcmp(s_seen[i].sn, h->sn) : !strcmp(s_seen[i].ip, h->ip);
        if (same) { slot = i; break; }
    }
    if (slot < 0) {
        if (s_seen_n < SEEN_MAX) slot = s_seen_n++;
        else {                                   /* full: replace the one heard longest ago */
            slot = 0;
            for (int i = 1; i < s_seen_n; i++) if (s_seen_at[i] < s_seen_at[slot]) slot = i;
        }
    }
    bool fresh = strcmp(s_seen[slot].ip, h->ip) != 0 || strcmp(s_seen[slot].name, h->name) != 0;
    s_seen[slot] = *h;
    s_seen_at[slot] = esp_timer_get_time();
    xSemaphoreGive(s_seen_lock);
    if (fresh) ESP_LOGI(TAG, "printer announced: %s at %s", h->name[0] ? h->name : "(unnamed)", h->ip);
}

static int seen_copy(ps_printer_hit_t *out, int max)
{
    if (!s_seen_lock) return 0;
    int64_t now = esp_timer_get_time();
    int n = 0;
    xSemaphoreTake(s_seen_lock, portMAX_DELAY);
    for (int i = 0; i < s_seen_n && n < max; i++)
        if (now - s_seen_at[i] <= SEEN_FRESH_US) out[n++] = s_seen[i];
    xSemaphoreGive(s_seen_lock);
    return n;
}

/* Ask anything listening to announce itself now, so a scan does not have to wait out the gap
 * between a printer's own announcements. Sent to the group on every port one was observed on
 * and on SSDP's own, because the two units disagreed about which port they were using. */
static void ssdp_search(void)
{
    int s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s < 0) return;
    int ttl = 2;
    setsockopt(s, IPPROTO_IP, IP_MULTICAST_TTL, &ttl, sizeof ttl);
    static const char m[] = "M-SEARCH * HTTP/1.1\r\n" "HOST: " PS_SSDP_GROUP ":1900\r\n"
                            "MAN: \"ssdp:discover\"\r\n" "MX: 1\r\n"
                            "ST: urn:bambulab-com:device:3dprinter:1\r\n\r\n";
    const int ports[] = { PS_SSDP_PORT, PS_SSDP_PORT2, 1900 };
    for (size_t i = 0; i < sizeof ports / sizeof ports[0]; i++) {
        struct sockaddr_in to = { .sin_family = AF_INET, .sin_port = htons(ports[i]) };
        to.sin_addr.s_addr = inet_addr(PS_SSDP_GROUP);
        sendto(s, m, sizeof m - 1, 0, (struct sockaddr *)&to, sizeof to);
    }
    close(s);
}

static int join_group(int port)
{
    int s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP);
    if (s < 0) return -1;
    int one = 1;
    setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
    struct sockaddr_in me = { .sin_family = AF_INET, .sin_port = htons(port) };
    me.sin_addr.s_addr = htonl(INADDR_ANY);
    if (bind(s, (struct sockaddr *)&me, sizeof me) < 0) { close(s); return -1; }
    struct ip_mreq mreq;
    mreq.imr_multiaddr.s_addr = inet_addr(PS_SSDP_GROUP);
    mreq.imr_interface.s_addr = htonl(INADDR_ANY);
    if (setsockopt(s, IPPROTO_IP, IP_ADD_MEMBERSHIP, &mreq, sizeof mreq) < 0) { close(s); return -1; }
    return s;
}

static void discover_task(void *arg)
{
    (void)arg;
    int a = -1, b = -1;
    char buf[1024];
    for (;;) {
        /* The group can only be joined once an interface has an address, and the station may
           come and go, so the sockets are opened lazily and reopened if they ever fail. */
        if (a < 0) a = join_group(PS_SSDP_PORT);
        if (b < 0) b = join_group(PS_SSDP_PORT2);
        if (a < 0 && b < 0) { vTaskDelay(pdMS_TO_TICKS(3000)); continue; }

        fd_set rd; FD_ZERO(&rd);
        int mx = -1;
        if (a >= 0) { FD_SET(a, &rd); if (a > mx) mx = a; }
        if (b >= 0) { FD_SET(b, &rd); if (b > mx) mx = b; }
        struct timeval tv = { .tv_sec = 2, .tv_usec = 0 };
        int r = select(mx + 1, &rd, NULL, NULL, &tv);
        if (r <= 0) continue;

        for (int i = 0; i < 2; i++) {
            int s = i ? b : a;
            if (s < 0 || !FD_ISSET(s, &rd)) continue;
            struct sockaddr_in from; socklen_t fl = sizeof from;
            int n = recvfrom(s, buf, sizeof buf - 1, 0, (struct sockaddr *)&from, &fl);
            if (n <= 0) { close(s); if (i) b = -1; else a = -1; continue; }
            buf[n] = 0;
            ps_printer_hit_t h;
            if (ps_ssdp_parse_printer(buf, (size_t)n, &h)) seen_put(&h);
        }
    }
}

void ps_printer_discover_start(void)
{
    if (s_seen_lock) return;
    s_seen_lock = xSemaphoreCreateMutex();
    if (!s_seen_lock) { ESP_LOGE(TAG, "discovery: no mutex"); return; }
    if (xTaskCreate(discover_task, "ps_pdisc", 4096, NULL, 4, NULL) != pdPASS)
        ESP_LOGE(TAG, "discovery task would not start: scanning will find nothing");
    else
        ESP_LOGI(TAG, "listening for printer announcements on %s:%d and :%d", PS_SSDP_GROUP, PS_SSDP_PORT, PS_SSDP_PORT2);
}

static void scan_done(void *arg);

void ps_printer_discover(void)
{
    ssdp_search();                               /* prompt, rather than wait out their own gap */
    if (!s_scan_timer) { const esp_timer_create_args_t ta = { .callback = scan_done, .name = "ps_pscan" }; esp_timer_create(&ta, &s_scan_timer); }
    if (s_scan_timer) esp_timer_start_once(s_scan_timer, 2500 * 1000);
}

static void scan_done(void *arg)
{
    (void)arg;
    if (!s_rebinding) {
        ps_printer_hit_t found[8];
        int n = seen_copy(found, (int)(sizeof found / sizeof found[0]));
        ps_lock();
        for (int i = 0; i < n; i++) g_ps.printer_list[i] = found[i];
        g_ps.printer_hits = (uint8_t)n;
        g_ps.printer_scan = PS_PSCAN_DONE;
        ps_unlock();
        ESP_LOGI(TAG, "scan done, %d printer(s)", n);
        ps_ws_push(PS_ROOT_PRINTER, -1);
        return;
    }
    /* C7: the scan the rebind policy started. Decide, report through the wire's own states,
     * and bind to the new address if there is one. */
    uint8_t ip[4] = { 0, 0, 0, 0 };
    ps_printer_hit_t found[8];
    int n = seen_copy(found, (int)(sizeof found / sizeof found[0]));
    ps_lock();
    for (int i = 0; i < n; i++) g_ps.printer_list[i] = found[i];
    g_ps.printer_hits = (uint8_t)n;
    int outcome = ps_rebind_decide(g_ps.cfg.printer_sn, g_ps.cfg.printer_ip, g_ps.printer_list, g_ps.printer_hits, ip);
    g_ps.printer_scan = (uint8_t)outcome;
    g_ps.printer_hits = 0;
    bool move = outcome == PS_REBIND_MOVED;
    if (move) { memcpy(g_ps.cfg.printer_ip, ip, 4); ps_cfg_save(&g_ps.cfg); }
    ps_unlock();
    s_rebinding = false;
    ESP_LOGI(TAG, "rebind scan: state %d", outcome);
    ps_ws_push(PS_ROOT_PRINTER, -1);
    if (move) ps_printer_bind();
}

void ps_printer_scan(void)
{
    s_rebinding = false;                         /* the page's own scan, whatever the policy was doing */
    ps_lock(); g_ps.printer_scan = PS_PSCAN_SCANNING; ps_unlock();
    ps_printer_discover();
}
