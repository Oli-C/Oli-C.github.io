/* Feedback: the account line under the session button (account.js) and
   logged sessions ("I surfed here"), checked here and again by the worker. */

/* ---------- Feedback: sessions and accounts ---------- */

// Verdicts this device sent before they were retired (Too high / About
// right / Too low). Logged sessions replaced them; only the tune panel
// still reads these, and the server keeps calibrating from the old ones.
const FB_KEY = 'surf-feedback';
const loadFb = () => { try { return JSON.parse(localStorage.getItem(FB_KEY) || '[]') || []; } catch { return []; } };
// Sessions go to the Cloudflare worker (tools/worker/), which keeps them
// privately; the scheduled Action exports them, names and devices
// stripped, into data/sessions.json and trains the scores on them.
const FEEDBACK_URL = SURF_WORKER;   // score.js
// The conditions snapshot saved with every session: the blended forecast
// hour, every field the score and training use.
const K_KEEP = ['h', 'p', 'd', 'ws', 'wd', 'wg', 'day', 'tn', 'tdir', 'wwh', 'th', 'h2', 'p2', 'd2', 'sst', 'air', 'tide', 'conf'];
const snapK = (k) => Object.fromEntries(K_KEEP.filter((f) => k[f] != null).map((f) => [f, typeof k[f] === 'number' ? +k[f].toFixed(3) : k[f]]));

// Logging a session needs an account (account.js): the panel carries the
// account line, or the open sign-in form, under the session button.
function renderFb(c) {
  const el = $('v-fb');
  if (!scoreOf(c)) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  el.innerHTML = `
    <div class="fb-row sess-open">
      <button class="fb-btn" type="button" data-sess-open aria-expanded="${!!(sess && sess.id === c.id)}">${ICON_BOARD}Surfed here? Log a session</button>
      <span class="fb-note">${(() => {
        const L = learnedSpot(c.id), n = L ? L.n : 0, mineS = loadSess().filter((e) => e.id === c.id).length;
        return [n ? `${n} session${n > 1 ? 's' : ''} logged here` : 'Your sessions teach the scores', mineS ? `${mineS} from you` : ''].filter(Boolean).join(' · ');
      })()}</span>
    </div>
    <div class="acct-host"></div>`;
  Account.mount(el.querySelector('.acct-host'), {
    reason: 'to log sessions.',
    onChange: (ev, then) => {
      if (ev === 'in') { resendSessions(); if (then === 'sess' && !(sess && sess.id === c.id)) openSess(c); }
      if (ev === 'out' && sess) closeSess();
      renderFb(c);
    },
  });
  el.querySelector('[data-sess-open]').addEventListener('click', () => {
    if (sess && sess.id === c.id) return closeSess();
    if (!Account.get()) return Account.open('in', { then: 'sess', note: 'Sign in to log a session. Every report then belongs to someone, which keeps them honest.' });
    openSess(c);
  });
}

/* ---------- Logged sessions ("I surfed here") ----------
   The best signal for training: someone who was in the water says when,
   how it was and how big. We fetch the forecast for those hours (the
   last 3 days are kept by Open-Meteo), show it, save it with the report
   and send it to the worker, which checks it again. tools/skill.mjs fits
   the scores to these (see "Learning from logged sessions" in score.js).

   Keeping it honest here: only times that have happened, in daylight,
   within the last 3 days; one report per spot and start hour on this
   device; a hidden honeypot field; and answers far from the forecast
   (overhead when it said knee-high, Epic when we had it flat) need a
   second tap to confirm. The worker and the training step check again. */
const SESS_KEY = 'surf-sessions', SESS_VER = 1;
const SESS_MINS = [[30, '30 min'], [60, '1 h'], [90, '1½ h'], [120, '2 h'], [180, '3 h']];
const ICON_BOARD = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20c4-1 12-9 16-16-7 4-15 12-16 16z"/><path d="M8 16l2 2"/></svg>';
const loadSess = () => { try { return JSON.parse(localStorage.getItem(SESS_KEY) || '[]') || []; } catch { return []; } };
const saveSess = (list) => { try { localStorage.setItem(SESS_KEY, JSON.stringify(list.slice(-300))); } catch {} };
let sess = null;   // the open form: { id, day, slot, mins, rating, size, why, opened, data, msg, warn, busy, done }

// The forecast for this spot over the last 3 days and today, blended per
// hour exactly as the live scores are, with each day's own tide range.
const pastCache = {};
async function pastConditions(c) {
  const hit = pastCache[c.id];
  if (hit && Date.now() - hit.at < COND_TTL) return hit;
  // The worker's build already holds the last 2 days and today, blended.
  try {
    const fc = await loadWorkerForecast(), s = fc.spots[c.id];
    if (s) {
      const today = spotNow(s.offset).slice(0, 10), byDate = {}, sun = {};
      for (const d of s.days) if (d.date <= today) { byDate[d.date] = d.hours.map((k) => ({ ...k })); if (d.sun) sun[d.date] = d.sun; }
      return (pastCache[c.id] = { at: Date.now(), byDate, sun, offset: s.offset });
    }
  } catch {}
  const [lat, lng] = offshore(c);
  const q = `latitude=${lat}&longitude=${lng}&past_days=2&forecast_days=1&timezone=auto`;
  const [m, w] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&hourly=${MARINE.join()}&models=${modelIds(MARINE_MODELS)}`).then((r) => r.json()),
    fetch(`https://api.open-meteo.com/v1/forecast?${q}&hourly=${WIND.join()}&models=${modelIds(WIND_MODELS)}&daily=sunrise,sunset`).then((r) => r.json()),
  ]);
  if (m.error || w.error || !m.hourly || !w.hourly) throw new Error(m.reason || w.reason || 'no forecast');
  const f = blendSpot(c, m, w), byDate = {}, sun = {};   // score.js
  for (const d of f.days) { byDate[d.date] = d.hours; if (d.sun) sun[d.date] = d.sun; }
  return (pastCache[c.id] = { at: Date.now(), byDate, sun, offset: f.offset });
}
const spotNow = (offset) => new Date(Date.now() + offset * 1000).toISOString().slice(0, 16);   // spot-local "YYYY-MM-DDTHH:MM"
const addMins = (local, mins) => new Date(Date.parse(local + ':00Z') + mins * 60000).toISOString().slice(0, 16);
const hm = (local) => local.slice(11, 16);
// Half-hour start times on a day, from just before sunrise to sunset,
// never later than now.
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

async function openSess(c) {
  sess = { id: c.id, day: null, slot: null, mins: 90, rating: null, size: null, surface: null, shape: null, why: new Set(), opened: Date.now(), data: null, msg: '', warn: '', busy: true, done: false };
  renderSess(c); renderFb(c);
  try {
    sess.data = await pastConditions(c);
    const days = Object.keys(sess.data.byDate).sort().filter((d) => sessSlots(sess.data, d).length);
    sess.day = days[days.length - 1] || null;
    const slots = sess.day ? sessSlots(sess.data, sess.day) : [];
    sess.slot = slots.length ? slots[Math.max(0, slots.length - 3)] : null;
  } catch { sess.msg = 'Couldn’t load the forecast for those days. Try again in a moment.'; }
  sess.busy = false;
  if (sess.id === c.id) renderSess(c);
}
function closeSess() {
  const c = sess && byId(sess.id);
  sess = null;
  $('v-sess').hidden = true; $('v-sess').innerHTML = '';
  if (c) renderFb(c);
}

function renderSess(c) {
  const el = $('v-sess');
  if (!sess || sess.id !== c.id) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const head = `<div class="sess-head"><span class="k">Log a session</span><button class="sess-x" type="button" data-sx aria-label="Close">✕</button></div>`;
  if (sess.done) {
    el.innerHTML = head + `<p class="sess-ok">${sess.msg}</p>`;
    return;
  }
  if (sess.busy || !sess.data) {
    el.innerHTML = head + `<p class="fb-note">${sess.msg || 'Loading the forecast for the last few days…'}</p>`;
    return;
  }
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
    // Same size bands as the buttons below, so the words match.
    const fr = faceRange(c, k);
    then = `<div class="sess-then"><span class="k">Forecast then</span> ${esc(SIZE_BANDS[sizeBand((fr[0] + fr[1]) / 2)])} (${rng(fr[0], fr[1])}) · ${Math.round(k.p)} s ${k.d != null ? dirName(k.d) : ''} · ${kts(k.ws)} kts ${esc(windRel(c, k))}${r && r.surface ? `, <b>${esc(r.surface.label.toLowerCase())}</b>` : ''}${k.tn != null ? ` · ${tideWord(k.tn)} tide${k.tdir ? ' ' + k.tdir : ''}` : ''}${model != null && r ? ` · we scored it <b>${fmt(model)}</b>` : ''}</div>`;
  }
  const end = sess.slot ? addMins(sess.slot, sess.mins) : '';
  el.innerHTML = head + `
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
      <span class="fb-note">Saved with the forecast for those hours${Account.get() ? `, as ${esc(Account.get().name)}` : ''}.</span>
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
  return { warn: bits.length ? `Just checking: ${bits.join('; ')}. That happens (banks, a sheltered corner, a bad forecast), and it’s exactly what helps, but please make sure the spot and time are right.` : '', model, hrs };
}

async function submitSession(c) {
  const err = checkSess(c);
  if (err) { sess.msg = err; return renderSess(c); }
  const p = plausibility(c);
  if (p.warn && !sess.warn) { sess.warn = p.warn; sess.msg = ''; return renderSess(c); }
  const hp = $('v-sess').querySelector('.hp');
  const payload = {
    id: c.id, local: sess.slot, start: new Date(Date.parse(sess.slot + ':00Z') - sess.data.offset * 1000).toISOString(),
    mins: sess.mins, rating: sess.rating, size: sess.size, surface: sess.surface, shape: sess.shape, why: [...sess.why],
    hours: p.hrs.slice(0, 4).map((k) => ({ t: k.t, k: snapK(k) })),
    model: p.model == null ? null : +p.model.toFixed(2), ver: SESS_VER,
    hp: hp ? hp.value : '', dt: Date.now() - sess.opened, dev: Account.device(),
  };
  sess.busy = true; sess.msg = ''; renderSess(c);
  const res = await sendSession(payload);
  sess.busy = false;
  if (res.refused) { sess.msg = res.why; return renderSess(c); }
  // Sent, already there, or kept here to retry: either way it's logged.
  const list = loadSess();
  list.push({ id: c.id, local: payload.local, mins: payload.mins, rating: payload.rating, size: payload.size, model: payload.model, sent: res.ok, payload: res.ok ? undefined : payload });
  saveSess(list);
  sess.done = true;
  const what = `${esc(SESSION_RATINGS[payload.rating])}, ${esc(SIZE_BANDS[payload.size].toLowerCase())}, ${hm(payload.local)} for ${SESS_MINS.find((m) => m[0] === payload.mins)[1]}`;
  sess.msg = res.ok ? `Logged: ${what}. Thanks. It counts from the next update (every 3 hours).`
    : res.signedOut ? `Saved on this device: ${what}. ${esc(res.why)}`
    : `Saved on this device: ${what}. ${esc(res.why)} It’ll send itself next time you open the page.`;
  renderFb(c);
  if (res.signedOut) Account.open('in', { note: 'Sign in again to send your session.' });
  renderSess(c);
}
// POST one session. refused = the server checked it and said no (don't
// keep it); otherwise not ok means try again later.
// signedOut = no working sign-in on this device (the session is kept and
// sent after signing in).
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
setTimeout(resendSessions, 4000);

// One listener for the whole form, which re-renders on every change.
$('v-sess').addEventListener('click', (e) => {
  const c = sess && byId(sess.id), b = e.target.closest('button');
  if (!c || !b) return;
  const ds = b.dataset;
  if ('sx' in ds) return closeSess();
  if ('ssend' in ds) return submitSession(c);
  if (ds.sday) { sess.day = ds.sday; const sl = sessSlots(sess.data, sess.day); sess.slot = sl.includes(sess.slot) ? sess.slot : sl[Math.max(0, sl.length - 3)] || null; }
  else if (ds.smins) sess.mins = +ds.smins;
  else if (ds.srate) sess.rating = +ds.srate;
  else if (ds.ssize) sess.size = +ds.ssize;
  else if (ds.ssurf) sess.surface = +ds.ssurf;
  else if (ds.sshape) sess.shape = sess.shape === +ds.sshape ? null : +ds.sshape;   // tap again to clear
  else if (ds.swhy) { if (sess.why.has(ds.swhy)) sess.why.delete(ds.swhy); else sess.why.add(ds.swhy); }
  else return;
  sess.warn = ''; sess.msg = '';
  renderSess(c);
});
$('v-sess').addEventListener('change', (e) => {
  const c = sess && byId(sess.id);
  if (!c || !e.target.matches('[data-sslot]')) return;
  sess.slot = e.target.value; sess.warn = ''; sess.msg = '';
  renderSess(c);
});
