/* The cams page's core: settings, shared state and the page's elements, the
   conditions (the worker's hourly build, else blended here from Open-Meteo,
   with IPMA's station readings), the score badge, and today's bars and
   summary. Loaded first; the other cams-*.js files build on it. */

const LIBS = {
  plyr:    'https://cdn.jsdelivr.net/npm/plyr@3.7.8/dist/plyr.min.js',
  hls:     'https://cdn.jsdelivr.net/npm/hls.js@1.5.15/dist/hls.min.js',
  leaflet: 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js',
};
const COND_TTL = 30 * 60 * 1000; // re-fetch conditions after 30 minutes
const COND_VER = 9;              // bump when the cached shape changes
// Tiles keep a short buffer and start on the lowest rendition — they're
// small, and ten of them at once adds up.
const TILE_HLS = {
  liveDurationInfinity: true, enableWorker: true, capLevelToPlayerSize: true,
  startLevel: 0, maxBufferLength: 8, maxMaxBufferLength: 16, backBufferLength: 0, liveSyncDurationCount: 3,
};
// How many tiles may stream at once; the rest sit on their snapshot until
// one scrolls away.
const MAX_TILES = matchMedia('(max-width: 640px)').matches ? 6 : 12;
const wide = matchMedia('(min-width: 1000px)');
// Phones get the compact toolbar and always open on the cams (the map is
// one tap away); only wider screens remember their last view.
const phone = matchMedia('(max-width: 700px)');

const $ = (id) => document.getElementById(id);
const grid = $('grid'), chips = $('chips'), q = $('q'), empty = $('empty');
const layout = $('layout'), viewer = $('viewer'), frame = $('v-frame'), go = $('go');

let area = 'All';
let view = 'split';
// Data saver: on by default if the browser says so, else remembered.
let dataSaver = !!(navigator.connection && navigator.connection.saveData);
try { const s = localStorage.getItem('surf-saver'); if (s !== null) dataSaver = s === '1'; } catch {}
let lastFocus = null;
let hls = null, player = null;
let hideTimer = 0, goTimer = 0;
let conditions = {};   // cam id -> { now: {...}, hours: [{...}], t }
let condNote = '';
let map = null, windLayer = null, swellLayer = null, windField = null, swellField = null;
let fieldGrid = null;  // coarse wind/swell samples along the coast, for the particle field
const markers = {};
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const tiles = {};      // cam id -> { video, hls, visible, active, hold, dead }
const nativeHls = !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');

const matches = (c) => spotMatches(c, q.value, area);   // toolbar.js
const byId = (id) => CAMS.find((x) => x.id === id);
const cards = () => [...grid.querySelectorAll('.cam')];
// 'split' only exists on wide screens; narrower ones fall back to the grid.
const effectiveView = () => (view === 'split' && !wide.matches ? 'grid' : view);

// Scripts are fetched once, the first time they're needed.
const loaded = {};
const loadScript = (url) => loaded[url] || (loaded[url] = new Promise((resolve, reject) => {
  const s = document.createElement('script');
  s.src = url;
  s.onload = resolve;
  s.onerror = () => { delete loaded[url]; reject(new Error('Failed to load ' + url)); };
  document.head.appendChild(s);
}));

// Bust snapshot caches once a minute so thumbnails stay roughly current
// without hammering the cam hosts.
const stamp = Math.floor(Date.now() / 60000);
const thumbUrl = (u) => u + (u.includes('?') ? '&' : '?') + 't=' + stamp;

const scoreOf = (c) => score(c, conditions[c.id] && conditions[c.id].now);
const MOON = '<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';
const badge = (c, lg) => {
  const r = scoreOf(c);
  if (r && r.dark) return `<span class="score lvl-dark${lg ? ' lg' : ''}" title="After dark: ${r.lit ? `${fmt(r.lit)} with light to see by` : 'flat anyway'}">${MOON}${r.lit ? `<b>${fmt(r.lit)}</b>` : ''}<small>Dark</small></span>`;
  if (r && r.total === 0) return `<span class="score lvl-0${lg ? ' lg' : ''}" title="${esc(r.cap || 'Flat')}"><small>Flat</small></span>`;
  return r
    ? `<span class="score lvl-${r.level}${lg ? ' lg' : ''}"><b>${fmt(r.total)}</b><small>${r.label}</small></span>`
    : `<span class="score lvl-x${lg ? ' lg' : ''}"><b>–</b><small>no data</small></span>`;
};
const condText = (c) => {
  const k = conditions[c.id] && conditions[c.id].now, r = scoreOf(c);
  if (!r) return '';
  // Wind and how clean it leaves the surface, e.g. "9 kts cross, bumpy".
  const rel = r.wind === 'cross-shore' ? 'cross' : r.wind;
  return `<b>${hgt(k.h)}</b> · <b>${Math.round(k.p)} s</b> · <b>${kts(k.ws)} kts</b> ${rel}${r.surface ? `, <span class="surf-word surf-${r.surface.i}">${esc(r.surface.label.toLowerCase())}</span>` : ''}`;
};

/* ---------- Today: four bars + a summary ---------- */

// Average score per block of the day, daylight hours only.
// `hs`: the day's hours (today's by default); only today has a past.
function dayBars(c, hs = conditions[c.id] && conditions[c.id].hours, isToday = true) {
  if (!hs || !hs.length) return null;
  const nowH = isToday ? new Date().getHours() : -1;
  return BUCKETS.map((b) => {
    const rows = hs.filter((k) => !isDark(c, k) && hourOf(k.t) >= b.from && hourOf(k.t) < b.to);
    const totals = rows.map((k) => score(c, k)).filter(Boolean).map((r) => r.total);
    const avg = totals.length ? Math.round((totals.reduce((a, x) => a + x, 0) / totals.length) * 2) / 2 : null;
    return { ...b, score: avg, level: avg == null ? null : levelOf(avg), past: nowH >= b.to, now: nowH >= b.from && nowH < b.to };
  });
}

const miniBars = (c) => {
  const bars = dayBars(c);
  if (!bars) return '';
  return `<span class="mini" aria-hidden="true" title="Today, dawn to evening">${bars.map((b) =>
    `<i class="${b.level == null ? 'lvl-x' : 'lvl-' + b.level}${b.past ? ' past' : ''}${b.now ? ' now' : ''}" style="height:${b.score == null ? 2 : Math.max(2, b.score * 10)}%"></i>`
  ).join('')}</span>`;
};

// A sentence or two on how the day goes: size trend, wind, best window.
function daySummary(c, hs = conditions[c.id] && conditions[c.id].hours, isToday = true) {
  if (!hs) return '';
  const day = hs.filter((k) => !isDark(c, k) && hourOf(k.t) >= 6 && hourOf(k.t) < 19);
  if (day.length < 2) return 'No daylight hours left to call.';
  const first = day[0], last = day[day.length - 1];
  const dh = last.h - first.h;
  const sizeTxt = Math.abs(dh) < 0.25
    ? `Holding around ${hgt((first.h + last.h) / 2)} at ${Math.round((first.p + last.p) / 2)} s`
    : dh > 0 ? `Building from ${hgt(first.h)} to ${hgt(last.h)}` : `Easing from ${hgt(first.h)} to ${hgt(last.h)}`;
  const rels = day.map((k) => windRel(c, k));
  const half = Math.floor(rels.length / 2);
  const mode = (arr) => arr.sort((a, b) => arr.filter((v) => v === a).length - arr.filter((v) => v === b).length).pop();
  const am = mode(rels.slice(0, half)), pm = mode(rels.slice(half));
  const speeds = day.map((k) => k.ws);
  const windTxt = am === pm
    ? `${am} wind all day, ${kts(Math.min(...speeds))}–${kts(Math.max(...speeds))} kts`
    : `${am} early, turning ${pm} later and up to ${kts(Math.max(...speeds))} kts`;
  const bars = (dayBars(c, hs, isToday) || []).filter((b) => b.score != null);
  const best = bars.slice().sort((a, b) => b.score - a.score)[0];
  const bestTxt = best ? (best.past ? `Best was ${best.label.toLowerCase()} (${fmt(best.score)}).` : `Best window: ${best.label.toLowerCase()} (${fmt(best.score)}).`) : '';
  return `${sizeTxt}; ${windTxt}. ${bestTxt}`.trim();
}

// Tide times barely differ along this coast, so one averaged set serves
// everyone; an area only gets its own line if it strays by 20+ minutes.
function coastTides() {
  const lists = CAMS.map((c) => conditions[c.id] && conditions[c.id].tides).filter((l) => l && l.length);
  if (!lists.length) return null;
  const tpl = lists.slice().sort((a, b) => b.length - a.length)[0];
  return tpl.map((e) => {
    const ms = lists.map((l) => {
      const m = l.filter((x) => x.kind === e.kind).sort((a, b) => Math.abs(a.mins - e.mins) - Math.abs(b.mins - e.mins))[0];
      return m && Math.abs(m.mins - e.mins) < 90 ? m.mins : null;
    }).filter((v) => v != null);
    const avg = Math.round(ms.reduce((a, x) => a + x, 0) / ms.length);
    return { kind: e.kind, mins: avg, t: fmtMins(avg) };
  });
}
const areaTides = (a) => { const c = CAMS.find((x) => x.area === a && conditions[x.id] && conditions[x.id].tides && conditions[x.id].tides.length); return c ? conditions[c.id].tides : null; };
const tidesDiffer = (ev, coast) => !!(ev && coast) && ev.some((e) => {
  const m = coast.filter((x) => x.kind === e.kind).sort((a, b) => Math.abs(a.mins - e.mins) - Math.abs(b.mins - e.mins))[0];
  return m && Math.abs(m.mins - e.mins) >= 20;
});
// The tide line a spot should show: the coast-wide one unless its area strays.
const tidesFor = (c) => { const ev = areaTides(c.area), coast = coastTides(); return tidesDiffer(ev, coast) ? ev : (coast || ev); };

// Measured wind from IPMA's station network (open data, hourly, about an
// hour behind): each cam gets its nearest station within 50 km.
async function loadObs() {
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
        best = { station: s.properties.localEstacao.replace(/\s*\(.*\)$/, ''), km: Math.round(d), day: h.slice(0, 10), t: h.slice(11, 16), ageH: +((Date.now() - new Date(h)) / 3.6e6).toFixed(1), ws: o.intensidadeVentoKM, wd: IPMA_DIR[o.idDireccVento] ?? null, temp: o.temperatura >= -50 ? o.temperatura : null };
        break;
      }
    }
    if (best) out[c.id] = best;
  }
  return out;
}

// The worker's hourly forecast (see SURFING/tools/worker/forecast.js),
// fetched once and shared by the live scores and the session form.
// Refused if it's an unknown version or more than 3 hours old.
const FC_VER = 1;
let fcPromise = null, fcAt = 0;
function loadWorkerForecast() {
  if (!fcPromise || Date.now() - fcAt > 20 * 60000) {
    fcAt = Date.now();
    fcPromise = (async () => {
      if (!FEEDBACK_URL) throw new Error('no worker set');
      const r = await fetch(FEEDBACK_URL.replace(/\/$/, '') + '/forecast');
      if (!r.ok) throw new Error('worker said ' + r.status);
      const fc = await r.json();
      if (fc.v !== FC_VER) throw new Error('forecast version ' + fc.v);
      if (Date.now() - Date.parse(fc.built) > 3 * 3600e3) throw new Error('forecast from ' + fc.built);
      return fc;
    })();
    fcPromise.catch(() => { setTimeout(() => { fcPromise = null; }, 60000); });
  }
  return fcPromise;
}

async function loadConditions() {
  const ids = CAMS.map((c) => c.id).join();
  const today = new Date().toDateString();
  try {
    const cached = JSON.parse(localStorage.getItem('surf-cond') || 'null');
    if (cached && cached.v === COND_VER && cached.ids === ids && cached.day === today && Date.now() - cached.t < COND_TTL) {
      conditions = cached.data;
      condNote = cached.note;
      return;
    }
  } catch {}

  // First choice: the worker's hourly build (one small, pre-blended file).
  try {
    const fc = await loadWorkerForecast();
    const next = {};
    let when = '';
    for (const c of CAMS) {
      const s = fc.spots[c.id];
      if (!s) throw new Error('spot missing from the worker forecast: ' + c.id);
      const nowLocal = spotNow(s.offset), day = s.days.find((d) => d.date === nowLocal.slice(0, 10));
      if (!day || !day.hours.length) throw new Error('no hours for today');
      const hours = day.hours.map((k) => ({ ...k }));
      let near = 0, nearD = Infinity;
      hours.forEach((k, j) => { const d = Math.abs(Date.parse(k.t + ':00Z') - Date.parse(nowLocal + ':00Z')); if (d < nearD) { nearD = d; near = j; } });
      const now = { ...hours[near] }, sx = s.src && s.src[now.t];
      if (sx) { now.src = sx.src; now.model = sx.model; }
      if (s.obs) now.obs = s.obs;
      now.conf = confidence(now.src, s.obs, now);
      const tmr = s.days[s.days.indexOf(day) + 1];
      next[c.id] = { now, hours, sun: day.sun, tides: day.tides, t: now.t, tomorrow: tmr ? tmr.hours : [] };
      when = when || now.t.slice(11, 16);
    }
    conditions = next;
    condNote = `Scores from Open-Meteo swell, wind and tide at ${when} local, judged against each spot’s usual best.`;
    try { localStorage.setItem('surf-cond', JSON.stringify({ v: COND_VER, ids, day: today, t: Date.now(), data: conditions, note: condNote })); } catch {}
    return;
  } catch (e) { console.info('surf: worker forecast unavailable, fetching directly —', e.message); }

  const pts = CAMS.map(offshore);
  const lat = pts.map((p) => p[0]).join(','), lng = pts.map((p) => p[1]).join(',');
  // Every model's hourly series for today, blended per hour below.
  const marineUrl = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=${MARINE.join()}&models=${modelIds(MARINE_MODELS)}&forecast_days=1&timezone=auto`;
  const windUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${WIND.join()}&models=${modelIds(WIND_MODELS)}&daily=sunrise,sunset&forecast_days=1&timezone=auto`;

  try {
    const [marine, wind, obs] = await Promise.all([
      fetch(marineUrl).then((r) => r.json()),
      fetch(windUrl).then((r) => r.json()),
      loadObs().catch(() => ({})),
    ]);
    if (marine.error || wind.error) throw new Error(marine.reason || wind.reason);
    const M = asList(marine), W = asList(wind);
    const next = {};
    let when = '';
    const nowMs = Date.now();
    // Teach the wind models from any station hour we haven't scored before.
    let seen = [];
    try { seen = JSON.parse(localStorage.getItem('surf-skill-seen') || '[]'); } catch {}
    let learned = false;
    CAMS.forEach((c, i) => {
      const m = M[i], w = W[i];
      if (!m || !w || !m.hourly || !w.hourly) return;
      const ob = obs[c.id] || null;
      // A model's miss against this cam's station, if the hour lines up
      // and we haven't counted this reading already.
      // One lesson per station per hour (several cams share a station), and
      // direction only counts once there's enough wind to have one.
      if (ob) {
        const stamp = `${ob.station}|${ob.day}T${ob.t}`;
        const j = w.hourly.time.findIndex((t) => t.slice(0, 10) === ob.day && hourOf(t) === parseInt(ob.t, 10));
        if (j >= 0 && !seen.includes(stamp)) {
          WIND_MODELS.forEach((mod) => {
            const r = modelRow(w.hourly, j, WIND, mod);
            if (r.wind_speed_10m == null) return;
            const dirErr = ob.wd != null && ob.ws >= 8 && r.wind_direction_10m != null ? angleDiff(r.wind_direction_10m, ob.wd) : null;
            learn(mod.key, dirErr, Math.abs(r.wind_speed_10m - ob.ws));
          });
          seen.push(stamp); learned = true;
        }
      }
      // Today, blended (score.js), keeping each hour's per-model values
      // for the Sources panel; "now" is the hour nearest the clock.
      const counts = Object.fromEntries(Object.entries(skill).map(([key, s]) => [key, s.n]));
      const f = blendSpot(c, m, w, { obs: ob && { ob, at: `${ob.day}T${ob.t}` }, keep: () => true, counts });
      const day = f.days[0];
      if (!day || !day.hours.length) return;
      const hours = day.hours;
      let near = 0, nearD = Infinity;
      hours.forEach((k, j) => { const d = Math.abs(new Date(k.t) - nowMs); if (d < nearD) { nearD = d; near = j; } });
      const now = { ...hours[near], src: f.kept[hours[near].t].src };
      if (ob) now.obs = ob;
      now.conf = confidence(now.src, ob, now);
      next[c.id] = { now, hours, sun: day.sun, tides: day.tides, t: now.t };
      when = when || (now.t || '').slice(11, 16);
    });
    if (learned) { saveSkill(); try { localStorage.setItem('surf-skill-seen', JSON.stringify(seen.slice(-200))); } catch {} }
    conditions = next;
    condNote = when ? `Scores from Open-Meteo swell, wind and tide at ${when} local, judged against each spot’s usual best.` : 'Conditions unavailable right now';
    try { localStorage.setItem('surf-cond', JSON.stringify({ v: COND_VER, ids, day: today, t: Date.now(), data: conditions, note: condNote })); } catch {}
  } catch (e) {
    conditions = {};
    condNote = 'Conditions unavailable right now';
  }
}
