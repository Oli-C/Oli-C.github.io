/* ---------- History: what was measured, and what each model said ----------
   Part of the surf worker (see main.js; tools/build-worker.mjs bundles it).

   Kept in D1 (binding DB, database "surf-history") so the models can be
   judged at every lead time, not just on their latest run, and so the
   measurements outlive the sources (IPMA's feed only holds the last day).

     obs   (src, t, ws, wd, wg, h, p, d, sst, air, lvl)    one row per source per hour
             ipma:<id>   IPMA weather stations near the spots: wind (km/h), air temp
             buoy:<id>   IH / Puertos del Estado wave buoys (EMODnet): Hm0, peak
                         period and direction, sea temp, and wind where fitted (km/h,
                         as measured ~3–4 m up)
             tide:<id>   tide gauges: sea level (m)
     fc    (pt, model, t, lead, h, p, d, issued)    each wave model's forecast at each
             buoy, for every hour 0–7 days ahead; `lead` is whole days between the run
             we saw and the hour, and the first forecast seen at a lead is kept
     runs  (t, kind, n, ms, note)                  a line per archive run

   Hourly: the IPMA stations. Every 6 hours (00, 06, 12, 18 UTC): the buoys
   and gauges (EMODnet lags a day or more, so each picks up from its last
   stored hour) and the wave models at the buoys.

   Size: ~40 stations + 10 buoys/gauges a day ≈ 1,200 obs rows, and ≈ 6,000
   fc rows (6 buoys × 5 models × 24 h × ~8 leads), ~100 bytes each: about
   250 MB a year, against D1's 5 GB included (10 GB per database).

   GET /skill/waves?days=60  every wave model's miss at the buoys by lead day
   GET /obs?src=&since=      stored measurements (one source, ≤ 31 days) */

const HIST_BUOYS = [
  { id: 'nazare', ds: 'TS_70_6200199_MO_UND', lat: 39.56, lng: -9.21 },
  { id: 'sines', ds: 'TS_70_Sines-coast-buoy_MO_UND', lat: 37.9211, lng: -8.9289 },
  { id: 'leixoes', ds: 'TS_70_Leixoes-coast-buoy_MO_UND', lat: 41.3167, lng: -8.9833 },
  { id: 'faro', ds: 'TS_70_Faro-coast-buoy_MO_UND', lat: 36.9047, lng: -7.8983 },
  { id: 'silleiro', ds: 'TS_70_6200084_MO_UND', lat: 42.12, lng: -9.43 },
  { id: 'cadiz', ds: 'TS_70_6200085_MO_UND', lat: 36.49, lng: -6.96 },
];
const HIST_GAUGES = [
  { id: 'cascais', ds: 'TS_70_CascaisTG_TG_UND' },
  { id: 'nazare', ds: 'TS_70_NazareTG_TG_UND' },
  { id: 'lagos', ds: 'TS_70_LagosTG_TG_UND' },
  { id: 'leixoes', ds: 'TS_70_LeixoesTG_TG_UND' },
];
const ERDDAP = 'https://platform-erddap.emodnet-physics.eu/erddap/tabledap/';
const HIST_UA = { 'User-Agent': 'allfield-surfcams/1.0' };

// SQL literals for our own numbers and ids (no user input reaches these).
const sqlNum = (v) => (typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : 'NULL');
const sqlStr = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
// Insert rows (arrays of literals), several hundred per statement; rows
// already there are left alone.
async function insertRows(db, table, cols, rows) {
  const stmts = [];
  for (let i = 0; i < rows.length; i += 400) {
    const vals = rows.slice(i, i + 400).map((r) => `(${r.join(',')})`).join(',');
    stmts.push(db.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(',')}) VALUES ${vals}`));
  }
  if (!stmts.length) return 0;
  const res = await db.batch(stmts);
  return res.reduce((a, r) => a + ((r.meta && r.meta.changes) || 0), 0);
}
const hourIso = (t) => t.slice(0, 13) + ':00';   // "2026-10-28T14:00"

// IPMA stations within 60 km of a spot: every hour IPMA still has (~24).
async function archiveIpma(db) {
  const base = 'https://api.ipma.pt/open-data/observation/meteorology/stations/';
  const [stations, observations] = await Promise.all([fetch(base + 'stations.json').then((r) => r.json()), fetch(base + 'observations.json').then((r) => r.json())]);
  const km = (a, b, c, d) => { const R = 6371, t = (x) => x * Math.PI / 180; const x = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
  const near = new Set(stations.filter((s) => { const [lon, lat] = s.geometry.coordinates; return CAMS.some((c) => km(c.lat, c.lng, lat, lon) <= 60); }).map((s) => String(s.properties.idEstacao)));
  const rows = [];
  for (const [h, byId] of Object.entries(observations)) {
    for (const [id, o] of Object.entries(byId || {})) {
      if (!near.has(id) || !o) continue;
      const ws = o.intensidadeVentoKM >= 0 ? o.intensidadeVentoKM : null, air = o.temperatura >= -50 ? o.temperatura : null;
      if (ws == null && air == null) continue;
      rows.push([sqlStr('ipma:' + id), sqlStr(hourIso(h)), sqlNum(ws), sqlNum(IPMA_DIR[o.idDireccVento] ?? null), sqlNum(air)]);
    }
  }
  return insertRows(db, 'obs', ['src', 't', 'ws', 'wd', 'air'], rows);
}

// One EMODnet dataset since `since`, folded to one row per hour.
async function erddapHours(ds, vars, since) {
  const r = await fetch(`${ERDDAP}${ds}.json?time,${vars.join(',')}&time%3E${since}Z&orderBy(%22time%22)`, { headers: HIST_UA });
  if (r.status === 404) return [];   // nothing newer
  if (!r.ok) throw new Error(`${ds} ${r.status}`);
  const byHour = {};
  for (const row of (await r.json()).table.rows) {
    const o = byHour[hourIso(row[0])] = byHour[hourIso(row[0])] || {};
    vars.forEach((v, i) => { const x = row[i + 1]; if (typeof x === 'number' && Number.isFinite(x)) o[v] = x; });
  }
  return Object.entries(byHour);
}
async function lastObs(db, src) {
  const r = await db.prepare('SELECT max(t) AS t FROM obs WHERE src = ?').bind(src).first();
  const floor = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 16);
  return r && r.t && r.t > floor ? r.t : floor;
}
async function archiveBuoys(db) {
  let n = 0;
  for (const b of HIST_BUOYS) {
    try {
      const since = await lastObs(db, 'buoy:' + b.id);
      const hours = await erddapHours(b.ds, ['VHM0', 'VTPK', 'VPED', 'VMDR', 'WSPD', 'WDIR', 'TEMP'], since);
      n += await insertRows(db, 'obs', ['src', 't', 'h', 'p', 'd', 'ws', 'wd', 'sst'], hours.filter(([, o]) => o.VHM0 != null || o.WSPD != null).map(([t, o]) =>
        [sqlStr('buoy:' + b.id), sqlStr(t), sqlNum(o.VHM0), sqlNum(o.VTPK), sqlNum(o.VPED ?? o.VMDR), sqlNum(o.WSPD != null ? o.WSPD * 3.6 : null), sqlNum(o.WDIR), sqlNum(o.TEMP)]));
    } catch (e) { console.log('buoy', b.id, e.message); }
  }
  for (const g of HIST_GAUGES) {
    try {
      const since = await lastObs(db, 'tide:' + g.id);
      const hours = await erddapHours(g.ds, ['SLEV'], since);
      n += await insertRows(db, 'obs', ['src', 't', 'lvl'], hours.filter(([, o]) => o.SLEV != null).map(([t, o]) => [sqlStr('tide:' + g.id), sqlStr(t), sqlNum(o.SLEV)]));
    } catch (e) { console.log('gauge', g.id, e.message); }
  }
  return n;
}

// Every wave model at every buoy, 0–7 days ahead, filed by lead day.
async function archiveWaveForecasts(db) {
  const lat = HIST_BUOYS.map((b) => b.lat).join(','), lng = HIST_BUOYS.map((b) => b.lng).join(',');
  const j = await fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_peak_period,swell_wave_peak_period,wave_direction&models=${modelIds(MARINE_MODELS)}&forecast_days=8&timezone=GMT`).then((r) => r.json());
  if (j.error) throw new Error(j.reason);
  const now = Date.now(), issued = new Date(now).toISOString().slice(0, 16), rows = [];
  asList(j).forEach((x, bi) => {
    const h = x && x.hourly; if (!h) return;
    h.time.forEach((t, i) => {
      const ahead = (Date.parse(t + ':00Z') - now) / 3.6e6;
      if (ahead < 0) return;
      const lead = Math.floor(ahead / 24);
      for (const m of MARINE_MODELS) {
        const id = m.id || m.key, hv = (h[`wave_height_${m.key}`] || [])[i];
        if (hv == null || !(hv > 0.05)) continue;
        const pv = (h[`wave_peak_period_${m.key}`] || [])[i] ?? (h[`swell_wave_peak_period_${m.key}`] || [])[i];
        rows.push([sqlStr(HIST_BUOYS[bi].id), sqlStr(id), sqlStr(t), lead, sqlNum(hv), sqlNum(pv), sqlNum((h[`wave_direction_${m.key}`] || [])[i]), sqlStr(issued)]);
      }
    });
  });
  return insertRows(db, 'fc', ['pt', 'model', 't', 'lead', 'h', 'p', 'd', 'issued'], rows);
}

async function archiveHistory(env, force) {
  const db = env.DB;
  if (!db) return { skipped: 'no DB binding' };
  const started = Date.now(), six = force || new Date().getUTCHours() % 6 === 0, out = {};
  try { out.ipma = await archiveIpma(db); } catch (e) { out.ipma = 'error: ' + e.message; }
  if (six) {
    try { out.buoys = await archiveBuoys(db); } catch (e) { out.buoys = 'error: ' + e.message; }
    try { out.fc = await archiveWaveForecasts(db); } catch (e) { out.fc = 'error: ' + e.message; }
  }
  out.ms = Date.now() - started;
  try { await db.prepare('INSERT OR REPLACE INTO runs (t, kind, n, ms, note) VALUES (?, ?, ?, ?, ?)').bind(new Date().toISOString().slice(0, 16), six ? 'full' : 'ipma', [out.ipma, out.buoys, out.fc].reduce((a, v) => a + (typeof v === 'number' ? v : 0), 0), out.ms, JSON.stringify(out)).run(); } catch {}
  return out;
}

// Routes: GET /skill/waves, GET /obs, GET /history/status. Null otherwise.
async function handleHistory(req, env, url, json) {
  if (req.method !== 'GET' || !['/skill/waves', '/obs', '/history/status', '/history/refresh'].includes(url.pathname)) return null;
  if (!env.DB) return json({ error: 'no history database bound' }, 503);
  if (url.pathname === '/history/refresh') {
    const key = await readSecret(env.EXPORT_KEY);
    if (!key || (url.searchParams.get('key') || '').trim() !== key) return json({ error: 'no' }, 403);
    return json({ ok: true, ...(await archiveHistory(env, true)) });
  }
  if (url.pathname === '/history/status') {
    const [obs, fc, runs] = await Promise.all([
      env.DB.prepare("SELECT substr(src, 1, instr(src, ':') - 1) AS kind, count(*) AS rows, count(DISTINCT src) AS sources, min(t) AS first, max(t) AS last FROM obs GROUP BY kind").all(),
      env.DB.prepare('SELECT count(*) AS rows, count(DISTINCT model) AS models, min(t) AS first, max(t) AS last FROM fc').first(),
      env.DB.prepare('SELECT * FROM runs ORDER BY t DESC LIMIT 5').all(),
    ]);
    return json({ obs: obs.results, fc, runs: runs.results }, 200, { 'Cache-Control': 'public, max-age=300' });
  }
  if (url.pathname === '/obs') {
    const src = url.searchParams.get('src') || '', since = url.searchParams.get('since') || new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 16);
    if (!/^(ipma|buoy|tide):[\w-]{1,30}$/.test(src) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(since) || since < new Date(Date.now() - 31 * 864e5).toISOString().slice(0, 16)) return json({ error: 'src=ipma:<id>|buoy:<id>|tide:<id>, since=YYYY-MM-DDTHH:MM within 31 days' }, 400);
    const r = await env.DB.prepare('SELECT t, ws, wd, wg, h, p, d, sst, air, lvl FROM obs WHERE src = ? AND t >= ? ORDER BY t LIMIT 1000').bind(src, since).all();
    return json({ src, rows: r.results }, 200, { 'Cache-Control': 'public, max-age=600' });
  }
  // Each wave model's miss at the buoys, by lead day, over the last `days`.
  const days = Math.min(120, Math.max(1, parseInt(url.searchParams.get('days') || '60', 10) || 60));
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 16);
  // hRelC: the miss once the model's own size bias over the window is taken
  // out, as the pages do before blending.
  const r = await env.DB.prepare(`
    WITH j AS (
      SELECT f.model AS model, f.lead AS lead, f.h AS fh, o.h AS oh, f.p AS fp, o.p AS op, f.d AS fd, o.d AS od
      FROM fc f JOIN obs o ON o.src = 'buoy:' || f.pt AND o.t = f.t
      WHERE f.t >= ? AND o.h >= 0.2),
    b AS (SELECT model, avg((fh - oh) / oh) AS bias FROM j GROUP BY model)
    SELECT j.model AS model, j.lead AS lead, count(*) AS n,
      avg(abs(fh - oh) / oh) AS hRel, avg(abs(fh / (1 + b.bias) - oh) / oh) AS hRelC, avg((fh - oh) / oh) AS hBias,
      avg(CASE WHEN fp IS NOT NULL AND op IS NOT NULL THEN abs(fp - op) END) AS p,
      avg(CASE WHEN fd IS NOT NULL AND od IS NOT NULL THEN min(abs(fd - od), 360 - abs(fd - od)) END) AS dir
    FROM j JOIN b ON b.model = j.model
    GROUP BY j.model, j.lead ORDER BY j.model, j.lead`).bind(since).all();
  return json({ since, days, rows: r.results }, 200, { 'Cache-Control': 'public, max-age=1800' });
}
