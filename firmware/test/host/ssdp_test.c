/* The announcement parser, on the host. The two fixtures below are the real datagrams this
 * network produced, with the serials replaced by tokens of the same length. */
#include <stdio.h>
#include <string.h>
#include "ps.h"

static int pass, fail;
static void t(const char *name, int ok, const char *got)
{
    if (ok) { pass++; printf("  ok    %s\n", name); }
    else { fail++; printf("  FAIL  %s%s%s\n", name, got ? "    got: " : "", got ? got : ""); }
}

/* As observed, right down to the Host header naming a different port than the one it arrived on
   and the capitalisation differing from the other unit's. */
static const char REAL[] =
    "NOTIFY * HTTP/1.1\r\n"
    "Host: 239.255.255.250:1990\r\n"
    "Server: UPnP/1.0\r\n"
    "Location: 192.168.1.58\r\n"
    "NT: urn:bambulab-com:device:3dprinter:1\r\n"
    "NTS: ssdp:alive\r\n"
    "USN: ABCDEFGHIJKLMNO\r\n"
    "Cache-Control: max-age=1800\r\n"
    "DevModel.bambu.com: N7\r\n"
    "DevName.bambu.com: P2S Left\r\n"
    "DevConnect.bambu.com: secure\r\n"
    "DevBind.bambu.com: occupied\r\n"
    "DevInf.bambu.com: wlan0\r\n"
    "DevCap.bambu.com: 1\r\n\r\n";

int main(void)
{
    ps_printer_hit_t h;

    printf("the real announcement\n");
    t("it is recognised", ps_ssdp_parse_printer(REAL, sizeof REAL - 1, &h) == 1, 0);
    t("  the address comes from Location", !strcmp(h.ip, "192.168.1.58"), h.ip);
    t("  the serial comes from USN", !strcmp(h.sn, "ABCDEFGHIJKLMNO"), h.sn);
    t("  the name comes from DevName.bambu.com", !strcmp(h.name, "P2S Left"), h.name);

    printf("\nshapes that must still work\n");
    {
        /* the other unit capitalised its headers differently; HTTP header names are not
           case-sensitive and neither is this */
        const char s[] = "NOTIFY * HTTP/1.1\r\nlocation: 192.168.1.56\r\n"
                         "nt: URN:BambuLab-Com:Device:3DPrinter:1\r\nnts: SSDP:ALIVE\r\n"
                         "usn: 000000000000001\r\ndevname.bambu.com: P2S Right\r\n\r\n";
        t("header names in any case", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 1 && !strcmp(h.name, "P2S Right"), h.name);
    }
    {
        /* SSDP defines Location as a URL; one firmware version may well send one */
        const char s[] = "NOTIFY * HTTP/1.1\r\nLocation: http://192.168.1.70:8883/desc.xml\r\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:alive\r\nUSN: S1\r\n\r\n";
        t("a URL in Location yields the address", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 1 && !strcmp(h.ip, "192.168.1.70"), h.ip);
    }
    {
        const char s[] = "NOTIFY * HTTP/1.1\r\nLocation: 192.168.1.58\r\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:alive\r\nUSN: S1\r\n\r\n";
        t("no name is survivable: the address is what binds", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 1 && h.name[0] == 0, h.name);
    }
    {
        const char s[] = "NOTIFY * HTTP/1.1\nLocation: 192.168.1.58\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\nNTS: ssdp:alive\nUSN: S1\n";
        t("bare newlines, no carriage returns", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 1 && !strcmp(h.ip, "192.168.1.58"), h.ip);
    }

    printf("\nwhat must NOT be reported as a printer\n");
    {
        /* the NAS announcing itself: the exact traffic that shares this group */
        const char s[] = "NOTIFY * HTTP/1.1\r\nHOST:239.255.255.250:1900\r\n"
                         "LOCATION:http://192.168.1.183:8200/rootDesc.xml\r\n"
                         "SERVER: QNAPDLNA/1.0\r\nNT:uuid:4d696e69-444c\r\nNTS:ssdp:alive\r\n\r\n";
        t("a DLNA server is not a printer", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 0, 0);
    }
    {
        const char s[] = "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\n"
                         "MAN: \"ssdp:discover\"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n";
        t("somebody else's search is not a printer", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 0, 0);
    }
    {
        const char s[] = "NOTIFY * HTTP/1.1\r\nLocation: 192.168.1.58\r\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:byebye\r\nUSN: S1\r\n\r\n";
        t("a goodbye is not a find", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 0, 0);
    }
    {
        const char s[] = "NOTIFY * HTTP/1.1\r\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:alive\r\nUSN: S1\r\n\r\n";
        t("no address means nothing to bind to", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 0, 0);
    }
    {
        const char s[] = "NOTIFY * HTTP/1.1\r\nLocation: 192.168.1.999\r\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:alive\r\nUSN: S1\r\n\r\n";
        t("a group over 255 is not an address", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 0, 0);
    }
    {
        const char s[] = "NOTIFY * HTTP/1.1\r\nLocation: 192.168.1\r\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:alive\r\nUSN: S1\r\n\r\n";
        t("three groups is not an address", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 0, 0);
    }
    {
        /* a header whose name merely starts with one we want must not be taken for it */
        const char s[] = "NOTIFY * HTTP/1.1\r\nLocationExtra: 192.168.1.58\r\n"
                         "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:alive\r\nUSN: S1\r\n\r\n";
        t("LocationExtra is not Location", ps_ssdp_parse_printer(s, sizeof s - 1, &h) == 0, 0);
    }
    {
        t("an empty datagram is not a printer", ps_ssdp_parse_printer("", 0, &h) == 0, 0);
        t("a null buffer is survivable", ps_ssdp_parse_printer(0, 10, &h) == 0, 0);
    }
    {
        /* a value longer than the field it lands in is cut, not written past */
        char s[600];
        snprintf(s, sizeof s, "NOTIFY * HTTP/1.1\r\nLocation: 192.168.1.58\r\n"
                 "NT: urn:bambulab-com:device:3dprinter:1\r\nNTS: ssdp:alive\r\nUSN: S1\r\n"
                 "DevName.bambu.com: %s\r\n\r\n",
                 "NNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNNN");
        t("an over-long name is cut to the field", ps_ssdp_parse_printer(s, strlen(s), &h) == 1 && strlen(h.name) == sizeof h.name - 1, h.name);
    }
    {
        /* every field blanked on a reject, so a caller cannot read a stale hit */
        ps_printer_hit_t g;
        memset(&g, 'x', sizeof g);
        const char s[] = "NOTIFY * HTTP/1.1\r\nNTS: ssdp:byebye\r\n\r\n";
        ps_ssdp_parse_printer(s, sizeof s - 1, &g);
        t("a reject leaves nothing behind", g.ip[0] == 0 && g.sn[0] == 0 && g.name[0] == 0, 0);
    }

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
