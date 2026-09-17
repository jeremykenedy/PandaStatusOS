#!/usr/bin/env node
'use strict';
/*
 * Contrast harness. Every page, both themes, both widths, plus the furniture (dialog,
 * toast, fault banner, waiting banner). For every element that shows text it computes
 * the WCAG contrast ratio between the text colour and the ground the text actually
 * sits on, found by compositing every ancestor's background from the document root
 * down. The root ground is read from the document, never assumed.
 *
 * Form fields are checked by their computed colour and ground too: a field's value is
 * not a text node, and nine white slabs down a black page shipped that way once.
 * Field borders are checked against their ground at 3:1 (a boundary, not text).
 *
 * Thresholds: 4.5:1 for text, 3:1 for large text (24px, or 18.66px bold), 3:1 for
 * disabled controls and for boundaries. Dimmed content (an ancestor with opacity below
 * 1, the waiting state) is inactive and skipped.
 *
 * Colours are resolved through a canvas, so color-mix() and every other syntax the
 * browser can compute come back as plain sRGB bytes.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json contrast.js
 */

const pw = require('./pw');
const { t } = pw;

const PAGES = ['dashboard', 'lighting', 'images', 'printer', 'network', 'system', 'logs', 'setup'];
const COMBOS = [
  { theme: 'light', width: 1280 }, { theme: 'dark', width: 1280 },
  { theme: 'light', width: 390 },  { theme: 'dark', width: 390 },
];

// runs in the page
function audit() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const parse = (s) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = s; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
  const over = (top, bot) => { const a = top[3] + bot[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [0, 1, 2].map((i) => (top[i] * top[3] + bot[i] * bot[3] * (1 - top[3])) / a).concat([a]); };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const hex = (c) => '#' + [0, 1, 2].map((i) => Math.round(c[i]).toString(16).padStart(2, '0')).join('') + (c[3] < 1 ? '/' + c[3].toFixed(2) : '');
  const rootBg = parse(getComputedStyle(document.body).backgroundColor);
  const rootBgFinal = rootBg[3] < 1 ? over(rootBg, [255, 255, 255, 1]) : rootBg;

  function ground(el) {
    // composite ancestor backgrounds from the root down, stopping at an opaque one
    const chain = []; let e = el.parentElement;
    while (e) { chain.push(e); e = e.parentElement; }
    let bg = rootBgFinal.slice();
    for (let i = chain.length - 1; i >= 0; i--) {
      const c = parse(getComputedStyle(chain[i]).backgroundColor);
      if (c[3] > 0) bg = over(c, bg);
    }
    return bg;
  }
  function inactive(el) {
    let e = el;
    while (e && e !== document.documentElement) { const cs = getComputedStyle(e); if (parseFloat(cs.opacity) < 0.99 || cs.visibility === 'hidden' || cs.display === 'none') return true; e = e.parentElement; }
    return false;
  }
  function path(el) {
    const parts = []; let e = el, n = 0;
    while (e && e !== document.body && n < 3) { parts.unshift(e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '')); e = e.parentElement; n++; }
    return parts.join(' > ');
  }
  const out = [];
  const seen = new Set();
  const all = document.querySelectorAll('body *');
  for (const el of all) {
    if (['SCRIPT', 'STYLE', 'SVG', 'USE', 'PATH', 'SYMBOL', 'DEFS', 'OPTION', 'PROGRESS', 'IMG'].includes(el.tagName)) continue;
    if (el.closest('svg')) continue;
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    const isField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['range', 'checkbox', 'file', 'radio'].includes(el.type);
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText && !isField) continue;
    if (inactive(el)) continue;
    const key = path(el) + '|' + (hasText ? el.textContent.trim().slice(0, 30) : 'field');
    if (seen.has(key)) continue; seen.add(key);
    const fg0 = parse(cs.color);
    const bg = ground(el);
    const own = parse(cs.backgroundColor);
    const bgEff = own[3] > 0 ? over(own, bg) : bg;
    const fg = fg0[3] < 1 ? over(fg0, bgEff) : fg0;
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const disabled = el.disabled || el.closest('[disabled]') || el.getAttribute('aria-disabled') === 'true';
    const need = disabled ? 3 : large ? 3 : 4.5;
    const r = ratio(fg, bgEff);
    const rec = { path: path(el), text: hasText ? el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40) : (isField ? '[' + el.tagName.toLowerCase() + (el.value ? ' ' + String(el.value).slice(0, 12) : '') + ']' : ''), fg: hex(fg), bg: hex(bgEff), ratio: Math.round(r * 100) / 100, need, kind: isField ? 'field' : 'text', size: Math.round(size), weight };
    if (r < need) out.push(rec);
    if (isField && cs.borderTopStyle !== 'none' && parseFloat(cs.borderTopWidth) > 0) {
      const bc0 = parse(cs.borderTopColor); const bc = bc0[3] < 1 ? over(bc0, bg) : bc0;
      const rb = ratio(bc, bg);
      if (bc0[3] > 0 && rb < 3) out.push({ path: path(el), text: '[border]', fg: hex(bc), bg: hex(bg), ratio: Math.round(rb * 100) / 100, need: 3, kind: 'boundary', size: 0, weight: 0 });
    }
  }
  return { violations: out, checked: seen.size, root: hex(rootBgFinal) };
}

async function run(page, label) {
  const r = await page.evaluate(audit);
  const ok = r.violations.length === 0;
  t(`${label}: ${r.checked} elements on ${r.root}, ${ok ? 'all pass' : r.violations.length + ' fail'}`, ok);
  for (const v of r.violations) console.log(`        ${v.kind} ${v.ratio}:1 (need ${v.need}) ${v.fg} on ${v.bg} ${v.size}px/${v.weight}  ${v.path}  "${v.text}"`);
  return r;
}

(async () => {
  const browser = await pw.launch();
  try {
    for (const combo of COMBOS) {
      const tag = `${combo.theme}/${combo.width}`;
      console.log(`\n== ${tag}`);
      await pw.resetMock();
      const { ctx, page } = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#dashboard' });
      for (const p of PAGES) {
        await page.evaluate((h) => { location.hash = '#' + h; }, p);
        await pw.waitCard(page, p);
        await run(page, `${tag} ${p}`);
      }
      // the furniture: dialog with two buttons, the toast, the fault banner
      /* The page's own helpers, not a PS namespace: that object belonged to the old UI and
         this one puts dialog_open and toast_show on the window directly. */
      await page.evaluate(() => { show_card('status'); dialog_open('ui_restart_title', 'ui_restart_text', [{ key: 'ui_ok', fallback: 'OK' }, { key: 'cancel', fallback: 'Cancel' }]); });
      await run(page, `${tag} dialog`);
      await page.evaluate(() => { document.getElementById('ps-dialog').close(); toast_show('ui_settings_restored', 60000); });
      await run(page, `${tag} toast and fault banner`);
      await ctx.close();
      // the waiting state: no push, so the banner shows and the content is dimmed (skipped)
      await pw.knob('PS_NO_PUSH', '1');
      const w = await pw.open(browser, { theme: combo.theme, width: combo.width, hash: '#dashboard', waitForState: false });
      await w.page.waitForSelector('#ps-banner-waiting', { state: 'visible', timeout: 3000 }).catch(() => {});
      await run(w.page, `${tag} waiting state`);
      await w.ctx.close();
      await pw.knob('PS_NO_PUSH', '0');
    }
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('harness ran to the end', false);
  } finally {
    await browser.close();
  }
  process.exit(pw.verdict());
})();
