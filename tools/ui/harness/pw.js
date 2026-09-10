'use strict';
/*
 * Shared plumbing for the Playwright page harnesses, page-*.js. Not a harness itself:
 * run.sh runs page-*.js, and each of those requires this.
 *
 * What lives here and nothing else:
 *   - the browser, one context per theme/width combination the harness asks for
 *   - the mock's debug endpoints, read from Node with fetch
 *   - the pass/fail counter and the exit verdict
 *   - screenshots into private/uiwork/shots/ (gitignored). They are evidence for a human
 *     to look at, never something a harness asserts on
 *
 * Playwright comes from private/uiwork/node_modules through NODE_PATH, which run.sh sets.
 * It is never a dependency of anything tracked; see docs/DECISIONS.md D-013.
 */

const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = path.resolve(__dirname, '..', '..', '..');
const SHOTS = path.join(ROOT, 'private', 'uiwork', 'shots');

let pass = 0, fail = 0;
function t(name, ok, got) {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); }
}
function verdict() {
  console.log(`\n${pass} passed, ${fail} failed`);
  return fail === 0 ? 0 : 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the mock's debug endpoints ----
const sent = async () => (await fetch(`${BASE}/__sent`)).json();
const pushed = async () => (await fetch(`${BASE}/__pushed`)).json();
const mockState = async () => (await fetch(`${BASE}/__state`)).json();
const resetMock = () => fetch(`${BASE}/__reset`, { method: 'POST' });
const knob = (name, value) => fetch(`${BASE}/__knob`, { method: 'POST', body: JSON.stringify({ name, value }) });

// Frames the device received after a given count. Waits a little for the socket to
// deliver, then returns only the new records' raw text, in order.
async function sentAfter(n, ms = 400) {
  const end = Date.now() + ms;
  let s = await sent();
  while (s.length <= n && Date.now() < end) { await sleep(25); s = await sent(); }
  await sleep(120);                     // catch a duplicate arriving right behind the first
  s = await sent();
  return s.slice(n).map((r) => r.text);
}
// The exact bytes the page must put on the wire: members in the order given, then
// device_wakeup:1, which is what PS.send() does.
function frame(root, members) {
  const body = Object.assign({}, members); body.device_wakeup = 1;
  return JSON.stringify({ [root]: body });
}

// ---- the browser ----
async function launch() {
  return chromium.launch({ headless: true, executablePath: process.env.PS_CHROME || undefined });
}

// One page in one context. theme: 'light' | 'dark' | 'auto'. The theme preference is
// planted in localStorage before the page's own first-paint script runs, which is how a
// returning user's browser looks. colorScheme pins what 'auto' resolves to.
async function open(browser, opts) {
  const theme = opts.theme || 'auto', width = opts.width || 1280;
  const ctx = await browser.newContext({
    viewport: { width, height: width < 700 ? 844 : 800 },
    colorScheme: theme === 'dark' ? 'dark' : 'light',
  });
  await ctx.addInitScript((th) => {
    try { if (th === 'auto') localStorage.removeItem('ps_theme'); else localStorage.setItem('ps_theme', th); } catch (e) {}
  }, theme);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(`${BASE}/${opts.hash || ''}`);
  if (opts.waitForState !== false) {
    await page.waitForFunction(() => !document.body.classList.contains('ps-waiting'), null, { timeout: 5000 });
  }
  return { ctx, page, errors, theme, width };
}

// Wait until the page's merged state satisfies a predicate. The predicate runs in the
// page and gets PS.state.
async function waitState(page, fnBody, ms = 2000) {
  return page.waitForFunction((body) => new Function('s', body)(PS.state), fnBody, { timeout: ms, polling: 25 })
    .then(() => true).catch(() => false);
}

// Click like a person who has scrolled the control into the middle of the screen. The
// sticky bottom bar covers the last 4.5rem of the phone viewport; a control scrolled to the
// bare minimum sits under it, and a click there is a miss for a person as well.
async function tap(page, selector) {
  await page.$eval(selector, (el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.click(selector);
}
// A card is shown when it is the only unhidden article.
async function waitCard(page, name, ms = 2000) {
  return page.waitForFunction((n) => { const all = [...document.querySelectorAll('article[data-ps-card]')]; return all.length > 1 && all.every((a) => a.hidden === (a.id !== 'ps-card-' + n)); }, name, { timeout: ms, polling: 25 })
    .then(() => true).catch(() => false);
}

// The default is the viewport, which is what a person sees. A full-page capture puts the
// sticky bars wherever the viewport happened to be, so it is a review aid, suffixed -full.
async function shot(page, name, opts) {
  fs.mkdirSync(SHOTS, { recursive: true });
  const full = !!(opts && opts.full);
  const file = path.join(SHOTS, `${name}${full ? '-full' : ''}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return file;
}

module.exports = { BASE, t, verdict, sleep, sent, pushed, mockState, resetMock, knob, sentAfter, frame, launch, open, waitState, tap, waitCard, shot };
