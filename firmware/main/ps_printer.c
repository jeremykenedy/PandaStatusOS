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
 * run (standing rule 9). The parser below looks for "print"."gcode_state" and maps it,
 * marked INFERENCE, in one function that the capture will correct.
 *
 * printer.state values and meanings are FACT (protocol doc, Enumerations); which transport
 * error maps to which value is INFERENCE, one line each below. Printer discovery on the
 * LAN has no documented fact here: a scan completes empty. */
#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_mac.h"
#include "mqtt_client.h"
#include "cJSON.h"
#include "ps.h"

static const char *TAG = "ps_printer";
static esp_mqtt_client_handle_t s_client;
static esp_timer_handle_t s_scan_timer;
static char s_topic_report[80], s_topic_request[80], s_uri[48], s_client_id[32];
static char *s_assembly;                        /* a report that arrives in pieces */
static size_t s_assembled;

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
    if (cJSON_IsString(gs) && gs->valuestring) {
        uint8_t bar = PS_BAR_IDLE;
        if (!strcmp(gs->valuestring, "RUNNING") || !strcmp(gs->valuestring, "PREPARE")) bar = PS_BAR_PRINTING;
        else if (!strcmp(gs->valuestring, "FAILED")) bar = PS_BAR_ERROR;
        /* INFERENCE: a job is on while running, preparing or paused; A3's colours cross on it */
        uint8_t job = (bar == PS_BAR_PRINTING || !strcmp(gs->valuestring, "PAUSE")) ? 1 : 0;
        ps_lock(); bool changed = g_ps.bar_state != bar || g_ps.job_active != job; g_ps.bar_state = bar; g_ps.job_active = job; ps_unlock();
        if (changed) { ESP_LOGI(TAG, "bar state %u", bar); ps_effect_notify(); }
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
        set_state(PS_PRN_CONNECTED);
        break;
    case MQTT_EVENT_DISCONNECTED:
        ESP_LOGW(TAG, "disconnected");
        set_state(PS_PRN_CONNECTING);            /* the client retries on its own */
        break;
    case MQTT_EVENT_ERROR:
        if (ev->error_handle) {
            if (ev->error_handle->error_type == MQTT_ERROR_TYPE_CONNECTION_REFUSED) set_state(PS_PRN_ACCESS_CODE);   /* INFERENCE: refused = bad credentials */
            else if (ev->error_handle->error_type == MQTT_ERROR_TYPE_TCP_TRANSPORT) set_state(PS_PRN_IP_ERR);       /* INFERENCE: no route, no TLS = wrong address */
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

void ps_printer_bind(void)
{
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

/* INFERENCE: no documented discovery mechanism, so a scan finishes empty after a moment,
 * which is what the page can render honestly */
static void scan_done(void *arg)
{
    (void)arg;
    ps_lock(); g_ps.printer_scan = PS_PSCAN_DONE; g_ps.printer_hits = 0; ps_unlock();
    ps_ws_push(PS_ROOT_PRINTER, -1);
}
void ps_printer_scan(void)
{
    if (!s_scan_timer) { const esp_timer_create_args_t ta = { .callback = scan_done, .name = "ps_pscan" }; esp_timer_create(&ta, &s_scan_timer); }
    ps_lock(); g_ps.printer_scan = PS_PSCAN_SCANNING; ps_unlock();
    if (s_scan_timer) esp_timer_start_once(s_scan_timer, 800 * 1000);
}
