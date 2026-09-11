/* The bar: an addressable LED strip on the RMT peripheral. Whether the P2's strip is a
 * WS2812-class part, how many LEDs it has and which GPIO drives it are all PROVISIONAL
 * (Kconfig says so; the bench session and the flash dump settle them). The timings below
 * are the WS2812B datasheet's and live in one place so the bench can correct them. */
#include <string.h>
#include "esp_log.h"
#include "esp_check.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"
#include "ps.h"

static const char *TAG = "ps_led";

#define LED_RESOLUTION_HZ   10000000            /* 10 MHz: one tick is 0.1 us */
#define T0H_TICKS           4                   /* 0.4 us */
#define T0L_TICKS           8                   /* 0.85 us, rounded to the tick */
#define T1H_TICKS           8                   /* 0.8 us */
#define T1L_TICKS           4                   /* 0.45 us, rounded to the tick */
#define RESET_TICKS         500                 /* 50 us low: latch */

static rmt_channel_handle_t s_chan;
static rmt_encoder_handle_t s_bytes;            /* bit encoder */
static rmt_encoder_handle_t s_copy;             /* the reset pulse */
static uint8_t s_grb[CONFIG_PS_LED_COUNT * 3];
static const rmt_symbol_word_t s_reset = { .level0 = 0, .duration0 = RESET_TICKS / 2, .level1 = 0, .duration1 = RESET_TICKS / 2 };

static void wait_idle(void)
{
    if (s_chan) rmt_tx_wait_all_done(s_chan, 100);
}

int ps_led_init(void)
{
    rmt_tx_channel_config_t cc = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .gpio_num = CONFIG_PS_LED_GPIO,
        .mem_block_symbols = 64,
        .resolution_hz = LED_RESOLUTION_HZ,
        .trans_queue_depth = 2,
    };
    esp_err_t e = rmt_new_tx_channel(&cc, &s_chan);
    if (e != ESP_OK) { ESP_LOGE(TAG, "rmt channel: %d", (int)e); return -1; }
    rmt_bytes_encoder_config_t bc = {
        .bit0 = { .level0 = 1, .duration0 = T0H_TICKS, .level1 = 0, .duration1 = T0L_TICKS },
        .bit1 = { .level0 = 1, .duration0 = T1H_TICKS, .level1 = 0, .duration1 = T1L_TICKS },
        .flags.msb_first = 1,
    };
    e = rmt_new_bytes_encoder(&bc, &s_bytes);
    if (e != ESP_OK) { ESP_LOGE(TAG, "bytes encoder: %d", (int)e); return -1; }
    rmt_copy_encoder_config_t cpc;
    memset(&cpc, 0, sizeof cpc);
    e = rmt_new_copy_encoder(&cpc, &s_copy);
    if (e != ESP_OK) { ESP_LOGE(TAG, "copy encoder: %d", (int)e); return -1; }
    e = rmt_enable(s_chan);
    if (e != ESP_OK) { ESP_LOGE(TAG, "rmt enable: %d", (int)e); return -1; }
    memset(s_grb, 0, sizeof s_grb);
    ps_led_write(NULL, 0);                        /* all off */
    ESP_LOGI(TAG, "%d LEDs on GPIO %d (PROVISIONAL)", CONFIG_PS_LED_COUNT, CONFIG_PS_LED_GPIO);
    return 0;
}

/* Alpha is premultiplied here: the wire carries RRGGBBAA and the strip has no alpha.
 * INFERENCE: what the factory does with the alpha byte is unknown; scaling by it is the
 * reading that makes FF mean "as given". */
void ps_led_write(const ps_rgba_t *px, size_t n)
{
    if (!s_chan) return;
    if (n > CONFIG_PS_LED_COUNT) n = CONFIG_PS_LED_COUNT;
    for (size_t i = 0; i < CONFIG_PS_LED_COUNT; i++) {
        uint8_t r = 0, g = 0, b = 0;
        if (px && i < n) {
            unsigned a = px[i].a;
            r = (uint8_t)((px[i].r * a + 127) / 255);
            g = (uint8_t)((px[i].g * a + 127) / 255);
            b = (uint8_t)((px[i].b * a + 127) / 255);
        }
        s_grb[i * 3 + 0] = g; s_grb[i * 3 + 1] = r; s_grb[i * 3 + 2] = b;   /* GRB, WS2812 order */
    }
    wait_idle();
    rmt_transmit_config_t tc = { .loop_count = 0 };
    esp_err_t e = rmt_transmit(s_chan, s_bytes, s_grb, sizeof s_grb, &tc);
    if (e == ESP_OK) e = rmt_transmit(s_chan, s_copy, &s_reset, sizeof s_reset, &tc);
    if (e != ESP_OK) ESP_LOGW(TAG, "transmit: %d", (int)e);
}
