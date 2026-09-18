#pragma once
/* Host stub. ps_state.c reads the clock for uptime and for the preview's own deadline;
 * the test defines it, so time on the host is whatever the test says it is. */
#include <stdint.h>

int64_t esp_timer_get_time(void);
