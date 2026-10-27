/* Cloudflare Worker: pooled "was the score right?" verdicts for the surf
   cams. Free tier is plenty (a few hundred verdicts a day at most).

   Set-up (once, ~5 minutes):
     1. Cloudflare dashboard → Workers & Pages → Create → Worker, paste this file.
     2. Settings → Bindings → add a KV namespace binding named FEEDBACK.
     3. Settings → Variables → add a secret EXPORT_KEY (any long random string).
     4. Deploy; copy the worker URL into FEEDBACK_URL in SURFING/index.html.
     5. In the GitHub repo → Settings → Secrets → Actions, add
          FEEDBACK_URL  = the worker URL
          FEEDBACK_KEY  = the same EXPORT_KEY
        so tools/skill.mjs can export the pool into data/feedback.json.

   Routes:
     POST /v            one verdict (JSON, see index.html logFeedback) — anonymous,
                        30 per IP per day, stored under a time-ordered key
     GET  /stats        public per-spot counts
     GET  /export?key=  everything (needs EXPORT_KEY); ?since=ISO for new ones only
*/
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

    if (req.method === 'POST' && url.pathname === '/v') {
      let v;
      try { v = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const ok = v && typeof v.id === 'string' && v.id.length < 40 && ['high', 'ok', 'low'].includes(v.verdict)
        && typeof v.total === 'number' && v.k && typeof v.k.h === 'number';
      if (!ok) return json({ error: 'bad verdict' }, 400);
      // Light rate limit per IP per day (the IP itself isn't stored with the verdict).
      const ip = req.headers.get('CF-Connecting-IP') || 'x';
      const day = new Date().toISOString().slice(0, 10);
      const rlKey = `rl:${day}:${ip}`;
      const used = parseInt((await env.FEEDBACK.get(rlKey)) || '0', 10);
      if (used >= 30) return json({ error: 'too many today' }, 429);
      await env.FEEDBACK.put(rlKey, String(used + 1), { expirationTtl: 90000 });
      const t = new Date().toISOString();
      const entry = { t, id: v.id, total: v.total, verdict: v.verdict, f: v.f || {}, k: v.k };
      await env.FEEDBACK.put(`v:${t}:${Math.random().toString(36).slice(2, 8)}`, JSON.stringify(entry));
      return json({ ok: true });
    }

    if (req.method === 'GET' && (url.pathname === '/export' || url.pathname === '/stats')) {
      const isExport = url.pathname === '/export';
      if (isExport && url.searchParams.get('key') !== env.EXPORT_KEY) return json({ error: 'no' }, 403);
      const since = url.searchParams.get('since') || '';
      const out = [], stats = {};
      let cursor;
      do {
        const page = await env.FEEDBACK.list({ prefix: 'v:', cursor });
        for (const k of page.keys) {
          const t = k.name.slice(2, 26);
          if (t <= since) continue;
          const raw = await env.FEEDBACK.get(k.name);
          if (!raw) continue;
          const e = JSON.parse(raw);
          if (isExport) out.push(e);
          const s = stats[e.id] = stats[e.id] || { n: 0, high: 0, ok: 0, low: 0 };
          s.n++; s[e.verdict]++;
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return json(isExport ? { count: out.length, verdicts: out } : { stats });
    }

    return json({ routes: ['POST /v', 'GET /stats', 'GET /export?key='] }, 404);
  },
};
