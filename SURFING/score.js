/* Scoring engine, units, Open-Meteo field mapping and tide helpers — shared by index.html (live cams) and week.html (7-day outlook).
   Plain script, no modules, so file:// and GitHub Pages both work. */

const LEVELS = ['Flat', 'Poor', 'Fair', 'Good', 'Epic'];
// The day in four blocks, dawn → evening (local hours, [from, to)).
const BUCKETS = [
  { label: 'Dawn', from: 6, to: 9 },
  { label: 'Morning', from: 9, to: 12 },
  { label: 'Afternoon', from: 12, to: 15 },
  { label: 'Evening', from: 15, to: 19 },
];

// Wave heights in metres or feet, remembered on this device.
let units = 'm';
try { units = localStorage.getItem('surf-units') === 'ft' ? 'ft' : 'm'; } catch {}
const hgt = (m) => (units === 'ft' ? `${Math.round(m * 3.281 * 2) / 2} ft` : `${m.toFixed(1)} m`);

const rng = (a, b) => (units === 'ft' ? `${Math.round(a * 3.281)}–${Math.round(b * 3.281)} ft` : `${a}–${b} m`);

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- Conditions + score ---------- */

// Smallest angle between two bearings, 0–180.
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// Compass windows are [from, to] clockwise and may wrap through north.
const inWindow = (d, [a, b]) => (a <= b ? d >= a && d <= b : d >= a || d <= b);
const distToWindow = (d, w) => (inWindow(d, w) ? 0 : Math.min(angleDiff(d, w[0]), angleDiff(d, w[1])));
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const dirName = (d) => COMPASS[Math.round((((d % 360) + 360) % 360) / 45) % 8];
const windowText = ([a, b]) => (dirName(a) === dirName(b) ? dirName(a) : `${dirName(a)}–${dirName(b)}`);
const fmt = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));
// Linear ramp: y0 at x0, y1 at x1, clamped outside.
const lerp = (x, x0, y0, x1, y1) => y0 + (y1 - y0) * Math.min(1, Math.max(0, (x - x0) / (x1 - x0)));

const tideWord = (tn) => (tn < 0.33 ? 'low' : tn < 0.66 ? 'mid' : 'high');
// Wetsuit by water temperature — a rule of thumb, not gospel.
const suit = (t) => (t >= 22 ? 'boardies' : t >= 19 ? '2 mm spring' : t >= 16 ? '3/2 mm' : t >= 13 ? '4/3 mm' : '5/4 mm + boots');

// Wind direction is where it blows FROM. Offshore = inside the spot's
// window (give or take 15°); onshore = roughly from the sea; the rest is
// cross-shore, which is what a nortada does to the west-facing beaches.
function windRel(c, k) {
  const off = distToWindow(k.wd, c.best.wind) <= 15;
  const on = !off && angleDiff(k.wd, c.faces) < 45;
  return off ? 'offshore' : on ? 'onshore' : 'cross-shore';
}

/* Score out of 10, judged against the spot's own `best` block.

   First the offshore swell is turned into what actually arrives at the
   beach: swell from inside the spot's window arrives whole; swell from
   further round the compass fades towards the spot's `exposure` floor
   (long-period swell wraps better, so it fades less), and any `gain`
   (Nazaré's canyon) is applied. Everything below works on that height.

   Three things add up to a raw 10:
     Size       4 pts  ramps up to full marks 40% of the way into the
                       spot's size range, holds to the top, then falls off
     Period     3 pts  ramps from 2 s under the spot's "gets good" period
                       to 5 s over it — long-period groundswell is what
                       separates good from epic
     Direction  3 pts  full marks inside the swell window, nothing 45° out

   Then multipliers, because these are what ruin an otherwise good day:
     Wind       ×1.0 glassy or light offshore … ×0.1 strong onshore,
                less again if it's gusty
     Sea state  wind chop and any secondary swell crossing the main one:
                ×1.0 one clean groundswell … ×0.5 when the mess is as big
                as the swell
     Period     a second, whole-score penalty for short period: ×0.8 under
                10 s, ×0.6 under 8 s — lumpy is lumpy whatever the wind
     Tide       where today's tide sits (0 = low water, 1 = high) against
                the range the spot likes: ×1.0 inside, ×0.85 just outside,
                ×0.65 well outside; ×0.9 more if it's running the wrong way

   Caps: under 0.4 m is Flat (0); swell far outside the size range can't
   score above 3 (too big) or 4 (too small); after dark it's 0 ("Dark").
   Blind to the banks — a nudge to open the cam, not a forecast. */
function score(c, k) {
  if (!k || k.h == null || k.ws == null) return null;
  const b = c.best, p = k.p || 0, P = b.period;
  const [lo, hi] = b.size;
  const f = [];

  // How much of the offshore swell reaches this beach: whole when it's
  // coming at the beach (within 45° of the way it faces), fading to the
  // spot's exposure floor once it has to bend 110° round a headland.
  const dd = k.d != null ? distToWindow(k.d, b.swell) : 0;
  const bend = k.d != null ? angleDiff(k.d, c.faces) : 0;
  const floor = b.exposure == null ? 0.85 : b.exposure;
  let arrive = lerp(bend, 45, 1, 110, floor);
  if (bend > 45 && p >= 12) arrive = Math.min(1, arrive * 1.15);   // long period wraps in
  arrive *= b.gain || 1;
  const h = k.h * arrive;
  const hNow = Math.abs(arrive - 1) < 0.05 ? hgt(h) : `${hgt(h)} at the beach (${hgt(k.h)} offshore)`;

  const sweet = lo + 0.4 * (hi - lo);
  const size = h <= sweet ? lerp(h, lo * 0.5, 0, sweet, 4) : h <= hi ? 4 : lerp(h, hi, 4, hi * 1.4, 0);
  f.push({ label: 'Size', pts: size, max: 4, now: hNow, likes: rng(lo, hi) });

  const per = lerp(p, P - 2, 0, P + 5, 3);
  // Short-period swell is lumpy however clean the wind is, so it also
  // scales the whole score, not just its own 3 points.
  const clean = p < 8 ? 0.6 : p < 10 ? 0.8 : p < 12 ? 0.9 : 1;
  f.push({ label: 'Period', pts: per, max: 3, now: `${Math.round(p)} s${clean < 1 ? ', lumpy' : ''}`, likes: `${P} s and up` });

  // Angle still matters once the swell is in: straight into the window
  // lines up the banks; well outside it tends to bend in as closeouts.
  const dir = k.d != null ? lerp(dd, 0, 3, 60, 0) : 2;
  f.push({ label: 'Direction', pts: dir, max: 3, now: k.d != null ? `from ${dirName(k.d)}` : 'unknown', likes: windowText(b.swell) });

  const rel = windRel(c, k), ws = k.ws;
  let wind;
  if (ws < 8)             wind = 1;                                                   // glassy
  else if (rel === 'offshore') wind = ws < 20 ? 1 : ws < 30 ? 0.9 : ws < 40 ? 0.75 : 0.6;
  else if (rel === 'onshore')  wind = ws < 10 ? 0.6 : ws < 18 ? 0.4 : ws < 28 ? 0.2 : 0.1;
  else                         wind = ws < 12 ? 0.85 : ws < 20 ? 0.6 : ws < 30 ? 0.4 : 0.2;
  const gusty = k.wg != null && k.wg > 25 && k.wg > ws * 1.5;
  if (gusty) wind *= 0.85;
  f.push({ label: 'Wind', mult: wind, now: `${Math.round(ws)} km/h ${dirName(k.wd)}, ${rel}${gusty ? `, gusting ${Math.round(k.wg)}` : ''}`, likes: `${windowText(b.wind)} offshore` });

  // Sea state: wind chop (sampled offshore, so an offshore wind grooms it
  // and it counts half) plus any secondary swell crossing the main one,
  // which shows up as total wave height above the swell height and no
  // wind can tidy.
  let sea = 1;
  if (h > 0 && (k.wwh != null || k.th != null)) {
    const wwh = k.wwh || 0;
    const cross = k.th != null ? Math.sqrt(Math.max(0, k.th * k.th - k.h * k.h - wwh * wwh)) : 0;
    const r = (wwh * (rel === 'offshore' ? 0.5 : 1) + cross) / k.h;
    sea = r > 1 ? 0.5 : r > 0.6 ? 0.7 : r > 0.35 ? 0.85 : 1;
    const bits = [];
    if (wwh >= 0.1) bits.push(`${hgt(wwh)} wind chop`);
    if (cross >= 0.2) bits.push(`${hgt(cross)} cross swell`);
    f.push({ label: 'Sea state', mult: sea, now: bits.length ? `${bits.join(' + ')} on ${hgt(k.h)} swell` : 'clean', likes: 'one clean groundswell' });
  }

  let tide = 1;
  if (k.tn != null && b.tide && b.tide.range) {
    const [tlo, thi] = b.tide.range;
    const out = k.tn < tlo ? tlo - k.tn : k.tn > thi ? k.tn - thi : 0;
    tide = out === 0 ? 1 : out <= 0.15 ? 0.85 : 0.65;
    if (b.tide.dir && k.tdir && b.tide.dir !== k.tdir) tide *= 0.9;
    f.push({ label: 'Tide', mult: tide, now: `${tideWord(k.tn)}${k.tdir ? ` and ${k.tdir}` : ''}`, likes: b.tide.text });
  }

  let total = (size + per + dir) * wind * sea * tide * clean, cap = '', dark = false;
  if (k.day === 0) { total = 0; cap = 'After dark'; dark = true; }
  else if (h < 0.4) { total = 0; cap = `Under ${hgt(0.4)}, flat`; }
  else if (h > hi * 1.4) { total = Math.min(total, 3); cap = `Capped: ${hgt(h)} is too big for this spot`; }
  else if (h < lo * 0.7) { total = Math.min(total, 4); cap = `Capped: ${hgt(h)} is too small for this spot`; }
  total = Math.round(total * 2) / 2;
  const level = total === 0 ? 0 : total <= 3.5 ? 1 : total <= 6 ? 2 : total <= 8 ? 3 : 4;
  return { total, level, label: dark ? 'Dark' : LEVELS[level], wind: rel, factors: f, cap };
}


const hourOf = (t) => parseInt(t.slice(11, 13), 10);

const levelOf = (total) => (total === 0 ? 0 : total <= 3.5 ? 1 : total <= 6 ? 2 : total <= 8 ? 3 : 4);

/* ---------- Fetching ---------- */

// Open-Meteo's marine model is coastal-coarse; a point on the sand can land
// in a cell with no sea data, so sample ~6 km out in the direction the
// beach faces.
const offshore = (c) => {
  const rad = c.faces * Math.PI / 180;
  const lat = c.lat + 0.06 * Math.cos(rad);
  const lng = c.lng + 0.06 * Math.sin(rad) / Math.cos(c.lat * Math.PI / 180);
  return [lat.toFixed(4), lng.toFixed(4)];
};

const MARINE = ['swell_wave_height', 'swell_wave_period', 'swell_wave_direction', 'wave_height', 'wave_period', 'wave_direction', 'wind_wave_height', 'sea_level_height_msl', 'sea_surface_temperature'];
const WIND = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'is_day', 'temperature_2m'];

// Open-Meteo answers with an object for one location, an array for several.
const asList = (r) => (Array.isArray(r) ? r : [r]);
const row = (hourly, i) => Object.fromEntries(Object.keys(hourly).map((k) => [k, hourly[k][i]]));
const toK = (m, w) => {
  const h = m.swell_wave_height ?? m.wave_height;
  if (h == null || w.wind_speed_10m == null) return null;
  return {
    h, p: m.swell_wave_period ?? m.wave_period, d: m.swell_wave_direction ?? m.wave_direction, wwh: m.wind_wave_height, th: m.wave_height,
    ws: w.wind_speed_10m, wd: w.wind_direction_10m, wg: w.wind_gusts_10m, day: w.is_day == null ? 1 : w.is_day,
    tide: m.sea_level_height_msl, sst: m.sea_surface_temperature, air: w.temperature_2m,
  };
};
// Tide state from the day's sea-level curve: tn is 0 at today's low water
// and 1 at high; tdir is which way it's running right now.
function addTide(hours, k, idx) {
  const levels = hours.map((x) => x.tide).filter((v) => v != null);
  if (levels.length < 3 || k.tide == null) return;
  const min = Math.min(...levels), max = Math.max(...levels);
  if (max - min < 0.2) return;
  k.tn = Math.min(1, Math.max(0, (k.tide - min) / (max - min)));
  const prev = hours[Math.max(0, idx - 1)], next = hours[Math.min(hours.length - 1, idx + 1)];
  if (prev && next && prev.tide != null && next.tide != null) k.tdir = next.tide > prev.tide ? 'rising' : 'falling';
}
// Today's highs and lows from the hourly curve, refined by fitting a
// parabola through each peak so the time is good to ~10 minutes.
function tideEvents(hours) {
  const out = [];
  for (let i = 1; i < hours.length - 1; i++) {
    const a = hours[i - 1].tide, b = hours[i].tide, c = hours[i + 1].tide;
    if (a == null || b == null || c == null) continue;
    const high = b > a && b >= c, low = b < a && b <= c;
    if (!high && !low) continue;
    const den = a - 2 * b + c;
    const off = den ? 0.5 * (a - c) / den : 0; // vertex offset in hours, -0.5…0.5
    // Hourly values stand for the whole hour, so their centre is at :30.
    // Checked against the Cascais tide table: lands within ~5 minutes.
    const mins = Math.round((hourOf(hours[i].t) + 0.5 + off) * 60);
    const hh = Math.floor(mins / 60), mm = mins % 60;
    out.push({ kind: high ? 'High' : 'Low', mins, t: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` });
  }
  return out;
}
const fmtMins = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
// "High 14:51 · Low 21:10": what's still to come today, or the whole day once it's over.
function tideTimes(src) {
  const ev = Array.isArray(src) ? src : src && src.tides;
  if (!ev || !ev.length) return '';
  const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
  const ahead = ev.filter((e) => e.mins >= nowMins);
  return (ahead.length ? ahead : ev).map((e) => `${e.kind} ${fmtMins(e.mins)}`).join(' · ');
}

// Prefer `current`; fall back to the hourly row nearest to now.
function pick(loc) {
  if (!loc) return null;
  if (loc.current) return { ...loc.current };
  if (!loc.hourly || !loc.hourly.time) return null;
  const now = Date.now();
  let best = 0, bestD = Infinity;
  loc.hourly.time.forEach((t, i) => { const d = Math.abs(new Date(t) - now); if (d < bestD) { bestD = d; best = i; } });
  return row(loc.hourly, best);
}

// A point `km` kilometres out to sea from the cam, in the direction it faces.
const seaward = (c, km) => {
  const rad = c.faces * Math.PI / 180, d = km / 111;
  return [c.lat + d * Math.cos(rad), c.lng + d * Math.sin(rad) / Math.cos(c.lat * Math.PI / 180)];
};

