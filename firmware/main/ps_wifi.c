/* ps_wifi.c: not written yet. Every function the header promises is here as a stub that
 * compiles, logs once, and does nothing on the wire, so the tree builds while the module is
 * being written against ps.h. */
#include "esp_log.h"
#include "ps.h"
static const char *TAG = "ps_wifi";
int  ps_wifi_start(void) { ESP_LOGW(TAG, "stub"); return 0; }
void ps_wifi_scan(void) {}
void ps_wifi_connect(const char *ssid, const char *password) { (void)ssid; (void)password; }
void ps_wifi_set_hostname(const char *hostname) { (void)hostname; }
void ps_wifi_ap_apply(void) {}
