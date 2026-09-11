/* ps_ws.c: not written yet. Every function the header promises is here as a stub that
 * compiles, logs once, and does nothing on the wire, so the tree builds while the module is
 * being written against ps.h. */
#include "esp_log.h"
#include "ps.h"
static const char *TAG = "ps_ws";
int  ps_ws_start(void) { ESP_LOGW(TAG, "stub"); return 0; }
void ps_ws_push(uint32_t roots, int client) { (void)roots; (void)client; }
void ps_ws_response(const char *type, bool ok, const char *gif, int client) { (void)type; (void)ok; (void)gif; (void)client; }
