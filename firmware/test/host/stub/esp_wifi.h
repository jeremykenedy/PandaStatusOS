#pragma once
/* Host stub. Only what ps_state.c reads: the one record field it publishes as the
 * device's own signal, and the call that fills it. The test defines the call, so a
 * host run decides for itself whether there is an access point to report. */
#include <stdint.h>
#include "esp_err.h"

typedef struct {
    int8_t rssi;
} wifi_ap_record_t;

esp_err_t esp_wifi_sta_get_ap_info(wifi_ap_record_t *out);
