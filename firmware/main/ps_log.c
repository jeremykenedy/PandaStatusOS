/* The device's own log, kept so the page can show it.
 *
 * ESP-IDF writes its logs to the UART, which is a cable away from a device that is on a
 * shelf. This keeps the last lines in RAM as well, so the Logs page can show them and a
 * problem that only happens once can still be looked at afterwards.
 *
 * A ring of fixed slots, not a heap of strings: a log buffer that allocates is a log
 * buffer that fails exactly when the device is already in trouble.
 *
 * REDACTION IS NOT OPTIONAL. Anyone on the network can read this page. The components
 * below this project log things we do not control, and the Wi-Fi stack has been known to
 * print an SSID. So a line is scrubbed on the way IN, not on the way out: whatever reaches
 * the ring is already safe, and there is no second path that could serve the unscrubbed
 * version. Scrubbing on the way out would leave the original sitting in RAM for any future
 * route to find.
 */
#include <stdio.h>
#include <string.h>
#include <stdarg.h>
#include <ctype.h>
#include "esp_log.h"
#include "esp_attr.h"
#include "esp_system.h"
#include "esp_app_desc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "ps.h"

#define LOG_LINES  64
#define LOG_WIDTH  160

/* The ring outlives a restart that is not a power cut: __NOINIT_ATTR memory is never zeroed
 * at boot, so when the device restarts itself (the guard in ps_main.c, a panic, a watchdog)
 * the lines from before it are still here to read afterwards. That is the whole point of the
 * guard: a server that stopped cannot serve its own log, and a restart would otherwise take
 * the evidence with it. A power cut, a first boot or a different build finds a mark that does
 * not match, and starts clean. */
#define LOG_MARK 0x50534C47u                   /* "PSLG", xor the build's first word */
static __NOINIT_ATTR char     s_ring[LOG_LINES][LOG_WIDTH];
static __NOINIT_ATTR uint16_t s_head;         /* next slot to write */
static __NOINIT_ATTR uint16_t s_count;        /* how many slots hold a line */
static __NOINIT_ATTR uint32_t s_mark;
static vprintf_like_t s_chain;                /* the writer we replaced, still fed */
/* A line that arrives in pieces waits here for its newline. */
static char   s_pend[LOG_WIDTH];
static size_t s_pend_n;
/* Every task logs, and esp_log lets go of its own lock before it calls the writer, so two
 * tasks can be in log_vprintf at once. Unguarded, two partial lines racing on s_pend_n could
 * push it past the buffer, and the next memcpy would write past the end of s_pend into
 * whatever the linker put after it. This lock guards the ring and the pending line. Nothing
 * inside it logs or blocks, and a writer that cannot have it quickly leaves the ring alone:
 * the UART still gets the line, and a log must never be what stops a task. */
static SemaphoreHandle_t s_ring_lock;
static bool ring_take(TickType_t wait)
{
    if (!s_ring_lock || xPortInIsrContext() || xTaskGetSchedulerState() != taskSCHEDULER_RUNNING) return false;
    return xSemaphoreTake(s_ring_lock, wait) == pdTRUE;
}

/* The words that mean a value must not survive. A match blanks the REST of the line: the
 * value's own length is a fact about the secret, so even that is not kept. */
static const char *const SECRET_WORDS[] = {
    "password", "passwd", "psk", "access_code", "accesscode", "token", "secret", "ssid",
};

static void scrub(char *s)
{
    for (size_t i = 0; i < sizeof SECRET_WORDS / sizeof SECRET_WORDS[0]; i++) {
        const char *w = SECRET_WORDS[i];
        size_t wl = strlen(w);
        for (char *p = s; *p; p++) {
            size_t j = 0;
            while (j < wl && p[j] && (char)tolower((unsigned char)p[j]) == w[j]) j++;
            if (j != wl) continue;
            /* keep the word, drop everything after it */
            char *cut = p + wl;
            snprintf(cut, LOG_WIDTH - (size_t)(cut - s), " <redacted>");
            return;
        }
    }
}

static void put_line(const char *line, size_t n)
{
    if (n == 0) return;
    if (n >= LOG_WIDTH) n = LOG_WIDTH - 1;
    char *slot = s_ring[s_head];
    memcpy(slot, line, n);
    slot[n] = 0;
    while (n && (slot[n - 1] == '\n' || slot[n - 1] == '\r')) slot[--n] = 0;
    if (n == 0) return;
    scrub(slot);
    s_head = (uint16_t)((s_head + 1) % LOG_LINES);
    if (s_count < LOG_LINES) s_count++;
}

static int log_vprintf(const char *fmt, va_list ap)
{
    /* The chain is fed the ORIGINAL, because the UART is a cable and whoever is holding it
     * is already inside the box. The ring gets the scrubbed copy. */
    va_list copy;
    va_copy(copy, ap);
    char buf[LOG_WIDTH];
    int n = vsnprintf(buf, sizeof buf, fmt, copy);
    va_end(copy);
    if (n > 0 && ring_take(pdMS_TO_TICKS(10))) {
        /* One call can carry several lines, and one LINE can arrive in several calls: the
         * Wi-Fi driver writes its tag and its message separately, which had every one of its
         * lines broken in two in the ring. A chunk with no newline in it is held until the
         * newline comes, so what lands in the ring is whole lines. */
        char *start = buf;
        for (char *p = buf; *p; p++) {
            if (*p != '\n') continue;
            if (s_pend_n) {
                size_t take = (size_t)(p - start);
                if (take > sizeof s_pend - 1 - s_pend_n) take = sizeof s_pend - 1 - s_pend_n;
                memcpy(s_pend + s_pend_n, start, take);
                s_pend_n += take;
                put_line(s_pend, s_pend_n);
                s_pend_n = 0;
            } else {
                put_line(start, (size_t)(p - start));
            }
            start = p + 1;
        }
        if (*start) {
            size_t take = strlen(start);
            if (take > sizeof s_pend - 1 - s_pend_n) take = sizeof s_pend - 1 - s_pend_n;
            memcpy(s_pend + s_pend_n, start, take);
            s_pend_n += take;
            /* A partial line that grows past the buffer is committed rather than dropped. */
            if (s_pend_n >= sizeof s_pend - 1) { put_line(s_pend, s_pend_n); s_pend_n = 0; }
        }
        xSemaphoreGive(s_ring_lock);
    }
    return s_chain ? s_chain(fmt, ap) : vprintf(fmt, ap);
}

void ps_log_init(void)
{
    if (s_chain) return;
    if (!s_ring_lock) s_ring_lock = xSemaphoreCreateMutex();
    uint32_t build; memcpy(&build, esp_app_get_description()->app_elf_sha256, sizeof build);
    uint32_t want = LOG_MARK ^ build;
    esp_reset_reason_t why = esp_reset_reason();
    bool warm = why == ESP_RST_SW || why == ESP_RST_PANIC || why == ESP_RST_INT_WDT || why == ESP_RST_TASK_WDT
             || why == ESP_RST_WDT || why == ESP_RST_CPU_LOCKUP;
    if (warm && s_mark == want && s_head < LOG_LINES && s_count <= LOG_LINES) {
        for (int i = 0; i < LOG_LINES; i++) s_ring[i][LOG_WIDTH - 1] = 0;   /* whatever else, every slot ends */
        char m[96];
        int n = snprintf(m, sizeof m, "---- restarted, reset reason %d; the lines above are from before it ----", (int)why);
        if (n > 0) put_line(m, (size_t)n);
    } else {
        memset(s_ring, 0, sizeof s_ring); s_head = 0; s_count = 0; s_mark = want;
    }
    s_chain = esp_log_set_vprintf(log_vprintf);
}

void ps_log_clear(void)
{
    if (!ring_take(portMAX_DELAY)) return;
    s_head = 0;
    s_count = 0;
    s_pend_n = 0;
    xSemaphoreGive(s_ring_lock);
}

/* Oldest first, newline separated, into the caller's buffer. Returns the bytes written. */
size_t ps_log_dump(char *out, size_t n)
{
    if (!out || n == 0) return 0;
    size_t used = 0;
    if (!ring_take(portMAX_DELAY)) { out[0] = 0; return 0; }
    uint16_t first = (uint16_t)((s_head + LOG_LINES - s_count) % LOG_LINES);
    for (uint16_t i = 0; i < s_count; i++) {
        const char *line = s_ring[(first + i) % LOG_LINES];
        size_t l = strlen(line);
        if (used + l + 2 > n) break;
        memcpy(out + used, line, l);
        used += l;
        out[used++] = '\n';
    }
    xSemaphoreGive(s_ring_lock);
    out[used] = 0;
    return used;
}
