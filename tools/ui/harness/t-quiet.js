#!/usr/bin/env node
'use strict';
/*
 * quietload: a cold load, then every page, writes nothing to the console.
 *
 * The vent's harness of this name exists because a page that logs on a clean load has
 * something to say that nobody is reading: a probe that failed, a handler that threw and was
 * caught, a resource that was not there. Every one of those is a fault that the other
 * harnesses only notice when it happens to break the thing they were measuring. This one
 * listens to everything: console output of every type, page errors, requests that failed to
 * complete, and any response of 400 or worse. With every switch on, so every module has work
 * to do, in both themes and at both widths, through every page.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-quiet.js PS_CLONE=1
 *   tools/ui/harness/run.sh p2-printing.json t-quiet.js PS_CLONE=1 PS_PRINT_PERCENT=37
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
      for (const width of [1280, 360]) {
        const ctx = await browser.newContext({ viewport: { width, height: width < 700 ? 844 : 800 }, colorScheme: theme });
        await ctx.addInitScript((th) => { try { localStorage.setItem('ps_theme', th); } catch (e) {} }, theme);
        const page = await ctx.newPage();
        const spoke = [], threw = [], failed = [], refused = [];
        page.on('console', (m) => spoke.push(m.type() + ': ' + m.text()));
        page.on('pageerror', (e) => threw.push(String(e)));
        page.on('requestfailed', (r) => failed.push(r.url().replace(pw.BASE, '') + ' ' + ((r.failure() || {}).errorText || '')));
        page.on('response', (r) => { if (r.status() >= 400) refused.push(r.status() + ' ' + r.url().replace(pw.BASE, '')); });

        const t0 = Date.now();
        await page.goto(`${pw.BASE}/`);
        const landed = await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 }).then(() => true).catch(() => false);
        const ms = Date.now() - t0;
        await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
        for (const c of CARDS) {
          await page.evaluate((n) => show_card(n), c);
          await pw.waitCard(page, c);
          await pw.sleep(250);
        }
        await pw.sleep(2500);                 /* two rounds of every poll the open cards run */

        const tag = `${theme}/${width}`;
        t(`${tag}: the page landed, in ${ms} ms`, landed, ms);
        t(`${tag}: nothing was written to the console`, spoke.length === 0, spoke.slice(0, 6));
        t(`${tag}: nothing threw`, threw.length === 0, threw.slice(0, 3));
        t(`${tag}: every request completed`, failed.length === 0, failed.slice(0, 6));
        t(`${tag}: nothing was answered 400 or worse`, refused.length === 0, refused.slice(0, 6));
        await ctx.close();
      }
    }
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
