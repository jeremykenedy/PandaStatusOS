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

/* ---- the guard ----
 *
 * Two things stop this device for good if they stop: the web server, which is one task, and
 * ps_lock, which every task takes. Nothing on the network can restart a device whose server
 * has stopped, so the only way back was a power cycle, and the log that would have said why
 * went with it. So a task wakes every ten seconds and checks both: the lock must come free
 * within ten seconds, and the server must run a queued ping within two minutes (a page load
 * or an upload can keep it busy for a while; a stopped server never gets there). If either
 * fails it writes down which, and who holds the lock, and restarts. The log ring survives that
 * restart (ps_log.c), so the Logs page afterwards shows what came before.
 *
 * It runs above every task it watches, so one that spins cannot starve it, and it spends
 * nearly all its time asleep. */
#define PS_GUARD_EVERY_MS   10000
#define PS_GUARD_LOCK_MS    10000
#define PS_GUARD_SERVER_MS 120000
static void guard_task(void *arg)
{
    (void)arg;
    for (;;) {
        vTaskDelay(pdMS_TO_TICKS(PS_GUARD_EVERY_MS));
        if (xSemaphoreTakeRecursive(s_lock, pdMS_TO_TICKS(PS_GUARD_LOCK_MS)) != pdTRUE) {
            TaskHandle_t h = xSemaphoreGetMutexHolder(s_lock);
            ESP_LOGE(TAG, "guard: ps_lock held over %d s by %s", PS_GUARD_LOCK_MS / 1000, h ? pcTaskGetName(h) : "no task");
            ps_restart("guard, ps_lock");
        }
        xSemaphoreGiveRecursive(s_lock);
        if (!ps_ws_alive(PS_GUARD_SERVER_MS)) {
            ESP_LOGE(TAG, "guard: the web server ran nothing from its queue in %d s", PS_GUARD_SERVER_MS / 1000);
            ps_restart("guard, web server");
        }
    }
}

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
    ps_printer_init();   /* the MQTT client's own task, before anything can ask it for something */
    ps_wifi_start();
    ps_ws_start();
    ps_portal_start();   /* answer DNS for the hotspot, so joining it opens the setup page */
    ps_printer_discover_start();   /* listen for printer announcements from here on */
    ps_bridge_start();             /* the vent bridge's task; idle until bit 0 is on and a vent is bound */
    ps_ota_confirm_boot();                       /* the page is reachable: this image stays */
    ps_printer_start();
    if (xTaskCreate(guard_task, "ps_guard", 3072, NULL, 10, NULL) != pdPASS) ESP_LOGE(TAG, "guard would not start");
    #if CONFIG_PS_LED_PIN_WALK
    /* The pin walk is a diagnostic and it needs a person to watch and count. Fan-out replaced
       it: the strip lights without anyone counting anything. Kept because it is the only way to
       name the pin exactly, and naming it is how the fan-out goes away. LAST and in its own
       task, so the network is always up first and this build can be replaced over the air. */
    xTaskCreate((TaskFunction_t)ps_led_pin_walk, "ps_pinwalk", 4096, NULL, 3, NULL);
    #endif
}
