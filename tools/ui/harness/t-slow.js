#!/usr/bin/env node
'use strict';
/*
 * slowload, slowland: a device that answers late, and one that never answers.
 *
 * nows.js covers a socket that is refused. Nothing covered the two shapes a person actually
 * meets: a device that is there and slow, and one that accepts the socket and then says
 * nothing. The page's own rule (core.js, start_state_ask) is to hold the waiting state, reopen
 * a silent socket every two seconds up to five times, then stop reopening and stay honest.
 * Three rows, the lie in the row as sweep.sh insists:
 *
 *   PS_DELAY=1200   late:  the first state arrives inside the two seconds. The page must show
 *                          it is waiting until then (the note, the chip's word, is-waiting on
 *                          the body), land once, and never have reopened the socket.
 *   PS_DELAY=4000   slow:  slower than the reopen. The page reopens, keeps waiting, lands once
 *                          the reopening stops, and says nothing to the console meanwhile.
 *   PS_NO_PUSH=1    never: the socket opens and nothing ever comes. After the five reopens the
 *                          page is still waiting, still says so, has not invented a state, and
 *                          holds the sixth socket open instead of hammering the device.
 *
 *   tools/ui/harness/run.sh p2-idle.json t-slow.js PS_DELAY=1200
 *   tools/ui/harness/run.sh p2-idle.json t-slow.js PS_DELAY=4000
 *   tools/ui/harness/run.sh p2-idle.json t-slow.js PS_NO_PUSH=1
 */
const pw = require('./pw');
const { t } = pw;

const never = ['1', 'true', 'yes'].includes(String(process.env.PS_NO_PUSH || '').toLowerCase());
const delay = Number(process.env.PS_DELAY || 0);
const CASE = never ? 'never' : delay >= 2000 ? 'slow' : 'late';

const waiting = (page) => page.evaluate(() => {
  const note = document.getElementById('ps-waiting-note');
  const shown = note ? getComputedStyle(note).display !== 'none' && note.getBoundingClientRect().height > 0 : false;
  return {
    body: document.body.classList.contains('is-waiting'),
    note: shown,
    chip: (document.getElementById('ps-top-state') || {}).textContent || '',
    word: tr('ui_waiting_short', 'Waiting for the device'),
    state: Object.keys(window.g_state || {}).length,
  };
});

(async () => {
  const browser = await pw.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const spoke = [], threw = [];
    page.on('console', (m) => spoke.push(m.type() + ': ' + m.text()));
    page.on('pageerror', (e) => threw.push(String(e)));
    let opened = 0;
    page.on('websocket', () => { opened++; });

    const t0 = Date.now();
    await page.goto(`${pw.BASE}/`);
    await pw.sleep(600);
    const early = await waiting(page);
    t(`${CASE}: while nothing has arrived the page says it is waiting (the body, the note, the chip)`,
      early.body && early.note && early.chip === early.word && early.state === 0, early);

    if (CASE === 'late') {
      const landed = await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 4000 }).then(() => true).catch(() => false);
      const ms = Date.now() - t0;
      t(`late: the state landed at ${ms} ms, inside the two seconds`, landed && ms >= delay - 50 && ms < 2600, ms);
      /* the chip is redrawn from the socket's own link word on landing and from the print
         document a moment later; either is not the waiting word */
      await page.waitForFunction(() => document.getElementById('ps-top-state').textContent !== tr('ui_waiting_short', 'Waiting for the device'), null, { timeout: 3000 }).catch(() => {});
      const after = await waiting(page);
      t('late: the waiting note and the chip\'s word went with it', !after.body && !after.note && after.chip !== after.word && after.chip !== '' && after.state > 0, after);
      t('late: one socket, never reopened', opened === 1, opened);
    } else if (CASE === 'slow') {
      const landed = await page.waitForFunction(() => !document.body.classList.contains('is-waiting'), null, { timeout: 40000 }).then(() => true).catch(() => false);
      const ms = Date.now() - t0;
      const after = await waiting(page);
      t(`slow: the state landed at ${ms} ms, once the reopening had stopped`, landed && ms >= delay - 50, ms);
      t(`slow: the socket was reopened on the way (${opened} sockets) and not more than the rule allows`, opened >= 2 && opened <= 7, opened);
      t('slow: the page is fully live afterwards', !after.body && !after.note && after.state > 0, after);
    } else {
      await pw.sleep(26000);
      const late = await waiting(page);
      const openedAt26 = opened;
      await pw.sleep(6000);
      t('never: twenty-six seconds on, the page is still waiting and still says so', late.body && late.note && late.chip === late.word && late.state === 0, late);
      t(`never: it reopened the socket the five times the rule allows, then held the sixth open (${opened} sockets, none since)`, opened === 6 && opened === openedAt26, { opened, openedAt26 });
      const dialog = await page.evaluate(() => { const d = document.getElementById('ps-dialog'); return !!(d && d.open); });
      t('never: no dialog claims anything about a device that has said nothing', !dialog, dialog);
    }
    t(`${CASE}: nothing was written to the console and nothing threw`, spoke.length === 0 && threw.length === 0, { spoke: spoke.slice(0, 4), threw });
    await ctx.close();
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
