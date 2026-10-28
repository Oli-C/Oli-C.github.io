/* The viewer: the player, the score card and its factors, the Sources
   panel, today's four graphs (scrubbable), local knowledge, the star and
   the cam-less spots. */

/* ---------- Viewer ---------- */

// "MEO Beachcam via viewsurf" -> "MEO Beachcam"
const sourceName = (c) => (c.source || 'the source site').replace(/ via .*/, '');
function frameMsg(text, c) {
  const link = c && c.link
    ? `<a class="nav" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Watch on ${esc(sourceName(c))} ↗</a>` : '';
  frame.insertAdjacentHTML('beforeend', `<div class="frame-msg"><div>${esc(text)}${link}</div></div>`);
}

const iframeHtml = (url, c) =>
  `<iframe src="${esc(url)}" title="${esc(c.name)} live webcam" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>`;

function stopPlayback() {
  if (hls) { try { hls.destroy(); } catch {} hls = null; }
  if (player) { try { player.destroy(); } catch {} player = null; }
  frame.innerHTML = '';
}

// A dead or blocked stream falls back to the cam's page when it has one.
function streamFailed(c, text) {
  stopPlayback();
  if (!c.fallback) { frame.className = 'frame video'; return frameMsg(text, c); }
  frame.className = 'frame page';
  frame.innerHTML = iframeHtml(c.fallback, c);
}

async function playHls(c) {
  const video = document.createElement('video');
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  if (c.poster) video.poster = c.poster;
  video.setAttribute('aria-label', `${c.name} live webcam`);
  frame.appendChild(video);
  const gone = () => !frame.contains(video); // viewer closed while a lib loaded

  try {
    const libs = [loadScript(LIBS.plyr)];
    if (!nativeHls) libs.push(loadScript(LIBS.hls));
    await Promise.all(libs);
    if (gone()) return;

    // Try the alternate host (same cam) once before giving up.
    let src = c.embed;
    const failed = () => {
      if (c.alt && src !== c.alt && !gone()) { src = c.alt; return load(); }
      streamFailed(c, 'Stream unavailable right now.');
    };
    const load = () => {
      if (nativeHls) {
        video.addEventListener('error', failed, { once: true });
        video.src = src;
      } else {
        if (!window.Hls.isSupported()) return streamFailed(c, 'This browser can’t play live streams.');
        if (hls) { try { hls.destroy(); } catch {} }
        hls = new Hls({ liveDurationInfinity: true, enableWorker: true });
        hls.on(Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) return hls.recoverMediaError();
          failed();
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      }
    };
    load();

    player = new Plyr(video, {
      // Cams have no audio, so no mute / volume controls to confuse things.
      controls: ['play-large', 'play', 'pip', 'airplay', 'fullscreen'],
      autoplay: true,
      muted: true,
      clickToPlay: true,
      hideControls: true,
      ratio: '16:9',
      storage: { enabled: false },
      fullscreen: { enabled: true, fallback: true, iosNative: true },
    });
  } catch {
    if (!gone()) streamFailed(c, 'Couldn’t load the video player.');
  }
}

// Keeps a fold's open/closed state across re-renders (new conditions,
// units); first time round it's closed on phones, open elsewhere.
const foldOpen = (el, sel, wideDefault = true) => {
  const d = el.querySelector(sel);
  return (d ? d.open : wideDefault && !phone.matches) ? ' open' : '';
};

// The glance: score, what's holding it back, and the few numbers the
// graphs below don't carry (water, air, light, the station reading).
// The factor-by-factor breakdown folds away under "Why".
function renderScore(c) {
  const r = scoreOf(c);
  const el = $('v-score');
  if (!r) { el.hidden = true; el.innerHTML = ''; return; }
  const cnd = conditions[c.id], k = cnd && cnd.now;
  const share = (f) => (f.mult != null ? f.mult : f.pts / f.max);
  const weak = r.factors.filter((f) => share(f) < (f.mult != null ? 0.9 : 0.6))
    .sort((a, b) => share(a) - share(b)).slice(0, 2);
  const verdict = r.dark ? `Dark now${r.lit != null ? `; with light, this would be <b>${fmt(r.lit)} ${LEVELS[levelOf(r.lit)].toLowerCase()}</b>` : ''}`
    : r.cap ? esc(r.cap)
    : weak.length ? 'Held back by ' + weak.map((f) => `<b>${esc(f.label.toLowerCase())}</b>`).join(' and ')
    : 'Everything’s lining up';
  const chip = (label, v, s) => `<span class="chip-now"><span class="k">${label}</span><b>${v}</b>${s ? `<small>${s}</small>` : ''}</span>`;
  const chips = [];
  // How clean it should be, first: what most people want to know.
  if (r.surface && k) chips.push(`<span class="chip-now surf-${r.surface.i}" title="${esc(r.surface.learned || 'From the wind, gusts, chop and any cross swell')}"><span class="k">Surface</span><b>${esc(r.surface.label)}</b>${r.surface.learned ? '<small>from sessions</small>' : ''}</span>`);
  if (k && k.sst != null) chips.push(chip('Water', `${Math.round(k.sst)}°C`, esc(suit(k.sst))));
  if (k && k.air != null) chips.push(chip('Air', `${Math.round(k.air)}°C`));
  if (cnd && cnd.sun && cnd.sun.rise) chips.push(chip('Light', `${cnd.sun.rise}–${cnd.sun.set}`));
  if (k && k.obs) chips.push(chip('Measured', `${kts(k.obs.ws)} kts${k.obs.wd != null ? ' ' + dirName(k.obs.wd) : ''}`, `${esc(k.obs.station)} ${k.obs.t}`));
  const open = foldOpen(el, 'details.why');
  // After dark the score is 0, but the factors still say what the sea is
  // doing: explain them against what it would score with light.
  const shown = r.dark ? r.lit || 0 : r.total, shownLevel = levelOf(shown);
  el.hidden = false;
  el.innerHTML = `
    <div class="glance">
      ${badge(c, true)}
      <div class="glance-text">
        <div class="verdict">${verdict}</div>
        ${(r.notes || []).map((n) => `<div class="score-note">${esc(n)}</div>`).join('')}
      </div>
    </div>
    ${chips.length ? `<div class="now-chips">${chips.join('')}</div>` : ''}
    <details class="fold why"${open}>
      <summary><span class="k">Why ${fmt(shown)}?</span><span class="fold-hint">${r.dark ? 'with light to see by' : 'factor by factor'}</span></summary>
      <div class="factors">
        ${r.dark ? '<p class="score-note">It’s dark, so it scores 0 now; this is how the same conditions would score with light.</p>' : ''}
        ${r.factors.map((f) => {
          const pts = f.mult != null ? `×${f.mult.toFixed(2).replace(/0$/, '')}` : `${fmt(Math.round(f.pts * 2) / 2)}/${f.max}`;
          return `
          <div class="factor lvl-${shownLevel}">
            <span class="k">${f.label}</span>
            <span class="f-bar"><i style="width:${share(f) * 100}%"></i></span>
            <span class="f-pts">${pts}</span>
            <span class="f-detail"><b>${esc(f.now)}</b> · likes ${esc(f.likes)}</span>
          </div>`; }).join('')}
      </div>
    </details>`;
}

// Every source behind the score: each model's wind and swell, plus the
// nearest station's measured wind. Folded; the confidence shows anyway.
function renderSrc(c) {
  const k = conditions[c.id] && conditions[c.id].now;
  const el = $('v-src');
  if (!k || !k.src) { el.hidden = true; el.innerHTML = ''; return; }
  const wt = (w) => `<small>×${w.toFixed(1)}</small>`;
  const wind = k.src.wind.map((s) => `<span class="${s.out ? 'src-out' : ''}" title="${s.out ? 'Outlier, left out of the blend' : s.n ? `${s.n} station checks on this device` : 'base weight'}"><b>${esc(s.name)}</b> ${kts(s.ws)} kts${s.wd != null ? ' ' + dirName(s.wd) : ''} ${s.out ? '<small>ignored</small>' : wt(s.w)}</span>`).join('');
  const swell = k.src.swell.map((s) => `<span class="${s.out ? 'src-out' : ''}" title="${s.out ? 'Outlier, left out of the blend' : 'base weight'}"><b>${esc(s.name)}</b> ${hgt(s.h)}${s.p != null ? ' ' + Math.round(s.p) + ' s' : ''}${s.d != null ? ' ' + dirName(s.d) : ''} ${s.out ? '<small>ignored</small>' : wt(s.w)}</span>`).join('');
  const obs = k.obs ? `<div class="src-row"><span class="src-k">Measured</span><span><b>${esc(k.obs.station)}</b> (${k.obs.km} km, ${k.obs.t}) ${kts(k.obs.ws)} kts${k.obs.wd != null ? ' ' + dirName(k.obs.wd) : ''}${k.obs.temp != null ? ` · ${Math.round(k.obs.temp)}°C` : ''} ${k.obsW ? wt(k.obsW) : '<small>not used</small>'}</span></div>` : '';
  const conf = k.conf != null ? `<span class="src-conf lvl-${k.conf >= 0.75 ? 3 : k.conf >= 0.45 ? 2 : 1}">${confWord(k.conf)} confidence</span>` : '';
  const checks = k.src.wind.reduce((a, s) => a + (s.n || 0), 0);
  const open = foldOpen(el, 'details.src', false);
  el.hidden = false;
  el.innerHTML = `
    <details class="fold src"${open}>
      <summary><span class="k">Sources</span>${conf}</summary>
      <div class="src-row"><span class="src-k">Wind</span>${wind}<span class="src-sum">→ ${kts(k.model ? k.model.ws : k.ws)} kts ${dirName(k.model ? k.model.wd : k.wd)} from the models${k.obsW ? `, ${kts(k.ws)} kts ${dirName(k.wd)} with the station` : ''}${k.src.windSpread ? ` · ${k.src.windSpread}° spread` : ''}</span></div>
      <div class="src-row"><span class="src-k">Swell</span>${swell}<span class="src-sum">→ ${hgt(k.h)} ${Math.round(k.p)} s ${k.d != null ? dirName(k.d) : ''}</span></div>
      ${obs}
      <div class="src-note">Outliers are set aside, then models are blended by weight: grid resolution, and how well each has matched measurements${sharedSkill && sharedSkill.updated ? ` (IPMA stations and IH buoys, checked every few hours, last ${sharedSkill.updated.slice(0, 16).replace('T', ' ')} UTC)` : ''}${checks ? `, plus ${checks} station checks on this device` : ''}. A fresh, close station reading is folded into the current wind.</div>
    </details>`;
}

// The whole day as four graph cards on one 24-hour axis: quality hour
// by hour, surf (face height at the beach), wind with gusts and
// direction, and the tide curve. Night is shaded; now is a solid line.
/* Any day, hour by hour: the row of days above the graphs picks which
   (today unless another is picked; the 16-day page links straight to a
   day). The days come from the worker's build, else this spot's own
   16-day blend; today's graphs keep "now", the others show the whole day. */
let viewDay = null;          // the picked date, or null for today
const spotDays = {};         // spot id → [{ date, hours, sun, tides }] from today on
async function loadSpotDays(c) {
  if (c.id in spotDays) return spotDays[c.id];
  spotDays[c.id] = null;   // in flight
  let days = [];
  try {
    const fc = await loadWorkerForecast(), s = fc.spots[c.id];
    const today = spotNow(s.offset).slice(0, 10);
    days = s.days.filter((d) => d.date >= today);
  } catch {
    try {
      const [lat, lng] = offshore(c), q = `latitude=${lat}&longitude=${lng}&forecast_days=16&timezone=auto`;
      const [m, w] = await Promise.all([
        fetch(`https://marine-api.open-meteo.com/v1/marine?${q}&hourly=${MARINE.join()}&models=${modelIds(MARINE_MODELS)}`).then((r) => r.json()),
        fetch(`https://api.open-meteo.com/v1/forecast?${q}&hourly=${WIND.join()}&models=${modelIds(WIND_MODELS)}&daily=sunrise,sunset`).then((r) => r.json()),
      ]);
      if (!m.error && !w.error) days = blendSpot(c, m, w).days;   // score.js
    } catch {}
  }
  return (spotDays[c.id] = days.map((d) => ({ date: d.date, hours: d.hours, sun: d.sun, tides: d.tides })));
}
// The daylight average, for a day's dot in the row.
function dayAverage(c, hs) {
  const t = hs.filter((k) => !isDark(c, k) && hourOf(k.t) >= 6 && hourOf(k.t) < 20).map((k) => score(c, k)).filter(Boolean).map((r) => r.total);
  return t.length ? Math.round(t.reduce((a, x) => a + x, 0) / t.length * 2) / 2 : null;
}
function dayPicker(c) {
  const list = spotDays[c.id];
  if (list === undefined) loadSpotDays(c).then(() => { if ($('v-go').dataset.go === c.id && !viewer.hidden) renderToday(c); });
  if (!list || list.length < 2) return '<span class="k">Today</span>';
  return '<div class="day-pick" role="tablist" aria-label="Pick a day">' + list.map((d, i) => {
    const s = i === 0 && conditions[c.id] ? dayAverage(c, conditions[c.id].hours) : dayAverage(c, d.hours);
    const on = i === 0 ? !viewDay : viewDay === d.date, dt = new Date(d.date + 'T12:00');
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${DAY_NAMES[dt.getDay()]} ${dt.getDate()}`;
    return `<button type="button" role="tab" aria-selected="${on}" data-vday="${i === 0 ? '' : d.date}"${i >= 7 ? ' class="far" title="A trend this far out"' : ''}>` +
      `<i class="${s == null ? 'lvl-x' : 'lvl-' + levelOf(s)}" aria-hidden="true"></i>${label}</button>`;
  }).join('') + '</div>';
}

function renderToday(c) {
  const pick = viewDay && (spotDays[c.id] || []).find((d) => d.date === viewDay);
  const isToday = !pick;
  const cnd = pick || conditions[c.id], hs = cnd && cnd.hours;
  const el = $('v-today');
  if (!hs || hs.length < 3 || (isToday && !cnd.now)) { el.hidden = true; el.innerHTML = ''; return; }
  const byHour = Array(24).fill(null);
  for (const k of hs) byHour[hourOf(k.t)] = k;
  const hhmm = (s) => (s ? parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(3, 5), 10) : null);
  const pct = (m) => (100 * m / 1440).toFixed(2) + '%';
  const pad = (n) => String(n).padStart(2, '0');
  const rise = cnd.sun && hhmm(cnd.sun.rise), set = cnd.sun && hhmm(cnd.sun.set);
  const nowM = isToday ? new Date().getHours() * 60 + new Date().getMinutes() : null, nowH = isToday ? Math.floor(nowM / 60) : -1;
  // What the headlines describe before you scrub: now today, midday on another day.
  const now = isToday ? cnd.now : byHour[12] || hs[Math.floor(hs.length / 2)];
  // Too dark to surf: the same rule as the score (sun 6° down), not sunset itself.
  const dark = (h) => (byHour[h] ? isDark(c, byHour[h]) : rise != null && set != null && ((h + 1) * 60 <= rise || h * 60 >= set));
  const cls = (h) => (h === nowH ? ' now' : h < nowH ? ' past' : '') + (dark(h) ? ' dark' : '');
  const night = rise != null && set != null
    ? `<span class="night" style="left:0;width:${pct(rise)}"></span><span class="night" style="left:${pct(set)};right:0"></span>` : '';
  const nowLine = isToday ? `<span class="nowline" style="left:${pct(nowM)}"></span>` : '';
  // Hour labels make room for the "now" tag.
  const axis = '<div class="axis">' +
    [3, 6, 9, 12, 15, 18, 21].filter((x) => !isToday || Math.abs(x * 60 - nowM) > 150)
      .map((x) => `<span style="left:${pct(x * 60)}">${x === 12 ? 'Noon' : x}</span>`).join('') +
    (isToday ? `<span class="now-tag" style="left:${pct(Math.min(1380, Math.max(60, nowM)))}">${fmtMins(nowM)}</span>` : '') +
    '<button class="sel-tag" type="button" aria-label="Back to now" hidden></button></div>';
  const plot = (kind, inner, extra = '') =>
    `<div class="plot ${kind}">${night}${inner}${nowLine}<span class="cursor" hidden></span></div>${extra}${axis}`;
  const card = (g, label, big, sub, graph, key = '') =>
    `<div class="graph" data-g="${g}" tabindex="0" aria-label="${label} through the day; arrow keys step the hour"><div class="g-head"><span class="k">${label}</span>${key}</div>` +
    `<span class="g-big">${big}</span><div class="g-sub">${sub}</div>${graph}</div>`;
  // What each card says by default (the day) and at any one hour, for
  // scrubbing; filled in as each card is built.
  const def = {}, hour = {};
  const daylight = (h) => byHour[h] && !dark(h);
  const short = (m) => (units === 'ft' ? String(Math.round(m * 3.281)) : m.toFixed(1));
  const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

  // Quality: one segment per hour, and the best three daylight hours.
  // Night hours show what they'd score with light, dimmed.
  const scores = byHour.map((k) => (k ? score(c, k) : null));
  const sc = (r) => (r ? (r.dark ? r.lit || 0 : r.total) : 0);
  const band = plot('band', '<span class="bars">' + scores.map((r, h) =>
    `<span class="${sc(r) > 0 ? 'lvl-' + levelOf(sc(r)) : 'lvl-x'}${cls(h)}" title="${pad(h)}:00${r ? ' · ' + fmt(sc(r)) + (r.dark ? ' if it were light' : '') : ''}"><i></i></span>`).join('') + '</span>');
  const lit = scores.filter((r, h) => r && r.total > 0 && !dark(h)).map((r) => r.total);
  const qLo = lit.length ? levelOf(Math.min(...lit)) : null, qHi = lit.length ? levelOf(Math.max(...lit)) : null;
  let best = null;
  for (let h = 0; h <= 21; h++) {
    const w = [h, h + 1, h + 2].filter(daylight).map((x) => scores[x]).filter(Boolean);
    if (w.length < 3) continue;
    const avg = w.reduce((s, r) => s + r.total, 0) / 3;
    if (!best || avg > best.avg) best = { h, avg };
  }
  def.quality = [
    qLo == null ? 'No light left' : qLo === qHi ? LEVELS[qHi] : `${LEVELS[qLo]} to ${LEVELS[qHi]}`,
    best ? `Best <b>${pad(best.h)}:00–${pad(best.h + 3)}:00</b>, around ${fmt(Math.round(best.avg * 2) / 2)}/10` : 'Hour by hour; daylight hours count'];
  hour.quality = (h) => {
    const r = scores[h];
    if (!r) return null;
    if (r.dark) return [`${r.lit ? fmt(r.lit) : '–'}<small>/10 if it were light</small>`, `<b>${pad(h)}:00</b> · dark`];
    if (r.total === 0) return [`Flat<small></small>`, `<b>${pad(h)}:00</b> · ${r.cap ? esc(r.cap) : 'too small'}`];
    return [`${fmt(r.total)}<small>/10 ${LEVELS[r.level]}</small>`,
      `<b>${pad(h)}:00</b> · ${r.cap ? esc(r.cap) : esc(cap(r.wind)) + ' wind'}`];
  };
  const quality = card('quality', 'Quality', ...def.quality, band);

  // Surf: breaking face height at the beach, the day's peak labelled.
  const faces = byHour.map((k) => (k && k.h != null ? faceRange(c, k) : null));
  const dayFaces = faces.filter((f, h) => f && !dark(h));
  const useFaces = dayFaces.length ? dayFaces : faces.filter(Boolean);
  const fLo = Math.min(...useFaces.map((f) => f[0])), fHi = Math.max(...useFaces.map((f) => f[1]));
  const fTop = Math.max(...faces.filter(Boolean).map((f) => f[1]), 0.5) * 1.2;
  const fPeak = faces.reduce((p, f, h) => (f && (p < 0 || f[1] > faces[p][1]) ? h : p), -1);
  const surfBars = '<span class="bars">' + faces.map((f, h) => {
    if (!f) return '<span></span>';
    const top = 100 * f[1] / fTop;
    return `<span class="${cls(h)}" title="${pad(h)}:00 · ${rng(f[0], f[1])}"><i style="height:${Math.max(4, top).toFixed(1)}%"></i>` +
      (h === fPeak ? `<em style="bottom:${top.toFixed(1)}%">${short(f[1])}</em>` : '') + '</span>';
  }).join('') + '</span>';
  // Main swell, plus the secondary when there's one worth surfing or crossing it.
  const swellTxt = (k) => `swell <b>${hgt(k.h)}</b> ${Math.round(k.p)} s${k.d != null ? ' ' + dirName(k.d) : ''}` +
    (k.h2 != null && k.h2 >= 0.2 && k.p2 >= 6 && k.d2 != null ? ` + <b>${hgt(k.h2)}</b> ${Math.round(k.p2)} s ${dirName(k.d2)}` : '');
  const unit = (s) => s.replace(/ (m|ft)$/, '<small>$1</small>');
  def.surf = [unit(rng(fLo, fHi)), `${esc(sizeWord(fHi))} · ${swellTxt(now)}`];
  hour.surf = (h) => (faces[h]
    ? [unit(rng(faces[h][0], faces[h][1])), `<b>${pad(h)}:00</b> · ${esc(sizeWord(faces[h][1]))} · ${swellTxt(byHour[h])}`] : null);
  const surf = card('surf', 'Surf', ...def.surf, plot('surf', surfBars));

  // Wind: speed bars coloured by how the spot takes it, gusts as a paler
  // cap, the peak labelled, and direction arrows every three hours.
  const wTop = Math.max(...hs.map((k) => Math.max(k.ws || 0, k.wg || 0)), 15) * 1.15;
  const wPeak = byHour.reduce((p, k, h) => (k && (p < 0 || k.ws > byHour[p].ws) ? h : p), -1);
  const windBars = '<span class="bars">' + byHour.map((k, h) => {
    if (!k) return '<span></span>';
    const gust = k.wg != null ? Math.max(k.wg, k.ws) : k.ws;
    return `<span class="${REL_SHORT[windRel(c, k)]}${cls(h)}" title="${pad(h)}:00 · ${kts(k.ws)} kts ${dirName(k.wd)}${k.wg != null ? ', gusts ' + kts(k.wg) : ''}">` +
      (k.wg != null ? `<u style="height:${(100 * gust / wTop).toFixed(1)}%"></u>` : '') +
      `<i style="height:${Math.max(4, 100 * k.ws / wTop).toFixed(1)}%"></i>` +
      (h === wPeak ? `<em style="bottom:${(100 * gust / wTop).toFixed(1)}%">${kts(k.ws)}</em>` : '') + '</span>';
  }).join('') + '</span>';
  const arrows = '<div class="w-arrows">' + [1, 4, 7, 10, 13, 16, 19, 22].filter((h) => byHour[h]).map((h) => {
    const k = byHour[h];
    return `<span class="${REL_SHORT[windRel(c, k)]}" style="left:${((h + 0.5) / 24 * 100).toFixed(2)}%;--rot:${Math.round(k.wd + 180)}deg" title="${pad(h)}:00 from ${dirName(k.wd)}">${GLYPH}</span>`;
  }).join('') + '</div>';
  const windTxt = (k) => [`${kts(k.ws)}<small>kts ${dirName(k.wd)}</small>`,
    esc(cap(windRel(c, k))) + (k.wg != null ? ` · gusts <b>${kts(k.wg)} kts</b>` : '')];
  if (isToday) def.wind = windTxt(now);
  else {
    const day = hs.filter((k) => !isDark(c, k)), ws = (day.length ? day : hs).map((k) => k.ws);
    def.wind = [`${kts(Math.min(...ws))}–${kts(Math.max(...ws))}<small>kts</small>`, `${esc(cap(windRel(c, now)))} around midday, from ${dirName(now.wd)}`];
  }
  hour.wind = (h) => { if (!byHour[h]) return null; const [b, s] = windTxt(byHour[h]); return [b, `<b>${pad(h)}:00</b> · ${s}`]; };
  const wind = card('wind', 'Wind', ...def.wind,
    plot('wind', windBars, arrows),
    '<span class="g-key"><span><i style="--c:#9eb05c"></i>off</span><span><i style="--c:#9fb3c8"></i>cross</span><span><i style="--c:#ff5a5a"></i>on</span></span>');

  // Tide: the shape and the times. The model's absolute heights sit well
  // off the local tide table, so no metres are printed.
  let tide = '';
  const tp = hs.filter((k) => k.tide != null).map((k) => [(hourOf(k.t) + 0.5) * 60, k.tide]);
  if (tp.length >= 3) {
    const tMin = Math.min(...tp.map((p) => p[1])), tMax = Math.max(...tp.map((p) => p[1]));
    const span = Math.max(0.3, tMax - tMin);
    const Y = (v) => 80 - 58 * (v - tMin) / span;
    const at = (m) => {
      if (m <= tp[0][0]) return tp[0][1];
      for (let i = 1; i < tp.length; i++) {
        if (m <= tp[i][0]) { const [m0, v0] = tp[i - 1], [m1, v1] = tp[i]; return v0 + (v1 - v0) * (m - m0) / (m1 - m0); }
      }
      return tp[tp.length - 1][1];
    };
    const X = (m) => (100 * m / 1440).toFixed(2);
    const line = [[0, tp[0][1]], ...tp, [1440, tp[tp.length - 1][1]]].map(([m, v]) => `${X(m)},${Y(v).toFixed(1)}`);
    const svg = '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="tide-fill" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" style="stop-color:var(--sea-bar);stop-opacity:.45"/><stop offset="1" style="stop-color:var(--sea-bar);stop-opacity:.04"/></linearGradient></defs>' +
      `<path d="M0,100 L${line.join(' L')} L100,100 Z" fill="url(#tide-fill)"/>` +
      `<polyline points="${line.join(' ')}" fill="none" style="stroke:var(--sea-bar)" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
    const evs = (cnd.tides || []).map((e) => {
      const left = Math.min(94, Math.max(6, 100 * e.mins / 1440)).toFixed(2) + '%', top = Y(at(e.mins)).toFixed(1) + '%';
      return `<span class="tdot" style="left:${X(e.mins)}%;top:${top}"></span>` +
        `<span class="tlab ${e.kind === 'High' ? 'hi' : 'lo'}" style="left:${left};top:${top}">${fmtMins(e.mins)}<small>${e.kind}</small></span>`;
    }).join('');
    const nowDot = isToday ? `<span class="tdot now" style="left:${X(nowM)}%;top:${Y(at(nowM)).toFixed(1)}%"></span>` : '';
    const selDot = '<span class="tdot sel" hidden></span>';
    const inTxt = (from, m) => { const d = m - from; return d < 60 ? `${d} min` : `${Math.floor(d / 60)} h ${pad(d % 60)}`; };
    const tideTxt = (k, from) => {
      const next = (cnd.tides || []).find((e) => e.mins > from);
      return [cap(k.tn != null ? tideWord(k.tn) : 'tide') + (k.tdir ? `<small>${k.tdir === 'rising' ? '▲ rising' : '▼ falling'}</small>` : ''),
        next ? `${next.kind} at <b>${fmtMins(next.mins)}</b> · in ${inTxt(from, next.mins)}` : esc(tideTimes(cnd))];
    };
    def.tide = isToday ? tideTxt(now, nowM)
      : ['High &amp; low', (cnd.tides || []).map((e) => `${e.kind} <b>${fmtMins(e.mins)}</b>`).join(' · ') || 'no times'];
    hour.tide = (h) => {
      if (!byHour[h]) return null;
      const [b, s] = tideTxt(byHour[h], h * 60 + 30);
      return [b, `<b>${pad(h)}:00</b> · ${s}`];
    };
    hour.tideAt = (h) => [X(h * 60 + 30), Y(at(h * 60 + 30)).toFixed(1)];
    tide = card('tide', 'Tide', ...def.tide, plot('tide', svg + evs + nowDot + selDot));
  }

  // Keep the row of days where it was scrolled to, and the sheet where it
  // was, across the redraw.
  const pickX = el.querySelector('.day-pick') ? el.querySelector('.day-pick').scrollLeft : 0;
  const sheet = viewer.querySelector('.sheet'), sheetY = sheet ? sheet.scrollTop : 0;
  el.hidden = false;
  el.innerHTML =
    `<div class="today-head">${dayPicker(c)}</div>` +
    `<p class="today-sum">${esc(daySummary(c, hs, isToday))}</p>` +
    `<div class="day-graphs">${quality}${surf}${wind}${tide}</div>`;
  el._scrub = { def, hour };
  el._sel = null;   // fresh render shows the day again
  const pk = el.querySelector('.day-pick');
  if (pk) pk.scrollLeft = pickX;
  if (sheet) sheet.scrollTop = sheetY;
}

// Scrub the day: hover, or drag a finger across any graph, and one cursor
// runs through all four while each headline shows that hour. The mouse
// leaving, or the finger lifting, puts it back to now. Plots only claim
// horizontal drags, so the sheet still scrolls (a scroll cancels the touch).
const todayEl = $('v-today');
const hourAt = (e) => {
  const p = e.target.closest('.plot, .axis, .w-arrows');
  if (!p) return null;
  const r = p.getBoundingClientRect();
  return Math.max(0, Math.min(23, Math.floor((e.clientX - r.left) / r.width * 24)));
};
function selectHour(h) {
  const s = todayEl._scrub;
  if (!s) return;
  if (h === todayEl._sel) return;
  todayEl._sel = h;
  for (const g of todayEl.querySelectorAll('.graph')) {
    const v = h == null ? s.def[g.dataset.g] : s.hour[g.dataset.g](h) || s.def[g.dataset.g];
    g.querySelector('.g-big').innerHTML = v[0];
    g.querySelector('.g-sub').innerHTML = v[1];
    g.classList.toggle('scrub', h != null);
  }
  const left = h == null ? '' : ((h + 0.5) / 24 * 100).toFixed(2) + '%';
  for (const cur of todayEl.querySelectorAll('.cursor')) { cur.hidden = h == null; cur.style.left = left; }
  for (const t of todayEl.querySelectorAll('.sel-tag')) {
    t.hidden = h == null;
    if (h != null) { t.style.left = `clamp(26px, ${left}, calc(100% - 26px))`; t.textContent = String(h).padStart(2, '0') + ':00'; }
  }
  for (const col of todayEl.querySelectorAll('.bars > .sel')) col.classList.remove('sel');
  if (h != null) for (const bars of todayEl.querySelectorAll('.bars')) bars.children[h] && bars.children[h].classList.add('sel');
  const dot = todayEl.querySelector('.tdot.sel');
  if (dot) {
    dot.hidden = h == null;
    if (h != null && s.hour.tideAt) { const [x, y] = s.hour.tideAt(h); dot.style.left = x + '%'; dot.style.top = y + '%'; }
  }
}
todayEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-vday]');
  if (!b) return;
  viewDay = b.dataset.vday || null;
  const c = byId($('v-go').dataset.go);
  if (c) renderToday(c);
});
todayEl.addEventListener('pointerdown', (e) => {
  if (e.target.closest('.sel-tag')) { selectHour(null); return; }
  const h = hourAt(e);
  if (h == null) return;
  todayEl._drag = true;
  selectHour(h);
});
todayEl.addEventListener('pointermove', (e) => {
  if (e.pointerType !== 'mouse' && !todayEl._drag) return;
  const h = hourAt(e);
  if (h != null) selectHour(h);
});
// A touch ends however it ends (lift, scroll taking over, finger sliding
// off): the cursor goes and the headlines return to now. iOS doesn't always
// send the pointer event, so the touch events end it too.
const endDrag = (e) => {
  const wasDrag = todayEl._drag;
  todayEl._drag = false;
  if (e.pointerType === 'mouse' ? e.type === 'pointerleave' : wasDrag || e.type.startsWith('touch')) selectHour(null);
};
for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) todayEl.addEventListener(ev, endDrag);
for (const ev of ['touchend', 'touchcancel']) todayEl.addEventListener(ev, (e) => { if (!e.touches.length) endDrag(e); }, { passive: true });
// Keyboard: arrow keys step the hour while a graph has focus.
todayEl.addEventListener('keydown', (e) => {
  if (!e.target.closest('.graph')) return;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const cur = todayEl._sel == null ? new Date().getHours() : todayEl._sel;
    selectHour(Math.max(0, Math.min(23, cur + (e.key === 'ArrowRight' ? 1 : -1))));
  } else if (e.key === 'Escape' && todayEl._sel != null) { e.stopPropagation(); selectHour(null); }
});

/* ---------- Opening and closing a spot ---------- */

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
  const [sid, day] = String(id).split('@');
  const c = byId(sid);
  if (!c) return;
  viewDay = /^\d{4}-\d\d-\d\d$/.test(day || '') ? day : null;
  if (viewDay) loadSpotDays(c).then(() => { if ($('v-go').dataset.go === c.id) renderToday(c); });
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
