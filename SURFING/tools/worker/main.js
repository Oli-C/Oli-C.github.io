/* ---------- Entry points ----------
   fetch      the routes in feedback.js and forecast.js, plus /health
   scheduled  the hourly Cron Trigger: rebuild the forecast */

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

    if (req.method === 'GET' && url.pathname === '/health') {
      const exportKey = await readSecret(env.EXPORT_KEY);
      let forecast = 'not built yet';
      try { const f = JSON.parse((await env.FEEDBACK.get('fc:latest')) || 'null'); if (f) forecast = `built ${f.built} (${Object.keys(f.spots).length} spots, ${f.ms} ms)`; } catch {}
      return json({ ok: true, build: WORKER_BUILD, kv: !!env.FEEDBACK, exportKey: exportKey ? `set, ${exportKey.length} characters` : 'missing', forecast });
    }
    return (await handleForecast(req, env, url, json))
      || (await handleFeedback(req, env, url, json))
      || json({ routes: ['POST /v', 'POST /s', 'GET /stats', 'GET /forecast', 'GET /forecast/day?d=', 'GET /health', 'GET /export?key=', 'GET /people?key=', 'GET /forecast/refresh?key='] }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(buildForecast(env));
  },
};
