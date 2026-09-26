#!/usr/bin/env node
'use strict';
/*
 * O3: the Bindings page names the printer's model, from the code the printer announces.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-model.js
 */
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
async function waitFor(page, body, ms = 3000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
const line = (page) => page.$eval('#ps-printer-model', (e) => ({ hidden: e.hidden, text: e.textContent.trim() }));

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    await page.goto(BASE + '/');
    await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    await page.evaluate(() => show_card('printer'));

    t('A1 the device announced the bound printer as N7, and the page names it',
      await waitFor(page, "!document.getElementById('ps-printer-model').hidden") && /Bambu Lab P2S$/.test((await line(page)).text), await line(page));
    t('A2 the line is labelled in the page\'s words', (await line(page)).text.indexOf(await page.evaluate(() => tr('ui_model', ''))) === 0, await line(page));

    // ---- a code the table does not know is shown as itself, not guessed at ----
    await page.evaluate(() => { g_state.printer.model = 'ZZ9'; handle_printer({ model: 'ZZ9' }); });
    t('B1 an unknown code is shown as the code', /: ZZ9$/.test((await line(page)).text), await line(page));

    // ---- and nothing is shown before the printer has been heard ----
    await page.evaluate(() => handle_printer({ name: 'Mock P2S', sn: 'X', access_code: '', ip: '192.0.2.20' }));
    t('C1 a push without a model leaves the line as it was', !(await line(page)).hidden, await line(page));
    await page.evaluate(() => { g_state.printer.model = ''; handle_printer({ model: '' }); });
    t('C2 an empty model hides the line', (await line(page)).hidden, await line(page));

    // ---- the picker keeps the name alone, so the name stored on the device stays the name ----
    t('D1 the picker\'s label is the printer\'s name, with no model appended',
      await page.$eval('#ps-printer-name', (s) => s.options[s.selectedIndex].textContent.trim()) === 'Mock P2S',
      await page.$eval('#ps-printer-name', (s) => s.options[s.selectedIndex].textContent));

    t('E1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
