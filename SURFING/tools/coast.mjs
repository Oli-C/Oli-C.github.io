/* The coastline the map masks with: land polygons for the area the
   wind and swell grids cover, from OpenStreetMap's coastline, written to
   SURFING/coast.js. Run by hand when the grids' area changes:

     node SURFING/tools/coast.mjs

   OSM coastline ways run with the land on their left. They're joined into
   chains, clipped to the box, and each piece is closed by walking the
   box's edge anticlockwise to the next piece (so the land stays on the
   left); islands come as rings of their own. Then simplified (~15 m) and
   stored as whole numbers of 1e-4° (~10 m), each point as the change from
   the one before. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'coast.js');
// The swell grid is 36.81–40.08 N, 10.28–8.56 W; the wind grid a touch wider.
const S = 36.75, W = -10.35, N = 40.15, E = -8.45;
const SIMPLIFY = 0.00015, Q = 1e4, MIN_AREA = 2e-6;   // degrees, 1/Q degrees, square degrees

const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://lz4.overpass-api.de/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function ways() {
  const q = `[out:json][timeout:180];way["natural"="coastline"](${S},${W},${N},${E});out geom;`;
  let err;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await fetch(OVERPASS[attempt % OVERPASS.length], {
        method: 'POST', body: 'data=' + encodeURIComponent(q),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'allfield-surf-coast/1 (allfield.online)' },
      });
      if (!r.ok) throw new Error('overpass ' + r.status);
      const j = await r.json();
      return j.elements.filter((w) => w.geometry && w.geometry.length > 1).map((w) => w.geometry.map((g) => [g.lat, g.lon]));
    } catch (e) { err = e; await sleep(5000 + attempt * 5000); }
  }
  throw err;
}

// Join ways end to start into chains (closed ones are rings).
const key = (p) => p[0].toFixed(7) + ',' + p[1].toFixed(7);
function chains(ws) {
  const byStart = new Map();
  for (const w of ws) byStart.set(key(w[0]), w);
  const used = new Set(), out = [];
  // Start from ways nothing leads into, then whatever's left (rings).
  const ends = new Set(ws.map((w) => key(w[w.length - 1])));
  const order = [...ws.filter((w) => !ends.has(key(w[0]))), ...ws];
  for (const w of order) {
    if (used.has(w)) continue;
    used.add(w);
    const c = w.slice();
    for (;;) {
      const next = byStart.get(key(c[c.length - 1]));
      if (!next || used.has(next)) break;
      used.add(next);
      c.push(...next.slice(1));
    }
    out.push(c);
  }
  return out;
}

const inside = (p) => p[0] >= S && p[0] <= N && p[1] >= W && p[1] <= E;
// Where segment a→b crosses the box's edge (Liang–Barsky): [t0, t1] inside.
function clipSeg(a, b) {
  let t0 = 0, t1 = 1;
  const dy = b[0] - a[0], dx = b[1] - a[1];
  for (const [p, q] of [[-dx, a[1] - W], [dx, E - a[1]], [-dy, a[0] - S], [dy, N - a[0]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
// A chain's runs inside the box, each from the edge in to the edge out.
function clip(c) {
  const pieces = [];
  let cur = null;
  for (let i = 1; i < c.length; i++) {
    const a = c[i - 1], b = c[i], t = clipSeg(a, b);
    if (!t) { if (cur) { pieces.push(cur); cur = null; } continue; }
    const pa = lerp(a, b, t[0]), pb = lerp(a, b, t[1]);
    if (!cur) cur = [pa];
    cur.push(pb);
    if (t[1] < 1) { pieces.push(cur); cur = null; }
  }
  if (cur) pieces.push(cur);
  return pieces;
}
// Position along the box's edge, anticlockwise from the south-west corner: 0–4.
function along(p) {
  const eps = 1e-9;
  if (Math.abs(p[0] - S) < eps) return (p[1] - W) / (E - W);
  if (Math.abs(p[1] - E) < eps) return 1 + (p[0] - S) / (N - S);
  if (Math.abs(p[0] - N) < eps) return 2 + (E - p[1]) / (E - W);
  if (Math.abs(p[1] - W) < eps) return 3 + (N - p[0]) / (N - S);
  return null;
}
const CORNERS = [[S, E], [N, E], [N, W], [S, W]];   // reached at 1, 2, 3, 4 (≡ 0)
// Close the pieces into polygons by walking the edge anticlockwise.
function close(pieces) {
  const ps = pieces.map((pts) => ({ pts, tin: along(pts[0]), tout: along(pts[pts.length - 1]), used: false }))
    .filter((p) => p.tin != null && p.tout != null);
  const polys = [];
  for (const start of ps) {
    if (start.used) continue;
    const poly = [];
    let p = start;
    for (let guard = 0; guard < ps.length + 1; guard++) {
      p.used = true;
      poly.push(...p.pts);
      // The next entry anticlockwise from here (this piece's own start counts).
      const dist = (t) => ((t - p.tout) % 4 + 4) % 4 || 4;
      const next = ps.filter((q) => !q.used || q === start).sort((x, y) => dist(x.tin) - dist(y.tin))[0];
      const d = dist(next.tin);
      for (let k = 1; k <= 4; k++) {
        const ct = Math.ceil(p.tout + 1e-12) + k - 1;
        if (ct - p.tout < d) poly.push(CORNERS[(ct - 1) % 4]);
      }
      if (next === start) break;
      p = next;
    }
    polys.push(poly);
  }
  return polys;
}

function area(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[1] * q[0] - q[1] * p[0]; } return a / 2; }
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop();
    const [ay, ax] = pts[i], [by, bx] = pts[j], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let far = -1, fd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs(dy * (pts[k][1] - ax) - dx * (pts[k][0] - ay)) / L;
      if (d > fd) { fd = d; far = k; }
    }
    if (far > 0) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return pts.filter((_, k) => keep[k]);
}
function encode(r) {
  const out = [];
  let py = 0, px = 0;
  for (const [y, x] of r) {
    const qy = Math.round(y * Q), qx = Math.round(x * Q);
    if (out.length && qy === py && qx === px) continue;
    out.push(qy - py, qx - px);
    py = qy; px = qx;
  }
  return out;
}

const ws = await ways();
const cs = chains(ws);
const rings = cs.filter((c) => key(c[0]) === key(c[c.length - 1]) && c.every(inside)).map((c) => c.slice(0, -1));
const pieces = cs.filter((c) => !rings.some((r) => r[0] === c[0])).flatMap(clip).filter((p) => p.length > 1);
const polys = [...close(pieces), ...rings].map((r) => simplify(r, SIMPLIFY))
  .filter((r) => r.length >= 3 && Math.abs(area(r)) >= MIN_AREA);
const bad = polys.filter((r) => area(r) < 0).length;
const enc = polys.map(encode);
const pts = enc.reduce((n, r) => n + r.length / 2, 0);
fs.writeFileSync(OUT, `/* Generated by tools/coast.mjs on ${new Date().toISOString().slice(0, 10)} from the OpenStreetMap
   coastline (© OpenStreetMap contributors, ODbL). Land polygons for
   ${S}–${N} N, ${-E}–${-W} W, anticlockwise, as whole numbers of 1e-4°, each
   point the change from the one before. Regenerate rather than edit. */
const COAST = { q: ${Q}, box: [${S}, ${W}, ${N}, ${E}], rings: ${JSON.stringify(enc)} };
`);
console.log(`${ws.length} ways → ${cs.length} chains (${rings.length} rings, ${pieces.length} pieces) → ${polys.length} polygons, ${pts} points${bad ? `, ${bad} clockwise (check!)` : ''}; ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
