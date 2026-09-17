/* C7: the rebind decision, the pure part of "the printer moved, find it again".
 * Compiles the shipping ps_rebind.c against the stub headers. No device, no network. */
#include <stdio.h>
#include <string.h>
#include <stdbool.h>
#include "ps.h"

static int pass, fail;
static void t(const char *name, int ok, long got) { if (ok) { pass++; printf("  ok    %s\n", name); } else { fail++; printf("  FAIL  %s   got: %ld\n", name, got); } }

static ps_printer_hit_t hit(const char *name, const char *ip, const char *sn)
{
    ps_printer_hit_t h; memset(&h, 0, sizeof h);
    snprintf(h.name, sizeof h.name, "%s", name); snprintf(h.ip, sizeof h.ip, "%s", ip); snprintf(h.sn, sizeof h.sn, "%s", sn);
    return h;
}

int main(void)
{
    const uint8_t bound[4] = { 192, 0, 2, 20 };
    uint8_t out[4] = { 0, 0, 0, 0 };

    t("no hits at all is no match", ps_rebind_decide("<T_SN>", bound, NULL, 0, out) == PS_REBIND_NO_MATCH, 0);
    { ps_printer_hit_t h[1] = { hit("Other", "192.0.2.30", "<OTHER_SN>") };
      t("a hit with another serial is no match", ps_rebind_decide("<T_SN>", bound, h, 1, out) == PS_REBIND_NO_MATCH, 0); }
    { ps_printer_hit_t h[1] = { hit("Ours", "192.0.2.20", "<T_SN>") };
      t("our serial at the address we already have is unchanged", ps_rebind_decide("<T_SN>", bound, h, 1, out) == PS_REBIND_UNCHANGED, 0); }
    { ps_printer_hit_t h[1] = { hit("Ours", "192.0.2.30", "<T_SN>") };
      memset(out, 0, 4);
      int o = ps_rebind_decide("<T_SN>", bound, h, 1, out);
      t("our serial somewhere new is a move, and says where", o == PS_REBIND_MOVED && out[0] == 192 && out[1] == 0 && out[2] == 2 && out[3] == 30, out[3]); }
    { ps_printer_hit_t h[3] = { hit("A", "192.0.2.31", "<A_SN>"), hit("Ours", "192.0.2.32", "<T_SN>"), hit("B", "192.0.2.33", "<B_SN>") };
      memset(out, 0, 4);
      int o = ps_rebind_decide("<T_SN>", bound, h, 3, out);
      t("ours is found among several", o == PS_REBIND_MOVED && out[3] == 32, out[3]); }
    { ps_printer_hit_t h[1] = { hit("Ours", "192.0.2", "<T_SN>") };
      t("a hit we cannot bind to is no hit", ps_rebind_decide("<T_SN>", bound, h, 1, out) == PS_REBIND_NO_MATCH, 0); }
    { ps_printer_hit_t h[1] = { hit("Ours", "192.0.2.300", "<T_SN>") };
      t("an octet over 255 is no hit", ps_rebind_decide("<T_SN>", bound, h, 1, out) == PS_REBIND_NO_MATCH, 0); }
    { ps_printer_hit_t h[1] = { hit("Ours", "192.0.2.20 ", "<T_SN>") };
      t("trailing rubbish after the address is no hit", ps_rebind_decide("<T_SN>", bound, h, 1, out) == PS_REBIND_NO_MATCH, 0); }
    { ps_printer_hit_t h[1] = { hit("Ours", "192.0.2.30", "<T_SN>") };
      t("no serial bound is no match: there is nothing to recognise", ps_rebind_decide("", bound, h, 1, out) == PS_REBIND_NO_MATCH, 0);
      t("a null serial is no match", ps_rebind_decide(NULL, bound, h, 1, out) == PS_REBIND_NO_MATCH, 0); }
    { ps_printer_hit_t h[1] = { hit("Ours", "0.0.0.0", "<T_SN>") };
      const uint8_t none[4] = { 0, 0, 0, 0 };
      t("nothing bound yet and a hit at nothing is unchanged, not a move", ps_rebind_decide("<T_SN>", none, h, 1, out) == PS_REBIND_UNCHANGED, 0); }
    { ps_printer_hit_t h[1] = { hit("Ours", "10.0.0.7", "<T_SN>") };
      const uint8_t none[4] = { 0, 0, 0, 0 };
      memset(out, 0, 4);
      int o = ps_rebind_decide("<T_SN>", none, h, 1, out);
      t("a printer found while nothing is bound is a move to it", o == PS_REBIND_MOVED && out[0] == 10 && out[3] == 7, out[3]); }
    t("the three answers are the wire's own scan states", PS_REBIND_NO_MATCH == 4 && PS_REBIND_UNCHANGED == 5 && PS_REBIND_MOVED == 6, PS_REBIND_MOVED);

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
