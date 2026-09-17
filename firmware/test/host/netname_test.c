/* The two names, on the host. No device, no IDF.
 *
 * The hostname cases are the ones that matter: a name typed with ".local" on it is the
 * obvious reading of a field whose help text says "adding .local reaches the device", and
 * storing it verbatim makes the device answer at name.local.local, which is to say at
 * nothing anyone will try. Every shape of that mistake is pinned here. */
#include <stdio.h>
#include <string.h>
#include "ps.h"

static int pass, fail;
static void t(const char *name, int ok, const char *got)
{
    if (ok) { pass++; printf("  ok    %s\n", name); }
    else { fail++; printf("  FAIL  %s%s%s\n", name, got ? "    got: " : "", got ? got : ""); }
}

static const char *san(char *buf, size_t n, const char *in)
{
    snprintf(buf, n, "%s", in);
    ps_hostname_sanitise(buf, n);
    return buf;
}
#define SAN(in) san(b, sizeof b, in)
#define IS(in, want) t("\"" in "\" -> \"" want "\"", !strcmp(SAN(in), want), b)

int main(void)
{
    char b[64];

    printf("ps_ap_ssid_from_mac\n");
    {
        const uint8_t mac[6] = { 0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0x10 };
        char s[33];
        ps_ap_ssid_from_mac(s, sizeof s, mac);
        t("the prefix and six MAC bytes, uppercase, no separators", !strcmp(s, "Panda_Status_AABBCCDDEE10"), s);
        t("and it fits the field it is stored in", strlen(s) < sizeof s, s);
    }
    {
        /* every byte needs its two digits: a MAC ending 00 must not shorten the name */
        const uint8_t mac[6] = { 0x00, 0x01, 0x02, 0x0A, 0x00, 0x0F };
        char s[33];
        ps_ap_ssid_from_mac(s, sizeof s, mac);
        t("a byte under 0x10 keeps both its digits", !strcmp(s, "Panda_Status_0001020A000F"), s);
    }
    {
        /* two units must never agree, which is the whole reason the MAC is in the name */
        const uint8_t a[6] = { 1, 2, 3, 4, 5, 6 }, c[6] = { 1, 2, 3, 4, 5, 7 };
        char x[33], y[33];
        ps_ap_ssid_from_mac(x, sizeof x, a);
        ps_ap_ssid_from_mac(y, sizeof y, c);
        t("one byte apart is a different network", strcmp(x, y) != 0, x);
    }
    {
        char s[16] = "untouched";
        ps_ap_ssid_from_mac(s, 0, (const uint8_t[6]){ 0 });
        t("a zero-length buffer is left alone", !strcmp(s, "untouched"), s);
    }

    printf("\nps_hostname_sanitise: the .local mistake\n");
    IS("status", "status");
    IS("status.local", "status");
    IS("status.LOCAL", "status");
    IS("status.Local", "status");
    IS("status.local.local", "status");
    IS("status.local.local.local", "status");
    IS("status.local.", "status");
    IS("status.local ", "status");
    IS("status. local", "status-local");          /* a space inside is not the domain */
    IS("status.localhost", "status-localhost");   /* not ".local", and must survive whole */
    IS("local", "local");                          /* a device may legitimately be called that */
    IS(".local", "");

    printf("\nps_hostname_sanitise: one label\n");
    IS("Status One", "Status-One");
    IS("status_2", "status-2");
    IS("status.two", "status-two");
    IS("stat/us", "stat-us");
    IS("--status--", "status");
    IS("-status", "status");
    IS("status-", "status");
    IS("   status   ", "status");
    IS("", "");
    IS("-", "");
    IS("----", "");
    IS("UPPER-lower-0123", "UPPER-lower-0123");

    printf("\nps_hostname_sanitise: bounds and stability\n");
    {
        char long64[200];
        memset(long64, 'a', 120); long64[120] = 0;
        char bb[200]; snprintf(bb, sizeof bb, "%s", long64);
        ps_hostname_sanitise(bb, sizeof bb);
        t("a long name is cut to one label's 63 bytes", strlen(bb) == 63, bb);
    }
    {
        /* a cut must not leave a hyphen at the end, which is not a legal label */
        char bb[200]; memset(bb, 'a', 62); bb[62] = '-'; memset(bb + 63, 'a', 40); bb[103] = 0;
        ps_hostname_sanitise(bb, sizeof bb);
        /* 62, not 63: the 63rd byte was the hyphen, and a label may not end on one, so the
           rule wins over the length and the name comes back one byte shorter */
        t("and the cut does not end on a hyphen", strlen(bb) == 62 && bb[61] != '-', bb);
    }
    {
        /* it runs on the way in and again on the way out, so it has to be idempotent */
        char once[64], twice[64];
        snprintf(once, sizeof once, "%s", SAN("Status 2.local.LOCAL."));
        snprintf(twice, sizeof twice, "%s", once);
        ps_hostname_sanitise(twice, sizeof twice);
        t("running it twice changes nothing", !strcmp(once, twice), twice);
    }
    {
        char *nul = NULL;
        ps_hostname_sanitise(nul, 10);
        char s[8] = "keepme";
        ps_hostname_sanitise(s, 0);
        t("a null pointer and a zero length are survivable", !strcmp(s, "keepme"), s);
    }
    {
        /* the default the firmware compiles in has to survive its own sanitiser untouched */
        t("the compiled-in default is already one legal label", !strcmp(SAN("status"), "status"), b);
    }

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
