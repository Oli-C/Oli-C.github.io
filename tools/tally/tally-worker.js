/* allfield-tally: the site's own page counter (Cloudflare worker + D1).

   POST /t       a page view, a link click or a play, sent by tally.js as a
                 beacon: { k: 'view' | 'click' | 'play', p: path, l: label,
                 r: referring host, w: window width }. Only from the site's
                 own pages; bots skipped.
   GET  /stats   totals over ?days= (1–400), for stats.html; needs the key
                 (X-Tally-Key).
   GET  /health  { ok, build }.

   Nothing that identifies anyone is kept: no IP address, no cookies. A
   visitor is a hash of the day, the IP, the browser and the key, so the
   same person counts once a day and can't be followed from one day to the
   next. Rows older than 400 days are dropped.

   Bindings: DB (D1 allfield-stats, table hit), KEY (secret). Deployed by
   .github/workflows/tally-worker.yml (code only; bindings stay). */
const BUILD = '2026-10-31a';
const SITES = /^https:\/\/(www\.)?allfield\.online$/;
const BOTS = /bot|crawl|spider|slurp|headless|lighthouse|preview|facebookexternalhit|embedly|monitor|curl|wget|python|node-fetch/i;
const KINDS = new Set(['view', 'click', 'play']);

const clip = (s, n) => (typeof s === 'string' ? s.slice(0, n) : '');

async function visitorOf(req, env, day) {
  const raw = `${day}|${req.headers.get('CF-Connecting-IP') || ''}|${req.headers.get('User-Agent') || ''}|${env.KEY || ''}`;
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)));
  return [...h.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function deviceOf(ua, w) {
  if (/iPad|Tablet/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(ua) || (w && w < 700)) return 'phone';
  return 'desktop';
}

async function record(req, env) {
  const origin = req.headers.get('Origin') || '';
  const ua = req.headers.get('User-Agent') || '';
  if (!SITES.test(origin) || BOTS.test(ua)) return new Response(null, { status: 204 });
  if ((req.headers.get('Content-Length') | 0) > 2000) return new Response(null, { status: 413 });
  let b;
  try { b = JSON.parse(await req.text()); } catch { return new Response(null, { status: 400 }); }
  if (!b || !KINDS.has(b.k) || typeof b.p !== 'string' || b.p[0] !== '/') return new Response(null, { status: 400 });
  const now = new Date().toISOString(), day = now.slice(0, 10);
  const ref = clip(b.r, 80).toLowerCase().replace(/^www\./, '');
  await env.DB.prepare('INSERT INTO hit (t, kind, page, label, ref, dev, country, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(now.slice(0, 16), b.k, clip(b.p, 120), clip(typeof b.l === 'string' ? b.l.replace(/\s+/g, ' ').trim() : '', 80) || null, ref && !/allfield\.online$/.test(ref) ? ref : null,
      deviceOf(ua, +b.w || 0), (req.cf && req.cf.country) || null, await visitorOf(req, env, day))
    .run();
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': origin } });
}

async function stats(req, env, url) {
  if (!env.KEY || req.headers.get('X-Tally-Key') !== env.KEY) return json({ error: 'no' }, 403);
  const days = Math.min(400, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  await env.DB.prepare('DELETE FROM hit WHERE t < ?').bind(new Date(Date.now() - 400 * 864e5).toISOString().slice(0, 10)).run();
  const all = (sql) => env.DB.prepare(sql).bind(since).all().then((r) => r.results);
  const [daily, pages, clicks, refs, countries, devices, totals] = await Promise.all([
    all("SELECT substr(t, 1, 10) AS day, count(*) AS views, count(DISTINCT visitor) AS visitors FROM hit WHERE kind = 'view' AND t >= ? GROUP BY day ORDER BY day"),
    all("SELECT page, count(*) AS views, count(DISTINCT visitor) AS visitors FROM hit WHERE kind = 'view' AND t >= ? GROUP BY page ORDER BY views DESC LIMIT 40"),
    all("SELECT page, kind, label, count(*) AS n, count(DISTINCT visitor) AS visitors FROM hit WHERE kind != 'view' AND t >= ? GROUP BY page, kind, label ORDER BY n DESC LIMIT 60"),
    all("SELECT ref, count(*) AS views FROM hit WHERE kind = 'view' AND ref IS NOT NULL AND t >= ? GROUP BY ref ORDER BY views DESC LIMIT 30"),
    all("SELECT country, count(DISTINCT visitor) AS visitors FROM hit WHERE kind = 'view' AND t >= ? GROUP BY country ORDER BY visitors DESC LIMIT 30"),
    all("SELECT dev, count(DISTINCT visitor) AS visitors FROM hit WHERE kind = 'view' AND t >= ? GROUP BY dev ORDER BY visitors DESC"),
    all("SELECT count(*) AS views, count(DISTINCT visitor || substr(t, 1, 10)) AS visits FROM hit WHERE kind = 'view' AND t >= ?"),
  ]);
  return json({ days, since, totals: totals[0], daily, pages, clicks, refs, countries, devices });
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } });
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') {
      return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'X-Tally-Key, Content-Type', 'Access-Control-Max-Age': '86400' } });
    }
    try {
      if (req.method === 'POST' && url.pathname === '/t') return await record(req, env);
      if (req.method === 'GET' && url.pathname === '/stats') return await stats(req, env, url);
      if (url.pathname === '/health') return json({ ok: true, build: BUILD });
      return json({ error: 'not found' }, 404);
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};
