/* app_main: bring the pieces up in dependency order. Nothing here talks to a printer or
 * a network before the config is loaded, and nothing flashes anything. */
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "ps.h"

static const char *TAG = "ps";
static SemaphoreHandle_t s_lock;

void ps_lock(void)   { xSemaphoreTakeRecursive(s_lock, portMAX_DELAY); }
void ps_unlock(void) { xSemaphoreGiveRecursive(s_lock); }
void ps_restart(const char *why) { ESP_LOGW(TAG, "restart: %s", why); vTaskDelay(pdMS_TO_TICKS(150)); esp_restart(); }

void app_main(void)
{
    ps_log_init();   /* before anything else: a log that starts late misses the boot */
    s_lock = xSemaphoreCreateRecursiveMutex();
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) { ESP_ERROR_CHECK(nvs_flash_erase()); err = nvs_flash_init(); }
    ESP_ERROR_CHECK(err);
    ps_state_init();
    ESP_LOGI(TAG, "config loaded, mode %u, hostname %s", g_ps.cfg.current_mode, g_ps.cfg.hostname);
    ps_led_init();
    ps_effect_start();
    ps_wifi_start();
    ps_ws_start();
    ps_portal_start();   /* answer DNS for the hotspot, so joining it opens the setup page */
    ps_printer_discover_start();   /* listen for printer announcements from here on */
    ps_ota_confirm_boot();                       /* the page is reachable: this image stays */
    ps_printer_start();
    #if CONFIG_PS_LED_PIN_WALK
    /* The pin walk is a diagnostic and it needs a person to watch and count. Fan-out replaced
       it: the strip lights without anyone counting anything. Kept because it is the only way to
       name the pin exactly, and naming it is how the fan-out goes away. LAST and in its own
       task, so the network is always up first and this build can be replaced over the air. */
    xTaskCreate((TaskFunction_t)ps_led_pin_walk, "ps_pinwalk", 4096, NULL, 3, NULL);
    #endif
}
