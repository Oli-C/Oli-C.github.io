/* ---------- Forecast: the blend, done once an hour for everyone ----------
   Part of the surf worker (see main.js; tools/build-worker.mjs bundles it
   with spots.js and score.js, so the blend is the very code the pages run).

   Every hour (a Cron Trigger) the worker:
     1. reads the shared model skill (data/skill.json on the site), which
        weights the models exactly as the pages do;
     2. fetches every wind and wave model's hourly series for every spot,
        from 2 days ago to 7 days ahead (one call each for all spots), and
        IPMA's latest station readings; adds Copernicus IBI, the regional
        wave model tools/copernicus.py posts every few hours (POST /ibi);
     3. blends each hour (outliers set aside, models weighted), folds a
        fresh nearby station reading into the hours around it, and works
        out each day's tide range, highs and lows, light and confidence;
     4. keeps the result in KV as fc:latest, served at GET /forecast, and
        each day's hours as fc:day:YYYY-MM-DD, an archive that grows by a
        day a day (the past days are rewritten by later runs until they
        drop out of the window, so they settle on the closest-to-measured
        version).

   The pages read /forecast and score it themselves (cheap); they fall back
   to fetching Open-Meteo directly if it's stale or missing a spot.
   GET /forecast/refresh?key= runs a build now. */

const FC_VER = 1;
const SITE = 'https://allfield.online/SURFING/';
const FC_PAST = 2, FC_DAYS = 7;
// The far days, 8 to 15 ahead: only ECMWF, GFS and GEM reach that far and
// they move little hour to hour, so they're fetched every six hours (keeping
// the worker well inside Open-Meteo's daily allowance), kept in KV as
// fc:ext, and added to each hourly build.
const FC_EXT = 15, FC_EXT_EVERY = 6 * 3600e3;
// Keep every field the pages and training read; numbers to 3 places.
const FC_K = ['h', 'p', 'd', 'ws', 'wd', 'wg', 'day', 'tn', 'tdir', 'wwh', 'th', 'h2', 'p2', 'd2', 'sst', 'air', 'tide', 'obsW'];
const roundK = (k) => {
  const o = { t: k.t };
  for (const f of FC_K) if (k[f] != null) o[f] = typeof k[f] === 'number' ? Math.round(k[f] * 1000) / 1000 : k[f];
  return o;
};

// IPMA station readings (UTC hours), nearest station within 50 km per spot.
async function fcObs() {
  const base = 'https://api.ipma.pt/open-data/observation/meteorology/stations/';
  const [stations, observations] = await Promise.all([
    fetch(base + 'stations.json').then((r) => r.json()),
    fetch(base + 'observations.json').then((r) => r.json()),
  ]);
  const hoursDesc = Object.keys(observations).sort().reverse().slice(0, 3);
  const out = {};
  for (const c of CAMS) {
    let best = null;
    for (const s of stations) {
      const id = String(s.properties.idEstacao), [lon, lat] = s.geometry.coordinates;
      const d = km(c.lat, c.lng, lat, lon);
      if (d > 50 || (best && d >= best.km)) continue;
      for (const h of hoursDesc) {
        const o = observations[h] && observations[h][id];
        if (!o || o.intensidadeVentoKM == null || o.intensidadeVentoKM < 0) continue;
        best = { station: s.properties.localEstacao.replace(/\s*\(.*\)$/, ''), km: Math.round(d), utc: h.slice(0, 16), ws: o.intensidadeVentoKM, wd: IPMA_DIR[o.idDireccVento] ?? null, temp: o.temperatura >= -50 ? o.temperatura : null };
        break;
      }
    }
    if (best) out[c.id] = best;
  }
  return out;
}

async function buildForecast(env) {
  const started = Date.now();
  // The models' record: as tools/skill.mjs last posted it, else the site's copy.
  try { sharedSkill = JSON.parse((await env.FEEDBACK.get('skill:latest')) || 'null'); } catch {}
  if (!sharedSkill) try { const r = await fetch(SITE + 'data/skill.json', { cf: { cacheTtl: 300 } }); if (r.ok) sharedSkill = await r.json(); } catch {}
  const pts = CAMS.map(offshore);
  const lat = pts.map((p) => p[0]).join(','), lng = pts.map((p) => p[1]).join(',');
  const q = `latitude=${lat}&longitude=${lng}&past_days=${FC_PAST}&forecast_days=${FC_DAYS}&timezone=auto`;
  const [marine, wind, obs] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&hourly=${MARINE.join()}&models=${modelIds(MARINE_MODELS)}`).then((r) => r.json()),
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&hourly=${WIND.join()}&models=${modelIds(WIND_MODELS)}&daily=sunrise,sunset`).then((r) => r.json()),
    fcObs().catch(() => ({})),
  ]);
  if (marine.error || wind.error) throw new Error(marine.reason || wind.reason);
  const M = asList(marine), W = asList(wind);
  // Copernicus IBI, if a recent run has been posted: its hours by UTC time.
  let ibi = null;
  try { ibi = JSON.parse((await env.FEEDBACK.get('ibi:latest')) || 'null'); } catch {}
  if (ibi && Date.now() - Date.parse(ibi.built + ':00Z') > 36 * 3600e3) ibi = null;   // too old to trust
  const ibiAt = ibi ? Object.fromEntries(ibi.times.map((t, i) => [t, i])) : null;
  const ibiWL = leadWeights([IBI_MODEL], waveWeight);
  const ibiRow = (s, i) => Object.fromEntries(MARINE.map((v) => [v, s[v] ? s[v][i] : null]));
  const spots = {}, byDay = {};
  CAMS.forEach((c, i) => {
    const m = M[i], w = W[i];
    if (!m || !w || !m.hourly || !w.hourly) return;
    const offset = w.utc_offset_seconds || 0;
    const local = (ms) => new Date(ms + offset * 1000).toISOString().slice(0, 16);
    const nowLocal = local(Date.now()), today = nowLocal.slice(0, 10);
    const ob = obs[c.id] || null;
    const obLocal = ob ? local(Date.parse(ob.utc + ':00Z')) : null;
    if (ob) { ob.day = obLocal.slice(0, 10); ob.t = obLocal.slice(11, 16); ob.ageH = +((Date.now() - Date.parse(ob.utc + ':00Z')) / 3.6e6).toFixed(1); }
    const ib = ibi && ibi.spots[c.id];
    const f = blendSpot(c, m, w, {
      obs: ob && { ob, at: obLocal },
      // Copernicus IBI's hour, as one more wave model.
      extra: ib && ((utc, lead) => { const ii = ibiAt[utc]; return ii != null && ib.wave_height[ii] != null ? [{ model: IBI_MODEL, row: ibiRow(ib, ii), w: ibiWL[lead][0] }] : null; }),
      // Per-model values for the hours a page might call "now" before the next run.
      keep: (t) => { const dh = (Date.parse(t + ':00Z') - Date.parse(nowLocal + ':00Z')) / 3.6e6; return dh >= -1.5 && dh <= 2.5; },
    });
    const days = f.days.map((d) => {
      const day = { ...d, hours: d.hours.map(roundK) };
      if (d.date <= today) (byDay[d.date] = byDay[d.date] || {})[c.id] = day;
      return day;
    });
    spots[c.id] = { offset, days, src: f.kept, obs: ob };
  });
  try {
    const ext = await extendedDays(env);
    for (const [id, s] of Object.entries(spots)) {
      const last = s.days.length ? s.days[s.days.length - 1].date : '';
      s.days.push(...((ext.spots[id] || []).filter((d) => d.date > last)));
    }
  } catch (e) { console.log('far days', e.message); }
  const built = new Date().toISOString();
  const payload = { v: FC_VER, built, skill: (sharedSkill && sharedSkill.updated) || null, ibi: ibi ? ibi.built : null, ms: Date.now() - started, spots };
  await env.FEEDBACK.put('fc:latest', JSON.stringify(payload));
  for (const [date, s] of Object.entries(byDay)) await env.FEEDBACK.put(`fc:day:${date}`, JSON.stringify({ date, built, spots: s }));
  return { built, spots: Object.keys(spots).length, days: Object.keys(byDay), ms: Date.now() - started };
}

async function extendedDays(env) {
  try { const x = JSON.parse((await env.FEEDBACK.get('fc:ext')) || 'null'); if (x && Date.now() - Date.parse(x.built) < FC_EXT_EVERY) return x; } catch {}
  const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
  const pts = CAMS.map(offshore);
  const q = `latitude=${pts.map((p) => p[0]).join(',')}&longitude=${pts.map((p) => p[1]).join(',')}&start_date=${day(FC_DAYS)}&end_date=${day(FC_EXT)}&timezone=auto`;
  const [marine, wind] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&hourly=${MARINE.join()}&models=${modelIds(MARINE_MODELS)}`).then((r) => r.json()),
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&hourly=${WIND.join()}&models=${modelIds(WIND_MODELS)}&daily=sunrise,sunset`).then((r) => r.json()),
  ]);
  if (marine.error || wind.error) throw new Error(marine.reason || wind.reason);
  const M = asList(marine), W = asList(wind), spots = {};
  CAMS.forEach((c, i) => {
    const m = M[i], w = W[i];
    if (m && w && m.hourly && w.hourly) spots[c.id] = blendSpot(c, m, w).days.map((d) => ({ ...d, hours: d.hours.map(roundK) }));
  });
  const ext = { built: new Date().toISOString(), spots };
  await env.FEEDBACK.put('fc:ext', JSON.stringify(ext));
  return ext;
}

// The latest build, held in this isolate for a minute so a burst of page
// loads (or someone hammering it) costs one KV read, not one each.
let fcMemo = { at: 0, body: null };

// GET /skill: the models' record (tools/skill.mjs posts it with POST /skill).
// The pages read it here first, so a new record counts within minutes
// rather than after GitHub Pages republishes data/skill.json.
let skillMemo = { at: 0, body: null };
async function handleSkill(req, env, url, json) {
  if (url.pathname !== '/skill') return null;
  if (req.method === 'POST') {
    if (!(await isAdmin(req, env))) return json({ error: 'no' }, 403);
    if ((req.headers.get('Content-Length') | 0) > 500000) return json({ error: 'too big' }, 413);
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!b || typeof b !== 'object' || !b.wind || !b.wave || typeof b.updated !== 'string') return json({ error: 'not a skill record' }, 400);
    await env.FEEDBACK.put('skill:latest', JSON.stringify(b));
    skillMemo = { at: 0, body: null };
    return json({ ok: true, updated: b.updated });
  }
  if (req.method !== 'GET') return null;
  if (Date.now() - skillMemo.at > 60000) skillMemo = { at: Date.now(), body: await env.FEEDBACK.get('skill:latest') };
  return skillMemo.body
    ? new Response(skillMemo.body, { headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } })
    : json({ error: 'no record yet' }, 404);
}

// Routes: GET /forecast, GET /forecast/day?d=YYYY-MM-DD, GET /forecast/refresh?key=.
async function handleForecast(req, env, url, json) {
  if (req.method !== 'GET' || !url.pathname.startsWith('/forecast')) return null;
  const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
  if (url.pathname === '/forecast') {
    if (Date.now() - fcMemo.at > 60000) fcMemo = { at: Date.now(), body: await env.FEEDBACK.get('fc:latest') };
    const body = fcMemo.body;
    if (!body) return json({ error: 'no forecast built yet' }, 503);
    return new Response(body, { headers: { ...cors, 'Cache-Control': 'public, max-age=300' } });
  }
  if (url.pathname === '/forecast/day') {
    const d = url.searchParams.get('d') || '';
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) return json({ error: 'd=YYYY-MM-DD' }, 400);
    const body = await env.FEEDBACK.get(`fc:day:${d}`);
    return body ? new Response(body, { headers: { ...cors, 'Cache-Control': 'public, max-age=3600' } }) : json({ error: 'no archive for that day' }, 404);
  }
  if (url.pathname === '/forecast/refresh') {
    if (!(await isAdmin(req, env))) return json({ error: 'no' }, 403);
    try { return json({ ok: true, ...(await buildForecast(env)) }); } catch (e) { return json({ error: String(e && e.message || e) }, 502); }
  }
  return null;
}
