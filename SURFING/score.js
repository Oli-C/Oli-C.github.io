/* Scoring engine, units, Open-Meteo field mapping and tide helpers — shared by index.html (live cams) and week.html (7-day outlook).
   Plain script, no modules, so file:// and GitHub Pages both work. */

const LEVELS = ['Flat', 'Poor', 'Fair', 'Good', 'Epic'];
// The Cloudflare worker (tools/worker/): feedback in, hourly forecast out.
const SURF_WORKER = 'https://surf-feedback.odj-clarke.workers.dev';
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
// Wind is scored in km/h (Open-Meteo default) but shown in knots.
const kts = (kmh) => Math.round(kmh * 0.53996);
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
// Body-height words for a wave face (the swell height, roughly).
const sizeWord = (h) => (h < 0.3 ? 'Flat' : h < 0.6 ? 'Knee to thigh' : h < 0.9 ? 'Thigh to waist' : h < 1.2 ? 'Waist to shoulder' : h < 1.6 ? 'Shoulder to head' : h < 2.2 ? 'Head high to overhead' : h < 3 ? 'Well overhead' : 'Double overhead and up');
// Wetsuit by water temperature — a rule of thumb, not gospel.
const suit = (t) => (t >= 22 ? 'boardies' : t >= 19 ? '2 mm spring' : t >= 16 ? '3/2 mm' : t >= 13 ? '4/3 mm' : '5/4 mm + boots');

// Arrival factor from a spot's geometry table (geo.js): resp[dir] holds
// [8 s, 11 s, 14 s] factors for deep-water swell FROM each 15° direction;
// interpolate in direction and period.
function geoArrive(geo, d, p) {
  const dn = ((d % 360) + 360) % 360, d0 = Math.floor(dn / 15) * 15, d1 = (d0 + 15) % 360, f = (dn - d0) / 15;
  const pi = p <= 8 ? 0 : p >= 14 ? 2 : (p - 8) / 3;
  const at = (dir) => { const r = geo.resp[dir] || [1, 1, 1], i = Math.min(1, Math.floor(pi)), t = pi - i; return r[i] + (r[i + 1] - r[i]) * t; };
  return at(d0) * (1 - f) + at(d1) * f;
}

// Wind direction is where it blows FROM. Offshore = inside the spot's
// window (give or take 15°); onshore = roughly from the sea; the rest is
// cross-shore, which is what a nortada does to the west-facing beaches.
// How much of the offshore swell reaches this beach. geo.js (coastline
// shadowing + Snell refraction from real bathymetry) is generated but its
// shadow test is still too binary for the sheltered Cascais spots, so it
// stays off until it's been checked against measured face heights; the
// hand-set rule applies: whole within 45° of the facing, fading to the
// spot's exposure floor by 110°, long period wrapping a little better.
const USE_GEO = false;
// What surfers' logged sessions have taught us about a spot (data/skill.json
// "learned", fitted by tools/skill.mjs); null until there are reports.
const learnedSpot = (id) => (typeof sharedSkill !== 'undefined' && sharedSkill && sharedSkill.learned && sharedSkill.learned.spots && sharedSkill.learned.spots[id]) || null;
// raw: leave out the learned size correction (training needs the plain rule).
function arrival(c, k, raw) {
  const b = c.best, p = k.p || 0;
  const bend = k.d != null ? angleDiff(k.d, c.faces) : 0;
  const geo = USE_GEO && typeof GEO !== 'undefined' && GEO[c.id] && k.d != null;
  let arrive;
  if (geo) arrive = geoArrive(GEO[c.id], k.d, p);
  else {
    // Whole within 20° of the facing, then the cosine of the angle (a
    // swell 50° off hits with ~65% of its height), never below the floor.
    const floor = b.exposure == null ? 0.85 : b.exposure;
    arrive = bend <= 20 ? 1 : Math.max(floor, Math.cos(bend * Math.PI / 180));
    if (bend > 45 && p >= 12) arrive = Math.min(1, arrive * 1.15);
  }
  // Logged sessions' wave sizes against ours: a gentle correction to how
  // much swell reaches this beach, the spot's own once it has 3 sized
  // sessions, else the coast's once there are 15.
  let learned = 1;
  if (!raw) {
    const L = learnedSpot(c.id), C = typeof sharedSkill !== 'undefined' && sharedSkill && sharedSkill.learned && sharedSkill.learned.coast;
    if (L && L.size && L.size.n >= 3) learned = L.size.gain;
    else if (C && C.size && C.size.n >= 15) learned = C.size.gain;
  }
  return { arrive: arrive * (b.gain || 1) * learned, geo: !!geo };
}
// Breaking face height at the beach, as a [low, high] range in metres,
// the way forecast apps quote surf. Faces run a little under the arriving
// significant height, more so when the period is short.
function faceRange(c, k, raw) {
  if (!k || k.h == null) return [0, 0];
  const sw = swellTrains(c, k, raw), p = sw.main.p;
  const face = sw.h * (p >= 12 ? 0.9 : p >= 9 ? 0.8 : 0.7);
  return [+(face * 0.8).toFixed(1), +(face * 1.1).toFixed(1)];
}

// Size, period and direction points for one swell train at this spot
// (t.ha is its height on arrival at the beach).
function swellPts(c, t) {
  const b = c.best, [lo, hi] = b.size, P = b.period, h = t.ha;
  const sweet = lo + 0.4 * (hi - lo);
  const size = h <= sweet ? lerp(h, lo * 0.5, 0, sweet, 4) : h <= hi ? 4 : lerp(h, hi, 4, hi * 1.4, 0);
  const per = lerp(t.p, P - 2, 0, P + 5, 3);
  const dir = t.d != null ? lerp(distToWindow(t.d, b.swell), 0, 3, 60, 0) : 2;
  return { size, per, dir, total: size + per + dir };
}

// The swell trains as they reach this beach. Most days one groundswell
// does the work, but a smaller swell from another angle can be the one
// that actually gets into a sheltered spot (a SW swell into the Cascais
// bay under a NW swell the cape blocks). Each train is arrived on its own
// and the one bringing more energy to the beach (height² × period) is the
// main swell. Within 30° of each other they add up as energy (heights
// combine as the root of the sum of squares); further apart, the other
// one is a cross swell.
function swellTrains(c, k, raw) {
  const ts = [{ h: k.h, p: k.p || 0, d: k.d }];
  if (k.h2 != null && k.h2 >= 0.2 && k.p2 >= 6 && k.d2 != null) ts.push({ h: k.h2, p: k.p2, d: k.d2, second: true });
  for (const t of ts) {
    const a = arrival(c, t, raw);
    t.arrive = a.arrive; t.geo = a.geo; t.ha = t.h * a.arrive;
    t.pts = swellPts(c, t);
  }
  ts.sort((a, b) => b.ha * b.ha * b.p - a.ha * a.ha * a.p);
  const [main, other = null] = ts;
  const merged = !!other && main.d != null && other.d != null && angleDiff(main.d, other.d) <= 30;
  return { main, other, merged, h: merged ? Math.sqrt(main.ha * main.ha + other.ha * other.ha) : main.ha };
}

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
  const b = c.best, P = b.period;
  const [lo, hi] = b.size;
  const f = [];

  // The main swell is whichever train works best here; see swellTrains.
  const sw = swellTrains(c, k), m = sw.main, p = m.p;
  const h = sw.h;
  let hNow = Math.abs(m.arrive - 1) < 0.05 ? hgt(h) : `${hgt(h)} at the beach (${hgt(m.h)} offshore)`;
  if (sw.merged) hNow += `, two swells from the ${dirName(m.d)} combined`;
  else if (m.second) hNow += `, from the ${dirName(m.d)} secondary swell`;
  if (m.geo) hNow += ' · by geometry';

  const size = sw.merged ? swellPts(c, { ...m, ha: h }).size : m.pts.size;
  f.push({ label: 'Size', pts: size, max: 4, now: hNow, likes: rng(lo, hi) });

  const per = m.pts.per;
  // Short-period swell is lumpy however clean the wind is, so it also
  // scales the whole score, not just its own 3 points.
  const clean = p < 8 ? 0.6 : p < 10 ? 0.8 : p < 12 ? 0.9 : 1;
  f.push({ label: 'Period', pts: per, max: 3, now: `${Math.round(p)} s${clean < 1 ? ', lumpy' : ''}`, likes: `${P} s and up` });

  // Angle still matters once the swell is in: straight into the window
  // lines up the banks; well outside it tends to bend in as closeouts.
  const dir = m.pts.dir;
  f.push({ label: 'Direction', pts: dir, max: 3, now: m.d != null ? `from ${dirName(m.d)}` : 'unknown', likes: windowText(b.swell) });

  // Speeds are km/h. Under ~4 kt it's glassy whatever the direction; a
  // light onshore already textures the face (Surfline calls 5-6 kt onshore
  // "Fair" at best), and from ~12 kt it wrecks it.
  const rel = windRel(c, k), ws = k.ws;
  let wind;
  if (ws < 7)             wind = 1;                                                   // glassy
  else if (rel === 'offshore') wind = ws < 25 ? 1 : ws < 35 ? 0.9 : ws < 45 ? 0.75 : 0.6;
  else if (rel === 'onshore')  wind = ws < 15 ? 0.7 : ws < 22 ? 0.5 : ws < 30 ? 0.35 : ws < 40 ? 0.2 : 0.1;
  else                         wind = ws < 15 ? 0.85 : ws < 25 ? 0.7 : ws < 35 ? 0.5 : 0.3;
  const gusty = k.wg != null && k.wg > 25 && k.wg > ws * 1.5;
  if (gusty) wind *= 0.85;
  f.push({ label: 'Wind', mult: wind, now: `${kts(ws)} kts ${dirName(k.wd)}, ${rel}${gusty ? `, gusting ${kts(k.wg)}` : ''}`, likes: `${windowText(b.wind)} offshore` });

  // Sea state: wind chop (sampled offshore, so an offshore wind grooms it
  // and it counts half) plus any second swell crossing the main one, which
  // no wind can tidy. That's the other train as it arrives here, plus any
  // energy still unexplained: total wave height left over above both
  // swells and the chop (third swells, models disagreeing), arrived like
  // the main swell.
  let sea = 1;
  if (h > 0 && (k.wwh != null || k.th != null || sw.other)) {
    const wwh = k.wwh || 0, h2 = k.h2 || 0;
    const rest = k.th != null ? Math.sqrt(Math.max(0, k.th * k.th - k.h * k.h - h2 * h2 - wwh * wwh)) * m.arrive : 0;
    const other = sw.other && !sw.merged ? sw.other.ha : 0;
    const cross = Math.sqrt(other * other + rest * rest);
    const crossDir = other >= rest && sw.other ? sw.other.d : null;
    const r = wwh * (rel === 'offshore' ? 0.5 : 1) / Math.max(m.h, 0.1) + cross / Math.max(h, 0.1);
    sea = r > 1 ? 0.5 : r > 0.6 ? 0.7 : r > 0.35 ? 0.85 : 1;
    const bits = [];
    if (wwh >= 0.1) bits.push(`${hgt(wwh)} wind chop`);
    if (cross >= 0.2) bits.push(`${hgt(cross)} cross swell${crossDir != null ? ' from ' + dirName(crossDir) : ''}`);
    f.push({ label: 'Sea state', mult: sea, now: bits.length ? `${bits.join(' + ')} on ${hgt(h)} swell` : 'clean', likes: 'one clean groundswell' });
  }

  // How clean the surface should be, in surfers' words: the wind against
  // the beach (light anything is glassy; offshore grooms; cross and onshore
  // texture it, then chop it up), roughed up further by gusts and by chop
  // or a cross swell. Logged sessions correct it (see surfaceLearned).
  // In knots: under 4 glassy; offshore clean until it's strong (19+, spray
  // and hard paddling); cross clean under 8, bumpy to 16, choppy to 22;
  // onshore bumpy under 6, choppy to 13, then blown out. Only strong gusts
  // (19 kts+, half as much again as the wind) rough it up a step.
  let surf;
  if (ws < 7) surf = 0;
  else if (rel === 'offshore') surf = ws < 35 ? 1 : 2;
  else if (rel === 'cross-shore') surf = ws < 15 ? 1 : ws < 30 ? 2 : ws < 40 ? 3 : 4;
  else surf = ws < 12 ? 2 : ws < 25 ? 3 : 4;
  if (rel !== 'offshore' && k.wg != null && k.wg >= 35 && k.wg > ws * 1.5) surf = Math.min(4, surf + 1);
  // A cross swell or leftover chop makes it lumpy, not choppy: bumpy at worst.
  if (sea <= 0.7) surf = Math.max(surf, 2);
  else if (sea <= 0.85 && surf === 0) surf = 1;
  const surfLearn = surfaceLearned(c, k, surf);
  const surface = { i: surfLearn ? surfLearn.i : surf, label: SURFACES[surfLearn ? surfLearn.i : surf], base: surf, learned: surfLearn ? surfLearn.text : '' };

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
  else if (h < 0.3) { total = 0; cap = `Under ${hgt(0.3)}, flat`; }
  else if (h > hi * 1.4) { total = Math.min(total, 3); cap = `Capped: ${hgt(h)} is too big for this spot`; }
  else if (h < lo * 0.7) { total = Math.min(total, 4); cap = `Capped: ${hgt(h)} is too small for this spot`; }
  // Pooled "was it right?" verdicts for this spot (data/skill.json): a spot
  // people keep marking too high gets scaled down, and vice versa.
  const cal = typeof sharedSkill !== 'undefined' && sharedSkill && sharedSkill.calibration && sharedSkill.calibration[c.id];
  if (cal && cal.n >= 5 && cal.f && Math.abs(cal.f - 1) >= 0.02) {
    total *= cal.f;
    f.push({ label: 'Verdicts', mult: cal.f, now: `${cal.n} people said ${cal.f < 1 ? 'too high' : 'too low'} more often`, likes: 'about right' });
  }
  // Logged sessions: what surfers said it was actually like in conditions
  // like these, here and across the coast (see learnedCorrection). Never
  // lifts a dark or flat hour, and the size caps still hold.
  if (!dark && h >= 0.3) {
    const corr = learnedCorrection(c, k);
    if (corr) {
      const before = total;
      total = Math.max(0, Math.min(10, total + corr.pts));
      if (h > hi * 1.4) total = Math.min(total, 3);
      else if (h < lo * 0.7) total = Math.min(total, 4);
      f.push({ label: 'Sessions', mult: before > 0 ? total / before : 1, now: corr.text, likes: 'scores that match logged sessions' });
    }
  }
  total = Math.round(total * 2) / 2;
  const level = levelOf(total);

  // Where the sources disagree, say so rather than pretend to be sure.
  const notes = [];
  if (k.src) {
    if (k.src.windSpread >= 60) notes.push(`Models disagree on wind direction (${k.src.windSpread}° apart)`);
    if (k.src.hSpread >= 0.6) notes.push(`Models disagree on swell size (${hgt(k.src.hMin)}–${hgt(k.src.hMax)})`);
  }
  if (k.obs && k.obs.wd != null && k.obs.ws != null) {
    const m = k.model || k;   // compare with the models before the station was folded in
    const dOff = angleDiff(k.obs.wd, m.wd), sOff = Math.abs(k.obs.ws - m.ws);
    if (dOff >= 60 || sOff >= 18) notes.push(`${k.obs.station} measured ${kts(k.obs.ws)} kts ${dirName(k.obs.wd)} at ${k.obs.t}; models said ${kts(m.ws)} kts ${dirName(m.wd)}${k.obsW ? ' — the reading is weighted in' : ''}`);
  }
  return { total, level, label: dark ? 'Dark' : LEVELS[level], wind: rel, factors: f, cap, notes, surface };
}

// Surface words, cleanest first. Index is what sessions report and train.
const SURFACES = ['Glassy', 'Clean', 'Bumpy', 'Choppy', 'Blown out'];
// The learned correction to the surface: coast-wide and per spot, the same
// ridge fit as the scores but on how much cleaner or messier surfers found
// it than we said. Only moves the word when it shifts by half a step.
function surfaceLearned(c, k, base) {
  const L = typeof sharedSkill !== 'undefined' && sharedSkill && sharedSkill.learned;
  if (!L || !L.surface) return null;
  const x = features(c, k), S = L.surface.spots && L.surface.spots[c.id];
  const g = L.surface.coast && L.surface.coast.n >= 15 ? dotW(L.surface.coast.w, x) : 0;
  const s = S && S.n >= 3 ? dotW(S.w, x) : 0;
  const i = Math.max(0, Math.min(4, Math.round(base + Math.max(-2, Math.min(2, g + s)))));
  if (i === base) return null;
  return { i, text: `${i < base ? 'cleaner' : 'messier'} than the wind suggests, from logged sessions` };
}

/* ---------- Learning from logged sessions ----------
   A surfer logs when they surfed, how it was (Flat … Epic) and the wave
   size they saw; the page saves the forecast for those hours with it.
   tools/skill.mjs then fits, by ridge regression, how far our score was
   off from what they said, as a sum of small adjustments for the kind of
   conditions it was (tide, wind, size, period, angle):

     prior   the hand-set spot knowledge in spots.js (no adjustment)
     coast   adjustments learned from every session on every spot
     spot    this spot's own sessions, on top of the coast's

   Both levels are shrunk towards zero, so a handful of reports nudges and
   only a consistent pattern moves a score far. Sizes are learned the same
   way, as a per-spot correction to how much swell reaches the beach. */

// What surfers pick, and what each means on our 0–10 scale.
const SESSION_RATINGS = ['Flat', 'Poor', 'Fair', 'Good', 'Epic'];
const SESSION_TARGET = [0, 2, 5, 7.5, 9.5];
// Wave size seen (face), and the face height each band stands for.
const SIZE_BANDS = ['Flat', 'Knee–thigh', 'Waist–chest', 'Shoulder–head', 'Overhead', 'Well overhead'];
const SIZE_FACE = [0.15, 0.55, 1.05, 1.6, 2.3, 3.2];
const SIZE_EDGES = [0.3, 0.8, 1.3, 1.9, 2.7];
const sizeBand = (face) => { let i = 0; while (i < SIZE_EDGES.length && face >= SIZE_EDGES[i]) i++; return i; };
const SESSION_WHY = { wind: 'Wind', small: 'Too small', big: 'Too big', tide: 'Wrong tide', inconsistent: 'Inconsistent', crowd: 'Crowded' };
// Wave shape: whether the waves were rideable, the other half of "clean".
const SESSION_SHAPE = ['Peeling', 'Mixed', 'Closing out'];

// The kinds of conditions an adjustment can attach to. One-hot buckets
// plus an intercept; the same function scores live hours and training rows,
// always on the plain rules (no learned size), so they stay comparable.
const FEATURES = ['bias', 'tide:low', 'tide:mid', 'tide:high', 'wind:light', 'wind:off', 'wind:cross', 'wind:on',
  'size:small', 'size:in', 'size:big', 'period:short', 'period:mid', 'period:long', 'dir:in', 'dir:near', 'dir:out'];
function features(c, k) {
  const x = { bias: 1 };
  if (k.tn != null) x['tide:' + tideWord(k.tn)] = 1;
  const rel = windRel(c, k);
  x[k.ws < 10 ? 'wind:light' : rel === 'offshore' ? 'wind:off' : rel === 'onshore' ? 'wind:on' : 'wind:cross'] = 1;
  const sw = swellTrains(c, k, true), [lo, hi] = c.best.size;
  x[sw.h < lo ? 'size:small' : sw.h > hi ? 'size:big' : 'size:in'] = 1;
  const p = sw.main.p;
  x[p < 10 ? 'period:short' : p < 13 ? 'period:mid' : 'period:long'] = 1;
  if (sw.main.d != null) { const dd = distToWindow(sw.main.d, c.best.swell); x[dd === 0 ? 'dir:in' : dd <= 30 ? 'dir:near' : 'dir:out'] = 1; }
  return x;
}
const dotW = (w, x) => (w ? Object.keys(x).reduce((s, f) => s + (w[f] || 0) * x[f], 0) : 0);
// Points to add to a live score: the coast-wide adjustment (once there are
// enough sessions to trust it) plus this spot's own, capped at ±3.
function learnedCorrection(c, k) {
  const L = typeof sharedSkill !== 'undefined' && sharedSkill && sharedSkill.learned;
  if (!L) return null;
  const x = features(c, k), S = L.spots && L.spots[c.id];
  const g = L.coast && L.coast.n >= 15 ? dotW(L.coast.w, x) : 0;
  const s = S && S.n >= 3 ? dotW(S.w, x) : 0;
  const pts = Math.max(-3, Math.min(3, g + s));
  if (Math.abs(pts) < 0.25) return null;
  const n = (S && S.n) || 0;
  return { pts, text: `${pts > 0 ? '+' : '−'}${Math.abs(pts).toFixed(1)} from ${n ? `${n} session${n > 1 ? 's' : ''} here` : 'sessions on this coast'}${n && L.coast && L.coast.n >= 15 ? ` and ${L.coast.n} on the coast` : ''}` };
}


const hourOf = (t) => parseInt(t.slice(11, 13), 10);

// Bands: Poor to 3.5, Fair to 6.5, Good to 8.5, Epic above — Epic needs a
// near-perfect day, not just a good one.
const levelOf = (total) => (total === 0 ? 0 : total <= 3.5 ? 1 : total <= 6.5 ? 2 : total <= 8.5 ? 3 : 4);

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

// Secondary swell comes from Météo-France and NCEP; the DWD models don't
// split it out.
const MARINE = ['swell_wave_height', 'swell_wave_period', 'swell_wave_peak_period', 'swell_wave_direction', 'secondary_swell_wave_height', 'secondary_swell_wave_period', 'secondary_swell_wave_direction', 'wave_height', 'wave_period', 'wave_direction', 'wind_wave_height', 'sea_level_height_msl', 'sea_surface_temperature'];
const WIND = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'is_day', 'temperature_2m'];

// Several models per metric, so one model's quirk doesn't decide a score.
// Open-Meteo suffixes each model's hourly series with its id; we blend
// them per hour (median for sizes and speeds, circular mean for directions)
// and keep the individual values to show alongside. ECMWF's wave model is
// left out: its 0.25° grid is blank at these coastal points.
// `w` is a base weight for how much we trust the model here: finer grids
// and the better global models count for more. Wind weights are then
// adjusted by each model's measured track record against nearby stations
// (see `learn`), because for wind we have ground truth; swell has none.
const WIND_MODELS = [
  { key: 'best_match', name: 'Best match', w: 1.0 },
  { key: 'ecmwf_ifs025', name: 'ECMWF', w: 1.4 },
  { key: 'gfs_seamless', name: 'GFS', w: 0.7 },
  { key: 'icon_seamless', name: 'ICON', w: 1.2 },
  { key: 'meteofrance_seamless', name: 'Météo-France', w: 1.2 },
  { key: 'ukmo_seamless', name: 'UKMO', w: 1.0 },
];
const MARINE_MODELS = [
  { key: 'marine_best_match', id: 'best_match', name: 'Best match', w: 1.0 },
  { key: 'meteofrance_wave', name: 'Météo-France', w: 1.3 },   // 0.1° MFWAM, good on this coast
  { key: 'ncep_gfswave025', name: 'NCEP', w: 0.8 },           // 0.25° global
  { key: 'ewam', name: 'DWD EWAM', w: 1.3 },                  // 0.05° European
  { key: 'gwam', name: 'DWD GWAM', w: 0.8 },                  // 0.25° global
];
const modelIds = (models) => models.map((m) => m.id || m.key).join();

// Weighted median: the value where half the weight sits on either side.
function wMedian(vals, ws) {
  const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
  const total = ws.reduce((a, x) => a + x, 0);
  let acc = 0;
  for (const i of idx) { acc += ws[i]; if (acc >= total / 2) return vals[i]; }
  return vals[idx[idx.length - 1]];
}
// Weighted mean of bearings that respects the wrap at north.
const meanDir = (ds, ws) => {
  let x = 0, y = 0;
  ds.forEach((d, i) => { const w = ws ? ws[i] : 1; x += w * Math.cos(d * Math.PI / 180); y += w * Math.sin(d * Math.PI / 180); });
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
};
const dirSpread = (ds) => { if (ds.length < 2) return 0; const m = meanDir(ds); return Math.round(Math.max(...ds.map((d) => angleDiff(d, m)))); };
// One model's values at hourly index i (nulls where it has none).
const modelRow = (hourly, i, vars, m) => Object.fromEntries(vars.map((v) => { const s = hourly[`${v}_${m.key}`]; return [v, s ? s[i] : null]; }));
const median = (a) => { const s = a.slice().sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
// Which of these values are outliers (indices), given at least four to
// judge by: a bearing 90°+ off the rest, or a size/speed well outside the
// pack (2.5 median absolute deviations, or 25% of the median if tighter).
function outliers(vals, isDir) {
  if (vals.length < 4) return new Set();
  let out;
  if (isDir) { const m = meanDir(vals); out = vals.map((x, i) => (angleDiff(x, m) > 90 ? i : -1)); }
  else {
    const med = median(vals), mad = median(vals.map((x) => Math.abs(x - med)));
    const tol = Math.max(2.5 * mad, 0.25 * Math.abs(med), 0.3);
    out = vals.map((x, i) => (Math.abs(x - med) > tol ? i : -1));
  }
  const set = new Set(out.filter((i) => i >= 0));
  return vals.length - set.size >= 3 ? set : new Set();   // never throw away the majority
}
// Blend several models' rows into one, each row counting `weights[i]`,
// with outliers set aside first.
function blend(rows, vars, weights) {
  const out = {};
  for (const v of vars) {
    // A wave model with no coverage at a point (or no second swell) reports
    // 0, not null; don't let it vote on height, period or direction when
    // other models see real swell.
    const hk = v.replace(/_(peak_period|period|direction)$/, '_height');
    const hv = hk !== v && vars.includes(hk) ? hk : v.endsWith('_height') ? v : null;
    const seen = hv && rows.some((r) => r[hv] > 0.05);
    let pairs = rows.map((r, i) => [r[v], weights ? weights[i] : 1, r]).filter(([x, , r]) => x != null && !Number.isNaN(x) && (!seen || r[hv] > 0.05));
    if (!pairs.length) { out[v] = null; continue; }
    if (v !== 'is_day') { const drop = outliers(pairs.map((p) => p[0]), v.endsWith('_direction')); if (drop.size) pairs = pairs.filter((_, i) => !drop.has(i)); }
    const vals = pairs.map((p) => p[0]), ws = pairs.map((p) => p[1]);
    out[v] = v.endsWith('_direction') ? Math.round(meanDir(vals, ws)) : v === 'is_day' ? vals[0] : +wMedian(vals, ws).toFixed(2);
  }
  return out;
}

/* ---------- Learning which wind models are reliable here ----------
   Every time a station reading lines up with a forecast hour, each model's
   miss (degrees off, km/h off) nudges a running average kept on this
   device. A model's weight is its base weight shrunk by its average miss,
   so after a few days the blend leans on whichever models have actually
   been right at these spots. */
const SKILL_KEY = 'surf-skill';
let skill = {};
try { skill = JSON.parse(localStorage.getItem(SKILL_KEY) || '{}') || {}; } catch {}
// Shared skill, published by the scheduled Action (data/skill.json): every
// model's running miss against IPMA stations (wind) and IH buoys (waves),
// measured continuously for everyone. Device-local learning nudges it.
let sharedSkill = null;
async function loadSharedSkill(url = 'data/skill.json') {
  try { const r = await fetch(url, { cache: 'no-cache' }); if (r.ok) sharedSkill = await r.json(); } catch {}
  return sharedSkill;
}
function modelWeight(m) {
  const sh = sharedSkill && sharedSkill.wind && sharedSkill.wind[m.key];
  const lo = skill[m.key];
  let dir = null, spd = null;
  if (sh && sh.n >= 10 && sh.spd != null) {
    dir = sh.dir == null ? 45 : sh.dir; spd = sh.spd;
    if (lo && lo.n >= 3) { dir = (dir * 3 + lo.dir) / 4; spd = (spd * 3 + lo.spd) / 4; }   // local nudge
  } else if (lo && lo.n >= 3) { dir = lo.dir; spd = lo.spd; }
  if (dir == null) return m.w;
  return m.w / (1 + dir / 90 + spd / 20);    // a 90° or 20 km/h average miss halves the weight
}
// Wave models have no local ground truth; only the shared buoy record counts.
function waveWeight(m) {
  const sh = sharedSkill && sharedSkill.wave && sharedSkill.wave[m.id || m.key];
  if (!sh || sh.n < 10 || sh.hRel == null) return m.w;
  return m.w / (1 + sh.hRel / 0.3 + (sh.p == null ? 0 : sh.p / 4));   // 30% height or 4 s period miss halves it
}
// dirErr may be null (light air, direction meaningless); then only speed counts.
function learn(key, dirErr, spdErr) {
  const s = skill[key] || { n: 0, dir: 45, spd: 8 };
  const a = 0.1;
  s.n++;
  if (dirErr != null) s.dir += a * (dirErr - s.dir);
  s.spd += a * (spdErr - s.spd);
  skill[key] = s;
}
function saveSkill() { try { localStorage.setItem(SKILL_KEY, JSON.stringify(skill)); } catch {} }

// Stations on capes and open coast read the sea breeze honestly; inland
// ones are sheltered, so they count for less.
const COASTAL_STATIONS = ['Cabo Raso', 'Cabo da Roca', 'Cabo Carvoeiro', 'Sagres', 'Sines', 'Santa Cruz', 'Pedro de Moel', 'Zambujeira', 'Milfontes', 'Colares', 'Setúbal'];
// How much a station reading should count against the model blend (which
// counts 1): fresh, close, well-sited readings count up to 2.5×.
function obsWeight(obs, hoursAway) {
  if (!obs || obs.ws == null) return 0;
  const siting = COASTAL_STATIONS.some((n) => obs.station.includes(n)) ? 1 : 0.6;
  const fresh = lerp(Math.abs(hoursAway), 0.5, 1, 3, 0);   // full at the reading's own hour, gone by 3 h
  const near = lerp(obs.km, 5, 1, 25, 0.3);
  return +(2.5 * siting * fresh * near).toFixed(2);
}
// Fold a station reading into a row's wind.
function applyObs(k, obs, w) {
  if (!w) return k;
  k.ws = +((k.ws + obs.ws * w) / (1 + w)).toFixed(1);
  if (obs.wd != null && k.wd != null) k.wd = Math.round(meanDir([k.wd, obs.wd], [1, w]));
  k.obsW = +w.toFixed(2);
  return k;
}
// 0–1: how much the sources agree. Spread between models costs; a station
// that backs the models earns some back.
function confidence(src, obs, k) {
  if (!src) return null;
  let c = 1;
  c -= lerp(src.windSpread || 0, 30, 0, 120, 0.4);
  c -= lerp(src.wsSpread || 0, 8, 0, 25, 0.2);
  c -= lerp(src.hMax && src.hMin ? (src.hMax - src.hMin) / src.hMax : 0, 0.15, 0, 0.5, 0.3);
  if (obs && obs.wd != null && k.model) {
    const agree = angleDiff(obs.wd, k.model.wd) <= 45 && Math.abs(obs.ws - k.model.ws) <= 12;
    c += agree ? 0.1 : -0.15;
  }
  return Math.max(0, Math.min(1, c));
}
const confWord = (c) => (c == null ? '' : c >= 0.75 ? 'High' : c >= 0.45 ? 'Medium' : 'Low');

// One forecast hour from every model, blended. Returns the blended row
// (with the models' spread and a copy of the model-only wind, for
// confidence and for comparing against a station) plus the raw rows.
function blendHour(mH, wH, j, windW, marineW) {
  const mRows = MARINE_MODELS.map((mod) => modelRow(mH, j, MARINE, mod));
  const wRows = WIND_MODELS.map((mod) => modelRow(wH, j, WIND, mod));
  const k = toK(blend(mRows, MARINE, marineW), blend(wRows, WIND, windW));
  if (!k) return null;
  const wds = wRows.map((r) => r.wind_direction_10m).filter((v) => v != null);
  const hs = mRows.map((r) => r.swell_wave_height ?? r.wave_height).filter((v) => v != null && v > 0.05);
  k.spread = { wd: dirSpread(wds), h: hs.length > 1 ? +((Math.max(...hs) - Math.min(...hs)) / Math.max(...hs)).toFixed(2) : 0 };
  k.model = { ws: k.ws, wd: k.wd };
  return { k, mRows, wRows };
}
// 0–1 confidence for a forecast day: model spread (averaged over its
// hours) costs, and so does distance into the future.
function dayConfidence(hours, dayIdx) {
  const sp = hours.map((k) => k.spread).filter(Boolean);
  if (!sp.length) return null;
  const wd = sp.reduce((a, s) => a + s.wd, 0) / sp.length, h = sp.reduce((a, s) => a + s.h, 0) / sp.length;
  let c = 1 - lerp(wd, 30, 0, 120, 0.35) - lerp(h, 0.15, 0, 0.5, 0.3) - lerp(dayIdx, 1, 0, 6, 0.35);
  return Math.max(0, Math.min(1, +c.toFixed(2)));
}

// IPMA (Portugal's met office) reports wind direction as a compass class.
const IPMA_DIR = [null, 0, 45, 90, 135, 180, 225, 270, 315, 0];

// Sunrise and sunset for day i of a forecast response. Asking for several
// models makes Open-Meteo name each daily series per model (sunrise_best_match,
// …); they agree to the minute, so any one will do.
function sunOf(w, i = 0) {
  const d = w && w.daily;
  if (!d) return null;
  const pick = (name) => d[name] || d[Object.keys(d).find((k) => k.startsWith(name + '_'))];
  const r = pick('sunrise'), s = pick('sunset');
  return r && s && r[i] && s[i] ? { rise: r[i].slice(11, 16), set: s[i].slice(11, 16) } : null;
}

// Open-Meteo answers with an object for one location, an array for several.
const asList = (r) => (Array.isArray(r) ? r : [r]);
const row = (hourly, i) => Object.fromEntries(Object.keys(hourly).map((k) => [k, hourly[k][i]]));
// Period is the PEAK period (what surf forecasts quote), which runs
// 10–40% longer than the mean period; models without a peak figure fall
// back to mean × 1.25.
const toK = (m, w) => {
  const h = m.swell_wave_height ?? m.wave_height;
  if (h == null || w.wind_speed_10m == null) return null;
  const p = m.swell_wave_peak_period ?? (m.swell_wave_period != null ? +(m.swell_wave_period * 1.25).toFixed(1) : m.wave_period);
  return {
    h, p, d: m.swell_wave_direction ?? m.wave_direction, wwh: m.wind_wave_height, th: m.wave_height,
    // Secondary swell period is a mean period; a single swell's peak runs ~10% longer.
    h2: m.secondary_swell_wave_height, p2: m.secondary_swell_wave_period != null ? +(m.secondary_swell_wave_period * 1.1).toFixed(1) : null, d2: m.secondary_swell_wave_direction,
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

