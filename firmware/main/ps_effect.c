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
 * rendered only in H2D and only while the bit is set; and the layers (A11 onward), drawn
 * over whatever the base rendered, placeholder or effect, in both modes, each behind its bit. */
#define PS_LAYER_FRAME_MS   33          /* a layer animates at thirty frames a second whatever the base does */
#define PS_HOT_PERIOD_MS    2000        /* the hot warning's pulse, trough to trough */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_log.h"
#include "esp_timer.h"
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
    /* C8: a diagnostic replaces the frame entirely while it holds. Nothing the bar would
     * otherwise show means anything when the device cannot reach the network or the printer,
     * and the point of it is to be read from across the room. */
    ps_diag_t diag;
    ps_lock();
    bool diagnose = (g_ps.cfg.features & PS_FEAT_DIAGNOSTICS) && ps_diag_pick(g_ps.sta_state, g_ps.printer_state, &diag);
    ps_unlock();
    if (diagnose) return ps_diag_render(&diag, (uint32_t)(esp_timer_get_time() / 1000), s_frame, CONFIG_PS_LED_COUNT);

    ps_fx_pick_t k;
    ps_lock();
    /* the printer's state as rendered: live, or the pin while one is live (A13) */
    uint8_t st = g_ps.bar_state; bool job = g_ps.job_active != 0; int percent = g_ps.print_percent;
    int temps[PS_TEMP_COUNT]; for (int i = 0; i < PS_TEMP_COUNT; i++) temps[i] = g_ps.temp_c[i];
    uint32_t pin_left_ms = 0;
    uint8_t stage = g_ps.stage < PS_GIF_SLOTS ? g_ps.stage : 0;
    if (g_ps.pin_active) {
        int64_t now = esp_timer_get_time();
        if (now < g_ps.pin_until_us) {
            st = g_ps.pin_state; job = st == PS_BAR_PRINTING; percent = g_ps.pin_percent;
            for (int i = 0; i < PS_TEMP_COUNT; i++) if (g_ps.pin_temp[i] != PS_TEMP_NONE) temps[i] = g_ps.pin_temp[i];
            if (g_ps.pin_stage >= 0 && g_ps.pin_stage < PS_GIF_SLOTS) stage = (uint8_t)g_ps.pin_stage;   /* B3 */
            pin_left_ms = (uint32_t)((g_ps.pin_until_us - now) / 1000) + 1;
        } else { g_ps.pin_active = 0; ESP_LOGI(TAG, "preview over"); }
    }
    /* B1, B2: the row for this stage stands in for the state's entry while set; unset inherits */
    ps_fx_resolve_stage(&g_ps.cfg, g_ps.cfg.current_mode, st, job, &g_ps.stages.row[stage], &k);
    uint8_t src = g_ps.cfg.temp_src < PS_TEMP_COUNT ? g_ps.cfg.temp_src : PS_TEMP_NOZZLE;
    int temp = temps[src], temp_lo = g_ps.cfg.temp_lo, temp_hi = g_ps.cfg.temp_hi;

    /* A11: the hot warning, decided under the same lock as the frame it sits over */
    uint8_t hsrc = g_ps.cfg.hot_src < PS_TEMP_COUNT ? g_ps.cfg.hot_src : PS_TEMP_NOZZLE;
    bool hot = (g_ps.cfg.features & PS_FEAT_HOT_WARNING) && temps[hsrc] != PS_TEMP_NONE && temps[hsrc] >= g_ps.cfg.hot_c;
    ps_rgba_t hot_colour = g_ps.cfg.hot_colour;
    /* A12: the error flash, over everything else while the bar state is error */
    bool err = (g_ps.cfg.features & PS_FEAT_ERROR_FLASH) && st == PS_BAR_ERROR;
    ps_rgba_t err_colour = g_ps.cfg.err_colour; uint8_t err_brightness = g_ps.cfg.err_brightness, err_speed = g_ps.cfg.err_speed;
    ps_unlock();

    uint32_t wait;
    if (k.fx < 0) {
        /* the placeholder: the state's colour, solid, scaled. Music mode too; the sound path is unknown */
        ps_rgba_t px = scaled(k.colour, k.brightness);
        for (size_t i = 0; i < CONFIG_PS_LED_COUNT; i++) s_frame[i] = px;
        wait = 33;                                 /* 30 fps */
    } else {
        ps_fx_in_t in = { .percent = percent, .temp_c = temp, .temp_lo = temp_lo, .temp_hi = temp_hi };
        uint8_t b = ps_fx_ramp(&s_phase, k.brightness, k.bright_end);
        if (k.fx == PS_FX_PALETTE || k.fx == PS_FX_PALETTE_SCROLL)
            wait = ps_fx_render_palette(k.fx, k.stops, k.nstops, b, k.speed, k.reverse, &s_phase, s_frame, CONFIG_PS_LED_COUNT);
        else
            wait = ps_fx_render(k.fx, k.colour, k.bg, b, k.speed, k.reverse, k.band, &in, &s_phase, s_frame, CONFIG_PS_LED_COUNT);
    }

    /* the layers, over the base, in time rather than in frames so a static base still pulses;
     * the more urgent one draws last, so an error outranks a warning (D-037) */
    if (hot || err) {
        uint32_t now = (uint32_t)(esp_timer_get_time() / 1000);
        if (hot) ps_fx_layer_pulse(s_frame, CONFIG_PS_LED_COUNT, hot_colour, 100, now, PS_HOT_PERIOD_MS);
        if (err) ps_fx_layer_strobe(s_frame, CONFIG_PS_LED_COUNT, err_colour, err_brightness, now, ps_fx_period(err_speed));
        if (wait > PS_LAYER_FRAME_MS) wait = PS_LAYER_FRAME_MS;
        if (err) { uint32_t half = ps_fx_period(err_speed); if (wait > half) wait = half; }
    }
    if (pin_left_ms && wait > pin_left_ms) wait = pin_left_ms;   /* wake when the pin expires, not a period later */
    return wait;
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
