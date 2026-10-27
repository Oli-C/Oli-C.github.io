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
  const since = out.lastWaveObs && out.lastWaveObs > new Date(Date.now() - 10 * 864e5).toISOString() ? out.lastWaveObs : new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 19) + 'Z';
  const lat = BUOYS.map((b) => b.lat).join(','), lng = BUOYS.map((b) => b.lng).join(',');
  const models = MARINE_MODELS.map((m) => m.id || m.key).join();
  const fc = await getJson(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=wave_height,wave_direction,swell_wave_peak_period,swell_wave_height&models=${models}&past_days=10&forecast_days=1&timezone=UTC`);
  const F = Array.isArray(fc) ? fc : [fc];
  let latest = out.lastWaveObs, total = 0;
  for (let bi = 0; bi < BUOYS.length; bi++) {
    const b = BUOYS[bi], h = F[bi] && F[bi].hourly;
    if (!h) continue;
    let rows;
    try {
      const j = await getJson(`https://platform-erddap.emodnet-physics.eu/erddap/tabledap/${b.ds}.json?time,VHM0,VTPK,VMDR&time%3E=${since}&orderBy(%22time%22)`);
      rows = j.table.rows;
    } catch (e) { console.log(`waves: ${b.id} unavailable (${e.message})`); continue; }
    // Rows come split by parameter; fold them by hour.
    const byHour = {};
    for (const [t, H, T, D] of rows) {
      const k = hourKey(t), r = byHour[k] = byHour[k] || { t };
      if (H != null) r.h = H; if (T != null) r.p = T; if (D != null) r.d = D;
    }
    const idx = Object.fromEntries(h.time.map((t, j) => [hourKey(t), j]));
    let n = 0;
    for (const r of Object.values(byHour)) {
      if (r.h == null || r.t <= out.lastWaveObs) continue;
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
      if (r.t > latest) latest = r.t;
      n++;
    }
    out.buoys.push({ id: b.id, name: b.name, lat: b.lat, lng: b.lng, hours: n, latest: Object.values(byHour).map((r) => r.t).sort().pop() || null });
    total += n;
  }
  if (latest) out.lastWaveObs = latest;
  console.log(`waves: ${total} buoy-hours, up to ${out.lastWaveObs || 'n/a'}`);
}

(async () => {
  try { await verifyWind(); } catch (e) { console.log('wind failed:', e.message); }
  try { await verifyWaves(); } catch (e) { console.log('waves failed:', e.message); }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, s]) => [k, Object.fromEntries(Object.entries(s).map(([a, v]) => [a, typeof v === 'number' && a !== 'n' ? +v.toFixed(3) : v]))]));
  out.wind = round(out.wind); out.wave = round(out.wave);
  fs.mkdirSync(new URL('../data/', import.meta.url), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
  console.log('wind:', Object.entries(out.wind).map(([k, s]) => `${k} n${s.n} dir${s.dir == null ? '-' : Math.round(s.dir)} spd${s.spd == null ? '-' : s.spd.toFixed(1)}`).join(' | '));
  console.log('wave:', Object.entries(out.wave).map(([k, s]) => `${k} n${s.n} h${s.hRel == null ? '-' : Math.round(s.hRel * 100) + '%'} p${s.p == null ? '-' : s.p.toFixed(1)} dir${s.dir == null ? '-' : Math.round(s.dir)}`).join(' | '));
})();
