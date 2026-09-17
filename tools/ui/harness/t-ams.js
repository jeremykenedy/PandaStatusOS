#!/usr/bin/env node
'use strict';
/*
 * The AMS card. One chip per spool the printer describes, the loaded one marked, the
 * humidity drawn as the LEVEL it is, and the whole card away when the printer describes
 * no spools at all.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-ams.js PS_CLONE=1
 */
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(page, body, ms = 4000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}

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
    await page.evaluate(() => show_card('status'));

    t('A1 the card is up, because the printer described spools',
      await waitFor(page, "!document.getElementById('ps-card-ams').hidden"));
    t('A2 it sits between Lighting now and Printer controls, in that order',
      await page.$$eval('#ps-card-status > article', (els) => {
        const ids = els.map((e) => e.id);
        return ids.indexOf('ps-lighting-row') < ids.indexOf('ps-card-ams')
            && ids.indexOf('ps-card-ams') < ids.indexOf('ps-card-pctl');
      }),
      await page.$$eval('#ps-card-status > article', (els) => els.map((e) => e.id)));

    // ---- the spools ----
    t('B1 one chip per spool the printer described',
      await page.$$eval('#ps-trays-row > .chip', (e) => e.length) === 4,
      await page.$$eval('#ps-trays-row > .chip', (e) => e.length));
    t('B2 each carries its slot, its type and what is left',
      /1 · PLA · PLA Basic · 74%/.test(await page.$eval('#ps-tray-0', (e) => e.textContent)),
      await page.$eval('#ps-tray-0', (e) => e.textContent));
    /* The rule is that an absent field is left out, never drawn as zero. Tray 2 has a type
       and a colour and no remaining; tray 3 has only a remaining. Neither may invent the
       other, and neither may show 0% for a number the printer did not send. */
    t('B3 a spool with no remaining shows none, rather than zero',
      (await page.$eval('#ps-tray-2', (e) => e.textContent)).trim() === '3 \u00b7 ABS',
      await page.$eval('#ps-tray-2', (e) => e.textContent));
    t('B3b a spool with only a remaining shows only that',
      (await page.$eval('#ps-tray-3', (e) => e.textContent)).trim() === '4 \u00b7 100%',
      await page.$eval('#ps-tray-3', (e) => e.textContent));
    t('B4 the loaded spool is the one the printer named, and only it',
      await page.$$eval('#ps-trays-row > .chip', (els) => els.filter((e) => e.classList.contains('is-now')).map((e) => e.id).join()) === 'ps-tray-1',
      await page.$$eval('#ps-trays-row > .chip', (els) => els.filter((e) => e.classList.contains('is-now')).map((e) => e.id)));
    t('B5 a spool with a colour paints its dot, one without does not',
      await page.$eval('#ps-tray-0 .swatch-dot', (e) => !e.classList.contains('is-unset'))
      && await page.$eval('#ps-tray-3 .swatch-dot', (e) => e.classList.contains('is-unset')));

    // ---- the humidity, as a level ----
    t('C1 the humidity is drawn as a level, never as a percentage',
      await page.$eval('#ps-ams-kv', (e) => /level\s*2/.test(e.textContent) && !/%/.test(e.textContent)),
      await page.$eval('#ps-ams-kv', (e) => e.textContent));
    t('C2 two of five pips are lit for a level of two',
      await page.$$eval('.ams-pip', (els) => els.filter((e) => e.classList.contains('is-on')).length) === 2,
      await page.$$eval('.ams-pip', (els) => els.filter((e) => e.classList.contains('is-on')).length));
    t('C3 the unit temperature is beside it', /31/.test(await page.$eval('#ps-ams-kv', (e) => e.textContent)));

    // ---- Bambu has dropped the humidity field before ----
    await page.evaluate(() => { delete g_state.printer.status.ams_humidity; render_ams(); });
    t('D1 with the field gone the card still draws, and says the printer is not reporting it',
      (await page.$eval('#ps-card-ams', (e) => e.hidden)) === false
      && (await page.$eval('#ps-ams-kv', (e) => e.textContent)).indexOf('%') < 0
      && await page.$eval('#ps-ams-kv', (e) => e.textContent.indexOf(tr('ui_ams_no_reading','')) >= 0),
      await page.$eval('#ps-ams-kv', (e) => e.textContent));

    // ---- a printer with no AMS ----
    await page.evaluate(() => { g_state.printer.status.trays = []; render_ams(); });
    t('E1 no spools described, no card', await waitFor(page, "document.getElementById('ps-card-ams').hidden"));

    t('F1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
