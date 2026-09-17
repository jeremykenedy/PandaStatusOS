/* C7: what a rebind scan concluded, as a pure function.
 *
 * A bound printer that moves (DHCP hands it a new address) answers nothing at the address
 * the device has. The serial number does not move, so a scan that reports what it found is
 * enough to decide: no hit carries this serial (the printer is gone, or the scan found
 * nothing), a hit carries it at the address already bound (the failure is something else),
 * or a hit carries it somewhere new (bind there).
 *
 * The three answers are the wire's own printer.scan states 4, 5 and 6, which the factory
 * firmware already enumerates; this file decides between them and nothing else. Where the
 * hits come from is the open question (docs/ROADMAP.md): the device's own discovery finds
 * nothing until the mechanism is documented, so on real hardware today this returns
 * "no match" every time, correctly. The mock's scan does return hits, so the decision and
 * everything it drives are proven end to end.
 *
 * No IDF, no globals, no allocation: the host test compiles this file as it ships.
 */
#include <string.h>
#include <stdbool.h>
#include "ps.h"

/* dotted quad, strictly: four decimal octets, nothing else on the string */
static bool ip4(const char *s, uint8_t out[4])
{
    if (!s) return false;
    int v = 0, digits = 0, part = 0;
    for (;; s++) {
        if (*s >= '0' && *s <= '9') {
            if (++digits > 3) return false;
            v = v * 10 + (*s - '0');
            if (v > 255) return false;
        } else if (*s == '.' || *s == 0) {
            if (!digits || part > 3) return false;
            out[part++] = (uint8_t)v;
            v = digits = 0;
            if (*s == 0) break;
        } else return false;
    }
    return part == 4;
}

int ps_rebind_decide(const char *bound_sn, const uint8_t bound_ip[4], const ps_printer_hit_t *hits, int n, uint8_t out_ip[4])
{
    if (!bound_sn || !bound_sn[0] || !hits || n <= 0) return PS_REBIND_NO_MATCH;
    for (int i = 0; i < n; i++) {
        if (strncmp(hits[i].sn, bound_sn, sizeof hits[i].sn) != 0) continue;   /* the serial is the identity */
        uint8_t ip[4];
        if (!ip4(hits[i].ip, ip)) return PS_REBIND_NO_MATCH;                   /* a hit we cannot bind to is no hit */
        if (bound_ip && memcmp(ip, bound_ip, 4) == 0) return PS_REBIND_UNCHANGED;
        if (out_ip) memcpy(out_ip, ip, 4);
        return PS_REBIND_MOVED;
    }
    return PS_REBIND_NO_MATCH;
}
