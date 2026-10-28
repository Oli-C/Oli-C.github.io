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
import { loadSite } from './site.mjs';

const UA = 'allfield-surfcams/1.0 (oclarke@routeware.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { CAMS } = loadSite(['spots.js']);

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

// --- 1. coastline segments within 12 km (Overpass, with mirrors + retries) ---
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'];
async function coastline(c) {
  const q = `[out:json][timeout:60];way(around:12000,${c.lat},${c.lng})["natural"="coastline"];out geom;`;
  let j = null, err = null;
  for (let attempt = 0; attempt < 6 && !j; attempt++) {
    try { j = await getJson(OVERPASS[attempt % OVERPASS.length], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) }); }
    catch (e) { err = e; await sleep(4000 + attempt * 3000); }
  }
  if (!j) throw err;
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

// --- 2+3. shore normal and depth profile from EMODnet bathymetry ---
// Sample depth along five candidate bearings (facing ±30°); the one that
// deepens fastest out to 4 km is the true seaward normal of the contours.
async function depthAt(lat, lng) {
  try {
    const j = await getJson(`https://rest.emodnet-bathymetry.eu/depth_sample?geom=POINT(${lng.toFixed(5)}%20${lat.toFixed(5)})`);
    return j.avg == null ? null : +(-j.avg).toFixed(1);
  } catch { return null; }
}
const PROFILE_KM = [0.3, 0.6, 1, 1.5, 2.5, 4];
async function slopeNormal(c) {
  let best = null;
  for (const off of [-30, -15, 0, 15, 30]) {
    const bearing = (c.faces + off + 360) % 360, prof = [];
    for (const km of PROFILE_KM) {
      const [la, lo] = dest(c.lat, c.lng, bearing, km * 1000);
      prof.push({ km, depth: await depthAt(la, lo) });
      await sleep(220);
    }
    const far = prof.filter((p) => p.km >= 1.5 && p.depth != null);
    if (!far.length) continue;
    const score = far.reduce((a, p) => a + p.depth, 0) / far.length;   // mean depth 1.5–4 km out
    if (!best || score > best.score) best = { normal: bearing, score, prof };
  }
  return best;
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
  await sleep(2500);
  const sl = await slopeNormal(c);
  const useNormal = sl ? sl.normal : c.faces;
  const prof = sl ? sl.prof : [];
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
    await sleep(3000);
  }
  // Keep any spots a previous run managed if this run failed for them.
  try {
    const old = loadSite(['geo.js']).GEO;
    for (const [id, g] of Object.entries(old || {})) if (!GEO[id] && g && g.resp) GEO[id] = g;
  } catch {}
  const out = `/* Generated by tools/exposure.mjs on ${new Date().toISOString().slice(0, 10)} from OSM coastline,
   GEBCO (OpenTopoData) and EMODnet bathymetry. Per spot: the fitted shore
   normal, depth 1 km out, and the arrival factor for deep-water swell FROM
   each direction (every 15°) at 8 / 11 / 14 s. Regenerate rather than edit. */
const GEO = ${JSON.stringify(GEO)};
`;
  fs.writeFileSync(new URL('../geo.js', import.meta.url), out);
  console.log('wrote SURFING/geo.js for', Object.keys(GEO).length, 'spots');
})();
