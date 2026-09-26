#!/usr/bin/env node
'use strict';
/*
 * Contrast measured from the PIXELS THAT ARE PAINTED, not from the CSS.
 *
 * contrast.js computes what the rules say: it reads each element's colour and composites its
 * ancestors' backgrounds. That is the right way to find a rule that is wrong, and it is blind
 * to everything that only exists once the page has been drawn. A gradient behind text. A
 * translucent plate. A shadow. An icon painted the colour of its own ground. Glyphs under
 * something with a z-index. A colour baked into an image no stylesheet can reach. A property
 * is what the page was told; a pixel is what the owner saw, and when the two can disagree the
 * only honest thing to do is screenshot it.
 *
 * Every region is then re-measured through protanopia, deuteranopia and tritanopia, because a
 * pair that passes in sRGB and collapses for one in twelve men is still a pair nobody can read.
 *
 * There is no low-end escape here. A box that owns a text node and shows no variation at all
 * is not "nothing to measure": it is glyphs painted the colour of the ground, which is the
 * worst thing this can find. On the sibling project an escape hatch at 1.2:1 hid exactly that,
 * twice, on a page nobody looks at twice. What IS exempt is each case where text genuinely is
 * not painted in the box, named one at a time below.
 *
 *   tools/ui/harness/run.sh p2-idle.json pixels.js
 *   PS_PIXELS_DEBUG=1 tools/ui/harness/run.sh p2-idle.json pixels.js     region counts per shot
 */
const pw = require('./pw');
const { t } = pw;
const { decode } = require('./png');

/* The seven cards this page has. Not the eight names contrast.js was asking for, six of
   which are not cards here at all. */
const PAGES = ['status', 'theme', 'printer', 'sta', 'ap', 'settings', 'logs'];
const VIEWS = [{ width: 1280, height: 900 }, { width: 390, height: 844 }];
const THEMES = ['light', 'dark'];

const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const l = [lum(a), lum(b)].sort((x, y) => y - x); return (l[0] + 0.05) / (l[1] + 0.05); };

/* The three dichromacies, as sRGB-linear matrices. */
const M = {
  protanopia:   [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deuteranopia: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.011820, 0.042940, 0.968881]],
  tritanopia:   [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.303900]],
};
const toS = (v) => { v = Math.max(0, Math.min(1, v)); return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055); };
const sim = (c, k) => { const [r, g, b] = c.map(lin), m = M[k]; return [0, 1, 2].map((i) => toS(m[i][0] * r + m[i][1] * g + m[i][2] * b)); };

/* Inside a line of text the darkest and lightest pixels ARE the glyph and its ground: text is
   the only thing that makes an area that size both.
   
   Not the absolute darkest and lightest, though. Two per cent is trimmed off each end, because
   a line box can clip the corner of the card it sits in: three white pixels out of twelve
   hundred, at the very edge of the run, were enough to report a box painted uniformly grey as
   3.90:1. Glyph ink is never two per cent of its own line, so nothing a reader could see is
   trimmed by this, and a box whose text IS its ground still comes back at 1.00:1 because every
   percentile of it is the same colour. */
const TRIM = 0.02;
function extremes(img, x0, y0, x1, y1) {
  const px = [];
  for (let y = Math.max(0, y0 | 0); y < Math.min(img.h, y1 | 0); y++) {
    for (let x = Math.max(0, x0 | 0); x < Math.min(img.w, x1 | 0); x++) {
      const i = (y * img.w + x) * img.ch;
      const c = [img.data[i], img.data[i + 1], img.data[i + 2]];
      px.push([lum(c), c]);
    }
  }
  if (!px.length) return { lo: null, hi: null };
  px.sort((a, b) => a[0] - b[0]);
  const k = Math.floor(px.length * TRIM);
  return { lo: px[k][1], hi: px[px.length - 1 - k][1] };
}

/* Runs in the page: every element that owns text, with the box it occupies and the reasons it
   might hold no visible glyphs. */
function collect() {
  const out = [];
  const overlays = [...document.querySelectorAll('*')].filter((o) => {
    const os = getComputedStyle(o);
    return (os.position === 'fixed' || os.position === 'sticky') && os.display !== 'none' && os.visibility !== 'hidden';
  });
  document.querySelectorAll('*').forEach((el) => {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    /* On screen whole. A half-scrolled box reads pixels from whatever is above or below it,
       which is not this element's contrast. */
    if (r.top < 0 || r.bottom > window.innerHeight || r.left < 0 || r.right > window.innerWidth) return;
    /* Under a fixed or sticky overlay the pixels belong to the overlay. The top bar here is
       sticky and scrolled content passes beneath it; measuring through it compares two
       unrelated things and reports the loser. */
    if (overlays.some((o) => {
      if (o === el || o.contains(el)) return false;
      const b = o.getBoundingClientRect();
      return b.width > 0 && b.height > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
    })) return;

    const size = parseFloat(st.fontSize);
    const bold = parseInt(st.fontWeight, 10) >= 700;
    let eff = 1;
    for (let n = el; n; n = n.parentElement) eff *= parseFloat(getComputedStyle(n).opacity || '1');
    /* -webkit-text-fill-color beats `color` and is how gradient text is done: the glyphs are
       a window onto a background clipped to them, so there is no glyph colour to measure. That
       is only true when something IS clipped to the text. Transparent glyphs with no such
       background are not a gradient, they are invisible text, and exempting those would have
       been an escape hatch over the worst fault this harness can find. */
    let fill = 1;
    const m = /rgba?\(([^)]+)\)/.exec(st.webkitTextFillColor || st.color || '');
    if (m) { const q = m[1].split(',').map(Number); fill = q.length > 3 ? q[3] : 1; }
    const clipText = (st.webkitBackgroundClip === 'text' || st.backgroundClip === 'text');
    let clipped = false;
    for (let n = el.parentElement; n && !clipped; n = n.parentElement) {
      const os = getComputedStyle(n);
      if (os.overflow === 'visible' && os.overflowX === 'visible' && os.overflowY === 'visible') continue;
      const b = n.getBoundingClientRect();
      if (r.right <= b.left + 1 || r.left >= b.right - 1 || r.bottom <= b.top + 1 || r.top >= b.bottom - 1) clipped = true;
    }
    /* One record per LINE OF TEXT, taken from a range over the element's own text nodes,
       rather than one per element box.
       
       Two reasons, both of which cost real findings. An element that breaks across columns in
       the wall has a bounding rect that is the UNION of its pieces, so the gap between them
       belongs to a neighbour and its text gets measured against this element's ground. And a
       label in a wide box leaves most of that box empty: a card's rounded corner showing two
       dozen pixels of the page behind it was enough to move the measurement by half a ratio,
       because the lightest pixel in a box does not care how few of them there are.
       
       A range's rects are the lines the glyphs actually occupy. */
    const rects = [];
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange();
      rg.selectNodeContents(n);
      for (const q of rg.getClientRects()) rects.push(q);
    }
    const on = rects.filter((q) => q.width >= 8 && q.height >= 8
      && q.top >= 0 && q.bottom <= window.innerHeight && q.left >= 0 && q.right <= window.innerWidth);
    for (const q of on) {
      out.push({
        label: (el.id || el.className || el.tagName).toString().slice(0, 40),
        text: el.textContent.trim().replace(/\s+/g, ' ').slice(0, 34),
        css: st.color, opacity: st.opacity, eff, fill, clipText, size, clipped,
        /* WCAG 1.4.3 exempts text that is part of an inactive component, which is what Beer's
           0.5 on a disabled field means. It is not a blanket opacity escape: the element has
           to actually be inside something switched off. */
        inactive: !!el.closest('[disabled], [aria-disabled="true"], .field:has(> [disabled])'),
        x: q.left, y: q.top, w: q.width, h: q.height,
        need: (size >= 24 || (size >= 18.66 && bold)) ? 3 : 4.5,
      });
    }
  });
  return out;
}

/* The control sample.
 *
 * Everything below reports that the page is fine, which is also what a broken screenshot, a
 * misread PNG, an empty region list or an off-by-one in the box coordinates would report. So
 * before measuring anything, one real element on the page is painted grey on grey and the whole
 * pipeline is asked to find it. If it cannot, nothing else in this file means anything and the
 * run says so instead of passing. */
async function canary(page) {
  const box = await page.evaluate(() => {
    /* A LEAF with text in it. A wrapper would do the wrong thing twice over: its box contains
       its children's glyphs, so painting it grey hides the sample behind their own backgrounds
       and the extremes come back as the page's real contrast, which reads as the sample
       passing when the sample was never applied. */
    const el = [...document.querySelectorAll('#ps-card-status *')].find((e) => {
      if (e.children.length) return false;
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)) return false;
      const r = e.getBoundingClientRect();
      return r.width > 40 && r.height > 10 && r.top > 0 && r.bottom < window.innerHeight;
    });
    if (!el) return null;
    el.setAttribute('data-canary', '1');
    /* important, because the stylesheets use it: a plain inline colour lost the cascade and
       the control sample came back reading the page's real contrast, which looked like a pass
       of the sample and was the sample not being applied at all. */
    el.style.setProperty('background', '#808080', 'important');
    el.style.setProperty('color', '#808080', 'important');
    /* The line the glyphs are on, not the element's box: the box is the width of the card and
       its rounded corner shows the page behind it, which is enough white to hide the sample. */
    const rg = document.createRange();
    rg.selectNodeContents([...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()));
    const r = rg.getClientRects()[0] || el.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height, text: el.textContent.trim().slice(0, 24) };
  });
  if (!box) { t('the control sample: an element to paint over was found', false); return; }
  await page.waitForTimeout(150);
  const img = decode(await page.screenshot({ fullPage: false }));
  const { lo, hi } = extremes(img, box.x + 1, box.y + 1, box.x + box.w - 1, box.y + box.h - 1);
  const r = lo && hi ? ratio(lo, hi) : 99;
  t(`the control sample: grey text on its own grey is seen as ${r.toFixed(2)}:1 and would fail`,
    r < 1.5, { text: box.text, box, lo, hi, ratio: r });
  await page.evaluate(() => {
    const el = document.querySelector('[data-canary]');
    if (el) { el.style.removeProperty('background'); el.style.removeProperty('color'); el.removeAttribute('data-canary'); }
  });
  await page.waitForTimeout(150);
  const img2 = decode(await page.screenshot({ fullPage: false }));
  const e2 = extremes(img2, box.x + 1, box.y + 1, box.x + box.w - 1, box.y + box.h - 1);
  const r2 = e2.lo && e2.hi ? ratio(e2.lo, e2.hi) : 0;
  t(`and the same box reads ${r2.toFixed(2)}:1 once the page has it back`, r2 >= 4.5, { ratio: r2 });
}

(async () => {
  const browser = await pw.launch();
  let regionsSeen = 0;
  const bad = [];
  try {
    for (const view of VIEWS) {
      for (const theme of THEMES) {
        await pw.resetMock();
        const { ctx, page } = await pw.open(browser, { theme, width: view.width, hash: '#status' });
        /* The theme this row asked for has to be the theme on the page. It was not, for as
           long as contrast.js has existed: the page kept its preference under the sibling
           project's key, so every dark row measured the light theme against itself. */
        /* The fixture's own rebind dialog is up on load and covers the middle of the page.
           Measuring through it compares one card's text with another card's ground and, worse,
           hides the control sample behind it. contrast.js has rows of its own for the dialog;
           this file is about the pages underneath it. */
        await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
        const on = await page.evaluate(() => document.body.className);
        t(`${theme}/${view.width}: the page is wearing the theme this row asked for`,
          on.split(/\s+/).indexOf(theme) >= 0, on);
        if (theme === THEMES[0] && view === VIEWS[0]) await canary(page);

        for (const name of PAGES) {
          await page.evaluate((h) => show_card(h), name);
          if (!await pw.waitCard(page, name)) { t(`${theme}/${view.width}/${name}: the page came up`, false); continue; }
          const maxY = await page.evaluate(() => document.documentElement.scrollHeight);
          const step = Math.floor(view.height * 0.8);
          for (let sy = 0; sy < Math.max(1, maxY - view.height * 0.2); sy += step) {
            await page.evaluate((y) => window.scrollTo(0, y), sy);
            await page.waitForTimeout(120);
            const where = `${theme}/${view.width}/${name}@${sy}`;
            const regions = await page.evaluate(collect);
            regionsSeen += regions.length;
            if (process.env.PS_PIXELS_DEBUG) {
              console.log(`   [${where}] ${regions.length} regions`);
            }
            /* While the page is on screen anyway: nothing painted may read as a raw key, as
               `undefined`, as `null` or as `NaN`. tr() falls back to the key itself, so a
               string the table has lost shows up as ui_something_or_other and looks, to a
               harness measuring contrast, exactly like a sentence. Two hundred keys were
               dropped from the table in one go; this is what would have caught a wrong one. */
            const junk = await page.evaluate(() => {
              const out = [];
              const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
              for (let n = w.nextNode(); n; n = w.nextNode()) {
                const s = (n.textContent || '').trim();
                if (!s) continue;
                const el = n.parentElement;
                if (!el || !el.getBoundingClientRect().width) continue;
                if (/^[a-z][a-z0-9]*(_[a-z0-9]+){2,}$/.test(s)) out.push(s);
                else if (/\b(undefined|NaN)\b/.test(s)) out.push(s);
              }
              return out.slice(0, 8);
            });
            if (junk.length) t(`${where}: nothing painted reads as a key or as undefined`, false, junk);

            const img = decode(await page.screenshot({ fullPage: false }));
            for (const r of regions) {
              if (r.eff < 0.01) continue;      /* transparent up the chain: not painted at all */
              if (r.fill === 0 && r.clipText) continue;   /* gradient text: the glyphs are a window */
              if (r.size === 0) continue;      /* font-size 0: hidden from sight, not from readers */
              if (r.clipped) continue;         /* an ancestor's overflow cropped the glyphs away */
              if (r.inactive) continue;        /* inside a control the page has switched off */
              /* The em dash on its own is this project's "never reported" mark. It is one
                 horizontal hairline: at 13px it is a single row of pixels, and where that row
                 lands between two device pixels the renderer splits it in two and neither half
                 ever reaches the colour it was asked for. What comes back is the anti-aliasing,
                 not the design, and it moves by a tenth of a ratio between runs. The mark's
                 SPECIFIED colour is checked where specified colours belong, which is
                 contrast.js, on every one of these elements. */
              if (r.text === '\u2014') continue;
              const { lo, hi } = extremes(img, r.x + 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1);
              if (!lo || !hi) continue;
              const plain = ratio(lo, hi);
              const cvd = {};
              for (const k of Object.keys(M)) cvd[k] = ratio(sim(lo, k), sim(hi, k));
              const worst = Math.min(plain, ...Object.values(cvd));
              if (worst < r.need) bad.push({ r, plain, cvd, worst, lo, hi, where });
            }
          }
        }
        await ctx.close();
      }
    }

    /* One region can be the same fault seen from four rows; the count that matters is how many
       distinct ones there are, and every one of them is printed. */
    const seen = new Set();
    const distinct = bad.filter((x) => {
      const k = `${x.r.label}|${x.r.css}|${x.r.opacity}|${x.lo.map(Math.round)}|${x.hi.map(Math.round)}`;
      if (seen.has(k)) return false; seen.add(k); return true;
    });
    console.log(`\n${regionsSeen} painted text regions across ${VIEWS.length} widths x both themes x ${PAGES.length} pages, scrolled`);
    t('every painted text region meets its threshold, plain and through all three CVD simulations',
      distinct.length === 0, `${bad.length} failing regions, ${distinct.length} distinct`);
    for (const x of distinct) {
      console.log(`        [${x.where}] ${x.r.label}  "${x.r.text}"  css ${x.r.css} @${x.r.opacity}`);
      console.log(`          darkest rgb(${x.lo.map(Math.round)})  lightest rgb(${x.hi.map(Math.round)})  need ${x.r.need}`);
      console.log(`          plain ${x.plain.toFixed(2)}  prot ${x.cvd.protanopia.toFixed(2)}  deut ${x.cvd.deuteranopia.toFixed(2)}  trit ${x.cvd.tritanopia.toFixed(2)}`);
    }
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
