/* The account page (account.html): signing in or out, your spots in your
   order (they lead the 16-day page and the cams page's My spots; kept on
   this device, and on the account when signed in), and the sessions you've
   logged (GET /s/mine), and spots to suggest (POST / GET /a/suggest).
   account.js does the forms and the favourites. */
const $ = (id) => document.getElementById(id);
const byId = (id) => CAMS.find((x) => x.id === id);
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

let mine = null;   // my sessions: null loading, [] none, or { error }
let me = null;     // GET /a/me: { name, created, sessions }

/* ---------- Account ---------- */
function renderAccount() {
  Account.mount($('acct'), { reason: 'to log sessions and keep your spots on every device.', onChange: refresh });
  if (!Account.get() && !Account.isOpen()) Account.open('in');
  const f = $('facts');
  f.innerHTML = Account.get() && me
    ? `<span>Member since <b>${MONTHS[new Date(me.created).getMonth()]} ${new Date(me.created).getFullYear()}</b></span><span><b>${me.sessions}</b> session${me.sessions === 1 ? '' : 's'} logged</span><span><b>${Account.favs.list().length}</b> spot${Account.favs.list().length === 1 ? '' : 's'} starred</span>`
    : '';
}

/* ---------- My spots ---------- */
const ARROW = (d) => `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
function renderSpots() {
  const favs = Account.favs.list(), others = CAMS.filter((c) => !favs.includes(c.id));
  $('spots-sub').innerHTML = `They lead the <a href="week.html">16-day page</a> and the cams, in this order. Kept on this device${Account.get() ? ' and your account, so every device you sign in on has them' : '; sign in to keep them on every device'}.`;
  $('spots-list').innerHTML = `<div class="edit">
    ${favs.length ? `<ol>${favs.map((id, n) => { const c = byId(id); return `<li>
      <span class="n">${esc(c.name)}<small>${esc(c.zone || c.town)} · ${esc(c.area)}</small></span>
      <button class="ib" type="button" data-up="${esc(id)}" aria-label="Move ${esc(c.name)} up"${n === 0 ? ' disabled' : ''}>${ARROW('M12 19V5M5 12l7-7 7 7')}</button>
      <button class="ib" type="button" data-down="${esc(id)}" aria-label="Move ${esc(c.name)} down"${n === favs.length - 1 ? ' disabled' : ''}>${ARROW('M12 5v14M5 12l7 7 7-7')}</button>
      <button class="ib" type="button" data-rm="${esc(id)}" aria-label="Remove ${esc(c.name)}">✕</button>
    </li>`; }).join('')}</ol>` : '<p class="hint">No spots yet. Add the ones you surf below.</p>'}
    <h3>Add spots</h3>
    ${AREAS.map((a) => { const l = others.filter((c) => c.area === a); return l.length ? `<div class="adds">${l.map((c) => `<button class="add" type="button" data-add="${esc(c.id)}">+ ${esc(c.name)}</button>`).join('')}</div>` : ''; }).join('')}
  </div>`;
}
$('spots-list').addEventListener('click', (e) => {
  const b = e.target.closest('[data-up], [data-down], [data-rm], [data-add]');
  if (!b) return;
  const l = Account.favs.list();
  if (b.dataset.add) l.push(b.dataset.add);
  else if (b.dataset.rm) l.splice(l.indexOf(b.dataset.rm), 1);
  else {
    const id = b.dataset.up || b.dataset.down, n = l.indexOf(id), m = n + (b.dataset.up ? -1 : 1);
    if (m < 0 || m >= l.length) return;
    [l[n], l[m]] = [l[m], l[n]];
  }
  Account.favs.save(l);
});

/* ---------- Suggest a spot ---------- */
let suggested = null;   // my suggestions: null loading, or a list
function renderSuggest() {
  const box = $('suggest-box');
  if (!Account.get()) { box.innerHTML = '<p class="none">Sign in to suggest a spot.</p>'; return; }
  // The form is drawn once, so a re-render doesn't lose what's typed.
  if (!box.querySelector('form')) {
    const f = (name, label, type, extra = '') => `<label class="acct-f"><span>${label}</span><input class="acct-in" name="${name}" type="${type}" ${extra}></label>`;
    box.innerHTML = `<form class="sg-form" novalidate>
      <div class="acct-fields">
        ${f('spot', 'Spot', 'text', 'maxlength="60" required placeholder="e.g. Praia Grande"')}
        ${f('where', 'Where', 'text', 'maxlength="80" placeholder="Town or area"')}
        ${f('cam', 'Cam link (if there is one)', 'url', 'maxlength="300" placeholder="https://…"')}
        <label class="acct-f"><span>Anything else</span><textarea class="acct-in" name="note" rows="3" maxlength="500" placeholder="When it works, what it likes…"></textarea></label>
      </div>
      <div class="acct-row"><button class="acct-btn" type="submit">Send to Oli</button><span class="sg-msg" aria-live="polite"></span></div>
    </form>
    <div class="sg-list"></div>`;
    box.querySelector('form').addEventListener('submit', sendSuggestion);
  }
  const list = box.querySelector('.sg-list');
  list.innerHTML = suggested && suggested.length ? `<h3 class="sg-h">Your suggestions</h3><ol class="sess-list">${suggested.map((s) => `<li>
      <span class="rt sg-rt">Sent</span>
      <span class="spot">${esc(s.spot)}</span>
      <span class="when">${esc(new Date(s.t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</span>
      <span class="what">${esc([s.where, s.cam ? 'has a cam' : '', s.note].filter(Boolean).join(' · '))}</span>
    </li>`).join('')}</ol>` : '';
}
async function sendSuggestion(e) {
  e.preventDefault();
  const form = e.target, msg = form.querySelector('.sg-msg'), btn = form.querySelector('button');
  const v = (n) => form.elements[n].value.trim();
  if (v('spot').length < 2) { msg.textContent = 'Give the spot a name.'; return; }
  btn.disabled = true; msg.textContent = '';
  const j = await Account.post('/a/suggest', { spot: v('spot'), where: v('where'), cam: v('cam'), note: v('note') });
  btn.disabled = false;
  if (j.error) { msg.textContent = j.error; return; }
  form.reset();
  msg.textContent = 'Thanks, it’s with Oli.';
  await loadSuggested();
  renderSuggest();
}
async function loadSuggested() {
  if (!Account.get()) { suggested = []; return; }
  const j = await Account.call('GET', '/a/suggest');
  suggested = j.error ? [] : j.suggestions;
}

/* ---------- My sessions ---------- */
const lengthOf = (m) => (m < 60 ? `${m} min` : `${m / 60} h`.replace('.5 h', '½ h'));
function renderSessions() {
  const el = $('sess-list');
  if (!Account.get()) { el.innerHTML = '<p class="none">Sign in to see the sessions you’ve logged.</p>'; return; }
  if (mine === null) { el.innerHTML = '<p class="none">Loading…</p>'; return; }
  if (mine.error) { el.innerHTML = `<p class="none">${esc(mine.error)}</p>`; return; }
  if (!mine.length) { el.innerHTML = '<p class="none">None yet. Open a cam and tap “Surfed here? Log a session” after you’ve been in.</p>'; return; }
  el.innerHTML = `<ol class="sess-list">${mine.map((s) => {
    const c = byId(s.id), d = new Date(s.local + ':00Z');
    const when = `${DOW[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} · ${s.local.slice(11, 16)}`;
    const bits = [lengthOf(s.mins), SIZE_BANDS[s.size], s.surface != null ? SURFACES[s.surface] : '', s.shape != null ? SESSION_SHAPE[s.shape] : '',
      s.model != null ? `forecast said ${fmt(s.model)}` : ''].filter(Boolean);
    return `<li class="lvl-${s.rating}">
      <span class="rt">${SESSION_RATINGS[s.rating]}</span>
      <a class="spot" href="insights.html?spot=${esc(s.id)}">${esc(c ? c.name : s.id)}</a>
      <span class="when">${when}</span>
      <span class="what">${esc(bits.join(' · '))}</span>
    </li>`;
  }).join('')}</ol>`;
}

/* ---------- Wiring ---------- */
async function loadMine() {
  if (!Account.get()) { mine = []; me = null; return; }
  const [s, m] = await Promise.all([Account.call('GET', '/s/mine'), Account.call('GET', '/a/me')]);
  mine = s.error ? { error: s.error } : s.sessions;
  me = m.error ? null : m;
}
function render() { renderAccount(); renderSpots(); renderSuggest(); renderSessions(); }
async function refresh() { mine = null; suggested = null; if (!Account.get()) $('suggest-box').innerHTML = ''; render(); await Promise.all([loadMine(), loadSuggested()]); render(); }

Account.favs.onChange(() => { renderSpots(); renderAccount(); });
render();
Account.favs.sync().then(render);
Promise.all([loadMine(), loadSuggested()]).then(render);
if (location.hash) requestAnimationFrame(() => { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); });
