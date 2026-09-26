/* GET /backup: the whole flash, as bytes, over HTTP.
 *
 * The only revert path this hardware has is a full flash image, and the factory firmware
 * offers no way to take one. This is the clone's. It reads through esp_flash_read(), which
 * goes to the chip and not through the instruction cache, so the image is what esptool
 * reads over the cable: proven byte-identical on the vent for the bootloader and the
 * partition table, to be proven on the P2 at the bench (firmware/SAFETY.md).
 *
 * X-Flash-Size carries the chip's physical size before the body. The body is chunked, so
 * there is no Content-Length; a client compares what it received against that header and
 * a short read is a short read, never a backup.
 *
 * The image carries NVS, and NVS carries the Wi-Fi password and the printer's access code
 * in plaintext. The factory device keeps its hotspot up by default and open, so anyone in
 * radio range could otherwise take the home network's password without ever joining it.
 * Requests that arrive over the hotspot are refused (D-029); the owner takes backups from
 * the network the device is on. */
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include "esp_log.h"
#include "esp_flash.h"
#include "esp_netif.h"
#include "esp_http_server.h"
#include "lwip/sockets.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "ps.h"

static const char *TAG = "ps_backup";
#define CHUNK 4096u

/* true when the request came in on the hotspot's address, or when that cannot be told.
 *
 * The local address is what says which interface answered, and it has to be read the way
 * the server actually hands it over. The HTTP server listens on a dual-stack socket, so
 * getsockname() reports AF_INET6 for every request, including plain IPv4 clients, whose
 * address arrives mapped as ::ffff:a.b.c.d. The first version of this refused anything
 * that was not AF_INET, which is everything: GET /backup answered 403 on the station
 * interface, on the device, every time, and the only route off this hardware back to a
 * factory image could not be used at all. The harness never caught it because the mock is
 * a node server with no interfaces to tell apart.
 *
 * With no hotspot up there is nothing to refuse. With one up, a request whose local
 * address is the hotspot's is refused, and a genuine IPv6 request is refused too, because
 * which interface it arrived on cannot be told from here and the image carries the Wi-Fi
 * password in plaintext (D-029). */
static bool via_hotspot(httpd_req_t *req)
{
    int fd = httpd_req_to_sockfd(req);
    struct sockaddr_storage ss;
    socklen_t len = sizeof ss;
    if (fd < 0 || getsockname(fd, (struct sockaddr *)&ss, &len) != 0) return true;

    esp_netif_t *ap = esp_netif_get_handle_from_ifkey("WIFI_AP_DEF");
    esp_netif_ip_info_t ip;
    if (!ap || esp_netif_get_ip_info(ap, &ip) != ESP_OK || ip.ip.addr == 0) return false;

    uint32_t local;
    if (ss.ss_family == AF_INET) {
        local = ((struct sockaddr_in *)&ss)->sin_addr.s_addr;
    } else if (ss.ss_family == AF_INET6) {
        static const uint8_t V4MAPPED[12] = { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xFF, 0xFF };
        const uint8_t *a = (const uint8_t *)&((struct sockaddr_in6 *)&ss)->sin6_addr;
        if (memcmp(a, V4MAPPED, sizeof V4MAPPED) != 0) return true;
        memcpy(&local, a + 12, sizeof local);
    } else {
        return true;
    }
    return local == ip.ip.addr;
}

esp_err_t ps_backup_get(httpd_req_t *req)
{
    if (via_hotspot(req)) {
        ESP_LOGW(TAG, "refused: request arrived over the hotspot");
        httpd_resp_set_status(req, "403 Forbidden");
        return httpd_resp_send(req, "backup is served on the station interface only", HTTPD_RESP_USE_STRLEN);
    }
    uint32_t size = 0;
    if (esp_flash_get_physical_size(NULL, &size) != ESP_OK || size == 0) {
        if (esp_flash_get_size(NULL, &size) != ESP_OK || size == 0) {
            httpd_resp_set_status(req, "500 Internal Server Error");
            return httpd_resp_send(req, "flash size unknown", HTTPD_RESP_USE_STRLEN);
        }
    }
    uint8_t *buf = malloc(CHUNK);
    if (!buf) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    char len[16];
    snprintf(len, sizeof len, "%u", (unsigned)size);
    httpd_resp_set_type(req, "application/octet-stream");
    httpd_resp_set_hdr(req, "Content-Disposition", "attachment; filename=\"pandastatusos-flash.bin\"");
    httpd_resp_set_hdr(req, "X-Flash-Size", len);
    httpd_resp_set_hdr(req, "X-Build", ps_build_id());
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    ESP_LOGW(TAG, "streaming %u bytes of flash", (unsigned)size);
    esp_err_t err = ESP_OK;
    for (uint32_t off = 0; off < size; off += CHUNK) {
        uint32_t n = (size - off) < CHUNK ? (size - off) : CHUNK;
        if (esp_flash_read(NULL, buf, off, n) != ESP_OK) { ESP_LOGE(TAG, "flash read failed at 0x%06x", (unsigned)off); err = ESP_FAIL; break; }
        if (httpd_resp_send_chunk(req, (const char *)buf, n) != ESP_OK) { ESP_LOGW(TAG, "client left at 0x%06x", (unsigned)off); err = ESP_FAIL; break; }
        ps_ws_feed();                                       /* a stream that moves is a server that is alive (the guard) */
        if (off && (off & 0x7FFFFu) == 0) vTaskDelay(1);   /* every 512 KB: Wi-Fi and the bar get a turn */
    }
    free(buf);
    httpd_resp_send_chunk(req, NULL, 0);   /* on the error path this ends the body short of X-Flash-Size, which is the point */
    if (err == ESP_OK) ESP_LOGW(TAG, "done, %u bytes", (unsigned)size);
    return err;
}
