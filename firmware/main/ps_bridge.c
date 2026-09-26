/* The vent bridge's device half (docs/PANDAVENT-BRIDGE.md), behind feature bit 0.
 *
 * One task owns one socket to one vent. It advertises this device as `_pandabridge._tcp`
 * while the bit is on, finds the bound vent by its identity over mDNS (then by the name that
 * was typed, then by the last address it answered at), opens a WebSocket to /bridge on it,
 * runs the hello and pairing exchange, proves itself with the token on every later hello,
 * keeps the vent's last report for the page, and asks the vent for its colours or one bar
 * state's effect when a copy is requested. It reconnects on its own, backing off, and a vent
 * that moved is found again under the same identity without a page visit.
 *
 * The transport is a plain lwIP socket with the project's own RFC 6455 client framing
 * (ps_bridge_proto.c), not a WebSocket client component: the framing is host-tested and the
 * dependency set stays what it was.
 *
 * Two locks, never nested. `s_mx` guards what the page reads (the binding, the link, the
 * pairing code, the vent's report, the scan list, the ask in flight). `ps_lock` guards g_ps
 * as everywhere else; this file takes it only to copy a few fields out or to land a copy,
 * and never while holding s_mx or while a socket call could block. Nothing here goes near
 * the MQTT client (D-049).
 *
 * The handlers (/api/bridge, /bridge/id) run on the web server's task. They read the state
 * under s_mx, change the binding themselves (bind, unbind) and post everything else to the
 * task through a queue that never waits. A copy is the one thing they wait for: the task
 * sends the ask, the answer wakes the handler, and a vent that does not answer inside
 * BR_ASK_MS is a copy that did not happen rather than a copy of nothing. */
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <strings.h>
#include <errno.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_mac.h"
#include "esp_random.h"
#include "esp_http_server.h"
#include "cJSON.h"
#include "mdns.h"
#include "mbedtls/sha1.h"
#include "mbedtls/base64.h"
#include "lwip/sockets.h"
#include "lwip/netdb.h"
#include "lwip/inet.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "ps.h"

static const char *TAG = "ps_bridge";

#define BR_SERVICE          "_pandabridge"
#define BR_PROTO            "_tcp"
#define BR_PORT             80
#define BR_TICK_MS          250      /* how long the task listens on the socket before it looks at its queue */
#define BR_CONNECT_MS       5000
#define BR_HANDSHAKE_MS     5000
#define BR_HELLO_MS         10000    /* a socket that opened and never said hello is not a vent */
#define BR_IDLE_MS          90000    /* a paired vent speaks at least every 30 s; three misses is a dead link */
#define BR_PAIR_MS          60000    /* the six digits stand for a minute, as the contract says */
#define BR_BACKOFF_MIN_MS   2000
#define BR_BACKOFF_MAX_MS   30000
#define BR_UNPAIRED_WAIT_MS 30000    /* between attempts while the vent will not have us, or a code lapsed */
#define BR_MDNS_MS          2000     /* one lookup, when reconnecting */
#define BR_SCAN_MS          3000     /* the page's scan */
#define BR_ASK_MS           2500     /* how long a copy waits for the vent's answer */
#define BR_RX_CAP           2048
#define BR_FOUND_MAX        8
#define BR_QUEUE            8

enum { LINK_UNBOUND = 0, LINK_CONNECTING = 2, LINK_CONNECTED = 3, LINK_IP_ERR = 4, LINK_ID_ERR = 5, LINK_UNPAIRED = 6 };

typedef struct { char id[17]; char name[33]; char ip[16]; } found_t;

enum { REQ_POKE = 1, REQ_SCAN, REQ_CONNECT, REQ_DROP, REQ_PAIR_CONFIRM, REQ_PAIR_CANCEL, REQ_ASK_LIGHT, REQ_ASK_FX };
typedef struct { uint8_t kind; uint8_t arg; } req_t;

/* What the page can see, under s_mx. */
static SemaphoreHandle_t s_mx;
static struct {
    ps_bridge_cfg_t cfg;             /* the stored part, as loaded and as saved */
    uint8_t  link;                   /* LINK_* */
    char     self_id[17];            /* this device's identity, from its station MAC */
    bool     pairing;                /* six digits are waiting for the person */
    char     code[7];
    char     pending_token[65];      /* what both ends store if they confirm */
    int64_t  pair_until_us;
    bool     have_vent;              /* a report has arrived on this link */
    ps_vent_report_t vent;
    found_t  found[BR_FOUND_MAX];
    int      nfound;
    bool     scanning;
    /* one ask at a time: the handler owns busy, the task fills the answer */
    bool     ask_busy;
    uint8_t  ask_kind;               /* REQ_ASK_LIGHT or REQ_ASK_FX */
    uint32_t ask_seq;                /* the seq of the frame that asked, for a refusing ack */
    char    *ask_answer;             /* the body of the answer, as JSON text; the handler frees it */
    bool     ask_refused;            /* the vent said no, or the link went before it answered */
} s;
static SemaphoreHandle_t s_ask_done;
static QueueHandle_t s_q;

/* The task's own; nothing else touches these. */
static int      s_sock = -1;
static uint8_t  s_rx[BR_RX_CAP];
static size_t   s_have;
static char     s_nonce[33];
static uint32_t s_seq;
static int      s_hellos_in;
static int64_t  s_connected_us, s_last_rx_us, s_next_try_us;
static uint32_t s_backoff_ms = BR_BACKOFF_MIN_MS;
static bool     s_advertised;
static char     s_adv_name[33];

static int64_t now_us(void) { return esp_timer_get_time(); }
static void lock(void)   { xSemaphoreTake(s_mx, portMAX_DELAY); }
static void unlock(void) { xSemaphoreGive(s_mx); }
static bool bit_on(void) { ps_lock(); bool on = (g_ps.cfg.features & PS_FEAT_BRIDGE) != 0; ps_unlock(); return on; }
static void hostname_copy(char *out, size_t n)
{
    ps_lock(); snprintf(out, n, "%s", g_ps.cfg.hostname); ps_unlock();
    if (!out[0]) snprintf(out, n, "status");
}
static void post(uint8_t kind, uint8_t arg)
{
    req_t r = { kind, arg };
    if (s_q) xQueueSend(s_q, &r, 0);   /* never waits: a full queue drops the request, and the loop re-reads its inputs anyway */
}
static const char *str_of(const cJSON *o, const char *k)
{
    const cJSON *v = cJSON_GetObjectItemCaseSensitive(o, k);
    return (cJSON_IsString(v) && v->valuestring) ? v->valuestring : NULL;
}
static bool ip_zero(const uint8_t ip[4]) { return !(ip[0] || ip[1] || ip[2] || ip[3]); }

/* ---- the socket ---------------------------------------------------------------------- */

static void schedule_retry(void)
{
    s_next_try_us = now_us() + (int64_t)s_backoff_ms * 1000;
    s_backoff_ms = s_backoff_ms * 2 > BR_BACKOFF_MAX_MS ? BR_BACKOFF_MAX_MS : s_backoff_ms * 2;
}
static void wait_unpaired(void) { s_next_try_us = now_us() + (int64_t)BR_UNPAIRED_WAIT_MS * 1000; }

/* Close the socket and say what the link is now. A copy waiting on this socket is woken with a
 * refusal rather than left to its timeout. */
static void sock_drop(uint8_t link)
{
    if (s_sock >= 0) { close(s_sock); s_sock = -1; }
    s_have = 0;
    lock();
    s.link = link;
    s.pairing = false;
    s.have_vent = false;
    if (s.ask_busy) { s.ask_refused = true; xSemaphoreGive(s_ask_done); }
    unlock();
}

static bool send_raw(const uint8_t *p, size_t n)
{
    while (n) {
        int w = send(s_sock, p, n, 0);
        if (w <= 0) return false;
        p += w; n -= (size_t)w;
    }
    return true;
}

static bool send_frame(uint8_t op, const void *payload, size_t len)
{
    if (s_sock < 0) return false;
    uint8_t mask[4]; esp_fill_random(mask, sizeof mask);
    size_t cap = len + 14;
    uint8_t *out = malloc(cap);
    if (!out) return false;
    size_t n = ps_ws_encode(op, payload, len, mask, out, cap);
    bool ok = n && send_raw(out, n);
    free(out);
    return ok;
}

/* One root with its body, the seq added; the body is consumed. */
static bool say(const char *root, cJSON *body)
{
    if (s_sock < 0) { cJSON_Delete(body); return false; }
    cJSON_AddNumberToObject(body, "seq", ++s_seq);
    cJSON *f = cJSON_CreateObject();
    cJSON_AddItemToObject(f, root, body);
    char *txt = cJSON_PrintUnformatted(f);
    cJSON_Delete(f);
    if (!txt) return false;
    bool ok = send_frame(PS_WS_TEXT, txt, strlen(txt));
    cJSON_free(txt);
    if (!ok) ESP_LOGW(TAG, "sending %s failed", root);
    return ok;
}

/* The hello. The first one on a socket proves over our own nonce when we hold a token,
 * because there is no other nonce yet; the second proves over the vent's. */
static bool send_hello(const char *over_nonce)
{
    char name[33]; hostname_copy(name, sizeof name);
    char token[65]; bool paired;
    lock(); paired = s.cfg.paired; memcpy(token, s.cfg.token, sizeof token); unlock();
    cJSON *b = cJSON_CreateObject();
    cJSON_AddNumberToObject(b, "ver", 1);
    cJSON_AddStringToObject(b, "id", s.self_id);
    cJSON_AddStringToObject(b, "kind", "status");
    cJSON_AddStringToObject(b, "name", name);
    cJSON_AddStringToObject(b, "nonce", s_nonce);
    if (paired) { char auth[65]; ps_bridge_auth(token, over_nonce, auth); cJSON_AddStringToObject(b, "auth", auth); }
    cJSON *caps = cJSON_AddArrayToObject(b, "caps");
    cJSON_AddItemToArray(caps, cJSON_CreateString("vent_state"));
    cJSON_AddItemToArray(caps, cJSON_CreateString("light"));
    return say("hello", b);
}

static void say_bye(const char *reason)
{
    cJSON *b = cJSON_CreateObject();
    cJSON_AddStringToObject(b, "reason", reason);
    say("bye", b);
}

/* ---- finding the vent ------------------------------------------------------------------ */

static const char *txt_get(const mdns_result_t *it, const char *key)
{
    for (size_t k = 0; k < it->txt_count; k++)
        if (it->txt[k].key && !strcmp(it->txt[k].key, key)) return it->txt[k].value ? it->txt[k].value : "";
    return NULL;
}
static bool first_v4(const mdns_result_t *it, uint32_t *out)
{
    for (const mdns_ip_addr_t *a = it->addr; a; a = a->next)
        if (a->addr.type == ESP_IPADDR_TYPE_V4) { *out = a->addr.u_addr.ip4.addr; return true; }
    return false;
}

/* The identity is the bind: whoever advertises it is the vent, wherever it has moved to. */
static bool addr_by_identity(const char *id, uint32_t timeout_ms, uint32_t *out)
{
    mdns_result_t *r = NULL;
    if (mdns_query_ptr(BR_SERVICE, BR_PROTO, timeout_ms, BR_FOUND_MAX, &r) != ESP_OK || !r) return false;
    bool ok = false;
    for (const mdns_result_t *it = r; it && !ok; it = it->next) {
        const char *tid = txt_get(it, "id");
        if (tid && !strcmp(tid, id)) ok = first_v4(it, out);
    }
    mdns_query_results_free(r);
    return ok;
}

/* What was typed: an address as it stands, or a name asked of mDNS and then of DNS. */
static bool addr_by_host(const char *host, uint32_t *out)
{
    ip4_addr_t lit;
    if (ip4addr_aton(host, &lit)) { *out = lit.addr; return true; }
    char label[64]; snprintf(label, sizeof label, "%s", host);
    size_t n = strlen(label);
    if (n > 6 && !strcasecmp(label + n - 6, ".local")) label[n - 6] = 0;
    esp_ip4_addr_t a4;
    if (mdns_query_a(label, BR_MDNS_MS, &a4) == ESP_OK && a4.addr) { *out = a4.addr; return true; }
    struct addrinfo hints = { .ai_family = AF_INET, .ai_socktype = SOCK_STREAM }, *res = NULL;
    if (getaddrinfo(host, "80", &hints, &res) == 0 && res) {
        *out = ((struct sockaddr_in *)res->ai_addr)->sin_addr.s_addr;
        freeaddrinfo(res);
        return true;
    }
    return false;
}

/* The contract's order: mDNS by identity first, the name that was typed second, the last
 * address the vent answered at third. Returns the address in network order. */
static bool resolve(uint32_t *out)
{
    ps_bridge_cfg_t c; lock(); c = s.cfg; unlock();
    if (!c.bound) return false;
    if (c.id[0] && addr_by_identity(c.id, BR_MDNS_MS, out)) return true;
    if (c.host[0] && addr_by_host(c.host, out)) return true;
    if (!ip_zero(c.ip)) { memcpy(out, c.ip, 4); return true; }
    return false;
}

/* ---- opening the socket ---------------------------------------------------------------- */

static int tcp_connect(uint32_t addr)
{
    int fd = socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (fd < 0) return -1;
    int fl = fcntl(fd, F_GETFL, 0);
    fcntl(fd, F_SETFL, fl | O_NONBLOCK);
    struct sockaddr_in sa; memset(&sa, 0, sizeof sa);
    sa.sin_family = AF_INET; sa.sin_port = htons(BR_PORT); sa.sin_addr.s_addr = addr;
    int rc = connect(fd, (struct sockaddr *)&sa, sizeof sa);
    if (rc < 0 && errno != EINPROGRESS) { close(fd); return -1; }
    fd_set wf; FD_ZERO(&wf); FD_SET(fd, &wf);
    struct timeval tv = { .tv_sec = BR_CONNECT_MS / 1000, .tv_usec = 0 };
    if (select(fd + 1, NULL, &wf, NULL, &tv) <= 0) { close(fd); return -1; }
    int err = 0; socklen_t l = sizeof err;
    if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &err, &l) < 0 || err) { close(fd); return -1; }
    fcntl(fd, F_SETFL, fl);
    struct timeval to = { .tv_sec = BR_HANDSHAKE_MS / 1000, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &to, sizeof to);
    to.tv_sec = 3;
    setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &to, sizeof to);
    return fd;
}

/* RFC 6455 section 4: the upgrade request, and the one header that proves the other end
 * read our key rather than answering 101 to anything. Bytes past the head are frame data
 * and stay in the buffer. */
static bool ws_handshake(const char *ipstr)
{
    uint8_t raw[16]; esp_fill_random(raw, sizeof raw);
    unsigned char key[32]; size_t klen = 0;
    if (mbedtls_base64_encode(key, sizeof key, &klen, raw, sizeof raw) != 0) return false;
    key[klen] = 0;
    char req[256];
    int n = snprintf(req, sizeof req,
                     "GET /bridge HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                     "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\n\r\n", ipstr, (char *)key);
    if (n <= 0 || n >= (int)sizeof req || !send_raw((const uint8_t *)req, (size_t)n)) return false;

    char cat[80]; snprintf(cat, sizeof cat, "%s258EAFA5-E914-47DA-95CA-C5AB0DC85B11", (char *)key);
    unsigned char sha[20];
    if (mbedtls_sha1((const unsigned char *)cat, strlen(cat), sha) != 0) return false;
    unsigned char want[32]; size_t wlen = 0;
    if (mbedtls_base64_encode(want, sizeof want, &wlen, sha, sizeof sha) != 0) return false;
    want[wlen] = 0;

    s_have = 0;
    char *end = NULL;
    int64_t deadline = now_us() + (int64_t)BR_HANDSHAKE_MS * 1000;
    while (!end) {
        if (now_us() > deadline || s_have >= sizeof s_rx - 1) return false;
        int got = recv(s_sock, s_rx + s_have, sizeof s_rx - 1 - s_have, 0);
        if (got <= 0) return false;
        s_have += (size_t)got;
        s_rx[s_have] = 0;
        end = strstr((char *)s_rx, "\r\n\r\n");
    }
    if (strncmp((char *)s_rx, "HTTP/1.1 101", 12) != 0) return false;
    bool accepted = false;
    for (char *line = strstr((char *)s_rx, "\r\n"); line && line < end; line = strstr(line + 2, "\r\n")) {
        char *h = line + 2;
        if (strncasecmp(h, "Sec-WebSocket-Accept:", 21) != 0) continue;
        h += 21; while (*h == ' ' || *h == '\t') h++;
        accepted = strncmp(h, (char *)want, wlen) == 0;
        break;
    }
    if (!accepted) return false;
    size_t head = (size_t)((end + 4) - (char *)s_rx);
    memmove(s_rx, s_rx + head, s_have - head);
    s_have -= head;
    return true;
}

static void connect_once(void)
{
    lock(); s.link = LINK_CONNECTING; unlock();
    uint32_t addr = 0;
    if (!resolve(&addr)) {
        ESP_LOGW(TAG, "the vent could not be found");
        lock(); s.link = LINK_IP_ERR; unlock();
        schedule_retry();
        return;
    }
    char ipstr[16]; inet_ntop(AF_INET, &addr, ipstr, sizeof ipstr);
    int fd = tcp_connect(addr);
    if (fd < 0) {
        ESP_LOGW(TAG, "no answer at %s", ipstr);
        lock(); s.link = LINK_IP_ERR; unlock();
        schedule_retry();
        return;
    }
    s_sock = fd;
    if (!ws_handshake(ipstr)) {
        ESP_LOGW(TAG, "%s does not serve a bridge", ipstr);
        sock_drop(LINK_IP_ERR);
        schedule_retry();
        return;
    }
    /* Remember where it answered, so the next attempt has somewhere to try if mDNS is quiet. */
    bool save = false; ps_bridge_cfg_t copy = { 0 };
    lock();
    if (s.cfg.bound && memcmp(s.cfg.ip, &addr, 4) != 0) { memcpy(s.cfg.ip, &addr, 4); save = true; }
    copy = s.cfg;
    unlock();
    if (save) ps_bridge_cfg_save(&copy);

    uint8_t nb[16]; esp_fill_random(nb, sizeof nb); ps_hex(nb, sizeof nb, s_nonce);
    s_seq = 0; s_hellos_in = 0;
    s_connected_us = s_last_rx_us = now_us();
    send_hello(s_nonce);
    ESP_LOGI(TAG, "connected to %s, hello sent", ipstr);
}

/* ---- what the vent says ------------------------------------------------------------------ */

/* The vent's hello. Once per socket from the vent's side; this side answers the first with its
 * second hello, proving over the vent's nonce, and answers nothing after that, so two devices
 * cannot greet each other for ever. */
static void on_hello(const cJSON *body)
{
    const char *id = str_of(body, "id"), *nonce = str_of(body, "nonce"), *name = str_of(body, "name"), *auth = str_of(body, "auth");
    bool pair = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(body, "pair"));
    s_hellos_in++;
    if (s_hellos_in > 1) return;                                       /* it has said hello already; nothing more to answer */
    if (!id || strlen(id) != 16 || !nonce || !nonce[0]) {
        ESP_LOGW(TAG, "a hello without an identity or a nonce");
        sock_drop(LINK_ID_ERR); schedule_retry();
        return;
    }
    bool save = false; ps_bridge_cfg_t copy = { 0 };
    lock();
    if (!s.cfg.bound) { unlock(); sock_drop(LINK_UNBOUND); return; }   /* unbound while connecting */
    if (s.cfg.id[0] && strcmp(s.cfg.id, id) != 0) {
        unlock();
        ESP_LOGW(TAG, "a different vent answered at that address");
        sock_drop(LINK_ID_ERR); schedule_retry();
        return;
    }
    if (!s.cfg.id[0]) { snprintf(s.cfg.id, sizeof s.cfg.id, "%s", id); save = true; }
    if (name && strncmp(s.cfg.name, name, sizeof s.cfg.name - 1) != 0) { snprintf(s.cfg.name, sizeof s.cfg.name, "%s", name); save = true; }
    if (pair) {
        /* It holds no token for us: the six digits go on the page and the person decides. */
        ps_bridge_code(s_nonce, nonce, s.self_id, id, s.code);
        ps_bridge_token(s_nonce, nonce, s.self_id, id, s.pending_token);
        s.pairing = true;
        s.pair_until_us = now_us() + (int64_t)BR_PAIR_MS * 1000;
        s.link = LINK_UNPAIRED;
        copy = s.cfg;
        unlock();
        if (save) ps_bridge_cfg_save(&copy);
        ESP_LOGI(TAG, "pairing: the code is on the page for %d s", BR_PAIR_MS / 1000);
        return;
    }
    if (!s.cfg.paired) {
        copy = s.cfg;
        unlock();
        if (save) ps_bridge_cfg_save(&copy);
        ESP_LOGW(TAG, "the vent holds a token for this device and this device holds none; forget this device on the vent, or unbind and bind again");
        say_bye("unpaired");
        sock_drop(LINK_UNPAIRED); wait_unpaired();
        return;
    }
    char want[65]; ps_bridge_auth(s.cfg.token, s_nonce, want);
    if (!auth || strcmp(auth, want) != 0) {
        copy = s.cfg;
        unlock();
        if (save) ps_bridge_cfg_save(&copy);
        ESP_LOGW(TAG, "the vent's proof did not check");
        say_bye("unpaired");
        sock_drop(LINK_UNPAIRED); wait_unpaired();
        return;
    }
    s.link = LINK_CONNECTED;
    copy = s.cfg;
    unlock();
    if (save) ps_bridge_cfg_save(&copy);
    s_backoff_ms = BR_BACKOFF_MIN_MS;
    send_hello(nonce);                                                 /* our proof, over the nonce it just sent */
    ESP_LOGI(TAG, "the vent knows this device; link up");
}

/* The vent's confirm: both ends now hold the same token. */
static void on_pair(const cJSON *body)
{
    if (!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(body, "confirm"))) return;
    ps_bridge_cfg_t copy = { 0 }; bool store = false;
    lock();
    if (s.pairing && s.cfg.bound) {
        memcpy(s.cfg.token, s.pending_token, sizeof s.cfg.token);
        s.cfg.paired = 1;
        s.pairing = false;
        s.link = LINK_CONNECTED;
        copy = s.cfg; store = true;
    }
    unlock();
    if (store) { ps_bridge_cfg_save(&copy); s_backoff_ms = BR_BACKOFF_MIN_MS; ESP_LOGI(TAG, "paired"); }
}

static void on_vent(const cJSON *body)
{
    ps_vent_report_t rep;
    if (ps_bridge_vent_parse(body, &rep) != 0) { ESP_LOGW(TAG, "a vent frame that is not a report"); return; }
    lock();
    bool first = !s.have_vent;
    s.vent = rep; s.have_vent = true; s.link = LINK_CONNECTED;
    unlock();
    s_backoff_ms = BR_BACKOFF_MIN_MS;
    if (first) ESP_LOGI(TAG, "the vent is %s", ps_vent_state_name(rep.state));
}

/* The answers a copy is made of: light with colours, fx with an effect. Kept only while a
 * handler is waiting for one; an answer nobody asked for is dropped. */
static void on_answer(const char *root, const cJSON *body)
{
    bool is_light = !strcmp(root, "light") && cJSON_IsArray(cJSON_GetObjectItemCaseSensitive(body, "colours"));
    bool is_fx    = !strcmp(root, "fx") && cJSON_IsNumber(cJSON_GetObjectItemCaseSensitive(body, "effect"));
    if (!is_light && !is_fx) return;
    char *txt = cJSON_PrintUnformatted(body);
    if (!txt) return;
    lock();
    bool wanted = s.ask_busy && !s.ask_answer && ((is_light && s.ask_kind == REQ_ASK_LIGHT) || (is_fx && s.ask_kind == REQ_ASK_FX));
    if (wanted) { s.ask_answer = txt; xSemaphoreGive(s_ask_done); }
    unlock();
    if (!wanted) cJSON_free(txt);
}

static void on_ack(const cJSON *body)
{
    const cJSON *seq = cJSON_GetObjectItemCaseSensitive(body, "seq");
    bool ok = cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(body, "ok"));
    if (ok || !cJSON_IsNumber(seq)) return;
    lock();
    if (s.ask_busy && (uint32_t)seq->valuedouble == s.ask_seq) { s.ask_refused = true; xSemaphoreGive(s_ask_done); }
    unlock();
}

static void on_text(const char *root, const cJSON *body)
{
    if      (!strcmp(root, "hello")) on_hello(body);
    else if (!strcmp(root, "pair"))  on_pair(body);
    else if (!strcmp(root, "vent"))  on_vent(body);
    else if (!strcmp(root, "light") || !strcmp(root, "fx")) on_answer(root, body);
    else if (!strcmp(root, "ack"))   on_ack(body);
    else if (!strcmp(root, "bye")) {
        const char *why = str_of(body, "reason");
        ESP_LOGW(TAG, "the vent said bye%s%.16s", why ? ", " : "", why ? why : "");
        sock_drop(LINK_UNPAIRED); wait_unpaired();
    }
    else ESP_LOGI(TAG, "a root this device does not read: %.16s", root);
}

static void on_frame(const ps_ws_frame_t *f)
{
    switch (f->opcode) {
    case PS_WS_PING:  send_frame(PS_WS_PONG, f->payload, (size_t)f->len); return;
    case PS_WS_PONG:  return;
    case PS_WS_CLOSE: ESP_LOGI(TAG, "the vent closed the socket"); sock_drop(LINK_CONNECTING); schedule_retry(); return;
    case PS_WS_TEXT:  break;
    default:          return;                                          /* binary, continuation: nothing this link carries */
    }
    if (!f->fin) { ESP_LOGW(TAG, "a fragmented frame, which this link does not use"); return; }
    cJSON *root = cJSON_ParseWithLength((const char *)f->payload, (size_t)f->len);
    if (!root || !cJSON_IsObject(root) || !root->child || !root->child->string || !cJSON_IsObject(root->child)) {
        cJSON_Delete(root);
        ESP_LOGW(TAG, "a frame that is not one root with a body");
        return;
    }
    on_text(root->child->string, root->child);
    cJSON_Delete(root);
}

/* One listen on the socket, then the clocks. */
static void pump(void)
{
    fd_set rf; FD_ZERO(&rf); FD_SET(s_sock, &rf);
    struct timeval tv = { .tv_sec = 0, .tv_usec = BR_TICK_MS * 1000 };
    int r = select(s_sock + 1, &rf, NULL, NULL, &tv);
    if (r > 0) {
        int got = recv(s_sock, s_rx + s_have, sizeof s_rx - s_have, 0);
        if (got <= 0) { ESP_LOGW(TAG, "the socket closed"); sock_drop(LINK_CONNECTING); schedule_retry(); return; }
        s_have += (size_t)got;
        s_last_rx_us = now_us();
        while (s_sock >= 0) {
            ps_ws_frame_t f;
            int used = ps_ws_parse(s_rx, s_have, &f);
            if (used == 0) {
                if (s_have == sizeof s_rx) { ESP_LOGW(TAG, "a frame too big to hold"); sock_drop(LINK_CONNECTING); schedule_retry(); }
                break;
            }
            if (used < 0) { ESP_LOGW(TAG, "bytes that are not a frame"); sock_drop(LINK_CONNECTING); schedule_retry(); break; }
            on_frame(&f);
            if (s_sock < 0) break;
            memmove(s_rx, s_rx + used, s_have - (size_t)used);
            s_have -= (size_t)used;
        }
    }
    if (s_sock < 0) return;
    int64_t now = now_us();
    if (s_hellos_in == 0 && now - s_connected_us > (int64_t)BR_HELLO_MS * 1000) {
        ESP_LOGW(TAG, "the socket opened and nothing said hello");
        sock_drop(LINK_IP_ERR); schedule_retry(); return;
    }
    if (now - s_last_rx_us > (int64_t)BR_IDLE_MS * 1000) {
        ESP_LOGW(TAG, "the vent has gone quiet");
        sock_drop(LINK_CONNECTING); schedule_retry(); return;
    }
    bool lapsed; lock(); lapsed = s.pairing && now > s.pair_until_us; unlock();
    if (lapsed) {
        ESP_LOGI(TAG, "the pairing code lapsed; another in %d s", BR_UNPAIRED_WAIT_MS / 1000);
        sock_drop(LINK_UNPAIRED); wait_unpaired();
    }
}

/* ---- the page's requests, on the task ---------------------------------------------------- */

/* The scan: whoever advertises the service and calls itself a vent. Another status device is
 * not offered, and neither is this one. */
static void do_scan(void)
{
    found_t list[BR_FOUND_MAX]; int n = 0;
    mdns_result_t *r = NULL;
    if (mdns_query_ptr(BR_SERVICE, BR_PROTO, BR_SCAN_MS, BR_FOUND_MAX, &r) == ESP_OK) {
        for (const mdns_result_t *it = r; it && n < BR_FOUND_MAX; it = it->next) {
            const char *kind = txt_get(it, "kind"), *id = txt_get(it, "id"), *name = txt_get(it, "name");
            if (!kind || strcmp(kind, "vent") != 0) continue;
            uint32_t a;
            if (!first_v4(it, &a)) continue;
            memset(&list[n], 0, sizeof list[n]);
            snprintf(list[n].id, sizeof list[n].id, "%s", id ? id : "");
            snprintf(list[n].name, sizeof list[n].name, "%s", (name && name[0]) ? name : (it->instance_name ? it->instance_name : "vent"));
            inet_ntop(AF_INET, &a, list[n].ip, sizeof list[n].ip);
            n++;
        }
        mdns_query_results_free(r);
    }
    lock();
    memcpy(s.found, list, sizeof list); s.nfound = n; s.scanning = false;
    unlock();
    ESP_LOGI(TAG, "scan: %d vent%s found", n, n == 1 ? "" : "s");
}

static void refuse_ask(void)
{
    lock();
    if (s.ask_busy) { s.ask_refused = true; xSemaphoreGive(s_ask_done); }
    unlock();
}

static void handle(const req_t *r)
{
    switch (r->kind) {
    case REQ_POKE: break;
    case REQ_SCAN: do_scan(); break;
    case REQ_CONNECT:
        sock_drop(LINK_CONNECTING);
        s_backoff_ms = BR_BACKOFF_MIN_MS; s_next_try_us = 0;
        break;
    case REQ_DROP: sock_drop(r->arg); break;
    case REQ_PAIR_CONFIRM: {
        bool live; lock(); live = s.pairing; unlock();
        if (live && s_sock >= 0) {
            cJSON *b = cJSON_CreateObject(); cJSON_AddBoolToObject(b, "confirm", true);
            say("pair", b);
            ESP_LOGI(TAG, "pairing confirmed here; waiting for the vent's");
        }
        break;
    }
    case REQ_PAIR_CANCEL:
        ESP_LOGI(TAG, "pairing cancelled; another code in %d s", BR_UNPAIRED_WAIT_MS / 1000);
        sock_drop(LINK_UNPAIRED); wait_unpaired();
        break;
    case REQ_ASK_LIGHT:
    case REQ_ASK_FX: {
        bool up; lock(); up = s.link == LINK_CONNECTED; unlock();
        if (!up || s_sock < 0) { refuse_ask(); break; }
        cJSON *b = cJSON_CreateObject(); cJSON_AddBoolToObject(b, "request", true);
        if (r->kind == REQ_ASK_FX) cJSON_AddNumberToObject(b, "state", r->arg);
        bool sent = say(r->kind == REQ_ASK_FX ? "fx" : "light", b);
        lock(); s.ask_seq = s_seq; unlock();
        if (!sent) refuse_ask();
        break;
    }
    default: break;
    }
}

/* Wait up to ms for a request, then take every one that is queued. */
static void take_requests(uint32_t ms)
{
    req_t r;
    if (xQueueReceive(s_q, &r, pdMS_TO_TICKS(ms)) == pdTRUE) {
        handle(&r);
        while (xQueueReceive(s_q, &r, 0) == pdTRUE) handle(&r);
    }
}

/* ---- being found ------------------------------------------------------------------------- */

/* The service record, kept in step with the bit and with the hostname. mdns_init() belongs to
 * ps_wifi.c and may run after this task starts, so a refusal is retried on the next tick and
 * logged only when it stops being one. */
static void advertise(bool on)
{
    if (!on) {
        if (s_advertised) { mdns_service_remove(BR_SERVICE, BR_PROTO); s_advertised = false; ESP_LOGI(TAG, "no longer advertised"); }
        return;
    }
    char name[33]; hostname_copy(name, sizeof name);
    if (!s_advertised) {
        mdns_txt_item_t txt[] = { { "id", s.self_id }, { "kind", "status" }, { "ver", "1" }, { "name", name } };
        if (mdns_service_add(NULL, BR_SERVICE, BR_PROTO, BR_PORT, txt, 4) == ESP_OK) {
            s_advertised = true;
            snprintf(s_adv_name, sizeof s_adv_name, "%s", name);
            ESP_LOGI(TAG, "advertised as %s.%s, id %s", BR_SERVICE, BR_PROTO, s.self_id);
        }
    } else if (strcmp(s_adv_name, name) != 0) {
        if (mdns_service_txt_item_set(BR_SERVICE, BR_PROTO, "name", name) == ESP_OK) snprintf(s_adv_name, sizeof s_adv_name, "%s", name);
    }
}

/* ---- the task ------------------------------------------------------------------------------ */

static void bridge_task(void *arg)
{
    (void)arg;
    for (;;) {
        bool on = bit_on();
        advertise(on);
        bool bound; lock(); bound = s.cfg.bound != 0; unlock();
        if (!on || !bound) {
            if (s_sock >= 0) sock_drop(bound ? LINK_CONNECTING : LINK_UNBOUND);
            take_requests(1000);
            continue;
        }
        if (s_sock < 0) {
            int64_t now = now_us();
            if (now < s_next_try_us) {
                int64_t left_ms = (s_next_try_us - now) / 1000;
                take_requests(left_ms > 1000 ? 1000 : (uint32_t)(left_ms > 0 ? left_ms : 1));
                continue;
            }
            connect_once();
            continue;
        }
        pump();
        take_requests(0);
    }
}

void ps_bridge_start(void)
{
    s_mx = xSemaphoreCreateMutex();
    s_ask_done = xSemaphoreCreateBinary();
    s_q = xQueueCreate(BR_QUEUE, sizeof(req_t));
    uint8_t mac[6] = { 0 };
    esp_read_mac(mac, ESP_MAC_WIFI_STA);
    ps_bridge_identity(mac, s.self_id);
    ps_bridge_cfg_load(&s.cfg);
    s.link = s.cfg.bound ? LINK_CONNECTING : LINK_UNBOUND;
    if (!s_mx || !s_ask_done || !s_q || xTaskCreate(bridge_task, "ps_bridge", 8192, NULL, 4, NULL) != pdPASS) {
        ESP_LOGE(TAG, "the bridge task would not start");
        return;
    }
    ESP_LOGI(TAG, "identity %s, %s", s.self_id, s.cfg.bound ? "a vent is bound" : "no vent bound");
}

void ps_bridge_notify(void) { post(REQ_POKE, 0); }

/* ---- the routes ---------------------------------------------------------------------------- */

static cJSON *vent_json(const ps_vent_report_t *v)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "state", ps_vent_state_name(v->state));
    if (v->have_chamber) cJSON_AddNumberToObject(o, "chamber_c", (double)v->chamber_c);
    if (v->have_policy) {
        cJSON *p = cJSON_AddObjectToObject(o, "policy");
        cJSON_AddBoolToObject(p, "override", v->override);
        if (v->reason[0]) cJSON_AddStringToObject(p, "reason", v->reason); else cJSON_AddNullToObject(p, "reason");
    }
    if (v->error[0]) cJSON_AddStringToObject(o, "error", v->error); else cJSON_AddNullToObject(o, "error");
    return o;
}

/* The page's whole view, the shape tools/ui/mock/mockdev.js bridgeDoc() gives. */
static char *doc_json(void)
{
    char name[33]; hostname_copy(name, sizeof name);
    cJSON *d = cJSON_CreateObject();
    if (!d) return NULL;
    lock();
    cJSON *self = cJSON_AddObjectToObject(d, "self");
    cJSON_AddStringToObject(self, "id", s.self_id);
    cJSON_AddStringToObject(self, "kind", "status");
    cJSON_AddStringToObject(self, "name", name);
    cJSON_AddNumberToObject(d, "link", s.link);
    if (s.cfg.bound) {
        cJSON *b = cJSON_AddObjectToObject(d, "bound");
        cJSON_AddStringToObject(b, "id", s.cfg.id);
        cJSON_AddStringToObject(b, "name", s.cfg.name);
        char ip[16];
        if (!ip_zero(s.cfg.ip)) snprintf(ip, sizeof ip, "%u.%u.%u.%u", s.cfg.ip[0], s.cfg.ip[1], s.cfg.ip[2], s.cfg.ip[3]);
        cJSON_AddStringToObject(b, "ip", ip_zero(s.cfg.ip) ? s.cfg.host : ip);
    } else cJSON_AddNullToObject(d, "bound");
    if (s.pairing) {
        cJSON *p = cJSON_AddObjectToObject(d, "pair");
        cJSON_AddStringToObject(p, "code", s.code);
        int64_t left = (s.pair_until_us - now_us() + 500000) / 1000000;
        cJSON_AddNumberToObject(p, "left", left > 0 ? (double)left : 0);
    } else cJSON_AddNullToObject(d, "pair");
    if (s.have_vent) cJSON_AddItemToObject(d, "vent", vent_json(&s.vent)); else cJSON_AddNullToObject(d, "vent");
    cJSON *found = cJSON_AddArrayToObject(d, "found");
    for (int i = 0; i < s.nfound; i++) {
        cJSON *f = cJSON_CreateObject();
        cJSON_AddStringToObject(f, "id", s.found[i].id);
        cJSON_AddStringToObject(f, "name", s.found[i].name);
        cJSON_AddStringToObject(f, "ip", s.found[i].ip);
        cJSON_AddStringToObject(f, "kind", "vent");
        cJSON_AddItemToArray(found, f);
    }
    cJSON_AddBoolToObject(d, "scanning", s.scanning);
    unlock();
    char *txt = cJSON_PrintUnformatted(d);
    cJSON_Delete(d);
    return txt;
}

static esp_err_t reply_json(httpd_req_t *req, char *s_txt)
{
    if (!s_txt) { httpd_resp_set_status(req, "500 Internal Server Error"); return httpd_resp_send(req, "no memory", HTTPD_RESP_USE_STRLEN); }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    esp_err_t e = httpd_resp_send(req, s_txt, HTTPD_RESP_USE_STRLEN);
    cJSON_free(s_txt);
    return e;
}
static esp_err_t refuse(httpd_req_t *req, const char *why)
{
    ESP_LOGI(TAG, "refused: %s", why);
    httpd_resp_set_status(req, "400 Bad Request");
    return httpd_resp_send(req, "refused", HTTPD_RESP_USE_STRLEN);
}

int ps_api_bridge_get(httpd_req_t *req)
{
    if (!bit_on()) return ps_http_redirect_portal(req);
    return reply_json(req, doc_json());
}

/* GET /bridge/id: the TXT record's fields over HTTP, for a peer binding this device by hand. */
int ps_bridge_id_get(httpd_req_t *req)
{
    if (!bit_on()) return ps_http_redirect_portal(req);
    char name[33]; hostname_copy(name, sizeof name);
    cJSON *d = cJSON_CreateObject();
    if (!d) return reply_json(req, NULL);
    cJSON_AddStringToObject(d, "id", s.self_id);
    cJSON_AddStringToObject(d, "kind", "status");
    cJSON_AddNumberToObject(d, "ver", 1);
    cJSON_AddStringToObject(d, "name", name);
    char *txt = cJSON_PrintUnformatted(d);
    cJSON_Delete(d);
    return reply_json(req, txt);
}

/* Ask the vent for something and wait for its answer, on the caller's task. The answer is the
 * body as JSON text (the caller frees it), NULL with *refused for a no, NULL without it for
 * silence; NULL with *busy when another copy is in flight. */
static char *ask(uint8_t kind, uint8_t arg, bool *refused, bool *busy)
{
    *refused = false; *busy = false;
    lock();
    if (s.ask_busy) { unlock(); *busy = true; return NULL; }
    s.ask_busy = true; s.ask_kind = kind; s.ask_refused = false;
    cJSON_free(s.ask_answer); s.ask_answer = NULL;
    unlock();
    xSemaphoreTake(s_ask_done, 0);                                     /* a give nobody collected */
    post(kind, arg);
    xSemaphoreTake(s_ask_done, pdMS_TO_TICKS(BR_ASK_MS));
    lock();
    char *ans = s.ask_answer; s.ask_answer = NULL;
    *refused = s.ask_refused;
    s.ask_busy = false;
    unlock();
    return ans;
}

/* The vent's three bar-state colours into this device's three, for the mode being edited. */
static esp_err_t copy_colours(httpd_req_t *req)
{
    bool refused, busy;
    char *ans = ask(REQ_ASK_LIGHT, 0, &refused, &busy);
    if (busy) return refuse(req, "another copy is in flight");
    if (!ans) return refuse(req, refused ? "the vent would not say what its colours are" : "the vent has not said what its colours are");
    cJSON *o = cJSON_Parse(ans); cJSON_free(ans);
    cJSON *cols = o ? cJSON_GetObjectItemCaseSensitive(o, "colours") : NULL;
    ps_rgba_t c[3];
    bool ok = cJSON_IsArray(cols) && cJSON_GetArraySize(cols) >= 3;
    for (int i = 0; ok && i < 3; i++) {
        const cJSON *v = cJSON_GetArrayItem(cols, i);
        ok = cJSON_IsString(v) && v->valuestring && ps_rgba_from_wire(v->valuestring, &c[i]);
    }
    cJSON_Delete(o);
    if (!ok) return refuse(req, "the vent's colours did not read");
    ps_lock();
    uint8_t m = g_ps.cfg.current_mode < 2 ? g_ps.cfg.current_mode : 0;
    for (int i = 0; i < 3; i++) g_ps.cfg.mode[m].colour[i] = c[i];
    ps_cfg_save(&g_ps.cfg);
    ps_unlock();
    ps_effect_notify();
    ps_ws_push(PS_ROOT_SETTINGS, -1);
    ESP_LOGI(TAG, "copied the vent's colours into mode %u", m);
    return reply_json(req, doc_json());
}

/* One vent bar state's effect into the matching state here, whole or refused whole. An id the
 * switches here do not allow is refused with the reason, never downgraded (the contract's rule). */
static esp_err_t copy_effect(httpd_req_t *req, int st)
{
    bool refused, busy;
    char *ans = ask(REQ_ASK_FX, (uint8_t)st, &refused, &busy);
    if (busy) return refuse(req, "another copy is in flight");
    if (!ans) return refuse(req, refused ? "the vent would not say what its effect is" : "the vent has not said what its effect is");
    cJSON *o = cJSON_Parse(ans); cJSON_free(ans);
    if (!o) return refuse(req, "the vent's effect did not read");
    ps_fx_cfg_t fx; uint32_t feat;
    ps_lock(); fx = g_ps.cfg.fx[st]; feat = g_ps.cfg.features; ps_unlock();
    const char *why = NULL;
    const cJSON *v;
    if (!(feat & PS_FEAT_STATE_EFFECTS)) why = "per-state effects are switched off here";
    if (!why) {
        v = cJSON_GetObjectItemCaseSensitive(o, "effect");
        if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble >= PS_FX_COUNT) why = "not an effect this device knows";
        else if (!ps_fx_allowed(feat, (int)v->valuedouble)) why = "that effect needs a switch that is off here";
        else fx.effect = (uint8_t)v->valuedouble;
    }
    if (!why && (v = cJSON_GetObjectItemCaseSensitive(o, "brightness"))) { if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > 100) why = "brightness"; else fx.brightness = (uint8_t)v->valuedouble; }
    if (!why && (v = cJSON_GetObjectItemCaseSensitive(o, "speed")))      { if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > 100) why = "speed"; else fx.speed = (uint8_t)v->valuedouble; }
    if (!why && (v = cJSON_GetObjectItemCaseSensitive(o, "opt")))        { if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > PS_FX_OPT_ALL) why = "an option this build does not know"; else fx.opt = (uint8_t)v->valuedouble; }
    if (!why && (v = cJSON_GetObjectItemCaseSensitive(o, "aux")))        { if (!cJSON_IsNumber(v) || v->valuedouble < 0 || v->valuedouble > 255) why = "aux"; else fx.aux = (uint8_t)v->valuedouble; }
    if (!why && (v = cJSON_GetObjectItemCaseSensitive(o, "colours"))) {
        if (!cJSON_IsArray(v) || cJSON_GetArraySize(v) != 4) why = "colours";
        for (int i = 0; !why && i < 4; i++) {
            const cJSON *c = cJSON_GetArrayItem(v, i);
            if (!cJSON_IsString(c) || !c->valuestring || !ps_rgba_from_wire(c->valuestring, &fx.colour[i])) why = "colours";
        }
    }
    cJSON_Delete(o);
    if (why) return refuse(req, why);
    ps_lock();
    g_ps.cfg.fx[st] = fx;
    ps_cfg_save(&g_ps.cfg);
    ps_unlock();
    ps_effect_notify();
    ESP_LOGI(TAG, "copied the vent's effect %u into state %d", fx.effect, st);
    return reply_json(req, doc_json());
}

/* A typed name or address: one DNS label chain or dotted quad, nothing else. */
static bool host_ok(const char *h)
{
    size_t n = strlen(h);
    if (n < 1 || n > 63) return false;
    for (size_t i = 0; i < n; i++) {
        char c = h[i];
        if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '-')) return false;
    }
    return true;
}

/* POST /api/bridge: one key per request, taken whole or refused whole (400), and the answer is
 * the same document a GET gives. The keys are the mock's: scan, bind, pair, unbind, copy. */
int ps_api_bridge_post(httpd_req_t *req)
{
    if (!bit_on()) return ps_http_redirect_portal(req);
    if (req->content_len == 0 || req->content_len > 4096) return refuse(req, "body");
    char *buf = malloc(req->content_len + 1);
    if (!buf) return reply_json(req, NULL);
    if (ps_http_recv_all(req, buf, req->content_len) != 0) { free(buf); return ESP_FAIL; }
    buf[req->content_len] = 0;
    cJSON *j = cJSON_Parse(buf);
    free(buf);
    if (!j || !cJSON_IsObject(j)) { cJSON_Delete(j); return refuse(req, "not json"); }
    esp_err_t e;
    const cJSON *v;

    if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(j, "scan"))) {
        lock(); s.scanning = true; unlock();
        post(REQ_SCAN, 0);
        e = reply_json(req, doc_json());
    }
    else if ((v = cJSON_GetObjectItemCaseSensitive(j, "bind")) && cJSON_IsObject(v)) {
        const char *ip = str_of(v, "ip"), *id = str_of(v, "id");
        char host[64] = ""; char want_id[17] = "";
        if (ip) { while (*ip == ' ') ip++; snprintf(host, sizeof host, "%s", ip); size_t n = strlen(host); while (n && host[n - 1] == ' ') host[--n] = 0; }
        if (id && strlen(id) == 16) snprintf(want_id, sizeof want_id, "%s", id);
        lock();
        const found_t *pick = NULL;
        if (want_id[0]) for (int i = 0; i < s.nfound; i++) if (!strcmp(s.found[i].id, want_id)) pick = &s.found[i];
        if (!host[0] && pick) snprintf(host, sizeof host, "%s", pick->ip);
        if (!host[0]) { unlock(); cJSON_Delete(j); return refuse(req, "no address"); }
        if (!host_ok(host)) { unlock(); cJSON_Delete(j); return refuse(req, "not a name or an address"); }
        memset(&s.cfg, 0, sizeof s.cfg);
        s.cfg.magic = PS_BRIDGE_MAGIC; s.cfg.bound = 1;
        snprintf(s.cfg.host, sizeof s.cfg.host, "%s", host);
        if (pick) { snprintf(s.cfg.id, sizeof s.cfg.id, "%s", pick->id); snprintf(s.cfg.name, sizeof s.cfg.name, "%s", pick->name); }
        else if (want_id[0]) snprintf(s.cfg.id, sizeof s.cfg.id, "%s", want_id);
        ip4_addr_t lit; if (ip4addr_aton(host, &lit)) memcpy(s.cfg.ip, &lit.addr, 4);
        ps_bridge_cfg_clamp(&s.cfg);
        ps_bridge_cfg_t copy = s.cfg;
        s.have_vent = false; s.pairing = false; s.link = LINK_CONNECTING;
        unlock();
        ps_bridge_cfg_save(&copy);
        post(REQ_CONNECT, 0);
        ESP_LOGI(TAG, "bound to a vent%s", copy.id[0] ? " by identity" : " by address");
        e = reply_json(req, doc_json());
    }
    else if ((v = cJSON_GetObjectItemCaseSensitive(j, "pair")) && cJSON_IsObject(v)) {
        if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(v, "cancel"))) {
            post(REQ_PAIR_CANCEL, 0);
            e = reply_json(req, doc_json());
        } else if (!cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(v, "confirm"))) {
            e = refuse(req, "pair needs confirm or cancel");
        } else {
            lock();
            bool live = s.pairing, lapsed = live && now_us() > s.pair_until_us;
            if (lapsed) s.pairing = false;
            unlock();
            if (!live) e = refuse(req, "nothing to confirm");
            else if (lapsed) e = refuse(req, "the code has expired");
            else { post(REQ_PAIR_CONFIRM, 0); e = reply_json(req, doc_json()); }
        }
    }
    else if (cJSON_IsTrue(cJSON_GetObjectItemCaseSensitive(j, "unbind"))) {
        lock();
        memset(&s.cfg, 0, sizeof s.cfg); s.cfg.magic = PS_BRIDGE_MAGIC;
        ps_bridge_cfg_t copy = s.cfg;
        s.have_vent = false; s.pairing = false; s.link = LINK_UNBOUND;
        unlock();
        ps_bridge_cfg_save(&copy);
        post(REQ_DROP, LINK_UNBOUND);
        ESP_LOGI(TAG, "unbound");
        e = reply_json(req, doc_json());
    }
    else if ((v = cJSON_GetObjectItemCaseSensitive(j, "copy")) && cJSON_IsObject(v)) {
        bool from; lock(); from = s.link == LINK_CONNECTED && s.have_vent; unlock();
        const char *what = str_of(v, "what");
        if (!from) e = refuse(req, "no vent to copy from");
        else if (what && !strcmp(what, "colours")) e = copy_colours(req);
        else if (what && !strcmp(what, "effect")) {
            const cJSON *st = cJSON_GetObjectItemCaseSensitive(v, "state");
            if (!cJSON_IsNumber(st) || st->valuedouble < 0 || st->valuedouble > 2) e = refuse(req, "which state");
            else e = copy_effect(req, (int)st->valuedouble);
        }
        else e = refuse(req, "copy what");
    }
    else e = refuse(req, "nothing asked for");
    cJSON_Delete(j);
    return e;
}
