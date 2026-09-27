#!/usr/bin/env node
'use strict';
/*
 * layout, navsize, align, coldstart: the page's shape, on both widths and in both themes.
 *
 * Four of the vent's harness classes, one file, because they ask the same page the same
 * kind of question and read the answer off the same geometry:
 *
 *   layout     nothing on any card is wider than the screen, and the document does not
 *              scroll sideways. A phone that has to be panned to read a value is the fault
 *              that every other harness here, measuring one element at a time, walks past.
 *   navsize    the seven entries of the rail and of the bottom bar are the same size as each
 *              other, so the one a thumb lands on is the one it aimed at.
 *   align      the card titles on a page share a left edge (one column on a phone, up to three
 *              on a desktop), which is what makes a page read as a page and not as a pile.
 *   coldstart  from navigation to the first state on screen in under 2.5 s against a mock that
 *              answers at once, with exactly one card active and the top bar in place.
 *
 * Every switch on, so every card that can be on the page is measured.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-layout.js PS_CLONE=1
 */
const pw = require('./pw');
const { t } = pw;

const CARDS = ['status', 'theme', 'settings', 'printer', 'sta', 'ap', 'logs'];

(async () => {
  const browser = await pw.launch();
  try {
    const names = await (await fetch(`${pw.BASE}/api/features`)).json().then((d) => Object.keys(d.features || {}));
    const all = {}; for (const n of names) all[n] = true;
    await fetch(`${pw.BASE}/api/features`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features: all }) });

    for (const theme of ['light', 'dark']) {
      for (const width of [360, 1280]) {
        const tag = `${theme}/${width}`;
        const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 780 : 800 }, colorScheme: theme });
        await ctx.addInitScript((th) => { try { localStorage.setItem('ps_theme', th); } catch (e) {} }, theme);
        const page = await ctx.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));

        /* coldstart */
        const t0 = Date.now();
        await page.goto(`${pw.BASE}/`);
        const landed = await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 }).then(() => true).catch(() => false);
        const ms = Date.now() - t0;
        const first = await page.evaluate(() => {
          const bar = document.getElementById('ps-top-bar');
          const r = bar ? bar.getBoundingClientRect() : null;
          const active = [...document.querySelectorAll('[data-card].active')].map((c) => c.id);
          return { bar: !!r && r.height > 0 && r.top <= 1, active };
        });
        t(`${tag}: coldstart, the first state is on screen in ${ms} ms with the top bar in place and one card active`,
          landed && ms < 2500 && first.bar && first.active.length === 1, { ms, first });
        await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });

        /* navsize */
        const nav = await page.evaluate(() => {
          const pick = (sel) => [...document.querySelectorAll(sel)].map((a) => a.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
          const rail = pick('#ps-nav [data-nav]'), bottom = pick('nav.bottom [data-nav]');
          const same = (rs) => rs.length >= 7 && rs.every((r) => Math.abs(r.width - rs[0].width) <= 1 && Math.abs(r.height - rs[0].height) <= 1);
          return { rail: rail.length, bottom: bottom.length, railSame: same(rail), bottomSame: same(bottom),
                   railBox: rail[0] ? [Math.round(rail[0].width), Math.round(rail[0].height)] : null,
                   bottomBox: bottom[0] ? [Math.round(bottom[0].width), Math.round(bottom[0].height)] : null };
        });
        if (width < 700) t(`${tag}: navsize, the bottom bar shows all seven entries at one size (${nav.bottomBox}) and the rail is away`, nav.bottomSame && nav.rail === 0, nav);
        else t(`${tag}: navsize, the rail shows all seven entries at one size (${nav.railBox}) and the bottom bar is away`, nav.railSame && nav.bottom === 0, nav);

        /* layout and align, card by card */
        for (const card of CARDS) {
          await page.evaluate((n) => show_card(n), card);
          await pw.waitCard(page, card);
          await pw.sleep(250);
          const r = await page.evaluate((maxCols) => {
            const W = window.innerWidth;
            const doc = document.documentElement;
            const offenders = [];
            const seen = (e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; };
            const name = (e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
            for (const e of document.body.querySelectorAll('*')) {
              if (!seen(e)) continue;
              const b = e.getBoundingClientRect();
              if (b.width <= 0 || b.height <= 0) continue;
              /* a select's own popup and an overflowing scroll region are their own business */
              if (e.closest('[data-card]') && !e.closest('[data-card].active')) continue;
              if (b.right > W + 1 || b.left < -1) offenders.push(name(e) + ' ' + Math.round(b.left) + '..' + Math.round(b.right));
              if (offenders.length >= 6) break;
            }
            /* Two kinds of card, two edges: a list card (article.no-padding) wears its title as
               an overline flush with its own edge, a padded card indents it with the rest of
               its content. Within a kind the titles share an edge per column; a title in a
               hidden card has no box and is not counted. */
            const groups = { list: [], padded: [] };
            for (const h of document.querySelectorAll('[data-card].active .card-title')) {
              const b = h.getBoundingClientRect();
              if (b.width <= 0 || b.height <= 0) continue;
              const art = h.closest('article');
              (art && art.classList.contains('no-padding') ? groups.list : groups.padded).push(Math.round(b.left));
            }
            const lefts = {};
            let ok = true, titles = 0;
            for (const k of Object.keys(groups)) {
              titles += groups[k].length;
              lefts[k] = [...new Set(groups[k])].sort((a, b) => a - b);
              if (lefts[k].length > maxCols) ok = false;
            }
            return { scrollW: doc.scrollWidth, W, offenders, titles, lefts, ok: ok && titles > 0 };
          }, width < 700 ? 1 : 3);
          t(`${tag} ${card}: layout, nothing wider than the screen (${r.scrollW} <= ${r.W})`, r.scrollW <= r.W && r.offenders.length === 0, r.offenders);
          t(`${tag} ${card}: align, ${r.titles} card titles on one edge per kind and column`, r.ok, r.lefts);
        }
        t(`${tag}: no page errors`, errors.length === 0, errors);
        await ctx.close();
      }
    }

    /* columns: the dashboard's wall stays at two columns however wide the screen, where
       the other pages go to three from 1360 up (project.css, the multicol block). Read off
       the computed style, so a rule that stops matching is caught, not just a wall that
       happened to balance into two. */
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(`${pw.BASE}/`);
      await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 }).catch(() => {});
      const cols = {};
      for (const card of ['status', 'settings', 'theme']) {
        await page.evaluate((n) => show_card(n), card);
        await pw.waitCard(page, card);
        cols[card] = await page.evaluate(() => {
          const s = getComputedStyle(document.querySelector('[data-card].active'));
          const lefts = new Set([...document.querySelectorAll('[data-card].active article:not(.no-padding) .card-title')]
            .map((h) => h.getBoundingClientRect()).filter((b) => b.width > 0).map((b) => Math.round(b.left)));
          return { count: s.columnCount, edges: lefts.size };
        });
      }
      t(`1440 status: columns, the dashboard wall is two columns wide, not three (${cols.status.count}, ${cols.status.edges} title edge(s))`,
        cols.status.count === '2' && cols.status.edges <= 2, cols.status);
      t(`1440 settings: columns, the other pages still go to three (${cols.settings.count}, ${cols.theme.count})`,
        cols.settings.count === '3' && cols.theme.count === '3', { settings: cols.settings, theme: cols.theme });
      await ctx.close();
    }
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
