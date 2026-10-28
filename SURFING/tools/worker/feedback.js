/* ---------- Feedback: verdicts and logged sessions ----------
   Part of the surf worker (see main.js; tools/build-worker.mjs bundles it).

   Two kinds of report:
     verdict   "was the score right?" (too high / about right / too low).
               Retired: POST /v now answers 410. The ones already sent are
               still exported and keep calibrating the scores.
     session   "I surfed here": when, for how long, how it was (Flat … Epic),
               the wave size seen, how clean the surface was (Glassy …
               Blown out), the wave shape (Peeling / Mixed / Closing out)
               and what held it back, with the forecast for those hours.
               These train the scores (tools/skill.mjs).

   Who sent it: a session needs a signed-in account (accounts.js), whose
   id and name go with it, plus the device (a random id made on the device,
   with its kind, system and browser). All kept here, privately: the export
   needs the key, and tools/skill.mjs drops names and devices before
   anything reaches the public repo, keeping only a keyed hash of the
   account id.

   Keeping the input honest: everything is checked here whatever the page
   did. Unknown fields are dropped; every number must be finite and in a
   physical range; a session must have started in the last ~3 days and not
   in the future, last 30 min – 3 h, and carry 1–4 forecast hours inside
   that window. A hidden honeypot field must be empty and the form must
   have been open a few seconds. Per account 10 sessions a day and one per
   spot per start hour; per sender (a keyed hash of the IP — the IP itself
   is never stored) 20 a day; 300 a day from everyone together. main.js
   also rate-limits every request per IP before it gets here. The training step then weighs each
   device's reports down the more of them there are, and sets aside
   reports wildly out of line with the forecast. */

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

// Is this request Oli's own (scripts, admin links)? The export key, sent as
// an X-Surf-Key header by the scheduled jobs; a ?key= in the address still
// works for links opened by hand (/a/admin/reset, /forecast/refresh), but
// stays out of anything automated, so it doesn't land in logs.
async function isAdmin(req, env) {
  const key = await readSecret(env.EXPORT_KEY);
  const given = (req.headers.get('X-Surf-Key') || new URL(req.url).searchParams.get('key') || '').trim();
  return !!key && given.length === key.length && given === key;
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

// The name someone gave: letters (any alphabet), digits, spaces and a few
// marks, 1–40 characters; anything else is refused rather than cleaned up.
function cleanName(n) {
  if (n == null || n === '') return null;
  if (typeof n !== 'string') return undefined;
  const s = n.normalize('NFC').replace(/\s+/g, ' ').trim();
  return s.length >= 1 && s.length <= 40 && /^[\p{L}\p{M}\p{N} .'’_-]+$/u.test(s) ? s : undefined;
}
// The device: its random id plus coarse kind / system / browser words.
const DEV_KIND = ['phone', 'tablet', 'desktop'];
const DEV_OS = ['iOS', 'iPadOS', 'Android', 'macOS', 'Windows', 'Linux', 'ChromeOS', 'other'];
const DEV_BROWSER = ['Safari', 'Chrome', 'Firefox', 'Edge', 'Samsung', 'Opera', 'other'];
function cleanDev(d) {
  if (d == null) return null;
  if (typeof d !== 'object' || typeof d.id !== 'string' || !/^[a-f0-9-]{16,40}$/.test(d.id)) return undefined;
  return {
    id: d.id,
    kind: DEV_KIND.includes(d.kind) ? d.kind : 'other',
    os: DEV_OS.includes(d.os) ? d.os : 'other',
    browser: DEV_BROWSER.includes(d.browser) ? d.browser : 'other',
  };
}

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
  const name = cleanName(s.name), dev = cleanDev(s.dev);
  if (name === undefined) return 'that name has characters we can’t take';
  if (dev === undefined) return 'bad device';
  return {
    id: s.id, start: new Date(start).toISOString(), local: s.local, mins: s.mins,
    rating: s.rating, size: s.size, surface: s.surface == null ? null : s.surface, shape: s.shape == null ? null : s.shape, why, hours,
    model: s.model == null ? null : s.model, ver: int(s.ver, 0, 1000) ? s.ver : 0, name, dev,
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

// Every stored report of one kind (v: verdicts, s: sessions), newer than `since`.
async function listReports(kv, prefix, since) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    for (const k of page.keys) {
      if (k.name.slice(2, 26) <= since) continue;
      const raw = await kv.get(k.name);
      if (raw) out.push(JSON.parse(raw));
    }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}

// Routes: POST /v (retired), POST /s, GET /s/mine, GET /stats?key=, GET /export?key=,
// GET /people?key=. Returns a Response, or null when the path isn't one.
async function handleFeedback(req, env, url, json, ipTag) {
  if (req.method === 'POST' && url.pathname === '/v') return json({ error: 'retired; log a session instead' }, 410);
  if (req.method === 'POST' && url.pathname === '/s') {
    if ((req.headers.get('Content-Length') | 0) > 20000) return json({ error: 'too big' }, 413);
    const me = await account(env, req);
    if (!me) return json({ error: 'sign in to log sessions' }, 401);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    const s = cleanSession(body, Date.now());
    if (typeof s === 'string') return json({ error: s }, 400);
    const dupe = `sd:${me.id}:${s.id}:${s.local.slice(0, 13)}`;
    if (await env.FEEDBACK.get(dupe)) return json({ error: 'already logged that session' }, 409);
    if (!(await allow(env.FEEDBACK, 's', me.id, 10)) || !(await allow(env.FEEDBACK, 'si', ipTag, 20)) || !(await allow(env.FEEDBACK, 's', 'all', 300))) return json({ error: 'too many today' }, 429);
    await env.FEEDBACK.put(dupe, '1', { expirationTtl: 4 * 86400 });
    await env.FEEDBACK.put(`s:${stamp()}`, JSON.stringify({ t: new Date().toISOString(), who: ipTag, ...s, uid: me.id, name: me.name }));
    me.sessions = (me.sessions || 0) + 1;
    await saveUser(env, me);
    return json({ ok: true, sessions: me.sessions });
  }

  if (req.method !== 'GET') return null;
  // The signed-in person's own sessions, newest first (the account page).
  if (url.pathname === '/s/mine') {
    const me = await account(env, req);
    if (!me) return json({ error: 'signed out' }, 401);
    const mine = (await listReports(env.FEEDBACK, 's:', '')).filter((e) => e.uid === me.id)
      .map(({ id, local, mins, rating, size, surface, shape, why, model }) => ({ id, local, mins, rating, size, surface, shape, why, model }))
      .sort((a, b) => (a.local < b.local ? 1 : -1)).slice(0, 200);
    return json({ sessions: mine });
  }
  if (url.pathname === '/export' || url.pathname === '/people' || url.pathname === '/stats') {
    if (!(await isAdmin(req, env))) return json({ error: 'no' }, 403);
  }
  if (url.pathname === '/export') {
    const since = url.searchParams.get('since') || '';
    const verdicts = await listReports(env.FEEDBACK, 'v:', since), sessions = await listReports(env.FEEDBACK, 's:', since);
    return json({ count: verdicts.length, verdicts, sessions });
  }
  if (url.pathname === '/stats') {
    const stats = {};
    for (const e of await listReports(env.FEEDBACK, 'v:', '')) { const s = stats[e.id] = stats[e.id] || { n: 0, high: 0, ok: 0, low: 0, sessions: 0 }; s.n++; s[e.verdict]++; }
    for (const e of await listReports(env.FEEDBACK, 's:', '')) { const s = stats[e.id] = stats[e.id] || { n: 0, high: 0, ok: 0, low: 0, sessions: 0 }; s.sessions++; }
    return json({ stats });
  }
  if (url.pathname === '/people') {
    // Private: who's been reporting — accounts, then reports by account
    // (older ones by device). Needs the key.
    const people = {};
    for (const u of await listAccounts(env.FEEDBACK)) {
      people[u.id] = { name: u.name, account: true, created: u.created, banned: !!u.banned, devices: (u.devices || []).map((d) => `${d.kind} · ${d.os} · ${d.browser}`),
        device: '', verdicts: 0, sessions: 0, spots: {}, first: u.created, last: u.created };
    }
    for (const [kind, prefix] of [['verdicts', 'v:'], ['sessions', 's:']]) {
      for (const e of await listReports(env.FEEDBACK, prefix, '')) {
        const id = e.uid || (e.dev && e.dev.id) || `ip:${e.who}`;
        const p = people[id] = people[id] || { name: null, device: e.dev ? `${e.dev.kind} · ${e.dev.os} · ${e.dev.browser}` : 'unknown', verdicts: 0, sessions: 0, spots: {}, first: e.t, last: e.t };
        if (e.name) p.name = e.name;
        p[kind]++; p.spots[e.id] = (p.spots[e.id] || 0) + 1;
        if (e.t < p.first) p.first = e.t;
        if (e.t > p.last) p.last = e.t;
      }
    }
    return json({ people: Object.values(people).sort((a, b) => b.last.localeCompare(a.last)) });
  }
  return null;
}
