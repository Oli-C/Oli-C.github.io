/* Cloudflare Worker: pooled feedback for the surf cams. Free tier is plenty.

   Two kinds of report, both anonymous:
     verdict   "was the score right?" while watching a cam (too high / about
               right / too low), with the conditions at that moment
     session   "I surfed here": when, for how long, how it was (Flat … Epic),
               the wave size seen, how clean the surface was (Glassy …
               Blown out), the wave shape (Peeling / Mixed / Closing out)
               and what held it back, with the forecast for those hours.
               These train the scores (tools/skill.mjs).

   Set-up (once, ~5 minutes):
     1. Cloudflare dashboard → Workers & Pages → Create → Worker, paste this file.
     2. Settings → Bindings → add a KV namespace binding named FEEDBACK.
     3. Add EXPORT_KEY (any long random string), as a worker secret or a
        Secrets Store binding — both work.
     4. Deploy; copy the worker URL into FEEDBACK_URL in SURFING/index.html.
     5. In the GitHub repo → Settings → Secrets → Actions, add
          FEEDBACK_URL  = the worker URL
          FEEDBACK_KEY  = the same EXPORT_KEY
        so tools/skill.mjs can export the pool into the repo.

   Routes:
     POST /v            one verdict (JSON, see index.html logFeedback)
     POST /s            one session (JSON, see index.html submitSession)
     GET  /stats        public per-spot counts
     GET  /export?key=  everything (needs EXPORT_KEY); ?since=ISO for new ones only
     GET  /health       is the KV bound, is EXPORT_KEY set (its length, never
                        the value) — for checking the set-up

   Keeping the input honest: everything is checked here whatever the page
   did. Unknown fields are dropped; every number must be finite and in a
   physical range; a session must have started in the last ~3 days and not
   in the future, last 30 min – 3 h, and carry 1–4 forecast hours inside
   that window. A hidden honeypot field must be empty and the form must
   have been open a few seconds. Per sender (a keyed hash of the IP — the
   IP itself is never stored): 30 verdicts and 10 sessions a day, and one
   session per spot per start hour. The training step then weighs each
   sender's reports down the more of them there are, and sets aside
   reports wildly out of line with the forecast.

   If /export says {"error":"no"} with the right key, /health shows why:
   EXPORT_KEY missing means it was added as a *build* variable, on another
   worker, or not deployed yet (the dashboard holds changes until Deploy).
*/

// EXPORT_KEY can be a plain worker secret (a string) or a binding from
// Cloudflare's Secrets Store (an object whose get() returns the value).
// Pasted values often pick up a trailing space or newline; ignore them.
async function readSecret(b) {
  if (typeof b === 'string') return b.trim();
  if (b && typeof b.get === 'function') {
    try { return String(await b.get()).trim(); } catch { return ''; }
  }
  return '';
}

// A forecast hour as the page blends it. Physical ranges; anything else goes.
const K_RANGES = {
  h: [0, 20], p: [0, 30], d: [0, 360], ws: [0, 200], wd: [0, 360], wg: [0, 250], day: [0, 1],
  tn: [0, 1], wwh: [0, 15], th: [0, 25], h2: [0, 15], p2: [0, 30], d2: [0, 360],
  sst: [-2, 35], air: [-25, 50], tide: [-6, 6], conf: [0, 1],
};
function cleanK(k) {
  if (!k || typeof k !== 'object') return null;
  const o = {};
  for (const [f, [lo, hi]] of Object.entries(K_RANGES)) {
    const v = k[f];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) return null;
    o[f] = v;
  }
  if (k.tdir === 'rising' || k.tdir === 'falling') o.tdir = k.tdir;
  return o.h == null || o.ws == null ? null : o;
}
const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const SPOT_ID = /^[a-z0-9-]{2,40}$/;
const HOUR_T = /^\d{4}-\d\d-\d\dT\d\d:\d\d$/;            // the forecast's local hour stamp
const WHY = ['wind', 'small', 'big', 'tide', 'closeouts', 'inconsistent', 'crowd'];
const MINS = [30, 60, 90, 120, 180];

// Check a session; returns the cleaned record or an error string.
function cleanSession(s, now) {
  if (!s || typeof s !== 'object') return 'bad json';
  if (s.hp) return 'bad session';                                    // honeypot filled: a bot
  if (!num(s.dt, 3000, 86400000)) return 'too quick';                 // form open under 3 s
  if (typeof s.id !== 'string' || !SPOT_ID.test(s.id)) return 'bad spot';
  const start = Date.parse(s.start);
  if (!Number.isFinite(start)) return 'bad time';
  if (start > now + 10 * 60000) return 'that time is in the future';
  if (start < now - 74 * 3600000) return 'only the last 3 days can be logged';
  if (!MINS.includes(s.mins)) return 'bad length';
  if (!int(s.rating, 0, 4)) return 'bad rating';
  if (!int(s.size, 0, 5)) return 'bad size';
  if (s.surface != null && !int(s.surface, 0, 4)) return 'bad surface';   // Glassy … Blown out
  if (s.shape != null && !int(s.shape, 0, 2)) return 'bad shape';         // Peeling, Mixed, Closing out
  const why = Array.isArray(s.why) ? [...new Set(s.why.filter((w) => WHY.includes(w)))] : [];
  if (Array.isArray(s.why) && s.why.length > WHY.length) return 'bad reasons';
  if (!Array.isArray(s.hours) || s.hours.length < 1 || s.hours.length > 4) return 'bad conditions';
  if (typeof s.local !== 'string' || !HOUR_T.test(s.local)) return 'bad local time';
  const hours = [];
  for (const x of s.hours) {
    if (!x || typeof x.t !== 'string' || !HOUR_T.test(x.t)) return 'bad conditions';
    // Each forecast hour must sit inside the session (local times compare as text).
    if (x.t.slice(0, 13) < s.local.slice(0, 13) || x.t > addMinutes(s.local, s.mins)) return 'conditions outside the session';
    const k = cleanK(x.k);
    if (!k) return 'bad conditions';
    hours.push({ t: x.t, k });
  }
  if (s.model != null && !num(s.model, 0, 10)) return 'bad model score';
  return {
    id: s.id, start: new Date(start).toISOString(), local: s.local, mins: s.mins,
    rating: s.rating, size: s.size, surface: s.surface == null ? null : s.surface, shape: s.shape == null ? null : s.shape, why, hours,
    model: s.model == null ? null : s.model, ver: int(s.ver, 0, 1000) ? s.ver : 0,
  };
}
// "2026-10-28T08:30" + 90 min → "2026-10-28T10:00" (no time zone involved).
function addMinutes(local, mins) {
  const d = new Date(local + ':00Z');
  return new Date(d.getTime() + mins * 60000).toISOString().slice(0, 16);
}
// A sender's stable, anonymous tag: HMAC of the IP with the export key.
async function senderTag(ip, key) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(key || 'surf'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(ip)));
  return [...sig.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Count against a per-sender daily allowance; false once it's used up.
async function allow(kv, name, who, limit) {
  const key = `rl:${name}:${new Date().toISOString().slice(0, 10)}:${who}`;
  const used = parseInt((await kv.get(key)) || '0', 10);
  if (used >= limit) return false;
  await kv.put(key, String(used + 1), { expirationTtl: 90000 });
  return true;
}
const stamp = () => `${new Date().toISOString()}:${Math.random().toString(36).slice(2, 8)}`;

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
      return json({ ok: true, kv: !!env.FEEDBACK, exportKey: exportKey ? `set, ${exportKey.length} characters` : 'missing' });
    }

    if (req.method === 'POST' && (url.pathname === '/v' || url.pathname === '/s')) {
      if ((req.headers.get('Content-Length') | 0) > 20000) return json({ error: 'too big' }, 413);
      let body;
      try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
      const who = await senderTag(req.headers.get('CF-Connecting-IP') || 'x', await readSecret(env.EXPORT_KEY));

      if (url.pathname === '/v') {
        const v = body;
        const ok = v && typeof v.id === 'string' && SPOT_ID.test(v.id) && ['high', 'ok', 'low'].includes(v.verdict) && num(v.total, 0, 10);
        const k = ok && cleanK(v.k);
        if (!ok || !k) return json({ error: 'bad verdict' }, 400);
        if (!(await allow(env.FEEDBACK, 'v', who, 30))) return json({ error: 'too many today' }, 429);
        const f = {};
        if (v.f && typeof v.f === 'object') for (const [name, val] of Object.entries(v.f)) if (typeof name === 'string' && name.length < 20 && num(val, 0, 10)) f[name] = val;
        const t = new Date().toISOString();
        await env.FEEDBACK.put(`v:${stamp()}`, JSON.stringify({ t, who, id: v.id, total: v.total, verdict: v.verdict, f, k }));
        return json({ ok: true });
      }

      const s = cleanSession(body, Date.now());
      if (typeof s === 'string') return json({ error: s }, 400);
      const dupe = `sd:${who}:${s.id}:${s.local.slice(0, 13)}`;
      if (await env.FEEDBACK.get(dupe)) return json({ error: 'already logged that session' }, 409);
      if (!(await allow(env.FEEDBACK, 's', who, 10))) return json({ error: 'too many today' }, 429);
      await env.FEEDBACK.put(dupe, '1', { expirationTtl: 4 * 86400 });
      await env.FEEDBACK.put(`s:${stamp()}`, JSON.stringify({ t: new Date().toISOString(), who, ...s }));
      return json({ ok: true });
    }

    if (req.method === 'GET' && (url.pathname === '/export' || url.pathname === '/stats')) {
      const isExport = url.pathname === '/export';
      if (isExport) {
        const exportKey = await readSecret(env.EXPORT_KEY);
        if (!exportKey || (url.searchParams.get('key') || '').trim() !== exportKey) return json({ error: 'no' }, 403);
      }
      const since = url.searchParams.get('since') || '';
      const verdicts = [], sessions = [], stats = {};
      for (const prefix of ['v:', 's:']) {
        let cursor;
        do {
          const page = await env.FEEDBACK.list({ prefix, cursor });
          for (const k of page.keys) {
            const t = k.name.slice(2, 26);
            if (t <= since) continue;
            const raw = await env.FEEDBACK.get(k.name);
            if (!raw) continue;
            const e = JSON.parse(raw);
            const st = stats[e.id] = stats[e.id] || { n: 0, high: 0, ok: 0, low: 0, sessions: 0 };
            if (prefix === 'v:') { st.n++; st[e.verdict]++; if (isExport) verdicts.push(e); }
            else { st.sessions++; if (isExport) sessions.push(e); }
          }
          cursor = page.list_complete ? null : page.cursor;
        } while (cursor);
      }
      return json(isExport ? { count: verdicts.length, verdicts, sessions } : { stats });
    }

    return json({ routes: ['POST /v', 'POST /s', 'GET /stats', 'GET /export?key=', 'GET /health'] }, 404);
  },
};
