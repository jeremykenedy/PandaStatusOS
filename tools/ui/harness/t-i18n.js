#!/usr/bin/env node
'use strict';
/*
 * i18n at run time: every language, every page, everything that is on the screen.
 *
 * The build proves the tables against the markup: every key the page names is carried by
 * English. Nothing until now proved the page itself, in the browser, in each of the
 * twenty-four languages: that switching to Polish paints Polish, that no element shows its
 * own key or the word "undefined", that the strings written by JavaScript at run time (the
 * effect names, the stage names, the feature switches, the link words) come from the table
 * of the language chosen and not from English, and that <html lang> and dir follow. The vent
 * has this harness under the name i18n; this is the same question asked of this page.
 *
 * Every switch on and a printing printer, so every list the modules build is built, and
 * every card made active with nothing hidden, so a string that is only shown later is read
 * now.
 *
 *   tools/ui/harness/run.sh p2-printing.json t-i18n.js PS_CLONE=1 PS_PRINT_PERCENT=37
 */
const pw = require('./pw');
const { t } = pw;

const CARDS = ['status', 'theme', 'settings', 'printer', 'sta', 'ap', 'logs'];
const KEY_SHAPE = '^(ui|dlg|cal|anim|status|card|ams|fw|door|logs|response|sta|ap|cfg|pctl)_[a-z0-9_]+$';

(async () => {
  const browser = await pw.launch();
  try {
    const names = await (await fetch(`${pw.BASE}/api/features`)).json().then((d) => Object.keys(d.features || {}));
    const all = {}; for (const n of names) all[n] = true;
    await fetch(`${pw.BASE}/api/features`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ features: all }) });

    const { page, errors } = await pw.open(browser, { theme: 'light', width: 1280, hash: '#status' });
    await page.evaluate(() => { const d = document.getElementById('ps-dialog'); if (d && d.open) d.close(); });
    for (const c of CARDS) { await page.evaluate((n) => show_card(n), c); await pw.waitCard(page, c); await pw.sleep(250); }
    await pw.sleep(1500);
    /* Every card at once, nothing hidden: what is read is everything the page can ever show. */
    await page.evaluate(() => {
      document.querySelectorAll('[data-card]').forEach((c) => c.classList.add('active'));
      document.querySelectorAll('[hidden]').forEach((e) => e.removeAttribute('hidden'));
    });

    const langs = await page.evaluate(() => Object.keys(PS_STRINGS).sort());
    t('the page carries twenty-four languages', langs.length === 24, langs.length);

    const english = await page.evaluate((shape) => {
      /* the English texts by element, to measure each other language against */
      const out = {};
      document.querySelectorAll('[data-str]').forEach((e, i) => { out[i] = e.textContent.trim(); });
      return out;
    }, KEY_SHAPE);

    for (const lang of langs) {
      const r = await page.evaluate(([L, shape, english]) => {
        set_language(L);
        const keyRe = new RegExp(shape);
        const bare = [], undef = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode: (n) => {
            const p = n.parentElement;
            if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(p.tagName)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
          const s = n.nodeValue.trim();
          if (!s) continue;
          if (keyRe.test(s)) bare.push(s);
          if (/\b(undefined|NaN)\b|\[object Object\]/.test(s)) undef.push(s.slice(0, 40));
        }
        /* the table itself: every key English carries, this language carries */
        const en = PS_STRINGS.en, tbl = PS_STRINGS[L];
        const missing = Object.keys(en).filter((k) => tbl[k] == null);
        /* the language took: what data-str elements show now against what they showed in English */
        let same = 0, total = 0;
        document.querySelectorAll('[data-str]').forEach((e, i) => {
          if (e.hasAttribute('data-no-translate')) return;
          total++;
          if (e.textContent.trim() === english[i]) same++;
        });
        /* the strings JavaScript wrote: five places a module painted with tr() at render time,
           each of which has to read in THIS language now, not in the one it was drawn in */
        const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : ''; };
        const opt = (id, i) => { const s = document.getElementById(id); return s && s.options[i] ? s.options[i].textContent.trim() : ''; };
        const family = (prefix, s) => Object.keys(tbl).some((k) => k.indexOf(prefix) === 0 && tbl[k] === s);
        const painted = {
          feature_label: txt('lbl-feat-state_effects').indexOf(tbl.ui_feat_state_effects) === 0,
          effect_list:   opt('ps-fx-effect', 1).indexOf(tbl.ui_fx_1) === 0,
          stage_list:    family('ui_stage_', opt('ps-pv-stage', 1)),
          top_chip:      family('ui_stage_', txt('ps-top-state')) || family('ui_printer_state_', txt('ps-top-state')) || family('ui_link_state_', txt('ps-top-state')),
          vent_link:     txt('ps-vent-link') === tbl.ui_link_state_0,
        };
        const stale = Object.keys(painted).filter((k) => !painted[k]);
        const html = document.documentElement;
        return { bare: bare.slice(0, 5), nbare: bare.length, undef: undef.slice(0, 5), nundef: undef.length,
                 missing: missing.slice(0, 8), nmissing: missing.length, same, total, stale,
                 lang: html.getAttribute('lang'), dir: html.getAttribute('dir') };
      }, [lang, KEY_SHAPE, english]);

      const differ = r.total ? Math.round(100 * (r.total - r.same) / r.total) : 0;
      t(`${lang}: nothing painted reads as a key, as undefined or as NaN`, r.nbare === 0 && r.nundef === 0, { bare: r.bare, undef: r.undef });
      t(`${lang}: carries every key English does`, r.nmissing === 0, r.missing);
      t(`${lang}: what JavaScript painted follows the language (a switch label, the effect list, the stage list, the top chip, a link word)`, r.stale.length === 0, r.stale);
      const wantLang = lang === 'zh' ? 'zh-Hans' : lang, wantDir = lang === 'ar' ? 'rtl' : 'ltr';
      if (lang === 'en') t('en: the document says it is English, left to right', r.lang === 'en' && r.dir === 'ltr', r);
      else t(`${lang}: the language took (${differ}% of the texts differ from English), lang="${wantLang}" dir=${wantDir}`,
             differ >= 40 && r.lang === wantLang && r.dir === wantDir, { differ, lang: r.lang, dir: r.dir });
    }
    await page.evaluate(() => set_language('en'));
    t('no page errors, no console errors', errors.length === 0, errors);
  } catch (e) {
    console.log('  FAIL  harness threw: ' + (e && e.stack || e));
    t('the harness ran to the end', false);
  } finally { await browser.close(); }
  process.exit(pw.verdict());
})();
