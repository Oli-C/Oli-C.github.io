/* The account page (account.html): signing in or out, your spots in your
   order (they lead the 16-day page and the cams page's My spots; kept on
   this device, and on the account when signed in), and the sessions you've
   logged (GET /s/mine). account.js does the forms and the favourites. */
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
function render() { renderAccount(); renderSpots(); renderSessions(); }
async function refresh() { mine = null; render(); await loadMine(); render(); }

Account.favs.onChange(() => { renderSpots(); renderAccount(); });
render();
Account.favs.sync().then(render);
loadMine().then(render);
if (location.hash) requestAnimationFrame(() => { const t = document.querySelector(location.hash); if (t) t.scrollIntoView(); });
