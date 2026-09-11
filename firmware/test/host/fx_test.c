/* Host test for firmware/main/ps_fx.c: the shipping engine, compiled with gcc and driven
 * frame by frame. Nothing here takes a device.
 *
 *   bash firmware/test/host/run.sh      (or: make test-fw) */
#include <stdio.h>
#include <string.h>
#include <math.h>
#include "ps.h"

static int pass, fail;
static void t(const char *name, int ok, long got) { if (ok) { pass++; printf("  ok    %s\n", name); } else { fail++; printf("  FAIL  %s   got: %ld\n", name, got); } }

static const ps_rgba_t WHITE = { 255, 255, 255, 255 }, BLACK = { 0, 0, 0, 255 }, AMBER = { 255, 160, 0, 255 };
static const ps_fx_in_t NO_IN = { -1, -1000, 0, 0 };

static int max_chan(const ps_rgba_t *px, int n) { int m = 0; for (int i = 0; i < n; i++) { if (px[i].r > m) m = px[i].r; if (px[i].g > m) m = px[i].g; if (px[i].b > m) m = px[i].b; } return m; }
static int same(const ps_rgba_t *a, const ps_rgba_t *b, int n) { for (int i = 0; i < n; i++) if (a[i].r != b[i].r || a[i].g != b[i].g || a[i].b != b[i].b) return 0; return 1; }

int main(void)
{
    ps_fx_phase_t p; ps_rgba_t px[16], py[16];

    /* the speed curve */
    t("speed 100 is 16 ms", ps_fx_period(100) == 16, ps_fx_period(100));
    t("speed 0 is 500 ms", ps_fx_period(0) == 500, ps_fx_period(0));
    { int mono = 1; for (int s = 1; s <= 100; s++) if (ps_fx_period((uint8_t)s) > ps_fx_period((uint8_t)(s - 1))) mono = 0; t("the period never rises with speed", mono, 0); }
    t("a speed over 100 is 100", ps_fx_period(255) == 16, ps_fx_period(255));

    /* solid is byte-exact */
    ps_fx_phase_init(&p);
    ps_fx_render(PS_FX_STATIC, AMBER, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 8);
    t("solid at full brightness is the colour exactly", px[0].r == 255 && px[0].g == 160 && px[0].b == 0 && px[7].g == 160, px[0].g);
    ps_fx_render(PS_FX_STATIC, AMBER, BLACK, 50, 50, false, 0, &NO_IN, &p, px, 8);
    t("solid at half brightness is colour * 50 / 100 per channel", px[3].r == 127 && px[3].g == 80 && px[3].b == 0, px[3].r);

    /* strobe alternates, off first */
    ps_fx_phase_init(&p);
    ps_fx_render(PS_FX_STROBING, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 8);
    ps_fx_render(PS_FX_STROBING, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, py, 8);
    t("strobe: one frame dark, the next lit", max_chan(px, 8) == 0 && max_chan(py, 8) == 255, max_chan(py, 8));
    ps_fx_phase_init(&p);
    ps_fx_render(PS_FX_STROBING, WHITE, AMBER, 100, 50, false, 0, &NO_IN, &p, px, 8);
    t("strobe: the dark half is the inactive colour when one is set", px[0].r == 255 && px[0].g == 160 && px[0].b == 0, px[0].g);

    /* reverse mirrors the marquee at the same phase */
    { ps_fx_phase_t q; ps_fx_phase_init(&p); ps_fx_phase_init(&q);
      for (int k = 0; k < 7; k++) { ps_fx_render(PS_FX_MARQUEE, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 16); ps_fx_render(PS_FX_MARQUEE, WHITE, BLACK, 100, 50, true, 0, &NO_IN, &q, py, 16); }
      int mirror = 1; for (int i = 0; i < 16; i++) if (px[i].r != py[15 - i].r) mirror = 0;
      t("marquee reversed is the marquee mirrored", mirror, 0);
      int lit = 0; for (int i = 0; i < 16; i++) if (px[i].r) lit++;
      t("marquee lights one block of n/4 pixels", lit == 4, lit); }

    /* rainbow and hue cycle are never black */
    ps_fx_phase_init(&p);
    ps_fx_render(PS_FX_RAINBOW, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 16);
    { int dark = 0, spread = px[0].r != px[8].r || px[0].g != px[8].g || px[0].b != px[8].b;
      for (int i = 0; i < 16; i++) if (!px[i].r && !px[i].g && !px[i].b) dark++;
      t("rainbow: no pixel black, and the hue varies along the run", dark == 0 && spread, dark); }
    ps_fx_phase_init(&p);
    { int full = 1; for (int k = 0; k < 130; k++) { ps_fx_render(PS_FX_HUE_CYCLE, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 4); if (px[0].r != 255 && px[0].g != 255 && px[0].b != 255) full = 0; }
      t("hue cycle: one channel is always full", full, 0); }

    /* breathing floors above black without an inactive colour */
    ps_fx_phase_init(&p);
    { int minc = 255; for (int k = 0; k < 120; k++) { ps_fx_render(PS_FX_BREATHING, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 4); if (px[0].r < minc) minc = px[0].r; }
      t("breathing never reaches black without an inactive colour", minc > 0 && minc < 60, minc); }

    /* every effect, many frames, two lengths: bounded, finite, a sane period */
    { int bad = 0; long worst = 0;
      for (int fx = 0; fx < PS_FX_COUNT; fx++) for (int n = 8; n <= 16; n += 8) for (int rev = 0; rev < 2; rev++) {
          ps_fx_phase_init(&p);
          ps_fx_in_t in = { 42, 40, 25, 60 };
          for (int k = 0; k < 300; k++) {
              uint32_t w = ps_fx_render(fx, AMBER, BLACK, 40, (uint8_t)(k % 101), rev != 0, 0, &in, &p, px, n);
              if (w < 16 || w > 500) { bad++; worst = fx; }
              if (max_chan(px, n) > 103) { bad++; worst = fx; }          /* 255 * 40 / 100 = 102, plus rounding */
              if (!isfinite(p.marquee_pos) || !isfinite(p.split_pos) || !isfinite(p.progress_shown)) { bad++; worst = fx; }
          }
      }
      t("every effect stays within its brightness, finite, with a period in 16..500 ms", bad == 0, worst); }

    /* the ramp */
    ps_fx_phase_init(&p);
    { uint8_t b0 = ps_fx_ramp(&p, 20, 80); uint8_t mid = 0; for (int k = 1; k < 100; k++) { uint8_t b = ps_fx_ramp(&p, 20, 80); if (k == 50) mid = b; } uint8_t again = ps_fx_ramp(&p, 20, 80);
      t("ramp: starts at bright, is halfway at step 50, wraps after 100", b0 == 20 && mid == 50 && again == 20, mid); }
    { ps_fx_phase_init(&p); p.ramp_step = 37; uint8_t b = ps_fx_ramp(&p, 33, -1); t("no ramp: the brightness untouched and the sweep parked", b == 33 && p.ramp_step == 0, p.ramp_step); }

    /* progress fills from one end; reverse fills from the other */
    { ps_fx_in_t in = { 50, -1000, 0, 0 }; ps_fx_phase_init(&p);
      for (int k = 0; k < 60; k++) ps_fx_render(PS_FX_PROGRESS, WHITE, BLACK, 100, 50, false, 0, &in, &p, px, 8);
      t("progress at 50% on 8 pixels: the first four lit, the last four dark", px[0].r == 255 && px[3].r == 255 && px[4].r == 0 && px[7].r == 0, px[3].r);
      ps_fx_phase_init(&p);
      for (int k = 0; k < 60; k++) ps_fx_render(PS_FX_PROGRESS, WHITE, BLACK, 100, 50, true, 0, &in, &p, px, 8);
      t("progress reversed fills from the far end", px[7].r == 255 && px[4].r == 255 && px[3].r == 0 && px[0].r == 0, px[7].r);
      in.percent = -1; ps_fx_phase_init(&p);
      for (int k = 0; k < 60; k++) ps_fx_render(PS_FX_PROGRESS, WHITE, BLACK, 100, 50, false, 0, &in, &p, px, 8);
      t("progress with no reading is an empty bar", max_chan(px, 8) == 0, max_chan(px, 8)); }

    /* the temperature gradient */
    { ps_fx_in_t cold = { -1, 10, 25, 60 }, hot = { -1, 90, 25, 60 }, mid = { -1, 42, 25, 60 }; ps_fx_phase_init(&p);
      ps_fx_render(PS_FX_TEMP_GRADIENT, WHITE, AMBER, 100, 50, false, 0, &cold, &p, px, 4);
      ps_fx_render(PS_FX_TEMP_GRADIENT, WHITE, AMBER, 100, 50, false, 0, &hot, &p, py, 4);
      t("gradient: cold is the inactive colour exactly, hot the active exactly", px[0].g == 160 && px[0].b == 0 && py[0].g == 255 && py[0].b == 255, py[0].b);
      ps_fx_render(PS_FX_TEMP_GRADIENT, WHITE, AMBER, 100, 50, false, 0, &mid, &p, px, 4);
      t("gradient: midway is between the two", px[0].b > 0 && px[0].b < 255, px[0].b); }

    /* an unknown id renders as the rainbow rather than nothing */
    ps_fx_phase_init(&p);
    ps_fx_render(99, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 8);
    t("an unknown effect id is not dark", max_chan(px, 8) == 255, max_chan(px, 8));
    (void)same;

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
