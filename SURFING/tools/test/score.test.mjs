/* The scoring engine, as the pages and the worker run it (score.js).
     node --test SURFING/tools/test/
   The regression table at the end pins today's scores for a few set
   conditions: a deliberate change to the scoring updates it in the same
   commit; an accidental one fails here first. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSite } from '../site.mjs';
import { openMeteo } from './fake-net.mjs';

const site = loadSite();
const spot = (id) => site.CAMS.find((c) => c.id === id);
// A clean groundswell hour, then variations on it.
const base = { t: '2026-10-29T11:00', h: 1.8, p: 13, d: 285, ws: 6, wd: 60, wg: 12, day: 1, tn: 0.5, tdir: 'rising', wwh: 0.1, th: 1.85, h2: null, p2: null, d2: null };

test('distance and sun', () => {
  assert.ok(Math.abs(site.km(38.72, -9.14, 41.15, -8.61) - 274) < 5, 'Lisbon–Porto ~274 km');
  const c = spot('carcavelos');
  assert.ok(site.sunAt(c, { t: '2026-10-28T13:00' }) > 30, 'midday sun high');
  assert.ok(site.sunAt(c, { t: '2026-10-28T18:00' }) < 0 && !site.isDark(c, { t: '2026-10-28T18:00' }), 'just after sunset: last light, not dark');
  assert.ok(site.isDark(c, { t: '2026-10-28T19:00' }), 'an hour later: dark');
  assert.ok(!site.isDark(c, { t: '2026-07-01T21:00' }), 'summer evening still light');
});

test('score: the shape of the scale', () => {
  const c = spot('caparica-cds');
  const good = site.score(c, base);
  assert.ok(good.total >= 6, `clean groundswell scores well (${good.total})`);
  assert.equal(site.score(c, { ...base, h: 0.2, th: 0.25 }).total, 0, 'flat is 0');
  assert.equal(site.score(c, { ...base, h: 0.2, th: 0.25 }).label, 'Flat');
  const onshore = site.score(c, { ...base, ws: 28, wd: 250, wg: 40 });
  assert.ok(onshore.total < good.total - 2, 'a strong onshore costs a lot');
  const outside = site.score(c, { ...base, d: 180 });
  assert.ok(outside.total < good.total, 'swell from outside the window scores less');
  const night = site.score(c, { ...base, t: '2026-10-29T22:00' });
  assert.equal(night.total, 0);
  assert.ok(night.dark && night.lit > 0, 'after dark: 0, but says what it would be with light');
  const dusk = site.score(c, { ...base, t: '2026-10-28T18:00' });
  assert.ok(dusk.factors.some((f) => f.label === 'Light') && dusk.total > 0 && dusk.total < good.total, 'last light scores, a little lower');
  assert.ok(good.total <= 10 && site.score(c, { ...base, p: 18 }).total <= 10);
});

test('score: secondary swell', () => {
  // Cascais bay: a SW swell gets in where the cape blocks a NW one.
  const c = spot('carcavelos');
  const nwOnly = site.score(c, { ...base, h: 1.6, d: 330 });
  const withSW = site.score(c, { ...base, h: 1.6, d: 330, h2: 1.0, p2: 12, d2: 215 });
  assert.ok(withSW.total > nwOnly.total, 'a second swell from a better angle lifts the score');
  // Two swells far apart: the other one is a cross swell, roughing it up.
  const cds = spot('caparica-cds');
  const cross = site.score(cds, { ...base, h2: 1.2, p2: 9, d2: 200 });
  assert.ok(cross.factors.find((f) => f.label === 'Sea state').mult < 1, 'cross swell lowers the sea state');
});

test('blendHour: bias, split swell and an extra model', () => {
  const hourly = { time: ['2026-10-29T11:00'] };
  const set = (v, key, x) => { hourly[`${v}_${key}`] = [x]; };
  for (const m of site.MARINE_MODELS) set('wave_height', m.key, 2.0);
  for (const m of site.MARINE_MODELS.filter((m) => m.key !== 'ecmwf_wam' && !m.ocean)) { set('swell_wave_height', m.key, 1.8); set('swell_wave_direction', m.key, 290); set('swell_wave_period', m.key, 11); }
  set('wave_peak_period', 'ecmwf_wam', 14); set('wave_direction', 'ecmwf_wam', 290);
  const wind = { time: hourly.time };
  for (const m of site.WIND_MODELS) { wind[`wind_speed_10m_${m.key}`] = [10]; wind[`wind_direction_10m_${m.key}`] = [60]; wind[`is_day_${m.key}`] = [1]; }
  const ww = site.WIND_MODELS.map(() => 1), mw = site.MARINE_MODELS.map(() => 1);
  const bh = site.blendHour(hourly, wind, 0, ww, mw);
  const ec = bh.mRows[site.MARINE_MODELS.findIndex((m) => m.key === 'ecmwf_wam')];
  assert.ok(Math.abs(ec.swell_wave_height - 1.8) < 0.05, 'ECMWF swell from its total and the others\' swell share');
  assert.equal(ec.swell_wave_peak_period, 14, 'and its peak period stands in for the swell\'s');
  const ibi = { swell_wave_height: 1.9, wave_height: 2.0, wave_peak_period: 13 };
  const bx = site.blendHour(hourly, wind, 0, ww, mw, [{ model: site.IBI_MODEL, row: ibi, w: 1 }]);
  assert.equal(bx.mModels.at(-1).key, 'cmems_ibi');
  assert.equal(bx.mRows.at(-1).swell_wave_peak_period, 13, 'IBI\'s whole-sea peak period counts for its swell');
  // A model that reads 20% big is brought back before blending.
  site.sharedSkill = { wave: { gwam: { n: 100, hBias: 0.25, hRel: 0.1 } }, wind: {} };
  const bb = site.blendHour(hourly, wind, 0, ww, mw);
  assert.ok(bb.mRows[site.MARINE_MODELS.findIndex((m) => m.key === 'gwam')].wave_height < 1.7, 'size bias taken out');
  site.sharedSkill = null;
});

test('blendSpot: a week, days and sources', () => {
  const c = spot('guincho-norte'), q = (api, extra) => new URL(`https://${api}.open-meteo.com/v1/x?latitude=1&longitude=1&past_days=2&forecast_days=7&${extra}`);
  const m = site.asList(openMeteo(q('marine-api', `hourly=${site.MARINE.join()}&models=${site.modelIds(site.MARINE_MODELS)}`)))[0];
  const w = site.asList(openMeteo(q('api', `hourly=${site.WIND.join()}&models=${site.modelIds(site.WIND_MODELS)}&daily=sunrise,sunset`)))[0];
  const f = site.blendSpot(c, m, w, { keep: (t) => t.endsWith('T12:00') });
  assert.equal(f.days.length, 9, 'two days back, seven ahead');
  for (const d of f.days) {
    assert.equal(d.hours.length, 24);
    assert.ok(d.tides.length >= 3, `${d.date}: highs and lows`);
    assert.equal(`${d.sun.rise}–${d.sun.set}`, '07:05–17:40');   // (objects from the site's own realm: compare values)
    assert.ok(d.conf >= 0 && d.conf <= 1);
    assert.ok(d.hours.every((k) => k.h > 0 && k.ws > 0 && k.tn != null));
  }
  assert.equal(Object.keys(f.kept).length, 9, 'kept one hour a day');
  assert.ok(Object.values(f.kept)[0].src.swell.length >= 5 && Object.values(f.kept)[0].src.wind.length === site.WIND_MODELS.length);
  assert.ok(f.days.at(-1).conf <= f.days[2].conf, 'further out, less sure');
  const g = site.dayDigest(c, f.days[3]);
  assert.ok(g.top >= 0 && g.top <= 10 && g.blocks.length === 4, 'a day summed up: score and its four blocks');
  assert.ok(g.sw.h > 0 && g.sw.d != null && g.wsLo <= g.wsHi && g.hMin <= g.hMax, 'swell, wind and size ranges');
});

test('regression: set conditions keep their scores', () => {
  const table = [
    ['caparica-cds', base, SNAP.cds],
    ['guincho-norte', { ...base, h: 2.6, p: 14, d: 310, ws: 14, wd: 10 }, SNAP.guincho],
    ['nazare-norte', { ...base, h: 3.5, p: 16, d: 300, ws: 4, wd: 90 }, SNAP.nazare],
    ['carcavelos', { ...base, h: 2.2, p: 12, d: 255, ws: 20, wd: 230, wg: 34 }, SNAP.carcavelos],
  ];
  for (const [id, k, want] of table) assert.equal(site.score(spot(id), k).total, want, id);
});
const SNAP = { cds: 9, guincho: 7, nazare: 3, carcavelos: 3.5 };   // guincho 7.5 → 7: its 14 s swell now breaks bigger, past the top of its range; carcavelos 3 → 3.5: SWAN lets a SW swell in (0.91, not the hand rule's 0.52)

test('period: longer swell breaks bigger; the wind sea can be the swell', () => {
  const g = spot('guincho-norte'), k = (p) => ({ ...base, h: 1.5, p, d: 300 });
  const faces = [8, 12, 16].map((p) => site.faceRange(g, k(p))[1]);
  assert.ok(faces[0] < faces[1] && faces[1] < faces[2], 'same height, longer period, bigger faces');
  assert.ok(site.score(g, k(8)).total < site.score(g, k(16)).total, 'and a better score');
  // A small swell under a big nortada windswell: the windswell is what's ridden, not chop on top.
  const ws = { ...base, h: 0.4, p: 11, d: 290, wwh: 1.3, wwp: 7, wwd: 340, ws: 30, wd: 350, th: 1.4 };
  const sw = site.swellTrains(g, ws);
  assert.ok(sw.main.windsea, 'the wind sea is the main train');
  assert.ok(!/wind chop/.test(site.score(g, ws).factors.find((f) => f.label === 'Sea state').now), 'and not counted as chop on itself');
  assert.equal(site.swellTrains(g, { ...ws, wwp: null }).main.windsea, undefined, 'no period, no train');
});

test('SWAN: a spot takes its table, by period and direction', () => {
  // A made-up table for Carcavelos: 0.4 at 6 s to 0.8 at 18 s, the same from
  // every direction; taken as a share of its best (0.8).
  const periods = [6, 8, 10, 12, 14, 16, 18], dirs = [180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 0];
  const k = periods.map((p, i) => dirs.map(() => 0.4 + (0.4 * i) / 6));
  const s2 = loadSite(['spots.js', 'stations.js', 'score.js'], { SWAN: { periods, dirs, nearDepth: 8, spots: { carcavelos: { k } } } });
  const c = s2.CAMS.find((x) => x.id === 'carcavelos'), at = (d, p) => s2.arrival(c, { d, p }, true);
  assert.ok(at(270, 12).swan, 'from the table');
  assert.ok(Math.abs(at(270, 12).arrive - 0.75) < 1e-9, 'at a period in the table');
  assert.ok(Math.abs(at(300, 11).arrive - 0.7083) < 1e-3, 'between periods');
  assert.ok(Math.abs(at(270, 30).arrive - 1) < 1e-9, 'held at the ends: its best, whole');
  assert.equal(at(90, 12).arrive, 0, 'from the land side, nothing');
  assert.ok(at(170, 12).arrive > 0 && at(170, 12).arrive < 0.75, 'fading in just east of south');
  // A spot without a table keeps the hand-set rule.
  assert.equal(s2.arrival(s2.CAMS.find((x) => x.id === 'nazare-norte'), { d: 300, p: 14 }, true).swan, false);
});
