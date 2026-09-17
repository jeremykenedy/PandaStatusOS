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
#include "ps.h"

#define LOG_LINES  64
#define LOG_WIDTH  160

static char     s_ring[LOG_LINES][LOG_WIDTH];
static uint16_t s_head;                       /* next slot to write */
static uint16_t s_count;                      /* how many slots hold a line */
static vprintf_like_t s_chain;                /* the writer we replaced, still fed */
/* A line that arrives in pieces waits here for its newline. */
static char   s_pend[LOG_WIDTH];
static size_t s_pend_n;

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
    if (n > 0) {
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
    }
    return s_chain ? s_chain(fmt, ap) : vprintf(fmt, ap);
}

void ps_log_init(void)
{
    if (s_chain) return;
    s_chain = esp_log_set_vprintf(log_vprintf);
}

void ps_log_clear(void)
{
    ps_lock();
    s_head = 0;
    s_count = 0;
    ps_unlock();
}

/* Oldest first, newline separated, into the caller's buffer. Returns the bytes written. */
size_t ps_log_dump(char *out, size_t n)
{
    if (!out || n == 0) return 0;
    size_t used = 0;
    ps_lock();
    uint16_t first = (uint16_t)((s_head + LOG_LINES - s_count) % LOG_LINES);
    for (uint16_t i = 0; i < s_count; i++) {
        const char *line = s_ring[(first + i) % LOG_LINES];
        size_t l = strlen(line);
        if (used + l + 2 > n) break;
        memcpy(out + used, line, l);
        used += l;
        out[used++] = '\n';
    }
    ps_unlock();
    out[used] = 0;
    return used;
}
