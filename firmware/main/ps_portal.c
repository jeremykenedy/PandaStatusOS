/* The captive portal: joining the hotspot opens the setup page by itself.
 *
 * A phone decides it is behind a portal by fetching a known URL and getting something other
 * than the expected answer. iOS asks captive.apple.com, Android asks a Google host for an
 * empty 204, Windows asks for a known body. Each is a different name, so the device has to be
 * the DNS server for its own hotspot and answer every name with its own address. Then all
 * three probes arrive here, match no registered path, fall through to the wildcard, and are
 * redirected. That redirect is what opens the sheet.
 *
 * Two rules keep this from becoming a nuisance on the owner's real network:
 *
 *   - The DNS half answers only queries that arrived from the hotspot's own subnet, which is
 *     read from the live configuration rather than compiled in, so changing the hotspot's
 *     address cannot leave the responder handing out the old one.
 *   - The redirect answers only clients on the hotspot. A browser on the house network that
 *     asks for a path this firmware does not serve gets a 404 from the server, not a bounce to
 *     an address it cannot route to.
 *
 * The page the sheet gets is not the application. A captive sheet is a small, impatient
 * WebView, and this firmware's page is over a megabyte with a typeface and 25 languages in it.
 * It gets three kilobytes of plain HTML that does the one job the portal exists for, over the
 * same WebSocket the application uses. The full interface is one link away. */
#include <string.h>
#include <stdio.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "esp_http_server.h"
#include "ps.h"

static const char *TAG = "ps_portal";
extern const uint8_t portal_html_start[] asm("_binary_portal_html_start");
extern const uint8_t portal_html_end[]   asm("_binary_portal_html_end");

#define DNS_PORT 53

/* The hotspot's address and its /24, both read from the configuration every time. */
static uint32_t ap_addr_host_order(void)
{
    ps_lock();
    uint32_t a = ((uint32_t)g_ps.cfg.ap_ip[0] << 24) | ((uint32_t)g_ps.cfg.ap_ip[1] << 16)
               | ((uint32_t)g_ps.cfg.ap_ip[2] << 8)  |  (uint32_t)g_ps.cfg.ap_ip[3];
    ps_unlock();
    return a;
}

bool ps_portal_addr_on_ap(uint32_t addr_host_order)
{
    uint32_t ap = ap_addr_host_order();
    if (ap == 0) return false;
    return (addr_host_order & 0xFFFFFF00u) == (ap & 0xFFFFFF00u);
}

/* Is this request from a client on the hotspot rather than on the house network?
 * lwIP hands back a v4-mapped address when it is built dual-stack, so the v6 shape has to be
 * unpacked; reading sockaddr_in only would compile, run, and answer false forever. */
bool ps_portal_req_from_ap(httpd_req_t *req)
{
    int fd = httpd_req_to_sockfd(req);
    if (fd < 0) return false;
    struct sockaddr_in6 peer;
    socklen_t len = sizeof peer;
    if (getpeername(fd, (struct sockaddr *)&peer, &len) != 0) return false;
    uint32_t a;
    if (peer.sin6_family == AF_INET) {
        a = ntohl(((struct sockaddr_in *)&peer)->sin_addr.s_addr);
    } else {
        const uint8_t *b = (const uint8_t *)&peer.sin6_addr;
        a = ((uint32_t)b[12] << 24) | ((uint32_t)b[13] << 16) | ((uint32_t)b[14] << 8) | (uint32_t)b[15];
    }
    return ps_portal_addr_on_ap(a);
}

/* The three kilobytes a captive sheet gets. Sent whole: the embedded file has no terminator
 * added to it, so subtracting a byte here would silently truncate the last one. */
int ps_portal_page(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_send(req, (const char *)portal_html_start,
                           (size_t)(portal_html_end - portal_html_start));
}

static void dns_task(void *arg)
{
    (void)arg;
    int sock = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (sock < 0) { ESP_LOGE(TAG, "dns: socket failed"); vTaskDelete(NULL); return; }
    struct sockaddr_in me = { .sin_family = AF_INET, .sin_port = htons(DNS_PORT),
                              .sin_addr.s_addr = htonl(INADDR_ANY) };
    if (bind(sock, (struct sockaddr *)&me, sizeof me) < 0) {
        ESP_LOGE(TAG, "dns: bind failed"); close(sock); vTaskDelete(NULL); return;
    }
    ESP_LOGI(TAG, "captive dns up on :%d", DNS_PORT);

    uint8_t buf[256];
    for (;;) {
        struct sockaddr_in from; socklen_t flen = sizeof from;
        int n = recvfrom(sock, buf, sizeof buf, 0, (struct sockaddr *)&from, &flen);
        if (n < 12) continue;
        if (!ps_portal_addr_on_ap(ntohl(from.sin_addr.s_addr))) continue;   /* never for the LAN */

        uint16_t qd = (uint16_t)((buf[4] << 8) | buf[5]);
        if ((buf[2] & 0x80) || qd != 1) continue;          /* a reply, or not one question */

        int p = 12;                                         /* walk the question to its end */
        while (p < n && buf[p]) { p += buf[p] + 1; if (p > 200) break; }
        p += 5;                                             /* root label, qtype, qclass */
        if (p > n || p + 16 > (int)sizeof buf) continue;

        buf[2] = 0x81; buf[3] = 0x80;                       /* response, recursion available */
        buf[6] = 0; buf[7] = 1;                             /* one answer */
        buf[8] = 0; buf[9] = 0; buf[10] = 0; buf[11] = 0;

        uint8_t *w = buf + p;
        *w++ = 0xC0; *w++ = 0x0C;                           /* the name: back to the question */
        *w++ = 0x00; *w++ = 0x01;                           /* type A */
        *w++ = 0x00; *w++ = 0x01;                           /* class IN */
        *w++ = 0; *w++ = 0; *w++ = 0; *w++ = 60;            /* ttl 60s */
        *w++ = 0x00; *w++ = 0x04;                           /* four bytes of address */
        uint32_t ip = htonl(ap_addr_host_order());          /* the hotspot's own, read live */
        memcpy(w, &ip, 4); w += 4;

        sendto(sock, buf, (int)(w - buf), 0, (struct sockaddr *)&from, flen);
    }
}

void ps_portal_start(void)
{
    static bool started;
    if (started) return;
    started = true;
    if (xTaskCreate(dns_task, "ps_dns", 3072, NULL, 5, NULL) != pdPASS)
        ESP_LOGE(TAG, "dns task would not start: the hotspot will not open a sheet by itself");
}
