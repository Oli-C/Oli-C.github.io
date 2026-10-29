/* The spots' past, from reanalyses, filed in the worker's history database
   (POST /history/import) as if it had been forecast, so the trends page has
   seasons to show before the live history (from 26 Oct 2026) builds up.

   Each spot's hours: the waves from Copernicus's Iberian wave model as
   run back over the past (copernicus.py --history: the reanalysis, then
   the analysis-forecast's archive), the wind from ERA5 (Open-Meteo's
   archive, at the spot's offshore point), the tide from the tide tables
   (tides.py history). Built into the forecast's own hour shape (swell
   split, tide state, the wind sea's period and direction), and scored by
   the worker with today's logic. Days the history already has are left
   alone; they're filed with build 'reanalysis'.

     node SURFING/tools/backfill.mjs --waves waves.json --tides tides.json
          --from 2025-10-26 --to 2026-10-25 [--post] [--hours] [--sample]

   --post   sends them (needs FEEDBACK_URL and FEEDBACK_KEY); without it,
            prints a summary of what it would send
   --hours  files the hours too (a year is ~140k rows; mind D1's daily writes)
   --why    a breakdown a spot: its days month by month, and how often each
            part of the score holds it back (daylight hours)
   Run by .github/workflows/surf-backfill.yml. */
import fs from 'node:fs';
import { loadSite } from './site.mjs';

const site = loadSite();
// The models' record, as the live forecast uses it: IBI's measured size bias
// comes out of its heights here too (and the scores get what's been learned).
site.sharedSkill = JSON.parse(fs.readFileSync(new URL('../data/skill.json', import.meta.url), 'utf8'));
const IBI_BIAS = site.waveBias(site.IBI_MODEL);
const arg = (n, d) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const WAVES = JSON.parse(fs.readFileSync(arg('--waves'), 'utf8'));
const TIDES = JSON.parse(fs.readFileSync(arg('--tides'), 'utf8'));
const FROM = arg('--from'), TO = arg('--to');
const WORKER = (process.env.FEEDBACK_URL || '').replace(/\/$/, ''), KEY = process.env.FEEDBACK_KEY || '';
const TZ = 'Europe/Lisbon';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// UTC hour -> local hour stamp, and back (the first of a repeated hour in autumn).
const fmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const toLocal = (ms) => fmt.format(new Date(ms)).replace(' ', 'T');
const localToUtc = {};
for (let ms = Date.parse(FROM + 'T00:00Z') - 2 * 864e5; ms <= Date.parse(TO + 'T00:00Z') + 2 * 864e5; ms += 3.6e6) {
  const l = toLocal(ms);
  if (!(l in localToUtc)) localToUtc[l] = ms;
}

const waveAt = Object.fromEntries(WAVES.times.map((t, i) => [Date.parse(t + ':00Z'), i]));
const tide0 = Date.parse(TIDES.start + ':00Z');
const gaugeFor = (c) => site.GAUGES.filter((g) => TIDES.gauges[g.id]).sort((a, b) => site.km(c.lat, c.lng, a.lat, a.lng) - site.km(c.lat, c.lng, b.lat, b.lng))[0];

async function era5(c) {
  const [lat, lng] = site.offshore(c);
  const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}&start_date=${FROM}&end_date=${TO}`
    + '&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m,is_day&daily=sunrise,sunset&models=era5&timezone=' + encodeURIComponent(TZ);
  for (let attempt = 0; ; attempt++) {
    let why;
    try {
      const r = await fetch(url);
      if (r.ok) return r.json();
      why = `${r.status} ${(await r.text()).slice(0, 200)}`;
    } catch (e) { why = e.message; }   // a timeout, a reset: try again
    if (attempt >= 5) throw new Error(`ERA5 ${c.id}: ${why}`);
    await sleep(15000 * (attempt + 1));
  }
}

function spotDays(c, w) {
  const rec = WAVES.spots[c.id], g = gaugeFor(c), tides = g && TIDES.gauges[g.id];
  if (!rec) throw new Error(`no waves for ${c.id}`);
  const byDate = {};
  const H = w.hourly;
  H.time.forEach((t, j) => {
    const utc = localToUtc[t];
    const wi = utc == null ? null : waveAt[utc];
    if (wi == null) return;
    const m = {};
    for (const v of Object.keys(rec)) if (Array.isArray(rec[v])) m[v] = rec[v][wi];
    site.debias(m, IBI_BIAS);
    site.splitSwell([m]);
    const wr = { wind_speed_10m: H.wind_speed_10m[j], wind_direction_10m: H.wind_direction_10m[j], wind_gusts_10m: H.wind_gusts_10m[j], temperature_2m: H.temperature_2m[j], is_day: H.is_day[j] };
    const k = site.toK(m, wr);
    if (!k) return;
    k.t = t;
    if (tides) { const i = Math.round((utc - tide0) / 3.6e6); if (i >= 0 && i < tides.length && tides[i] != null) k.tide = tides[i] / 100; }
    (byDate[t.slice(0, 10)] = byDate[t.slice(0, 10)] || []).push(k);
  });
  const sun = Object.fromEntries((w.daily.time || []).map((d, i) => [d, { rise: (w.daily.sunrise[i] || '').slice(11, 16), set: (w.daily.sunset[i] || '').slice(11, 16) }]));
  return Object.keys(byDate).sort().filter((d) => d >= FROM && d <= TO).map((date) => {
    const hours = byDate[date];
    hours.forEach((k, j) => site.addTide(hours, k, j));
    return { date, hours, tides: site.tideEvents(hours), sun: sun[date] || null };
  });
}

// What holds a spot's scores down: by month, the days' mean and best, and
// over daylight hours the share capped (flat / too small / too big) and the
// mean of each part.
function why(c, days) {
  const months = {};
  for (const d of days) {
    const m = d.date.slice(0, 7), g = site.dayDigest(c, d);
    const o = months[m] = months[m] || { tops: [], n: 0, flat: 0, small: 0, big: 0, size: 0, per: 0, dir: 0, wind: 0, sea: 0, tide: 0, clean: 0, h: 0, p: 0, total: 0 };
    if (g) o.tops.push(g.top);
    for (const k of d.hours) {
      if (site.isDark(c, k)) continue;
      const r = site.score(c, k);
      if (!r) continue;
      const f = (l) => r.factors.find((x) => x.label === l);
      o.n++; o.total += r.total; o.h += site.swellTrains(c, k).h; o.p += k.p || 0;
      if (/flat/.test(r.cap)) o.flat++; else if (/too small/.test(r.cap)) o.small++; else if (/too big/.test(r.cap)) o.big++;
      o.size += f('Size') ? f('Size').pts : 0; o.per += f('Period') ? f('Period').pts : 0; o.dir += f('Direction') ? f('Direction').pts : 0;
      o.wind += f('Wind') ? f('Wind').mult : 1; o.sea += f('Sea state') ? f('Sea state').mult : 1; o.tide += f('Tide') ? f('Tide').mult : 1;
      o.clean += (k.p < 8 ? 0.6 : k.p < 10 ? 0.8 : k.p < 12 ? 0.9 : 1);
    }
  }
  const [lo, hi] = c.best.size;
  console.log(`  likes ${lo}-${hi} m, ${c.best.period} s. month: day mean/best | hours: breaking h, period | capped flat/small/big % | size/4 period/3 dir/3 | wind sea tide clean`);
  for (const [m, o] of Object.entries(months)) {
    const a = (x) => (o.n ? x / o.n : 0), pc = (x) => Math.round(100 * a(x));
    const mean = o.tops.length ? o.tops.reduce((x, y) => x + y, 0) / o.tops.length : 0;
    console.log(`  ${m}: ${mean.toFixed(1)}/${Math.max(0, ...o.tops)} | ${a(o.h).toFixed(1)} m ${a(o.p).toFixed(1)} s | ${pc(o.flat)}/${pc(o.small)}/${pc(o.big)} | ${a(o.size).toFixed(1)} ${a(o.per).toFixed(1)} ${a(o.dir).toFixed(1)} | ${a(o.wind).toFixed(2)} ${a(o.sea).toFixed(2)} ${a(o.tide).toFixed(2)} ${a(o.clean).toFixed(2)}`);
  }
}

async function post(body) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`${WORKER}/history/import`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Surf-Key': KEY }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return j;
    if (attempt >= 5 || (r.status !== 429 && r.status < 500)) throw new Error(`import ${body.spot}: ${r.status} ${JSON.stringify(j)}`);
    await sleep(20000 * (attempt + 1));
  }
}

console.log(`IBI heights x${IBI_BIAS.toFixed(3)} (its measured bias, as the live forecast takes it out)`);
let filed = 0, sent = 0;
for (const c of site.CAMS) {
  if (!WAVES.spots[c.id]) { console.log(`${c.id}: no waves, skipped`); continue; }
  const days = spotDays(c, await era5(c));
  // A quick look: the days' scores as the worker will see them.
  const tops = days.map((d) => (site.dayDigest(c, d) || {}).top).filter((x) => x != null);
  const good = tops.filter((x) => x > 6.5).length;
  const bestGood = days.map((d) => site.dayDigest(c, d)).filter((g) => g && g.best && g.best.score > 6.5).length;
  console.log(`${c.id}: ${days.length} days, mean ${(tops.reduce((a, x) => a + x, 0) / tops.length).toFixed(1)}, Good or better ${good} (${Math.round((100 * good) / tops.length)}%), best window Good or better ${bestGood} (${Math.round((100 * bestGood) / tops.length)}%), gauge ${gaugeFor(c) ? gaugeFor(c).id : '-'}`);
  if (has('--why')) why(c, days);
  if (!has('--post')) continue;
  for (let i = 0; i < days.length; i += 31) {
    const j = await post({ spot: c.id, build: 'reanalysis', hours: has('--hours'), days: days.slice(i, i + 31) });
    filed += j.filed; sent += j.days;
    await sleep(6500);   // the worker's admin limit: 10 a minute
  }
}
if (has('--post')) console.log(`sent ${sent} days, filed ${filed} (the rest were already in the history)`);
