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
 *   - Blocks: what a block maps to on the bar is an open question; ignored in the render.
 * What is a FEATURE, behind bits that default off: the effect engine in ps_fx.c (A2 onward),
 * rendered only in H2D and only while the bit is set. */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "ps.h"

static const char *TAG = "ps_effect";
static TaskHandle_t s_task;
static ps_rgba_t s_frame[CONFIG_PS_LED_COUNT];
static ps_fx_phase_t s_phase;               /* the engine's animation state (ps_fx.c) */

static ps_rgba_t scaled(ps_rgba_t c, uint8_t brightness)
{
    unsigned k = brightness > 100 ? 100 : brightness;
    c.r = (uint8_t)(c.r * k / 100);
    c.g = (uint8_t)(c.g * k / 100);
    c.b = (uint8_t)(c.b * k / 100);
    return c;
}

/* one frame from the state; returns the milliseconds to wait before the next */
static uint32_t render(void)
{
    ps_fx_pick_t k;
    ps_lock();
    ps_fx_resolve(&g_ps.cfg, g_ps.cfg.current_mode, g_ps.bar_state, g_ps.job_active != 0, &k);
    int percent = g_ps.print_percent;
    uint8_t src = g_ps.cfg.temp_src < PS_TEMP_COUNT ? g_ps.cfg.temp_src : PS_TEMP_NOZZLE;
    int temp = g_ps.temp_c[src], temp_lo = g_ps.cfg.temp_lo, temp_hi = g_ps.cfg.temp_hi;
    ps_unlock();

    if (k.fx < 0) {
        /* the placeholder: the state's colour, solid, scaled. Music mode too; the sound path is unknown */
        ps_rgba_t px = scaled(k.colour, k.brightness);
        for (size_t i = 0; i < CONFIG_PS_LED_COUNT; i++) s_frame[i] = px;
        return 33;                                 /* 30 fps */
    }
    ps_fx_in_t in = { .percent = percent, .temp_c = temp, .temp_lo = temp_lo, .temp_hi = temp_hi };
    uint8_t b = ps_fx_ramp(&s_phase, k.brightness, k.bright_end);
    return ps_fx_render(k.fx, k.colour, k.bg, b, k.speed, k.reverse, k.band, &in, &s_phase, s_frame, CONFIG_PS_LED_COUNT);
}

static void effect_task(void *arg)
{
    (void)arg;
    for (;;) {
        uint32_t wait_ms = render();
        ps_led_write(s_frame, CONFIG_PS_LED_COUNT);
        /* sleep the effect's own frame period, or less when something changed */
        ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(wait_ms < 1 ? 1 : wait_ms));
    }
}

void ps_effect_start(void)
{
    if (s_task) return;
    memset(s_frame, 0, sizeof s_frame);
    ps_fx_phase_init(&s_phase);
    if (xTaskCreate(effect_task, "ps_effect", 3072, NULL, 5, &s_task) != pdPASS) { ESP_LOGE(TAG, "task"); s_task = NULL; return; }
    ESP_LOGI(TAG, "running, %d LEDs, placeholder render (Phase 1 recovers the effects)", CONFIG_PS_LED_COUNT);
}

void ps_effect_notify(void)
{
    if (s_task) xTaskNotifyGive(s_task);
}
