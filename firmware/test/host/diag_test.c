/* C8: which fault the bar says, and the blink group that says it.
 * Compiles the shipping ps_diag.c against the stub headers. No device. */
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include "ps.h"

static int pass, fail;
static void t(const char *name, int ok, long got) { if (ok) { pass++; printf("  ok    %s\n", name); } else { fail++; printf("  FAIL  %s   got: %ld\n", name, got); } }

/* is the strip lit at this instant? every pixel is the same, so the first one answers */
static bool lit_at(const ps_diag_t *d, uint32_t ms) { ps_rgba_t px[4]; ps_diag_render(d, ms, px, 4); return px[0].r || px[0].g || px[0].b; }

int main(void)
{
    ps_diag_t d;

    /* nothing wrong is not a pattern */
    t("connected to both is no diagnostic", !ps_diag_pick(PS_STA_CONNECTED, PS_PRN_CONNECTED, &d) && !d.active, d.blinks);

    /* the network, amber, outranks the printer */
    t("no network configured is one amber blink", ps_diag_pick(PS_STA_NOSSID, PS_PRN_CONNECTED, &d) && d.blinks == 1 && d.colour.r == 0xFF && d.colour.g == 0xA0 && d.colour.b == 0, d.blinks);
    t("connecting is two", ps_diag_pick(PS_STA_CONNECTING, PS_PRN_CONNECTED, &d) && d.blinks == 2, d.blinks);
    t("reconnecting is three", ps_diag_pick(PS_STA_RECONNECTING, PS_PRN_CONNECTED, &d) && d.blinks == 3, d.blinks);
    t("a refused password is four", ps_diag_pick(PS_STA_PASSWORD, PS_PRN_CONNECTED, &d) && d.blinks == 4, d.blinks);
    t("the network outranks the printer: a broken printer is not shown while the network is down",
      ps_diag_pick(PS_STA_PASSWORD, PS_PRN_ACCESS_CODE, &d) && d.blinks == 4 && d.colour.b == 0, d.blinks);

    /* the printer, blue */
    t("nothing bound is one blue blink", ps_diag_pick(PS_STA_CONNECTED, PS_PRN_INVALID, &d) && d.blinks == 1 && d.colour.b == 0xFF && d.colour.r == 0, d.blinks);
    t("connecting to the printer is two", ps_diag_pick(PS_STA_CONNECTED, PS_PRN_CONNECTING, &d) && d.blinks == 2, d.blinks);
    t("nothing answering at the address is three", ps_diag_pick(PS_STA_CONNECTED, PS_PRN_IP_ERR, &d) && d.blinks == 3, d.blinks);
    t("a refused access code is four", ps_diag_pick(PS_STA_CONNECTED, PS_PRN_ACCESS_CODE, &d) && d.blinks == 4, d.blinks);
    t("a refused serial is five", ps_diag_pick(PS_STA_CONNECTED, PS_PRN_SN_ERR, &d) && d.blinks == 5, d.blinks);
    t("anything else from the printer is six", ps_diag_pick(PS_STA_CONNECTED, PS_PRN_UNKNOWN_ERR, &d) && d.blinks == 6, d.blinks);
    t("a state this build does not know is not a fault", !ps_diag_pick(99, 99, &d), d.blinks);

    /* the blink group, in time */
    ps_diag_pick(PS_STA_CONNECTED, PS_PRN_IP_ERR, &d);          /* three blue blinks */
    t("the group starts lit", lit_at(&d, 0), 0);
    t("and goes dark between blinks", !lit_at(&d, PS_DIAG_ON_MS + 10), 0);
    t("blink two is lit", lit_at(&d, PS_DIAG_ON_MS + PS_DIAG_OFF_MS + 10), 0);
    t("blink three is lit", lit_at(&d, 2 * (PS_DIAG_ON_MS + PS_DIAG_OFF_MS) + 10), 0);
    t("the pause after the group is dark, all of it",
      !lit_at(&d, 3 * (PS_DIAG_ON_MS + PS_DIAG_OFF_MS) + 10) && !lit_at(&d, 3 * (PS_DIAG_ON_MS + PS_DIAG_OFF_MS) + PS_DIAG_PAUSE_MS - 10), 0);
    { uint32_t cycle = 3 * (PS_DIAG_ON_MS + PS_DIAG_OFF_MS) + PS_DIAG_PAUSE_MS;
      t("and it repeats on the cycle", lit_at(&d, cycle) && lit_at(&d, 5 * cycle), 0); }
    { int blinks = 0; bool was = false;
      uint32_t cycle = 3 * (PS_DIAG_ON_MS + PS_DIAG_OFF_MS) + PS_DIAG_PAUSE_MS;
      for (uint32_t ms = 0; ms < cycle; ms += 5) { bool now = lit_at(&d, ms); if (now && !was) blinks++; was = now; }
      t("one whole cycle contains exactly three blinks: the count is the message", blinks == 3, blinks); }
    { ps_rgba_t px[4]; uint32_t wait = ps_diag_render(&d, 0, px, 4);
      t("the frame asks to be woken when it stops being true", wait == PS_DIAG_ON_MS, (long)wait);
      wait = ps_diag_render(&d, 3 * (PS_DIAG_ON_MS + PS_DIAG_OFF_MS), px, 4);
      t("and at the start of the pause it sleeps the whole pause", wait == PS_DIAG_PAUSE_MS, (long)wait); }
    { ps_rgba_t px[4]; ps_diag_render(&d, 0, px, 4);
      t("the lit colour is the subsystem's, at the diagnostic's own brightness",
        px[0].b == (uint8_t)(0xFF * PS_DIAG_BRIGHT / 100) && px[0].r == 0 && px[3].b == px[0].b, px[0].b); }
    { ps_rgba_t px[4]; ps_diag_t off = { false, { 0, 0, 0, 0xFF }, 0 };
      ps_diag_render(&off, 0, px, 4);
      t("an inactive diagnostic paints nothing", !px[0].r && !px[0].g && !px[0].b, px[0].r); }

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
