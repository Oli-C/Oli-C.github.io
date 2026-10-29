/* A stand-in for the network in tests: Open-Meteo's marine and forecast APIs
   answer with made-up but plausible series (the same every time for a given
   hour), IPMA has no stations, and the site's skill.json is the repo's own.
   Install with  globalThis.fetch = fakeFetch;  */
import fs from 'node:fs';

const SKILL = fs.readFileSync(new URL('../../data/skill.json', import.meta.url), 'utf8');
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// A smooth value for one location, model, variable and hour.
function value(v, li, mi, h) {
  const s = (period, phase = 0) => Math.sin((h + phase + li * 3 + mi * 5) / period * 2 * Math.PI);
  switch (v) {
    case 'swell_wave_height': return +(1.4 + 0.5 * s(48) + 0.08 * mi).toFixed(2);
    case 'wave_height': return +(1.6 + 0.5 * s(48) + 0.08 * mi).toFixed(2);
    case 'secondary_swell_wave_height': return +(0.4 + 0.2 * s(30, 7)).toFixed(2);
    case 'wind_wave_height': return +(0.3 + 0.15 * s(12)).toFixed(2);
    case 'swell_wave_period': case 'wave_period': return +(10 + 2 * s(60)).toFixed(1);
    case 'swell_wave_peak_period': case 'wave_peak_period': return +(13 + 2 * s(60)).toFixed(1);
    case 'secondary_swell_wave_period': return +(8 + s(40)).toFixed(1);
    case 'swell_wave_direction': case 'wave_direction': return Math.round(295 + 15 * s(72));
    case 'secondary_swell_wave_direction': return Math.round(225 + 10 * s(50));
    case 'sea_level_height_msl': return +(1.2 * Math.sin((h / 12.42) * 2 * Math.PI)).toFixed(2);
    case 'sea_surface_temperature': return 16.5;
    case 'wind_speed_10m': return +(12 + 8 * s(24, 3) + mi).toFixed(1);
    case 'wind_direction_10m': return Math.round((340 + 40 * s(36) + 360) % 360);
    case 'wind_gusts_10m': return +(20 + 10 * s(24, 3)).toFixed(1);
    case 'temperature_2m': return +(17 + 4 * s(24, 18)).toFixed(1);
    case 'is_day': return (h % 24) >= 7 && (h % 24) < 18 ? 1 : 0;
    default: return null;
  }
}

// A tide table for one gauge (Cascais): a 1.55 m semidiurnal tide, unlike
// the model's 1.2 m, from two days back to twenty ahead, in whole cm.
export const TIDE_AMP = 1.55;
export function fakeTides() {
  const t0 = Math.floor(Date.now() / 3.6e6) * 3.6e6 - 48 * 3.6e6;
  const hs = Array.from({ length: 22 * 24 }, (_, i) => Math.round(100 * TIDE_AMP * Math.sin(((t0 / 3.6e6 + i) / 12.42) * 2 * Math.PI)));
  return { built: new Date().toISOString().slice(0, 16), start: new Date(t0).toISOString().slice(0, 16), step: 1, gauges: { cascais: hs } };
}

export function openMeteo(url) {
  const q = url.searchParams, lats = q.get('latitude').split(','), models = (q.get('models') || 'best_match').split(',');
  const vars = (q.get('hourly') || '').split(',').filter(Boolean), past = +(q.get('past_days') || 0), days = +(q.get('forecast_days') || 7);
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00Z').getTime();
  let start = today - past * 864e5, span = past + days;
  if (q.get('start_date')) { start = Date.parse(q.get('start_date') + 'T00:00Z'); span = (Date.parse(q.get('end_date') + 'T00:00Z') - start) / 864e5 + 1; }
  const hoursN = span * 24, base = Math.floor(start / 3.6e6);
  const time = Array.from({ length: hoursN }, (_, i) => new Date(start + i * 3.6e6).toISOString().slice(0, 16));
  const one = (li) => {
    const hourly = { time };
    models.forEach((m, mi) => { for (const v of vars) hourly[`${v}_${m}`] = time.map((_, i) => value(v, li, mi, base + i)); });
    const out = { latitude: +lats[li], utc_offset_seconds: 0, hourly };
    if (q.get('daily')) {
      const dt = Array.from({ length: span }, (_, d) => new Date(start + d * 864e5).toISOString().slice(0, 10));
      out.daily = { time: dt };
      for (const m of models) { out.daily[`sunrise_${m}`] = dt.map((d) => `${d}T07:05`); out.daily[`sunset_${m}`] = dt.map((d) => `${d}T17:40`); }
    }
    return out;
  };
  return lats.length === 1 ? one(0) : lats.map((_, li) => one(li));
}

export async function fakeFetch(input) {
  const url = new URL(typeof input === 'string' ? input : input.url);
  if (/open-meteo\.com$/.test(url.hostname)) return json(openMeteo(url));
  if (url.hostname === 'api.ipma.pt') return json(url.pathname.endsWith('stations.json') ? [] : {});
  if (url.pathname.endsWith('/data/skill.json')) return json(SKILL);
  if (url.pathname.endsWith('/data/tides.json')) return json(fakeTides());
  return json({ error: 'not faked: ' + url.href }, 404);
}
