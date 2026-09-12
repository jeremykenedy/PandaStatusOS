/* Reading a Bambu printer's own announcement. Pure, so it is host-tested.
 *
 * Established by listening on this network rather than from any document: both printers send
 * an SSDP NOTIFY to the multicast group 239.255.255.250 on UDP port 2021, carrying
 *
 *     NT: urn:bambulab-com:device:3dprinter:1
 *     NTS: ssdp:alive
 *     Location: <the printer's IPv4 address>
 *     USN: <the serial number>
 *     DevName.bambu.com: <the name its owner gave it>
 *     DevModel.bambu.com: <a model code>
 *
 * That is every field the bind form needs except the access code, which is a secret the
 * printer does not broadcast and the owner has to read off its screen.
 *
 * The Location header was a bare address on both units, not a URL, but SSDP's own definition
 * makes it a URL, so both shapes are accepted. Header names are matched without regard to case
 * because SSDP is HTTP-shaped and HTTP header names are case-insensitive; the two printers did
 * not even agree with each other on capitalisation. */
#include <string.h>
#include <stdio.h>
#include "ps.h"

static char lower(char c) { return (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c; }

static bool key_is(const char *line, size_t n, const char *name)
{
    size_t ln = strlen(name);
    if (n < ln) return false;
    for (size_t i = 0; i < ln; i++) if (lower(line[i]) != lower(name[i])) return false;
    /* the name must be the whole key: the next thing is the colon, or blanks then the colon */
    size_t i = ln;
    while (i < n && (line[i] == ' ' || line[i] == '\t')) i++;
    return i < n && line[i] == ':';
}

static size_t value_of(const char *line, size_t n, char *out, size_t outn)
{
    const char *c = memchr(line, ':', n);
    if (!c) { if (outn) out[0] = 0; return 0; }
    size_t i = (size_t)(c - line) + 1;
    while (i < n && (line[i] == ' ' || line[i] == '\t')) i++;
    size_t end = n;
    while (end > i && (line[end - 1] == ' ' || line[end - 1] == '\t' || line[end - 1] == '\r')) end--;
    size_t len = end - i;
    if (len >= outn) len = outn ? outn - 1 : 0;
    if (outn) { memcpy(out, line + i, len); out[len] = 0; }
    return len;
}

static bool contains_ci(const char *hay, const char *needle)
{
    size_t hn = strlen(hay), nn = strlen(needle);
    if (nn == 0 || hn < nn) return false;
    for (size_t i = 0; i + nn <= hn; i++) {
        size_t j = 0;
        while (j < nn && lower(hay[i + j]) == lower(needle[j])) j++;
        if (j == nn) return true;
    }
    return false;
}

/* A dotted quad and nothing else: four decimal groups, each 0..255, no leading nonsense. The
 * address goes straight into the bind form, so a malformed one is rejected rather than tidied. */
static bool ipv4_ok(const char *s)
{
    int groups = 0;
    while (*s) {
        int v = 0, digits = 0;
        while (*s >= '0' && *s <= '9') { v = v * 10 + (*s - '0'); digits++; s++; if (v > 255 || digits > 3) return false; }
        if (digits == 0) return false;
        groups++;
        if (*s == '.') { s++; if (!*s) return false; }
        else if (*s) return false;
    }
    return groups == 4;
}

/* "192.168.1.56" or "http://192.168.1.56:8883/x" both yield the address. */
static bool address_from_location(const char *v, char *out, size_t outn)
{
    const char *p = v;
    const char *sep = strstr(p, "://");
    if (sep) p = sep + 3;
    size_t i = 0;
    while (p[i] && p[i] != ':' && p[i] != '/' && i + 1 < outn) { out[i] = p[i]; i++; }
    out[i] = 0;
    return ipv4_ok(out);
}

int ps_ssdp_parse_printer(const char *buf, size_t len, ps_printer_hit_t *out)
{
    if (!buf || !out || len == 0) return 0;
    memset(out, 0, sizeof *out);

    bool is_printer = false, alive = true, have_ip = false;
    char v[128];

    size_t i = 0;
    while (i < len) {
        size_t e = i;
        while (e < len && buf[e] != '\n') e++;
        size_t n = e - i;
        const char *line = buf + i;
        i = e + 1;
        if (n == 0) continue;

        if (key_is(line, n, "NT")) {
            value_of(line, n, v, sizeof v);
            if (contains_ci(v, "bambulab-com:device:3dprinter")) is_printer = true;
        } else if (key_is(line, n, "NTS")) {
            value_of(line, n, v, sizeof v);
            if (contains_ci(v, "byebye")) alive = false;
        } else if (key_is(line, n, "Location")) {
            value_of(line, n, v, sizeof v);
            char ip[16];
            if (address_from_location(v, ip, sizeof ip)) { snprintf(out->ip, sizeof out->ip, "%s", ip); have_ip = true; }
        } else if (key_is(line, n, "USN")) {
            value_of(line, n, out->sn, sizeof out->sn);
        } else if (key_is(line, n, "DevName.bambu.com")) {
            value_of(line, n, out->name, sizeof out->name);
        }
    }

    /* An announcement without an address is useless, and a goodbye is not a find. A missing
     * name is survivable: the page shows the address and the owner can name it themselves. */
    if (!is_printer || !alive || !have_ip) { memset(out, 0, sizeof *out); return 0; }
    return 1;
}
