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
    ps_lock();
    uint8_t mode = g_ps.cfg.current_mode > PS_MODE_H2D ? PS_MODE_H2D : g_ps.cfg.current_mode;
    uint8_t st = g_ps.bar_state > PS_BAR_ERROR ? PS_BAR_IDLE : g_ps.bar_state;
    const ps_mode_cfg_t *m = &g_ps.cfg.mode[mode];
    uint32_t feat = g_ps.cfg.features;
    ps_rgba_t colour = m->colour[st];
    /* A1, PS_FEAT_STATE_BRIGHTNESS: one brightness per bar state; off, the factory's one per mode */
    uint8_t brightness = (feat & PS_FEAT_STATE_BRIGHTNESS) ? g_ps.cfg.state_brightness[mode][st] : m->brightness;
    uint8_t speed = m->speed;
    /* A2, PS_FEAT_STATE_EFFECTS: in H2D, the state's effect from ps_fx.c in the state's colour.
     * A3 to A5 will read the effect's own colours, parameters and ramp from the same block;
     * until their bits exist the factory's values stay in charge of everything but the shape. */
    int fx = -1;
    if (mode == PS_MODE_H2D && (feat & PS_FEAT_STATE_EFFECTS)) {
        fx = g_ps.cfg.fx[st].effect;
        if (fx < 0 || fx >= PS_FX_SELECTABLE) fx = PS_FX_STATIC;
    }
    ps_unlock();

    if (fx < 0) {
        /* the placeholder: the state's colour, solid, scaled. Music mode too; the sound path is unknown */
        ps_rgba_t px = scaled(colour, brightness);
        for (size_t i = 0; i < CONFIG_PS_LED_COUNT; i++) s_frame[i] = px;
        return 33;                                 /* 30 fps */
    }
    ps_rgba_t bg = { 0, 0, 0, 0xFF };
    ps_fx_in_t in = { .percent = -1, .temp_c = -1000, .temp_lo = 0, .temp_hi = 0 };
    brightness = ps_fx_ramp(&s_phase, brightness, -1);
    return ps_fx_render(fx, colour, bg, brightness, speed, false, 0, &in, &s_phase, s_frame, CONFIG_PS_LED_COUNT);
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
