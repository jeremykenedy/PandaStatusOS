/* Station and hotspot. The enum values and what they mean are FACT
 * (docs/protocol-websocket.md, Enumerations, sta.state): 1 no ssid, 2 connecting,
 * 3 connected, 4 reconnecting, 5 password error. Which disconnect reasons count as a
 * password error is INFERENCE; sta.auth_err_reason carries the IDF reason code, and what
 * the factory puts there is unknown (the page shows it as a bare code).
 *
 * Credentials come from g_ps.cfg and are never logged. The Wi-Fi library's own NVS copy is
 * disabled (WIFI_STORAGE_RAM) so the one place a credential lives is our own blob. */
#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_timer.h"
#include "ps.h"

static const char *TAG = "ps_wifi";
static esp_netif_t *s_sta, *s_ap;
static esp_timer_handle_t s_retry;
static bool s_started;

static void ap_config_apply(void)
{
    wifi_config_t ap; memset(&ap, 0, sizeof ap);
    size_t n = strnlen(g_ps.cfg.ap_ssid, sizeof ap.ap.ssid);
    memcpy(ap.ap.ssid, g_ps.cfg.ap_ssid, n); ap.ap.ssid_len = (uint8_t)n;
    ap.ap.channel = 1; ap.ap.max_connection = 4;
    if (strlen(g_ps.cfg.ap_password) >= 8) { ap.ap.authmode = WIFI_AUTH_WPA2_PSK; strncpy((char *)ap.ap.password, g_ps.cfg.ap_password, sizeof ap.ap.password - 1); }
    else ap.ap.authmode = WIFI_AUTH_OPEN;              /* a password under 8 characters cannot be WPA2 */
    esp_wifi_set_config(WIFI_IF_AP, &ap);

    esp_netif_ip_info_t ip; memset(&ip, 0, sizeof ip);
    esp_netif_set_ip4_addr(&ip.ip, g_ps.cfg.ap_ip[0], g_ps.cfg.ap_ip[1], g_ps.cfg.ap_ip[2], g_ps.cfg.ap_ip[3]);
    ip.gw = ip.ip;
    esp_netif_set_ip4_addr(&ip.netmask, 255, 255, 255, 0);
    esp_netif_dhcps_stop(s_ap);
    esp_netif_set_ip_info(s_ap, &ip);
    esp_netif_dhcps_start(s_ap);
}

static void sta_config_apply(const char *ssid, const char *password)
{
    wifi_config_t sta; memset(&sta, 0, sizeof sta);
    strncpy((char *)sta.sta.ssid, ssid, sizeof sta.sta.ssid - 1);
    strncpy((char *)sta.sta.password, password, sizeof sta.sta.password - 1);
    sta.sta.threshold.authmode = password[0] ? WIFI_AUTH_WPA_PSK : WIFI_AUTH_OPEN;
    esp_wifi_set_config(WIFI_IF_STA, &sta);
}

static void retry_cb(void *arg) { (void)arg; esp_wifi_connect(); }
static void schedule_retry(void) { if (s_retry) esp_timer_start_once(s_retry, 5000 * 1000); }

static bool is_password_reason(int reason)
{
    /* INFERENCE: these are the reasons the IDF raises for a bad passphrase or a failed
     * handshake; anything else (no AP found, beacon timeout) is a reconnect */
    return reason == WIFI_REASON_AUTH_FAIL || reason == WIFI_REASON_4WAY_HANDSHAKE_TIMEOUT
        || reason == WIFI_REASON_HANDSHAKE_TIMEOUT || reason == WIFI_REASON_AUTH_EXPIRE;
}

static void on_wifi(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START) {
        ps_lock(); bool have = g_ps.cfg.wifi_ssid[0] != 0; ps_unlock();
        if (have) esp_wifi_connect();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        wifi_event_sta_disconnected_t *d = data;
        ps_lock();
        if (!g_ps.cfg.wifi_ssid[0]) { g_ps.sta_state = PS_STA_NOSSID; g_ps.auth_err_reason = 0; }
        else if (is_password_reason(d->reason)) { g_ps.sta_state = PS_STA_PASSWORD; g_ps.auth_err_reason = d->reason; }
        else { g_ps.sta_state = PS_STA_RECONNECTING; g_ps.auth_err_reason = d->reason; }
        g_ps.sta_ip[0] = 0;
        bool have = g_ps.cfg.wifi_ssid[0] != 0;
        ps_unlock();
        ESP_LOGW(TAG, "disconnected, reason %d", d->reason);
        ps_ws_push(PS_ROOT_STA, -1);
        if (have) schedule_retry();
    } else if (base == WIFI_EVENT && id == WIFI_EVENT_SCAN_DONE) {
        uint16_t n = 16; wifi_ap_record_t recs[16];
        if (esp_wifi_scan_get_ap_records(&n, recs) != ESP_OK) n = 0;
        ps_lock();
        g_ps.wifi_hits = 0;
        for (uint16_t i = 0; i < n && g_ps.wifi_hits < 16; i++) {
            if (!recs[i].ssid[0]) continue;
            strncpy(g_ps.wifi_list[g_ps.wifi_hits].ssid, (const char *)recs[i].ssid, sizeof g_ps.wifi_list[0].ssid - 1);
            g_ps.wifi_list[g_ps.wifi_hits].ssid[sizeof g_ps.wifi_list[0].ssid - 1] = 0;
            g_ps.wifi_list[g_ps.wifi_hits].rssi = recs[i].rssi;
            g_ps.wifi_hits++;
        }
        g_ps.wifi_scan = PS_WSCAN_DONE;
        ps_unlock();
        ESP_LOGI(TAG, "scan done, %u networks", n);
        ps_ws_push(PS_ROOT_WIFI, -1);
    } else if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *e = data;
        ps_lock();
        g_ps.sta_state = PS_STA_CONNECTED; g_ps.auth_err_reason = 0;
        snprintf(g_ps.sta_ip, sizeof g_ps.sta_ip, IPSTR, IP2STR(&e->ip_info.ip));
        ps_unlock();
        ESP_LOGI(TAG, "connected, " IPSTR, IP2STR(&e->ip_info.ip));
        ps_ws_push(PS_ROOT_STA, -1);
    }
}

int ps_wifi_start(void)
{
    ESP_ERROR_CHECK(esp_netif_init());
    esp_err_t e = esp_event_loop_create_default();
    if (e != ESP_OK && e != ESP_ERR_INVALID_STATE) { ESP_LOGE(TAG, "event loop: %d", (int)e); return -1; }
    s_sta = esp_netif_create_default_wifi_sta();
    s_ap = esp_netif_create_default_wifi_ap();
    wifi_init_config_t ic = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&ic));
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, on_wifi, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, on_wifi, NULL));
    const esp_timer_create_args_t ta = { .callback = retry_cb, .name = "ps_wifi_retry" };
    esp_timer_create(&ta, &s_retry);

    ps_lock();
    esp_netif_set_hostname(s_sta, g_ps.cfg.hostname);
    ESP_ERROR_CHECK(esp_wifi_set_mode(g_ps.cfg.ap_on ? WIFI_MODE_APSTA : WIFI_MODE_STA));
    if (g_ps.cfg.wifi_ssid[0]) sta_config_apply(g_ps.cfg.wifi_ssid, g_ps.cfg.wifi_password);
    if (g_ps.cfg.ap_on) ap_config_apply();
    ps_unlock();
    ESP_ERROR_CHECK(esp_wifi_start());
    s_started = true;
    ESP_LOGI(TAG, "started, hotspot %s", g_ps.cfg.ap_on ? "on" : "off");
    return 0;
}

void ps_wifi_scan(void)
{
    if (!s_started) return;
    wifi_scan_config_t sc; memset(&sc, 0, sizeof sc);
    esp_err_t e = esp_wifi_scan_start(&sc, false);
    ps_lock(); g_ps.wifi_scan = (e == ESP_OK) ? PS_WSCAN_SCANNING : PS_WSCAN_DONE; if (e != ESP_OK) g_ps.wifi_hits = 0; ps_unlock();
    if (e != ESP_OK) ESP_LOGW(TAG, "scan start: %d", (int)e);
}

void ps_wifi_connect(const char *ssid, const char *password)
{
    if (!s_started) return;
    sta_config_apply(ssid, password);
    esp_wifi_disconnect();
    esp_wifi_connect();
    ESP_LOGI(TAG, "connecting");
}

void ps_wifi_set_hostname(const char *hostname)
{
    if (s_sta) esp_netif_set_hostname(s_sta, hostname);   /* fully effective after the restart the page triggers */
}

void ps_wifi_ap_apply(void)
{
    if (!s_started) return;
    ps_lock();
    bool on = g_ps.cfg.ap_on != 0;
    esp_wifi_set_mode(on ? WIFI_MODE_APSTA : WIFI_MODE_STA);
    if (on) ap_config_apply();
    ps_unlock();
    ESP_LOGI(TAG, "hotspot %s", on ? "on" : "off");
}
