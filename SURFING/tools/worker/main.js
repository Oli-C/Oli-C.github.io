/* ---------- Entry points ----------
   fetch      the routes in accounts.js, feedback.js, forecast.js and
              history.js, plus /health, all behind the rate limits below
   scheduled  the hourly Cron Trigger: rebuild the forecast, then add the
              hour's measurements (and every 6 h the buoys and the wave
              models' forecasts) to the history database

   Rate limits, per IP, checked before any route runs:
     read   GETs (forecast, health)                  120 a minute
     write  POSTs that change things (sessions…)      20 a minute
     auth   sign-up, sign-in, recovery                 10 a minute
     admin  anything carrying the export key           10 a minute
   Each class uses a Cloudflare rate-limiting binding when one is bound
   (RL_READ, RL_WRITE, RL_AUTH, RL_ADMIN — counted across Cloudflare's
   edge), else a counter in this isolate. The routes add daily allowances
   on top (accounts.js, feedback.js). POSTs from a browser on another site
   are refused outright. */

const LIMITS = { read: [120, 60], write: [20, 60], auth: [10, 60], admin: [10, 60] };   // requests per seconds
const hits = new Map();   // `${class}:${ip}` → { n, until }, this isolate only
async function guard(env, cls, ip) {
  const b = env[`RL_${cls.toUpperCase()}`];
  if (b && typeof b.limit === 'function') {
    try { return (await b.limit({ key: ip })).success; } catch {}
  }
  const [limit, secs] = LIMITS[cls], now = Date.now(), k = `${cls}:${ip}`, h = hits.get(k);
  if (!h || h.until < now) {
    if (hits.size > 10000) hits.clear();
    hits.set(k, { n: 1, until: now + secs * 1000 });
    return true;
  }
  return ++h.n <= limit;
}
function classOf(req, url) {
  if (url.searchParams.has('key') || req.headers.has('X-Surf-Key')) return 'admin';
  if (req.method !== 'POST') return 'read';
  return /^\/a\/(signup|login|recover)$/.test(url.pathname) ? 'auth' : 'write';
}
// Where the pages live; a browser POST from anywhere else is refused.
const SITE_ORIGIN = /^https:\/\/(www\.)?allfield\.online$|^https:\/\/oli-c\.github\.io$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin');
    const cors = {
      'Access-Control-Allow-Origin': origin && SITE_ORIGIN.test(origin) ? origin : '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Surf-Key',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (body, status = 200, extra) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', ...extra } });
    if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'GET or POST' }, 405);
    if (req.method === 'POST' && origin && !SITE_ORIGIN.test(origin)) return json({ error: 'not from this site' }, 403);

    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    if (!(await guard(env, classOf(req, url), ip))) return json({ error: 'slow down' }, 429, { 'Retry-After': '60' });

    if (req.method === 'GET' && url.pathname === '/health') {
      const exportKey = await readSecret(env.EXPORT_KEY);
      let forecast = 'not built yet';
      try { const f = JSON.parse((await env.FEEDBACK.get('fc:latest')) || 'null'); if (f) forecast = `built ${f.built} (${Object.keys(f.spots).length} spots, ${f.ms} ms)`; } catch {}
      const limits = Object.keys(LIMITS).map((c) => `${c} ${env[`RL_${c.toUpperCase()}`] ? 'edge' : 'local'}`).join(', ');
      return json({ ok: true, build: WORKER_BUILD, kv: !!env.FEEDBACK, db: !!env.DB, exportKey: exportKey ? `set, ${exportKey.length} characters` : 'missing', forecast, limits });
    }
    // The IP is only ever kept as this keyed hash.
    const ipTag = await senderTag(ip, await readSecret(env.EXPORT_KEY));
    return (await handleForecast(req, env, url, json))
      || (await handleSkill(req, env, url, json))
      || (await handleHistory(req, env, url, json))
      || (await handleAccounts(req, env, url, json, ipTag))
      || (await handleFeedback(req, env, url, json, ipTag))
      || json({ routes: ['GET /forecast', 'GET /forecast/day?d=', 'GET /health', 'POST /a/signup', 'POST /a/login', 'POST /a/recover', 'POST /a/password', 'POST /a/logout', 'GET /a/me', 'POST /s', 'GET /skill/waves?days=', 'GET /obs?src=&since=', 'GET /history/status', 'GET /history/spot?id=&from=&to=', 'GET /history/spot/hours?id=&date=', 'GET /skill', 'POST /skill', 'POST /ibi'] }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildForecast(env).catch((e) => console.log('forecast', e.message)).then(() => archiveHistory(env)));
  },
};
