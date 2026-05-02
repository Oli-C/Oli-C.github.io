(function () {
  'use strict';

  // Mobile browsers otherwise restore prior scroll (or anchor-shift on layout
  // change) and push the "allfield" title off-screen during the intro animations.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  // ============================================================================
  //  Shader background — FBM + domain-warp noise on a fullscreen canvas.
  //  Replaces the previous CSS blob layer. Palette is driven by the current
  //  theme + accent (via setPaintPalette, called from apply() below).
  // ============================================================================
  const setPaintPalette = (function initPaint() {
    const canvas = document.getElementById('paint-canvas');
    if (!canvas) return () => {};
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true })
            || canvas.getContext('experimental-webgl');
    if (!gl) { canvas.style.display = 'none'; return () => {}; }

    const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.0,1.0); }';
    const FRAG = [
      'precision highp float;',
      'uniform vec2 uRes;',
      'uniform float uTime;',
      'uniform vec2 uSeed;',
      'uniform vec3 uC1, uC2, uC3, uBg;',
      'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
      'float noise(vec2 p){',
      '  vec2 i=floor(p), f=fract(p);',
      '  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));',
      '  vec2 u=f*f*(3.-2.*f);',
      '  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);',
      '}',
      'float fbm(vec2 p){',
      '  float v=0., a=0.5;',
      '  for(int i=0;i<6;i++){ v+=a*noise(p); p*=2.03; a*=0.5; }',
      '  return v;',
      '}',
      'void main(){',
      '  vec2 uv = gl_FragCoord.xy / uRes;',
      '  float aspect = uRes.x / uRes.y;',
      '  float intro = smoothstep(0.0, 1.6, uTime);',
      '  float zoom  = mix(0.45, 1.0, intro);',
      '  float scale = (2.6 + 0.8 * clamp(1.0 - aspect, 0.0, 0.6)) * zoom;',
      '  vec2  p     = (uv - 0.5) * vec2(aspect, 1.0) * scale + uSeed;',
      '  vec2 m = 0.6 * vec2(fbm(p*0.35 + 0.03*uTime), fbm(p*0.35 + vec2(4.0,2.0) - 0.03*uTime));',
      '  p += m;',
      '  float t = uTime * 0.05;',
      '  // Back layer — slower, larger scale, softer movement. Sits behind everything else.',
      '  vec2 pBack = p * 0.55 + vec2(7.3, 11.7);',
      '  float tBack = uTime * 0.025;',
      '  vec2 qBack = vec2(fbm(pBack + tBack), fbm(pBack + vec2(3.1, 5.7) - tBack));',
      '  float fBack = fbm(pBack + 1.6 * qBack);',
      '  // Front layer — existing domain-warped smoke.',
      '  vec2 q = vec2(fbm(p + t), fbm(p + vec2(5.2, 1.3) - t));',
      '  vec2 r = vec2(fbm(p + 2.0*q + vec2(1.7, 9.2) + 0.15*t),',
      '                fbm(p + 2.0*q + vec2(8.3, 2.8) - 0.13*t));',
      '  float f = fbm(p + 2.3*r);',
      '  vec3 col = uBg;',
      '  // Back layer wash first (further away — wine tone, slightly dimmed).',
      '  col = mix(col, uC2 * 0.85, smoothstep(0.30, 0.85, fBack) * 0.45 * intro);',
      '  // Front layer mixes — same as before.',
      '  col = mix(col, uC1, smoothstep(mix(0.10,0.40,intro), mix(0.70,0.92,intro), f) * 0.80);',
      '  col = mix(col, uC2, smoothstep(mix(0.05,0.35,intro), mix(0.65,0.85,intro), r.y) * 0.70);',
      '  col = mix(col, uC3, smoothstep(mix(0.10,0.40,intro), mix(0.70,0.88,intro), r.x) * 0.50);',
      '  // Density self-shadow — denser smoke darkens slightly, suggesting volume.',
      '  float density = smoothstep(0.4, 0.95, f);',
      '  col *= 1.0 - density * 0.15;',
      '  float hot = pow(smoothstep(0.60, 0.94, f), 2.2);',
      '  float vig = smoothstep(1.4, 0.3, length(uv - 0.5));',
      '  col *= 0.55 + 0.45 * vig;',
      '  col += uC1 * hot * 0.35;',
      '  // Lasers — thin beams from above, fanning down, visible where smoke catches them.',
      '  vec2 srcPos = vec2(0.0, 0.7);',
      '  vec2 toPixel = (uv - 0.5) * vec2(aspect, 1.0) - srcPos;',
      '  float beamAngle = atan(toPixel.x, -toPixel.y);',
      '  float beamPhase = beamAngle * 7.0 + uTime * 0.06 + uSeed.x * 0.5;',
      '  float beam = pow(0.5 + 0.5 * cos(beamPhase), 24.0);',
      '  float beamFade = smoothstep(2.0, 0.4, length(toPixel));',
      '  float scatter = smoothstep(0.25, 0.85, f);',
      '  col += uC1 * beam * beamFade * scatter * 0.6 * intro;',
      '  col *= 1.0 + (1.0 - intro) * 0.6;',
      '  // Glitch burst — first ~200ms only. Channel split + scanlines + static for an analog flash.',
      '  float glitch = pow(max(0.0, 1.0 - uTime * 5.0), 1.4);',
      '  float ca = (uv.x - 0.5) * glitch * 0.5;',
      '  col.r *= 1.0 + ca;',
      '  col.b *= 1.0 - ca;',
      '  float scan = sin(uv.y * 400.0) * 0.5 + 0.5;',
      '  col *= 1.0 - scan * 0.35 * glitch;',
      '  float st = hash(gl_FragCoord.xy + vec2(uTime * 100.0, 0.0));',
      '  col += (st - 0.5) * glitch * 0.15;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n');

    function compile(src, type) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error('shader compile', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    }
    const vs = compile(VERT, gl.VERTEX_SHADER);
    const fs = compile(FRAG, gl.FRAGMENT_SHADER);
    if (!vs || !fs) { canvas.style.display = 'none'; return () => {}; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('program link', gl.getProgramInfoLog(prog));
      canvas.style.display = 'none';
      return () => {};
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const aLoc = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(aLoc);
    gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

    const uRes  = gl.getUniformLocation(prog, 'uRes');
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uSeed = gl.getUniformLocation(prog, 'uSeed');
    const uC1   = gl.getUniformLocation(prog, 'uC1');
    const uC2   = gl.getUniformLocation(prog, 'uC2');
    const uC3   = gl.getUniformLocation(prog, 'uC3');
    const uBg   = gl.getUniformLocation(prog, 'uBg');

    // Random per-page-load offset so the smoke pattern starts in a different
    // place every time. Doesn't affect the intro ramp since it leaves uTime alone.
    gl.uniform2f(uSeed, Math.random() * 100, Math.random() * 100);

    function resize() {
      // The smoke is naturally soft so a lower render resolution is invisible —
      // DPR-3 phones especially benefit from a tighter cap.
      const dprCap = window.innerWidth <= 640 ? 1.25 : 1.5;
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
      const w = Math.max(1, Math.floor(window.innerWidth  * dpr));
      const h = Math.max(1, Math.floor(window.innerHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w; canvas.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uRes, w, h);
    }
    resize();
    window.addEventListener('resize', resize);

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Run the intro at full 60fps; throttle steady-state to 30fps to halve GPU load.
    const INTRO_MS = 1700;
    const FRAME_INTERVAL_MS = 1000 / 30;
    let start = performance.now();
    let lastDraw = 0;
    let paused = false;
    let pausedAt = 0;

    function frame(now) {
      if (paused) return;
      const elapsed = now - start;
      const inIntro = elapsed < INTRO_MS;
      if (inIntro || now - lastDraw >= FRAME_INTERVAL_MS) {
        const t = reduceMotion ? 7.3 : elapsed * 0.001;
        gl.uniform1f(uTime, t);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        lastDraw = now;
      }
      if (!reduceMotion) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);

    // Pause cleanly when the tab is hidden; on resume, shift `start` so the
    // smoke continues from where it left off rather than jumping forward.
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        paused = true;
        pausedAt = performance.now();
      } else if (paused) {
        paused = false;
        start += performance.now() - pausedAt;
        lastDraw = 0;
        if (!reduceMotion) requestAnimationFrame(frame);
      }
    });

    function hexToRgb(hex) {
      hex = (hex || '').trim().replace('#', '');
      if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
      if (hex.length !== 6) return [1, 1, 1];
      return [
        parseInt(hex.slice(0, 2), 16) / 255,
        parseInt(hex.slice(2, 4), 16) / 255,
        parseInt(hex.slice(4, 6), 16) / 255,
      ];
    }

    // Smoke palette is now sourced from CSS — `--smoke-bg/c2/c3` per theme
    // in style.css. JS reads the active values via getComputedStyle so any
    // palette tweak only needs to happen in CSS. Accent (uC1) still flows in
    // via the chip-driven --accent variable.
    return function setPalette(_theme, accentHex) {
      const cs = getComputedStyle(document.documentElement);
      const c1 = hexToRgb(accentHex);
      const c2 = hexToRgb(cs.getPropertyValue('--smoke-c2'));
      const c3 = hexToRgb(cs.getPropertyValue('--smoke-c3'));
      const bg = hexToRgb(cs.getPropertyValue('--smoke-bg'));
      gl.useProgram(prog);
      gl.uniform3f(uC1, c1[0], c1[1], c1[2]);
      gl.uniform3f(uC2, c2[0], c2[1], c2[2]);
      gl.uniform3f(uC3, c3[0], c3[1], c3[2]);
      gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
    };
  })();

  // ============================================================================
  //  Mix data — pulled from the real Linktree export
  // ============================================================================
  const MIXES = [
    { code: 'CHA-039', title: 'Chameleon 039 - allfield meets yuba', series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON', date: '04.04.2026', y: 2026, sub: 'Chameleon series w/ Yuba',      img: 'assets/mix-cha-039.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-039-allfield-meets' },
    { code: 'ESR-026', title: 'allfield & yuba',     series: 'radio', platform: 'youtube', tag: 'EAST SIDE RADIO',  date: '30.03.2026', y: 2026, sub: 'EastSide Radio',       img: 'assets/mix-esr-026.jpeg', url: 'https://youtu.be/077Gc6lWKag' },
    { code: 'LUS-053', title: 'March Radio w/ Deo',         series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '04.03.2026', y: 2026, sub: 'Residency w/ Deo',            img: 'assets/mix-lus-053.jpeg', url: 'https://www.youtube.com/watch?v=9MukB4LP5u4' },
    { code: 'LUS-052', title: 'February Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '11.02.2026', y: 2026, sub: 'Residency solo',              img: 'assets/mix-lus-052.jpeg', url: 'https://youtu.be/r97EA6F_gzo' },

    { code: 'LUS-051', title: 'December Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '17.12.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-051.jpeg', url: 'https://youtu.be/TYiqJEyzLLg' },
    { code: 'LUS-050', title: 'November Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '06.11.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-050.jpeg', url: 'https://www.youtube.com/watch?v=aPsRk5IP6LI' },
    { code: 'LUS-049', title: 'October Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '09.10.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-049.jpeg', url: 'https://youtu.be/PCCON9M414g' },
    { code: 'CHA-032', title: 'Chameleon 032 - allfield',             series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '15.10.2025', y: 2025, sub: 'Chameleon series',              img: 'assets/mix-cha-032.jpeg', url: 'https://soundcloud.com/chamele-on-sound/shameelradio' },
    { code: 'LUS-048', title: 'September Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '14.09.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-048.jpeg', url: 'https://youtu.be/B7oj2Nuopio' },
    { code: 'LUS-047', title: 'August Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '05.08.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-047.jpeg', url: 'https://youtu.be/jkMd893bOTg' },
    { code: 'LUS-046', title: 'June Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '01.06.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-046.jpeg', url: 'https://youtu.be/VVeRAA59rNg' },
    { code: 'LUS-045', title: 'March Radio w/ Deo & Yuba', series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '28.03.2025', y: 2025, sub: 'Residency w/ Deo & Yuba',     img: 'assets/mix-lus-045.jpeg', url: 'https://youtu.be/cLIJEUMQucc' },
    { code: 'LUS-044', title: 'March Radio w/ Yuba',       series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '22.03.2025', y: 2025, sub: 'Residency w/ Yuba',           img: 'assets/mix-lus-044.jpeg', url: 'https://youtu.be/KKn916L4XLk' },
    { code: 'LUS-043', title: 'February Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '28.02.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-043.jpeg', url: 'https://youtu.be/gLq6umfBDQs' },
    { code: 'LUS-042', title: 'January Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '17.01.2025', y: 2025, sub: 'Residency solo',              img: 'assets/mix-lus-042.jpeg', url: 'https://www.youtube.com/watch?v=Et44ehuRMf0' },
    { code: 'LIV-001', title: 'live from Meridian × Chameleon', series: 'live', platform: 'soundcloud', tag: 'PECKHAM AUDIO', date: '15.01.2025', y: 2025, sub: 'Peckham Audio',   img: 'assets/mix-liv-001.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-022-allfield-live-from-meridian-x-chameleon-peckham-audio-january-2025' },

    { code: 'LUS-041', title: 'December Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '03.12.2024', y: 2024, sub: 'Residency solo',              img: 'assets/mix-lus-041.jpeg', url: 'https://www.youtube.com/watch?v=60H_ciU544Y' },
    { code: 'LUS-040', title: 'November Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '07.11.2024', y: 2024, sub: 'Residency solo',              img: 'assets/mix-lus-040.jpeg', url: 'https://youtu.be/LXWEj5mknWY' },
    { code: 'LUS-039', title: 'October Radio',               series: 'lus', platform: 'youtube',  tag: 'LUSOPHONICA', date: '03.10.2024', y: 2024, sub: 'Residency solo',              img: 'assets/mix-lus-039.jpeg', url: 'https://youtu.be/BI6-ygAuxi0' },
    { code: 'CHA-016', title: 'Chameleon 016 - allfield',             series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '22.10.2024', y: 2024, sub: 'Chameleon series',              img: 'assets/mix-cha-016.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-016-allfield-october' },
    { code: 'CHA-015', title: 'Chameleon 015 - yuba w/ allfield',     series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '19.09.2024', y: 2024, sub: 'Chameleon series w/ Yuba',    img: 'assets/mix-cha-015.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-015-yuba-wallfield-september-2024' },
    { code: 'CHA-011', title: 'Chameleon 011 - allfield',             series: 'cham', platform: 'soundcloud', tag: 'CHAMELEON',   date: '11.07.2024', y: 2024, sub: 'Chameleon series',              img: 'assets/mix-cha-011.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-011-wallfield-july-2024' },
    { code: 'CHA-008', title: 'Chameleon 008 - allfield',      series: 'cham', platform: 'soundcloud', tag: 'VOICES',      date: '14.03.2024', y: 2024, sub: 'Voices Radio',         img: 'assets/mix-cha-008.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-008-w-allied-on-voices-radio-march-2024' },

    { code: 'CHA-005', title: 'Chameleon 005 - allfield',      series: 'cham', platform: 'soundcloud', tag: 'VOICES',      date: '21.12.2023', y: 2023, sub: 'Voices Radio',         img: 'assets/mix-cha-005.jpeg', url: 'https://soundcloud.com/chamele-on-sound/chameleon-007-w-allfield-on-voices-radio-december-2023' }
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

  // Follow the OS dark/light preference until the user manually picks a theme
  // chip. oxblood is opt-in only; auto resolves to charcoal or light.
  const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
  let userChoseTheme = false;
  state.theme = sysDark.matches ? 'charcoal' : 'light';
  sysDark.addEventListener('change', e => {
    if (userChoseTheme) return;
    state.theme = e.matches ? 'charcoal' : 'light';
    apply();
  });

  function apply() {
    root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-accent', state.accent);
    root.style.setProperty('--grain', String(state.grain / 100));
    grainVal.textContent = state.grain;
    grainSlider.value = state.grain;
    timelineToggle.checked = !!state.showTimeline;

    setPaintPalette(state.theme, getComputedStyle(root).getPropertyValue('--accent'));

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
      chip.addEventListener('click', () => {
        state[key] = chip.dataset.value;
        if (key === 'theme') userChoseTheme = true;
        apply();
        persist();
      });
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
