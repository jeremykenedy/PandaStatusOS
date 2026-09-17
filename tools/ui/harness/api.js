#!/usr/bin/env node
'use strict';
/*
 * API harness: the clone's JSON surface (docs/API.md) against the mock. No browser.
 *
 * Two rows in the sweep. Against the factory (PS_CLONE unset) every /api path answers 302
 * like any unknown path, so a page or a tool that probes learns "the factory". Against
 * the clone the read-only routes answer their documents, every switch-gated route answers
 * 302 while its switch is off and 200 with its document once it is on, and a document the
 * device will not take whole is refused whole with 400.
 *
 * Exit 0 when every assertion passes, 1 otherwise. sweep.sh trusts the exit code.
 *
 * Run:  tools/ui/harness/run.sh p2-idle.json api.js [PS_CLONE=1]
 */
const PORT = Number(process.env.PS_PORT || 8199);
const BASE = `http://127.0.0.1:${PORT}`;
const CLONE = process.env.PS_CLONE === '1';
let pass = 0, fail = 0;
function t(name, ok, got) {
  if (ok) { pass++; console.log(`  ok    ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${got !== undefined ? '   got: ' + JSON.stringify(got) : ''}`); }
}
async function get(path) {
  const r = await fetch(BASE + path, { redirect: 'manual' });
  return { status: r.status, body: r.status === 200 ? await r.json() : null, location: r.headers.get('location') };
}
async function post(path, body) {
  const r = await fetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), redirect: 'manual' });
  return { status: r.status, body: r.status === 200 ? await r.json() : null };
}
(async () => {
  await fetch(BASE + '/__reset', { method: 'POST' });
  const paths = ['/api/info', '/api/state', '/api/features', '/api/preview', '/api/presets', '/api/stages'];
  if (!CLONE) {
    for (const p of paths) { const r = await get(p); t(`factory: GET ${p} answers 302 to the portal like any unknown path`, r.status === 302 && /^http:\/\//.test(r.location || ''), r.status); }
    const w = await post('/api/features', { features: { state_brightness: true } });
    t('factory: POST /api/features answers 302 too', w.status === 302, w.status);
  } else {
    let r = await get('/api/info');
    t('clone: GET /api/info answers the identification document', r.status === 200 && !!r.body && r.body.product === 'PandaStatusOS' && typeof r.body.build === 'string'
      && typeof r.body.version === 'string' && typeof r.body.uptime_s === 'number' && typeof r.body.leds === 'number' && typeof r.body.features === 'number' && r.body.config_layout === 'PS04', r.body);
    t('clone: /api/info carries no network name, address, serial or credential', r.status === 200 && !/ssid|"ip"|"sn"|password|access_code|mac/i.test(JSON.stringify(r.body)), Object.keys(r.body || {}));
    r = await get('/api/state');
    t('clone: GET /api/state is the six-root document the socket pushes on connect', r.status === 200 && !!r.body && Object.keys(r.body).length === 6
      && ['wifi', 'sta', 'ap', 'printer', 'settings', 'block'].every((k) => k in r.body), Object.keys(r.body || {}));
    r = await get('/api/features');
    t('clone: GET /api/features answers the features document with every switch off', r.status === 200 && !!r.body && Object.values(r.body.features).every((v) => v === false), r.body && r.body.features);
    for (const p of ['/api/preview', '/api/presets', '/api/stages']) { const g = await get(p); t(`clone: ${p} answers 302 while its switch is off`, g.status === 302, g.status); }
    let w = await post('/api/features', { features: { state_effects: true, preview: true, presets: true, stage_effects: true } });
    t('clone: one document turns four switches on', w.status === 200 && !!w.body && w.body.features.preview && w.body.features.presets && w.body.features.stage_effects, w.status);
    for (const p of ['/api/preview', '/api/presets', '/api/stages']) { const g = await get(p); t(`clone: ${p} answers 200 with its document once its switch is on`, g.status === 200 && !!g.body, g.status); }
    w = await post('/api/features', { features: { nonsense: true } }); t('clone: an unknown switch is refused whole (400)', w.status === 400, w.status);
    w = await post('/api/features', { config: { state_brightness: [[50, 50, 50], [50, 50, 500]] } }); t('clone: a value out of range is refused whole (400)', w.status === 400, w.status);
    w = await post('/api/preview', { state: 2, seconds: 5 }); t('clone: a preview pin answers its document, active', w.status === 200 && !!w.body && w.body.active === true && w.body.state === 2, w.body);
    w = await post('/api/preview', { seconds: 0 }); t('clone: clearing the pin answers inactive', w.status === 200 && !!w.body && w.body.active === false, w.body);
    w = await post('/api/presets', { presets: [{ name: 'Ember', effect: 1 }] }); t('clone: a preset saved answers the list', w.status === 200 && !!w.body && w.body.presets.length === 1 && w.body.presets[0].name === 'Ember' && w.body.presets[0].effect === 1, w.body);
    w = await post('/api/stages', { assign: { stage: 1, name: 'Ember' } }); t('clone: a stage assigned answers the table with that row set', w.status === 200 && !!w.body && w.body.stages[1].set === true && w.body.stages[1].name === 'Ember', w.body && w.body.stages[1]);
    w = await post('/api/features', { features: { state_effects: false, preview: false, presets: false, stage_effects: false } }); t('clone: the switches off again in one document', w.status === 200, w.status);
    r = await get('/api/presets'); t('clone: a gated route is gone again with its switch off (302)', r.status === 302, r.status);
    r = await get('/api/info'); t('clone: /api/info reports the switch bits as a number, zero again', r.status === 200 && !!r.body && r.body.features === 0, r.body && r.body.features);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('  FAIL  harness threw: ' + e.message); process.exit(1); });
