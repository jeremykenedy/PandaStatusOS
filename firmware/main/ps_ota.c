/* The three upload targets behind POST /ota. FACT (docs/protocol-websocket.md, Upload
 * endpoint): OTA-Type is "ota_fw", "ota_img" or one of the fifteen slot names; the caps are
 * 0x480000, 0x6E0000 and 0x180000 bytes. The device answers on the socket with response
 * type ota_fw for firmware and ota_img for the image pack and for a single slot, with
 * "gif":"<slot>" when it was a slot: the mock's reading of the response root, INFERENCE
 * (D-014) until the bench.
 *
 * Where the bytes go:
 *   ota_fw    the next app slot, then it becomes the boot slot and the device restarts
 *             after the answer has left. Rollback is on (sdkconfig.defaults): a new image
 *             that does not confirm itself boots the old one next time.
 *   ota_img   the "images" partition (custom type 0x40), whole, from offset 0.
 *   a slot    one of PS_GIF_SLOTS equal regions of the images partition. PROVISIONAL
 *             (D-026): the real layout of the factory's image partition is a Phase 1 fact.
 *
 * The images partition on a 4 MB part is far smaller than fifteen 1.5 MB caps; a slot upload
 * over its region is refused even when under the cap. */
#include <string.h>
#include <stdlib.h>
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_timer.h"
#include "ps.h"

static const char *TAG = "ps_ota";

enum target { T_FW, T_IMG, T_SLOT };
typedef struct {
    enum target kind;
    int slot;                                   /* T_SLOT: index into ps_gif_slot_names */
    size_t cap;                                 /* bytes allowed */
    size_t written;
    /* firmware */
    const esp_partition_t *app;
    esp_ota_handle_t ota;
    /* images */
    const esp_partition_t *images;
    size_t base;                                /* offset of the region inside images */
} ctx_t;

static uint16_t s_slots_present;                /* bit n: slot n received data since boot */

static const esp_partition_t *images_partition(void)
{
    return esp_partition_find_first((esp_partition_type_t)0x40, (esp_partition_subtype_t)0x00, "images");
}

/* How many bytes one slot may take on THIS unit, or zero when the flash carries no images
 * partition at all. The stock table read out of the unit (firmware/partitions.csv) has none:
 * nvs, otadata, two app slots and a coredump fill the 4 MB exactly. So on this hardware the
 * honest answer is zero, and the page that asks is expected to say so rather than offer a
 * file chooser that can only ever be refused. */
size_t ps_ota_slot_cap(void)
{
    const esp_partition_t *img = images_partition();
    if (!img) return 0;
    size_t region = (img->size / PS_GIF_SLOTS) & ~(size_t)0xFFF;
    return region < PS_CAP_GIF ? region : PS_CAP_GIF;
}

static int slot_index(const char *type)
{
    for (int i = 0; i < PS_GIF_SLOTS; i++) if (!strcmp(type, ps_gif_slot_names[i])) return i;
    return -1;
}

int ps_ota_begin(const char *type, size_t declared_len, void **out)
{
    *out = NULL;
    ctx_t *c = calloc(1, sizeof *c);
    if (!c) return -1;
    if (!strcmp(type, "ota_fw")) {
        c->kind = T_FW; c->cap = PS_CAP_OTA_FW;
        if (declared_len > c->cap) { ESP_LOGW(TAG, "ota_fw %u bytes over the cap", (unsigned)declared_len); free(c); return -1; }
        c->app = esp_ota_get_next_update_partition(NULL);
        if (!c->app) { ESP_LOGE(TAG, "no update partition"); free(c); return -1; }
        esp_err_t e = esp_ota_begin(c->app, declared_len ? declared_len : OTA_SIZE_UNKNOWN, &c->ota);
        if (e != ESP_OK) { ESP_LOGE(TAG, "esp_ota_begin: %d", (int)e); free(c); return -1; }
    } else if (!strcmp(type, "ota_img")) {
        c->kind = T_IMG; c->cap = PS_CAP_OTA_IMG;
        c->images = images_partition();
        if (!c->images) { ESP_LOGE(TAG, "no images partition"); free(c); return -1; }
        if (declared_len > c->cap || declared_len > c->images->size) { ESP_LOGW(TAG, "ota_img %u bytes does not fit", (unsigned)declared_len); free(c); return -1; }
        c->base = 0;
        if (c->images->size > c->cap) c->cap = c->images->size; else c->cap = c->images->size;
        esp_err_t e = esp_partition_erase_range(c->images, 0, c->images->size);
        if (e != ESP_OK) { ESP_LOGE(TAG, "erase images: %d", (int)e); free(c); return -1; }
    } else {
        int s = slot_index(type);
        if (s < 0) { ESP_LOGW(TAG, "unknown OTA-Type"); free(c); return -1; }
        c->kind = T_SLOT; c->slot = s;
        c->images = images_partition();
        if (!c->images) { ESP_LOGE(TAG, "no images partition"); free(c); return -1; }
        size_t region = (c->images->size / PS_GIF_SLOTS) & ~(size_t)0xFFF;   /* erase-sector aligned */
        c->base = region * (size_t)s;
        c->cap = region < PS_CAP_GIF ? region : PS_CAP_GIF;
        if (declared_len > c->cap) { ESP_LOGW(TAG, "%s: %u bytes over its region", type, (unsigned)declared_len); free(c); return -1; }
        esp_err_t e = esp_partition_erase_range(c->images, c->base, region);
        if (e != ESP_OK) { ESP_LOGE(TAG, "erase slot %d: %d", s, (int)e); free(c); return -1; }
    }
    *out = c;
    return 0;
}

int ps_ota_write(void *ctxp, const void *data, size_t len)
{
    ctx_t *c = ctxp;
    if (!c) return -1;
    if (c->written + len > c->cap) { ESP_LOGW(TAG, "upload ran past its cap"); return -1; }
    esp_err_t e;
    if (c->kind == T_FW) e = esp_ota_write(c->ota, data, len);
    else e = esp_partition_write(c->images, c->base + c->written, data, len);
    if (e != ESP_OK) { ESP_LOGE(TAG, "write: %d", (int)e); return -1; }
    c->written += len;
    return 0;
}

static void restart_cb(void *arg) { (void)arg; ps_restart("ota_fw applied"); }

int ps_ota_end(void *ctxp, bool ok)
{
    ctx_t *c = ctxp;
    if (!c) return -1;
    int rc = 0;
    if (c->kind == T_FW) {
        if (ok) {
            esp_err_t e = esp_ota_end(c->ota);
            if (e == ESP_OK) e = esp_ota_set_boot_partition(c->app);
            ok = (e == ESP_OK);
            if (!ok) ESP_LOGE(TAG, "ota end/set boot: %d", (int)e);
        } else esp_ota_abort(c->ota);
        ps_ws_response("ota_fw", ok, NULL, -1);
        if (ok) {
            /* let the answer leave before the restart */
            const esp_timer_create_args_t ta = { .callback = restart_cb, .name = "ps_ota_restart" };
            esp_timer_handle_t t; if (esp_timer_create(&ta, &t) == ESP_OK) esp_timer_start_once(t, 500 * 1000);
        }
        rc = ok ? 0 : -1;
    } else if (c->kind == T_IMG) {
        /* INFERENCE: the factory page handles settings.img_version but the observed device
         * never sent one, and the pack's version format is unknown; nothing is invented */
        ps_ws_response("ota_img", ok, NULL, -1);
        ESP_LOGI(TAG, "image pack %s, %u bytes", ok ? "written" : "failed", (unsigned)c->written);
        rc = ok ? 0 : -1;
    } else {
        if (ok) s_slots_present |= (uint16_t)(1u << c->slot);
        ps_ws_response("ota_img", ok, ps_gif_slot_names[c->slot], -1);
        ESP_LOGI(TAG, "slot %s %s, %u bytes", ps_gif_slot_names[c->slot], ok ? "written" : "failed", (unsigned)c->written);
        rc = ok ? 0 : -1;
    }
    free(c);
    return rc;
}

/* Called once the web server is up: this image stays the boot image. Without it the
 * bootloader's rollback would return to the previous slot on the next reset. */
void ps_ota_confirm_boot(void)
{
    esp_err_t e = esp_ota_mark_app_valid_cancel_rollback();
    if (e == ESP_OK) ESP_LOGI(TAG, "running image confirmed");
}
