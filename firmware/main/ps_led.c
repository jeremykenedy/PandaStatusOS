/* The bar: an addressable LED strip on the RMT peripheral. Whether the P2's strip is a
 * WS2812-class part, how many LEDs it has and which GPIO drives it are all PROVISIONAL
 * (Kconfig says so; the bench session and the flash dump settle them). The timings below
 * are the WS2812B datasheet's and live in one place so the bench can correct them. */
#include <string.h>
#include "esp_log.h"
#include "esp_check.h"
#include "driver/rmt_tx.h"
#include "driver/rmt_encoder.h"
#include "driver/gpio.h"
#include "esp_rom_gpio.h"
#include "soc/gpio_sig_map.h"
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

#if CONFIG_PS_LED_FANOUT
    /* The bar's data pin was never established, and a wrong pin is indistinguishable from a
     * dead strip: nothing lights, and no amount of reading the renderer tells you which it is.
     * So the RMT's output signal is routed to EVERY pin this chip can drive without disturbing
     * something that has to keep working, and the strip lights wherever it actually is.
     *
     * What is deliberately not in the list: 12 to 17 carry the SPI flash, 18 and 19 the USB,
     * 20 and 21 the console UART. Touching any of those breaks the device or the way back into
     * it. Everything else on an ESP32-C3 is fair game for a moment of push-pull output.
     *
     * This is a blunt instrument and it is temporary. It exists because the alternative is a
     * bar that does not work at all. Once the real pin is known, set PS_LED_GPIO to it and turn
     * this off: one pin driven is always better than eleven.
     *
     * The signal index is RMT channel 0's, and this is the first and only channel the firmware
     * allocates, so it is the one the driver just handed out. */
    {
        static const int fan[] = { 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 };
        int n = 0;
        for (size_t i = 0; i < sizeof fan / sizeof fan[0]; i++) {
            if (fan[i] == CONFIG_PS_LED_GPIO) continue;          /* already driven by the driver */
            gpio_config_t gc = {
                .pin_bit_mask = 1ULL << fan[i], .mode = GPIO_MODE_OUTPUT,
                .pull_up_en = GPIO_PULLUP_DISABLE, .pull_down_en = GPIO_PULLDOWN_DISABLE,
                .intr_type = GPIO_INTR_DISABLE,
            };
            if (gpio_config(&gc) != ESP_OK) continue;
            esp_rom_gpio_connect_out_signal(fan[i], RMT_SIG_OUT0_IDX, false, false);
            n++;
        }
        ESP_LOGW(TAG, "LED fan-out: the same data on %d extra pin(s) because the real one is unknown", n);
    }
#endif

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

#if CONFIG_PS_LED_PIN_WALK
/* ---- Which pin drives the bar? A diagnostic, off unless someone turns it on. ----
 *
 * The data pin and the LED count were never established: both are Kconfig guesses and say
 * PROVISIONAL in the log. A guess that is wrong produces exactly what a dead strip produces,
 * nothing at all, so no amount of reading the renderer settles it.
 *
 * This walks the pins the ESP32-C3 can drive without disturbing anything that must keep
 * working: the SPI flash lives on 12 to 17, USB on 18 and 19, the console UART on 20 and 21,
 * and none of those are touched. On each candidate it blinks the strip white a number of times
 * equal to that candidate's position in the list, then goes dark for two seconds and moves on.
 * Whoever is watching the bar counts the blinks, and the count names the pin.
 *
 * It drives 64 pixels, far more than the bar can have, so the strip lights whatever its length
 * is; counting the lit ones answers the second open question at the same time. */
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const int PS_WALK_PINS[] = { 8, 10, 2, 3, 4, 5, 6, 7, 0, 1, 9 };
#define PS_WALK_N     ((int)(sizeof PS_WALK_PINS / sizeof PS_WALK_PINS[0]))
#define PS_WALK_PIX   64

static void walk_blast(rmt_channel_handle_t ch, rmt_encoder_handle_t enc, bool on)
{
    static uint8_t buf[PS_WALK_PIX * 3];
    memset(buf, on ? 0x60 : 0x00, sizeof buf);          /* a bright but not blinding white */
    rmt_transmit_config_t tc = { .loop_count = 0 };
    if (rmt_transmit(ch, enc, buf, sizeof buf, &tc) == ESP_OK) rmt_tx_wait_all_done(ch, 200);
}

void ps_led_pin_walk(void)
{
    ESP_LOGW(TAG, "LED PIN WALK: %d candidates, blink count names the pin", PS_WALK_N);
    for (int i = 0; i < PS_WALK_N; i++)
        ESP_LOGW(TAG, "  %2d blink(s) = GPIO %d", i + 1, PS_WALK_PINS[i]);

    for (;;) {
        for (int i = 0; i < PS_WALK_N; i++) {
            int gpio = PS_WALK_PINS[i];
            rmt_channel_handle_t ch = NULL;
            rmt_encoder_handle_t enc = NULL;
            rmt_tx_channel_config_t cc = {
                .clk_src = RMT_CLK_SRC_DEFAULT, .gpio_num = gpio, .mem_block_symbols = 64,
                .resolution_hz = LED_RESOLUTION_HZ, .trans_queue_depth = 2,
            };
            rmt_bytes_encoder_config_t bc = {
                .bit0 = { .level0 = 1, .duration0 = T0H_TICKS, .level1 = 0, .duration1 = T0L_TICKS },
                .bit1 = { .level0 = 1, .duration0 = T1H_TICKS, .level1 = 0, .duration1 = T1L_TICKS },
                .flags.msb_first = 1,
            };
            if (rmt_new_tx_channel(&cc, &ch) != ESP_OK) { ESP_LOGW(TAG, "GPIO %d: no channel", gpio); continue; }
            if (rmt_new_bytes_encoder(&bc, &enc) != ESP_OK) { rmt_del_channel(ch); continue; }
            if (rmt_enable(ch) != ESP_OK) { rmt_del_encoder(enc); rmt_del_channel(ch); continue; }

            ESP_LOGW(TAG, "GPIO %-2d : %d blink(s) now", gpio, i + 1);
            for (int b = 0; b <= i; b++) {
                walk_blast(ch, enc, true);  vTaskDelay(pdMS_TO_TICKS(320));
                walk_blast(ch, enc, false); vTaskDelay(pdMS_TO_TICKS(260));
            }
            rmt_disable(ch); rmt_del_encoder(enc); rmt_del_channel(ch);
            vTaskDelay(pdMS_TO_TICKS(2200));            /* the gap that separates one pin from the next */
        }
        ESP_LOGW(TAG, "LED PIN WALK: starting over");
        vTaskDelay(pdMS_TO_TICKS(3000));
    }
}
#endif
