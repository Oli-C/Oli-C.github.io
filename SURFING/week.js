/* Seven days for every spot: the spot's name and a card per day, headed by
   the day's score (the daylight average, same engine as the live page) on
   its colour, greyer when less certain; then size at the beach, the swell
   and any second swell (arrows, height, period, from), the wind (arrow,
   knots, from, offshore / cross / onshore), the surface, and four little
   bars for dawn / morning / afternoon / evening. Tap a card for the rest
   of that day (tide, light, confidence) in one line.

   "My spots" (account.js: starred in a spot's viewer, ordered on the
   account page; kept on the account when signed in) come first; Mine /
   All picks whether the rest of the coast shows too. Cards / Compact: the
   cards, or a table of just the day scores, a row a spot. The forecast is
   the worker's hourly build, or the same blend done here if that's
   unavailable. */
const DAYS = 16;       // today and fifteen ahead; past a week, a trend
const NEAR = 7;        // days that count as a forecast (best bets, plain cards)
const TTL = 60 * 60 * 1000;   // how long this device's copy stands in if the worker can't be had
const VER = 6;

const $ = (id) => document.getElementById(id);
const list = $('list'), chips = $('chips'), empty = $('empty'), status = $('status'), bets = $('bets'), tools = $('tools');

const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
units = store.get('surf-units') === 'ft' ? 'ft' : 'm';
let area = 'All';
let scope = store.get('surf-week-scope') === 'all' ? 'all' : 'mine';
let look = store.get('surf-week-view') === 'compact' ? 'compact' : 'cards';
let sel = null;       // the opened tile: { id, i }
let data = {};        // cam id -> { days: [{ date, hours:[k], tides:[], sun, conf }] }

const byId = (id) => CAMS.find((x) => x.id === id);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/* ---------- Fetch ---------- */
async function load() {
  await loadSharedSkill();
  const ids = CAMS.map((c) => c.id).join(), today = new Date().toDateString();
  const skillStamp = sharedSkill && sharedSkill.updated || '';
  let cached = null;
  try { cached = JSON.parse(store.get('surf-week') || 'null'); } catch {}
  const keep = (d) => { data = d; digests.clear(); store.set('surf-week', JSON.stringify({ v: VER, ids, day: today, skill: skillStamp, t: Date.now(), data })); };
  // First choice, every time: the worker's hourly build, already blended
  // for every spot and day (the browser keeps it 5 minutes), so everyone
  // sees the same one. Then this device's last copy, if recent; then
  // fetching and blending here.
  try {
    const r = await fetch(SURF_WORKER + '/forecast');
    if (!r.ok) throw new Error('worker said ' + r.status);
    const fc = await r.json();
    if (fc.v !== 1 || Date.now() - Date.parse(fc.built) > 3 * 3600e3) throw new Error('stale or unknown forecast');
    const next = {};
    for (const c of CAMS) {
      const s = fc.spots[c.id];
      if (!s) throw new Error('spot missing: ' + c.id);
      const from = new Date(Date.now() + s.offset * 1000).toISOString().slice(0, 10);
      next[c.id] = { days: s.days.filter((d) => d.date >= from).slice(0, DAYS).map((d) => ({ date: d.date, hours: d.hours, tides: d.tides, sun: d.sun, conf: d.conf })) };
    }
    return keep(next);
  } catch (e) { console.info('surf: worker forecast unavailable —', e.message); }
  if (cached && cached.v === VER && cached.ids === ids && cached.day === today && cached.skill === skillStamp && Date.now() - cached.t < TTL) { data = cached.data; digests.clear(); return; }
  const pts = CAMS.map(offshore);
  const lat = pts.map((p) => p[0]).join(','), lng = pts.map((p) => p[1]).join(',');
  // Same multi-model blend as the live page and the worker.
  const [marine, wind] = await Promise.all([
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&hourly=${MARINE.join()}&models=${modelIds(MARINE_MODELS)}&forecast_days=${DAYS}&timezone=auto`).then((r) => r.json()),
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&hourly=${WIND.join()}&models=${modelIds(WIND_MODELS)}&daily=sunrise,sunset&forecast_days=${DAYS}&timezone=auto`).then((r) => r.json()),
  ]);
  if (marine.error || wind.error) throw new Error(marine.reason || wind.reason);
  const M = asList(marine), W = asList(wind);
  const next = {};
  CAMS.forEach((c, i) => {
    const m = M[i], w = W[i];
    if (m && w && m.hourly && w.hourly) next[c.id] = { days: blendSpot(c, m, w).days };   // score.js
  });
  keep(next);
}

/* ---------- Per-day digest (score.js dayDigest) ---------- */
const digests = new Map();
const digestOf = (c, i) => {
  const key = `${c.id}|${i}|${units}`;
  if (!digests.has(key)) digests.set(key, data[c.id] && data[c.id].days[i] ? dayDigest(c, data[c.id].days[i]) : null);
  return digests.get(key);
};
const dates = () => { const any = Object.values(data)[0]; return any ? any.days.map((d) => d.date) : []; };
const dayName = (iso, i, long) => (i === 0 ? 'Today' : i === 1 && long ? 'Tomorrow' : (long ? ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] : DOW)[new Date(iso + 'T12:00').getDay()]);

/* ---------- Render ---------- */
const q = $('q');
const matches = (c) => spotMatches(c, q.value, area);   // toolbar.js

// Best bets: the strongest windows of the week among the spots on show.
function renderBets(spots) {
  const ds = dates(), cands = [];
  for (const c of spots) ds.slice(0, NEAR).forEach((iso, i) => { const d = digestOf(c, i); if (d && d.best) cands.push({ c, i, iso, d, s: d.best.score }); });
  cands.sort((a, b) => b.s - a.s || a.i - b.i);
  const good = cands.filter((x) => x.s > 3.5).slice(0, 3);
  if (!cands.length) { bets.innerHTML = ''; return; }
  const pick = good.length ? good : cands.slice(0, 1);
  bets.innerHTML = `<span class="k">${good.length ? 'Best bets' : 'Quiet week'}</span>` + pick.map((x) =>
    `<button class="bet lvl-${levelOf(x.s)}" type="button" data-id="${esc(x.c.id)}" data-i="${x.i}"><b>${fmt(x.s)}</b>${esc(x.c.name)} <small>${dayName(x.iso, x.i, true)} ${x.d.best.label.toLowerCase()}</small></button>`).join('')
    + (good.length ? '' : '<span>nothing better than this on show</span>');
}

function renderTools(hasFavs) {
  tools.innerHTML = `
    ${hasFavs ? `<div class="seg sm" role="group" aria-label="Spots to show">
      <button type="button" data-scope="mine" aria-pressed="${scope === 'mine'}">My spots</button>
      <button type="button" data-scope="all" aria-pressed="${scope === 'all'}">All</button>
    </div>` : ''}
    <div class="seg sm" role="group" aria-label="Layout">
      <button type="button" data-look="cards" aria-pressed="${look === 'cards'}">Cards</button>
      <button type="button" data-look="compact" aria-pressed="${look === 'compact'}">Compact</button>
    </div>
    <a class="btn" href="account.html#spots">${hasFavs ? 'Edit my spots' : '★ Pick my spots'}</a>
    <div class="legend" aria-hidden="true">
      ${LEVELS.map((l, i) => `<span class="lvl-${i}"><i></i>${l}</span>`).join('')}
      <span class="unsure"><i></i>greyer = less sure</span>
    </div>`;
}

// A spot's name and a card per day: size at the beach; the swell (arrow =
// the way it's travelling, offshore height, period, from) and a second
// swell from elsewhere if there is one; the wind (arrow, knots, from, and
// how it sits on this beach, coloured); the surface; when in the day.
const GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 9h-3.5v11h-5V11H6z"/></svg>';
const arrow = (deg) => (deg == null ? '' : `<span class="arr" style="--rot:${Math.round(deg + 180)}deg">${GLYPH}</span>`);
function stripHtml(c) {
  const ds = dates();
  const cardsHtml = ds.map((iso, i) => {
    const d = digestOf(c, i), on = sel && sel.id === c.id && sel.i === i;
    const far = i >= NEAR ? ' far' : '';
    const day = `<span class="day${i === 0 ? ' today' : ''}">${i === 0 ? 'Today' : `${dayName(iso, i)} ${new Date(iso + 'T12:00').getDate()}`}${far ? '<small>trend</small>' : ''}</span>`;
    if (!d) return `<button class="dcard lvl-x" type="button" data-id="${esc(c.id)}" data-i="${i}" aria-pressed="${on}"><span class="top">${day}<span><b>–</b></span></span><span class="body">No forecast</span></button>`;
    const size = Math.abs(d.hMax - d.hMin) < 0.25 ? hgt((d.hMin + d.hMax) / 2) : rng(d.hMin.toFixed(1), d.hMax.toFixed(1));
    const wind = d.wsMin === d.wsMax ? `${d.wsMin}` : `${d.wsMin}–${d.wsMax}`;
    const rel = d.rel === 'cross-shore' ? 'cross' : d.rel;
    return `<button class="dcard lvl-${d.level}${far}" type="button" data-id="${esc(c.id)}" data-i="${i}" aria-pressed="${on}" style="--conf:${d.conf != null ? d.conf : 1}"
      aria-label="${esc(c.name)}, ${dayName(iso, i, true)}: ${d.top === 0 ? 'flat' : `${fmt(d.top)} ${d.label}`}">
      <span class="top">${day}<span>${d.top === 0 ? '<b>Flat</b>' : `<b>${fmt(d.top)}</b><small>${d.label}</small>`}</span></span>
      <span class="body">
        <span class="size" title="Wave faces at the beach">${size}<small>faces</small></span>
        <span class="cr">${arrow(d.sw.d)}<b>${hgt(d.sw.h)}</b> ${d.p} s${d.sw.d != null ? ' ' + dirName(d.sw.d) : ''}</span>
        ${d.s2 ? `<span class="cr s2" title="Second swell">${arrow(d.s2.d)}<b>${hgt(d.s2.h)}</b> ${d.s2.p} s ${dirName(d.s2.d)}</span>` : ''}
        <span class="cr w-${d.rel}">${arrow(d.wd)}<b>${wind} kts</b> ${dirName(d.wd)} <em>${rel}</em></span>
        ${d.surf ? `<span class="cr surf surf-${d.surf.most}">${SURFACES[d.surf.most]}</span>` : ''}
        <span class="when"><span class="parts" aria-hidden="true">${d.blocks.map((b) => `<i class="${b.level == null ? 'lvl-x' : 'lvl-' + b.level}" style="height:${b.score == null ? 2 : Math.max(2, b.score * 10)}%"></i>`).join('')}</span>${d.best ? `best ${d.best.label.toLowerCase()}` : ''}</span>
      </span>
    </button>`;
  }).join('');
  return `<div class="srow" data-id="${esc(c.id)}">
    <div class="srow-head"><a href="./#${esc(c.id)}" title="Open ${esc(c.name)}">${esc(c.name)}</a><small>${esc(c.zone && c.zone !== c.name ? c.zone : c.town)}</small></div>
    <div class="strip">${cardsHtml}</div>
    ${sel && sel.id === c.id ? detailHtml(c, sel.i) : ''}
  </div>`;
}
// Compact: a table a section, a row a spot, a cell a day holding just its
// score on its colour (greyer when less sure, dashed past a week); the
// opened day under the table.
function tableHtml(spots) {
  const ds = dates();
  const cell = (c, iso, i) => {
    const d = digestOf(c, i), on = sel && sel.id === c.id && sel.i === i, far = i >= NEAR ? ' far' : '';
    if (!d) return `<td><button class="cc lvl-x${far}" type="button" data-id="${esc(c.id)}" data-i="${i}" aria-pressed="${on}" aria-label="${esc(c.name)}, ${dayName(iso, i, true)}: no forecast">–</button></td>`;
    const size = Math.abs(d.hMax - d.hMin) < 0.25 ? hgt((d.hMin + d.hMax) / 2) : rng(d.hMin.toFixed(1), d.hMax.toFixed(1));
    const what = `${dayName(iso, i, true)}: ${d.top === 0 ? 'flat' : `${fmt(d.top)} ${d.label}`}, ${size}, ${d.wsMin === d.wsMax ? d.wsMin : `${d.wsMin}–${d.wsMax}`} kts ${d.rel}`;
    return `<td><button class="cc lvl-${d.level}${far}" type="button" data-id="${esc(c.id)}" data-i="${i}" aria-pressed="${on}" style="--conf:${d.conf != null ? d.conf : 1}" title="${esc(what)}" aria-label="${esc(c.name)}, ${esc(what)}">${d.top === 0 ? '–' : fmt(d.top)}</button></td>`;
  };
  const open = sel && spots.find((c) => c.id === sel.id);
  return `<div class="ctab-wrap"><table class="ctab">
    <thead><tr><th></th>${ds.map((iso, i) => `<th class="${i === 0 ? 'today' : ''}${i >= NEAR ? ' far' : ''}">${i === 0 ? 'Today' : dayName(iso, i)}<small>${new Date(iso + 'T12:00').getDate()}</small></th>`).join('')}</tr></thead>
    <tbody>${spots.map((c) => `<tr><th scope="row"><a href="./#${esc(c.id)}" title="Open ${esc(c.name)}">${esc(c.name)}</a></th>${ds.map((iso, i) => cell(c, iso, i)).join('')}</tr>`).join('')}</tbody>
  </table></div>${open ? detailHtml(open, sel.i) : ''}`;
}
const gridHtml = (spots) => (look === 'compact' ? tableHtml(spots) : spots.map(stripHtml).join(''));

// One day at one spot, in a line: when it's best, size, wind, surface,
// tide, light and how sure we are, each marked good / so-so / bad.
function detailHtml(c, i) {
  const d = digestOf(c, i), iso = dates()[i];
  if (!d) return `<div class="dt"><span class="when">${dayName(iso, i, true)}: no forecast.</span></div>`;
  const size = Math.abs(d.hMax - d.hMin) < 0.25 ? hgt((d.hMin + d.hMax) / 2) : rng(d.hMin.toFixed(1), d.hMax.toFixed(1));
  const [lo, hi] = c.best.size;
  const sizeCls = d.hMax < lo * 0.6 || d.hMin > hi * 1.6 ? 'bad' : d.hMax < lo || d.hMin > hi ? 'ok' : 'good';
  const wind = d.wsMin === d.wsMax ? `${d.wsMin} kts` : `${d.wsMin}–${d.wsMax} kts`;
  const windCls = d.wsMax <= 6 || d.rel === 'offshore' ? 'good' : d.rel === 'cross-shore' && d.wsMax <= 14 ? 'ok' : d.wsMax <= 8 ? 'ok' : 'bad';
  const surfCls = !d.surf ? '' : d.surf.most <= 1 ? 'good' : d.surf.most === 2 ? 'ok' : 'bad';
  const confCls = d.conf == null ? '' : d.conf >= 0.75 ? 'good' : d.conf >= 0.45 ? 'ok' : 'bad';
  const tide = d.tides && d.tides.length ? d.tides.map((e) => `${e.kind === 'High' ? 'High' : 'Low'} ${fmtMins(e.mins)}`).join(' · ') : '';
  const best = d.best;
  return `<div class="dt">
    <span class="when"><b>${esc(c.name)}, ${dayName(iso, i, true)}</b> · ${fmt(d.top)} ${d.label} over the day${best ? `, best ${best.label.toLowerCase()} ${String(best.from).padStart(2, '0')}–${String(best.to).padStart(2, '0')} (${fmt(best.score)})` : ''}</span>
    <span class="chip2 ${sizeCls}"><small>Size</small>${size}</span>
    <span class="chip2 ${windCls}"><small>Wind</small>${wind} ${esc(d.rel.replace('-shore', ''))}</span>
    ${d.surf ? `<span class="chip2 ${surfCls}"><small>Surface</small>${SURFACES[d.surf.most]}${d.surf.best < d.surf.most ? `, ${SURFACES[d.surf.best].toLowerCase()} at best` : ''}</span>` : ''}
    ${tide ? `<span class="chip2"><small>Tide</small>${tide}</span>` : ''}
    ${d.sun ? `<span class="chip2"><small>Light</small>${d.sun.rise}–${d.sun.set}</span>` : ''}
    ${d.conf != null ? `<span class="chip2 ${confCls}"><small>Forecast</small>${confWord(d.conf)} confidence</span>` : ''}
    <a href="./#${esc(c.id)}@${iso}">Open ${i === 0 ? 'today' : dayName(iso, i, true)} at the spot →</a>
  </div>`;
}

function renderList() {
  const favs = Account.favs.list(), shownFavs = favs.map(byId).filter((c) => c && matches(c));
  const rest = CAMS.filter((c) => !favs.includes(c.id) && matches(c));
  const showRest = !favs.length || scope === 'all';
  renderTools(favs.length > 0);
  let html = '';
  if (shownFavs.length) html += `<section class="sec"><div class="sec-head"><h2>My spots</h2></div>${gridHtml(shownFavs)}</section>`;
  else if (!favs.length) html += `<p class="hint"><b>Make this your list:</b> star the spots you surf (★ in a spot’s viewer, or <a href="account.html#spots">pick them on your account page</a>). They’ll lead this page in your order, and follow your account onto every device.</p>`;
  if (showRest) html += AREAS.map((a) => { const l = rest.filter((c) => c.area === a); return l.length ? `<section class="sec"><div class="sec-head"><h2>${esc(a)}</h2></div>${gridHtml(l)}</section>` : ''; }).join('');
  list.innerHTML = html;
  renderBets(showRest ? [...shownFavs, ...rest] : shownFavs);
  empty.classList.toggle('show', !shownFavs.length && !(showRest && rest.length) && !!(q.value.trim() || area !== 'All'));
}

function renderChips() {
  chips.innerHTML = ['All', ...AREAS].map((a) => `<button class="chip" type="button" data-area="${esc(a)}" aria-pressed="${a === area}">${esc(a)}</button>`).join('');
}

function render() { renderChips(); renderList(); }

/* ---------- Wiring ---------- */
function openTile(id, i) {
  sel = sel && sel.id === id && sel.i === i ? null : { id, i };
  renderList();
  const t = list.querySelector(`[data-id="${CSS.escape(id)}"][data-i="${i}"]`);
  if (t && sel) t.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
list.addEventListener('click', (e) => {
  const t = e.target.closest('.dcard, .cc');
  if (t) openTile(t.dataset.id, +t.dataset.i);
});
// Swiping one spot's days swipes them all, so the days stay in columns.
let syncing = false;
list.addEventListener('scroll', (e) => {
  const src = e.target;
  const kind = src.classList && ['strip', 'ctab-wrap'].find((k) => src.classList.contains(k));
  if (syncing || !kind) return;
  syncing = true;
  for (const st of list.querySelectorAll('.' + kind)) if (st !== src) st.scrollLeft = src.scrollLeft;
  requestAnimationFrame(() => { syncing = false; });
}, true);
bets.addEventListener('click', (e) => { const b = e.target.closest('.bet'); if (b) openTile(b.dataset.id, +b.dataset.i); });
tools.addEventListener('click', (e) => {
  const s = e.target.closest('[data-scope]');
  if (s) { scope = s.dataset.scope; store.set('surf-week-scope', scope); return renderList(); }
  const l = e.target.closest('[data-look]');
  if (l) { look = l.dataset.look; store.set('surf-week-view', look); renderList(); }
});
Account.favs.onChange(() => renderList());
q.addEventListener('input', renderList);
chips.addEventListener('click', (e) => { const b = e.target.closest('.chip'); if (b) { area = b.dataset.area; render(); } });
$('units').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-units]');
  if (!b) return;
  units = b.dataset.units === 'ft' ? 'ft' : 'm';
  for (const x of $('units').querySelectorAll('button')) x.setAttribute('aria-pressed', x.dataset.units === units);
  store.set('surf-units', units);
  render();
});
for (const x of $('units').querySelectorAll('button')) x.setAttribute('aria-pressed', x.dataset.units === units);

renderChips();
Account.favs.sync();
// An open page keeps current: reloaded on coming back to it after a while.
let loadedAt = Date.now();
document.addEventListener('visibilitychange', () => {
  if (document.hidden || Date.now() - loadedAt < 10 * 60 * 1000) return;
  loadedAt = Date.now();
  load().then(render).catch(() => {});
});
load().then(() => {
  const ds = dates();
  status.textContent = ds.length ? `Each tile is that day’s daylight average; the bars under the score are dawn, morning, afternoon and evening. Blended from ${WIND_MODELS.length} wind and ${MARINE_MODELS.filter((m) => !m.ocean).length} wave models, each weighted by how accurate it’s been that many days ahead.` : 'Forecast unavailable right now.';
  render();
}).catch(() => { status.textContent = 'Forecast unavailable right now.'; });
