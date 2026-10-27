#!/usr/bin/env node
/* One-off: build a directional arrival table for every spot from real
   geometry, replacing the hand-set `exposure` floor.

   For each spot:
     1. OpenStreetMap coastline within 12 km (Overpass) → which deep-water
        directions are shadowed by headlands.
     2. GEBCO bathymetry grid (OpenTopoData) → the true offshore slope
        direction, i.e. the shore-normal the contours actually follow.
     3. EMODnet depth profile along that normal → nearshore steepness.
     4. Snell's law over straight, parallel contours from deep water to a
        2.5 m breaking depth → refraction coefficient Kr per direction and
        period; headland shadow applies on top (with a little diffraction,
        more for long periods).

   Output: SURFING/geo.js — `GEO[id] = { normal, depth1k, resp }` where
   resp[dir] = [k8, k11, k14] for deep-water swell FROM `dir` at 8/11/14 s.
   score.js uses it when present and falls back to `exposure` otherwise.

   Run from the repo root:  node SURFING/tools/exposure.mjs
   Takes a couple of minutes (polite pauses between requests). */
import fs from 'node:fs';

const UA = 'allfield-surfcams/1.0 (oclarke@routeware.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const src = fs.readFileSync(new URL('../spots.js', import.meta.url), 'utf8');
const CAMS = new Function(src + '; return CAMS;')();

const R = 6371000, toR = (x) => x * Math.PI / 180, toD = (x) => x * 180 / Math.PI;
// Local flat-earth metres around an origin.
const proj = (o) => (lat, lng) => ({ x: toR(lng - o.lng) * R * Math.cos(toR(o.lat)), y: toR(lat - o.lat) * R });
const dest = (lat, lng, bearing, m) => {
  const b = toR(bearing), d = m / R, la1 = toR(lat), lo1 = toR(lng);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [toD(la2), toD(lo2)];
};
const angleDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

async function getJson(url, init) {
  const r = await fetch(url, { ...init, headers: { 'User-Agent': UA, ...(init && init.headers) } });
  if (!r.ok) throw new Error(`${r.status} ${url.slice(0, 80)}`);
  return r.json();
}

// --- 1. coastline segments within 12 km ---
async function coastline(c) {
  const q = `[out:json][timeout:60];way(around:12000,${c.lat},${c.lng})["natural"="coastline"];out geom;`;
  const j = await getJson('https://overpass-api.de/api/interpreter', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
  const P = proj(c), segs = [];
  for (const w of j.elements || []) {
    if (!w.geometry) continue;
    for (let i = 1; i < w.geometry.length; i++) segs.push([P(w.geometry[i - 1].lat, w.geometry[i - 1].lon), P(w.geometry[i].lat, w.geometry[i].lon)]);
  }
  return segs;
}
// Does the segment from a to b cross segment [p, q]?
function cross(a, b, p, q) {
  const d = (b.x - a.x) * (q.y - p.y) - (b.y - a.y) * (q.x - p.x);
  if (Math.abs(d) < 1e-9) return false;
  const t = ((p.x - a.x) * (q.y - p.y) - (p.y - a.y) * (q.x - p.x)) / d;
  const u = ((p.x - a.x) * (b.y - a.y) - (p.y - a.y) * (b.x - a.x)) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}
// Shadow factor for swell FROM `dir`: trace seaward along `dir` from 400 m
// to 12 km; land across the ray means the direction is blocked.
function shadow(segs, dir) {
  const a = { x: 400 * Math.sin(toR(dir)), y: 400 * Math.cos(toR(dir)) };
  const b = { x: 12000 * Math.sin(toR(dir)), y: 12000 * Math.cos(toR(dir)) };
  let blockedAt = null;
  for (const [p, q] of segs) if (cross(a, b, p, q)) {
    const dx = (p.x + q.x) / 2, dy = (p.y + q.y) / 2, s = Math.hypot(dx, dy);
    if (blockedAt == null || s < blockedAt) blockedAt = s;
  }
  return blockedAt;   // metres to the blocking land, or null
}

// --- 2. offshore slope direction from GEBCO ---
async function slopeNormal(c) {
  const pts = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) pts.push(dest(c.lat, c.lng, 0, i * 600).map((v, k) => k === 0 ? v : v) && dest(...dest(c.lat, c.lng, 0, i * 600), 90, j * 600));
  // centre the grid ~2 km out along the nominal facing so it sits on the shelf
  const centre = dest(c.lat, c.lng, c.faces, 2000);
  const grid = [];
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) grid.push(dest(...dest(centre[0], centre[1], 0, i * 600), 90, j * 600));
  const j = await getJson('https://api.opentopodata.org/v1/gebco2020?locations=' + grid.map((p) => p.join(',')).join('|'));
  const P = proj({ lat: centre[0], lng: centre[1] });
  // least squares plane z = a x + b y + c over sea cells
  let sxx = 0, sxy = 0, syy = 0, sxz = 0, syz = 0, sx = 0, sy = 0, sz = 0, n = 0;
  j.results.forEach((r, i) => {
    if (r.elevation == null || r.elevation > 0) return;
    const p = P(grid[i][0], grid[i][1]), z = r.elevation;
    sxx += p.x * p.x; sxy += p.x * p.y; syy += p.y * p.y; sxz += p.x * z; syz += p.y * z; sx += p.x; sy += p.y; sz += z; n++;
  });
  if (n < 10) return null;
  // solve normal equations (3x3) via Cramer's rule
  const A = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]], B = [sxz, syz, sz];
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A); if (Math.abs(D) < 1e-9) return null;
  const col = (k) => A.map((row, i) => row.map((v, jx) => (jx === k ? B[i] : v)));
  const a = det(col(0)) / D, b = det(col(1)) / D;   // dz/dx, dz/dy (depth gets more negative seaward)
  // downslope (deeper) direction = -(gradient of elevation)
  const bearing = (toD(Math.atan2(-a, -b)) + 360) % 360;
  return { normal: Math.round(bearing), n };
}

// --- 3. EMODnet depth profile along the normal ---
async function profile(c, normal) {
  const out = [];
  for (const km of [0.25, 0.5, 1, 1.5, 2, 3, 4, 6]) {
    const [la, lo] = dest(c.lat, c.lng, normal, km * 1000);
    try {
      const j = await getJson(`https://rest.emodnet-bathymetry.eu/depth_sample?geom=POINT(${lo.toFixed(5)}%20${la.toFixed(5)})`);
      out.push({ km, depth: j.avg == null ? null : +(-j.avg).toFixed(1) });
    } catch { out.push({ km, depth: null }); }
    await sleep(250);
  }
  return out;
}

// --- 4. Snell's law refraction coefficient, deep water → breaking depth ---
const g = 9.81;
function wavenumber(T, h) {           // dispersion: ω² = g k tanh(k h)
  const w = 2 * Math.PI / T; let k = w * w / g;
  for (let i = 0; i < 40; i++) k = w * w / (g * Math.tanh(k * h));
  return k;
}
function Kr(theta0deg, T, hb = 2.5) {
  const th0 = toR(theta0deg);
  const C0 = g * T / (2 * Math.PI), k = wavenumber(T, hb), Cb = (2 * Math.PI / T) / k;
  const s = Math.sin(th0) * Cb / C0;
  if (s >= 1) return 0;
  const thb = Math.asin(s);
  return Math.sqrt(Math.cos(th0) / Math.cos(thb));
}

const PERIODS = [8, 11, 14];
async function build(c) {
  const segs = await coastline(c);
  await sleep(1500);
  const sl = await slopeNormal(c);
  await sleep(1000);
  const normal = sl ? sl.normal : c.faces;
  // Sanity: the fitted normal shouldn't swing more than 60° from the hand-set facing.
  const useNormal = angleDiff(normal, c.faces) <= 60 ? normal : c.faces;
  const prof = await profile(c, useNormal);
  const depth1k = (prof.find((p) => p.km === 1) || {}).depth;
  const resp = {};
  for (let dir = 0; dir < 360; dir += 15) {
    const th0 = angleDiff(dir, useNormal);
    const blocked = shadow(segs, dir);
    resp[dir] = PERIODS.map((T) => {
      let k = th0 >= 85 ? 0.05 : Kr(th0, T);
      if (blocked != null) k *= T >= 12 ? 0.4 : 0.3;        // diffraction round a headland
      else if (th0 > 60) k *= T >= 12 ? 1.1 : 1;             // long swell wraps a bit better
      return +Math.min(1.05, k).toFixed(2);
    });
  }
  return { normal: useNormal, fitted: sl ? sl.normal : null, faces: c.faces, depth1k, prof, coastSegs: segs.length, resp };
}

(async () => {
  const GEO = {};
  for (const c of CAMS) {
    process.stdout.write(`${c.id.padEnd(20)} `);
    try {
      const g = await build(c);
      GEO[c.id] = { normal: g.normal, depth1k: g.depth1k, resp: g.resp };
      const open = Object.entries(g.resp).filter(([, v]) => v[1] >= 0.8).map(([d]) => d);
      console.log(`normal ${g.normal}° (fitted ${g.fitted}, faces ${g.faces}) depth@1km ${g.depth1k} m, coast segs ${g.coastSegs}, open dirs ${open[0]}–${open[open.length - 1]} (${open.length})`);
    } catch (e) { console.log('FAILED', e.message); }
    await sleep(1500);
  }
  const out = `/* Generated by tools/exposure.mjs on ${new Date().toISOString().slice(0, 10)} from OSM coastline,
   GEBCO (OpenTopoData) and EMODnet bathymetry. Per spot: the fitted shore
   normal, depth 1 km out, and the arrival factor for deep-water swell FROM
   each direction (every 15°) at 8 / 11 / 14 s. Regenerate rather than edit. */
const GEO = ${JSON.stringify(GEO)};
`;
  fs.writeFileSync(new URL('../geo.js', import.meta.url), out);
  console.log('wrote SURFING/geo.js for', Object.keys(GEO).length, 'spots');
})();
