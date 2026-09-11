/* C8: why it is not working, blinked on the bar.
 *
 * A device that cannot reach the Wi-Fi or the printer shows the idle colour, which is the
 * same thing it shows when everything is fine and nothing is printing. The page says what
 * is wrong, but only if the page can be reached, and the first thing that breaks is often
 * the thing that makes the page hard to reach. So: a colour for the subsystem and a count
 * of blinks for the reason, repeated with a pause between groups, readable from across the
 * room and written down in docs/TROUBLESHOOTING.md.
 *
 * The network outranks the printer, because a printer cannot be reached without it.
 * "Everything is fine" is not a pattern: the bar goes back to doing its job.
 *
 * Pure: no framework, no globals, no allocation, and the host test compiles this file as
 * it ships (firmware/test/host/diag_test.c).
 */
#include <string.h>
#include <stdbool.h>
#include "ps.h"

static const ps_rgba_t NETWORK = { 0xFF, 0xA0, 0x00, 0xFF };   /* amber: the network */
static const ps_rgba_t PRINTER = { 0x00, 0x80, 0xFF, 0xFF };   /* blue: the printer */

bool ps_diag_pick(uint8_t sta_state, uint8_t printer_state, ps_diag_t *out)
{
    ps_diag_t d = { false, NETWORK, 0 };
    switch (sta_state) {
    case PS_STA_NOSSID:       d.blinks = 1; break;             /* no network configured */
    case PS_STA_CONNECTING:   d.blinks = 2; break;
    case PS_STA_RECONNECTING: d.blinks = 3; break;
    case PS_STA_PASSWORD:     d.blinks = 4; break;             /* the password was refused */
    default: break;                                            /* connected, or a state this build does not know */
    }
    if (d.blinks) { d.active = true; if (out) *out = d; return true; }

    d.colour = PRINTER;
    switch (printer_state) {
    case PS_PRN_INVALID:      d.blinks = 1; break;             /* nothing bound */
    case PS_PRN_CONNECTING:   d.blinks = 2; break;
    case PS_PRN_IP_ERR:       d.blinks = 3; break;             /* nothing answers at that address */
    case PS_PRN_ACCESS_CODE:  d.blinks = 4; break;             /* the access code was refused */
    case PS_PRN_SN_ERR:       d.blinks = 5; break;
    case PS_PRN_UNKNOWN_ERR:  d.blinks = 6; break;
    default: break;                                            /* connected, or unknown to this build */
    }
    if (d.blinks) { d.active = true; if (out) *out = d; return true; }

    if (out) { out->active = false; out->blinks = 0; out->colour = NETWORK; }
    return false;
}

uint32_t ps_diag_render(const ps_diag_t *d, uint32_t now_ms, ps_rgba_t *px, int n)
{
    const ps_rgba_t black = { 0, 0, 0, 0xFF };
    if (n < 1) return PS_DIAG_ON_MS;
    if (!d || !d->active || !d->blinks) {
        for (int i = 0; i < n; i++) px[i] = black;
        return PS_DIAG_PAUSE_MS;
    }
    uint32_t group = (uint32_t)d->blinks * (PS_DIAG_ON_MS + PS_DIAG_OFF_MS);
    uint32_t cycle = group + PS_DIAG_PAUSE_MS;
    uint32_t at = now_ms % cycle;
    bool on = at < group && (at % (PS_DIAG_ON_MS + PS_DIAG_OFF_MS)) < PS_DIAG_ON_MS;
    ps_rgba_t lit = { (uint8_t)((uint32_t)d->colour.r * PS_DIAG_BRIGHT / 100u),
                      (uint8_t)((uint32_t)d->colour.g * PS_DIAG_BRIGHT / 100u),
                      (uint8_t)((uint32_t)d->colour.b * PS_DIAG_BRIGHT / 100u), 0xFF };
    for (int i = 0; i < n; i++) px[i] = on ? lit : black;
    /* wake when this frame stops being true, never later */
    if (at >= group) return cycle - at;
    uint32_t into = at % (PS_DIAG_ON_MS + PS_DIAG_OFF_MS);
    return on ? PS_DIAG_ON_MS - into : (PS_DIAG_ON_MS + PS_DIAG_OFF_MS) - into;
}
