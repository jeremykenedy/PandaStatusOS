#!/usr/bin/env node
'use strict';
/*
 * The vent card on the Bindings page, driven against a real mock vent.
 *
 * Three processes in this row: the page, the mock device holding the bridge socket, and the
 * mock vent at the other end of it. Nothing is simulated in between. What the page shows is
 * what the device believes, and what the device believes came off a socket that really ran
 * the pairing exchange in docs/PANDAVENT-BRIDGE.md.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-bridge.js PS_CLONE=1 PS_WITH_VENT=1 PS_VENTS=pandaventos@127.0.0.1:8299
 */
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;
const VENT = `http://127.0.0.1:${Number(process.env.PV_PORT || 8299)}`;

let pass = 0, fail = 0;
const t = (n, ok, got) => { if (ok) { pass++; console.log(`  ok    ${n}`); } else { fail++; console.log(`  FAIL  ${n}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = (base, p, b) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
const doc = async () => (await (await fetch(`${BASE}/api/bridge`)).json());
const state = async () => (await (await fetch(`${BASE}/__state`)).json());
const feats = async () => (await (await fetch(`${BASE}/api/features`)).json());
const text = (page, id) => page.$eval('#' + id, (e) => e.textContent.trim());
const hidden = (page, id) => page.$eval('#' + id, (e) => e.hidden);
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) return null; await sleep(100); }
}
async function open(page) {
  await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
  await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
  await page.evaluate(() => show_card('printer'));
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });

    await page.goto(BASE + '/');
    await open(page);

    // ---- A: the switch off ----
    t('A1 with the bridge switch off there is no vent card', await hidden(page, 'ps-card-vent'));
    t('A2 and the printer it sits under is still there', !await hidden(page, 'ps-card-printer'));
    t('A3 the page is called Bindings in both navs, because it holds two of them',
      await page.$$eval('[data-nav="printer"] span', (s) => s.map((e) => e.textContent.trim())).then((w) => w.length === 2 && w.every((x) => x === 'Bindings')),
      await page.$$eval('[data-nav="printer"] span', (s) => s.map((e) => e.textContent.trim())));

    // ---- B: the switch on ----
    await post(BASE, '/api/features', { features: { bridge: true } });
    await page.reload();
    await open(page);
    t('B1 the card appears', await until(async () => !await hidden(page, 'ps-card-vent')));
    t('B2 nothing is bound, so there is no link to report', await hidden(page, 'ps-vent-link-row'));
    t('B3 nothing is pairing', await hidden(page, 'ps-vent-pair'));
    t('B4 and there is nothing to copy from', await hidden(page, 'ps-vent-copy'));
    t('B5 the button offers to bind', (await text(page, 'ps-span-vent-bind')) === 'Bind');

    // ---- C: the scan ----
    await page.click('#ps-btn-vent-scan');
    const found = await until(async () => {
      const opts = await page.$$eval('#ps-vent-name option', (o) => o.map((e) => ({ v: e.value, t: e.textContent })));
      return opts.length > 1 ? opts : null;
    }, 6000);
    t('C1 the scan turns up the vent on this network', !!found, found);
    t('C2 named as the vent names itself, with its address beside it',
      !!found && /pandaventos/.test(found[1].t) && found[1].v.includes('8299'), found && found[1]);
    /* PS_VENTS_STOCK names a vent the scan finds on its stock socket, the way the firmware
       sniffs a factory vent or a PandaVentOS from before its half of the bridge. */
    const stock = found && found.find((o) => /192\.0\.2\.77/.test(o.v));
    t('C3 a vent running the factory firmware is in the list too, and says so',
      !!stock && /PandaVent · 192\.0\.2\.77 · factory firmware/.test(stock.t), stock);
    t('C4 while the one with a bridge carries no such suffix', !!found && !/firmware/.test(found[1].t), found && found[1].t);

    // ---- D: binding, and the six digits ----
    await page.selectOption('#ps-vent-name', found[1].v);
    await page.click('#ps-btn-vent-bind');
    const paired = await until(async () => (await doc()).pair, 6000);
    t('D1 binding a vent that has never met this one asks for a pairing', !!paired, paired);
    t('D2 the device holds six digits', !!paired && /^\d{6}$/.test(paired.code), paired);
    t('D3 the page shows the device\'s own, not one of its own making',
      await until(async () => (await text(page, 'ps-vent-code')) === paired.code, 4000),
      await text(page, 'ps-vent-code'));
    t('D4 and the seconds left, which come from the device too',
      /\d+ s/.test(await text(page, 'ps-vent-code-left')), await text(page, 'ps-vent-code-left'));
    t('D5 the link says what it is waiting for',
      (await text(page, 'ps-vent-link')) === 'Not paired yet', await text(page, 'ps-vent-link'));
    t('D6 and there is still nothing to copy', await hidden(page, 'ps-vent-copy'));

    // ---- E: confirming ----
    await page.click('#ps-btn-vent-confirm');
    t('E1 the link comes up', await until(async () => (await doc()).link === 3, 5000));
    t('E2 the pairing block goes with it', await until(async () => await hidden(page, 'ps-vent-pair'), 4000));
    t('E3 the page says so in the device\'s words',
      await until(async () => (await text(page, 'ps-vent-link')) === 'Connected', 4000),
      await text(page, 'ps-vent-link'));
    t('E4 the copies appear, now that there is a vent to copy from',
      await until(async () => !await hidden(page, 'ps-vent-copy'), 4000));
    t('E5 the button now offers to let go', (await text(page, 'ps-span-vent-bind')) === 'Unbind');
    const vd = await doc();
    t('E6 and the vent is reporting what it is doing',
      !!vd.vent && ['open', 'closed', 'sealing', 'moving', 'unknown'].includes(vd.vent.state), vd.vent);
    t('E7 the vent holds a token for this device, which is what paired means',
      !!(await (await fetch(`${VENT}/__state`)).json()).state.tokens[vd.self.id]);

    // ---- E8..E12: the card on the dashboard ----
    await page.evaluate(() => show_card('status'));
    t('E8 once a vent is talking there is a vent card on the dashboard',
      await until(async () => !await hidden(page, 'ps-card-vent-status'), 5000));
    t('E9 saying what it is doing, in words rather than the vent\'s own token',
      ['Open', 'Closed', 'Sealing the chamber', 'Moving', 'Not reported'].includes(await text(page, 'ps-vs-state')),
      await text(page, 'ps-vs-state'));
    t('E10 and what the chamber reads, because the vent sent one',
      !await hidden(page, 'ps-vs-chamber-row') && /\d/.test(await text(page, 'ps-vs-chamber')),
      await text(page, 'ps-vs-chamber'));
    t('E11 the policy row says which way round it is',
      (await text(page, 'ps-vs-policy')) === 'Following the printer', await text(page, 'ps-vs-policy'));
    t('E12 and nothing is claimed about a fault the vent has not reported',
      await hidden(page, 'ps-vs-error-row'));

    /* The vent moves on its own, and the card follows it: the command goes to the vent
       through the device, and nothing on this page is told what to draw. */
    await post(VENT, '/__vent', { state: 'sealing', error: 'E42' });
    t('E13 the card follows the vent without the page being told anything',
      await until(async () => (await text(page, 'ps-vs-state')) === 'Sealing the chamber', 6000),
      await text(page, 'ps-vs-state'));
    t('E14 and a fault the vent reports appears, in the vent\'s own code',
      await until(async () => !await hidden(page, 'ps-vs-error-row') && (await text(page, 'ps-vs-error')) === 'E42', 4000),
      await text(page, 'ps-vs-error'));
    await post(VENT, '/__vent', { state: 'closed', error: null });
    await page.evaluate(() => show_card('printer'));

    // ---- F: the effect copy, refused before it is allowed ----
    await post(BASE, '/api/features', { features: { state_effects: true } });   // but not fx_barber
    await page.click('#ps-btn-vent-copy-effect');
    await sleep(800);
    const f1 = await feats();
    t('F1 an effect the switches here do not allow is refused, not quietly downgraded',
      f1.config.state_effects[0].effect !== 19, f1.config.state_effects[0].effect);

    await post(BASE, '/api/features', { features: { fx_barber: true } });
    await page.click('#ps-btn-vent-copy-effect');
    const copied = await until(async () => {
      const f = await feats();
      return f.config.state_effects[0].effect === 19 ? f : null;
    }, 5000);
    t('F2 with the switch on, the vent\'s effect lands in this device\'s own state',
      !!copied, copied && copied.config.state_effects[0]);
    t('F3 with its timing, its options and its colours, as the vent holds them',
      !!copied && copied.config.state_effects[0].speed === 50 && copied.config.state_effects[0].aux === 4
      && copied.config.state_effects[0].colours[0] === '#11FF22FF',
      copied && copied.config.state_effects[0]);

    // ---- G: the colour copy ----
    await page.click('#ps-btn-vent-copy-colours');
    const cols = await until(async () => {
      const s = await state();
      const m = s.settings.list2[s.settings.current_mode];
      return m.rgb_rgba[0] === '#11FF22FF' ? m.rgb_rgba : null;
    }, 5000);
    t('G1 the vent\'s three colours land in this device\'s three', !!cols, cols);

    // ---- H: letting go ----
    await page.click('#ps-btn-vent-bind');
    t('H1 unbinding takes the link back to nothing', await until(async () => (await doc()).link === 0, 4000));
    t('H2 the copies go with it', await until(async () => await hidden(page, 'ps-vent-copy'), 4000));
    t('H3 and so does the link row', await until(async () => await hidden(page, 'ps-vent-link-row'), 4000));
    await page.evaluate(() => show_card('status'));
    t('H4 and the dashboard stops carrying a card about a vent that is no longer bound',
      await until(async () => await hidden(page, 'ps-card-vent-status'), 5000));
    await page.evaluate(() => show_card('printer'));

    // ---- H5: binding the factory vent: a web server answers, no bridge does ----
    await page.selectOption('#ps-vent-name', '192.0.2.77');
    await page.click('#ps-btn-vent-bind');
    t('H5 binding a vent with no bridge half is link 7, not a socket that never comes up',
      await until(async () => (await doc()).link === 7, 4000), (await doc()).link);
    t('H6 and the page says what that means',
      await until(async () => (await text(page, 'ps-vent-link')) === "This vent's firmware has no bridge to talk to yet", 3000), await text(page, 'ps-vent-link'));
    t('H7 nothing to copy from a vent that is not talking', await hidden(page, 'ps-vent-copy'));
    await page.click('#ps-btn-vent-bind');
    t('H8 letting go works the same from there', await until(async () => (await doc()).link === 0, 4000));

    // ---- I: the switch off again ----
    await post(BASE, '/api/features', { features: { bridge: false } });
    t('I1 the switch off takes the route, and the card follows the route',
      await until(async () => await hidden(page, 'ps-card-vent'), 6000));

    t('J1 no page errors, no console errors', errors.length === 0, errors);
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
