#!/usr/bin/env node
'use strict';
/*
 * A static page with everything on it at once, for laying things out.
 *
 * Working on a card means driving the mock device: start it, open a browser, navigate to the
 * page, turn on whatever switch the card is behind, wait for the socket to fill it in. That is
 * the right way to test it and a slow way to look at it, and it cannot be opened later, sent
 * to anyone, or diffed against yesterday.
 *
 * So: drive the mock ONCE, with every feature switched on and a printer that is printing, then
 * take the DOM as it stands and write it out with every card made active and every script
 * removed. What comes out is one file that opens in any browser with no device, no server and
 * no network, showing every card of every page with real values in it.
 *
 * It is a picture, not an application. Nothing in it works: the switches do not switch, the
 * sliders do not slide, and the theme button does nothing. The theme is chosen when it is
 * generated (--dark or --light), because without scripts there is no one to set the class.
 *
 *   tools/ui/harness/run.sh p2-printing.json mockpage.js PS_CLONE=1 PS_PRINT_PERCENT=41
 *   tools/ui/harness/run.sh p2-printing.json mockpage.js PS_CLONE=1 PS_MOCKPAGE_THEME=dark
 *
 * The file lands in private/uiwork/ui-mock.html, which is not committed: it is generated from
 * the page and the page is what is reviewed.
 */
const fs = require('fs');
const path = require('path');
const pw = require('./pw');
const { t } = pw;

const THEME = process.env.PS_MOCKPAGE_THEME === 'dark' ? 'dark' : 'light';
const OUT = process.env.PS_MOCKPAGE_OUT
  || path.join(__dirname, '..', '..', '..', 'private', 'uiwork', 'ui-mock.html');

(async () => {
  const browser = await pw.launch();
  try {
    const { page } = await pw.open(browser, { theme: THEME, width: 1280, hash: '#status' });
    /* Every switch on, so the cards that live behind one are in the picture at all. */
    const names = await (await fetch(`${pw.BASE}/api/features`)).json().then((d) => Object.keys(d.features || {}));
    const all = {};
    for (const n of names) all[n] = true;
    await fetch(`${pw.BASE}/api/features`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ features: all }),
    });
    await page.reload();
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.waitForTimeout(1500);        // the print poll and the feature document

    const html = await page.evaluate((theme) => {
      const d = document.getElementById('ps-dialog');
      if (d && d.open) d.close();
      /* Every page at once. */
      document.querySelectorAll('[data-card]').forEach((c) => c.classList.add('active'));
      /* Everything the modules had hidden, shown: that is the point of the file. A control
         hidden because the device has not reported it is exactly what someone laying out a
         card needs to see. */
      document.querySelectorAll('[hidden]').forEach((e) => e.removeAttribute('hidden'));
      document.body.classList.remove('is-waiting');
      document.body.classList.remove('light', 'dark');
      document.body.classList.add(theme);
      /* No scripts. The page is a picture from here on, and it says so at the top. */
      document.querySelectorAll('script').forEach((s) => s.remove());
      const note = document.createElement('div');
      note.setAttribute('style', 'position:fixed;inset:auto auto 8px 8px;z-index:99;padding:6px 10px;'
        + 'border-radius:6px;background:#000;color:#fff;font:12px/1.4 system-ui,sans-serif;opacity:.75');
      note.textContent = 'STATIC. Every card at once, no scripts, nothing here works.';
      document.body.appendChild(note);
      return '<!doctype html>\n' + document.documentElement.outerHTML;
    }, THEME);

    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, html, 'utf8');
    t(`every card, ${THEME}, no scripts: ${(html.length / 1024).toFixed(0)} KB -> ${OUT}`,
      html.length > 20000 && !/<script/i.test(html));
    t('every page is in it', (html.match(/data-card/g) || []).length >= 7,
      (html.match(/data-card/g) || []).length);
    t('and nothing is left hidden', !/\shidden(?=[\s>=])/i.test(html));
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
