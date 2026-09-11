/* The renderer: one task, thirty frames a second, reading g_ps and writing the strip.
 *
 * What is FACT: two modes, three bar states, brightness 0..100 in both modes, speed 0..100
 * in H2D only, three colours per mode (docs/protocol-websocket.md, The RGB model).
 * What is NOT yet known, and rendered as a placeholder here:
 *   - H2D's animation: what speed drives, and how the three colours are laid across the
 *     strip. Phase 1 recovers it from the firmware and gate 5 checks it against the
 *     reference video. Until then H2D is the state's colour, solid, scaled by brightness.
 *   - Music mode: the factory reacts to sound and no fact about the microphone path exists
 *     in this repository. Rendered like H2D from mode[0]'s colours. INFERENCE, placeholder.
 *   - Blocks: what a block maps to on the bar is an open question; ignored in the render. */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "ps.h"

static const char *TAG = "ps_effect";
static TaskHandle_t s_task;
static ps_rgba_t s_frame[CONFIG_PS_LED_COUNT];

static ps_rgba_t scaled(ps_rgba_t c, uint8_t brightness)
{
    unsigned k = brightness > 100 ? 100 : brightness;
    c.r = (uint8_t)(c.r * k / 100);
    c.g = (uint8_t)(c.g * k / 100);
    c.b = (uint8_t)(c.b * k / 100);
    return c;
}

/* one frame from the state; returns how many pixels were written */
static size_t render(void)
{
    ps_lock();
    uint8_t mode = g_ps.cfg.current_mode > PS_MODE_H2D ? PS_MODE_H2D : g_ps.cfg.current_mode;
    uint8_t st = g_ps.bar_state > PS_BAR_ERROR ? PS_BAR_IDLE : g_ps.bar_state;
    const ps_mode_cfg_t *m = &g_ps.cfg.mode[mode];
    ps_rgba_t colour = m->colour[st];
    uint8_t brightness = m->brightness;
    ps_unlock();

    /* mode == PS_MODE_MUSIC: placeholder, see the header comment; the sound path is unknown */
    ps_rgba_t px = scaled(colour, brightness);
    for (size_t i = 0; i < CONFIG_PS_LED_COUNT; i++) s_frame[i] = px;
    return CONFIG_PS_LED_COUNT;
}

static void effect_task(void *arg)
{
    (void)arg;
    const TickType_t frame = pdMS_TO_TICKS(33);   /* 30 fps */
    for (;;) {
        size_t n = render();
        ps_led_write(s_frame, n);
        /* sleep a frame, or less when something changed */
        ulTaskNotifyTake(pdTRUE, frame);
    }
}

void ps_effect_start(void)
{
    if (s_task) return;
    memset(s_frame, 0, sizeof s_frame);
    if (xTaskCreate(effect_task, "ps_effect", 3072, NULL, 5, &s_task) != pdPASS) { ESP_LOGE(TAG, "task"); s_task = NULL; return; }
    ESP_LOGI(TAG, "running, %d LEDs, placeholder render (Phase 1 recovers the effects)", CONFIG_PS_LED_COUNT);
}

void ps_effect_notify(void)
{
    if (s_task) xTaskNotifyGive(s_task);
}
