/* Wiring and start-up: events, views, the first render and the timers.
   Loaded last, once everything it starts is defined. */

/* ---------- Wiring ---------- */

grid.addEventListener('click', (e) => {
  const card = e.target.closest('.cam');
  if (card) open(card.dataset.id);
});
grid.addEventListener('mouseover', (e) => { const card = e.target.closest('.cam'); if (card) hotPin(card.dataset.id, true); });
grid.addEventListener('mouseout',  (e) => { const card = e.target.closest('.cam'); if (card) hotPin(card.dataset.id, false); });
$('best').addEventListener('click', (e) => {
  const b = e.target.closest('[data-open]');
  if (b) open(b.dataset.open);
});
// Any Directions button, anywhere (viewer panels, map popups).
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-go]');
  if (b) { e.preventDefault(); openGo(byId(b.dataset.go)); }
});
go.addEventListener('click', (e) => { if (e.target === go || e.target.closest('.go-opt') || e.target.closest('#go-cancel')) closeGo(); });
chips.addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  area = chip.dataset.area;
  for (const b of chips.children) b.setAttribute('aria-pressed', b === chip);
  applyFilter();
});
q.addEventListener('input', applyFilter);
$('view-seg').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-view]');
  if (b) setView(b.dataset.view);
});
wide.addEventListener('change', () => setView(view));
const saver = $('saver');
function setSaver(on) {
  dataSaver = on;
  saver.setAttribute('aria-checked', on);
  try { localStorage.setItem('surf-saver', on ? '1' : '0'); } catch {}
  syncTiles();
}
saver.addEventListener('click', () => setSaver(!dataSaver));
saver.setAttribute('aria-checked', dataSaver);
// Units: redraw everything that prints a height.
function setUnits(u) {
  units = u === 'ft' ? 'ft' : 'm';
  for (const b of $('units').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.units === units);
  try { localStorage.setItem('surf-units', units); } catch {}
  patchConditions();
  if (map) { map.closePopup(); hideMapCard(); }
  if (!viewer.hidden && location.hash) {
    const c = byId(location.hash.slice(1));
    if (c) { renderScore(c); renderSrc(c); renderToday(c); renderLocal(c); }
  }
}
$('units').addEventListener('click', (e) => { const b = e.target.closest('button[data-units]'); if (b) setUnits(b.dataset.units); });
for (const b of $('units').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.units === units);
$('v-close').addEventListener('click', () => close());
viewer.addEventListener('click', (e) => { if (e.target === viewer) close(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!go.hidden) closeGo(); else close(); }
  else if (e.key === '/' && document.activeElement !== q && viewer.hidden) { e.preventDefault(); q.focus(); }
});
window.addEventListener('popstate', () => {
  const id = location.hash.slice(1);
  id ? open(id, false) : close(false);
});

// The height you can actually see, browser bars and keyboard taken off;
// the phone map is sized to it so nothing hides under the bottom bar.
const vv = window.visualViewport;
if (vv) {
  const setVvh = () => document.documentElement.style.setProperty('--vvh', Math.round(vv.height) + 'px');
  vv.addEventListener('resize', setVvh);
  setVvh();
}

// The sticky map sits just under the sticky controls, whatever their height.
const controls = $('controls');
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--controls-h', controls.offsetHeight + 'px');
  if (map) map.invalidateSize();
}).observe(controls);

// The ⋯ menu and Enter-folds-search come from toolbar.js. The header is
// gone at every width; its tide line and best-right-now ride in the
// toolbar's info line.
$('m-info').append($('tide-now'), $('best'));

renderChips();
renderGrid();
setOrder(order);
const VIEWS = ['grid', 'split', 'map'];
let tabView = '', savedView = '';
try { tabView = sessionStorage.getItem('surf-view') || ''; savedView = localStorage.getItem('surf-view') || ''; } catch {}
// ?view= (the 16-day page's Cams / Split / Map buttons) wins, then the
// address is tidied so a refresh falls back to the remembered view.
const urlView = new URLSearchParams(location.search).get('view');
if (VIEWS.includes(urlView)) {
  tabView = urlView;
  history.replaceState(history.state, '', location.pathname + location.hash);
}
setView(VIEWS.includes(tabView) ? tabView
  : phone.matches ? 'grid'
  : VIEWS.includes(savedView) ? savedView : wide.matches ? 'split' : 'grid');
if (location.hash) open(location.hash.slice(1), false);

// Tiles start streaming as soon as hls.js is in (Safari needs nothing).
(nativeHls ? Promise.resolve() : loadScript(LIBS.hls)).then(setupTiles, setupTiles);

// Which cams are actually up; down ones are re-checked every 5 minutes.
CAMS.forEach(checkCam);
setInterval(() => { for (const [id, why] of offline) if (why === 'probe') checkCam(byId(id)); }, 5 * 60 * 1000);

// Shared model skill first (so the blend is weighted), then conditions;
// both arrive after first paint and patch what depends on them. An open
// page keeps current: every 10 minutes, and on coming back to the tab.
let condAt = 0;
function refreshConditions() {
  condAt = Date.now();
  return loadSharedSkill().then(loadConditions).then(() => {
    patchConditions();
    refreshPins();
    if (!viewer.hidden && location.hash) {
      const c = byId(location.hash.slice(1).split('@')[0]);
      if (c) { renderScore(c); renderFb(c); renderSrc(c); renderToday(c); renderLocal(c); renderTune(c); }
    }
  });
}
refreshConditions();
setInterval(() => { if (!document.hidden) refreshConditions(); }, 10 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden && Date.now() - condAt > 10 * 60 * 1000) refreshConditions(); });
