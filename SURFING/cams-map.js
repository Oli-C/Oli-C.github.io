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
let pinFc = null, popSpot = null;
// Each spot's hours in one list, in time order, made once per build.
const hourLists = new Map();
function hoursOf(c) {
  const cond = conditions[c.id], s = pinFc && pinFc.spots[c.id], src = s || cond;
  const hit = hourLists.get(c.id);
  if (hit && hit.src === src) return hit.list;
  const days = s ? s.days : cond ? [{ hours: cond.hours }, { hours: cond.tomorrow || [] }] : [];
  const list = [];
  for (const d of days) for (const k of d.hours) list.push({ ms: Date.parse(k.t + ':00Z'), k, hs: d.hours, tides: d.tides });
  list.sort((a, b) => a.ms - b.ms);
  hourLists.set(c.id, { src, list });
  return list;
}
function pinAt(c) {
  const cond = conditions[c.id];
  if (!fieldHour) return { k: cond && cond.now };
  const s = pinFc && pinFc.spots[c.id];
  const from = s ? spotNow(s.offset) : cond && cond.now && cond.now.t;
  if (!from) return {};
  const at = Date.parse(from + ':00Z') + fieldHour * 3.6e6, list = hoursOf(c);
  // The hour nearest `at` (binary search), if within two hours.
  let lo = 0, hi = list.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (list[mid].ms < at) lo = mid + 1; else hi = mid; }
  const best = [list[lo - 1], list[lo]].filter(Boolean).sort((a, b) => Math.abs(a.ms - at) - Math.abs(b.ms - at))[0];
  return best && Math.abs(best.ms - at) < 2 * 3.6e6 ? { k: best.k, hs: best.hs, tides: best.tides } : {};
}
function slidePins() {
  if (!map) return;
  loadWorkerForecast().then((fc) => { pinFc = fc; }, () => {}).then(() => {
    // Only the pins whose content changed (scores are remembered per hour).
    for (const c of CAMS) if (markers[c.id]._pinHtml !== pinHtml(c)) markers[c.id].setIcon(pinIcon(c));
    declutter();
    // An open popup / card keeps its size as the time moves: it may grow, never shrink.
    if (popSpot && popSpot.isOpen()) {
      const el = popSpot.getElement() && popSpot.getElement().querySelector('.leaflet-popup-content');
      if (el) el.style.minHeight = el.getBoundingClientRect().height + 'px';
      popSpot.setContent(popupHtml(popSpot.spot));
    }
    if (cardId) { mapCard.style.minHeight = mapCard.getBoundingClientRect().height + 'px'; showMapCard(byId(cardId), false); }
  });
}

// A pin's markup, remembered per spot and hour (scoring a day's bars is
// the slow part); forgotten when the conditions, the build or units change.
const pinMemo = { cond: null, fc: null, units: null, hour: -1, map: new Map() };
function pinHtml(c) {
  const hour = new Date().getHours();
  if (pinMemo.cond !== conditions || pinMemo.fc !== pinFc || pinMemo.units !== units || pinMemo.hour !== hour) {
    Object.assign(pinMemo, { cond: conditions, fc: pinFc, units, hour });
    pinMemo.map.clear();
  }
  const key = c.id + '|' + fieldHour;
  if (!pinMemo.map.has(key)) pinMemo.map.set(key, pinMarkup(c));
  return pinMemo.map.get(key);
}
const pinIcon = (c) => {
  const html = pinHtml(c);
  if (markers[c.id]) markers[c.id]._pinHtml = html;
  return L.divIcon({ className: 'pin-wrap', html, iconSize: [0, 0], iconAnchor: [0, 0], popupAnchor: [0, -14] });
};
const pinMarkup = (c) => {
  const at = pinAt(c), k = at.k, r = k ? score(c, k) : null;
  const lvl = r ? (r.dark ? 'lvl-dark' : 'lvl-' + r.level) : 'lvl-x';
  const data = k ? `<span class="d">
      <span class="row swell"><span style="display:inline-flex;--rot:${k.d != null ? Math.round(k.d + 180) : 0}deg">${k.d != null ? GLYPH : ''}</span><em>${hgt(k.h)}</em>${Math.round(k.p)}s</span>
      <span class="row wind ${r ? REL_SHORT[r.wind] : ''}"><span style="display:inline-flex;--rot:${Math.round(k.wd + 180)}deg">${GLYPH}</span><em>${kts(k.ws)}kt</em></span>
      ${at.hs ? miniBars(c, at.hs, hourOf(k.t)) : miniBars(c)}</span>` : '';
  return `<span class="pin ${lvl}" title="${esc(c.name)}"><span class="sc">${!r ? '·' : r.dark ? (r.lit ? fmt(r.lit) : MOON) : r.total === 0 ? '–' : fmt(r.total)}</span>${data}</span>`;
};

// Now, or the slider's hour: its score and conditions, that day's bars,
// tides and summary, and the viewer opens on that day.
const popupHtml = (c) => {
  const at = fieldHour ? pinAt(c) : null, k = at && at.k;
  const today = conditions[c.id] && conditions[c.id].now && conditions[c.id].now.t.slice(0, 10);
  const date = k && k.t.slice(0, 10), isToday = !k || date === today;
  const when = k ? `${isToday ? '' : DAY_NAMES[new Date(date + 'T12:00Z').getUTCDay()] + ' '}${k.t.slice(11, 16)}` : 'Now';
  const cond = k ? condText(c, k) : at ? '' : condText(c);
  const sum = k ? daySummary(c, at.hs, isToday) : at ? '' : daySummary(c);
  const tide = k ? (isToday ? tideTimes(tidesFor(c)) : (at.tides || []).map((e) => `${e.kind} ${fmtMins(e.mins)}`).join(' · ')) : tideTimes(tidesFor(c));
  return `
    <div class="pop-head">
      <div>
        <div class="pop-name">${esc(c.name)}</div>
        <div class="pop-where">${esc(c.zone || c.town)} · ${esc(c.area)}</div>
      </div>
      ${k ? badge(c, false, score(c, k)) : at ? badge(c, false, null) : badge(c)}
    </div>
    ${cond ? `<div class="pop-cond">${esc(when)} ${cond} ${k ? miniBars(c, at.hs, hourOf(k.t)) : miniBars(c)}</div>` : at ? '<div class="pop-cond">No forecast for that time yet.</div>' : ''}
    <div class="pop-sum pop-tide">${tide ? `Tide: ${esc(tide)}` : ''}</div>
    <div class="pop-sum pop-day">${sum ? esc(sum) : ''}</div>
    <div class="pop-actions">
      <button class="pop-btn" type="button" data-open="${esc(c.id)}${isToday ? '' : '@' + date}">
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
  map.attributionControl.setPrefix(false);   // the tile credits stay (their terms); Leaflet's link needn't
  // Esri satellite by default — the imagery reads the beaches best — with
  // plain OpenStreetMap streets as the alternative. Both keyless.
  const osm = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
    className: 'osm-tiles',
  });
  // Esri's tiles are 256 px with no @2x set, so on sharp screens the
  // imagery comes from deeper zoom levels drawn smaller: one level at half
  // size on 1.5–2x screens, two levels at a quarter on 3x ones (iPhones;
  // about three times the tiles, so not with Data saver on). Esri goes to
  // zoom 19 along this coast; past that it can only stretch. Not the
  // streets: their labels would shrink.
  const dpr = window.devicePixelRatio || 1, deep = dpr >= 2.5 && !dataSaver ? 2 : dpr > 1 ? 1 : 0;
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: '&copy; <a href="https://www.esri.com/">Esri</a>, Maxar, Earthstar Geographics',
    tileSize: 256 >> deep,
    zoomOffset: deep,
    maxNativeZoom: 19 - deep,
    maxZoom: 19,
  });
  let base = 'sat';
  try { base = localStorage.getItem('surf-base2') || 'sat'; } catch {}
  (base === 'osm' ? osm : sat).addTo(map);
  // Wind and swell overlays: animated particles (not with reduced motion),
  // and the swell-height heat map; the worker's grids drive all three.
  windLayer = L.layerGroup();
  swellLayer = L.layerGroup();
  heatLayer = makeHeatLayer();
  if (!reducedMotion) {
    const PL = makeParticleLayer();
    windField = new PL({ max: phone.matches ? 450 : 1400, density: 1800, life: 90, fade: 0.9, width: 1.3, min: 0.5,
      speed: (ws) => 0.25 + ws * 0.045, color: windColor });
    swellField = new PL({ max: phone.matches ? 250 : 700, density: 3600, life: 160, fade: 0.95, width: 1.8, min: 0.15,
      speed: (h) => 0.25 + h * 0.3, color: swellColor, sea: true });
  }
  loadGrids().then(() => { if (grids && grids.swell) heatLayer.options.bounds = L.latLngBounds(heatBounds(grids.swell)); updateFields(); });
  let overlays = { wind: true, swell: true, heat: false };
  try { overlays = { ...overlays, ...JSON.parse(localStorage.getItem('surf-overlays2') || '{}') }; } catch {}
  if (overlays.wind) windLayer.addTo(map);
  if (overlays.swell) swellLayer.addTo(map);
  if (overlays.heat) heatLayer.addTo(map);
  L.control.layers({ 'Satellite': sat, 'Streets': osm }, { 'Wind': windLayer, 'Swell': swellLayer, 'Swell height': heatLayer }, { position: 'topright', collapsed: phone.matches || landscape.matches }).addTo(map);
  makeTimeControl().addTo(map);
  syncTimeControl();
  // The legend shows a row for each layer that's on.
  const legendRows = () => {
    $('lg-heat').hidden = !map.hasLayer(heatLayer);
    $('lg-streaks').hidden = !windField || (!map.hasLayer(windLayer) && !map.hasLayer(swellLayer));
  };
  map.on('overlayadd overlayremove', legendRows);
  legendRows();
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
      popSpot = L.popup({ closeButton: false, minWidth: 300, maxWidth: 300, offset: [0, -14] }).setLatLng(m.getLatLng()).setContent(popupHtml(c)).openOn(map);
      popSpot.spot = c;
      findCard(c.id);
    });
    markers[c.id] = m;
  }
  map.on('click', hideMapCard);
  map.getContainer().addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (b) { map.closePopup(); open(b.dataset.open); }
  });
  // Back where the map was left on this device (unless a filter's on),
  // else fitted to the spots; kept as it moves.
  let pos = null;
  try { pos = JSON.parse(localStorage.getItem('surf-map-pos') || 'null'); } catch {}
  if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lng) && Number.isFinite(pos.z) && area === 'All' && !q.value.trim()) {
    map.setView([pos.lat, pos.lng], pos.z, { animate: false });
    fitKey = filterKey();
  }
  syncMarkers(true);
  map.on('moveend', () => {
    const c = map.getCenter();
    try { localStorage.setItem('surf-map-pos', JSON.stringify({ lat: +c.lat.toFixed(4), lng: +c.lng.toFixed(4), z: map.getZoom() })); } catch {}
  });
}

const mapCard = $('map-card');
let cardId = null;
function showMapCard(c, pan = true) {
  if (pan) mapCard.style.minHeight = '';   // a new spot: its own size
  if (cardId) hotPin(cardId, false);
  cardId = c.id;
  hotPin(c.id, true);
  mapCard.innerHTML = popupHtml(c) +
    `<button class="map-card-x" type="button" aria-label="Close"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>`;
  mapCard.hidden = false;
  $('map-wrap').classList.add('has-card');
  // Keep the pin clear of the card.
  if (pan) requestAnimationFrame(() => map.panInside([c.lat, c.lng], { paddingTopLeft: [40, mapTop() + 40], paddingBottomRight: [40, mapCard.offsetHeight + 40] }));
}
function hideMapCard() {
  if (!cardId) return;
  hotPin(cardId, false);
  cardId = null;
  mapCard.hidden = true;
  mapCard.style.minHeight = '';
  $('map-wrap').classList.remove('has-card');
}
mapCard.addEventListener('click', (e) => {
  if (e.target.closest('.map-card-x')) return hideMapCard();
  const b = e.target.closest('[data-open]');
  if (b) open(b.dataset.open);
});

// How much of the map's top edge the floating phone toolbar covers.
// How far down the map the floating toolbar reaches (map view only).
const mapTop = () => (layout.dataset.view === 'map' ? Math.round($('controls').getBoundingClientRect().bottom) : 0);

// Show only the markers that pass the current filter; optionally refit.
// The map fits itself to the spots on show only when the filter changes,
// so it otherwise stays where it was left.
let fitKey = null;
const filterKey = () => area + '|' + q.value.trim();
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
  if (fit && shown.length && filterKey() !== fitKey) {
    fitKey = filterKey();
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
      // The pin's box runs from half its score bubble left of the spot.
      const l = p.x - pin.querySelector('.sc').offsetWidth / 2 - 1.5;
      items.push({ el, pin, x: p.x, l, r: l + pin.offsetWidth, y0: p.y, y: p.y, h: pin.offsetHeight });
    }
    const touch = (a, b) => a.l < b.r + PIN_GAP && b.l < a.r + PIN_GAP && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + PIN_GAP;
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
function gridAt(g, field, lat, lng, s, dir, minW = 0.25) {
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
  if (w < minW) return null;   // mostly land (or no data): call it land
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
    // Right up to the shore (any sea corner counts); the coastline masks the rest.
    const h = gridAt(g, 'h', lat, lng, s, false, 0.01), d = gridAt(g, 'd', lat, lng, s, true, 0.01), p = gridAt(g, 'p', lat, lng, s, false, 0.01);
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
      // Swell stays off the land: the coastline as a path on this canvas.
      this._dpr = dpr;
      if (this.options.sea) {
        const origin = map.getPixelOrigin().add(map.containerPointToLayerPoint([0, 0]));
        this._land = landPath(map, map.getZoom(), origin, [origin.x, origin.y, origin.x + size.x, origin.y + size.y]);
      } else this._land = null;
      const n = this.field ? Math.min(this.options.max, Math.floor((size.x * size.y) / this.options.density)) : 0;
      this._parts = Array.from({ length: n }, () => this._spawn(true));
    },
    // Somewhere the field has a value (swell: at sea), a few tries.
    _spawn(any) {
      for (let k = 0; k < 8; k++) {
        const p = { x: Math.random() * this._w, y: Math.random() * this._h, age: any ? Math.floor(Math.random() * this.options.life) : 0 };
        if (this._vel(p.x, p.y) && !(this._land && this._ctx.isPointInPath(this._land, p.x * this._dpr, p.y * this._dpr))) return p;
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
      if (this._land) {   // anything that strayed over the land, gone
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fill(this._land);
        ctx.globalCompositeOperation = 'source-over';
      }
      this._raf = requestAnimationFrame(() => this._frame());
    },
  });
  return ParticleLayerClass;
}

// Wind: one neutral colour, brighter the stronger (its speed shows in the
// motion), so colour on the map only ever means a score or how the wind
// sits on a beach; brisk short trails.
const windColor = (ws) => `rgba(236,240,244,${Math.min(0.95, 0.45 + ws / 60).toFixed(2)})`;
// Swell: sea blue, slow long streaks, brighter the bigger it is.
const swellColor = (h) => `rgba(79,195,220,${Math.min(0.95, 0.35 + h * 0.2)})`;

// The heat map: swell height in steps, so it reads at a glance — half a
// metre each to 3 m, then 3–4 and 4+ — one warm hue, paler and fainter
// for small, deeper for big, with a thin light line where one step meets
// the next. Each map tile samples the grid every 8 px, then every screen
// pixel (at the device's density) is interpolated from those and shaded
// by its distance to the nearest step, so the lines and the coast come
// out smooth at any zoom; land stays clear.
const HEAT_EDGES = [0.5, 1, 1.5, 2, 2.5, 3, 4];   // metres
const HEAT_COLS = [[255, 240, 210, 40], [254, 218, 150, 95], [253, 190, 105, 135], [249, 155, 65, 165],
  [240, 118, 45, 185], [222, 82, 35, 205], [190, 45, 30, 220], [130, 18, 25, 235]];
const heatBand = (m) => { let i = 0; while (i < HEAT_EDGES.length && m >= HEAT_EDGES[i]) i++; return i; };
const heatCss = (c) => `rgba(${c[0]},${c[1]},${c[2]},${(c[3] / 255).toFixed(2)})`;
// The coastline (coast.js, from OSM): land polygons, decoded once and
// projected once per zoom; landPath gives the land at zoom z as a canvas
// path in pixels from `origin`, only the polygons that reach `view`.
let landRings = null;
const landAt = new Map();   // zoom → [{ pts: Float64Array of x, y; box }]
function landPath(map, z, origin, view) {
  if (typeof COAST === 'undefined') return null;
  if (!landRings) landRings = COAST.rings.map((r) => {
    const out = [];
    let y = 0, x = 0;
    for (let i = 0; i < r.length; i += 2) { y += r[i]; x += r[i + 1]; out.push(L.latLng(y / COAST.q, x / COAST.q)); }
    return out;
  });
  if (!landAt.has(z)) {
    if (landAt.size > 6) landAt.clear();
    landAt.set(z, landRings.map((r) => {
      const pts = new Float64Array(r.length * 2), box = [Infinity, Infinity, -Infinity, -Infinity];
      r.forEach((ll, i) => {
        const p = map.project(ll, z);
        pts[i * 2] = p.x; pts[i * 2 + 1] = p.y;
        box[0] = Math.min(box[0], p.x); box[1] = Math.min(box[1], p.y); box[2] = Math.max(box[2], p.x); box[3] = Math.max(box[3], p.y);
      });
      return { pts, box };
    }));
  }
  const path = new Path2D();
  for (const { pts, box } of landAt.get(z)) {
    if (box[2] < view[0] || box[0] > view[2] || box[3] < view[1] || box[1] > view[3]) continue;
    path.moveTo(pts[0] - origin.x, pts[1] - origin.y);
    for (let i = 2; i < pts.length; i += 2) path.lineTo(pts[i] - origin.x, pts[i + 1] - origin.y);
    path.closePath();
  }
  return path;
}

function makeHeatLayer() {
  const LINE = 0.6, LINE_A = 150;   // the step lines: half-width in CSS px, alpha
  const Heat = L.GridLayer.extend({
    createTile(coords) {
      const cv = document.createElement('canvas'), job = this._job(cv, coords);
      if (job) job.step(Infinity);
      return cv;
    },
    // A new hour: redraw the tiles where they stand (each keeps its old
    // picture until the new one's done), in slices of rows, ~10 ms a
    // frame, so dragging and the animation stay smooth.
    refresh() {
      cancelAnimationFrame(this._rf);
      const jobs = Object.values(this._tiles || {}).filter((t) => t.current).map((t) => this._job(t.el, t.coords)).filter(Boolean);
      const step = () => {
        const until = performance.now() + 10;
        while (jobs.length && performance.now() < until) if (jobs[0].step(until)) jobs.shift();
        if (jobs.length) this._rf = requestAnimationFrame(step);
      };
      step();
    },
    // One tile's drawing as a job: step(until) does rows until the time's
    // up, and true once the tile is drawn.
    _job(cv, coords) {
      const size = this.getTileSize();
      const dpr = Math.min(2, window.devicePixelRatio || 1), W = Math.round(size.x * dpr), H = Math.round(size.y * dpr);
      const g = grids && grids.swell;
      if (!g) { cv.width = W; cv.height = H; return null; }
      // The lattice: metres every 8 CSS px, one extra row and column each side.
      const S = 8, n = size.x / S + 3, s = stepOf(g, fieldHour), origin = coords.scaleBy(size);
      const lat = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const ll = this._map.unproject(origin.add([(x - 1) * S, (y - 1) * S]), coords.z);
        const h = gridAt(g, 'h', ll.lat, ll.lng, s, false, 0.01);
        lat[y * n + x] = h == null ? NaN : h / 100;
      }
      const img = new ImageData(W, H), d = img.data;
      const NE = HEAT_EDGES.length, k = 1 / (dpr * S);
      let row = 0;
      const map = this._map;
      return {
        step(until) {
          while (row < H) {
            const y0row = row, y1row = Math.min(H, row + 32);
            for (let py = y0row; py < y1row; py++) {
              const v = (py + 0.5) * k + 1, y0 = v | 0, ty = v - y0, row0 = y0 * n, row1 = row0 + n;
              for (let px = 0; px < W; px++) {
                const u = (px + 0.5) * k + 1, x0 = u | 0, tx = u - x0;
                const a = lat[row0 + x0], b = lat[row0 + x0 + 1], c = lat[row1 + x0], e = lat[row1 + x0 + 1];
                // Bilinear over the corners that are sea; mostly land: leave it clear.
                const wa = (1 - tx) * (1 - ty), wb = tx * (1 - ty), wc = (1 - tx) * ty, we = tx * ty;
                let sum = 0, w = 0;
                if (a === a) { sum += a * wa; w += wa; }
                if (b === b) { sum += b * wb; w += wb; }
                if (c === c) { sum += c * wc; w += wc; }
                if (e === e) { sum += e * we; w += we; }
                if (w < 0.4) continue;
                const coast = w >= 0.6 ? 1 : (w - 0.4) / 0.2;   // fades over the last bit, not a hard step
                const h = sum / w;
                let band = 0;
                while (band < NE && h >= HEAT_EDGES[band]) band++;
                const col = HEAT_COLS[band];
                // Distance to the nearest step (one each side of this band), in CSS px, from the local slope.
                let line = 0;
                if (w > 0.999) {
                  const gx = ((b - a) * (1 - ty) + (e - c) * ty) / S, gy = ((c - a) * (1 - tx) + (e - b) * tx) / S;
                  const grad = Math.sqrt(gx * gx + gy * gy);
                  if (grad > 1e-6) {
                    const lo = band > 0 ? h - HEAT_EDGES[band - 1] : Infinity, hi = band < NE ? HEAT_EDGES[band] - h : Infinity;
                    line = 0.5 + (LINE - (lo < hi ? lo : hi) / grad) * dpr;
                    line = line < 0 ? 0 : line > 1 ? 1 : line;
                  }
                }
                const o = (py * W + px) * 4;
                d[o] = col[0] + (255 - col[0]) * line;
                d[o + 1] = col[1] + (255 - col[1]) * line;
                d[o + 2] = col[2] + (255 - col[2]) * line;
                d[o + 3] = (col[3] + ((LINE_A > col[3] ? LINE_A : col[3]) - col[3]) * line) * coast;
              }
            }
            row = y1row;
            if (performance.now() > until) break;
          }
          if (row < H) return false;
          if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
          const ctx = cv.getContext('2d');
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.globalCompositeOperation = 'source-over';
          ctx.putImageData(img, 0, 0);
          // Clear the land along the real coastline (anti-aliased by the canvas).
          const land = landPath(map, coords.z, origin, [origin.x, origin.y, origin.x + size.x, origin.y + size.y]);
          if (land) {
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.globalCompositeOperation = 'destination-out';
            ctx.fill(land);
          }
          return true;
        },
      };
    },
  });
  return new Heat({ className: 'heat', zIndex: 250, updateWhenZooming: false });
}
// The key: a swatch a step, labelled at the edges (in the units picked).
function renderHeatKey() {
  const el = document.querySelector('#lg-heat .heat-key');
  if (!el) return;
  const lab = (m) => (units === 'ft' ? String(Math.round(m * 3.281)) : String(m));
  el.innerHTML = `<span class="sw">${HEAT_COLS.map((c) => `<i style="background:${heatCss(c)}"></i>`).join('')}</span>`
    + `<span class="tk">${HEAT_EDGES.map((m, i) => `<b style="left:${(i + 1) * 20}px">${lab(m)}</b>`).join('')}<b class="u" style="left:${HEAT_COLS.length * 20 + 5}px">${units === 'ft' ? 'ft' : 'm'}</b></span>`;
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
// The swell grid's sea runs a couple of cells into the coastal gaps (the
// Tejo mouth, the bays), each empty cell taking the mean of its sea
// neighbours, so its colour and streaks reach the shore; the coastline
// trims whatever lands on land.
function fillCoast(g, passes = 2) {
  for (const field of ['h', 'd', 'p']) {
    if (!g[field]) continue;
    g[field] = g[field].map((arr) => {
      let cur = arr.slice();
      for (let pass = 0; pass < passes; pass++) {
        const next = cur.slice();
        for (let i = 0; i < g.nlat; i++) for (let j = 0; j < g.nlng; j++) {
          if (cur[i * g.nlng + j] != null) continue;
          let a = 0, b = 0, n = 0;
          for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
            const ii = i + di, jj = j + dj;
            if ((!di && !dj) || ii < 0 || jj < 0 || ii >= g.nlat || jj >= g.nlng) continue;
            const v = cur[ii * g.nlng + jj];
            if (v == null) continue;
            if (field === 'd') { a += Math.sin(v * Math.PI / 180); b += Math.cos(v * Math.PI / 180); } else a += v;
            n++;
          }
          if (n) next[i * g.nlng + j] = field === 'd' ? (Math.atan2(a, b) * 180 / Math.PI + 360) % 360 : a / n;
        }
        cur = next;
      }
      return cur;
    });
  }
  return g;
}
async function loadGrids() {
  try {
    const r = await fetch(SURF_WORKER + '/grid');
    if (r.ok) { const g = await r.json(); if (g.swell || g.wind) { grids = g; if (g.swell) fillCoast(g.swell); } }
  } catch {}
  if (!grids || !grids.wind || !grids.swell) await loadFieldGrid();
}

// The streaks and the heat map for the hour picked, a frame apiece so the
// work doesn't land in one long frame (a newer call drops an older chain).
let fieldsRun = 0;
function updateFields() {
  const run = ++fieldsRun, next = (fn) => requestAnimationFrame(() => { if (run === fieldsRun) fn(); });
  syncTimeControl();
  renderHeatKey();
  if (windField) {
    const stand = (fieldGrid || []).filter((g) => g.ws != null && g.wd != null).map((g) => ({ lat: g.lat, lng: g.lng, toward: g.wd + 180, mag: g.ws }));
    windField.setField(windFieldAt(fieldHour) || samplesField(stand, (ws) => 0.25 + ws * 0.045));
  }
  next(() => {
    if (swellField) {
      const stand = (fieldGrid || []).filter((g) => g.h != null && g.d != null).map((g) => ({ lat: g.lat, lng: g.lng, toward: g.d + 180, mag: g.h }));
      swellField.setField(swellFieldAt(fieldHour) || samplesField(stand, (h) => 0.25 + h * 0.3));
    }
    next(() => { if (heatLayer && grids && grids.swell && map.hasLayer(heatLayer)) heatLayer.refresh(); });
  });
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
  timeLabel();
}
function timeLabel() {
  const t = spotClock(Date.now() + fieldHour * 3.6e6 + 1.8e6);   // the nearest hour, as the pins pick
  timeCtl.getContainer().querySelector('output').textContent = fieldHour === 0 ? 'Now' : `${DAY_NAMES[t.dow]} ${String(t.h).padStart(2, '0')}:00 · +${fieldHour} h`;
}
function makeTimeControl() {
  const Ctl = L.Control.extend({
    // Phones: top left, under the bar (the legend has the bottom); else bottom right.
    options: { position: phone.matches ? 'topleft' : 'bottomright' },
    onAdd() {
      const el = L.DomUtil.create('div', 'time-ctl');
      el.innerHTML = '<label><span class="k">Time</span><output>Now</output></label><input type="range" min="0" max="48" step="3" value="0" aria-label="Time for the scores, wind and swell">';
      L.DomEvent.disableClickPropagation(el);
      L.DomEvent.disableScrollPropagation(el);
      // Dragging moves the label and the pins at once (once a frame at
      // most); the streaks and the heat map follow when it rests or lets go.
      const input = el.querySelector('input');
      let rest = 0, pinsAt = 0, pinsLater = 0;
      const pins = () => { pinsAt = performance.now(); pinsLater = 0; slidePins(); };
      input.addEventListener('input', () => {
        fieldHour = +input.value;
        timeLabel();
        // The pins: at most every 100 ms while dragging, and once more at the end.
        if (performance.now() - pinsAt > 100) pins();
        else if (!pinsLater) pinsLater = setTimeout(pins, 100);
        clearTimeout(rest);
        rest = setTimeout(updateFields, 150);
      });
      input.addEventListener('change', () => { clearTimeout(rest); updateFields(); });
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
    await loadScript(LIBS.coast).catch(() => {});   // without it the swell layers just stop at the grid's land
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
