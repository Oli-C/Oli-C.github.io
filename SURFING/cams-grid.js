/* The cams grid: directions to a spot, the tiles grouped by area (and the
   Order menu), live streaming tiles, and cams found offline. */

/* ---------- Directions: one button, then choose the app ---------- */

const PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2"/></svg>';
const goButton = (c) => `<button class="nav" type="button" data-go="${esc(c.id)}">${PIN_SVG}Directions</button>`;

function openGo(c) {
  const ll = `${c.lat},${c.lng}`;
  clearTimeout(goTimer);
  $('go-sub').textContent = `${c.name} · ${c.town}`;
  $('go-list').innerHTML = [
    ['Google Maps', `https://www.google.com/maps/dir/?api=1&destination=${ll}`, '#4285f4'],
    ['Apple Maps', `https://maps.apple.com/?daddr=${ll}&dirflg=d`, '#8e8e93'],
    ['Waze', `https://waze.com/ul?ll=${ll}&navigate=yes`, '#33ccff'],
  ].map(([name, url, dot]) =>
    `<a class="go-opt" href="${url}" target="_blank" rel="noopener noreferrer"><i style="background:${dot}"></i>${name}<small>Open</small></a>`
  ).join('');
  go.hidden = false;
  requestAnimationFrame(() => go.classList.add('open'));
  $('go-list').querySelector('a').focus();
}
function closeGo() {
  if (go.hidden) return;
  go.classList.remove('open');
  goTimer = setTimeout(() => { go.hidden = true; }, 200);
}

/* ---------- Grid, grouped by area ---------- */

function renderChips() {
  chips.innerHTML = ['All', ...AREAS].map((r) =>
    `<button class="chip" type="button" data-area="${esc(r)}" aria-pressed="${r === area}">${esc(r)}</button>`
  ).join('');
}

// The tile is the preview; name, place and conditions overlay the bottom.
// Spots without a camera (type 'none') stay out of the grid; they're on
// the map, in Best right now and on the 7-day page.
const noCam = (c) => c.type === 'none';
const cardHtml = (c) => `
  <button class="cam" type="button" data-id="${esc(c.id)}" aria-label="Watch ${esc(c.name)}, ${esc(c.town)}">
    ${c.thumb ? `<img src="${esc(thumbUrl(c.thumb))}" alt="" loading="lazy" decoding="async" onload="this.classList.add('ready')" onerror="this.remove()">` : ''}
    ${c.type === 'hls' ? `<video muted playsinline preload="none"${c.poster ? ` poster="${esc(c.poster)}"` : ''} aria-hidden="true"></video>` : ''}
    <span class="live"><i></i>Live</span>
    <span class="off" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M15 15v2a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h2m4 0h4a1 1 0 0 1 1 1v3l5-3v9"/></svg><span class="t-off">Camera offline</span><span class="t-blk">Plays on ${esc(sourceName(c))} only</span></span>
    <span class="score-slot">${badge(c)}</span>
    <div class="overlay">
      <div class="name">${esc(c.name)}</div>
      <div class="sub">
        <span class="cond-line">${condText(c)}</span>
        <span class="mini-slot">${miniBars(c)}</span>
      </div>
    </div>
  </button>`;

// Where you are, once known (Order: nearest).
let here = null;
const kmFrom = (c) => (here ? km(here.lat, here.lng, c.lat, c.lng) : null);

// Built once; conditions are patched in later so the tiles keep streaming.
function renderGrid() {
  grid.innerHTML = `
    <section class="area" data-area="__mine" hidden>
      <div class="area-head">
        <h2>My spots<small></small></h2>
        <div class="area-sum"><a class="edit-mine" href="account.html#spots">Edit my spots</a></div>
      </div>
      <div class="cards"></div>
    </section>` + AREAS.map((a) => {
    const list = CAMS.filter((c) => c.area === a && !noCam(c));
    if (!list.length) return '';
    return `
    <section class="area" data-area="${esc(a)}">
      <div class="area-head">
        <h2>${esc(a)}<small>${list.length} cam${list.length === 1 ? '' : 's'}</small></h2>
        <div class="area-sum"></div>
      </div>
      <div class="cards">${list.map(cardHtml).join('')}</div>
    </section>`;
  }).join('');
}

function patchConditions() {
  for (const el of cards()) {
    const c = byId(el.dataset.id);
    el.querySelector('.score-slot').innerHTML = badge(c);
    el.querySelector('.cond-line').innerHTML = condText(c);
    el.querySelector('.mini-slot').innerHTML = miniBars(c);
  }
  if (order === 'best') { reorder(); applyFilter(); }
  const coast = coastTides();
  for (const sec of grid.querySelectorAll('.area:not([data-area="__mine"])')) {
    const best = CAMS.filter((c) => c.area === sec.dataset.area && !noCam(c))
      .map((c) => ({ c, r: scoreOf(c) })).filter((x) => x.r && !x.r.dark)
      .sort((x, y) => y.r.total - x.r.total)[0];
    // Only areas whose tide strays from the coast-wide line get their own.
    const ev = areaTides(sec.dataset.area);
    const tide = tidesDiffer(ev, coast) ? tideTimes(ev) : '';
    sec.querySelector('.area-sum').innerHTML =
      (tide ? `<span class="tide-sum">Tide here: ${esc(tide)}</span>` : '') +
      (best ? `<span>Best now: <b>${esc(best.c.name)}</b> · ${fmt(best.r.total)}/10</span>` : '');
  }
  // One coast-wide tide line in the header, averaged across every cam.
  const tideEl = $('tide-now');
  if (coast) {
    const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
    const ahead = coast.filter((e) => e.mins >= nowMins);
    const list = ahead.length ? ahead : coast;
    tideEl.hidden = false;
    tideEl.innerHTML = `<span class="k">${ahead.length ? 'Tide' : 'Tide today'}</span>` + list.map((e) => `<span>${e.kind} ${e.t}</span>`).join('');
  } else {
    tideEl.hidden = true;
  }
  const bestEl = $('best');
  const night = CAMS.some((c) => { const r = scoreOf(c); return r && r.dark; });
  if (night) {
    // Dark: the strip looks ahead to tomorrow morning (06–12, in daylight).
    const morn = CAMS.map((c) => {
      const hs = ((conditions[c.id] && conditions[c.id].tomorrow) || []).filter((k) => !isDark(c, k) && hourOf(k.t) >= 6 && hourOf(k.t) < 12);
      const ts = hs.map((k) => score(c, k)).filter(Boolean).map((r) => r.total);
      return { c, s: ts.length ? Math.round(ts.reduce((a, b) => a + b, 0) / ts.length * 2) / 2 : null };
    }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 3);
    bestEl.hidden = !morn.length;
    bestEl.innerHTML = morn.length
      ? `<span class="best-label">Tomorrow morning</span>` + morn.map(({ c, s }) =>
          `<button class="best-chip" type="button" data-open="${esc(c.id)}"><span class="score lvl-${levelOf(s)}"><b>${fmt(s)}</b><small>${LEVELS[levelOf(s)]}</small></span><span>${esc(c.name)}</span></button>`).join('')
      : '';
    return;
  }
  const top = CAMS.map((c) => ({ c, r: scoreOf(c) })).filter((x) => x.r && x.r.total > 0)
    .sort((x, y) => y.r.total - x.r.total).slice(0, 3);
  bestEl.hidden = !top.length;
  bestEl.innerHTML = top.length
    ? `<span class="best-label">Best right now</span>` + top.map(({ c }) =>
        `<button class="best-chip" type="button" data-open="${esc(c.id)}">${badge(c)}<span>${esc(c.name)}</span></button>`).join('')
    : '';
}

function applyFilter() {
  let shown = 0;
  for (const sec of grid.querySelectorAll('.area')) {
    let n = 0;
    for (const el of sec.querySelectorAll('.cam')) {
      const ok = matches(byId(el.dataset.id));
      el.hidden = !ok;
      if (ok) n++;
    }
    sec.hidden = n === 0;
    sec.dataset.count = n;
    sec.querySelector('h2 small').textContent = `${n} cam${n === 1 ? '' : 's'}`;
    shown += n;
  }
  layout.classList.toggle('filtered', area !== 'All' || !!q.value.trim());
  empty.classList.toggle('show', shown === 0 && effectiveView() !== 'map');
  if (map) syncMarkers(true);
  syncTiles();
}

/* ---------- Live tiles ---------- */

// Every HLS card streams while it's on screen (muted, lowest rendition).
// Off-screen, hidden-tab, data-saver and over-budget tiles fall back to
// their snapshot.
function startTile(c) {
  const t = tiles[c.id];
  if (!t || t.active || t.dead) return;
  const video = t.video;
  t.active = true;
  video.muted = true;
  const card = video.closest('.cam');
  // A stream that never gets to playing counts as a failure too, unless
  // it did load (the browser just refused to autoplay it: iOS Low Power
  // Mode does that), in which case the tile keeps its snapshot.
  let stall = 0, refused = false;
  const arm = () => {
    clearTimeout(stall);
    stall = setTimeout(() => { if (!refused && video.readyState < 1) fail(); }, 30000);
  };
  const play = () => video.play().catch((e) => { if (e && e.name === 'NotAllowedError') refused = true; });
  const onPlaying = () => { clearTimeout(stall); video.classList.add('ready'); card.classList.add('streaming'); };
  video.addEventListener('playing', onPlaying);
  t.cleanup = () => { clearTimeout(stall); video.removeEventListener('playing', onPlaying); };
  // A spot with an `alt` stream (same cam from another host) gets one
  // more go on that before the tile is written off.
  let src = c.embed;
  const fail = () => {
    if (!t.active) return;
    if (c.alt && src !== c.alt) { src = c.alt; arm(); return load(); }
    markOffline(c.id, 'play');
  };
  arm();
  const load = () => {
    if (nativeHls) {
      video.addEventListener('error', fail, { once: true });
      video.src = src;
      play();
      return;
    }
    if (!window.Hls || !Hls.isSupported()) { t.active = false; return; }
    if (t.hls) { try { t.hls.destroy(); } catch {} }
    t.hls = new Hls(TILE_HLS);
    t.hls.on(Hls.Events.ERROR, (_, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && t.hls) return t.hls.recoverMediaError();
      fail();
    });
    t.hls.on(Hls.Events.MANIFEST_PARSED, play);
    t.hls.loadSource(src);
    t.hls.attachMedia(video);
  };
  load();
}

function stopTile(id) {
  const t = tiles[id];
  if (!t || !t.active) return;
  if (t.hls) { try { t.hls.destroy(); } catch {} t.hls = null; }
  if (t.cleanup) { t.cleanup(); t.cleanup = null; }
  t.video.pause();
  t.video.removeAttribute('src');
  t.video.load();
  t.video.classList.remove('ready');
  t.video.closest('.cam').classList.remove('streaming');
  t.active = false;
}

// Reconcile every tile with what should be playing right now.
function syncTiles() {
  let budget = MAX_TILES;
  const listShown = effectiveView() !== 'map';
  for (const c of CAMS) {
    const t = tiles[c.id];
    if (!t) continue;
    const want = !dataSaver && listShown && t.visible && !t.hold && !document.hidden && matches(c) && budget > 0;
    if (want) { budget--; startTile(c); } else stopTile(c.id);
  }
}

/* ---------- Offline cams ----------
   Every stream's playlist is checked on load (a few hundred bytes each),
   so dead cams are known even in map view or with data saver on. A dead
   cam drops to the end of its area with an offline card; an area with
   nothing live drops to the end of the list. Cams found down by the check
   are re-checked every few minutes; one whose tile failed to play stays
   down until reload, so it can't flap. A 401/403 isn't "offline": the
   host refuses this site (MEO's auth-beachcam paths want a signed token
   their own player fetches), so the card says where it does play. */
const offline = new Map();   // id -> 'probe' | 'play' | 'blocked'

/* How the cams are ordered (Order, in the toolbar's options): by area
   (the list's own order), nearest to you (asks for your location once),
   best right now, or your spots first, in your order (account.js; set on
   the 7-day page), in a section of their own. Dead cams sink to the end
   of their group whatever the order; an area with nothing live, to the
   end of the list. Cards only move when the order really changes, as
   moving a playing video stops it. */
let order = (() => { try { return localStorage.getItem('surf-order') || ''; } catch { return ''; } })() || (Account.favs.list().length ? 'mine' : 'area');
function spotRank(c) {
  const dead = offline.has(c.id) ? 1e6 : 0;
  if (order === 'near' && here) return dead + kmFrom(c);
  if (order === 'best') { const r = scoreOf(c); return dead - (r ? (r.dark ? r.lit || 0 : r.total) : -1); }
  if (order === 'mine') { const i = Account.favs.list().indexOf(c.id); if (i >= 0) return dead + i; }
  return dead + 1000 + CAMS.indexOf(c);
}
// Put `els` in `box` in that order, touching only what's out of place.
function arrange(box, els) {
  els.forEach((el, i) => { if (box.children[i] !== el) box.insertBefore(el, box.children[i] || null); });
}
function reorder() {
  const favs = order === 'mine' ? Account.favs.list() : [];
  const secOf = (c) => grid.querySelector(favs.includes(c.id) ? '.area[data-area="__mine"]' : `.area[data-area="${CSS.escape(c.area)}"]`);
  const bySec = new Map();
  for (const el of cards()) { const sec = secOf(byId(el.dataset.id)); if (!bySec.has(sec)) bySec.set(sec, []); bySec.get(sec).push(el); }
  for (const sec of grid.querySelectorAll('.area')) {
    const els = (bySec.get(sec) || []).sort((a, b) => spotRank(byId(a.dataset.id)) - spotRank(byId(b.dataset.id)));
    arrange(sec.querySelector('.cards'), els);
  }
  const secRank = (sec) => {
    if (sec.dataset.area === '__mine') return -1e9;
    const cs = (bySec.get(sec) || []).map((el) => byId(el.dataset.id));
    if (!cs.length) return 1e9;
    const live = cs.some((c) => !offline.has(c.id)) ? 0 : 1e7;
    return live + (order === 'near' && here || order === 'best' ? Math.min(...cs.map(spotRank)) : AREAS.indexOf(sec.dataset.area));
  };
  arrange(grid, [...grid.querySelectorAll(':scope > .area')].sort((a, b) => secRank(a) - secRank(b)));
}
// Where you are, for Order: nearest. Remembered for half an hour.
function locate() {
  try { const l = JSON.parse(localStorage.getItem('surf-here') || 'null'); if (l && Date.now() - l.t < 30 * 60e3) return Promise.resolve(l); } catch {}
  return new Promise((ok, no) => {
    if (!navigator.geolocation) return no(new Error('no location here'));
    navigator.geolocation.getCurrentPosition((p) => {
      const l = { lat: p.coords.latitude, lng: p.coords.longitude, t: Date.now() };
      try { localStorage.setItem('surf-here', JSON.stringify(l)); } catch {}
      ok(l);
    }, no, { maximumAge: 10 * 60e3, timeout: 15000 });
  });
}
function setOrder(o) {
  order = o;
  $('order').value = o;
  try { localStorage.setItem('surf-order', o); } catch {}
  if (o === 'near' && !here) {
    const opt = $('order').querySelector('option[value="near"]');
    opt.textContent = 'Nearest (finding you…)';
    locate().then((l) => { here = l; opt.textContent = 'Nearest to me'; patchConditions(); reorder(); applyFilter(); })
      .catch(() => { opt.textContent = 'Nearest (location off)'; setOrder('area'); });
  }
  reorder();
  applyFilter();
}
$('order').addEventListener('change', (e) => setOrder(e.target.value));
Account.favs.onChange(() => { if (order === 'mine') { reorder(); applyFilter(); } });

function markOffline(id, why) {
  const cur = offline.get(id);
  if (cur === why || (cur && why === 'probe')) return;   // a re-check never downgrades
  offline.set(id, why);
  const t = tiles[id];
  if (t) { stopTile(id); t.dead = true; }
  const el = grid.querySelector(`.cam[data-id="${CSS.escape(id)}"]`);
  if (el) {
    el.classList.add('offline');
    el.classList.toggle('blocked', why === 'blocked');
    el.title = why === 'blocked' ? `Only plays on ${sourceName(byId(id))} for now` : 'Camera offline right now';
  }
  reorder();
  syncTiles();
}

function markOnline(id) {
  if (offline.get(id) !== 'probe') return;
  offline.delete(id);
  if (tiles[id]) tiles[id].dead = false;
  const el = grid.querySelector(`.cam[data-id="${CSS.escape(id)}"]`);
  if (el) { el.classList.remove('offline'); el.removeAttribute('title'); }
  reorder();
  syncTiles();
}

// Is the stream up? A readable error or a non-playlist means down. A CORS
// block only settles it where hls.js would hit the same wall: Safari plays
// HLS natively without CORS, so there a hidden <video> gets the last word.
async function probe(url) {
  try {
    const r = await fetch(url, { cache: 'no-store' });
    if (r.status === 401 || r.status === 403) return 'blocked';
    return r.ok && (await r.text()).includes('#EXTM3U') ? 'up' : 'down';
  } catch {
    if (!nativeHls) return 'down';
    return new Promise((res) => {
      const v = document.createElement('video');
      let settled = false;
      const done = (state) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        v.removeAttribute('src');
        v.load();
        res(state);
      };
      // iOS may not load metadata on a hidden video at all, so silence
      // proves nothing; only a real error counts as down.
      const timer = setTimeout(() => done('unknown'), 15000);
      v.muted = true;
      v.preload = 'metadata';
      v.addEventListener('loadedmetadata', () => done('up'), { once: true });
      v.addEventListener('error', () => done('down'), { once: true });
      v.src = url;
    });
  }
}

async function checkCam(c) {
  if (c.type !== 'hls' || offline.get(c.id) === 'play') return;
  let s = await probe(c.embed);
  if (s !== 'up' && c.alt && (await probe(c.alt)) === 'up') s = 'up';
  if (s === 'up') markOnline(c.id);
  else if (s === 'blocked') markOffline(c.id, 'blocked');
  else if (s === 'down') markOffline(c.id, 'probe');
}

function setupTiles() {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const t = tiles[e.target.dataset.id];
      if (t) t.visible = e.isIntersecting;
    }
    syncTiles();
  }, { rootMargin: '200px 0px' });
  for (const el of cards()) {
    const video = el.querySelector('video');
    if (!video) continue;
    tiles[el.dataset.id] = { video, hls: null, visible: false, active: false, hold: false, dead: offline.has(el.dataset.id) };
    io.observe(el);
  }
  document.addEventListener('visibilitychange', syncTiles);
}
