/* ps_printer.c: not written yet. Every function the header promises is here as a stub that
 * compiles, logs once, and does nothing on the wire, so the tree builds while the module is
 * being written against ps.h. */
#include "esp_log.h"
#include "ps.h"
static const char *TAG = "ps_printer";
int  ps_printer_start(void) { ESP_LOGW(TAG, "stub"); return 0; }
void ps_printer_bind(void) {}
void ps_printer_unbind(void) {}
void ps_printer_scan(void) {}
