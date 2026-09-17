/* The effect engine. Pure C, no IDF, so firmware/test/host/fx_test.c drives the shipping
 * body with gcc; ps_effect.c owns the task, the inputs and the strip.
 *
 * This is Jeremy Kenedy's engine, the one PandaVentOS renders with (his own work, it
 * crosses freely: the clean-room rule), adapted to one strip and to this project's colour
 * type. What it is not: anything of the Panda Status factory's. The factory's two modes are
 * rendered as the placeholder in ps_effect.c until Phase 1 recovers them; everything here
 * sits behind feature bits that default off (docs/FEATURES.md).
 *
 * One case per effect. Each fills px[0..n-1] for this instant, advances its own phase
 * once per call, and returns the MILLISECONDS to wait before the next frame: the frame
 * period is the effect's, from one shared speed curve (ps_fx_period), so a given speed
 * means the same liveliness on every effect. Every effect reaches the INACTIVE colour
 * through mix3(), so the one rule "unlit is the inactive colour, or black when none is
 * set" holds everywhere. Channel scaling is integer, colour * brightness / 100; effects
 * that ease within a frame keep that integer product intact and apply the float factor
 * before the divide, so full brightness with no easing is byte-exact. */
#include <math.h>
#include <string.h>
#include "ps.h"

#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif

static inline uint8_t chan(uint8_t colour, uint8_t bright100) { return (uint8_t)(((uint32_t)colour * (uint32_t)bright100) / 100u); }
static inline uint8_t chan_f(uint8_t colour, uint8_t bright100, float f) { return (uint8_t)(((float)((uint32_t)colour * (uint32_t)bright100) * f) / 100.0f); }

/* out = active * f + inactive * (1 - f), each through the brightness; the factors sum to
 * one so no channel can exceed a full-brightness one. Alpha is carried, never mixed. */
static inline ps_rgba_t mix3(ps_rgba_t a, ps_rgba_t bg, uint8_t b, float f)
{
    ps_rgba_t o;
    o.r = (uint8_t)(chan_f(a.r, b, f) + chan_f(bg.r, b, 1.0f - f));
    o.g = (uint8_t)(chan_f(a.g, b, f) + chan_f(bg.g, b, 1.0f - f));
    o.b = (uint8_t)(chan_f(a.b, b, f) + chan_f(bg.b, b, 1.0f - f));
    o.a = 0xFF;
    return o;
}

/* hue -> RGB at full saturation and value: the S=V=1 case of the six-sector HSV conversion */
static ps_rgba_t hsv_full(uint16_t h)
{
    h %= 360;
    uint8_t sector = (uint8_t)(h / 60);
    uint8_t rise = (uint8_t)(((h % 60) * 255) / 60);
    uint8_t fall = (uint8_t)(255 - rise);
    switch (sector) {
    case 0:  return (ps_rgba_t){ 255, rise, 0, 0xFF };
    case 1:  return (ps_rgba_t){ fall, 255, 0, 0xFF };
    case 2:  return (ps_rgba_t){ 0, 255, rise, 0xFF };
    case 3:  return (ps_rgba_t){ 0, fall, 255, 0xFF };
    case 4:  return (ps_rgba_t){ rise, 0, 255, 0xFF };
    default: return (ps_rgba_t){ 255, 0, fall, 0xFF };
    }
}

/* general HSV both ways, for the effects that interpolate colours by hue */
static void rgb_to_hsv(ps_rgba_t c, float *h, float *s, float *v)
{
    float r = c.r / 255.0f, g = c.g / 255.0f, b = c.b / 255.0f;
    float mx = r > g ? (r > b ? r : b) : (g > b ? g : b), mn = r < g ? (r < b ? r : b) : (g < b ? g : b), d = mx - mn;
    *v = mx; *s = mx > 0.0f ? d / mx : 0.0f;
    if (d <= 0.0f) { *h = 0.0f; return; }
    float hh = (mx == r) ? (g - b) / d + (g < b ? 6.0f : 0.0f) : (mx == g) ? (b - r) / d + 2.0f : (r - g) / d + 4.0f;
    *h = hh * 60.0f;
}
static ps_rgba_t hsv_to_rgb(float h, float s, float v)
{
    while (h < 0.0f) h += 360.0f;
    while (h >= 360.0f) h -= 360.0f;
    float c = v * s, x = c * (1.0f - fabsf(fmodf(h / 60.0f, 2.0f) - 1.0f)), m = v - c, r, g, b;
    if (h < 60) { r = c; g = x; b = 0; } else if (h < 120) { r = x; g = c; b = 0; } else if (h < 180) { r = 0; g = c; b = x; }
    else if (h < 240) { r = 0; g = x; b = c; } else if (h < 300) { r = x; g = 0; b = c; } else { r = c; g = 0; b = x; }
    return (ps_rgba_t){ (uint8_t)((r + m) * 255.0f + 0.5f), (uint8_t)((g + m) * 255.0f + 0.5f), (uint8_t)((b + m) * 255.0f + 0.5f), 0xFF };
}

void ps_fx_layer_pulse(ps_rgba_t *px, int n, ps_rgba_t colour, uint8_t bright100, uint32_t now_ms, uint32_t period_ms)
{
    if (period_ms == 0) period_ms = 1;
    float f = (float)(now_ms % period_ms) / (float)period_ms;
    float env = 0.5f - 0.5f * cosf(2.0f * (float)M_PI * f);      /* 0 at the trough, 1 at the peak, eased both ways */
    ps_rgba_t top = { chan(colour.r, bright100), chan(colour.g, bright100), chan(colour.b, bright100), 0xFF };
    for (int i = 0; i < n; i++) {
        px[i].r = (uint8_t)(px[i].r + (top.r - px[i].r) * env + 0.5f);
        px[i].g = (uint8_t)(px[i].g + (top.g - px[i].g) * env + 0.5f);
        px[i].b = (uint8_t)(px[i].b + (top.b - px[i].b) * env + 0.5f);
        px[i].a = 0xFF;
    }
}

bool ps_fx_layer_strobe(ps_rgba_t *px, int n, ps_rgba_t colour, uint8_t bright100, uint32_t now_ms, uint32_t half_ms)
{
    if (half_ms == 0) half_ms = 1;
    bool on = ((now_ms / half_ms) & 1u) == 0;
    if (!on) return false;
    ps_rgba_t top = { chan(colour.r, bright100), chan(colour.g, bright100), chan(colour.b, bright100), 0xFF };
    for (int i = 0; i < n; i++) px[i] = top;
    return true;
}

/* A14: the colour at 0..1 along a palette, piecewise linear; wrapped, the last stop runs back into the first */
static ps_rgba_t palette_at(const ps_rgba_t *stops, int nstops, float t, bool wrap)
{
    if (nstops <= 1) return stops[0];
    int segs = wrap ? nstops : nstops - 1;
    float x = t * (float)segs; int s = (int)x; if (s >= segs) s = segs - 1; if (s < 0) s = 0;
    float f = x - (float)s;
    ps_rgba_t a = stops[s], b = stops[(s + 1) % nstops];
    return (ps_rgba_t){ (uint8_t)(a.r + (b.r - a.r) * f + 0.5f), (uint8_t)(a.g + (b.g - a.g) * f + 0.5f), (uint8_t)(a.b + (b.b - a.b) * f + 0.5f), 0xFF };
}
uint32_t ps_fx_render_palette(int fx, const ps_rgba_t *stops, int nstops, uint8_t bright100, uint8_t speed, bool reverse,
                              ps_fx_phase_t *p, ps_rgba_t *px, int n)
{
    if (n < 1) return ps_fx_period(speed);
    if (nstops < 1) { for (int i = 0; i < n; i++) px[i] = (ps_rgba_t){ 0, 0, 0, 0xFF }; return ps_fx_period(speed); }
    bool scroll = fx == PS_FX_PALETTE_SCROLL;
    for (int i = 0; i < n; i++) {
        int ri = reverse ? (n - 1 - i) : i;
        float t;
        if (scroll) { t = (float)ri / (float)n + p->palette_pos; while (t >= 1.0f) t -= 1.0f; }
        else t = n > 1 ? (float)ri / (float)(n - 1) : 0.0f;
        ps_rgba_t c = palette_at(stops, nstops, t, scroll);
        px[i] = (ps_rgba_t){ chan(c.r, bright100), chan(c.g, bright100), chan(c.b, bright100), 0xFF };
    }
    if (scroll) { p->palette_pos += 1.0f / (float)n; while (p->palette_pos >= 1.0f) p->palette_pos -= 1.0f; }
    return ps_fx_period(speed);
}

/* INFERENCE, B1: the print stage as one of the fifteen display slots, from the report's
 * gcode_state and stg_cur. The codes are the printer's own stage numbers as the community
 * documents them and as the vent has met them in its logs; nothing here has been checked
 * against this device, and the MQTT capture corrects the table. A running job with a code
 * the table does not know is `printing`; a finished job is `printing_ok`; anything else is
 * `standby`. The slot numbers are the device's order (ps_gif_slot_names). */
uint8_t ps_stage_from_report(const char *gcode_state, int stg_cur)
{
    if (!gcode_state) return 0;
    if (!strcmp(gcode_state, "FINISH")) return 13;                                  /* printing_ok */
    if (strcmp(gcode_state, "RUNNING") && strcmp(gcode_state, "PREPARE") && strcmp(gcode_state, "PAUSE")) return 0;   /* standby */
    switch (stg_cur) {
    case 1:            return 3;    /* bed_leveling */
    case 2:            return 2;    /* bed_heating */
    case 3:            return 7;    /* xy_mesh_mode_sweep */
    case 4:            return 8;    /* filament_check_location: a filament change under way */
    case 7:            return 1;    /* nozzle_heating */
    case 8: case 19:   return 6;    /* calibrating_flow */
    case 13:           return 4;    /* homing */
    case 14:           return 5;    /* nozzle_cleaning */
    case 22:           return 10;   /* filament_pull_back_cur */
    case 24:           return 11;   /* filament_push_new */
    default:           return 14;   /* printing */
    }
}

/* Which effects the bits allow. The first seventeen need no live input and come with A2;
 * the ones that read the print or the printer each wait for their own switch. */
bool ps_fx_allowed(uint32_t features, int fx)
{
    if (fx < 0 || fx >= PS_FX_COUNT) return false;
    if (fx < PS_FX_SELECTABLE) return (features & PS_FEAT_STATE_EFFECTS) != 0;
    switch (fx) {
    case PS_FX_PROGRESS:      return (features & PS_FEAT_FX_PROGRESS) != 0;
    case PS_FX_PROGRESS_ANIM: return (features & PS_FEAT_FX_PROGRESS_ANIM) != 0;
    case PS_FX_BARBER:        return (features & PS_FEAT_FX_BARBER) != 0;
    case PS_FX_PROGRESS_HUE:  return (features & PS_FEAT_FX_HUE_RAMP) != 0;
    case PS_FX_TEMP_GRADIENT: return (features & PS_FEAT_FX_TEMP) != 0;
    case PS_FX_PALETTE: case PS_FX_PALETTE_SCROLL: return (features & PS_FEAT_PRESETS) != 0;
    default: return false;
    }
}

/* speed 0..100 -> frame interval, geometric: each equal step in speed multiplies the frame
 * RATE by a constant, because liveliness reads as a ratio. 16 ms at 100 so the fast end
 * stays smooth, 500 ms at 0 so it is a slow pulse rather than a stall. */
uint32_t ps_fx_period(uint8_t speed)
{
    if (speed > 100) speed = 100;
    const float fast_ms = 16.0f, slow_ms = 500.0f;
    float t = (float)(100 - speed) / 100.0f;
    return (uint32_t)(fast_ms * powf(slow_ms / fast_ms, t) + 0.5f);
}

void ps_fx_phase_init(ps_fx_phase_t *p)
{
    memset(p, 0, sizeof *p);
    p->strobe_on = true;
    p->bounce_dir = p->cylon_dir = p->sbounce_dir = p->sfill_dir = 1.0f;
}

/* The optional brightness ramp: one sawtooth from bright to bright_end over PS_FX_RAMP_STEPS
 * frames, then over again. bright_end < 0 means no ramp, and parks the sweep at its start
 * so switching a ramp on begins at bright rather than mid-sweep. An integer step, not an
 * accumulated float: adding 0.01f a hundred times lands at 0.99999997. */
uint8_t ps_fx_ramp(ps_fx_phase_t *p, uint8_t bright, int bright_end)
{
    if (bright_end < 0) { p->ramp_step = 0; return bright; }
    float f = (float)p->ramp_step / (float)PS_FX_RAMP_STEPS;
    float b = (float)bright + ((float)bright_end - (float)bright) * f;
    if (b < 0.0f) b = 0.0f; else if (b > 100.0f) b = 100.0f;
    if (++p->ramp_step >= PS_FX_RAMP_STEPS) p->ramp_step = 0;
    return (uint8_t)(b + 0.5f);
}

/* The bits, in the order they take over from the factory's values:
 *   A1 state_brightness  the brightness per bar state instead of per mode
 *   A2 state_effects     in H2D, the state's effect instead of a solid fill
 *   A3 effect_colours    the effect's own lit and unlit colours, chosen by whether a job is on
 *   A4 effect_params     the effect's own brightness, speed, direction and band, over A1's
 *   A5 effect_ramp       the brightness ramp, only with A4 and only when the effect set one
 * With every bit clear the answer is the factory's colour, brightness and speed, solid. */
void ps_fx_resolve(const ps_cfg_t *c, uint8_t mode, uint8_t st, bool job_active, ps_fx_pick_t *o)
{
    ps_fx_resolve_stage(c, mode, st, job_active, NULL, o);
}

void ps_fx_resolve_stage(const ps_cfg_t *c, uint8_t mode, uint8_t st, bool job_active, const ps_stage_row_t *row, ps_fx_pick_t *o)
{
    if (mode > PS_MODE_H2D) mode = PS_MODE_H2D;
    if (st > PS_BAR_ERROR) st = PS_BAR_IDLE;
    const ps_mode_cfg_t *m = &c->mode[mode];
    uint32_t feat = c->features;
    /* B2: a set stage row stands in for the state's entry; every bit below reads it the same way */
    const ps_fx_cfg_t *f = (row && row->set && (feat & PS_FEAT_STAGE_EFFECTS)) ? &row->fx : &c->fx[st];
    o->fx = -1;
    o->colour = m->colour[st];
    o->bg = (ps_rgba_t){ 0, 0, 0, 0xFF };
    o->brightness = (feat & PS_FEAT_STATE_BRIGHTNESS) ? c->state_brightness[mode][st] : m->brightness;
    o->speed = m->speed;
    o->reverse = false; o->bright_end = -1; o->band = 0;
    o->nstops = 1; o->stops[0] = o->colour;
    if (mode != PS_MODE_H2D || !(feat & PS_FEAT_STATE_EFFECTS)) return;
    o->fx = ps_fx_allowed(feat, f->effect) ? f->effect : PS_FX_STATIC;   /* a stored id whose switch is off falls back to solid */
    if (feat & PS_FEAT_EFFECT_COLOURS) {
        o->colour = f->colour[job_active ? 0 : 1];
        uint8_t bit = job_active ? PS_FX_OPT_BG_PRINTING : PS_FX_OPT_BG_IDLE;
        if (f->opt & bit) o->bg = f->colour[job_active ? 2 : 3];
        /* A14: the palette effects read the four colours as stops, in order, the unlit ones only while set */
        o->nstops = 0;
        o->stops[o->nstops++] = f->colour[0]; o->stops[o->nstops++] = f->colour[1];
        if (f->opt & PS_FX_OPT_BG_PRINTING) o->stops[o->nstops++] = f->colour[2];
        if (f->opt & PS_FX_OPT_BG_IDLE) o->stops[o->nstops++] = f->colour[3];
    } else { o->nstops = 1; o->stops[0] = o->colour; }
    if (feat & PS_FEAT_EFFECT_PARAMS) {
        o->brightness = f->brightness; o->speed = f->speed;
        o->reverse = (f->opt & PS_FX_OPT_REVERSE) != 0;
        if (f->opt & PS_FX_OPT_AUX) o->band = f->aux;
        if ((feat & PS_FEAT_EFFECT_RAMP) && (f->opt & PS_FX_OPT_RAMP)) o->bright_end = f->bright_end;
    }
}

#define BREATH_FLOOR   0.12f
#define BREATH_DELTA   0.02f
#define WAVE_CYCLES    2.0f
#define WAVE_DELTA     0.05f
#define MARQUEE_WFRAC  4
#define MARQUEE_DELTA  0.5f
#define CYCLE_DELTA    3.0f
#define RAINBOW_DELTA  3.0f

uint32_t ps_fx_render(int fx, ps_rgba_t colour, ps_rgba_t bg, uint8_t bright100, uint8_t speed, bool reverse,
                      int band, const ps_fx_in_t *in, ps_fx_phase_t *p, ps_rgba_t *px, int n)
{
    if (n < 1) return ps_fx_period(speed);
    switch (fx) {

    /* every pixel the active colour, scaled; chan() directly so full brightness is byte-exact */
    case PS_FX_STATIC:
        for (int i = 0; i < n; i++) px[i] = (ps_rgba_t){ chan(colour.r, bright100), chan(colour.g, bright100), chan(colour.b, bright100), 0xFF };
        return ps_fx_period(speed);

    /* the whole strip one colour easing up and down together: a triangle, cosine-eased into
     * a swell; the trough is the inactive colour when one is set, a floored dim active
     * colour (never black) when not */
    case PS_FX_BREATHING: {
        if (p->breath_step == 0.0f) p->breath_step = BREATH_DELTA;
        p->breath_phase += p->breath_step;
        if (p->breath_phase >= 1.0f)      { p->breath_phase = 1.0f; p->breath_step = -BREATH_DELTA; }
        else if (p->breath_phase <= 0.0f) { p->breath_phase = 0.0f; p->breath_step =  BREATH_DELTA; }
        float eased = 0.5f - 0.5f * cosf((float)M_PI * p->breath_phase);
        bool has_bg = bg.r || bg.g || bg.b;
        float envlo = has_bg ? 0.0f : BREATH_FLOOR;
        float env = envlo + (1.0f - envlo) * eased;
        for (int i = 0; i < n; i++) px[i] = mix3(colour, bg, bright100, env);
        return ps_fx_period(speed);
    }

    /* hard on, hard off, in phase; the off half is the inactive colour or black */
    case PS_FX_STROBING: {
        p->strobe_on = !p->strobe_on;
        float f = p->strobe_on ? 1.0f : 0.0f;
        for (int i = 0; i < n; i++) px[i] = mix3(colour, bg, bright100, f);
        return ps_fx_period(speed);
    }

    /* a sinusoidal brightness pattern travelling along the run; direction flips with reverse */
    case PS_FX_WAVE: {
        float dir = reverse ? -1.0f : 1.0f;
        for (int i = 0; i < n; i++) {
            float cyc = (float)i * WAVE_CYCLES / (float)n;
            float f = 0.5f + 0.5f * sinf(2.0f * (float)M_PI * (cyc - dir * p->wave_pos));
            px[i] = mix3(colour, bg, bright100, f);
        }
        p->wave_pos += WAVE_DELTA;
        if (p->wave_pos >= 1.0f) p->wave_pos -= 1.0f;
        return ps_fx_period(speed);
    }

    /* one lit block walking the run and wrapping */
    case PS_FX_MARQUEE: {
        int w = n / MARQUEE_WFRAC; if (w < 1) w = 1;
        for (int i = 0; i < n; i++) {
            int ri = reverse ? (n - 1 - i) : i;
            float rel = (float)ri - p->marquee_pos;
            while (rel < 0.0f) rel += (float)n;
            while (rel >= (float)n) rel -= (float)n;
            px[i] = mix3(colour, bg, bright100, rel < (float)w ? 1.0f : 0.0f);
        }
        p->marquee_pos += MARQUEE_DELTA;
        if (p->marquee_pos >= (float)n) p->marquee_pos -= (float)n;
        return ps_fx_period(speed);
    }

    /* the whole strip one hue, walking the wheel; never black */
    case PS_FX_HUE_CYCLE: {
        ps_rgba_t h = hsv_full((uint16_t)p->cycle_hue % 360);
        ps_rgba_t o = { chan(h.r, bright100), chan(h.g, bright100), chan(h.b, bright100), 0xFF };
        for (int i = 0; i < n; i++) px[i] = o;
        p->cycle_hue += CYCLE_DELTA;
        if (p->cycle_hue >= 360.0f) p->cycle_hue -= 360.0f;
        return ps_fx_period(speed);
    }

    /* a bright head sweeping end to end with a tail fading behind it: asymmetric, so it reads
     * as motion even frozen, and the asymmetry flips when the head turns */
    case PS_FX_CYLON: {
        const float TAIL = 5.0f;
        float head = reverse ? (float)(n - 1) - p->cylon_pos : p->cylon_pos;
        float dir = reverse ? -p->cylon_dir : p->cylon_dir;
        for (int i = 0; i < n; i++) {
            float rel = ((float)i - head) * dir;
            float f;
            if (rel >= 0.0f) f = rel > 1.5f ? 0.0f : expf(-(rel * rel) / 0.9f);
            else { float back = -rel; f = back > TAIL ? 0.0f : 1.0f - back / TAIL; f = f * f; }
            px[i] = mix3(colour, bg, bright100, f);
        }
        p->cylon_pos += p->cylon_dir * 0.35f;
        if (p->cylon_pos >= (float)(n - 1)) { p->cylon_pos = (float)(n - 1); p->cylon_dir = -1.0f; }
        else if (p->cylon_pos <= 0.0f)      { p->cylon_pos = 0.0f;            p->cylon_dir = 1.0f; }
        return ps_fx_period(speed);
    }

    /* the marquee's travelling Gaussian, reflecting at the ends instead of wrapping; reverse
     * mirrors the strip rather than negating the step, which would fight the turnaround */
    case PS_FX_BOUNCE: {
        float pos = reverse ? (float)(n - 1) - p->bounce_pos : p->bounce_pos;
        for (int i = 0; i < n; i++) {
            float d = fabsf((float)i - pos);
            px[i] = mix3(colour, bg, bright100, d > 5.0f ? 0.0f : expf(-(d * d) / 4.5f));
        }
        p->bounce_pos += p->bounce_dir * 0.3f;
        if (p->bounce_pos >= (float)(n - 1)) { p->bounce_pos = (float)(n - 1); p->bounce_dir = -1.0f; }
        else if (p->bounce_pos <= 0.0f)      { p->bounce_pos = 0.0f;            p->bounce_dir = 1.0f; }
        return ps_fx_period(speed);
    }

    /* The centre-referenced family. h is half the strip rounded up; depth is a pixel's
     * distance from the ORIGIN, the middle for the outward effects and the ends for the
     * inward ones, so an out/in pair differs by one subtraction and the halves stay
     * symmetric on any count. */
    case PS_FX_MARQUEE_OUT:
    case PS_FX_MARQUEE_IN: {
        int h = (n + 1) / 2; bool out = (fx == PS_FX_MARQUEE_OUT);
        for (int i = 0; i < n; i++) {
            int half = i < h ? (h - 1 - i) : (i - (n - h));
            float depth = out ? (float)half : (float)(h - 1 - half);
            float d = fabsf(depth - p->split_pos);
            px[i] = mix3(colour, bg, bright100, d > 5.0f ? 0.0f : expf(-(d * d) / 4.5f));
        }
        p->split_pos += reverse ? -0.3f : 0.3f;
        if (p->split_pos >= (float)h) p->split_pos = 0.0f;
        else if (p->split_pos < 0.0f) p->split_pos = (float)h - 1e-6f;
        return ps_fx_period(speed);
    }

    case PS_FX_FILL_OUT:
    case PS_FX_FILL_IN: {
        int h = (n + 1) / 2; bool out = (fx == PS_FX_FILL_OUT);
        for (int i = 0; i < n; i++) {
            int half = i < h ? (h - 1 - i) : (i - (n - h));
            float depth = out ? (float)half : (float)(h - 1 - half);
            float head = p->fill_pos - depth;
            px[i] = mix3(colour, bg, bright100, head >= 1.0f ? 1.0f : (head <= 0.0f ? 0.0f : head));
        }
        p->fill_pos += reverse ? -0.3f : 0.3f;
        if (p->fill_pos >= (float)h + 1.0f) p->fill_pos = 0.0f;       /* seen FULL for a moment before it resets */
        else if (p->fill_pos < 0.0f)        p->fill_pos = (float)h + 1.0f;
        return ps_fx_period(speed);
    }

    case PS_FX_BOUNCE_OUT:
    case PS_FX_BOUNCE_IN: {
        int h = (n + 1) / 2; bool out = (fx == PS_FX_BOUNCE_OUT);
        float pos = reverse ? (float)(h - 1) - p->sbounce_pos : p->sbounce_pos;
        for (int i = 0; i < n; i++) {
            int half = i < h ? (h - 1 - i) : (i - (n - h));
            float depth = out ? (float)half : (float)(h - 1 - half);
            float d = fabsf(depth - pos);
            px[i] = mix3(colour, bg, bright100, d > 5.0f ? 0.0f : expf(-(d * d) / 4.5f));
        }
        p->sbounce_pos += p->sbounce_dir * 0.3f;
        if (p->sbounce_pos >= (float)(h - 1)) { p->sbounce_pos = (float)(h - 1); p->sbounce_dir = -1.0f; }
        else if (p->sbounce_pos <= 0.0f)      { p->sbounce_pos = 0.0f;            p->sbounce_dir = 1.0f; }
        return ps_fx_period(speed);
    }

    case PS_FX_BOUNCE_FILL_OUT:
    case PS_FX_BOUNCE_FILL_IN: {
        int h = (n + 1) / 2; bool out = (fx == PS_FX_BOUNCE_FILL_OUT);
        float base = reverse ? (float)h - p->sfill_pos : p->sfill_pos;
        for (int i = 0; i < n; i++) {
            int half = i < h ? (h - 1 - i) : (i - (n - h));
            float depth = out ? (float)half : (float)(h - 1 - half);
            float head = base - depth;
            px[i] = mix3(colour, bg, bright100, head >= 1.0f ? 1.0f : (head <= 0.0f ? 0.0f : head));
        }
        p->sfill_pos += p->sfill_dir * 0.3f;
        if (p->sfill_pos >= (float)h)  { p->sfill_pos = (float)h; p->sfill_dir = -1.0f; }
        else if (p->sfill_pos <= 0.0f) { p->sfill_pos = 0.0f;     p->sfill_dir = 1.0f; }
        return ps_fx_period(speed);
    }

    /* Three ways to draw one number, the print percentage: a plain bar; the bar with a
     * chase and a breathing tip; a two-colour pole crawling through the bar. They share the
     * fill, the easing and the reversal because they ARE the same number. The shown value
     * chases the reported one, snapping on a big jump so a new print does not spend five
     * seconds draining. The boundary pixel is lit partially so a short strip still resolves
     * single percent steps. */
    case PS_FX_PROGRESS:
    case PS_FX_PROGRESS_ANIM:
    case PS_FX_BARBER: {
        float target = (float)(in && in->percent >= 0 ? (in->percent > 100 ? 100 : in->percent) : 0);
        float delta = target - p->progress_shown;
        if (delta > 25.0f || delta < -25.0f) p->progress_shown = target; else p->progress_shown += delta * 0.15f;
        float lit = p->progress_shown * (float)n / 100.0f;
        if (fx == PS_FX_BARBER && lit < 0.5f) lit = (float)n;          /* a pole with no job fills the run */
        int litn = (int)(lit + 0.5f);
        int w = band; if (w <= 0) w = n / 5; if (w < 1) w = 1; if (w > n) w = n;
        for (int i = 0; i < n; i++) {
            int idx = reverse ? (n - 1 - i) : i;
            float head = lit - (float)i;
            float f = head >= 1.0f ? 1.0f : (head <= 0.0f ? 0.0f : head);
            if (fx == PS_FX_PROGRESS || f <= 0.0f) { px[idx] = mix3(colour, bg, bright100, f); continue; }
            if (fx == PS_FX_BARBER) {
                int bnd = ((i + p->barber_pos) / w) & 1;
                ps_rgba_t c = mix3(colour, bg, bright100, bnd ? 0.0f : 1.0f);
                px[idx] = (f >= 1.0f) ? c : (ps_rgba_t){ (uint8_t)(c.r * f), (uint8_t)(c.g * f), (uint8_t)(c.b * f), 0xFF };
                continue;
            }
            float lv = 0.70f;
            if (litn > 1) { int d = i - p->chase_pos; if (d < 0) d = -d; if (d < 3) { float boost = 0.70f + (float)(3 - d) * 0.10f; lv = boost > 1.0f ? 1.0f : boost; } }
            if (i == litn - 1) { float ph = (float)(p->anim_breath & 63) / 63.0f; float w2 = ph < 0.5f ? (ph * 2.0f) : ((1.0f - ph) * 2.0f); lv = 0.65f + w2 * 0.35f; }
            if (lv > f) lv = f;
            px[idx] = mix3(colour, bg, bright100, lv);
        }
        if (fx == PS_FX_PROGRESS_ANIM) { p->chase_pos = (p->chase_pos + 1) % (litn < 1 ? 1 : litn); ++p->anim_breath; }
        else if (fx == PS_FX_BARBER)   { p->barber_pos = (p->barber_pos + 1) % (w * 2); }
        return ps_fx_period(speed);
    }

    /* the temperature as a colour: the inactive colour at the cold end, the active at the
     * hot end, exact beyond either end so they stay readable; no reading holds the cold colour */
    case PS_FX_TEMP_GRADIENT: {
        int lo = in ? in->temp_lo : 0, hi = in ? in->temp_hi : 0;
        if (hi <= lo) hi = lo + 1;
        int tC = in ? in->temp_c : -1000;
        float f = (tC < lo) ? 0.0f : (tC >= hi) ? 1.0f : (float)(tC - lo) / (float)(hi - lo);
        for (int i = 0; i < n; i++) px[i] = mix3(colour, bg, bright100, f);
        return ps_fx_period(speed);
    }

    /* the print as a colour: the whole strip one colour, from the unlit colour at 0% to the
     * lit colour at 100%, interpolated by hue the short way round so the ramp passes through
     * the wheel rather than through grey. With no unlit colour set the ramp starts a third
     * of the wheel behind the lit colour, which puts red before green and blue before red.
     * With no reading it holds the start, because a print that has not reported is not done. */
    case PS_FX_PROGRESS_HUE: {
        float h1, s1, v1, h0, s0, v0;
        rgb_to_hsv(colour, &h1, &s1, &v1);
        if (bg.r || bg.g || bg.b) rgb_to_hsv(bg, &h0, &s0, &v0); else { h0 = h1 - 120.0f; s0 = s1; v0 = v1; }
        int pc = in && in->percent >= 0 ? (in->percent > 100 ? 100 : in->percent) : 0;
        float f = pc / 100.0f;
        float dh = h1 - h0;
        while (dh > 180.0f) dh -= 360.0f;
        while (dh < -180.0f) dh += 360.0f;
        ps_rgba_t c = hsv_to_rgb(h0 + dh * f, s0 + (s1 - s0) * f, v0 + (v1 - v0) * f);
        ps_rgba_t o = { chan(c.r, bright100), chan(c.g, bright100), chan(c.b, bright100), 0xFF };
        for (int i = 0; i < n; i++) px[i] = o;
        return ps_fx_period(speed);
    }

    /* the hue wheel spread across the run, scrolling; also the answer to an unknown id */
    case PS_FX_RAINBOW:
    default: {
        for (int i = 0; i < n; i++) {
            int ri = reverse ? (n - 1 - i) : i;
            float hue = p->rainbow_phase + (360.0f * (float)ri) / (float)n;
            ps_rgba_t h = hsv_full((uint16_t)hue % 360);
            px[i] = (ps_rgba_t){ chan(h.r, bright100), chan(h.g, bright100), chan(h.b, bright100), 0xFF };
        }
        p->rainbow_phase += RAINBOW_DELTA;
        if (p->rainbow_phase >= 360.0f) p->rainbow_phase -= 360.0f;
        return ps_fx_period(speed);
    }
    }
}
