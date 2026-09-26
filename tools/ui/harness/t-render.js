#!/usr/bin/env node
'use strict';
/*
 * C8 on the page: what the renderer is doing.
 *
 * The card is behind the diagnostics switch, and it does not decide that for itself: it asks
 * the route and believes the answer, so a device with the switch off, an older firmware with
 * no such route and a factory device all take the card away for the same reason. Every number
 * in it is the device's; the page computes none of them and draws none of them as zero
 * because the device did not say.
 *
 * The last section is the one that matters most and would never be noticed by looking: the
 * poll stops when the card is closed. The mock records every request, so a poll left running
 * behind a closed card is visible here and nowhere else.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-render.js PS_CLONE=1
 */
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const knob = (name, value) => post('/__knob', { name, value: String(value) });
async function waitFor(page, body, ms = 4000) {
  return page.waitForFunction(new Function('return (' + body + ')'), null, { timeout: ms, polling: 25 }).then(() => true).catch(() => false);
}
/* how many times the page has asked for the renderer's numbers */
async function polls() {
  const rows = await (await fetch(`${BASE}/__sent`)).json();
  return rows.filter((r) => r.api === '/api/render').length;
}
const row = (page, id) => page.$eval('#' + id, (e) => e.textContent.trim());
/* Waits for an element's hidden to reach `want`, and on failure RETURNS what it saw, so a
   failure says whether the card stayed put or was never there at all. */
async function untilHidden(page, id, want, ms = 4000) {
  const end = Date.now() + ms;
  let v = null;
  for (;;) {
    try { v = await page.$eval('#' + id, (e) => e.hidden); } catch (e) { v = 'no such element'; }
    if (v === want) return true;
    if (Date.now() > end) return v;
    await sleep(50);
  }
}
/* Waits for the page to have asked at least `want` times. */
async function untilPolls(want, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const n = await polls();
    if (n >= want || Date.now() > end) return n;
    await sleep(50);
  }
}
const DASH = '—';

async function open(page, card) {
  await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
  await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
  await page.evaluate((c) => show_card(c), card);
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
    await open(page, 'logs');

    // ---- A: the switch off ----
    t('A1 with the diagnostics switch off the card is not on the page',
      await page.$eval('#ps-card-render', (e) => e.hidden));
    t('A2 and nothing else on the Logs page went with it',
      await page.$eval('#ps-card-logs', (e) => !e.hidden) &&
      await page.$eval('#ps-log-view', (e) => !!e));

    // ---- B: the switch on ----
    await post('/api/features', { features: { diagnostics: true } });
    await knob('PS_RENDER_KIND', 'solid');
    await knob('PS_RENDER_FPS', 30);
    await knob('PS_RENDER_INTERVAL', 33);
    await knob('PS_RENDER_FRAMES', 4821);
    await knob('PS_RENDER_FAILED', 0);
    await page.reload();
    await open(page, 'logs');
    t('B1 the card appears', await untilHidden(page, 'ps-card-render', false) === true,
      await untilHidden(page, 'ps-card-render', false, 0));
    t('B2 the frames it has drawn are the device\'s number, verbatim',
      await row(page, 'ps-rd-frames') === '4821', await row(page, 'ps-rd-frames'));
    t('B3 the rate is the device\'s, not one the page worked out',
      await row(page, 'ps-rd-fps') === '30', await row(page, 'ps-rd-fps'));
    t('B4 the interval carries its unit, because 33 alone is not a duration',
      await row(page, 'ps-rd-interval') === '33 ms', await row(page, 'ps-rd-interval'));
    t('B5 nothing refused, and nothing refused reads as zero rather than as a dash',
      await row(page, 'ps-rd-failed') === '0', await row(page, 'ps-rd-failed'));
    t('B6 the placeholder render says what it is, not "solid" in a language nobody set',
      await row(page, 'ps-rd-kind') === 'Solid colour', await row(page, 'ps-rd-kind'));

    // ---- C: what is drawing ----
    await knob('PS_RENDER_KIND', 'fx');
    await knob('PS_RENDER_EFFECT', 19);              // the barber pole
    await page.evaluate(() => render_stats_request());
    t('C1 an effect is named, not numbered',
      await waitFor(page, "document.getElementById('ps-rd-kind').textContent.trim() === 'Barber Pole'"),
      await row(page, 'ps-rd-kind'));
    await knob('PS_RENDER_KIND', 'diag');
    await page.evaluate(() => render_stats_request());
    t('C2 a diagnostic holding the bar says so, which is itself the answer to "why is it red"',
      await waitFor(page, "document.getElementById('ps-rd-kind').textContent.trim() === 'Diagnostic'"),
      await row(page, 'ps-rd-kind'));
    await knob('PS_RENDER_KIND', 'none');
    await page.evaluate(() => render_stats_request());
    t('C3 nothing drawn yet is a dash: it is not a kind of drawing',
      await waitFor(page, "document.getElementById('ps-rd-kind').textContent.trim() === '" + DASH + "'"),
      await row(page, 'ps-rd-kind'));

    // ---- D: a number the device has not measured ----
    await knob('PS_RENDER_FPS', -1);
    await knob('PS_RENDER_FAILED', 7);
    await page.evaluate(() => render_stats_request());
    t('D1 an unmeasured rate is a dash, never 0 and never -1',
      await waitFor(page, "document.getElementById('ps-rd-fps').textContent.trim() === '" + DASH + "'"),
      await row(page, 'ps-rd-fps'));
    t('D2 refused transmits are shown, because that is the fault this card exists for',
      await row(page, 'ps-rd-failed') === '7', await row(page, 'ps-rd-failed'));

    // ---- E: the poll ----
    await knob('PS_RENDER_FRAMES', '');             // let the mock's own count climb
    await knob('PS_RENDER_FPS', 30);
    const before = await polls();
    await sleep(2600);
    const during = await polls();
    t('E1 the page polls while the card is open, without being touched', during > before, [before, during]);
    t('E2 and the number it shows moves on its own',
      await waitFor(page, "Number(document.getElementById('ps-rd-frames').textContent) > 0", 4000),
      await row(page, 'ps-rd-frames'));

    /* The one that would never be noticed by looking at the page. */
    await page.evaluate(() => show_card('status'));
    await sleep(300);
    const closed = await polls();
    await sleep(2600);
    t('E3 closing the card stops the poll: nothing asks for numbers nobody is reading',
      (await polls()) === closed, [closed, await polls()]);
    await page.evaluate(() => show_card('logs'));
    const after = await untilPolls(closed + 1, 1500);
    t('E4 opening it again asks at once, rather than waiting out the interval',
      after > closed, [closed, after]);

    // ---- F: the switch back off ----
    await post('/api/features', { features: { diagnostics: false } });
    await page.evaluate(() => render_stats_request());
    t('F1 the switch off takes the route, and the card follows the route',
      await untilHidden(page, 'ps-card-render', true) === true,
      await untilHidden(page, 'ps-card-render', true, 0));

    t('G1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
