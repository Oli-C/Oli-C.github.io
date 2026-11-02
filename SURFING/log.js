/* Log a session (log.html): where you surfed (the area, then the beach,
   cams or not), when, and how it was; then your sessions so far.

   Each one is saved with the forecast for those hours (the worker's
   blended build, else the same blend done here from Open-Meteo, which
   keeps the last 3 days) and sent to the worker (POST /s), which checks it
   again; tools/skill.mjs fits the scores to them (see "Learning from logged
   sessions" in score.js).

   Keeping it honest: only times that have happened, in daylight, within
   the last 3 days; one report per spot and start hour on this device; a
   hidden honeypot field; and answers far from the forecast (overhead when
   it said knee-high, Epic when we had it flat) need a second tap. The
   worker and the training step check again. */
const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
units = store.get('surf-units') === 'ft' ? 'ft' : 'm';

// The forecast fields saved with a session: what the score and training use.
const K_KEEP = ['h', 'p', 'd', 'ws', 'wd', 'wg', 'day', 'tn', 'tdir', 'wwh', 'wwp', 'wwd', 'th', 'h2', 'p2', 'd2', 'tide', 'conf'];
const snapK = (k) => Object.fromEntries(K_KEEP.filter((f) => k[f] != null).map((f) => [f, typeof k[f] === 'number' ? +k[f].toFixed(3) : k[f]]));

const SESS_KEY = 'surf-sessions', SESS_VER = 1, LAST_KEY = 'surf-log-spot';
const SESS_MINS = [[30, '30 min'], [60, '1 h'], [90, '1½ h'], [120, '2 h'], [180, '3 h']];
const loadSess = () => { try { return JSON.parse(store.get(SESS_KEY) || '[]') || []; } catch { return []; } };
const saveSess = (list) => store.set(SESS_KEY, JSON.stringify(list.slice(-300)));

/* ---------- The forecast for the last 3 days and today ---------- */
const pastCache = {};
async function pastConditions(c) {
  if (pastCache[c.id]) return pastCache[c.id];
  try {
    const r = await fetch(SURF_WORKER.replace(/\/$/, '') + '/forecast');
    const fc = r.ok ? await r.json() : null, s = fc && fc.v === 1 && Date.now() - Date.parse(fc.built) < 3 * 3600e3 && fc.spots[c.id];
    if (s) {
      const today = spotNow(s.offset).slice(0, 10), byDate = {}, sun = {};
      for (const d of s.days) if (d.date <= today) { byDate[d.date] = d.hours.map((k) => ({ ...k })); if (d.sun) sun[d.date] = d.sun; }
      return (pastCache[c.id] = { byDate, sun, offset: s.offset });
    }
  } catch {}
  await loadSharedSkill();
  const [lat, lng] = offshore(c);
  const q = `latitude=${lat}&longitude=${lng}&past_days=2&forecast_days=1&timezone=auto`;
  const [m, w] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&hourly=${MARINE.join()}&models=${modelIds(MARINE_MODELS)}`).then((r) => r.json()),
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&hourly=${WIND.join()}&models=${modelIds(WIND_MODELS)}&daily=sunrise,sunset`).then((r) => r.json()),
  ]);
  if (m.error || w.error || !m.hourly || !w.hourly) throw new Error(m.reason || w.reason || 'no forecast');
  const f = blendSpot(c, m, w), byDate = {}, sun = {};
  for (const d of f.days) { byDate[d.date] = d.hours; if (d.sun) sun[d.date] = d.sun; }
  return (pastCache[c.id] = { byDate, sun, offset: f.offset });
}
const spotNow = (offset) => new Date(Date.now() + offset * 1000).toISOString().slice(0, 16);   // spot-local "YYYY-MM-DDTHH:MM"
const addMins = (local, mins) => new Date(Date.parse(local + ':00Z') + mins * 60000).toISOString().slice(0, 16);
const hm = (local) => local.slice(11, 16);
// Half-hour start times on a day, from just before sunrise to sunset, never later than now.
function sessSlots(data, date) {
  const s = data.sun[date], now = spotNow(data.offset);
  if (!s || !s.rise) return [];
  const out = [];
  let t = addMins(`${date}T${s.rise.slice(0, 2)}:${s.rise.slice(3) < '30' ? '00' : '30'}`, -30);
  const last = `${date}T${s.set}`;
  while (t <= last && t <= now) { out.push(t); t = addMins(t, 30); }
  return out;
}
// The forecast hours a session covers (an hour counts if the session is in the water during it).
const sessHours = (data, local, mins) => (data.byDate[local.slice(0, 10)] || []).filter((k) => k.t.slice(0, 13) >= local.slice(0, 13) && k.t < addMins(local, mins));

/* ---------- The form ---------- */
let sess = null;   // { id, area, day, slot, mins, rating, size, surface, shape, why, opened, data, msg, warn, busy, done }
function startSpot() {
  const want = new URLSearchParams(location.search).get('spot');
  return byId(want) || byId(store.get(LAST_KEY)) || byId(Account.favs.list()[0]) || byId('caparica-cds') || CAMS[0];
}
// A new beach keeps the answers given so far.
async function pick(c, keep) {
  sess = { id: c.id, area: c.area, day: null, slot: null, mins: 90, rating: null, size: null, surface: null, shape: null, why: new Set(), opened: Date.now(), data: null, msg: '', warn: '', busy: true, done: false, ...(keep || {}) };
  sess.id = c.id; sess.area = c.area;
  history.replaceState(null, '', `?spot=${c.id}`);
  render();
  try {
    const data = await pastConditions(c);
    if (!sess || sess.id !== c.id) return;
    sess.data = data;
    const days = Object.keys(data.byDate).sort().filter((d) => sessSlots(data, d).length);
    if (!days.includes(sess.day)) sess.day = days[days.length - 1] || null;
    const slots = sess.day ? sessSlots(data, sess.day) : [];
    if (!slots.includes(sess.slot)) sess.slot = slots.length ? slots[Math.max(0, slots.length - 3)] : null;
  } catch { sess.msg = 'Couldn’t load the forecast for those days. Try again in a moment.'; }
  sess.busy = false;
  render();
}

function render() {
  const el = $('form'), c = byId(sess.id);
  const beaches = CAMS.filter((o) => o.area === sess.area);
  const where = `<div class="sess-q">Where</div>
    <div class="sess-opts">
      <label class="sess-sel"><span class="sr-only">Area</span><select data-sarea>${AREAS.map((a) => `<option${a === sess.area ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select></label>
      <label class="sess-sel"><span class="sr-only">Beach</span><select data-sbeach>${sess.area !== c.area ? '<option value="" selected disabled>Pick the beach…</option>' : ''}${beaches.map((o) => `<option value="${esc(o.id)}"${o.id === c.id ? ' selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
    </div>`;
  if (sess.done) { el.innerHTML = `<p class="sess-ok">${sess.msg}</p><p><button class="fb-btn" type="button" data-again>Log another</button></p>`; return; }
  if (sess.busy || !sess.data) { el.innerHTML = where + `<p class="fb-note">${esc(sess.msg) || 'Loading the forecast for the last few days…'}</p>`; return; }
  const d = sess.data, today = spotNow(d.offset).slice(0, 10);
  const days = Object.keys(d.byDate).sort().filter((x) => sessSlots(d, x).length);
  const dayLabel = (x) => { const diff = Math.round((Date.parse(today) - Date.parse(x)) / 864e5); return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : DAY_NAMES[new Date(x + 'T12:00Z').getUTCDay()]; };
  const slots = sess.day ? sessSlots(d, sess.day) : [];
  const opt = (attr, val, label, on, cls = '') => `<button class="fb-btn ${cls}${on ? ' sel' : ''}" type="button" ${attr}="${val}" aria-pressed="${on}">${label}</button>`;
  // What the forecast said for the chosen hours, and what we scored it.
  const hrs = sess.slot ? sessHours(d, sess.slot, sess.mins) : [];
  let then = '';
  if (hrs.length) {
    const k = hrs[Math.floor((hrs.length - 1) / 2)], r = score(c, k);
    const scores = hrs.map((x) => score(c, x)).filter(Boolean).map((x) => x.total);
    const model = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length * 2) / 2 : null;
    const fr = faceRange(c, k);
    then = `<div class="sess-then"><span class="k">Forecast then</span> ${esc(SIZE_BANDS[sizeBand((fr[0] + fr[1]) / 2)])} (${rng(fr[0], fr[1])}) · ${Math.round(k.p)} s ${k.d != null ? dirName(k.d) : ''} · ${kts(k.ws)} kts ${esc(windRel(c, k))}${r && r.surface ? `, <b>${esc(r.surface.label.toLowerCase())}</b>` : ''}${k.tn != null ? ` · ${tideWord(k.tn)} tide${k.tdir ? ' ' + k.tdir : ''}` : ''}${model != null && r ? ` · we scored it <b>${fmt(model)}</b>` : ''}</div>`;
  }
  const end = sess.slot ? addMins(sess.slot, sess.mins) : '';
  const me = Account.get();
  el.innerHTML = where + `
    <div class="sess-q">When</div>
    <div class="sess-opts">${days.map((x) => opt('data-sday', x, dayLabel(x), x === sess.day)).join('')}</div>
    <div class="sess-opts">
      <label class="sess-sel"><span class="sr-only">Start time</span><select data-sslot>${slots.map((s) => `<option value="${s}"${s === sess.slot ? ' selected' : ''}>${hm(s)}</option>`).join('')}</select></label>
      ${SESS_MINS.map(([m, l]) => opt('data-smins', m, l, m === sess.mins)).join('')}
    </div>
    ${sess.slot ? `<div class="fb-note">${hm(sess.slot)}–${hm(end)}</div>` : ''}
    ${then}
    <div class="sess-q">How was it?</div>
    <div class="sess-opts">${SESSION_RATINGS.map((l, i) => opt('data-srate', i, l, sess.rating === i, `lvl-${i}`)).join('')}</div>
    <div class="sess-q">Wave size <small>faces, on the sets</small></div>
    <div class="sess-opts">${SIZE_BANDS.map((l, i) => opt('data-ssize', i, l, sess.size === i)).join('')}</div>
    <div class="sess-q">Surface <small>how clean was the water?</small></div>
    <div class="sess-opts">${SURFACES.map((l, i) => opt('data-ssurf', i, l, sess.surface === i, `surf-${i}`)).join('')}</div>
    <div class="sess-q">Wave shape <small>optional</small></div>
    <div class="sess-opts">${SESSION_SHAPE.map((l, i) => opt('data-sshape', i, l, sess.shape === i)).join('')}</div>
    <div class="sess-q">What held it back? <small>optional</small></div>
    <div class="sess-opts">${Object.entries(SESSION_WHY).map(([k, l]) => opt('data-swhy', k, l, sess.why.has(k))).join('')}</div>
    <input class="hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
    ${sess.warn ? `<p class="sess-warn">${sess.warn}</p>` : ''}
    ${sess.msg ? `<p class="sess-err">${esc(sess.msg)}</p>` : ''}
    <div class="sess-go">
      <button class="pop-btn" type="button" data-ssend${sess.busy ? ' disabled' : ''}>${sess.warn ? 'Yes, log it' : 'Log session'}</button>
      <span class="fb-note">${me ? `Saved with the forecast for those hours, as ${esc(me.name)}.` : 'Sign in above to log it.'}</span>
    </div>`;
}

// Checks before sending; returns an error, or sets a warning that needs
// a second tap when the answers sit far from the forecast.
function checkSess(c) {
  if (!sess.slot) return 'Pick when you surfed.';
  if (loadSess().some((e) => e.id === c.id && e.local.slice(0, 13) === sess.slot.slice(0, 13))) return 'You’ve already logged a session starting then.';
  if (sess.rating == null) return 'Say how it was.';
  if (sess.size == null) return 'Pick the wave size you saw.';
  if (sess.surface == null) return 'Say how clean the surface was.';
  const d = sess.data, now = spotNow(d.offset);
  if (sess.slot > now) return 'That time hasn’t happened yet.';
  const s = d.sun[sess.slot.slice(0, 10)];
  if (s && addMins(sess.slot, sess.mins) > addMins(`${sess.slot.slice(0, 10)}T${s.set}`, 45)) return 'That runs on past dark; shorten it or start earlier.';
  if (!sessHours(d, sess.slot, sess.mins).length) return 'No forecast for that time.';
  return '';
}
function plausibility(c) {
  const hrs = sessHours(sess.data, sess.slot, sess.mins);
  const faces = hrs.map((k) => faceRange(c, k)), mid = faces.reduce((a, f) => a + (f[0] + f[1]) / 2, 0) / faces.length;
  const scores = hrs.map((k) => score(c, k)).filter(Boolean).map((r) => r.total);
  const model = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const bits = [];
  if (Math.abs(sizeBand(mid) - sess.size) >= 2) bits.push(`the forecast had about <b>${esc(SIZE_BANDS[sizeBand(mid)].toLowerCase())}</b> then, and you saw <b>${esc(SIZE_BANDS[sess.size].toLowerCase())}</b>`);
  if (model != null && Math.abs(SESSION_TARGET[sess.rating] - model) >= 6) bits.push(`we scored it <b>${fmt(Math.round(model * 2) / 2)}</b> and you say <b>${SESSION_RATINGS[sess.rating]}</b>`);
  const midK = hrs[Math.floor((hrs.length - 1) / 2)], ms = midK && score(c, midK);
  if (ms && ms.surface && Math.abs(ms.surface.i - sess.surface) >= 3) bits.push(`the wind then should have made it <b>${esc(ms.surface.label.toLowerCase())}</b>, and you found it <b>${esc(SURFACES[sess.surface].toLowerCase())}</b>`);
  return { warn: bits.length ? `Just checking: ${bits.join('; ')}. That happens (banks, a sheltered corner, a bad forecast), and it’s exactly what helps, but please make sure the beach and time are right.` : '', model, hrs };
}

async function submit() {
  const c = byId(sess.id);
  if (!Account.get()) { sess.msg = 'Sign in first (above); your answers stay here.'; Account.open('in', { note: 'Sign in to log a session. Every report then belongs to someone, which keeps them honest.' }); return render(); }
  const err = checkSess(c);
  if (err) { sess.msg = err; return render(); }
  const p = plausibility(c);
  if (p.warn && !sess.warn) { sess.warn = p.warn; sess.msg = ''; return render(); }
  const hp = $('form').querySelector('.hp');
  const payload = {
    id: c.id, local: sess.slot, start: new Date(Date.parse(sess.slot + ':00Z') - sess.data.offset * 1000).toISOString(),
    mins: sess.mins, rating: sess.rating, size: sess.size, surface: sess.surface, shape: sess.shape, why: [...sess.why],
    hours: p.hrs.slice(0, 4).map((k) => ({ t: k.t, k: snapK(k) })),
    model: p.model == null ? null : +p.model.toFixed(2), ver: SESS_VER,
    hp: hp ? hp.value : '', dt: Date.now() - sess.opened, dev: Account.device(),
  };
  sess.busy = true; sess.msg = ''; render();
  const res = await sendSession(payload);
  sess.busy = false;
  if (res.refused) { sess.msg = res.why; return render(); }
  // Sent, already there, or kept here to retry: either way it's logged.
  const list = loadSess();
  list.push({ id: c.id, local: payload.local, mins: payload.mins, rating: payload.rating, size: payload.size, model: payload.model, sent: res.ok, payload: res.ok ? undefined : payload });
  saveSess(list);
  store.set(LAST_KEY, c.id);
  const what = `${esc(c.name)}: ${esc(SESSION_RATINGS[payload.rating])}, ${esc(SIZE_BANDS[payload.size].toLowerCase())}, ${hm(payload.local)} for ${SESS_MINS.find((m) => m[0] === payload.mins)[1]}`;
  sess.done = true;
  sess.msg = res.ok ? `Logged ${what}. Thanks. It counts from the next update (every 3 hours).`
    : res.signedOut ? `Saved on this device: ${what}. ${esc(res.why)}`
    : `Saved on this device: ${what}. ${esc(res.why)} It’ll send itself next time you open the page.`;
  render();
  if (res.ok) loadMine();
}
// POST one session. refused = the server checked it and said no (don't
// keep it); not ok otherwise means try again later; signedOut = no working
// sign-in here (kept, and sent after signing in).
async function sendSession(payload) {
  const me = Account.get();
  if (!me) return { ok: false, signedOut: true, why: 'Sign in and it’ll send.' };
  try {
    const r = await fetch(Account.api('/s'), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + me.token }, body: JSON.stringify(payload) });
    const j = await r.json().catch(() => ({}));
    if (r.ok || r.status === 409) return { ok: true };   // 409: it already has this one
    if (r.status === 401) { Account.set(null); return { ok: false, signedOut: true, why: 'You were signed out; sign in again and it’ll send.' }; }
    const msg = j.error ? j.error.charAt(0).toUpperCase() + j.error.slice(1) + '.' : `The server said no (${r.status}).`;
    if (r.status === 400 || r.status === 403 || r.status === 413) return { refused: true, why: msg };
    return { ok: false, why: r.status === 429 ? 'That’s the most for today.' : 'The server couldn’t take it just now.' };
  } catch { return { ok: false, why: 'Couldn’t reach the server.' }; }
}
// Sessions kept on this device (offline, or the server busy) go when the
// page next opens, while they're still within the 3-day window.
async function resendSessions() {
  if (!Account.get()) return;
  const list = loadSess();
  let changed = false;
  for (const e of list) {
    if (e.sent || !e.payload) continue;
    if (Date.now() - Date.parse(e.payload.start) > 70 * 3600000) { delete e.payload; changed = true; continue; }
    const r = await sendSession(e.payload);
    if (r.signedOut) break;
    if (r.ok || r.refused) { e.sent = !!r.ok; delete e.payload; changed = true; }
  }
  if (changed) saveSess(list);
}

/* ---------- Your sessions ---------- */
let mine = null;   // null loading, [] none, or { error }
const lengthOf = (m) => (m < 60 ? `${m} min` : `${m / 60} h`.replace('.5 h', '½ h'));
async function loadMine() {
  if (!Account.get()) { mine = []; return renderMine(); }
  const s = await Account.call('GET', '/s/mine');
  mine = s.error ? { error: s.error } : s.sessions;
  renderMine();
}
function renderMine() {
  const el = $('mine');
  if (!Account.get()) { el.innerHTML = '<p class="none">Sign in to see the sessions you’ve logged.</p>'; return; }
  if (mine === null) { el.innerHTML = '<p class="none">Loading…</p>'; return; }
  if (mine.error) { el.innerHTML = `<p class="none">${esc(mine.error)}</p>`; return; }
  if (!mine.length) { el.innerHTML = '<p class="none">None yet.</p>'; return; }
  el.innerHTML = `<ol class="sess-list">${mine.map((s) => {
    const c = byId(s.id), d = new Date(s.local + ':00Z');
    const when = `${DAY_NAMES[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${s.local.slice(11, 16)}`;
    const bits = [lengthOf(s.mins), SIZE_BANDS[s.size], s.surface != null ? SURFACES[s.surface] : '', s.shape != null ? SESSION_SHAPE[s.shape] : '',
      s.model != null ? `forecast said ${fmt(s.model)}` : ''].filter(Boolean);
    return `<li class="lvl-${s.rating}">
      <span class="rt">${SESSION_RATINGS[s.rating]}</span>
      <a class="spot" href="insights.html?spot=${esc(s.id)}">${esc(c ? c.name : s.id)}${c ? `<small> · ${esc(c.area)}</small>` : ''}</a>
      <span class="when">${when}</span>
      <span class="what">${esc(bits.join(' · '))}</span>
    </li>`;
  }).join('')}</ol>`;
}

/* ---------- Wiring ---------- */
$('form').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b || !sess) return;
  const ds = b.dataset;
  if ('again' in ds) return pick(byId(sess.id));
  if ('ssend' in ds) return submit();
  if (ds.sday) { sess.day = ds.sday; const sl = sessSlots(sess.data, sess.day); sess.slot = sl.includes(sess.slot) ? sess.slot : sl[Math.max(0, sl.length - 3)] || null; }
  else if (ds.smins) sess.mins = +ds.smins;
  else if (ds.srate) sess.rating = +ds.srate;
  else if (ds.ssize) sess.size = +ds.ssize;
  else if (ds.ssurf) sess.surface = +ds.ssurf;
  else if (ds.sshape) sess.shape = sess.shape === +ds.sshape ? null : +ds.sshape;   // tap again to clear
  else if (ds.swhy) { if (sess.why.has(ds.swhy)) sess.why.delete(ds.swhy); else sess.why.add(ds.swhy); }
  else return;
  sess.warn = ''; sess.msg = '';
  render();
});
$('form').addEventListener('change', (e) => {
  if (!sess) return;
  if (e.target.matches('[data-sarea]')) { sess.area = e.target.value; return render(); }
  if (e.target.matches('[data-sbeach]')) {
    const to = byId(e.target.value);
    if (to && to.id !== sess.id) { const { day, slot, mins, rating, size, surface, shape, why, opened } = sess; pick(to, { day, slot, mins, rating, size, surface, shape, why, opened }); }
    return;
  }
  if (e.target.matches('[data-sslot]')) { sess.slot = e.target.value; sess.warn = ''; sess.msg = ''; render(); }
});
$('units').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-units]');
  if (!b) return;
  units = b.dataset.units === 'ft' ? 'ft' : 'm';
  for (const x of $('units').querySelectorAll('button')) x.setAttribute('aria-pressed', x.dataset.units === units);
  store.set('surf-units', units);
  if (sess) render();
});
for (const x of $('units').querySelectorAll('button')) x.setAttribute('aria-pressed', x.dataset.units === units);

Account.mount($('acct'), {
  reason: 'to log sessions.',
  onChange: (ev) => { if (ev === 'in') { resendSessions(); loadMine(); } if (ev === 'out') { mine = []; renderMine(); } if (sess) render(); },
});
if (!Account.get() && !Account.isOpen()) Account.open('in');
pick(startSpot());
renderMine();
loadMine();
setTimeout(resendSessions, 3000);
