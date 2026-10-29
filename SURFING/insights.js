/* Spot trends: a spot's recorded days and hours (the worker's history,
   spot_day / spot_hour) beside what surfers logged (data/sessions.json,
   names and devices stripped), so the forecast can be checked against the
   sea and the spot's habits learned.

   The history on its own only shows the model's view of the spot (its
   scores follow its own rules); what's new comes from where sessions
   disagree with it. Those differences are what tools/skill.mjs fits, and
   the last section shows what it has learned from them so far. */
const $ = (id) => document.getElementById(id);
const out = $('out'), spotSel = $('spot'), spanSel = $('span');
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
units = store.get('surf-units') === 'ft' ? 'ft' : 'm';
const isoDay = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const half = (x) => Math.round(x * 2) / 2;
const signed = (x) => `${x > 0 ? '+' : x < 0 ? '−' : '±'}${fmt(Math.abs(Math.round(x * 2) / 2))}`;
const dayLabel = (iso) => { const d = new Date(iso + 'T12:00'); return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; };

// The spot picker, by area; the spot from the address, else your first.
spotSel.innerHTML = AREAS.map((a) => `<optgroup label="${esc(a)}">${CAMS.filter((c) => c.area === a).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
const want = new URLSearchParams(location.search).get('spot') || location.hash.slice(1);
spotSel.value = byId(want) ? want : (Account.favs.list()[0] || CAMS[0].id);
spanSel.value = ['30', '90', '365'].includes(store.get('surf-ins-span')) ? store.get('surf-ins-span') : '90';

let view = null;   // what's on show: { c, days, hours, sessions }

async function load() {
  const c = byId(spotSel.value), span = +spanSel.value;
  history.replaceState(null, '', `?spot=${c.id}`);
  out.innerHTML = '<p class="status">Loading…</p>';
  const to = isoDay(0), from = isoDay(-span), hFrom = isoDay(-Math.min(span, 100));
  const get = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [d, h, s] = await Promise.all([
    get(`${SURF_WORKER}/history/spot?id=${c.id}&from=${from}&to=${to}`),
    get(`${SURF_WORKER}/history/spot/hours?id=${c.id}&from=${hFrom}&to=${to}`),
    get('data/sessions.json'),
    loadSharedSkill(),
  ]);
  const sessions = (Array.isArray(s) ? s : []).filter((x) => x.id === c.id && (x.local || x.start || '').slice(0, 10) >= from)
    .sort((a, b) => (a.local || a.start).localeCompare(b.local || b.start));
  view = { c, from, to, span, days: (d && d.days) || [], hours: (h && h.hours) || [], sessions };
  render();
}

// What a session said, as a score, and what the forecast said then.
const reported = (s) => SESSION_TARGET[s.rating];
const midHour = (s) => (s.hours && s.hours.length ? s.hours[Math.floor((s.hours.length - 1) / 2)] : null);
function forecastThen(c, s) {
  const m = midHour(s);
  if (!m) return null;
  const k = { t: m.t, ...m.k }, r = score(c, k), f = faceRange(c, k);
  return { model: s.model != null ? s.model : r ? r.total : null, size: sizeBand((f[0] + f[1]) / 2), surface: r && r.surface ? r.surface.i : null, k };
}

function render() {
  const { c, days, sessions } = view;
  const scored = days.filter((d) => d.score != null);
  const pairs = sessions.map((s) => ({ s, f: forecastThen(c, s) })).filter((x) => x.f && x.f.model != null);
  const off = pairs.length ? avg(pairs.map((x) => x.f.model - reported(x.s))) : null;
  const good = scored.filter((d) => d.level >= 3).length;
  const first = days.length ? days[0].date : null;
  out.innerHTML = `<div class="ins">
    <section>
      <h2>${esc(c.name)} <small style="font-size:13px;font-weight:400;color:var(--fg-muted)">${esc(c.zone && c.zone !== c.name ? c.zone : c.town)} · <a href="./#${esc(c.id)}" style="color:var(--accent-ink);text-decoration:none">open the spot →</a></small></h2>
      <p class="sub">${first ? `Recorded since ${dayLabel(first)}: each finished day, scored as the outlook page scores it, and every logged session.` : 'Nothing recorded for this spot in this period yet: the worker writes each finished day.'}</p>
      <div class="tiles">
        <div class="tile"><span class="k">Days on record</span><b>${scored.length}</b><small>in ${view.span === 365 ? 'the last year' : `the last ${view.span} days`}</small></div>
        <div class="tile"><span class="k">The average day</span><b>${scored.length ? fmt(half(avg(scored.map((d) => d.score)))) : '–'}</b><small>${scored.length ? LEVELS[levelOf(half(avg(scored.map((d) => d.score))))] + ', daylight average' : 'no days yet'}</small></div>
        <div class="tile"><span class="k">Good or better</span><b>${scored.length ? Math.round(100 * good / scored.length) + '%' : '–'}</b><small>${good} day${good === 1 ? '' : 's'}</small></div>
        <div class="tile"><span class="k">Sessions logged</span><b>${sessions.length}</b><small>${sessions.length ? `${new Set(sessions.map((s) => s.who)).size} surfer${new Set(sessions.map((s) => s.who)).size === 1 ? '' : 's'}` : 'none yet'}</small></div>
        <div class="tile"><span class="k">Forecast vs surfers</span><b>${off == null ? '–' : signed(off)}</b><small>${off == null ? 'needs a session' : Math.abs(off) < 0.75 ? 'about right on average' : off > 0 ? 'the forecast rated it higher' : 'surfers rated it higher'}</small></div>
      </div>
    </section>
    <section>
      <h2>Every day so far</h2>
      <p class="sub">Each square a day, coloured by its score; a ring marks a day someone logged a session. Tap one for that day.</p>
      ${calendarHtml()}
      <div class="keyrow">${LEVELS.map((l, i) => `<span class="lvl-${i}"><i></i>${l}</span>`).join('')}<span><i class="ring"></i>session logged</span></div>
      <p class="pickline" id="pick">${scored.length ? 'Tap a day.' : ''}</p>
    </section>
    <section>
      <h2>Sessions against the forecast</h2>
      <p class="sub">What surfers reported (Flat … Epic as 0 … 9.5) against what the forecast scored for the same hours. On the line, it was right; above it, better than forecast; below, worse.</p>
      ${pairs.length ? `<div class="vs">${scatterHtml(pairs)}<div class="wrap-tbl">${sessionsTable(pairs)}</div></div>` : `<p class="none">No sessions logged here in this period. Each one logged on a spot's page lands here with the forecast for its hours, and teaches the scores.</p>`}
    </section>
    <section>
      <h2>What it likes</h2>
      <p class="sub">Daylight hours on record, grouped by the conditions: the bar is the forecast's average score in them, the marker what surfers reported in the same conditions. Where they part, the forecast has something to learn.</p>
      <div class="lkey"><span><i></i>forecast's average</span><span><u></u>surfers' reports</span></div>
      ${likesHtml()}
    </section>
    <section>
      <h2>What sessions have taught the forecast</h2>
      ${taughtHtml()}
    </section>
  </div>`;
}

/* ---------- Every day so far ---------- */
function calendarHtml() {
  const { from, to, days, sessions } = view;
  const byDate = Object.fromEntries(days.map((d) => [d.date, d]));
  const sessDays = new Set(sessions.map((s) => (s.local || s.start).slice(0, 10)));
  const start = new Date(from + 'T12:00'), lead = (start.getDay() + 6) % 7;   // weeks start on Monday
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<span class="gap"></span>');
  for (let t = start.getTime(); t <= Date.parse(to + 'T12:00'); t += 864e5) {
    const iso = new Date(t).toISOString().slice(0, 10), d = byDate[iso];
    cells.push(`<button type="button" data-date="${iso}" class="${d && d.score != null ? 'lvl-' + d.level : 'lvl-x'}${sessDays.has(iso) ? ' sess' : ''}" aria-pressed="false"
      aria-label="${dayLabel(iso)}: ${d && d.score != null ? `${fmt(d.score)} ${LEVELS[d.level]}` : 'not recorded'}${sessDays.has(iso) ? ', session logged' : ''}"${d || sessDays.has(iso) ? '' : ' disabled'}></button>`);
  }
  return `<div class="cal" id="cal">${cells.join('')}</div>`;
}
function dayText(iso) {
  const d = view.days.find((x) => x.date === iso);
  const ss = view.sessions.filter((s) => (s.local || s.start).slice(0, 10) === iso);
  const logged = ss.length ? `<br>Logged: ${ss.map((s) => `${(s.local || '').slice(11, 16)} <b>${SESSION_RATINGS[s.rating]}</b>, ${SIZE_BANDS[s.size].toLowerCase()}`).join('; ')}` : '';
  if (!d) return `<b>${dayLabel(iso)}</b>: ${iso >= isoDay(0) ? 'still going (a day is recorded once it’s over)' : 'not recorded'}.${logged}`;
  const w = d.ws_lo != null ? `${kts(d.ws_lo)}–${kts(d.ws_hi)} kts ${d.rel ? d.rel.replace('-shore', '') : ''}` : '';
  return `<b>${dayLabel(iso)}</b>: ${fmt(d.score)} ${LEVELS[d.level]}${d.best_part ? `, best ${d.best_part.toLowerCase()} (${fmt(d.best)})` : ''} · faces <b>${rng((+d.face_lo).toFixed(1), (+d.face_hi).toFixed(1))}</b> · swell ${hgt(d.h)} ${Math.round(d.p)} s${d.d != null ? ' ' + dirName(d.d) : ''}${d.h2 ? ` + ${hgt(d.h2)} ${dirName(d.d2)}` : ''} · wind ${w}${d.surface != null ? ` · ${SURFACES[d.surface].toLowerCase()}` : ''}`
    + logged;
}

/* ---------- Sessions against the forecast ---------- */
function scatterHtml(pairs) {
  const W = 300, P = 30, S = (W - P - 10) / 10, X = (v) => P + v * S, Y = (v) => W - P - v * S;
  const ticks = [0, 2.5, 5, 7.5, 10];
  return `<svg class="scatter" viewBox="0 0 ${W} ${W}" role="img" aria-label="Reported against forecast, ${pairs.length} sessions">
    <g class="grid">${ticks.map((t) => `<line x1="${X(0)}" x2="${X(10)}" y1="${Y(t)}" y2="${Y(t)}"/><line y1="${Y(0)}" y2="${Y(10)}" x1="${X(t)}" x2="${X(t)}"/>`).join('')}</g>
    <line class="diag" x1="${X(0)}" y1="${Y(0)}" x2="${X(10)}" y2="${Y(10)}"/>
    ${ticks.map((t) => `<text x="${X(t)}" y="${W - P + 14}" text-anchor="middle">${t}</text><text x="${P - 6}" y="${Y(t) + 3}" text-anchor="end">${t}</text>`).join('')}
    <text x="${X(5)}" y="${W - 2}" text-anchor="middle">forecast score</text>
    <text x="10" y="${Y(5)}" text-anchor="middle" transform="rotate(-90 10 ${Y(5)})">reported</text>
    ${pairs.map((x, i) => `<circle data-i="${i}" cx="${X(Math.min(10, x.f.model))}" cy="${Y(reported(x.s))}" r="5"><title>${esc((x.s.local || '').replace('T', ' '))}: reported ${SESSION_RATINGS[x.s.rating]}, forecast ${fmt(half(x.f.model))}</title></circle>`).join('')}
  </svg>`;
}
function sessionsTable(pairs) {
  return `<table class="tbl"><thead><tr><th>When</th><th>Reported</th><th>Forecast then</th><th>Off by</th></tr></thead><tbody>${pairs.map((x, i) => {
    const s = x.s, f = x.f, d = reported(s) - f.model;
    return `<tr data-i="${i}"><td>${dayLabel((s.local || s.start).slice(0, 10))}<br><small>${(s.local || '').slice(11, 16)}, ${s.mins} min</small></td>
      <td><b>${SESSION_RATINGS[s.rating]}</b><br><small>${SIZE_BANDS[s.size]}${s.surface != null ? ' · ' + SURFACES[s.surface].toLowerCase() : ''}</small></td>
      <td><b>${fmt(half(f.model))}</b> ${LEVELS[levelOf(half(f.model))]}<br><small>${SIZE_BANDS[f.size]}${f.surface != null ? ' · ' + SURFACES[f.surface].toLowerCase() : ''}</small></td>
      <td class="diff">${signed(d)}<br><small>${Math.abs(d) < 1.5 ? 'about right' : d > 0 ? 'better than forecast' : 'worse than forecast'}</small></td></tr>`;
  }).join('')}</tbody></table>`;
}

/* ---------- What it likes ---------- */
const PERIODS = ['under 9 s', '9–11 s', '11–13 s', '13–15 s', '15 s and up'];
const periodBin = (p) => PERIODS[p < 9 ? 0 : p < 11 ? 1 : p < 13 ? 2 : p < 15 ? 3 : 4];
function groupsFor(c) {
  return [
    { title: 'Swell from', order: COMPASS, of: (k) => (k.d == null ? null : dirName(k.d)) },
    { title: 'Size at the beach', order: SIZE_BANDS, of: (k) => { const f = faceRange(c, k); return SIZE_BANDS[sizeBand((f[0] + f[1]) / 2)]; } },
    { title: 'Swell period', order: PERIODS, of: (k) => (k.p == null ? null : periodBin(k.p)) },
    { title: 'Wind', order: ['light', 'offshore', 'cross-shore', 'onshore'], of: (k) => (k.ws < 10 ? 'light' : windRel(c, k)) },
    { title: 'Tide', order: ['low', 'mid', 'high'], of: (k) => (k.tn == null ? null : tideWord(k.tn)) },
    ...(view.span >= 60 ? [{ title: 'Month', order: MONTHS, of: (k) => MONTHS[+k.t.slice(5, 7) - 1] }] : []),
  ];
}
function likesHtml() {
  const { c, hours, sessions } = view;
  const day = hours.map((h) => ({ ...h })).filter((k) => k.h != null && !isDark(c, k) && hourOf(k.t) >= 6 && hourOf(k.t) < 20);
  if (!day.length) return '<p class="none">No hours recorded in this period yet.</p>';
  const rows = day.map((k) => ({ k, s: score(c, k) })).filter((x) => x.s);
  const sess = sessions.map((s) => ({ s, m: midHour(s) })).filter((x) => x.m).map((x) => ({ k: { t: x.m.t, ...x.m.k }, v: reported(x.s) }));
  return `<div class="likes">${groupsFor(c).map((g) => {
    const lines = g.order.map((b) => {
      const hs = rows.filter((x) => g.of(x.k) === b), ss = sess.filter((x) => g.of(x.k) === b);
      return { b, n: hs.length, m: avg(hs.map((x) => x.s.total)), sn: ss.length, sm: avg(ss.map((x) => x.v)) };
    }).filter((l) => l.n >= 3 || l.sn);
    if (!lines.length) return '';
    return `<div class="like"><h3>${g.title}</h3>${lines.map((l) => `<div class="lrow" title="${esc(`${l.b}: forecast ${l.m == null ? '–' : fmt(half(l.m))} over ${l.n} h${l.sn ? `; surfers ${fmt(half(l.sm))} over ${l.sn} session${l.sn === 1 ? '' : 's'}` : ''}`)}">
      <span class="lab">${esc(l.b)}</span>
      <span class="track">${l.m != null ? `<i style="width:${(l.m * 10).toFixed(1)}%"></i>` : ''}${l.sn ? `<u style="left:${(l.sm * 10).toFixed(1)}%"></u>` : ''}</span>
      <span class="n">${l.m != null ? fmt(half(l.m)) : '–'} · ${l.n} h${l.sn ? ` · ${l.sn} sess.` : ''}</span>
    </div>`).join('')}</div>`;
  }).join('')}</div>`;
}

/* ---------- What sessions have taught it ---------- */
const FEATURE_LABEL = {
  bias: 'Overall', 'tide:low': 'Low tide', 'tide:mid': 'Mid tide', 'tide:high': 'High tide',
  'wind:light': 'Light wind', 'wind:off': 'Offshore wind', 'wind:cross': 'Cross-shore wind', 'wind:on': 'Onshore wind',
  'size:small': 'Smaller than it likes', 'size:in': 'In its size range', 'size:big': 'Bigger than it likes',
  'period:short': 'Short period', 'period:mid': 'Mid period', 'period:long': 'Long period',
  'dir:in': 'Swell in its window', 'dir:near': 'Swell near its window', 'dir:out': 'Swell outside its window',
};
function taughtHtml() {
  const L = sharedSkill && sharedSkill.learned;
  const spot = L && L.spots && L.spots[view.c.id], coast = L && L.coast;
  const chips = (w) => Object.entries(w || {}).filter(([, v]) => Math.abs(v) >= 0.1).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .map(([f, v]) => `<span>${esc(FEATURE_LABEL[f] || f)} <b>${v > 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}</b></span>`).join('');
  const intro = '<p class="sub">After each update the forecast is fitted to the sessions: where surfers keep finding it better or worse than scored in certain conditions, it adds or takes points there. Corrections for this spot need at least three sessions here; the coast-wide ones learn from every spot.</p>';
  if (spot && spot.n >= 3 && chips(spot.w)) return intro + `<p class="sub">Here, from ${spot.n} sessions:</p><div class="taught">${chips(spot.w)}</div>`;
  if (coast && coast.n >= 1 && chips(coast.w)) return intro + `<p class="sub">Not enough sessions here yet${spot ? ` (${spot.n})` : ''}; coast-wide, from ${coast.n} session${coast.n === 1 ? '' : 's'}${coast.n < 15 ? ' (applied once there are 15)' : ''}:</p><div class="taught">${chips(coast.w)}</div>`;
  return intro + '<p class="none">Nothing learned yet: it starts once sessions are logged.</p>';
}

/* ---------- Wiring ---------- */
out.addEventListener('click', (e) => {
  const b = e.target.closest('.cal button[data-date]');
  if (b) {
    for (const x of out.querySelectorAll('.cal button[aria-pressed="true"]')) x.setAttribute('aria-pressed', 'false');
    b.setAttribute('aria-pressed', 'true');
    $('pick').innerHTML = dayText(b.dataset.date);
    return;
  }
  const p = e.target.closest('[data-i]');
  if (p) {
    const i = p.dataset.i;
    for (const x of out.querySelectorAll('.on')) x.classList.remove('on');
    for (const x of out.querySelectorAll(`[data-i="${i}"]`)) x.classList.add('on');
    const row = out.querySelector(`tr[data-i="${i}"]`);
    if (row) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
});
spotSel.addEventListener('change', load);
spanSel.addEventListener('change', () => { store.set('surf-ins-span', spanSel.value); load(); });
$('units').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-units]');
  if (!b) return;
  units = b.dataset.units === 'ft' ? 'ft' : 'm';
  for (const x of $('units').querySelectorAll('button')) x.setAttribute('aria-pressed', x.dataset.units === units);
  store.set('surf-units', units);
  if (view) render();
});
for (const x of $('units').querySelectorAll('button')) x.setAttribute('aria-pressed', x.dataset.units === units);
load();
