(function () {
  'use strict';

  // ============================================================================
  //  Mix data — pulled from the real Linktree export
  // ============================================================================
  const MIXES = [
    { code: 'CHA-039', title: 'Chameleon 039 - allfield meets yuba', series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON', date: '26.04.2026', y: 2026, sub: 'Chameleon series w/ Yuba',      img: 'assets/mix-cham039.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-039-allfield-meets' },
    { code: 'ESR-026', title: 'allfield & yuba',     series: 'radio', platform: 'youtube', tag: 'EAST SIDE RADIO',  date: '30.03.2026', y: 2026, sub: 'EastSide Radio',       img: 'assets/mix-eastside.jpeg', url: 'https://youtu.be/077Gc6lWKag' },
    { code: 'LUS-053', title: 'March Radio w/ Deo',         series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '04.03.2026', y: 2026, sub: 'Residency w/ Deo',            img: 'assets/mix-lus-0304.jpeg', url: 'https://www.youtube.com/watch?v=9MukB4LP5u4' },
    { code: 'LUS-052', title: 'February Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '11.02.2026', y: 2026, sub: 'Residency solo',              img: 'assets/mix-lus-1102.jpeg', url: 'https://youtu.be/r97EA6F_gzo' },

    { code: 'LUS-051', title: 'December Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '17.12.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-1712.jpeg', url: 'https://youtu.be/TYiqJEyzLLg' },
    { code: 'LUS-050', title: 'November Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '06.11.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-0611.jpeg', url: 'https://www.youtube.com/watch?v=aPsRk5IP6LI' },
    { code: 'LUS-049', title: 'October Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '09.10.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-0910.jpeg', url: 'https://youtu.be/PCCON9M414g' },
    { code: 'CHA-032', title: 'Chameleon 032 - allfield',             series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '15.10.2025', y: 2025, sub: 'Chameleon series',              img: 'assets/mix-cham032.jpeg', url: 'https://soundcloud.com/chamele-on-sound/shameelradio' },
    { code: 'LUS-048', title: 'September Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '14.09.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-1409.jpeg', url: 'https://youtu.be/B7oj2Nuopio' },
    { code: 'LUS-047', title: 'August Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '05.08.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-0508.jpeg', url: 'https://youtu.be/jkMd893bOTg' },
    { code: 'LUS-046', title: 'June Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '01.06.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-0106.jpeg', url: 'https://youtu.be/VVeRAA59rNg' },
    { code: 'LUS-045', title: 'March Radio w/ Deo & Yuba', series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '28.03.2025', y: 2025, sub: 'Residency w/ Deo & Yuba',     img: 'assets/mix-lus-2803.jpeg', url: 'https://youtu.be/cLIJEUMQucc' },
    { code: 'LUS-044', title: 'March Radio w/ Yuba',       series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '22.03.2025', y: 2025, sub: 'Residency w/ Yuba',           img: 'assets/mix-lus-2203.jpeg', url: 'https://youtu.be/KKn916L4XLk' },
    { code: 'LUS-043', title: 'February Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '28.02.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-2802.jpeg', url: 'https://youtu.be/gLq6umfBDQs' },
    { code: 'LUS-042', title: 'January Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '17.01.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-1701.jpeg', url: 'https://www.youtube.com/watch?v=Et44ehuRMf0' },
    { code: 'LIV-001', title: 'live from Meridian × Chameleon', series: 'live', platform: 'soundcloud', tag: 'PECKHAM AUDIO', date: '15.01.2025', y: 2025, sub: 'Peckham Audio',   img: 'assets/mix-meridian.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-022-allfield-live-from-meridian-x-chameleon-peckham-audio-january-2025' },

    { code: 'LUS-041', title: 'December Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '03.12.2024', y: 2024, sub: 'Residency solo',              img: 'assets/mix-lus-0312.jpeg', url: 'https://www.youtube.com/watch?v=60H_ciU544Y' },
    { code: 'LUS-040', title: 'November Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '07.11.2024', y: 2024, sub: 'Residency solo',              img: 'assets/mix-lus-0711.jpeg', url: 'https://youtu.be/LXWEj5mknWY' },
    { code: 'LUS-039', title: 'October Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '03.10.2024', y: 2024, sub: 'Residency solo',              img: 'assets/mix-lus-0310.jpeg', url: 'https://youtu.be/BI6-ygAuxi0' },
    { code: 'CHA-016', title: 'Chameleon 016 - allfield',             series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '22.10.2024', y: 2024, sub: 'Chameleon series',              img: 'assets/mix-cham016.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-016-allfield-october' },
    { code: 'CHA-015', title: 'Chameleon 015 - yuba w/ allfield',     series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '19.09.2024', y: 2024, sub: 'Chameleon series w/ Yuba',    img: 'assets/mix-cham015.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-015-yuba-wallfield-september-2024' },
    { code: 'CHA-011', title: 'Chameleon 011 - allfield',             series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '11.07.2024', y: 2024, sub: 'Chameleon series',              img: 'assets/mix-cham011.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-011-wallfield-july-2024' },
    { code: 'CHA-008', title: 'Chameleon 008 - allfield',      series: 'cham', platform: 'soundcloud', tag: 'VOICES',      date: '14.03.2024', y: 2024, sub: 'Voices Radio',         img: 'assets/mix-cham008.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-008-w-allied-on-voices-radio-march-2024' },

    { code: 'CHA-005', title: 'Chameleon 005 - allfield',      series: 'cham', platform: 'soundcloud', tag: 'VOICES',      date: '21.12.2023', y: 2023, sub: 'Voices Radio',         img: 'assets/mix-cham005.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-007-w-allfield-on-voices-radio-december-2023' }
  ];

  // ============================================================================
  //  Render
  // ============================================================================
  // Sort strictly by date descending (date is DD.MM.YYYY)
  MIXES.sort((a, b) => {
    const [ad, am, ay] = a.date.split('.').map(Number);
    const [bd, bm, by] = b.date.split('.').map(Number);
    return (by - ay) || (bm - am) || (bd - ad);
  });
  // Keep y in sync in case it was ever stale
  MIXES.forEach(m => { m.y = Number(m.date.split('.')[2]); });

  const mixesEl = document.getElementById('mixes');

  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c])); }

  // Minimal platform glyphs — sized to sit inline with the tag.
  const PLATFORM_ICONS = {
    soundcloud: '<svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M1 18v-4l1 .5v3.5zm2 0v-6l1 .5v5.5zm2 0v-8l1 .5v7.5zm2 0v-9l1 .5v8.5zm2 0v-10l1 .5v9.5zm3-10.5c0-.3.2-.5.5-.5s.5.2.5.5V18h-1V7.5zm2 0c0-.3.2-.5.5-.5s.5.2.5.5V18h-1V7.5zM14 6.5c0-.3.2-.5.5-.5s.5.2.5.5V18h-1V6.5zM16 8c0-.3.2-.5.5-.5s.5.2.5.5v10h-1V8zm2.5-.5c2 0 3.5 1.6 3.5 3.5 0 .4-.1.8-.2 1.2.7.5 1.2 1.3 1.2 2.3 0 1.4-1.1 2.5-2.5 2.5H18V8c.2-.3.4-.5.5-.5z"/></svg>',
    mixcloud:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="6" cy="13" r="2.2"/><circle cx="10" cy="13" r="2.2"/><circle cx="14" cy="13" r="2.2"/><circle cx="18" cy="13" r="2.2"/><path d="M4 17c2 1.5 4 2 8 2s6-.5 8-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4 9c2-1.5 4-2 8-2s6 .5 8 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    youtube:    '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><rect x="2" y="6" width="20" height="12" rx="3" fill="currentColor"/><path d="M10 9.5v5l5-2.5z" fill="var(--bg-1)"/></svg>',
  };
  const PLATFORM_LABEL = { soundcloud: 'SoundCloud', mixcloud: 'Mixcloud', youtube: 'YouTube' };
  function platformBadge(p) {
    if (!p || !PLATFORM_ICONS[p]) return '';
    return `<span class="mix-plat" data-plat="${p}" title="${PLATFORM_LABEL[p]}" aria-label="${PLATFORM_LABEL[p]}">${PLATFORM_ICONS[p]}</span>`;
  }

  function render() {
    let html = '';
    let currentY = null;
    let i = 0;
    for (const m of MIXES) {
      if (m.y !== currentY) {
        currentY = m.y;
        html += `<div class="yr"><span class="yr-num">${m.y}</span><span class="yr-line"></span></div>`;
      }
      html += `
        <a href="${m.url || '#'}" class="mix" data-series="${m.series}" style="--i:${i++}"${m.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>
          <div class="mix-rail"></div>
          <div class="mix-art">
            <img src="${m.img}" alt="" loading="lazy">
            <div class="mix-play"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>
          </div>
          <div class="mix-body">
            <div class="mix-meta">
              <span class="mix-date">${esc(m.date)}</span>
            </div>
            <div class="mix-title">${esc(m.title)}</div>
          </div>
          <div class="mix-right">
            ${platformBadge(m.platform)}
            <span class="mix-tag">${esc(m.tag)}</span>
            <svg class="mix-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 17L17 7M17 7H9M17 7v8"/></svg>
          </div>
        </a>`;
    }
    mixesEl.innerHTML = html;
  }
  render();

  // ============================================================================
  //  Tweaks — live preview + persistence
  // ============================================================================
  const root = document.documentElement;
  const tweaksEl = document.getElementById('tweaks');
  const grainSlider = document.getElementById('grainSlider');
  const grainVal = document.getElementById('grainVal');
  const timelineToggle = document.getElementById('timelineToggle');

  let state = Object.assign({}, TWEAK_DEFAULTS);

  function apply() {
    root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-accent', state.accent);
    root.style.setProperty('--grain', String(state.grain / 100));
    grainVal.textContent = state.grain;
    grainSlider.value = state.grain;
    timelineToggle.checked = !!state.showTimeline;

    // View toggle
    mixesEl.classList.toggle('cards', state.view === 'cards');
    mixesEl.classList.toggle('log', state.view === 'log');
    mixesEl.classList.toggle('show-rail', !!state.showTimeline);

    // Chip active states
    document.querySelectorAll('[data-chips] .chip').forEach(c => {
      const key = c.parentElement.dataset.chips;
      c.classList.toggle('active', c.dataset.value === state[key]);
    });
  }

  function persist() {
    try { window.parent.postMessage({ type: '__edit_mode_set_keys', edits: state }, '*'); } catch (e) {}
  }

  document.querySelectorAll('[data-chips]').forEach(group => {
    const key = group.dataset.chips;
    group.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => { state[key] = chip.dataset.value; apply(); persist(); });
    });
  });

  grainSlider.addEventListener('input', () => { state.grain = parseInt(grainSlider.value, 10); apply(); });
  grainSlider.addEventListener('change', persist);

  timelineToggle.addEventListener('change', () => { state.showTimeline = timelineToggle.checked; apply(); persist(); });

  // Edit-mode messaging — register listener before announcing
  window.addEventListener('message', (ev) => {
    const d = ev.data || {};
    if (d.type === '__activate_edit_mode') tweaksEl.classList.add('open');
    if (d.type === '__deactivate_edit_mode') tweaksEl.classList.remove('open');
  });
  try { window.parent.postMessage({ type: '__edit_mode_available' }, '*'); } catch (e) {}

  apply();
})();
