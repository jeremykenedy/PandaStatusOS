#!/usr/bin/env node
'use strict';
/*
 * cursors, fontcheck, marks: the chrome as it actually renders, in both themes.
 *
 *   cursors    everything that can be pressed says so with the pointer, and nothing that is
 *              disabled does. Read from the computed style of every visible control on every
 *              card, which is the only place the answer lives.
 *   fontcheck  the page's own face is the one on screen: the embedded Roboto loaded (every
 *              face the document holds is loaded or unused, none errored) and a request for it
 *              is honoured rather than substituted.
 *   marks      the mark for this theme is a real picture (decoded, with a width) and the other
 *              theme's is away; every icon on the page points at a symbol the sprite carries,
 *              so no button is a blank square; the theme button cycles its three states and
 *              its icon says which one it is in.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-chrome.js PS_CLONE=1
 */
const pw = require('./pw');
const { t } = pw;

const CARDS = ['status', 'theme', 'settings', 'printer', 'sta', 'ap', 'logs'];
const PRESSABLE = 'button, a[href], a[role="link"], [role="button"], label.switch, label.checkbox, label.radio';

(async () => {
  const browser = await pw.launch();
  try {
    const names = await (await fetch(`${pw.BASE}/api/features`)).json().then((d) => Object.keys(d.features || {}));
    const all = {}; for (const n of names) all[n] = true;
    await fetch(`${pw.BASE}/api/features`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features: all }) });

    for (const theme of ['light', 'dark']) {
      const { ctx, page, errors } = await pw.open(browser, { theme, width: 1280, hash: '#status' });
      await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });

      /* fontcheck */
      const fonts = await page.evaluate(async () => {
        await document.fonts.ready;
        const faces = [...document.fonts].map((f) => ({ family: f.family.replace(/"/g, ''), weight: f.weight, status: f.status }));
        return { faces, roboto: document.fonts.check('16px Roboto'), status: document.fonts.status };
      });
      const errored = fonts.faces.filter((f) => f.status === 'error');
      const loaded = fonts.faces.filter((f) => f.status === 'loaded' && f.family === 'Roboto');
      t(`${theme}: fontcheck, the document's faces are ready (${fonts.faces.length} faces, ${loaded.length} Roboto loaded, none errored)`,
        fonts.status === 'loaded' && errored.length === 0 && loaded.length >= 1, { errored, faces: fonts.faces.slice(0, 6) });
      t(`${theme}: fontcheck, a request for Roboto is honoured`, fonts.roboto === true, fonts.roboto);

      /* marks */
      const marks = await page.evaluate((th) => {
        const pick = (sel) => { const e = document.querySelector(sel); if (!e) return null; const s = getComputedStyle(e); return { shown: s.display !== 'none' && s.visibility !== 'hidden' && e.getBoundingClientRect().width > 0, complete: e.complete, w: e.naturalWidth }; };
        return { light: pick('.ux_mark_light'), dark: pick('.ux_mark_dark') };
      }, theme);
      const mine = marks[theme], other = marks[theme === 'light' ? 'dark' : 'light'];
      t(`${theme}: marks, this theme's mark is a decoded picture on screen and the other theme's is away`,
        !!mine && mine.shown && mine.complete && mine.w > 0 && !!other && !other.shown, marks);

      const sprite = await page.evaluate(() => {
        const missing = new Set(), used = new Set();
        for (const u of document.querySelectorAll('use')) {
          const href = u.getAttribute('href') || u.getAttribute('xlink:href') || '';
          if (!href.startsWith('#')) { missing.add(href || '(none)'); continue; }
          used.add(href);
          const sym = document.getElementById(href.slice(1));
          if (!sym || sym.tagName.toLowerCase() !== 'symbol') missing.add(href);
        }
        return { used: used.size, missing: [...missing] };
      });
      t(`${theme}: marks, every icon points at a symbol the sprite carries (${sprite.used} distinct)`, sprite.missing.length === 0, sprite.missing);

      /* the theme button: three states, three icons, and back where it started */
      const cycle = [];
      for (let i = 0; i < 4; i++) {
        cycle.push(await page.evaluate(() => ({ icon: document.querySelector('#ps-top-theme-icon use').getAttribute('href'), body: document.body.className.split(/\s+/).filter((c) => c === 'light' || c === 'dark').join('') })));
        if (i < 3) { await page.click('#ps-top-theme'); await pw.sleep(150); }
      }
      const icons = new Set(cycle.slice(0, 3).map((c) => c.icon));
      t(`${theme}: marks, the theme button cycles three states with three icons and comes back round`,
        icons.size === 3 && cycle[3].icon === cycle[0].icon && cycle[3].body === cycle[0].body, cycle);

      /* cursors, card by card */
      for (const card of CARDS) {
        await page.evaluate((n) => show_card(n), card);
        await pw.waitCard(page, card);
        await pw.sleep(200);
        const r = await page.evaluate((sel) => {
          const bad = [], ok = [];
          const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
          for (const e of document.querySelectorAll(sel)) {
            const b = e.getBoundingClientRect();
            if (b.width <= 0 || b.height <= 0) continue;
            if (e.closest('[data-card]') && !e.closest('[data-card].active')) continue;
            const cur = getComputedStyle(e).cursor;
            const disabled = e.disabled || e.getAttribute('aria-disabled') === 'true' || (e.querySelector && e.querySelector('input') && e.querySelector('input').disabled);
            if (disabled) { if (cur === 'pointer') bad.push(name(e) + ' disabled but pointer'); else ok.push(1); continue; }
            if (cur !== 'pointer') bad.push(name(e) + ' ' + cur); else ok.push(1);
          }
          return { bad: bad.slice(0, 8), nbad: bad.length, nok: ok.length };
        }, PRESSABLE);
        t(`${theme} ${card}: cursors, ${r.nok} pressable things show the pointer and nothing disabled does`, r.nbad === 0 && r.nok > 0, r.bad);
      }
      t(`${theme}: no page errors, no console errors`, errors.length === 0, errors);
      await ctx.close();
    }
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
