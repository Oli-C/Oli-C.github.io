/* The map: score pins with swell and wind, decluttering, the wind and swell
   arrows, and the animated particle field. */

/* ---------- Map ---------- */

const REL_SHORT = { offshore: 'off', onshore: 'on', 'cross-shore': 'cross' };
const GLYPH = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 9h-3.5v11h-5V11H6z"/></svg>';
const windClass = (ws) => (ws < 12 ? 'w0' : ws < 25 ? 'w1' : ws < 40 ? 'w2' : 'w3');
// Everything lives in the pin itself: score segment, then swell (arrow =
// direction of travel, height, period), wind (arrow = blowing to, knots
// coloured off / cross / on) and the day's four bars.
// The time slider moves the pins too: each spot's forecast hour nearest
// now + fieldHour, from the worker's build (else today and tomorrow), with
// that day's bars.
let pinFc = null;
function pinAt(c) {
  const cond = conditions[c.id];
  if (!fieldHour) return { k: cond && cond.now };
  const s = pinFc && pinFc.spots[c.id];
  const days = s ? s.days : cond ? [{ hours: cond.hours }, { hours: cond.tomorrow || [] }] : [];
  const from = s ? spotNow(s.offset) : cond && cond.now && cond.now.t;
  if (!from) return {};
  const at = Date.parse(from + ':00Z') + fieldHour * 3.6e6;
  let best = null, bestD = 2 * 3.6e6;
  for (const d of days) for (const k of d.hours) {
    const dt = Math.abs(Date.parse(k.t + ':00Z') - at);
    if (dt < bestD) { bestD = dt; best = { k, hs: d.hours }; }
  }
  return best || {};
}
function slidePins() {
  if (!map) return;
  loadWorkerForecast().then((fc) => { pinFc = fc; }, () => {}).then(() => {
    for (const c of CAMS) markers[c.id].setIcon(pinIcon(c));
    declutter();
  });
}

const pinIcon = (c) => {
  const at = pinAt(c), k = at.k, r = k ? score(c, k) : null;
  const lvl = r ? (r.dark ? 'lvl-dark' : 'lvl-' + r.level) : 'lvl-x';
  const data = k ? `<span class="d">
      <span class="row swell"><span style="display:inline-flex;--rot:${k.d != null ? Math.round(k.d + 180) : 0}deg">${k.d != null ? GLYPH : ''}</span><em>${hgt(k.h)}</em>${Math.round(k.p)}s</span>
      <span class="row wind ${r ? REL_SHORT[r.wind] : ''}"><span style="display:inline-flex;--rot:${Math.round(k.wd + 180)}deg">${GLYPH}</span><em>${kts(k.ws)}kt</em></span>
      ${at.hs ? miniBars(c, at.hs, hourOf(k.t)) : miniBars(c)}</span>` : '';
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
  // Wind and swell overlays: animated particles (not with reduced motion),
  // and the swell-height heat map; the worker's grids drive all three.
  windLayer = L.layerGroup();
  swellLayer = L.layerGroup();
  heatLayer = L.imageOverlay('data:image/gif;base64,R0lGODlhAQABAAAAACw=', [[36.8, -10.3], [40.1, -8.5]], { opacity: 0.9, className: 'heat', interactive: false });
  if (!reducedMotion) {
    const PL = makeParticleLayer();
    const phone = matchMedia('(max-width: 640px)').matches;
    windField = new PL({ max: phone ? 450 : 1400, density: 1800, life: 90, fade: 0.9, width: 1.3, min: 0.5,
      speed: (ws) => 0.25 + ws * 0.045, color: windColor });
    swellField = new PL({ max: phone ? 250 : 700, density: 3600, life: 160, fade: 0.95, width: 1.8, min: 0.15,
      speed: (h) => 0.25 + h * 0.3, color: swellColor });
  }
  loadGrids().then(() => { if (grids && grids.swell) heatLayer.setBounds(heatBounds(grids.swell)); updateFields(); });
  let overlays = { wind: true, swell: true, heat: false };
  try { overlays = { ...overlays, ...JSON.parse(localStorage.getItem('surf-overlays2') || '{}') }; } catch {}
  if (overlays.wind) windLayer.addTo(map);
  if (overlays.swell) swellLayer.addTo(map);
  if (overlays.heat) heatLayer.addTo(map);
  L.control.layers({ 'Satellite': sat, 'Streets': osm }, { 'Wind': windLayer, 'Swell': swellLayer, 'Swell height': heatLayer }, { position: 'topright', collapsed: phone.matches }).addTo(map);
  makeTimeControl().addTo(map);
  syncTimeControl();
  // The heat map's key shows while the heat map does.
  const heatKey = () => $('lg-heat').hidden = !map.hasLayer(heatLayer);
  map.on('overlayadd overlayremove', heatKey);
  heatKey();
  map.on('baselayerchange', (e) => { try { localStorage.setItem('surf-base2', e.layer === sat ? 'sat' : 'osm'); } catch {} });
  const saveOverlays = () => { try { localStorage.setItem('surf-overlays2', JSON.stringify({ wind: map.hasLayer(windLayer), swell: map.hasLayer(swellLayer), heat: map.hasLayer(heatLayer) })); } catch {} };
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

/* ---------- Wind and swell everywhere: the animated fields and the heat map ----------
   The worker's grids (GET /grid, tools/worker/grid.js): swell from
   Copernicus IBI, ~5.5 km with land masked; wind from ECMWF IFS 9 km on a
   0.25° grid; both every 3 hours for 48. Values between grid points and
   between steps are interpolated (directions as vectors). The time slider
   on the map picks the hour; "now" by default. Wind particles move with
   the wind's speed; swell particles with the swell's period (longer
   swell travels faster) and brighten with its height, and stop at the
   coast. If the grids can't be had, a coarse set of Open-Meteo samples
   stands in, as before. */
let grids = null;        // { swell, wind } from the worker
let fieldHour = 0;       // hours ahead of now the fields show

// Fractional step index in a grid for `hoursAhead` from now.
function stepOf(g, hoursAhead) {
  const t0 = Date.parse(g.times[0] + ':00Z'), dt = g.times.length > 1 ? Date.parse(g.times[1] + ':00Z') - t0 : 10800000;
  return Math.max(0, Math.min(g.times.length - 1, (Date.now() + hoursAhead * 3.6e6 - t0) / dt));
}
// A grid's value at a point and fractional step: bilinear in space (over
// the corners that have a value), linear in time; null outside or on land.
// `dir`: the field is a bearing, averaged as a vector.
function gridAt(g, field, lat, lng, s, dir) {
  const fi = (lat - g.lat0) / g.dlat, fj = (lng - g.lng0) / g.dlng;
  if (fi < 0 || fj < 0 || fi > g.nlat - 1 || fj > g.nlng - 1) return null;
  const i0 = Math.floor(fi), j0 = Math.floor(fj), i1 = Math.min(i0 + 1, g.nlat - 1), j1 = Math.min(j0 + 1, g.nlng - 1);
  const s0 = Math.floor(s), s1 = Math.min(s0 + 1, g.times.length - 1), ts = s - s0, ti = fi - i0, tj = fj - j0;
  let a = 0, b = 0, w = 0;
  for (const [si, sw] of [[s0, 1 - ts], [s1, ts]]) {
    if (!sw) continue;
    const arr = g[field][si];
    for (const [i, wi] of [[i0, 1 - ti], [i1, ti]]) for (const [j, wj] of [[j0, 1 - tj], [j1, tj]]) {
      const v = arr[i * g.nlng + j], ww = sw * wi * wj;
      if (v == null || !ww) continue;
      if (dir) { a += Math.sin(v * Math.PI / 180) * ww; b += Math.cos(v * Math.PI / 180) * ww; } else a += v * ww;
      w += ww;
    }
  }
  if (w < 0.25) return null;   // mostly land (or no data): call it land
  return dir ? (Math.atan2(a, b) * 180 / Math.PI + 360) % 360 : a / w;
}

// What a particle layer reads: (lat, lng) → { to, mag, spd } or null.
function windFieldAt(hoursAhead) {
  const g = grids && grids.wind;
  if (!g) return null;
  const s = stepOf(g, hoursAhead);
  return (lat, lng) => {
    const ws = gridAt(g, 'ws', lat, lng, s), wd = gridAt(g, 'wd', lat, lng, s, true);
    return ws == null || wd == null ? null : { to: wd + 180, mag: ws / 10, spd: 0.25 + (ws / 10) * 0.045 };
  };
}
function swellFieldAt(hoursAhead) {
  const g = grids && grids.swell;
  if (!g) return null;
  const s = stepOf(g, hoursAhead);
  return (lat, lng) => {
    const h = gridAt(g, 'h', lat, lng, s), d = gridAt(g, 'd', lat, lng, s, true), p = gridAt(g, 'p', lat, lng, s);
    return h == null || d == null ? null : { to: d + 180, mag: h / 100, spd: 0.12 + ((p || 100) / 10) * 0.045 };
  };
}
// The stand-in: inverse-distance blend of a few samples.
function samplesField(samples, spd) {
  if (!samples.length) return null;
  return (lat, lng) => {
    let x = 0, y = 0, m = 0, w = 0;
    for (const s of samples) {
      const d2 = (lat - s.lat) ** 2 + ((lng - s.lng) * 0.78) ** 2 + 0.0004, ww = 1 / (d2 * d2);
      x += Math.sin(s.toward * Math.PI / 180) * ww; y += Math.cos(s.toward * Math.PI / 180) * ww; m += s.mag * ww; w += ww;
    }
    return { to: (Math.atan2(x, y) * 180 / Math.PI + 360) % 360, mag: m / w, spd: spd(m / w) };
  };
}

// Defined lazily, once Leaflet is loaded.
let ParticleLayerClass = null;
function makeParticleLayer() {
  if (ParticleLayerClass) return ParticleLayerClass;
  const CELL = 10;   // the field is looked up on a 10 px screen grid, then interpolated
  ParticleLayerClass = L.Layer.extend({
    initialize(opts) { L.setOptions(this, opts); this.field = null; this._parts = []; this._raf = 0; },
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
    setField(fn) { this.field = fn; if (this._map) this._reset(); },
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
      // The field on a screen grid: unit direction (screen), size, speed.
      const cols = Math.ceil(size.x / CELL) + 1, rows = Math.ceil(size.y / CELL) + 1;
      const u = new Float32Array(cols * rows), v = new Float32Array(cols * rows), mag = new Float32Array(cols * rows).fill(NaN), spd = new Float32Array(cols * rows);
      if (this.field) {
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
          const ll = map.containerPointToLatLng([c * CELL, r * CELL]), f = this.field(ll.lat, ll.lng), i = r * cols + c;
          if (!f) continue;
          const to = f.to * Math.PI / 180;
          u[i] = Math.sin(to); v[i] = -Math.cos(to); mag[i] = f.mag; spd[i] = f.spd;
        }
      }
      this._g = { cols, rows, u, v, mag, spd };
      const n = this.field ? Math.min(this.options.max, Math.floor((size.x * size.y) / this.options.density)) : 0;
      this._parts = Array.from({ length: n }, () => this._spawn(true));
    },
    // Somewhere the field has a value (swell: at sea), a few tries.
    _spawn(any) {
      for (let k = 0; k < 8; k++) {
        const p = { x: Math.random() * this._w, y: Math.random() * this._h, age: any ? Math.floor(Math.random() * this.options.life) : 0 };
        if (this._vel(p.x, p.y)) return p;
      }
      return { x: -1, y: -1, age: this.options.life };
    },
    _vel(x, y) {
      const g = this._g, fc = x / CELL, fr = y / CELL, c0 = Math.floor(fc), r0 = Math.floor(fr);
      if (c0 < 0 || r0 < 0 || c0 >= g.cols - 1 || r0 >= g.rows - 1) return null;
      const tc = fc - c0, tr = fr - r0;
      let u = 0, v = 0, m = 0, s = 0, w = 0;
      for (const [r, wr] of [[r0, 1 - tr], [r0 + 1, tr]]) for (const [c, wc] of [[c0, 1 - tc], [c0 + 1, tc]]) {
        const i = r * g.cols + c, ww = wr * wc;
        if (Number.isNaN(g.mag[i]) || !ww) continue;
        u += g.u[i] * ww; v += g.v[i] * ww; m += g.mag[i] * ww; s += g.spd[i] * ww; w += ww;
      }
      return w < 0.5 ? null : { u: u / w, v: v / w, mag: m / w, spd: s / w };
    },
    _start() { if (!this._raf) this._raf = requestAnimationFrame(() => this._frame()); },
    _stop() { if (this._raf) cancelAnimationFrame(this._raf); this._raf = 0; },
    _frame() {
      this._raf = 0;
      if (!this._map) return;
      if (document.hidden || !this._parts.length) { this._raf = requestAnimationFrame(() => this._frame()); return; }
      const ctx = this._ctx, o = this.options;
      // Fade what's there, then draw each particle's next step.
      ctx.globalCompositeOperation = 'destination-in';
      ctx.fillStyle = `rgba(0,0,0,${o.fade})`;
      ctx.fillRect(0, 0, this._w, this._h);
      ctx.globalCompositeOperation = 'source-over';
      ctx.lineWidth = o.width;
      ctx.lineCap = 'round';
      for (const p of this._parts) {
        const f = this._vel(p.x, p.y);
        if (!f || p.age > o.life || f.mag < o.min) { Object.assign(p, this._spawn(false)); continue; }
        const len = Math.hypot(f.u, f.v) || 1;
        const nx = p.x + (f.u / len) * f.spd, ny = p.y + (f.v / len) * f.spd;
        ctx.strokeStyle = o.color(f.mag);
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(nx, ny); ctx.stroke();
        p.x = nx; p.y = ny; p.age++;
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

// The heat map's colours: one warm hue, pale and faint for small waves to
// deep and solid for big ones (a single ordered ramp, not a rainbow), so
// the big water stands out over the dark sea of the imagery.
const HEAT = [[0, [255, 236, 200, 40]], [1, [253, 200, 120, 110]], [2, [249, 150, 60, 165]], [3, [235, 95, 40, 195]], [4, [200, 50, 30, 215]], [5, [150, 25, 25, 230]]];
function heatRGB(h) {
  for (let i = 1; i < HEAT.length; i++) {
    if (h <= HEAT[i][0]) {
      const [h0, c0] = HEAT[i - 1], [h1, c1] = HEAT[i], t = (h - h0) / (h1 - h0);
      return c0.map((x, k) => Math.round(x + (c1[k] - x) * t));
    }
  }
  return HEAT[HEAT.length - 1][1];
}
// The swell grid at a step as an image (one pixel a cell, north up); the
// browser smooths it as it scales. Land stays clear.
function heatImage(g, s) {
  const cv = document.createElement('canvas');
  cv.width = g.nlng; cv.height = g.nlat;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(g.nlng, g.nlat);
  for (let i = 0; i < g.nlat; i++) for (let j = 0; j < g.nlng; j++) {
    const h = gridAt(g, 'h', g.lat0 + i * g.dlat, g.lng0 + j * g.dlng, s);
    if (h == null) continue;
    const [r, gg, b, a] = heatRGB(h / 100), o = ((g.nlat - 1 - i) * g.nlng + j) * 4;
    img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}
const heatBounds = (g) => [[g.lat0 - g.dlat / 2, g.lng0 - g.dlng / 2], [g.lat0 + (g.nlat - 0.5) * g.dlat, g.lng0 + (g.nlng - 0.5) * g.dlng]];

// The stand-in samples (only if the worker's grids can't be had).
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
// The grids, once; the stand-in if they can't be had.
async function loadGrids() {
  try {
    const r = await fetch(SURF_WORKER + '/grid');
    if (r.ok) { const g = await r.json(); if (g.swell || g.wind) grids = g; }
  } catch {}
  if (!grids || !grids.wind || !grids.swell) await loadFieldGrid();
}
// Feed the particle layers and the heat map for the hour picked.
function updateFields() {
  if (windField) {
    const stand = (fieldGrid || []).filter((g) => g.ws != null && g.wd != null).map((g) => ({ lat: g.lat, lng: g.lng, toward: g.wd + 180, mag: g.ws }));
    windField.setField(windFieldAt(fieldHour) || samplesField(stand, (ws) => 0.25 + ws * 0.045));
  }
  if (swellField) {
    const stand = (fieldGrid || []).filter((g) => g.h != null && g.d != null).map((g) => ({ lat: g.lat, lng: g.lng, toward: g.d + 180, mag: g.h }));
    swellField.setField(swellFieldAt(fieldHour) || samplesField(stand, (h) => 0.25 + h * 0.3));
  }
  if (heatLayer && grids && grids.swell) heatLayer.setUrl(heatImage(grids.swell, stepOf(grids.swell, fieldHour)));
  syncTimeControl();
}

// The time slider: now, then every 3 hours to 48 ahead (as far as the grids go).
let timeCtl = null;
function syncTimeControl() {
  if (!timeCtl) return;
  const g = grids && (grids.swell || grids.wind), el = timeCtl.getContainer();
  el.hidden = !g;
  if (!g) return;
  const last = Math.floor((Date.parse(g.times[g.times.length - 1] + ':00Z') - Date.now()) / 3.6e6 / 3) * 3;
  const input = el.querySelector('input');
  input.max = Math.max(0, last);
  input.value = fieldHour;
  const t = new Date(Date.now() + fieldHour * 3.6e6);
  el.querySelector('output').textContent = fieldHour === 0 ? 'Now' : `${DAY_NAMES[t.getDay()]} ${String(t.getHours()).padStart(2, '0')}:00 · +${fieldHour} h`;
}
function makeTimeControl() {
  const Ctl = L.Control.extend({
    // Phones: top left, under the bar (the legend has the bottom); else bottom right.
    options: { position: phone.matches ? 'topleft' : 'bottomright' },
    onAdd() {
      const el = L.DomUtil.create('div', 'time-ctl');
      el.innerHTML = '<label><span class="k">Forecast</span><output>Now</output></label><input type="range" min="0" max="48" step="3" value="0" aria-label="Hours ahead for the scores, wind and swell">';
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      el.querySelector('input').addEventListener('input', (e) => { fieldHour = +e.target.value; updateFields(); slidePins(); });
      return el;
    },
  });
  timeCtl = new Ctl();
  return timeCtl;
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
