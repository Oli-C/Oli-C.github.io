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
  const km = (a, b, c, d) => { const R = 6371, t = (x) => x * Math.PI / 180; const x = Math.sin(t(c - a) / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(t(d - b) / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(x)); };
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

// The Sources panel's per-model values for one hour (as the page builds them).
function fcSrc(mRows, wRows, windW, marineW, mModels = MARINE_MODELS) {
  const wind = wRows.map((r, x) => ({ name: WIND_MODELS[x].name, w: +windW[x].toFixed(2), n: 0, ws: r.wind_speed_10m, wd: r.wind_direction_10m })).filter((r) => r.ws != null);
  const swell = mRows.map((r, x) => ({ name: mModels[x].name, w: +marineW[x].toFixed(2), h: r.swell_wave_height ?? r.wave_height, p: r.swell_wave_period ?? r.wave_period, d: r.swell_wave_direction ?? r.wave_direction })).filter((r) => r.h != null && r.h > 0.05);
  const wdOut = outliers(wind.map((r) => r.wd), true), wsOut = outliers(wind.map((r) => r.ws), false);
  wind.forEach((r, x) => { r.out = wdOut.has(x) || wsOut.has(x); });
  const hOut = outliers(swell.map((r) => r.h), false), dOut = outliers(swell.map((r) => r.d).filter((v) => v != null), true);
  swell.forEach((r, x) => { r.out = hOut.has(x) || dOut.has(x); });
  const hs = swell.map((r) => r.h), wss = wind.map((r) => r.ws);
  return {
    wind, swell,
    windSpread: dirSpread(wind.map((r) => r.wd).filter((v) => v != null)),
    wsSpread: wss.length ? Math.max(...wss) - Math.min(...wss) : 0,
    hMin: hs.length ? Math.min(...hs) : null, hMax: hs.length ? Math.max(...hs) : null, hSpread: hs.length ? Math.max(...hs) - Math.min(...hs) : 0,
  };
}

async function buildForecast(env) {
  const started = Date.now();
  try { const r = await fetch(SITE + 'data/skill.json', { cf: { cacheTtl: 300 } }); if (r.ok) sharedSkill = await r.json(); } catch {}
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
  // Weights by days ahead: models are trusted by their record that far out.
  const windWL = leadWeights(WIND_MODELS, modelWeight), marineWL = leadWeights(MARINE_MODELS, waveWeight);
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
    const byDate = {}, src = {};
    const n = Math.min(m.hourly.time.length, w.hourly.time.length);
    const ib = ibi && ibi.spots[c.id];
    for (let j = 0; j < n; j++) {
      const t = m.hourly.time[j], lead = leadOf(t, offset);
      const ii = ib ? ibiAt[new Date(Date.parse(t + ':00Z') - offset * 1000).toISOString().slice(0, 16)] : null;
      const extra = ii != null && ib.wave_height[ii] != null ? [{ model: IBI_MODEL, row: ibiRow(ib, ii), w: ibiWL[lead][0] }] : null;
      const bh = blendHour(m.hourly, w.hourly, j, windWL[lead], marineWL[lead], extra);
      if (!bh) continue;
      const k = { t, ...bh.k };
      // A fresh station reading leans on the hours around it.
      if (ob) {
        const away = (Date.parse(t + ':00Z') - Date.parse(obLocal + ':00Z')) / 3.6e6;
        if (away >= -0.5 && away <= 2.5) applyObs(k, ob, obsWeight(ob, Math.max(0, away)));
      }
      (byDate[t.slice(0, 10)] = byDate[t.slice(0, 10)] || []).push(k);
      // Per-model values for the hours a page might call "now" before the next run.
      const dh = (Date.parse(t + ':00Z') - Date.parse(nowLocal + ':00Z')) / 3.6e6;
      if (dh >= -1.5 && dh <= 2.5) src[t] = { src: fcSrc(bh.mRows, bh.wRows, windWL[lead], bh.mW, bh.mModels), model: bh.k.model };
    }
    const dates = Object.keys(byDate).sort(), todayIdx = dates.indexOf(today);
    const days = dates.map((date, di) => {
      const hours = byDate[date];
      hours.forEach((k, j) => addTide(hours, k, j));
      const dayFromToday = todayIdx >= 0 ? di - todayIdx : di;
      const day = { date, hours: hours.map(roundK), tides: tideEvents(hours), sun: sunOf(w, (w.daily && w.daily.time || []).indexOf(date)), conf: dayConfidence(hours, Math.max(0, dayFromToday)) };
      if (date <= today) (byDay[date] = byDay[date] || {})[c.id] = day;
      return day;
    });
    spots[c.id] = { offset, days, src, obs: ob };
  });
  const built = new Date().toISOString();
  const payload = { v: FC_VER, built, skill: (sharedSkill && sharedSkill.updated) || null, ibi: ibi ? ibi.built : null, ms: Date.now() - started, spots };
  await env.FEEDBACK.put('fc:latest', JSON.stringify(payload));
  for (const [date, s] of Object.entries(byDay)) await env.FEEDBACK.put(`fc:day:${date}`, JSON.stringify({ date, built, spots: s }));
  return { built, spots: Object.keys(spots).length, days: Object.keys(byDay), ms: Date.now() - started };
}

// The latest build, held in this isolate for a minute so a burst of page
// loads (or someone hammering it) costs one KV read, not one each.
let fcMemo = { at: 0, body: null };

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
    const key = await readSecret(env.EXPORT_KEY);
    if (!key || (url.searchParams.get('key') || '').trim() !== key) return json({ error: 'no' }, 403);
    try { return json({ ok: true, ...(await buildForecast(env)) }); } catch (e) { return json({ error: String(e && e.message || e) }, 502); }
  }
  return null;
}
