/* ps_ota.c: not written yet. Every function the header promises is here as a stub that
 * compiles, logs once, and does nothing on the wire, so the tree builds while the module is
 * being written against ps.h. */
#include "esp_log.h"
#include "ps.h"
static const char *TAG = "ps_ota";
int ps_ota_begin(const char *type, size_t declared_len, void **ctx) { (void)type; (void)declared_len; *ctx = NULL; ESP_LOGW(TAG, "stub"); return -1; }
int ps_ota_write(void *ctx, const void *data, size_t len) { (void)ctx; (void)data; (void)len; return -1; }
int ps_ota_end(void *ctx, bool ok) { (void)ctx; (void)ok; return -1; }
