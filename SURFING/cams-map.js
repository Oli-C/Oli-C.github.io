/* The map: score pins with swell and wind, decluttering, the wind and swell
   arrows, and the animated particle field. */

/* ---------- Map ---------- */

const REL_SHORT = { offshore: 'off', onshore: 'on', 'cross-shore': 'cross' };
const GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 9h-3.5v11h-5V11H6z"/></svg>';
const windClass = (ws) => (ws < 12 ? 'w0' : ws < 25 ? 'w1' : ws < 40 ? 'w2' : 'w3');
// Everything lives in the pin itself: score segment, then swell (arrow =
// direction of travel, height, period), wind (arrow = blowing to, knots
// coloured off / cross / on) and the day's four bars.
const pinIcon = (c) => {
  const r = scoreOf(c), k = conditions[c.id] && conditions[c.id].now;
  const lvl = r ? (r.dark ? 'lvl-dark' : 'lvl-' + r.level) : 'lvl-x';
  const data = k ? `<span class="d">
      <span class="row swell"><span style="display:inline-flex;--rot:${k.d != null ? Math.round(k.d + 180) : 0}deg">${k.d != null ? GLYPH : ''}</span><em>${hgt(k.h)}</em>${Math.round(k.p)}s</span>
      <span class="row wind ${r ? REL_SHORT[r.wind] : ''}"><span style="display:inline-flex;--rot:${Math.round(k.wd + 180)}deg">${GLYPH}</span><em>${kts(k.ws)}kt</em></span>
      ${miniBars(c)}</span>` : '';
  return L.divIcon({
    className: 'pin-wrap',
    html: `<span class="pin ${lvl}" title="${esc(c.name)}"><span class="sc">${!r ? '·' : r.dark ? (r.lit ? fmt(r.lit) : MOON) : r.total === 0 ? '–' : fmt(r.total)}</span>${data}</span>`,
    iconSize: [0, 0],
    iconAnchor: [0, 0],
    popupAnchor: [0, -14],
  });
};

const popupHtml = (c) => {
  const cond = condText(c);
  const sum = daySummary(c);
  return `
    <div class="pop-head">
      <div>
        <div class="pop-name">${esc(c.name)}</div>
        <div class="pop-where">${esc(c.zone || c.town)} · ${esc(c.area)}</div>
      </div>
      ${badge(c)}
    </div>
    ${cond ? `<div class="pop-cond">Now ${cond} ${miniBars(c)}</div>` : ''}
    ${tideTimes(tidesFor(c)) ? `<div class="pop-sum">Tide: ${esc(tideTimes(tidesFor(c)))}</div>` : ''}
    ${sum ? `<div class="pop-sum">${esc(sum)}</div>` : ''}
    <div class="pop-actions">
      <button class="pop-btn" type="button" data-open="${esc(c.id)}">
        ${noCam(c) ? 'Forecast' : '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>Watch live'}
      </button>
      ${goButton(c)}
    </div>`;
};

// Pin ↔ card: hovering a card lifts its pin; tapping a pin finds its card.
function hotPin(id, on) {
  const el = markers[id] && markers[id].getElement && markers[id].getElement();
  if (el) el.classList.toggle('hot', on);
}
function findCard(id) {
  if (effectiveView() !== 'split') return;
  const el = grid.querySelector(`.cam[data-id="${CSS.escape(id)}"]`);
  if (!el || el.hidden) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1600);
}

function initMap() {
  map = L.map('map', { zoomControl: true, scrollWheelZoom: true, tapTolerance: 20 });
  // Esri satellite by default — the imagery reads the beaches best — with
  // plain OpenStreetMap streets as the alternative. Both keyless.
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
    className: 'osm-tiles',
  });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Imagery &copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics, GIS User Community',
    maxZoom: 19,
  });
  let base = 'sat';
  try { base = localStorage.getItem('surf-base2') || 'sat'; } catch {}
  (base === 'osm' ? osm : sat).addTo(map);
  // Wind and swell overlays: animated particles plus labelled arrows, from
  // the same Open-Meteo data as the scores. Reduced-motion gets arrows only.
  windLayer = L.layerGroup();
  swellLayer = L.layerGroup();
  if (!reducedMotion) {
    const PL = makeParticleLayer();
    const phone = matchMedia('(max-width: 640px)').matches;
    windField = new PL({ max: phone ? 450 : 1400, density: 1800, life: 90, fade: 0.9, width: 1.3, min: 0.5,
      speed: (ws) => 0.25 + ws * 0.045, color: windColor });
    swellField = new PL({ max: phone ? 250 : 700, density: 3600, life: 160, fade: 0.95, width: 1.8, min: 0.15,
      speed: (h) => 0.25 + h * 0.3, color: swellColor });
    loadFieldGrid().then(updateFields);
  }
  let overlays = { wind: true, swell: true };
  try { overlays = { ...overlays, ...JSON.parse(localStorage.getItem('surf-overlays2') || '{}') }; } catch {}
  if (overlays.wind) windLayer.addTo(map);
  if (overlays.swell) swellLayer.addTo(map);
  L.control.layers({ 'Satellite': sat, 'Streets': osm }, { 'Wind': windLayer, 'Swell': swellLayer }, { position: 'topright', collapsed: phone.matches }).addTo(map);
  map.on('baselayerchange', (e) => { try { localStorage.setItem('surf-base2', e.layer === sat ? 'sat' : 'osm'); } catch {} });
  const saveOverlays = () => { try { localStorage.setItem('surf-overlays2', JSON.stringify({ wind: map.hasLayer(windLayer), swell: map.hasLayer(swellLayer) })); } catch {} };
  map.on('overlayadd overlayremove', saveOverlays);
  // "Open in Windy" follows the map.
  const windy = $('windy');
  const syncWindy = () => { const c = map.getCenter(); windy.href = `https://www.windy.com/-Wind-wind?${c.lat.toFixed(3)},${c.lng.toFixed(3)},${Math.max(5, Math.min(11, map.getZoom()))}`; };
  map.on('moveend', syncWindy);
  // Pins show their data segment only once there's room for it.
  const labels = () => map.getContainer().classList.toggle('labels', map.getZoom() >= 11);
  // Pane for the pins' leaders: above the tiles and particles, below the
  // pins (markerPane is 600); hidden while a zoom animates.
  map.createPane('leaders').style.zIndex = 590;
  leaderBox = L.DomUtil.create('div', 'leaders leaflet-zoom-hide', map.getPane('leaders'));
  map.on('zoomend', () => { labels(); declutter(); });
  labels();
  // Keep the map's idea of its size right whenever its box changes
  // (view switches, the toolbar wrapping, the window resizing).
  new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());
  buildArrows();

  // Phones get the bottom card; wider screens the usual popup on the pin.
  for (const c of CAMS) {
    const m = L.marker([c.lat, c.lng], { icon: pinIcon(c), title: c.name, keyboard: true });
    m.on('click', () => {
      if (phone.matches) return showMapCard(c);
      L.popup({ closeButton: false, maxWidth: 340, offset: [0, -14] }).setLatLng(m.getLatLng()).setContent(popupHtml(c)).openOn(map);
      findCard(c.id);
    });
    markers[c.id] = m;
  }
  map.on('click', hideMapCard);
  map.getContainer().addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (b) { map.closePopup(); open(b.dataset.open); }
  });
  syncMarkers(true);
}

const mapCard = $('map-card');
let cardId = null;
function showMapCard(c) {
  if (cardId) hotPin(cardId, false);
  cardId = c.id;
  hotPin(c.id, true);
  mapCard.innerHTML = popupHtml(c) +
    `<button class="map-card-x" type="button" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  mapCard.hidden = false;
  $('map-wrap').classList.add('has-card');
  // Keep the pin clear of the card.
  requestAnimationFrame(() => map.panInside([c.lat, c.lng], { paddingTopLeft: [40, mapTop() + 40], paddingBottomRight: [40, mapCard.offsetHeight + 40] }));
}
function hideMapCard() {
  if (!cardId) return;
  hotPin(cardId, false);
  cardId = null;
  mapCard.hidden = true;
  $('map-wrap').classList.remove('has-card');
}
mapCard.addEventListener('click', (e) => {
  if (e.target.closest('.map-card-x')) return hideMapCard();
  const b = e.target.closest('[data-open]');
  if (b) open(b.dataset.open);
});

// How much of the map's top edge the floating phone toolbar covers.
const mapTop = () => (phone.matches && layout.dataset.view === 'map' ? $('controls').offsetHeight : 0);

// Show only the markers that pass the current filter; optionally refit.
function syncMarkers(fit) {
  const shown = [], home = [];
  for (const c of CAMS) {
    const m = markers[c.id];
    if (matches(c)) {
      if (!map.hasLayer(m)) m.addTo(map);
      shown.push([c.lat, c.lng]);
      if (HOME_AREAS.includes(c.area)) home.push([c.lat, c.lng]);
    } else if (map.hasLayer(m)) map.removeLayer(m);
  }
  if (fit && shown.length) {
    const unfiltered = area === 'All' && !q.value.trim();
    const target = unfiltered && home.length ? home : shown;
    map.fitBounds(target, { paddingTopLeft: [40, mapTop() + 30], paddingBottomRight: [40, 40], maxZoom: 14 });
  }
  declutter();
}

function refreshPins() {
  if (!map) return;
  for (const c of CAMS) markers[c.id].setIcon(pinIcon(c));
  buildArrows();
  declutter();
}

// Cams on the same stretch of beach (Guincho Norte and Sul, the Caparica
// run) put their pins on top of each other. Pins that touch form a group,
// and each group is stacked into a neat column centred on where its spots
// really are, keeping their north-to-south order, so no pin wanders far
// and the stack reads like the coast. A stack can grow into a neighbour,
// so groups that then touch are merged and restacked until nothing
// overlaps. Each pin that moved keeps a leader and a dot on its spot.
const PIN_GAP = 3;
let declutterRaf = 0, leaderBox = null;
function declutter() {
  cancelAnimationFrame(declutterRaf);
  declutterRaf = requestAnimationFrame(() => {
    const items = [];
    for (const c of CAMS) {
      const m = markers[c.id], el = map.hasLayer(m) && m.getElement(), pin = el && el.querySelector('.pin');
      if (!pin) continue;
      pin.style.translate = '';
      const p = map.latLngToLayerPoint(m.getLatLng());
      items.push({ el, pin, x: p.x, y0: p.y, y: p.y, w: pin.offsetWidth, h: pin.offsetHeight });
    }
    const touch = (a, b) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + PIN_GAP && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + PIN_GAP;
    const stack = (g) => {
      g.sort((a, b) => a.y0 - b.y0 || a.x - b.x);
      const total = g.reduce((s, it) => s + it.h, 0) + PIN_GAP * (g.length - 1);
      let y = g.reduce((s, it) => s + it.y0, 0) / g.length - total / 2;
      for (const it of g) { it.y = y + it.h / 2; y += it.h + PIN_GAP; }
    };
    const groups = items.map((it) => [it]);
    for (let guard = 0; guard < 100; guard++) {
      let pair = null;
      for (let i = 0; i < groups.length && !pair; i++) {
        for (let j = i + 1; j < groups.length; j++) {
          if (groups[i].some((a) => groups[j].some((b) => touch(a, b)))) { pair = [i, j]; break; }
        }
      }
      if (!pair) break;
      const [i, j] = pair;
      groups[i].push(...groups[j]);
      groups.splice(j, 1);
      stack(groups[i]);
    }
    // Leaders live in their own pane under all the pins, so a line or
    // dot never paints over a neighbouring pin. A nudge needs none.
    let html = '';
    for (const it of items) {
      const dy = Math.round(it.y - it.y0);
      it.pin.style.translate = dy ? `0 ${dy}px` : '';
      if (Math.abs(dy) < 4) continue;
      const x = Math.round(it.x), y = Math.round(it.y0);
      html += `<i class="leader" style="left:${x - 1}px;top:${y + Math.min(0, dy)}px;height:${Math.abs(dy)}px"></i><b class="leader-dot" style="left:${x - 3}px;top:${y - 3}px"></b>`;
    }
    leaderBox.innerHTML = html;
  });
}

/* ---------- Animated particle field ----------
   A canvas in Leaflet's overlay pane. Each particle reads the local vector
   (inverse-distance blend of the sample points), steps along it, and
   leaves a fading trail — the Windy look, from our own data. */
// Defined lazily, once Leaflet is loaded.
let ParticleLayerClass = null;
function makeParticleLayer() {
  if (ParticleLayerClass) return ParticleLayerClass;
  ParticleLayerClass = L.Layer.extend({
    initialize(opts) { L.setOptions(this, opts); this.samples = []; this._pts = []; this._parts = []; this._raf = 0; },
    onAdd(map) {
      this._map = map;
      this._canvas = L.DomUtil.create('canvas', 'particles leaflet-zoom-hide');
      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on('moveend zoomend resize', this._reset, this);
      this._reset();
      this._start();
    },
    onRemove(map) {
      this._stop();
      map.off('moveend zoomend resize', this._reset, this);
      L.DomUtil.remove(this._canvas);
    },
    setSamples(samples) { this.samples = samples; if (this._map) this._reset(); },
    _reset() {
      const map = this._map, size = map.getSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this._canvas.width = size.x * dpr; this._canvas.height = size.y * dpr;
      this._canvas.style.width = size.x + 'px'; this._canvas.style.height = size.y + 'px';
      L.DomUtil.setPosition(this._canvas, map.containerPointToLayerPoint([0, 0]));
      this._ctx = this._canvas.getContext('2d');
      this._ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._ctx.clearRect(0, 0, size.x, size.y);
      this._w = size.x; this._h = size.y;
      // Project samples to screen space; store velocity as screen-space u,v.
      this._pts = this.samples.map((s) => {
        const p = map.latLngToContainerPoint([s.lat, s.lng]);
        const to = (s.toward) * Math.PI / 180;
        return { x: p.x, y: p.y, u: Math.sin(to) * s.mag, v: -Math.cos(to) * s.mag, mag: s.mag };
      });
      const n = this._pts.length ? Math.min(this.options.max, Math.floor((size.x * size.y) / this.options.density)) : 0;
      this._parts = Array.from({ length: n }, () => this._spawn());
    },
    _spawn() { return { x: Math.random() * this._w, y: Math.random() * this._h, age: Math.floor(Math.random() * this.options.life) }; },
    // Inverse-distance-weighted blend of the sample vectors at (x, y).
    _vel(x, y) {
      let su = 0, sv = 0, sm = 0, sw = 0;
      for (const p of this._pts) {
        const dx = x - p.x, dy = y - p.y;
        const d2 = dx * dx + dy * dy + 400;
        const w = 1 / (d2 * d2);
        su += p.u * w; sv += p.v * w; sm += p.mag * w; sw += w;
      }
      return sw ? { u: su / sw, v: sv / sw, mag: sm / sw } : { u: 0, v: 0, mag: 0 };
    },
    _start() { if (!this._raf) this._raf = requestAnimationFrame(() => this._frame()); },
    _stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; },
    _frame() {
      this._raf = 0;
      if (!this._map) return;
      if (document.hidden || !this._pts.length) { this._raf = requestAnimationFrame(() => this._frame()); return; }
      const ctx = this._ctx, o = this.options;
      // Fade what's there, then draw each particle's next step.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${o.fade})`;
      ctx.fillRect(0, 0, this._w, this._h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = o.width;
      ctx.lineCap = 'round';
      for (const p of this._parts) {
        const v = this._vel(p.x, p.y);
        const speed = o.speed(v.mag);
        const len = Math.hypot(v.u, v.v) || 1;
        const nx = p.x + (v.u / len) * speed, ny = p.y + (v.v / len) * speed;
        ctx.strokeStyle = o.color(v.mag);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
        p.x = nx; p.y = ny; p.age++;
        if (p.age > o.life || nx < 0 || ny < 0 || nx > this._w || ny > this._h || v.mag < o.min) Object.assign(p, this._spawn(), { age: 0 });
      }
      this._raf = requestAnimationFrame(() => this._frame());
    },
  });
  return ParticleLayerClass;
}

// Wind: strength palette (light → gale), brisk short trails.
const windColor = (ws) => (ws < 12 ? 'rgba(158,176,92,0.85)' : ws < 25 ? 'rgba(227,162,58,0.9)' : ws < 40 ? 'rgba(255,130,0,0.95)' : 'rgba(229,72,77,1)');
// Swell: sea blue, slow long streaks, brighter the bigger it is.
const swellColor = (h) => `rgba(79,195,220,${Math.min(0.95, 0.35 + h * 0.2)})`;

// Coarse sample grid along the coast so particles flow between the spots.
// Wind comes back everywhere; swell only over sea cells (land is null).
const GRID = [];
for (let lat = 36.9; lat <= 40.0; lat += 0.3) for (const lng of [-10.3, -9.95, -9.6, -9.25, -8.9]) GRID.push([+lat.toFixed(2), lng]);
async function loadFieldGrid() {
  const key = 'surf-field', today = new Date().toDateString();
  try {
    const c = JSON.parse(localStorage.getItem(key) || 'null');
    if (c && c.day === today && Date.now() - c.t < COND_TTL) { fieldGrid = c.data; return; }
  } catch {}
  const lat = GRID.map((p) => p[0]).join(','), lng = GRID.map((p) => p[1]).join(',');
  try {
    const [w, m] = await Promise.all([
      fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&current=wind_speed_10m,wind_direction_10m`).then((r) => r.json()),
      fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}&current=swell_wave_height,swell_wave_direction,wave_height,wave_direction`).then((r) => r.json()),
    ]);
    const W = asList(w), M = asList(m);
    fieldGrid = GRID.map((p, i) => {
      const wc = W[i] && W[i].current, mc = M[i] && M[i].current;
      return {
        lat: p[0], lng: p[1],
        ws: wc ? wc.wind_speed_10m : null, wd: wc ? wc.wind_direction_10m : null,
        h: mc ? (mc.swell_wave_height ?? mc.wave_height) : null, d: mc ? (mc.swell_wave_direction ?? mc.wave_direction) : null,
      };
    });
    try { localStorage.setItem(key, JSON.stringify({ day: today, t: Date.now(), data: fieldGrid })); } catch {}
  } catch { fieldGrid = []; }
}
// Feed both particle layers from the grid plus the per-spot readings.
function updateFields() {
  if (!windField) return;
  const wind = [], swell = [];
  for (const g of fieldGrid || []) {
    if (g.ws != null && g.wd != null) wind.push({ lat: g.lat, lng: g.lng, toward: g.wd + 180, mag: g.ws });
    if (g.h != null && g.d != null) swell.push({ lat: g.lat, lng: g.lng, toward: g.d + 180, mag: g.h });
  }
  for (const c of CAMS) {
    const k = conditions[c.id] && conditions[c.id].now;
    if (!k) continue;
    const [la, lo] = seaward(c, 4);
    wind.push({ lat: la, lng: lo, toward: k.wd + 180, mag: k.ws });
    if (k.d != null) swell.push({ lat: la, lng: lo, toward: k.d + 180, mag: k.h });
  }
  windField.setSamples(wind);
  swellField.setSamples(swell);
}

// The Wind / Swell overlays are the animated particle fields; the numbers
// live on the pin tags.
function buildArrows() {
  if (!windLayer) return;
  windLayer.clearLayers();
  swellLayer.clearLayers();
  if (windField) { windLayer.addLayer(windField); swellLayer.addLayer(swellField); }
  updateFields();
}

async function showMap() {
  try {
    await loadScript(LIBS.leaflet);
  } catch {
    $('map-hint').textContent = 'Couldn’t load the map.';
    return;
  }
  if (!map) initMap();
  // The pane has just been shown or resized; let layout settle first.
  requestAnimationFrame(() => { map.invalidateSize(); syncMarkers(true); });
}

function setView(v) {
  view = v;
  const ev = effectiveView();
  layout.dataset.view = ev;
  for (const b of $('view-seg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.view === ev);
  // This tab remembers the view through a refresh; desktops also keep it
  // for next time, while phones start a new visit on the cams.
  try { sessionStorage.setItem('surf-view', v); } catch {}
  if (!phone.matches) try { localStorage.setItem('surf-view', v); } catch {}
  applyFilter();
  if (ev !== 'grid') showMap();
}
