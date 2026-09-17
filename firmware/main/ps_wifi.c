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
#include <stdlib.h>
#include "esp_log.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_timer.h"
#include "esp_mac.h"
#include "mdns.h"
#include "ps.h"

static const char *TAG = "ps_wifi";
static esp_netif_t *s_sta, *s_ap;
static esp_timer_handle_t s_retry;
static bool s_started;

/* The hotspot's name, once per device. A unit with nothing stored builds it from its own STA
 * MAC and saves it, so the name is stable for the life of the configuration and two units on a
 * bench are never the same network. A name already stored, whether derived here on an earlier
 * boot or typed by the owner, is never touched. */
static void ap_ssid_default(void)
{
    ps_lock();
    bool have = g_ps.cfg.ap_ssid[0] != 0;
    ps_unlock();
    if (have) return;
    uint8_t mac[6] = { 0 };
    if (esp_read_mac(mac, ESP_MAC_WIFI_STA) != ESP_OK) { ESP_LOGW(TAG, "no MAC: hotspot unnamed"); return; }
    char ssid[sizeof g_ps.cfg.ap_ssid];
    ps_ap_ssid_from_mac(ssid, sizeof ssid, mac);
    ps_lock();
    snprintf(g_ps.cfg.ap_ssid, sizeof g_ps.cfg.ap_ssid, "%s", ssid);
    ps_cfg_save(&g_ps.cfg);
    ps_unlock();
    ESP_LOGI(TAG, "hotspot named %s", ssid);
}

/* The hostname, and the multicast responder that turns it into an address. The sanitiser runs
 * here as well as on the way in, so a name stored before it existed is corrected on the next
 * boot instead of leaving the device reachable at name.local.local and at nothing else. */
static void hostname_apply(void)
{
    char hn[sizeof g_ps.cfg.hostname];
    ps_lock();
    ps_hostname_sanitise(g_ps.cfg.hostname, sizeof g_ps.cfg.hostname);
    if (!g_ps.cfg.hostname[0]) snprintf(g_ps.cfg.hostname, sizeof g_ps.cfg.hostname, "status");
    snprintf(hn, sizeof hn, "%s", g_ps.cfg.hostname);
    ps_unlock();

    if (s_sta) esp_netif_set_hostname(s_sta, hn);
    if (s_ap) esp_netif_set_hostname(s_ap, hn);
    static bool mdns_up;
    if (!mdns_up && mdns_init() == ESP_OK) mdns_up = true;
    if (mdns_up) {
        mdns_hostname_set(hn);
        mdns_instance_name_set(hn);
        static bool svc;
        if (!svc && mdns_service_add(NULL, "_http", "_tcp", 80, NULL, 0) == ESP_OK) svc = true;
    }
    ESP_LOGI(TAG, "hostname %s (%s.local)", hn, hn);
}

void ps_wifi_apply_hostname(void) { hostname_apply(); }

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
        /* On the esp_event task, whose stack is small. A wifi_ap_record_t is over a hundred
           bytes, so sixteen of them on the stack is nearly two kilobytes and overflows it:
           the device panics on every scan, and the first thing the setup page does is scan.
           Heap-allocate, and survive the allocation failing. */
        uint16_t n = 0, want = 16;
        wifi_ap_record_t *recs = calloc(want, sizeof *recs);
        if (recs) { n = want; if (esp_wifi_scan_get_ap_records(&n, recs) != ESP_OK) n = 0; }
        else ESP_LOGW(TAG, "scan results: out of memory");
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
        free(recs);
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

/* C9: put the STA interface on the stored fixed address, or back on DHCP.
 *
 * Both directions matter. Turning the switch off has to start the DHCP client again, or the
 * device keeps the address it was given and nothing on the page says why. The setting takes
 * effect on the next association, which is what ps_wifi_connect does right after this.
 *
 * A DNS server of all zeros is not written: the field is optional, and writing a zero would
 * leave the resolver pointed at nothing instead of at the gateway. */
void ps_wifi_apply_netcfg(void)
{
    if (!s_sta) return;
    ps_lock();
    bool on = (g_ps.cfg.features & PS_FEAT_STATIC_IP) && g_ps.netcfg.on;
    ps_netcfg_t n = g_ps.netcfg;
    ps_unlock();

    if (!on) {
        esp_netif_dhcpc_start(s_sta);        /* already running: ESP_ERR_ESP_NETIF_DHCP_ALREADY_STARTED, which is fine */
        ESP_LOGI(TAG, "address: DHCP");
        return;
    }

    esp_netif_dhcpc_stop(s_sta);
    esp_netif_ip_info_t info;
    memset(&info, 0, sizeof info);
    info.ip.addr      = ESP_IP4TOADDR(n.ip[0], n.ip[1], n.ip[2], n.ip[3]);
    info.netmask.addr = ESP_IP4TOADDR(n.mask[0], n.mask[1], n.mask[2], n.mask[3]);
    info.gw.addr      = ESP_IP4TOADDR(n.gw[0], n.gw[1], n.gw[2], n.gw[3]);
    esp_err_t e = esp_netif_set_ip_info(s_sta, &info);
    if (e != ESP_OK) { ESP_LOGE(TAG, "set_ip_info: %d", (int)e); return; }

    if (n.dns[0] || n.dns[1] || n.dns[2] || n.dns[3]) {
        esp_netif_dns_info_t d;
        memset(&d, 0, sizeof d);
        d.ip.type = ESP_IPADDR_TYPE_V4;
        d.ip.u_addr.ip4.addr = ESP_IP4TOADDR(n.dns[0], n.dns[1], n.dns[2], n.dns[3]);
        esp_netif_set_dns_info(s_sta, ESP_NETIF_DNS_MAIN, &d);
    }
    ESP_LOGI(TAG, "address: fixed");
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

    ap_ssid_default();
    ps_lock();
    ESP_ERROR_CHECK(esp_wifi_set_mode(g_ps.cfg.ap_on ? WIFI_MODE_APSTA : WIFI_MODE_STA));
    if (g_ps.cfg.wifi_ssid[0]) sta_config_apply(g_ps.cfg.wifi_ssid, g_ps.cfg.wifi_password);
    if (g_ps.cfg.ap_on) ap_config_apply();
    ps_unlock();
    ESP_ERROR_CHECK(esp_wifi_start());
    s_started = true;
    ps_wifi_apply_netcfg();      /* C9: the boot association is the first one, so it counts too */
    hostname_apply();
    ESP_LOGI(TAG, "started, hotspot %s", g_ps.cfg.ap_on ? "on" : "off");
    return 0;
}

void ps_wifi_scan(void)
{
    if (!s_started) return;
    /* Scanning in APSTA takes the radio off the hotspot's channel. With the IDF's default
       dwell the hotspot is away for over a second per sweep and a browser sitting on the setup
       page loses its WebSocket, which is to say the first thing a new owner does breaks the
       page they are doing it on. Bound the per-channel dwell and give the hotspot's own
       channel a longer slice between hops so the client rides through the scan. */
    wifi_scan_config_t sc; memset(&sc, 0, sizeof sc);
    sc.scan_type = WIFI_SCAN_TYPE_ACTIVE;
    sc.scan_time.active.min = 20;
    sc.scan_time.active.max = 60;
    sc.home_chan_dwell_time = 60;
    esp_err_t e = esp_wifi_scan_start(&sc, false);
    ps_lock(); g_ps.wifi_scan = (e == ESP_OK) ? PS_WSCAN_SCANNING : PS_WSCAN_DONE; if (e != ESP_OK) g_ps.wifi_hits = 0; ps_unlock();
    if (e != ESP_OK) ESP_LOGW(TAG, "scan start: %d", (int)e);
}

void ps_wifi_connect(const char *ssid, const char *password)
{
    if (!s_started) return;
    sta_config_apply(ssid, password);
    ps_wifi_apply_netcfg();                /* C9: before the association, so it is the one that takes */
    esp_wifi_disconnect();
    esp_wifi_connect();
    ESP_LOGI(TAG, "connecting");
}

void ps_wifi_set_hostname(const char *hostname)
{
    (void)hostname;        /* the stored name is the one that counts; it is already sanitised */
    hostname_apply();      /* fully effective after the restart the page triggers */
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
