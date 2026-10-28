#!/usr/bin/env node
/* Scheduled verification: how well does each forecast model match what
   was actually measured on this coast?

     Wind  — IPMA's station network (hourly, open data) vs every wind
             model's value for that hour at the station.
     Waves — Instituto Hidrográfico buoys off Nazaré and Sines, via EMODnet
             Physics ERDDAP (open), vs every wave model at the buoy.

   Each new measured hour nudges a running average miss per model (EMA), so
   the numbers reflect recent weeks rather than one day. The pages read the
   result from SURFING/data/skill.json and weight models by it.

   Run by .github/workflows/surf-skill.yml every few hours; also fine by
   hand:  node SURFING/tools/skill.mjs */
import fs from 'node:fs';
import { createHmac } from 'node:crypto';

const UA = 'allfield-surfcams/1.0 (oclarke@routeware.com)';
const OUT = new URL('../data/skill.json', import.meta.url);
const read = (u) => fs.readFileSync(new URL(u, import.meta.url), 'utf8');
const { CAMS } = new Function(read('../spots.js') + '; return { CAMS };')();
const { WIND_MODELS, MARINE_MODELS, angleDiff } = new Function(read('../score.js') + '; return { WIND_MODELS, MARINE_MODELS, angleDiff };')();

const prev = (() => { try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return null; } })();
const out = {
  updated: new Date().toISOString(),
  wind: (prev && prev.wind) || {}, wave: (prev && prev.wave) || {},
  lastWindObs: (prev && prev.lastWindObs) || '', lastWaveObs: (prev && prev.lastWaveObs) || '',
  runs: ((prev && prev.runs) || 0) + 1, stations: [], buoys: [],
};
const A = 0.05;   // EMA step per measured hour: ~a fortnight of hourly data to turn over
const ema = (s, key, err) => { if (err == null || Number.isNaN(err)) return; s[key] = s[key] == null ? err : s[key] + A * (err - s[key]); };

async function getJson(url, init) {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init && init.headers) } });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 90)}`);
  return r.json();
}
const km = (a, b, c, d) => { const R = 6371, t = (x) => x * Math.PI / 180; const x = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const hourKey = (iso) => iso.slice(0, 13);   // "2026-10-27T10"

/* ---------- Wind vs IPMA stations ---------- */
const IPMA_DIR = [null, 0, 45, 90, 135, 180, 225, 270, 315, 0];
async function verifyWind() {
  const base = 'https://api.ipma.pt/open-data/observation/meteorology/stations/';
  const [stations, obs] = await Promise.all([getJson(base + 'stations.json'), getJson(base + 'observations.json')]);
  // Stations within 50 km of any cam — the same ones the page may show.
  const near = stations.filter((s) => { const [lon, lat] = s.geometry.coordinates; return CAMS.some((c) => km(c.lat, c.lng, lat, lon) <= 50); });
  out.stations = near.map((s) => s.properties.localEstacao.replace(/\s*\(.*\)$/, ''));
  const hours = Object.keys(obs).filter((h) => h > out.lastWindObs).sort();
  if (!hours.length) { console.log('wind: no new station hours'); return; }
  const lat = near.map((s) => s.geometry.coordinates[1]).join(','), lng = near.map((s) => s.geometry.coordinates[0]).join(',');
  const models = WIND_MODELS.map((m) => m.key).join();
  const fc = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=wind_speed_10m,wind_direction_10m&models=${models}&past_days=2&forecast_days=1&timezone=UTC`);
  const F = Array.isArray(fc) ? fc : [fc];
  let n = 0;
  near.forEach((s, i) => {
    const h = F[i] && F[i].hourly; if (!h) return;
    const idx = Object.fromEntries(h.time.map((t, j) => [hourKey(t), j]));
    const id = String(s.properties.idEstacao);
    for (const hr of hours) {
      const o = obs[hr] && obs[hr][id];
      if (!o || o.intensidadeVentoKM == null || o.intensidadeVentoKM < 0) continue;
      const j = idx[hourKey(hr)]; if (j == null) continue;
      const od = IPMA_DIR[o.idDireccVento] ?? null;
      for (const m of WIND_MODELS) {
        const ws = h[`wind_speed_10m_${m.key}`], wd = h[`wind_direction_10m_${m.key}`];
        if (!ws || ws[j] == null) continue;
        const s2 = out.wind[m.key] = out.wind[m.key] || { n: 0, dir: null, spd: null };
        s2.n++;
        ema(s2, 'spd', Math.abs(ws[j] - o.intensidadeVentoKM));
        if (od != null && o.intensidadeVentoKM >= 8 && wd && wd[j] != null) ema(s2, 'dir', angleDiff(wd[j], od));
      }
      n++;
    }
  });
  out.lastWindObs = hours[hours.length - 1];
  console.log(`wind: ${n} station-hours from ${near.length} stations, up to ${out.lastWindObs}`);
}

/* ---------- Waves vs IH buoys ---------- */
const BUOYS = [
  { id: 'nazare', name: 'Nazaré / Pedrógão coastal buoy (IH)', ds: 'TS_70_6200199_MO_UND', lat: 39.56, lng: -9.21 },
  { id: 'sines', name: 'Sines coastal buoy (IH)', ds: 'TS_70_Sines-coast-buoy_MO_UND', lat: 37.9211, lng: -8.9289 },
];
async function verifyWaves() {
  out.lastWave = out.lastWave || {};
  const floor = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 19) + 'Z';
  const lat = BUOYS.map((b) => b.lat).join(','), lng = BUOYS.map((b) => b.lng).join(',');
  const models = MARINE_MODELS.map((m) => m.id || m.key).join();
  const fc = await getJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_direction,swell_wave_peak_period,swell_wave_height&models=${models}&past_days=10&forecast_days=1&timezone=UTC`);
  const F = Array.isArray(fc) ? fc : [fc];
  let total = 0;
  for (let bi = 0; bi < BUOYS.length; bi++) {
    const b = BUOYS[bi], h = F[bi] && F[bi].hourly;
    if (!h) continue;
    const last = out.lastWave[b.id] || out.lastWaveObs || '';
    const since = last > floor ? last : floor;
    let rows;
    try {
      // VPED = direction at the spectral peak, carried by both buoys (VMDR isn't).
      const r = await fetch(`https://platform-erddap.emodnet-physics.eu/erddap/tabledap/${b.ds}.json?time,VHM0,VTPK,VPED&time%3E=${since}&orderBy(%22time%22)`, { headers: { 'User-Agent': UA } });
      if (r.status === 404) { console.log(`waves: ${b.id} nothing new since ${since.slice(0, 16)}`); out.buoys.push({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, hours: 0, latest: last || null }); continue; }
      if (!r.ok) throw new Error(String(r.status));
      rows = (await r.json()).table.rows;
    } catch (e) { console.log(`waves: ${b.id} unavailable (${e.message})`); continue; }
    // Rows come split by parameter; fold them by hour.
    const byHour = {};
    for (const [t, H, T, D] of rows) {
      const k = hourKey(t), r = byHour[k] = byHour[k] || { t };
      if (H != null) r.h = H; if (T != null) r.p = T; if (D != null) r.d = D;
    }
    const idx = Object.fromEntries(h.time.map((t, j) => [hourKey(t), j]));
    let n = 0, newest = last;
    for (const r of Object.values(byHour)) {
      if (r.h == null || r.t <= last) continue;
      const j = idx[hourKey(r.t)]; if (j == null) continue;
      for (const m of MARINE_MODELS) {
        const key = m.key, mid = m.id || m.key;
        const hm = h[`wave_height_${key}`], pm = h[`swell_wave_peak_period_${key}`], dm = h[`wave_direction_${key}`];
        if (!hm || hm[j] == null || hm[j] <= 0.05) continue;
        const s = out.wave[mid] = out.wave[mid] || { n: 0, hRel: null, p: null, dir: null };
        s.n++;
        ema(s, 'hRel', Math.abs(hm[j] - r.h) / r.h);
        if (r.p != null && pm && pm[j] != null) ema(s, 'p', Math.abs(pm[j] - r.p));
        if (r.d != null && dm && dm[j] != null) ema(s, 'dir', angleDiff(dm[j], r.d));
      }
      if (r.t > newest) newest = r.t;
      n++;
    }
    if (newest) out.lastWave[b.id] = newest;
    out.buoys.push({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, hours: n, latest: newest || null });
    total += n;
  }
  out.lastWaveObs = Object.values(out.lastWave).sort().pop() || out.lastWaveObs;
  console.log(`waves: ${total} buoy-hours; latest ${JSON.stringify(out.lastWave)}`);
}

/* ---------- Pooled feedback → per-spot calibration ----------
   data/feedback.json holds every verdict we know about: pulled from the
   Cloudflare worker (tools/worker/feedback.js) when FEEDBACK_URL and
   FEEDBACK_KEY are set, and/or pasted in by hand from the tune panel's
   "Copy feedback log". A spot's calibration shrinks or grows its score by
   how lopsided the verdicts are: 60% "too high" and 0% "too low" → ×0.86. */
const FB_FILE = new URL('../data/feedback.json', import.meta.url);
const SS_FILE = new URL('../data/sessions.json', import.meta.url);
const readList = (f) => { try { const l = JSON.parse(fs.readFileSync(f, 'utf8')); return Array.isArray(l) ? l : []; } catch { return []; } };
async function pullFeedback() {
  const list = readList(FB_FILE), sessions = readList(SS_FILE);
  const url = process.env.FEEDBACK_URL, key = process.env.FEEDBACK_KEY;
  if (url && key) {
    // One export since the newest report of either kind we already hold.
    const since = [...list, ...sessions].map((e) => e.t).sort().pop() || '';
    try {
      const j = await getJson(`${url.replace(/\/$/, '')}/export?key=${encodeURIComponent(key)}&since=${encodeURIComponent(since)}`);
      // This repo is public: names, accounts and devices stay in the
      // worker. What lands here is the report plus a keyed hash of the
      // account id (older reports: the device id), so one person's reports
      // can still be weighed together.
      const anon = (e) => {
        const { name, dev, uid, ...rest } = e;
        if (uid) rest.who = 'u' + createHmac('sha256', key).update(uid).digest('hex').slice(0, 12);
        else if (dev && dev.id) rest.who = 'd' + createHmac('sha256', key).update(dev.id).digest('hex').slice(0, 12);
        return rest;
      };
      j.verdicts = (j.verdicts || []).map(anon);
      j.sessions = (j.sessions || []).map(anon);
      const seen = new Set(list.map((e) => `${e.t}|${e.id}|${e.verdict}`));
      for (const e of j.verdicts || []) { const k = `${e.t}|${e.id}|${e.verdict}`; if (!seen.has(k)) { list.push(e); seen.add(k); } }
      const seenS = new Set(sessions.map((e) => `${e.t}|${e.id}|${e.local}`));
      let nS = 0;
      for (const e of j.sessions || []) { const k = `${e.t}|${e.id}|${e.local}`; if (!seenS.has(k)) { sessions.push(e); seenS.add(k); nS++; } }
      console.log(`feedback: ${j.count || 0} verdicts and ${nS} sessions pulled from the worker`);
    } catch (e) { console.log('feedback: worker unavailable', e.message); }
  }
  sessions.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(SS_FILE, JSON.stringify(sessions, null, 0) + '\n');
  try { out.learned = trainSessions(sessions); } catch (e) { console.log('sessions: training failed', e.message); }
  list.sort((a, b) => String(a.t).localeCompare(String(b.t)));
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(FB_FILE, JSON.stringify(list, null, 0) + '\n');
  const cal = {};
  for (const id of new Set(list.map((e) => e.id))) {
    const v = list.filter((e) => e.id === id);
    const n = v.length, high = v.filter((e) => e.verdict === 'high').length, low = v.filter((e) => e.verdict === 'low').length;
    const lean = (high - low) / n;                               // +1 all too high … −1 all too low
    const f = Math.max(0.7, Math.min(1.15, 1 - 0.25 * lean));    // ×0.75 at the extreme
    cal[id] = { n, high, low, f: +f.toFixed(3) };
  }
  out.calibration = cal;
  console.log(`feedback: ${list.length} verdicts across ${Object.keys(cal).length} spots`);
}

/* ---------- Logged sessions → learned score adjustments ----------
   Each session says what it was actually like (Flat … Epic, and the wave
   size) for hours whose forecast we saved. We score those hours with the
   plain rules (score.js, nothing learned applied, current spot settings)
   and fit how far off we were, as small adjustments per kind of
   conditions (score.js FEATURES: tide, wind, size, period, angle):

     coast  ridge regression over every session on every spot
     spot   ridge regression of what's left, per spot, on top of the coast

   Ridge pulls every adjustment towards zero, so the hand-set spot
   knowledge stays in charge until reports agree with each other. Sizes:
   the log ratio of the face height people saw to the one we predicted,
   shrunk the same way (coast, then spot), becomes a per-spot gain on how
   much swell reaches the beach.

   Honesty: a report more than 6 points from our score is set aside (wrong
   spot, wrong day, or a wind-up); the rest are clipped at ±4. Each
   sender's reports on a spot share one vote's weight as they pile up
   (1/√n each), and a report loses half its weight per year of age. */
const SC = new Function(read('../score.js') + '; return { score, features, faceRange, FEATURES, SESSION_TARGET, SIZE_FACE };')();
const LAMBDA_COAST = 8, LAMBDA_SPOT = 5, OUTLIER = 6, CLIP = 4;

// Solve A·x = b (small, symmetric positive definite) by Gaussian elimination.
function solve(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}
// Weighted ridge over one-hot features; rows are { x, r, w }.
function ridge(rows, lambda) {
  const F = SC.FEATURES, d = F.length;
  const A = Array.from({ length: d }, () => Array(d).fill(0)), b = Array(d).fill(0);
  for (const { x, r, w } of rows) {
    const v = F.map((f) => x[f] || 0);
    for (let i = 0; i < d; i++) {
      if (!v[i]) continue;
      b[i] += w * v[i] * r;
      for (let j = 0; j < d; j++) if (v[j]) A[i][j] += w * v[i] * v[j];
    }
  }
  for (let i = 0; i < d; i++) A[i][i] += lambda;
  const sol = solve(A, b);
  return Object.fromEntries(F.map((f, i) => [f, +sol[i].toFixed(3)]).filter(([, v]) => Math.abs(v) >= 0.005));
}
const dot = (w, x) => Object.keys(x).reduce((s, f) => s + ((w && w[f]) || 0) * x[f], 0);
const rmse = (a) => (a.length ? +Math.sqrt(a.reduce((s, e) => s + e * e, 0) / a.length).toFixed(2) : null);

function trainSessions(sessions) {
  const now = Date.now(), rows = [], srows = [];
  let setAside = 0, unusable = 0;
  for (const s of sessions) {
    const c = CAMS.find((x) => x.id === s.id);
    const hrs = (s.hours || []).filter((h) => h && h.k && h.k.h != null && h.k.ws != null);
    if (!c || !hrs.length || SC.SESSION_TARGET[s.rating] == null) { unusable++; continue; }
    // Surface: how much cleaner (−) or messier (+) than the wind-based word.
    const midK = hrs[Math.floor((hrs.length - 1) / 2)].k, midR = SC.score(c, midK);
    if (s.surface != null && midR && midR.surface && midK.day !== 0) {
      const age = (now - Date.parse(s.start || s.t)) / 864e5;
      srows.push({ id: c.id, who: s.who || '?', x: SC.features(c, midK), r: Math.max(-3, Math.min(3, s.surface - midR.surface.base)), ageW: Math.pow(0.5, Math.max(0, age) / 365) });
    }
    const rs = hrs.map((h) => SC.score(c, h.k)).filter(Boolean);
    // Dark or flat hours are never adjusted live, so they can't teach the adjustment.
    if (!rs.length || rs.every((r) => r.total === 0 && r.cap)) { unusable++; continue; }
    const model = rs.reduce((a, r) => a + r.total, 0) / rs.length;
    const r = SC.SESSION_TARGET[s.rating] - model;
    if (Math.abs(r) > OUTLIER) { setAside++; continue; }
    const mid = hrs[Math.floor((hrs.length - 1) / 2)].k;
    const faces = hrs.map((h) => SC.faceRange(c, h.k, true)), pred = faces.reduce((a, f) => a + (f[0] + f[1]) / 2, 0) / faces.length;
    const age = (now - Date.parse(s.start || s.t)) / 864e5;
    rows.push({ id: c.id, who: s.who || '?', x: SC.features(c, mid), r: Math.max(-CLIP, Math.min(CLIP, r)), model, ageW: Math.pow(0.5, Math.max(0, age) / 365),
      size: s.size, pred });
  }
  // One sender's reports on one spot share out their weight as they pile up.
  const per = {};
  for (const x of rows) per[`${x.who}|${x.id}`] = (per[`${x.who}|${x.id}`] || 0) + 1;
  for (const x of rows) x.w = x.ageW / Math.sqrt(per[`${x.who}|${x.id}`]);

  const coastW = ridge(rows, LAMBDA_COAST);
  const ids = [...new Set(rows.map((x) => x.id))];
  const spotW = {};
  for (const id of ids) spotW[id] = ridge(rows.filter((x) => x.id === id).map((x) => ({ ...x, r: x.r - dot(coastW, x.x) })), LAMBDA_SPOT);
  const predict = (x) => Math.max(-3, Math.min(3, (rows.length >= 15 ? dot(coastW, x.x) : 0) + (rows.filter((y) => y.id === x.id).length >= 3 ? dot(spotW[x.id], x.x) : 0)));

  // Leave-one-out error for an honest "did it help?", while it's cheap.
  let loo = null;
  if (rows.length >= 5 && rows.length <= 400) {
    const errs = rows.map((x, i) => {
      const rest = rows.filter((_, j) => j !== i);
      const cw = ridge(rest, LAMBDA_COAST);
      const mine = rest.filter((y) => y.id === x.id);
      const sw = ridge(mine.map((y) => ({ ...y, r: y.r - dot(cw, y.x) })), LAMBDA_SPOT);
      const p = Math.max(-3, Math.min(3, (rest.length >= 15 ? dot(cw, x.x) : 0) + (mine.length >= 3 ? dot(sw, x.x) : 0)));
      return x.r - p;
    });
    loo = rmse(errs);
  }

  // Sizes: log(seen / predicted) faces, coast then spot, shrunk to no change.
  const sz = rows.filter((x) => x.size > 0 && x.pred >= 0.2).map((x) => ({ ...x, lr: Math.max(-0.9, Math.min(0.9, Math.log(SC.SIZE_FACE[x.size] / x.pred))) }));
  const sw = sz.reduce((a, x) => a + x.w, 0);
  const coastLr = sz.reduce((a, x) => a + x.w * x.lr, 0) / (sw + 10);
  const gain = (lr) => +Math.max(0.6, Math.min(1.6, Math.exp(lr))).toFixed(3);

  const spots = {};
  for (const id of ids) {
    const mine = rows.filter((x) => x.id === id), ms = sz.filter((x) => x.id === id);
    const msw = ms.reduce((a, x) => a + x.w, 0);
    const spotLr = ms.reduce((a, x) => a + x.w * (x.lr - coastLr), 0) / (msw + 5);
    spots[id] = {
      n: mine.length, w: spotW[id],
      bias: +(mine.reduce((a, x) => a + x.r, 0) / mine.length).toFixed(2),
      rmse: { before: rmse(mine.map((x) => x.r)), after: rmse(mine.map((x) => x.r - predict(x))) },
      size: { n: ms.length, gain: gain(coastLr + spotLr) },
    };
  }
  // Surface: the same two-level fit, on steps cleaner or messier.
  const perS = {};
  for (const x of srows) perS[`${x.who}|${x.id}`] = (perS[`${x.who}|${x.id}`] || 0) + 1;
  for (const x of srows) x.w = x.ageW / Math.sqrt(perS[`${x.who}|${x.id}`]);
  const surfCoast = ridge(srows, LAMBDA_COAST), surfSpots = {};
  for (const id of new Set(srows.map((x) => x.id))) {
    const mine = srows.filter((x) => x.id === id);
    surfSpots[id] = { n: mine.length, w: ridge(mine.map((x) => ({ ...x, r: x.r - dot(surfCoast, x.x) })), LAMBDA_SPOT), bias: +(mine.reduce((a, x) => a + x.r, 0) / mine.length).toFixed(2) };
  }

  const learned = {
    updated: new Date().toISOString(), sessions: sessions.length, used: rows.length, setAside, unusable,
    surface: { coast: { n: srows.length, w: surfCoast }, spots: surfSpots },
    coast: { n: rows.length, w: coastW, size: { n: sz.length, gain: gain(coastLr) },
      rmse: { before: rmse(rows.map((x) => x.r)), after: rmse(rows.map((x) => x.r - predict(x))), loo } },
    spots,
  };
  console.log(`sessions: ${sessions.length} logged, ${rows.length} used, ${setAside} set aside, ${unusable} unusable; error ${learned.coast.rmse.before} → ${learned.coast.rmse.after} pts (leave-one-out ${loo ?? '-'}); ${srows.length} surface reports`);
  return learned;
}

(async () => {
  try { await verifyWind(); } catch (e) { console.log('wind failed:', e.message); }
  try { await verifyWaves(); } catch (e) { console.log('waves failed:', e.message); }
  try { await pullFeedback(); } catch (e) { console.log('feedback failed:', e.message); }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, Object.fromEntries(Object.entries(s).map(([a, v]) => [a, typeof v === 'number' && a !== 'n' ? +v.toFixed(3) : v]))]));
  out.wind = round(out.wind); out.wave = round(out.wave);
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log('wind:', Object.entries(out.wind).map(([k, s]) => `${k} n${s.n} dir${s.dir == null ? '-' : Math.round(s.dir)} spd${s.spd == null ? '-' : s.spd.toFixed(1)}`).join(' | '));
  console.log('wave:', Object.entries(out.wave).map(([k, s]) => `${k} n${s.n} h${s.hRel == null ? '-' : Math.round(s.hRel * 100) + '%'} p${s.p == null ? '-' : s.p.toFixed(1)} dir${s.dir == null ? '-' : Math.round(s.dir)}`).join(' | '));
})();
