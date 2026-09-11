/* app_main: bring the pieces up in dependency order. Nothing here talks to a printer or
 * a network before the config is loaded, and nothing flashes anything. */
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "esp_log.h"
#include "esp_system.h"
#include "nvs_flash.h"
#include "ps.h"

static const char *TAG = "ps";
static SemaphoreHandle_t s_lock;

void ps_lock(void)   { xSemaphoreTakeRecursive(s_lock, portMAX_DELAY); }
void ps_unlock(void) { xSemaphoreGiveRecursive(s_lock); }
void ps_restart(const char *why) { ESP_LOGW(TAG, "restart: %s", why); vTaskDelay(pdMS_TO_TICKS(150)); esp_restart(); }

void app_main(void)
{
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
    ps_printer_start();
}
