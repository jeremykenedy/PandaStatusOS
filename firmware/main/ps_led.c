/* ps_led.c: not written yet. Every function the header promises is here as a stub that
 * compiles, logs once, and does nothing on the wire, so the tree builds while the module is
 * being written against ps.h. */
#include "esp_log.h"
#include "ps.h"
static const char *TAG = "ps_led";
int  ps_led_init(void) { ESP_LOGW(TAG, "stub"); return 0; }
void ps_led_write(const ps_rgba_t *px, size_t n) { (void)px; (void)n; }
