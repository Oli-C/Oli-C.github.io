/* Tune mode (?tune): sliders for a spot's local knowledge, saved on this
   device, and the verdict log. */

/* ---------- Tune mode (?tune) ---------- */

const TUNE = /[?&]tune\b/.test(location.search);
const TUNE_FIELDS = [
  { key: 'swell', i: 0, label: 'Swell window from', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'swell', i: 1, label: 'Swell window to', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'size', i: 0, label: 'Size min', min: 0.2, max: 4, step: 0.1, unit: ' m' },
  { key: 'size', i: 1, label: 'Size max', min: 0.5, max: 6, step: 0.1, unit: ' m' },
  { key: 'period', label: 'Gets good at', min: 6, max: 16, step: 0.5, unit: ' s' },
  { key: 'exposure', label: 'Exposure floor', min: 0.2, max: 1, step: 0.05, unit: '', def: 0.85 },
  { key: 'gain', label: 'Gain', min: 0.6, max: 1.8, step: 0.05, unit: '×', def: 1 },
  { key: 'wind', i: 0, label: 'Offshore from', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'wind', i: 1, label: 'Offshore to', min: 0, max: 360, step: 5, unit: '°' },
  { key: 'tide', sub: 'range', i: 0, label: 'Tide min', min: 0, max: 1, step: 0.05, unit: '' },
  { key: 'tide', sub: 'range', i: 1, label: 'Tide max', min: 0, max: 1, step: 0.05, unit: '' },
];
const getF = (b, f) => (f.sub ? b[f.key][f.sub][f.i] : f.i != null ? b[f.key][f.i] : (b[f.key] == null ? f.def : b[f.key]));
const setF = (b, f, v) => { if (f.sub) b[f.key][f.sub][f.i] = v; else if (f.i != null) b[f.key][f.i] = v; else b[f.key] = v; };
const tuneExport = () => { const o = {}; for (const c of CAMS) { const t = TUNE_OVERRIDES[c.id]; if (t && Object.keys(t).length) o[c.id] = t; } return JSON.stringify(o, null, 2); };
// Verdicts for this spot, summarised by what the sea was doing.
function fbSummary(c) {
  const mine = loadFb().filter((e) => e.id === c.id);
  if (!mine.length) return 'No verdicts yet for this spot. Use the buttons above as you watch the cam.';
  const by = (v) => mine.filter((e) => e.verdict === v);
  const mean = (arr, fn) => (arr.length ? arr.reduce((a, e) => a + fn(e), 0) / arr.length : null);
  const line = (label, arr) => (arr.length ? `<b>${label}</b> ×${arr.length}: swell ${hgt(mean(arr, (e) => e.k.h))} at ${Math.round(mean(arr, (e) => e.k.p))} s, wind ${kts(mean(arr, (e) => e.k.ws))} kts, scored ${fmt(Math.round(mean(arr, (e) => e.total) * 2) / 2)}` : '');
  const hints = [];
  const hi = by('high'), lo = by('low');
  if (hi.length >= 2 && lo.length >= 2) {
    const hH = mean(hi, (e) => e.k.h), lH = mean(lo, (e) => e.k.h);
    if (hH > lH + 0.3) hints.push('Marked too high mostly in bigger swell → try lowering Size max or the exposure floor.');
    if (lH > hH + 0.3) hints.push('Marked too low mostly in bigger swell → try raising Size max or gain.');
    const hP = mean(hi, (e) => e.k.p), lP = mean(lo, (e) => e.k.p);
    if (lP > hP + 1.5) hints.push('Longer-period days read too low → try lowering "Gets good at".');
  } else if (hi.length >= 3 && !lo.length) hints.push('Consistently too high → the spot likely needs a lower exposure floor or a narrower swell window.');
  else if (lo.length >= 3 && !hi.length) hints.push('Consistently too low → the spot likely needs a wider swell window or higher exposure.');
  return [line('Too high', hi), line('About right', by('ok')), line('Too low', lo), ...hints.map((h) => `→ ${h}`)].filter(Boolean).join('<br>');
}
function renderTune(c) {
  const el = $('v-tune');
  if (!TUNE) { el.hidden = true; return; }
  const b = c.best;
  el.hidden = false;
  el.innerHTML = `
    <div class="today-head"><span class="k">Tune ${esc(c.name)}</span><span class="fb-note">changes apply live and are kept on this device · paste "Copy feedback log" into SURFING/data/feedback.json to pool it</span></div>
    <div class="tune-grid">
      ${TUNE_FIELDS.map((f, i) => `<label class="tune-f"><span>${f.label}</span><b data-out="${i}">${getF(b, f)}${f.unit}</b><input type="range" data-i="${i}" min="${f.min}" max="${f.max}" step="${f.step}" value="${getF(b, f)}"></label>`).join('')}
    </div>
    <div class="tune-actions">
      <button class="fb-btn" type="button" data-act="copy">Copy overrides JSON</button>
      <button class="fb-btn" type="button" data-act="reset">Reset this spot</button>
      <button class="fb-btn" type="button" data-act="fb">Copy feedback log</button>
    </div>
    <textarea class="tune-json" readonly spellcheck="false">${esc(tuneExport())}</textarea>
    <div class="tune-sum">${fbSummary(c)}</div>`;
  el.querySelectorAll('input[type="range"]').forEach((inp) => inp.addEventListener('input', () => {
    const f = TUNE_FIELDS[+inp.dataset.i], v = +inp.value;
    setF(b, f, v);
    el.querySelector(`[data-out="${inp.dataset.i}"]`).textContent = v + f.unit;
    const o = TUNE_OVERRIDES[c.id] = TUNE_OVERRIDES[c.id] || {};
    if (f.sub) { o[f.key] = o[f.key] || {}; o[f.key][f.sub] = b[f.key][f.sub].slice(); }
    else if (f.i != null) o[f.key] = b[f.key].slice();
    else o[f.key] = v;
    saveTune();
    el.querySelector('.tune-json').value = tuneExport();
    patchConditions(); refreshPins(); renderScore(c); renderLocal(c);
  }));
  el.querySelector('[data-act="copy"]').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText(tuneExport()));
  el.querySelector('[data-act="fb"]').addEventListener('click', () => navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(loadFb(), null, 1)));
  el.querySelector('[data-act="reset"]').addEventListener('click', () => {
    delete TUNE_OVERRIDES[c.id]; saveTune();
    Object.assign(c.best, JSON.parse(JSON.stringify(BEST_DEFAULTS[c.id])));
    patchConditions(); refreshPins(); renderScore(c); renderLocal(c); renderTune(c);
  });
}

function renderLocal(c) {
  const b = c.best;
  const item = (k, v) => `<span>${k} <b>${v}</b></span>`;
  $('v-local').innerHTML = `
    <div class="today-head"><span class="k">Local knowledge</span></div>
    <div class="local-row">
      ${item('Swell', windowText(b.swell))}
      ${item('Size', rng(b.size[0], b.size[1]))}
      ${item('Period', `${b.period} s+`)}
      ${item('Wind', windowText(b.wind))}
      ${item('Tide', esc(b.tide.text))}
    </div>
    <p class="local-notes">${esc(b.notes)}</p>
    <div class="tags">${(c.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
}

function open(id, push = true) {
  const c = byId(id);
  if (!c) return;
  lastFocus = document.activeElement;
  $('v-name').textContent = c.name;
  $('v-where').textContent = `${c.zone && c.zone !== c.town ? c.zone + ' · ' : ''}${c.town} · ${c.area}`;
  $('v-open').hidden = !c.link;
  if (c.link) $('v-open').href = c.link;
  $('v-go').dataset.go = c.id;
  syncFav(c);
  $('v-foot').innerHTML = noCam(c) ? 'No camera at this spot yet: forecast and local knowledge only.'
    : `Stream by ${esc(c.source)} · <a href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">open original</a>`;
  renderScore(c);
  renderFb(c);
  renderSess(c);
  renderSrc(c);
  renderToday(c);
  renderLocal(c);
  renderTune(c);
  clearTimeout(hideTimer);
  stopPlayback();
  // Don't stream the same cam twice: the tile rests while the viewer plays.
  for (const t of Object.values(tiles)) t.hold = false;
  if (tiles[c.id]) tiles[c.id].hold = true;
  syncTiles();
  frame.className = 'frame ' + (c.type === 'page' ? 'page' : noCam(c) ? 'video nocam' : 'video');
  if (noCam(c)) frame.innerHTML = noCamHtml(c);
  else if (offline.get(c.id) === 'blocked') frameMsg(`This cam only plays on ${sourceName(c)} for now.`, c);
  else if (c.type === 'hls') playHls(c);
  else frame.innerHTML = iframeHtml(c.embed, c);
  viewer.hidden = false;
  viewer.querySelector('.sheet').scrollTop = 0;
  requestAnimationFrame(() => viewer.classList.add('open'));
  document.body.classList.add('locked');
  $('v-close').focus();
  if (push) history.pushState(null, '', '#' + c.id);
}

// Where a spot has no camera, the frame shows a quiet swell line and
// offers the nearest cams.
const NOCAM_ART = '<svg class="nocam-art" viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 26c10 0 10-10 20-10s10 10 20 10 10-10 20-10 10 10 20 10 10-10 20-10 10 10 20 10" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
function noCamHtml(c) {
  const near = CAMS.filter((o) => !noCam(o) && o.id !== c.id).map((o) => ({ o, km: km(c.lat, c.lng, o.lat, o.lng) }))
    .sort((a, b) => a.km - b.km).slice(0, 2).filter((x) => x.km < 25);
  const dist = (d) => (d < 0.95 ? `${Math.round(d * 1000 / 50) * 50} m` : `${d.toFixed(d < 10 ? 1 : 0)} km`);
  return `<div class="frame-msg">${NOCAM_ART}<div><b>No camera at ${esc(c.name)} yet</b>${near.length ? `<span>Nearest cams</span><span class="near">${near.map((x) =>
    `<button class="pop-btn" type="button" data-near="${esc(x.o.id)}">${esc(x.o.name)} <small>${dist(x.km)}</small></button>`).join('')}</span>` : ''}</div></div>`;
}
frame.addEventListener('click', (e) => { const b = e.target.closest('[data-near]'); if (b) open(b.dataset.near); });

// The star: in or out of this person's spots (account.js keeps the list,
// on the account when signed in), which lead the 7-day page.
function syncFav(c) {
  const on = Account.favs.has(c.id), b = $('v-fav');
  b.setAttribute('aria-pressed', on);
  b.title = b.ariaLabel = on ? 'In my spots: tap to remove' : 'Add to my spots (leads the 7-day page)';
}
$('v-fav').addEventListener('click', () => { const c = byId(location.hash.slice(1)) || byId($('v-go').dataset.go); if (c) { Account.favs.toggle(c.id); syncFav(c); } });
Account.favs.onChange(() => { const c = byId($('v-go').dataset.go); if (c && !viewer.hidden) syncFav(c); });
Account.favs.sync();

function close(push = true) {
  if (viewer.hidden) return;
  viewer.classList.remove('open');
  document.body.classList.remove('locked');
  stopPlayback();
  for (const t of Object.values(tiles)) t.hold = false;
  syncTiles();
  hideTimer = setTimeout(() => { viewer.hidden = true; }, 250);
  if (push && location.hash) history.pushState(null, '', location.pathname + location.search);
  if (lastFocus) lastFocus.focus();
}
