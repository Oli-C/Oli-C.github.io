#!/usr/bin/env node
/* Scheduled verification: how well does each forecast model match what
   was actually measured on this coast, and how does that hold up days
   ahead?

     Wind  — IPMA weather stations (the one nearest each spot) and the
             anemometers on the Nazaré, Silleiro and Cádiz buoys, against
             what every wind model said 0–6 days before each measured hour
             (Open-Meteo's previous-runs archive keeps those).
     Waves — six IH / Puertos del Estado buoys (Nazaré, Sines, Leixões,
             Faro, Silleiro, Cádiz; via EMODnet Physics ERDDAP) against
             every wave model's latest run, and, from the worker's history
             database (tools/worker/history.js), against what each model
             said 1–7 days before.

   Each model gets, per lead day, its mean miss (wind km/h and degrees;
   wave height as a share after removing its size bias, peak period s,
   direction °) and its size bias. Means fade with a three-week memory, so
   they follow the season. The pages weight the models by these (score.js,
   modelWeight / waveWeight / waveBias) and the worker does the same.

   The first run of this version (or --backfill) seeds everything from the
   last 60 days of buoy records, so the weights are evidence-based at once.

   Run by .github/workflows/surf-skill.yml every few hours; also fine by
   hand:  node SURFING/tools/skill.mjs [--backfill] */
import fs from 'node:fs';
import { createHmac } from 'node:crypto';

const UA = 'allfield-surfcams/1.0 (oclarke@routeware.com)';
const OUT = new URL('../data/skill.json', import.meta.url);
const read = (u) => fs.readFileSync(new URL(u, import.meta.url), 'utf8');
const { CAMS } = new Function(read('../spots.js') + '; return { CAMS };')();
const { WIND_MODELS, MARINE_MODELS, angleDiff } = new Function(read('../score.js') + '; return { WIND_MODELS, MARINE_MODELS, angleDiff };')();
const WORKER = (process.env.FEEDBACK_URL || 'https://surf-feedback.odj-clarke.workers.dev').replace(/\/+$/, '');

const VERSION = 2;
const prev = (() => { try { const p = JSON.parse(fs.readFileSync(OUT, 'utf8')); return p; } catch { return null; } })();
const fresh = !prev || prev.v !== VERSION || process.argv.includes('--backfill');
const out = {
  v: VERSION, updated: new Date().toISOString(),
  wind: (!fresh && prev.wind) || {}, wave: (!fresh && prev.wave) || {},
  lastWindObs: (!fresh && prev.lastWindObs) || '', lastBuoyWind: (!fresh && prev.lastBuoyWind) || {}, lastWave: (!fresh && prev.lastWave) || {},
  runs: ((prev && prev.runs) || 0) + 1, stations: [], buoys: [],
};
const LEADS = 7;            // 0 = today … 6 days ahead
const TAU = 21 * 24;        // hours: old evidence fades with a three-week time constant
const BUOY_WIND_10M = 1.09; // buoy anemometers sit ~3–4 m up; a log profile over sea puts 10 m ~9% higher

async function getJson(url, init) {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init && init.headers) } });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 90)}`);
  return r.json();
}
const km = (a, b, c, d) => { const R = 6371, t = (x) => x * Math.PI / 180; const x = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
const hourKey = (iso) => iso.slice(0, 13);   // "2026-10-27T10"
const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 19) + 'Z';

/* ---------- Running means ----------
   A stat is { n, <field>: mean, …, w: { <field>: weight }, at }. Folding in
   a batch of sums first fades the old weight by how long it's been. */
const acc = () => ({});
function add(a, model, lead, field, v) {
  if (v == null || Number.isNaN(v)) return;
  const s = ((a[model] = a[model] || {})[lead] = a[model][lead] || {});
  const f = (s[field] = s[field] || [0, 0]);
  f[0] += v; f[1]++;
}
function fold(stat, sums, main) {
  const now = out.updated, age = stat.at ? Math.max(0, (Date.parse(now) - Date.parse(stat.at)) / 3.6e6) : 0, keep = Math.exp(-age / TAU);
  stat.w = stat.w || {};
  for (const f of Object.keys(stat.w)) stat.w[f] *= keep;
  for (const [f, [sum, c]] of Object.entries(sums)) {
    if (!c) continue;
    const w0 = stat.w[f] || 0;
    stat[f] = ((stat[f] || 0) * w0 + sum) / (w0 + c);
    stat.w[f] = w0 + c;
  }
  stat.n = Math.round(stat.w[main] || 0);
  stat.at = now;
  return stat;
}
// Fold a batch into out[kind]: per model, a stat per lead; lead 0 is also
// the model's top-level numbers (what older pages read).
function foldAll(kind, a, main) {
  for (const [model, byLead] of Object.entries(a)) {
    const s = out[kind][model] = out[kind][model] || { lead: [] };
    s.lead = s.lead || [];
    for (const [lead, sums] of Object.entries(byLead)) s.lead[lead] = fold(s.lead[lead] || {}, sums, main);
    for (let d = 0; d < s.lead.length; d++) if (!s.lead[d]) s.lead[d] = null;
    const top = s.lead[0];
    if (top) for (const f of Object.keys(top)) if (f !== 'w' && f !== 'at') s[f] = top[f];
  }
}

/* ---------- Wind ---------- */
const IPMA_DIR = [null, 0, 45, 90, 135, 180, 225, 270, 315, 0];
const WIND_BUOYS = [
  { id: 'nazare', ds: 'TS_70_6200199_MO_UND', lat: 39.56, lng: -9.21 },
  { id: 'silleiro', ds: 'TS_70_6200084_MO_UND', lat: 42.12, lng: -9.43 },
  { id: 'cadiz', ds: 'TS_70_6200085_MO_UND', lat: 36.49, lng: -6.96 },
];
// Every model's speed and direction for these points, as forecast 0–6 days
// before each hour: { [pointIndex]: { [hourKey]: { [model]: [[ws, wd] per lead] } } }.
async function windForecasts(points, pastDays) {
  const vars = [];
  for (let d = 0; d < LEADS; d++) for (const v of ['wind_speed_10m', 'wind_direction_10m']) vars.push(d ? `${v}_previous_day${d}` : v);
  const res = {};
  // One model per request keeps each response small and lets a model
  // missing a lead (shorter horizon) fail on its own.
  for (const m of WIND_MODELS) {
    let fc;
    try { fc = await getJson(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p.lat).join(',')}&longitude=${points.map((p) => p.lng).join(',')}&hourly=${vars.join()}&models=${m.key}&past_days=${pastDays}&forecast_days=0&timezone=UTC`); }
    catch (e) { console.log(`wind: ${m.key} unavailable (${e.message})`); continue; }
    (Array.isArray(fc) ? fc : [fc]).forEach((x, pi) => {
      const h = x && x.hourly; if (!h) return;
      const get = (v, i) => { const s = h[v] || h[`${v}_${m.key}`]; return s ? s[i] : null; };
      h.time.forEach((t, i) => {
        const row = [];
        for (let d = 0; d < LEADS; d++) { const sfx = d ? `_previous_day${d}` : ''; row.push([get(`wind_speed_10m${sfx}`, i), get(`wind_direction_10m${sfx}`, i)]); }
        (((res[pi] = res[pi] || {})[hourKey(t)] = res[pi][hourKey(t)] || {})[m.key] = row);
      });
    });
  }
  return res;
}
function scoreWind(a, fcAt, obsWs, obsWd) {
  for (const [model, row] of Object.entries(fcAt || {})) {
    row.forEach(([ws, wd], lead) => {
      if (ws == null) return;
      add(a, model, lead, 'spd', Math.abs(ws - obsWs));
      if (obsWd != null && obsWs >= 8 && wd != null) add(a, model, lead, 'dir', angleDiff(wd, obsWd));
    });
  }
}
async function erddap(ds, vars, since) {
  const r = await fetch(`https://platform-erddap.emodnet-physics.eu/erddap/tabledap/${ds}.json?time,${vars.join(',')}&time%3E${since}&orderBy(%22time%22)`, { headers: { 'User-Agent': UA } });
  if (r.status === 404) return {};
  if (!r.ok) throw new Error(String(r.status));
  const byHour = {};
  for (const row of (await r.json()).table.rows) {
    const o = byHour[hourKey(row[0])] = byHour[hourKey(row[0])] || { t: row[0] };
    vars.forEach((v, i) => { const x = row[i + 1]; if (typeof x === 'number' && Number.isFinite(x)) o[v] = x; });
  }
  return byHour;
}

async function verifyWind() {
  const a = acc();
  let n = 0;
  // IPMA: the station nearest each spot (within 50 km), every hour not yet counted.
  const base = 'https://api.ipma.pt/open-data/observation/meteorology/stations/';
  const [stations, obs] = await Promise.all([getJson(base + 'stations.json'), getJson(base + 'observations.json')]);
  const near = new Map();
  for (const c of CAMS) {
    let best = null;
    for (const s of stations) { const [lon, lat] = s.geometry.coordinates, d = km(c.lat, c.lng, lat, lon); if (d <= 50 && (!best || d < best.d)) best = { s, d }; }
    if (best) near.set(String(best.s.properties.idEstacao), best.s);
  }
  const pts = [...near.values()].map((s) => ({ id: String(s.properties.idEstacao), name: s.properties.localEstacao.replace(/\s*\(.*\)$/, ''), lat: s.geometry.coordinates[1], lng: s.geometry.coordinates[0] }));
  out.stations = pts.map((p) => p.name);
  const hours = Object.keys(obs).filter((h) => h > out.lastWindObs).sort();
  if (hours.length && pts.length) {
    const F = await windForecasts(pts, 2);
    pts.forEach((p, pi) => {
      for (const hr of hours) {
        const o = obs[hr] && obs[hr][p.id];
        if (!o || o.intensidadeVentoKM == null || o.intensidadeVentoKM < 0) continue;
        scoreWind(a, F[pi] && F[pi][hourKey(hr)], o.intensidadeVentoKM, IPMA_DIR[o.idDireccVento] ?? null);
        n++;
      }
    });
    out.lastWindObs = hours[hours.length - 1];
  }
  // Buoy anemometers: EMODnet lags a day or more; pick up from the last hour counted.
  const bOut = [];
  const bObs = [];
  for (const b of WIND_BUOYS) {
    const since = fresh ? daysAgo(60) : (out.lastBuoyWind[b.id] && out.lastBuoyWind[b.id] > daysAgo(20) ? out.lastBuoyWind[b.id] : daysAgo(20));
    try { bObs.push([b, Object.values(await erddap(b.ds, ['WSPD', 'WDIR'], since)).filter((o) => o.WSPD != null)]); }
    catch (e) { console.log(`wind: buoy ${b.id} unavailable (${e.message})`); }
  }
  const withObs = bObs.filter(([, rows]) => rows.length);
  if (withObs.length) {
    const oldest = withObs.map(([, rows]) => rows[0].t).sort()[0];
    const past = Math.min(92, Math.ceil((Date.now() - Date.parse(oldest)) / 864e5) + 1);
    const F = await windForecasts(withObs.map(([b]) => b), past);
    withObs.forEach(([b, rows], pi) => {
      for (const o of rows) { scoreWind(a, F[pi] && F[pi][hourKey(o.t)], o.WSPD * 3.6 * BUOY_WIND_10M, o.WDIR ?? null); n++; }
      out.lastBuoyWind[b.id] = rows[rows.length - 1].t;
      bOut.push(`${b.id} ${rows.length} h`);
    });
  }
  foldAll('wind', a, 'spd');
  console.log(`wind: ${n} measured hours (${hours.length} station hours, buoys: ${bOut.join(', ') || 'none new'})`);
}

/* ---------- Waves ---------- */
const BUOYS = [
  { id: 'nazare', name: 'Nazaré coastal buoy (IH)', ds: 'TS_70_6200199_MO_UND', lat: 39.56, lng: -9.21 },
  { id: 'sines', name: 'Sines coastal buoy (IH)', ds: 'TS_70_Sines-coast-buoy_MO_UND', lat: 37.9211, lng: -8.9289 },
  { id: 'leixoes', name: 'Leixões coastal buoy (IH)', ds: 'TS_70_Leixoes-coast-buoy_MO_UND', lat: 41.3167, lng: -8.9833 },
  { id: 'faro', name: 'Faro coastal buoy (IH)', ds: 'TS_70_Faro-coast-buoy_MO_UND', lat: 36.9047, lng: -7.8983 },
  { id: 'silleiro', name: 'Cabo Silleiro buoy (Puertos del Estado)', ds: 'TS_70_6200084_MO_UND', lat: 42.12, lng: -9.43 },
  { id: 'cadiz', name: 'Golfo de Cádiz buoy (Puertos del Estado)', ds: 'TS_70_6200085_MO_UND', lat: 36.49, lng: -6.96 },
];
async function verifyWaves() {
  const a = acc();
  const since = (b) => (fresh ? daysAgo(60) : (out.lastWave[b.id] && out.lastWave[b.id] > daysAgo(10) ? out.lastWave[b.id] : daysAgo(10)));
  const lat = BUOYS.map((b) => b.lat).join(','), lng = BUOYS.map((b) => b.lng).join(',');
  const models = MARINE_MODELS.map((m) => m.id || m.key).join();
  const fc = await getJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_direction,wave_peak_period,swell_wave_peak_period&models=${models}&past_days=${fresh ? 61 : 11}&forecast_days=1&timezone=UTC`);
  const F = Array.isArray(fc) ? fc : [fc];
  // Size bias first (raw), then the miss after taking that bias out.
  const pairs = [];
  let total = 0;
  for (let bi = 0; bi < BUOYS.length; bi++) {
    const b = BUOYS[bi], h = F[bi] && F[bi].hourly;
    if (!h) continue;
    let rows;
    try { rows = Object.values(await erddap(b.ds, ['VHM0', 'VTPK', 'VPED'], since(b))).filter((o) => o.VHM0 != null && o.VHM0 >= 0.2); }
    catch (e) { console.log(`waves: ${b.id} unavailable (${e.message})`); out.buoys.push({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, hours: 0, latest: out.lastWave[b.id] || null }); continue; }
    const idx = Object.fromEntries(h.time.map((t, j) => [hourKey(t), j]));
    let n = 0;
    for (const o of rows) {
      const j = idx[hourKey(o.t)]; if (j == null) continue;
      for (const m of MARINE_MODELS) {
        const key = m.key, mid = m.id || m.key, hm = (h[`wave_height_${key}`] || [])[j];
        if (hm == null || hm <= 0.05) continue;
        const pm = (h[`wave_peak_period_${key}`] || [])[j] ?? (h[`swell_wave_peak_period_${key}`] || [])[j];
        pairs.push({ mid, hm, o, pm, dm: (h[`wave_direction_${key}`] || [])[j] });
      }
      n++;
    }
    if (rows.length) out.lastWave[b.id] = rows[rows.length - 1].t;
    out.buoys.push({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, hours: n, latest: out.lastWave[b.id] || null });
    total += n;
  }
  const bias = {};
  for (const { mid, hm, o } of pairs) add(bias, mid, 0, 'hBias', (hm - o.VHM0) / o.VHM0);
  for (const { mid, hm, o, pm, dm } of pairs) {
    const prevBias = out.wave[mid] && out.wave[mid].hBias, b = bias[mid] && bias[mid][0].hBias;
    const est = prevBias != null && !fresh ? prevBias : b ? b[0] / b[1] : 0;   // this batch's own bias on a fresh start
    add(a, mid, 0, 'hRel', Math.abs(hm / (1 + est) - o.VHM0) / o.VHM0);
    add(a, mid, 0, 'hBias', (hm - o.VHM0) / o.VHM0);
    if (pm != null && o.VTPK != null) add(a, mid, 0, 'p', Math.abs(pm - o.VTPK));
    if (dm != null && o.VPED != null) add(a, mid, 0, 'dir', angleDiff(dm, o.VPED));
  }
  foldAll('wave', a, 'hRel');
  console.log(`waves: ${total} buoy-hours (${out.buoys.map((b) => `${b.id} ${b.hours}`).join(', ')})`);
  // Days ahead: the worker's history database, once it has enough.
  try {
    const j = await getJson(`${WORKER}/skill/waves?days=60`);
    let used = 0;
    // Models checked above have today's record already; one that isn't on
    // Open-Meteo (Copernicus IBI) takes every lead, today's too, from here.
    const onOpenMeteo = new Set(MARINE_MODELS.map((m) => m.id || m.key));
    for (const r of j.rows || []) {
      if (r.lead >= LEADS || r.n < 24 || (r.lead < 1 && onOpenMeteo.has(r.model))) continue;
      const s = out.wave[r.model] = out.wave[r.model] || { lead: [] };
      s.lead[r.lead] = { n: r.n, hRel: r.hRelC ?? r.hRel, hBias: r.hBias, p: r.p, dir: r.dir, at: out.updated };
      if (r.lead === 0) Object.assign(s, { n: r.n, hRel: s.lead[0].hRel, hBias: r.hBias, p: r.p, dir: r.dir });
      used++;
    }
    for (const s of Object.values(out.wave)) for (let d = 0; d < s.lead.length; d++) if (!s.lead[d]) s.lead[d] = null;
    console.log(`waves: ${used} model×lead records from the history database`);
  } catch (e) { console.log(`waves: history database unavailable (${e.message})`); }
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
  // Three places is plenty (weights included); stats stay nested by lead.
  const round = (v) => (typeof v === 'number' ? +v.toFixed(3) : Array.isArray(v) ? v.map(round) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)])) : v);
  out.wind = round(out.wind); out.wave = round(out.wave);
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  const byLead = (s, f, fmt) => (s.lead || []).map((l) => (l && l[f] != null ? fmt(l[f]) : '-')).join('/');
  console.log('wind km/h miss by day ahead:\n ' + Object.entries(out.wind).map(([k, s]) => `${k.padEnd(22)} ${byLead(s, 'spd', (v) => v.toFixed(1))}  dir ${s.dir == null ? '-' : Math.round(s.dir)}°  n${s.n}`).join('\n '));
  console.log('wave height miss % (after bias) by day ahead:\n ' + Object.entries(out.wave).map(([k, s]) => `${k.padEnd(18)} ${byLead(s, 'hRel', (v) => Math.round(v * 100))}  bias ${s.hBias == null ? '-' : (s.hBias > 0 ? '+' : '') + Math.round(s.hBias * 100) + '%'}  Tp ${s.p == null ? '-' : s.p.toFixed(1)}s  dir ${s.dir == null ? '-' : Math.round(s.dir)}°  n${s.n}`).join('\n '));
})();
