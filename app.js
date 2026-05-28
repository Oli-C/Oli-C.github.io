(function () {
  'use strict';

  // Mobile browsers otherwise restore prior scroll (or anchor-shift on layout
  // change) and push the "allfield" title off-screen during the intro animations.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  // ============================================================================
  //  Intro title sequence — split the hero name into letters for the cascade
  //  reveal: each letter starts at a random scattered offset and flies into
  //  place, fading clear from a smoky blur (CSS handles the animation; JS just
  //  randomizes the per-letter offsets). No veil; page is visible immediately.
  //  Degrades gracefully (name stays legible) if JS doesn't run.
  // ============================================================================
  (function initIntro() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Split "allfield" into per-letter spans (.ch) for the staggered reveal.
    const nameEl = document.querySelector('.id-name');
    if (nameEl && !nameEl.dataset.split) {
      const text = nameEl.textContent.trim();
      nameEl.setAttribute('aria-label', text);
      nameEl.textContent = '';
      [...text].forEach((c, i) => {
        const s = document.createElement('span');
        s.className = 'ch';
        s.style.setProperty('--ci', i);
        s.setAttribute('aria-hidden', 'true');
        s.textContent = c === ' ' ? ' ' : c;
        nameEl.appendChild(s);
      });
      nameEl.dataset.split = '1';
    }

    if (reduce || !nameEl) return; // letters already show their final characters

    // Scatter each letter to a random off-position; the CSS ch-fly animation
    // interpolates back to (0,0) + sharp, so each letter flies in across the
    // page and fades clear from the smoky background.
    const letters = nameEl.querySelectorAll('.ch');
    const rand = (min, max) => min + Math.random() * (max - min);
    const sign = () => (Math.random() < 0.5 ? -1 : 1);
    letters.forEach(el => {
      el.style.setProperty('--dx', sign() * rand(140, 320) + 'px');
      el.style.setProperty('--dy', rand(-170, 110) + 'px');
      el.style.setProperty('--dr', sign() * rand(8, 22) + 'deg');
      el.style.setProperty('--ds', rand(0.5, 0.88));
      el.style.setProperty('--db', rand(12, 22) + 'px');
    });
  })();

  // ============================================================================
  //  Magnetic title — letters of "allfield" smoothly repel from the cursor.
  //  rAF-throttled mousemove drives inline transforms; CSS transition on .ch
  //  (in style.css) does the easing so the letters glide rather than snap.
  // ============================================================================
  (function initMagneticTitle() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nameEl = document.querySelector('.id-name');
    if (reduce || !nameEl) return;
    const letters = [...nameEl.querySelectorAll('.ch')];
    if (!letters.length) return;

    const RADIUS = 90;     // px — cursor must be within this to influence a letter
    const MAX_OFFSET = 22; // px — maximum letter displacement at zero distance
    let lastX = -9999, lastY = -9999;
    let pending = false;

    function apply() {
      pending = false;
      const box = nameEl.getBoundingClientRect();
      // Fast path: cursor nowhere near the title — release any held offsets.
      if (lastX < box.left - RADIUS || lastX > box.right + RADIUS ||
          lastY < box.top - RADIUS  || lastY > box.bottom + RADIUS) {
        letters.forEach(el => { if (el.style.transform) el.style.transform = ''; });
        return;
      }
      letters.forEach(el => {
        const r = el.getBoundingClientRect();
        const dx = (r.left + r.width / 2) - lastX;
        const dy = (r.top + r.height / 2) - lastY;
        const dist = Math.hypot(dx, dy);
        if (dist < RADIUS) {
          const k = 1 - dist / RADIUS;
          const strength = (k * k) * MAX_OFFSET;       // ease-in falloff
          const inv = strength / (dist || 1);
          el.style.transform = `translate(${(dx * inv).toFixed(2)}px, ${(dy * inv).toFixed(2)}px)`;
        } else if (el.style.transform) {
          el.style.transform = '';
        }
      });
    }

    window.addEventListener('mousemove', e => {
      lastX = e.clientX;
      lastY = e.clientY;
      if (!pending) { pending = true; requestAnimationFrame(apply); }
    }, { passive: true });

    // Release offsets when the cursor leaves the window entirely.
    window.addEventListener('mouseleave', () => {
      letters.forEach(el => { el.style.transform = ''; });
    });
  })();

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
      '  // Lasers — thin beams from above, fanning down. Sweep dramatically on',
      '  // entry, then settle into a slow ambient drift.',
      '  vec2 srcPos = vec2(0.0, 0.7);',
      '  vec2 toPixel = (uv - 0.5) * vec2(aspect, 1.0) - srcPos;',
      '  float beamAngle = atan(toPixel.x, -toPixel.y);',
      '  float swingFade = 1.0 - smoothstep(0.1, 2.6, uTime);',
      '  float swing = sin(uTime * 3.5) * 1.1 * swingFade;',
      '  float beamPhase = beamAngle * 7.0 + uTime * 0.09 + uSeed.x * 0.5 + swing;',
      '  float beam = pow(0.5 + 0.5 * cos(beamPhase), 24.0);',
      '  float beamFade = smoothstep(2.0, 0.4, length(toPixel));',
      '  float scatter = smoothstep(0.25, 0.85, f);',
      '  float beamIntro = smoothstep(0.0, 0.5, uTime);',
      '  col += uC1 * beam * beamFade * scatter * (0.6 + swingFade * 0.9) * beamIntro;',
      '  col *= 1.0 + (1.0 - intro) * 0.6;',
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
    // palette tweak only needs to happen in CSS. Accent (uC1) flows in via
    // the --accent variable (set on <html> by apply() from TWEAK_DEFAULTS).
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
    { code: 'RBV-001', title: 'allfield in Glasgow', series: 'rbv', platform: 'soundcloud', tag: 'RADIO BUENA VIDA', date: '22.05.2026', y: 2026, sub: 'Radio Buena Vida', img: 'assets/mix-rbv-001.jpeg', url: 'https://soundcloud.com/radiobuenavida/allfield-radio-buena-vida-22-1' },
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
    soundcloud: '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><rect x="1" y="14" width="1.5" height="4"/><rect x="3" y="12" width="1.5" height="6"/><rect x="5" y="10" width="1.5" height="8"/><rect x="7" y="8" width="1.5" height="10"/><rect x="9" y="6" width="1.5" height="12"/><rect x="11" y="6" width="1.5" height="12"/><path d="M13 9c0-1.5 1.2-2.7 2.7-2.7s2.7 1.2 2.7 2.7c1.5 0 2.6 1.2 2.6 2.7V18H13z"/></svg>',
    mixcloud:   '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><circle cx="6" cy="13" r="2.2"/><circle cx="10" cy="13" r="2.2"/><circle cx="14" cy="13" r="2.2"/><circle cx="18" cy="13" r="2.2"/><path d="M4 17c2 1.5 4 2 8 2s6-.5 8-2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M4 9c2-1.5 4-2 8-2s6 .5 8 2" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
    youtube:    '<svg viewBox="0 0 28.57 20" width="18" height="13" aria-hidden="true"><path fill="currentColor" d="M27.9727 3.12324C27.6259 1.84956 26.6296 0.846416 25.3644 0.496002 23.0405 -0.130233 14.2858 0 14.2858 0S5.53113 -0.130233 3.20718 0.495876C1.94189 0.846416 0.945749 1.84956 0.598918 3.12324-0.0238482 5.46426-0.0238482 9.99826-0.0238482 9.99826S-0.0238482 14.5323 0.598918 16.8733C0.945749 18.147 1.94196 19.1066 3.20725 19.4571 5.53113 20.0833 14.2858 20.0833 14.2858 20.0833S23.0405 20.0833 25.3644 19.4571C26.6296 19.1066 27.6259 18.147 27.9727 16.8733 28.5965 14.5323 28.5965 9.99826 28.5965 9.99826S28.5965 5.46426 27.9727 3.12324z"/><path fill="var(--bg)" d="M11.4287 14.2854L18.6991 9.99835L11.4287 5.71132V14.2854z"/></svg>',
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
        html += `<div class="yr" style="--yi:${i}"><span class="yr-num">${m.y}</span><span class="yr-line"></span></div>`;
      }
      html += `
        <a href="${m.url || '#'}" class="mix" data-series="${m.series}" data-platform="${m.platform}" style="--i:${i++}"${m.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>
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
  //  Page state — applies theme / accent / grain / view from TWEAK_DEFAULTS.
  //  Theme follows the OS dark/light preference; oxblood is never auto-set.
  // ============================================================================
  const root = document.documentElement;
  const state = Object.assign({}, TWEAK_DEFAULTS);

  const sysDark = window.matchMedia('(prefers-color-scheme: dark)');
  state.theme = sysDark.matches ? 'charcoal' : 'light';
  sysDark.addEventListener('change', e => {
    state.theme = e.matches ? 'charcoal' : 'light';
    apply();
  });

  function apply() {
    root.setAttribute('data-theme', state.theme);
    root.setAttribute('data-accent', state.accent);
    root.style.setProperty('--grain', String(state.grain / 100));
    setPaintPalette(state.theme, getComputedStyle(root).getPropertyValue('--accent'));
    mixesEl.classList.toggle('cards', state.view === 'cards');
    mixesEl.classList.toggle('log', state.view === 'log');
    mixesEl.classList.toggle('show-rail', !!state.showTimeline);
  }

  apply();
})();
