/* The two names a device answers to, both pure so both can be host-tested.
 *
 * A device with no stored hotspot name builds one from its own MAC, so two units on a bench
 * are never the same network, and so the name on the label matches the name in the list
 * without anyone typing it. The pattern is this project's own and matches its sibling's:
 * a prefix, an underscore, then the six MAC bytes as uppercase hex with no separators.
 *
 * A hostname is ONE DNS label. The ".local" a multicast responder answers on is the domain
 * it appends, not part of the name, so a name typed as "status2.local" has to come back out
 * as "status2" or the device becomes reachable at status2.local.local and at nothing a
 * person would try. The sanitiser is applied on the way in and again on the way out, so a
 * name stored before it existed is corrected on the next boot rather than staying broken. */
#include <string.h>
#include <stdio.h>
#include "ps.h"

void ps_ap_ssid_from_mac(char *out, size_t n, const uint8_t mac[6])
{
    if (!out || n == 0) return;
    snprintf(out, n, "%s%02X%02X%02X%02X%02X%02X",
             PS_AP_SSID_PREFIX, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

void ps_hostname_sanitise(char *s, size_t n)
{
    if (!s || n == 0) return;
    size_t len = strnlen(s, n);

    /* trailing dots and blanks first, so ".local ." and "name." both reduce */
    while (len && (s[len - 1] == '.' || s[len - 1] == ' ' || s[len - 1] == '\t')) len--;

    /* then every trailing ".local", however many were typed, each possibly followed by
       more dots and blanks: "name.local.local." is one name with two domains on it */
    for (;;) {
        const size_t dl = 6;                                   /* strlen(".local") */
        if (len < dl) break;
        size_t i = len - dl;
        if (!(s[i] == '.'
              && (s[i + 1] == 'l' || s[i + 1] == 'L') && (s[i + 2] == 'o' || s[i + 2] == 'O')
              && (s[i + 3] == 'c' || s[i + 3] == 'C') && (s[i + 4] == 'a' || s[i + 4] == 'A')
              && (s[i + 5] == 'l' || s[i + 5] == 'L'))) break;
        len = i;
        while (len && (s[len - 1] == '.' || s[len - 1] == ' ' || s[len - 1] == '\t')) len--;
    }

    /* a label is letters, digits and hyphens; everything else becomes a hyphen rather than
       being dropped, so two different names cannot collapse into one. A run of them collapses
       to a single hyphen, so "a. b" is "a-b" and not "a--b". */
    size_t w = 0;
    for (size_t i = 0; i < len; i++) {
        char c = s[i];
        bool ok = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-';
        char o = ok ? c : '-';
        if (o == '-' && w && s[w - 1] == '-') continue;
        s[w++] = o;
    }
    len = w;

    /* a label may not begin or end with a hyphen */
    size_t start = 0;
    while (start < len && s[start] == '-') start++;
    while (len > start && s[len - 1] == '-') len--;
    if (start) memmove(s, s + start, len - start);
    len -= start;

    /* the cut comes last, and the trailing-hyphen rule has to survive it: a name cut at 63
       must not end on one, or the label it produces is not legal after all */
    if (len > PS_HOSTNAME_LABEL_MAX) len = PS_HOSTNAME_LABEL_MAX;   /* a label's own limit */
    while (len && s[len - 1] == '-') len--;
    s[len] = 0;
}
