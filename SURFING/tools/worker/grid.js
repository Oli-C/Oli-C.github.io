/* ---------- Grids for the map: swell and wind over the whole coast ----------
   Part of the surf worker (see main.js; tools/build-worker.mjs bundles it).

   The map's animated fields and its swell-height heat map need values
   everywhere, not just at the spots:

     swell  Copernicus IBI, every second cell (~5.5 km), every 3 hours for
            48: height (cm), swell direction (°), peak period (tenths of a
            second); land cells are null. tools/copernicus.py --grid posts it
            (POST /grid/swell) with the other Copernicus run.
     wind   ECMWF IFS 9 km on a 0.25° grid over the same box and steps:
            speed (tenths of km/h) and direction (°). Fetched here every
            three hours (~110 Open-Meteo calls each time).

   Both are row-major grids: lat0 + i·dlat (south to north) by
   lng0 + j·dlng (west to east), one flat array per time step.
   GET /grid serves them together. */

const GRID_BOX = { lat: [36.8, 40.1], lng: [-10.3, -8.5] };
const WIND_STEP = 0.25, GRID_EVERY_H = 3, GRID_AHEAD_H = 48;

// The wind grid, rebuilt when it's three hours old.
async function windGrid(env) {
  try { const g = JSON.parse((await env.FEEDBACK.get('grid:wind')) || 'null'); if (g && Date.now() - Date.parse(g.built + ':00Z') < GRID_EVERY_H * 3600e3) return g; } catch {}
  const lats = [], lngs = [];
  for (let la = GRID_BOX.lat[0]; la <= GRID_BOX.lat[1] + 1e-9; la += WIND_STEP) lats.push(+la.toFixed(3));
  for (let lo = GRID_BOX.lng[0]; lo <= GRID_BOX.lng[1] + 1e-9; lo += WIND_STEP) lngs.push(+lo.toFixed(3));
  const pts = lats.flatMap((la) => lngs.map((lo) => [la, lo]));
  const j = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${pts.map((p) => p[0]).join(',')}&longitude=${pts.map((p) => p[1]).join(',')}&hourly=wind_speed_10m,wind_direction_10m&models=ecmwf_ifs&forecast_days=3&timezone=GMT`).then((r) => r.json());
  if (j.error) throw new Error(j.reason);
  const L = asList(j), time = L[0].hourly.time;
  const now = new Date(), t0 = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours() - (now.getUTCHours() % GRID_EVERY_H)));
  const times = [];
  for (let h = 0; h <= GRID_AHEAD_H; h += GRID_EVERY_H) times.push(new Date(t0.getTime() + h * 3.6e6).toISOString().slice(0, 16));
  const idx = times.map((t) => time.indexOf(t));
  const pick = (v, scale) => idx.map((i) => L.map((x) => { const a = x.hourly[v] || x.hourly[`${v}_ecmwf_ifs`]; const y = a && i >= 0 ? a[i] : null; return y == null ? null : Math.round(y * scale); }));
  const g = { v: 1, source: 'ECMWF IFS 9 km (Open-Meteo)', built: new Date().toISOString().slice(0, 16), times,
    lat0: lats[0], dlat: WIND_STEP, nlat: lats.length, lng0: lngs[0], dlng: WIND_STEP, nlng: lngs.length,
    ws: pick('wind_speed_10m', 10), wd: pick('wind_direction_10m', 1) };
  await env.FEEDBACK.put('grid:wind', JSON.stringify(g));
  gridMemo = { at: 0, body: null };
  return g;
}

// A grid posted from outside: the right shape, or refused.
function gridOk(g, fields) {
  const T = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;
  if (!g || !Array.isArray(g.times) || !g.times.length || g.times.length > 40 || !g.times.every((t) => T.test(t))) return false;
  const n = g.nlat * g.nlng;
  if (!(n > 0 && n <= 20000) || ![g.lat0, g.dlat, g.lng0, g.dlng].every((x) => typeof x === 'number' && Number.isFinite(x))) return false;
  return fields.every((f) => Array.isArray(g[f]) && g[f].length === g.times.length && g[f].every((a) => Array.isArray(a) && a.length === n && a.every((x) => x === null || Number.isInteger(x))));
}

let gridMemo = { at: 0, body: null };
// Routes: POST /grid/swell (the Copernicus job), GET /grid.
async function handleGrid(req, env, url, json) {
  if (url.pathname === '/grid/swell' && req.method === 'POST') {
    if (!(await isAdmin(req, env))) return json({ error: 'no' }, 403);
    if ((req.headers.get('Content-Length') | 0) > 3e6) return json({ error: 'too big' }, 413);
    let g;
    try { g = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!gridOk(g, ['h', 'd', 'p'])) return json({ error: 'not a swell grid' }, 400);
    const keep = { v: 1, source: String(g.source || '').slice(0, 60), built: String(g.built || '').slice(0, 16), times: g.times, lat0: g.lat0, dlat: g.dlat, nlat: g.nlat, lng0: g.lng0, dlng: g.dlng, nlng: g.nlng, h: g.h, d: g.d, p: g.p };
    await env.FEEDBACK.put('grid:swell', JSON.stringify(keep));
    gridMemo = { at: 0, body: null };
    return json({ ok: true, steps: g.times.length, cells: g.nlat * g.nlng });
  }
  if (url.pathname !== '/grid' || req.method !== 'GET') return null;
  if (Date.now() - gridMemo.at > 300000) {
    const [swell, wind] = await Promise.all([env.FEEDBACK.get('grid:swell'), env.FEEDBACK.get('grid:wind')]);
    gridMemo = { at: Date.now(), body: `{"swell":${swell || 'null'},"wind":${wind || 'null'}}` };
  }
  return new Response(gridMemo.body, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' } });
}
