/* ---------- Accounts ----------
   Part of the surf worker (see main.js; tools/build-worker.mjs bundles it).

   Logging a session needs an account: a name and a password. Signing up or
   in gives the device a token (kept in its localStorage), sent as
   "Authorization: Bearer …" with every session, so each report belongs to
   a known person and a misbehaving one can be shut off.

   Forgotten passwords: sign-up shows a one-time recovery code to keep;
   with it, the person sets a new password (and gets a new code). Without
   it they ask Oli, who opens /a/admin/reset?key=…&name=… and passes them
   the fresh code that returns.

   Stored in KV (FEEDBACK), all private:
     un:<name, folded>  → the account id (names are unique, any case)
     u:<id>             → { id, name, pw, rc, created, tv, banned, sessions, devices, favs }
     tk:<sha-256 of token> → { uid, tv, dev, t }   lives 400 days
     lf:<id>            → failed sign-ins this hour
   Passwords are PBKDF2-SHA-256 (100,000 rounds, the most Workers allow)
   with a per-account salt; the recovery code and the tokens are stored
   only as SHA-256 hashes. Changing or resetting the password bumps `tv`,
   which signs the account out everywhere.

   Favourite spots (GET / POST /a/favs): the person's own list of spot ids,
   in their order, which leads the 16-day page on every device they sign
   in on. Up to 40, known spots only. */
const FAVS_MAX = 40;

// A suggested spot, tidied; or what's wrong with it.
function cleanSuggestion(b) {
  const text = (v, max) => (typeof v === 'string' ? v.normalize('NFC').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
  const spot = text(b.spot, 60), where = text(b.where, 80), cam = text(b.cam, 300), note = text(b.note, 500);
  if (spot.length < 2) return 'give the spot a name';
  if (cam && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(cam)) return 'the cam link should start http:// or https://';
  return { spot, where, cam, note };
}

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

const PW_ROUNDS = 100000;
async function hashPw(pw, salt) {
  const k = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: PW_ROUNDS }, k, 256));
}
async function makePw(pw) { const salt = randomHex(16); return { salt, hash: await hashPw(pw, salt) }; }
async function checkPw(pw, rec) {
  const h = await hashPw(pw, rec.salt);
  let diff = h.length ^ rec.hash.length;
  for (let i = 0; i < h.length && i < rec.hash.length; i++) diff |= h.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

// Recovery code: 16 characters in four groups, no look-alikes (0/O, 1/I/L).
const RC_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
function makeCode() {
  const b = crypto.getRandomValues(new Uint8Array(16));
  const s = [...b].map((x) => RC_ABC[x % RC_ABC.length]).join('');
  return s.match(/.{4}/g).join('-');
}
const foldCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Account names: 2–30 letters (any alphabet), digits, spaces and . ' - _;
// unique ignoring case and repeated spaces.
const ACCT_NAME = /^[\p{L}\p{M}\p{N} .'’_-]{2,30}$/u;
const tidyName = (n) => (typeof n === 'string' ? n.normalize('NFC').replace(/\s+/g, ' ').trim() : '');
const foldName = (n) => tidyName(n).toLowerCase();
const PW_OK = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 200;

async function userByName(env, name) {
  const id = name && await env.FEEDBACK.get(`un:${foldName(name)}`);
  return id ? JSON.parse((await env.FEEDBACK.get(`u:${id}`)) || 'null') : null;
}
const saveUser = (env, u) => env.FEEDBACK.put(`u:${u.id}`, JSON.stringify(u));

// A new token for this device, remembered against the account.
async function issueToken(env, u, dev) {
  const token = randomHex(32);
  await env.FEEDBACK.put(`tk:${await sha256(token)}`, JSON.stringify({ uid: u.id, tv: u.tv, dev: dev ? dev.id : null, t: new Date().toISOString() }), { expirationTtl: 400 * 86400 });
  if (dev) {
    u.devices = [{ ...dev, seen: new Date().toISOString() }, ...(u.devices || []).filter((d) => d.id !== dev.id)].slice(0, 10);
    await saveUser(env, u);
  }
  return token;
}

// Who's calling: the account behind the Bearer token, or null.
async function account(env, req) {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.get('Authorization') || '');
  if (!m) return null;
  const tk = JSON.parse((await env.FEEDBACK.get(`tk:${await sha256(m[1])}`)) || 'null');
  if (!tk) return null;
  const u = JSON.parse((await env.FEEDBACK.get(`u:${tk.uid}`)) || 'null');
  return u && !u.banned && u.tv === tk.tv ? u : null;
}

// Wrong passwords or codes: 10 an hour per account, then it waits.
const FAIL_MAX = 10;
async function failed(env, u) {
  const n = parseInt((await env.FEEDBACK.get(`lf:${u.id}`)) || '0', 10) + 1;
  await env.FEEDBACK.put(`lf:${u.id}`, String(n), { expirationTtl: 3600 });
}
const locked = async (env, u) => parseInt((await env.FEEDBACK.get(`lf:${u.id}`)) || '0', 10) >= FAIL_MAX;
const LOCKED = 'too many wrong tries; wait an hour, or ask Oli to reset it';

// Routes under /a/. Returns a Response, or null when the path isn't one.
async function handleAccounts(req, env, url, json, ipTag) {
  if (!url.pathname.startsWith('/a/')) return null;
  const path = url.pathname.slice(3);

  // Oli's own: reset a password (hands back a new recovery code to pass
  // on), or shut an account off / back on. Need the export key.
  if (req.method === 'GET' && path.startsWith('admin/')) {
    if (!(await isAdmin(req, env))) return json({ error: 'no' }, 403);
    const u = await userByName(env, url.searchParams.get('name'));
    if (!u) return json({ error: 'no such account' }, 404);
    if (path === 'admin/reset') {
      const recovery = makeCode();
      u.rc = await sha256(foldCode(recovery));
      u.tv++;
      await saveUser(env, u);
      await env.FEEDBACK.delete(`lf:${u.id}`);
      return json({ ok: true, name: u.name, recovery, note: 'Give them this code; they use "Forgot password" to set a new one. They are signed out everywhere.' });
    }
    if (path === 'admin/ban') {
      u.banned = url.searchParams.get('on') !== '0';
      await saveUser(env, u);
      return json({ ok: true, name: u.name, banned: u.banned });
    }
    return json({ error: 'admin/reset or admin/ban' }, 404);
  }

  if (req.method === 'GET' && path === 'favs') {
    const u = await account(env, req);
    return u ? json({ favs: u.favs || [] }) : json({ error: 'signed out' }, 401);
  }
  // The person's own suggested spots, newest first (the account page).
  if (req.method === 'GET' && path === 'suggest') {
    const u = await account(env, req);
    if (!u) return json({ error: 'signed out' }, 401);
    const mine = (await listReports(env.FEEDBACK, 'sg:', '')).filter((e) => e.uid === u.id)
      .map(({ t, spot, where, cam, note }) => ({ t, spot, where, cam, note })).sort((a, b) => (a.t < b.t ? 1 : -1));
    return json({ suggestions: mine });
  }
  if (req.method === 'GET' && path === 'me') {
    const u = await account(env, req);
    return u ? json({ name: u.name, created: u.created, sessions: u.sessions || 0 }) : json({ error: 'signed out' }, 401);
  }

  if (req.method !== 'POST') return null;
  if ((req.headers.get('Content-Length') | 0) > 2000) return json({ error: 'too big' }, 413);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
  if (!b || typeof b !== 'object') return json({ error: 'bad json' }, 400);
  const dev = cleanDev(b.dev);
  if (dev === undefined) return json({ error: 'bad device' }, 400);

  if (path === 'signup') {
    if (b.hp) return json({ error: 'bad sign-up' }, 400);
    if (!num(b.dt, 2000, 86400000)) return json({ error: 'too quick' }, 400);
    const name = tidyName(b.name);
    if (!ACCT_NAME.test(name)) return json({ error: 'names are 2–30 letters, numbers, spaces and . \' - _' }, 400);
    if (!PW_OK(b.password)) return json({ error: 'passwords need at least 8 characters' }, 400);
    if (await env.FEEDBACK.get(`un:${foldName(name)}`)) return json({ error: 'that name is taken; try another, or sign in' }, 409);
    if (!(await allow(env.FEEDBACK, 'su', ipTag, 3)) || !(await allow(env.FEEDBACK, 'su', 'all', 50))) return json({ error: 'too many new accounts today; try tomorrow' }, 429);
    const recovery = makeCode();
    const u = { id: randomHex(8), name, pw: await makePw(b.password), rc: await sha256(foldCode(recovery)), created: new Date().toISOString(), tv: 1, banned: false, sessions: 0, devices: [] };
    await env.FEEDBACK.put(`un:${foldName(name)}`, u.id);
    await saveUser(env, u);
    return json({ ok: true, name, token: await issueToken(env, u, dev), recovery });
  }

  if (path === 'login' || path === 'recover') {
    const u = await userByName(env, b.name);
    if (!u) return json({ error: path === 'login' ? 'wrong name or password' : 'wrong name or recovery code' }, 401);
    if (u.banned) return json({ error: 'this account is switched off; ask Oli' }, 403);
    if (await locked(env, u)) return json({ error: LOCKED }, 429);
    if (path === 'login') {
      if (typeof b.password !== 'string' || !(await checkPw(b.password, u.pw))) { await failed(env, u); return json({ error: 'wrong name or password' }, 401); }
      return json({ ok: true, name: u.name, token: await issueToken(env, u, dev) });
    }
    if (!u.rc || (await sha256(foldCode(b.code))) !== u.rc) { await failed(env, u); return json({ error: 'wrong name or recovery code' }, 401); }
    if (!PW_OK(b.password)) return json({ error: 'passwords need at least 8 characters' }, 400);
    const recovery = makeCode();
    u.pw = await makePw(b.password);
    u.rc = await sha256(foldCode(recovery));
    u.tv++;
    await env.FEEDBACK.delete(`lf:${u.id}`);
    await saveUser(env, u);
    return json({ ok: true, name: u.name, token: await issueToken(env, u, dev), recovery });
  }

  const u = await account(env, req);
  if (!u) return json({ error: 'signed out' }, 401);
  if (path === 'favs') {
    if (!Array.isArray(b.favs) || b.favs.length > FAVS_MAX) return json({ error: `a list of up to ${FAVS_MAX} spots` }, 400);
    const known = new Set(CAMS.map((c) => c.id));
    u.favs = [...new Set(b.favs.filter((id) => typeof id === 'string' && known.has(id)))];
    await saveUser(env, u);
    return json({ ok: true, favs: u.favs });
  }
  // A spot to add: its name, where it is, a cam if there is one, a note.
  // Private (only Oli sees them, at GET /suggestions); 5 a day an account.
  if (path === 'suggest') {
    const s = cleanSuggestion(b);
    if (typeof s === 'string') return json({ error: s }, 400);
    if (!(await allow(env.FEEDBACK, 'sg', u.id, 5)) || !(await allow(env.FEEDBACK, 'sg', 'all', 100))) return json({ error: 'too many today' }, 429);
    await env.FEEDBACK.put(`sg:${stamp()}`, JSON.stringify({ t: new Date().toISOString(), uid: u.id, name: u.name, ...s }));
    return json({ ok: true });
  }
  if (path === 'logout') {
    await env.FEEDBACK.delete(`tk:${await sha256((req.headers.get('Authorization') || '').slice(7))}`);
    return json({ ok: true });
  }
  if (path === 'password') {
    if (await locked(env, u)) return json({ error: LOCKED }, 429);
    if (typeof b.old !== 'string' || !(await checkPw(b.old, u.pw))) { await failed(env, u); return json({ error: 'that’s not your current password' }, 401); }
    if (!PW_OK(b.password)) return json({ error: 'passwords need at least 8 characters' }, 400);
    u.pw = await makePw(b.password);
    u.tv++;
    await saveUser(env, u);
    return json({ ok: true, name: u.name, token: await issueToken(env, u, dev) });
  }
  return null;
}

// Every account, for /people (private, needs the key).
async function listAccounts(kv) {
  const out = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: 'u:', cursor });
    for (const k of page.keys) { const u = JSON.parse((await kv.get(k.name)) || 'null'); if (u) out.push(u); }
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  return out;
}
