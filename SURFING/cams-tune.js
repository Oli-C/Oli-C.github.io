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
