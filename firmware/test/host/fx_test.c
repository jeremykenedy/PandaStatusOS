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
      for (int fx = 0; fx < PS_FX_COUNT; fx++) for (int n = 8; n <= 16; n += 8) for (int rev = 0; rev < 2; rev++) {   /* the hue ramp included */
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

    /* which ids the bits allow */
    t("nothing is allowed with every bit clear", !ps_fx_allowed(0, PS_FX_STATIC) && !ps_fx_allowed(0, PS_FX_PROGRESS), 0);
    t("A2 allows the seventeen and none of the input effects", ps_fx_allowed(PS_FEAT_STATE_EFFECTS, 16) && !ps_fx_allowed(PS_FEAT_STATE_EFFECTS, PS_FX_PROGRESS) && !ps_fx_allowed(PS_FEAT_STATE_EFFECTS, PS_FX_PROGRESS_HUE), 0);
    t("each input effect waits for its own switch", ps_fx_allowed(PS_FEAT_FX_PROGRESS, PS_FX_PROGRESS) && !ps_fx_allowed(PS_FEAT_FX_PROGRESS, PS_FX_PROGRESS_ANIM)
      && ps_fx_allowed(PS_FEAT_FX_PROGRESS_ANIM, PS_FX_PROGRESS_ANIM) && ps_fx_allowed(PS_FEAT_FX_BARBER, PS_FX_BARBER) && ps_fx_allowed(PS_FEAT_FX_HUE_RAMP, PS_FX_PROGRESS_HUE) && !ps_fx_allowed(PS_FEAT_FX_HUE_RAMP, PS_FX_TEMP_GRADIENT), 0);
    t("an id past the count is never allowed", !ps_fx_allowed(0xFFFFFFFFu, PS_FX_COUNT) && !ps_fx_allowed(0xFFFFFFFFu, -1), 0);
    { ps_cfg_t c; memset(&c, 0, sizeof c); c.features = PS_FEAT_STATE_EFFECTS; c.fx[0].effect = PS_FX_PROGRESS; ps_fx_pick_t k;
      ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_IDLE, false, &k); t("a stored progress id with its switch off resolves to solid", k.fx == PS_FX_STATIC, k.fx);
      c.features |= PS_FEAT_FX_PROGRESS; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_IDLE, false, &k); t("and to itself once the switch is on", k.fx == PS_FX_PROGRESS, k.fx); }

    { ps_cfg_t c; memset(&c, 0, sizeof c); c.features = PS_FEAT_STATE_EFFECTS; c.fx[2].effect = PS_FX_TEMP_GRADIENT; ps_fx_pick_t k;
      ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_ERROR, false, &k); t("a stored gradient id with its switch off resolves to solid", k.fx == PS_FX_STATIC, k.fx);
      c.features |= PS_FEAT_FX_TEMP; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_ERROR, false, &k); t("and to the gradient once fx_temp is on", k.fx == PS_FX_TEMP_GRADIENT, k.fx); }
    { ps_rgba_t red = { 255, 0, 0, 255 }; ps_fx_in_t none = { -1, PS_TEMP_NONE, 25, 250 };
      ps_fx_phase_init(&p); ps_fx_render(PS_FX_TEMP_GRADIENT, red, BLACK, 100, 50, false, 0, &none, &p, px, 4);
      t("with no reading the gradient holds its cold colour", px[0].r == 0 && px[0].g == 0 && px[0].b == 0, px[0].r); }

    /* A11: the pulse layer over a base frame, pure in time */
    { ps_rgba_t red = { 200, 0, 0, 255 }, base = { 0, 100, 0, 255 }; ps_rgba_t f4[4];
      for (int i = 0; i < 4; i++) f4[i] = base; ps_fx_layer_pulse(f4, 4, red, 100, 0, 2000);
      t("at the trough the layer leaves the base untouched", f4[0].g == 100 && f4[0].r == 0 && f4[3].g == 100, f4[0].g);
      for (int i = 0; i < 4; i++) f4[i] = base; ps_fx_layer_pulse(f4, 4, red, 100, 1000, 2000);
      t("at the peak the strip is the layer's colour", f4[0].r == 200 && f4[0].g == 0 && f4[3].r == 200, f4[0].r);
      for (int i = 0; i < 4; i++) f4[i] = base; ps_fx_layer_pulse(f4, 4, red, 100, 500, 2000);
      t("halfway up it is the mix of the two", f4[0].r == 100 && f4[0].g == 50, f4[0].r);
      for (int i = 0; i < 4; i++) f4[i] = base; ps_fx_layer_pulse(f4, 4, red, 50, 1000, 2000);
      t("the layer's brightness scales its colour", f4[0].r == 100 && f4[0].g == 0, f4[0].r);
      for (int i = 0; i < 4; i++) f4[i] = base; ps_fx_layer_pulse(f4, 4, red, 100, 4000, 2000);
      t("the pulse repeats every period", f4[0].g == 100 && f4[0].r == 0, f4[0].g); }

    /* A12: the strobe layer, pure in time */
    { ps_rgba_t red = { 200, 0, 0, 255 }, base = { 0, 100, 0, 255 }; ps_rgba_t f4[4];
      for (int i = 0; i < 4; i++) f4[i] = base; bool on = ps_fx_layer_strobe(f4, 4, red, 100, 0, 100);
      t("the strobe is on for the first half period: the strip is the colour", on && f4[0].r == 200 && f4[0].g == 0 && f4[3].r == 200, f4[0].r);
      for (int i = 0; i < 4; i++) f4[i] = base; on = ps_fx_layer_strobe(f4, 4, red, 100, 150, 100);
      t("and off for the second: the base untouched", !on && f4[0].g == 100 && f4[0].r == 0, f4[0].g);
      for (int i = 0; i < 4; i++) f4[i] = base; on = ps_fx_layer_strobe(f4, 4, red, 100, 200, 100);
      t("on again after a whole period", on && f4[0].r == 200, f4[0].r);
      for (int i = 0; i < 4; i++) f4[i] = base; on = ps_fx_layer_strobe(f4, 4, red, 25, 0, 100);
      t("the strobe's brightness scales its colour", on && f4[0].r == 50 && f4[0].g == 0, f4[0].r);
      t("the rate is the engine's period: faster at 100 than at 0", ps_fx_period(100) < ps_fx_period(0), (long)ps_fx_period(100)); }

    /* A14: the palette effects */
    { ps_rgba_t stops[3] = { { 255, 0, 0, 255 }, { 0, 255, 0, 255 }, { 0, 0, 255, 255 } }; ps_fx_phase_init(&p);
      ps_fx_render_palette(PS_FX_PALETTE, stops, 3, 100, 50, false, &p, px, 5);
      t("a still palette lays its stops across the strip: the end pixels are the end stops", px[0].r == 255 && px[0].g == 0 && px[4].b == 255 && px[4].r == 0, px[4].b);
      t("and the middle pixel is the middle stop", px[2].g == 255 && px[2].r == 0 && px[2].b == 0, px[2].g);
      ps_fx_render_palette(PS_FX_PALETTE, stops, 3, 100, 50, true, &p, px, 5);
      t("reverse mirrors it", px[0].b == 255 && px[4].r == 255, px[0].b);
      ps_fx_render_palette(PS_FX_PALETTE, stops, 1, 100, 50, false, &p, px, 5);
      t("one stop is a solid", px[0].r == 255 && px[4].r == 255 && px[2].g == 0, px[4].r);
      ps_fx_render_palette(PS_FX_PALETTE, stops, 3, 50, 50, false, &p, px, 5);
      t("the brightness scales the stops", px[0].r == 127 && px[4].b == 127, px[0].r);
      ps_fx_phase_init(&p); ps_fx_render_palette(PS_FX_PALETTE_SCROLL, stops, 3, 100, 50, false, &p, px, 6); ps_rgba_t first = px[0];
      ps_fx_render_palette(PS_FX_PALETTE_SCROLL, stops, 3, 100, 50, false, &p, px, 6);
      t("the scrolling palette moves between frames", first.r != px[0].r || first.g != px[0].g || first.b != px[0].b, px[0].r);
      t("the palette ids wait for the presets switch", ps_fx_allowed(PS_FEAT_PRESETS, PS_FX_PALETTE_SCROLL) && !ps_fx_allowed(PS_FEAT_STATE_EFFECTS, PS_FX_PALETTE), 0);
      ps_cfg_t c; memset(&c, 0, sizeof c); c.features = PS_FEAT_STATE_EFFECTS | PS_FEAT_EFFECT_COLOURS | PS_FEAT_PRESETS;
      c.fx[0].effect = PS_FX_PALETTE; c.fx[0].colour[0] = stops[0]; c.fx[0].colour[1] = stops[1]; c.fx[0].colour[2] = stops[2]; c.fx[0].opt = PS_FX_OPT_BG_PRINTING;
      ps_fx_pick_t k; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_IDLE, false, &k);
      t("the resolve hands the palette its stops: the two lit colours and the set unlit ones, in order", k.fx == PS_FX_PALETTE && k.nstops == 3 && k.stops[2].b == 255, k.nstops);
      c.features &= ~PS_FEAT_EFFECT_COLOURS; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_IDLE, false, &k);
      t("without effect colours the palette has one stop, the state colour", k.nstops == 1, k.nstops); }

    /* the colour ramp across the print */
    { ps_rgba_t green = { 0, 255, 0, 255 }; ps_fx_in_t z = { 0, -1000, 0, 0 }, full = { 100, -1000, 0, 0 }, half = { 50, -1000, 0, 0 };
      ps_fx_phase_init(&p);
      ps_fx_render(PS_FX_PROGRESS_HUE, green, BLACK, 100, 50, false, 0, &z, &p, px, 4);
      t("hue ramp at 0% with no unlit colour starts a third of the wheel back: red for green", px[0].r == 255 && px[0].g == 0 && px[0].b == 0, px[0].r);
      ps_fx_render(PS_FX_PROGRESS_HUE, green, BLACK, 100, 50, false, 0, &full, &p, px, 4);
      t("hue ramp at 100% is the lit colour exactly", px[0].r == 0 && px[0].g == 255 && px[0].b == 0, px[0].g);
      ps_fx_render(PS_FX_PROGRESS_HUE, green, BLACK, 100, 50, false, 0, &half, &p, px, 4);
      t("hue ramp at 50% passes through the wheel, yellow, not through grey", px[0].r == 255 && px[0].g == 255 && px[0].b == 0, px[0].r);
      ps_rgba_t blue = { 0, 0, 255, 255 };
      ps_fx_render(PS_FX_PROGRESS_HUE, green, blue, 100, 50, false, 0, &z, &p, px, 4);
      t("hue ramp with an unlit colour starts there", px[0].b == 255 && px[0].g == 0, px[0].b);
      ps_fx_render(PS_FX_PROGRESS_HUE, green, blue, 100, 50, false, 0, &half, &p, px, 4);
      t("halfway from blue to green is cyan", px[0].g == 255 && px[0].b == 255 && px[0].r == 0, px[0].g); }

    /* an unknown id renders as the rainbow rather than nothing */
    ps_fx_phase_init(&p);
    ps_fx_render(99, WHITE, BLACK, 100, 50, false, 0, &NO_IN, &p, px, 8);
    t("an unknown effect id is not dark", max_chan(px, 8) == 255, max_chan(px, 8));
    (void)same;

    /* the resolve: which bits take over from the factory's values */
    {
        ps_cfg_t c; memset(&c, 0, sizeof c);
        c.mode[1].brightness = 50; c.mode[1].speed = 100;
        c.mode[1].colour[1] = (ps_rgba_t){ 0x1B, 0x00, 0xFF, 0xFF };     /* H2D printing */
        c.state_brightness[1][1] = 80;
        c.fx[1].effect = PS_FX_WAVE; c.fx[1].brightness = 30; c.fx[1].speed = 20; c.fx[1].bright_end = 5; c.fx[1].aux = 4;
        c.fx[1].colour[0] = (ps_rgba_t){ 1, 1, 1, 255 }; c.fx[1].colour[1] = (ps_rgba_t){ 2, 2, 2, 255 };
        c.fx[1].colour[2] = (ps_rgba_t){ 3, 3, 3, 255 }; c.fx[1].colour[3] = (ps_rgba_t){ 4, 4, 4, 255 };
        c.fx[1].opt = PS_FX_OPT_BG_PRINTING | PS_FX_OPT_RAMP | PS_FX_OPT_AUX | PS_FX_OPT_REVERSE;
        ps_fx_pick_t k;
        c.features = 0; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("every bit clear: the placeholder in the factory's colour, brightness and speed", k.fx < 0 && k.colour.b == 0xFF && k.brightness == 50 && k.speed == 100 && !k.reverse && k.bright_end < 0, k.brightness);
        c.features = PS_FEAT_STATE_BRIGHTNESS; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("A1: the per-state brightness, still the placeholder", k.fx < 0 && k.brightness == 80, k.brightness);
        c.features = PS_FEAT_STATE_EFFECTS; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("A2: the state's effect in the state's colour, factory brightness, black unlit", k.fx == PS_FX_WAVE && k.colour.b == 0xFF && k.colour.r == 0x1B && k.brightness == 50 && k.bg.r == 0 && !k.reverse, k.fx);
        ps_fx_resolve(&c, PS_MODE_MUSIC, PS_BAR_PRINTING, true, &k);
        t("A2 in Music mode: the placeholder", k.fx < 0, k.fx);
        c.features = PS_FEAT_STATE_EFFECTS | PS_FEAT_EFFECT_COLOURS; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("A3 with a job on: the effect's lit-while-printing colour and its set unlit colour", k.colour.r == 1 && k.bg.r == 3, k.bg.r);
        ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, false, &k);
        t("A3 with no job: the other lit colour, and black unlit because that bit is clear", k.colour.r == 2 && k.bg.r == 0, k.bg.r);
        c.features = PS_FEAT_STATE_EFFECTS | PS_FEAT_EFFECT_PARAMS; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("A4: the effect's own brightness, speed, direction and band; no ramp without A5", k.brightness == 30 && k.speed == 20 && k.reverse && k.band == 4 && k.bright_end < 0, k.speed);
        c.features |= PS_FEAT_EFFECT_RAMP; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("A5 with A4: the ramp's end", k.bright_end == 5, k.bright_end);
        c.fx[1].opt &= (uint8_t)~PS_FX_OPT_RAMP; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("A5 without the effect's ramp bit: no ramp", k.bright_end < 0, k.bright_end);
        c.features = PS_FEAT_STATE_EFFECTS; c.fx[1].effect = 200; ps_fx_resolve(&c, PS_MODE_H2D, PS_BAR_PRINTING, true, &k);
        t("an effect id beyond the selectable set resolves to solid", k.fx == PS_FX_STATIC, k.fx);
    }

    printf("\n%d passed, %d failed\n", pass, fail);
    return fail ? 1 : 0;
}
