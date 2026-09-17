#!/usr/bin/env node
'use strict';
const { chromium } = require('playwright');
const BASE = `http://127.0.0.1:${Number(process.env.PS_PORT || 8199)}`;
(async () => {
  const b = await chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await fetch(BASE + '/api/features', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ features: { presets: true, stage_effects: true, state_effects: true } }) });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 8000 });
  await page.evaluate(() => show_card('theme'));
  await page.waitForTimeout(500);
  const out = await page.evaluate(() => {
    const el = document.getElementById('ps-pre-save');
    el.scrollIntoView({ block: 'center' });
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    const chain = [];
    for (let p = el; p && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      chain.push({ tag: p.tagName, id: p.id, cls: p.className, pos: cs.position, of: cs.overflow, tr: cs.transform, z: cs.zIndex, disp: cs.display });
    }
    const m = document.querySelector('main');
    const mr = m.getBoundingClientRect();
    const b = document.body;
    const _r2 = el.getBoundingClientRect();
    return { rectAgain: { y: _r2.y }, main: { rect: { y: mr.y, h: mr.height }, clientH: m.clientHeight, scrollH: m.scrollHeight, scrollTop: m.scrollTop },
             body: { scrollTop: b.scrollTop, scrollH: b.scrollHeight, clientH: b.clientHeight },
             docScroll: document.documentElement.scrollTop,
             rect: { x: r.x, y: r.y, w: r.width, h: r.height }, cx, cy,
             hit: hit ? (hit.tagName + '#' + hit.id + '.' + hit.className) : null,
             stack: (document.elementsFromPoint(cx, cy) || []).map((e) => e.tagName + '#' + e.id + '.' + (typeof e.className === 'string' ? e.className : '')),
             htmlCS: (function () { const c = getComputedStyle(document.documentElement); return { pe: c.pointerEvents, of: c.overflow, h: c.height, pos: c.position, zoom: c.zoom }; })(),
             bodyCS: (function () { const c = getComputedStyle(document.body); return { pe: c.pointerEvents, of: c.overflow, h: c.height, gtr: c.gridTemplateRows, zoom: c.zoom }; })(),
             mainCS: (function () { const c = getComputedStyle(document.querySelector('main')); return { pe: c.pointerEvents, of: c.overflow, h: c.height, pos: c.position, zoom: c.zoom, ga: c.gridArea }; })(),
             elPE: getComputedStyle(el).pointerEvents,
             vw: innerWidth, vh: innerHeight, chain };
  });
  console.log(JSON.stringify(out, null, 1));
  const fs = require('fs'), path = require('path');
  const dir = path.resolve(__dirname, '..', '..', '..', 'private', 'uiwork', 'shots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, 'probe-view.png') });
  await page.screenshot({ path: path.join(dir, 'probe-full.png'), fullPage: true });
  await b.close();
})();
