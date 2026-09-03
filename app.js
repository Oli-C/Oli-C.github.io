(function () {
  'use strict';

  // Mobile browsers otherwise restore prior scroll (or anchor-shift on layout
  // change) and push the "allfield" title off-screen during the intro animations.
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  window.scrollTo(0, 0);

  // A touch that turns into a scroll is a scroll, not a stir. The magnetic
  // text and the smoke trail both ignore input while the page is moving, so
  // the main thread and GPU stay free to paint newly exposed rows — iOS
  // in-app browsers otherwise show blank tiles on a fast flick.
  let lastScroll = 0;
  window.addEventListener('scroll', () => { lastScroll = performance.now(); }, { passive: true });
  const scrolling = () => performance.now() - lastScroll < 100;

  // In-app browsers (Instagram etc.) resize the whole webview as their bars
  // collapse, so even 100lvh tracks it: every fixed background layer then
  // re-rasterises and the GL buffer reallocates mid-scroll — the blank-rows
  // moment. On touch devices pin those layers to the screen's height instead:
  // constant, and never smaller than any webview state (surplus is cropped,
  // exactly as the 100lvh rule already accepts). Runs before the shader init
  // below so its first buffer is already the pinned size.
  if (matchMedia('(pointer: coarse)').matches) {
    const bgLayers = document.querySelectorAll('.bg-paper, .bg-grain, .bg-vignette, .bg-paint');
    const pinBgHeight = () => {
      const [short, long] = [screen.width, screen.height].sort((a, b) => a - b);
      const h = innerHeight >= innerWidth ? long : short; // iOS reports screen in portrait regardless
      bgLayers.forEach(el => { el.style.height = h + 'px'; });
    };
    pinBgHeight();
    window.addEventListener('resize', pinBgHeight);
  }

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
  //  Magnetic text — letters of the title AND body text (mix titles, dates,
  //  tags, year numbers) smoothly repel from the cursor or finger.
  //  rAF-throttled input drives inline transforms; CSS transition on .ch/.mch
  //  does the easing so the letters glide rather than snap. Containers are
  //  rect-culled first so per-letter work only runs near the cursor.
  //  Called after render() so the injected mix list is splittable.
  // ============================================================================
  function initMagneticText() {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    // Split body text into .mch letter spans, wrapping each word in a nowrap
    // .mch-w span so word-wrapping (e.g. line-clamped titles) stays natural.
    function splitLetters(el) {
      if (el.dataset.split) return;
      const text = el.textContent;
      el.setAttribute('aria-label', text.trim());
      el.textContent = '';
      text.split(/(\s+)/).forEach(part => {
        if (!part) return;
        if (/^\s+$/.test(part)) { el.appendChild(document.createTextNode(part)); return; }
        const w = document.createElement('span');
        w.className = 'mch-w';
        w.setAttribute('aria-hidden', 'true');
        [...part].forEach(c => {
          const s = document.createElement('span');
          s.className = 'mch';
          s.textContent = c;
          w.appendChild(s);
        });
        el.appendChild(w);
      });
      el.dataset.split = '1';
    }
    // Splitting ~27 cards of text mints ~1200 extra spans; done inline it sat
    // on the critical path before first paint. The split is visually inert
    // (same glyphs, same wrapping), so chew through it in idle-time chunks and
    // wire the pointer listeners once the last chunk lands.
    const toSplit = [...document.querySelectorAll('.mix-title, .mix-date, .mix-tag, .yr-num')];
    const whenIdle = window.requestIdleCallback
      ? (cb) => requestIdleCallback(cb, { timeout: 500 })
      : (cb) => setTimeout(cb, 50);
    const CHUNK = 12;
    whenIdle(function step() {
      for (let n = 0; n < CHUNK && toSplit.length; n++) splitLetters(toSplit.shift());
      if (toSplit.length) whenIdle(step);
      else wireGroups();
    });

    function wireGroups() {
      // Title letters get the original big radius/offset; small body text gets a
      // tighter, subtler push so cards don't turn to soup.
      const groups = [];
      const nameEl = document.querySelector('.id-name');
      if (nameEl) groups.push({ el: nameEl, letters: [...nameEl.querySelectorAll('.ch')], radius: 90, maxOffset: 22, active: false });
      document.querySelectorAll('.mix-title, .mix-date, .mix-tag, .yr-num').forEach(el => {
        const letters = [...el.querySelectorAll('.mch')];
        if (letters.length) groups.push({ el, letters, radius: 60, maxOffset: 9, active: false });
      });
      if (!groups.length) return;

      // Every live input is a repulsion point: the mouse (or pen) plus each
      // finger on the screen. Letters sum the push from all nearby points.
      const points = new Map(); // 'mouse' | 'pen' | 't<id>' → {x, y}
      let pending = false;

      function release(g) {
        g.letters.forEach(el => { if (el.style.transform) el.style.transform = ''; });
        g.active = false;
      }

      function apply() {
        pending = false;
        groups.forEach(g => {
          const box = g.el.getBoundingClientRect();
          // Fast path: no input point near this container — release held offsets.
          let near = false;
          for (const p of points.values()) {
            if (p.x >= box.left - g.radius && p.x <= box.right + g.radius &&
                p.y >= box.top - g.radius  && p.y <= box.bottom + g.radius) { near = true; break; }
          }
          if (!near) {
            if (g.active) release(g);
            return;
          }
          g.active = true;
          g.letters.forEach(el => {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            let ox = 0, oy = 0;
            for (const p of points.values()) {
              const dx = cx - p.x, dy = cy - p.y;
              const dist = Math.hypot(dx, dy);
              if (dist < g.radius) {
                const k = 1 - dist / g.radius;
                const strength = (k * k) * g.maxOffset;    // ease-in falloff
                const inv = strength / (dist || 1);
                ox += dx * inv; oy += dy * inv;
              }
            }
            if (ox || oy) {
              // Overlapping points (two close fingers) may not overdrive a letter.
              const mag = Math.hypot(ox, oy);
              if (mag > g.maxOffset) { ox *= g.maxOffset / mag; oy *= g.maxOffset / mag; }
              el.style.transform = `translate(${ox.toFixed(2)}px, ${oy.toFixed(2)}px)`;
            } else if (el.style.transform) {
              el.style.transform = '';
            }
          });
        });
      }

      function schedule() {
        if (!pending) { pending = true; requestAnimationFrame(apply); }
      }

      // Mouse and pen ride the pointer stream. Touch-type pointer events are
      // ignored here on purpose: the touch listeners below carry every finger
      // and, unlike pointermove, keep reporting after the browser hijacks the
      // gesture for scrolling (pointercancel). This also sidesteps the iOS
      // tap bug — the synthesized mousemove fired after a tap never re-enters
      // the pointer stream, so nothing re-pushes the letters after release.
      window.addEventListener('pointermove', e => {
        if (e.pointerType === 'touch') return;
        points.set(e.pointerType === 'pen' ? 'pen' : 'mouse', { x: e.clientX, y: e.clientY });
        schedule();
      }, { passive: true });
      window.addEventListener('pointerup', e => {
        if (e.pointerType === 'pen') { points.delete('pen'); schedule(); }
      }, { passive: true });
      window.addEventListener('pointercancel', e => {
        if (e.pointerType === 'pen') { points.delete('pen'); schedule(); }
      }, { passive: true });
      window.addEventListener('mouseleave', () => { points.delete('mouse'); schedule(); });

      // Each finger repels from the moment it lands — a plain press moves the
      // text, not just a drag. Rebuilding from e.touches on every event keeps
      // the set exact through multi-finger lifts and missed events.
      function syncTouches(e) {
        for (const key of points.keys()) if (key[0] === 't') points.delete(key);
        // Mid-scroll the finger is steering the page, not the letters.
        if (!scrolling()) for (const t of e.touches) points.set('t' + t.identifier, { x: t.clientX, y: t.clientY });
        schedule();
      }
      window.addEventListener('touchstart', syncTouches, { passive: true });
      window.addEventListener('touchmove', syncTouches, { passive: true });
      window.addEventListener('touchend', syncTouches, { passive: true });
      window.addEventListener('touchcancel', syncTouches, { passive: true });
    }
  }

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

    // Cursor-trail / ripple counts — interpolated into the shader below so
    // the JS buffers and GLSL arrays can never disagree.
    const TRAIL_N = 16;
    const RIPPLE_N = 4;
    const RIPPLE_S = 1.6; // ripple lifetime, seconds

    const VERT = 'attribute vec2 a; void main(){ gl_Position = vec4(a,0.0,1.0); }';
    const FRAG = [
      'precision highp float;',
      'uniform vec2 uRes;',
      '// Pattern space — pinned per width at load, while uRes tracks the real',
      '// buffer. In-app browsers (Instagram etc.) resize the whole webview when',
      '// their chrome collapses, so height-only resizes are real here; anchoring',
      '// the field to the canvas top in pinned units means those re-render every',
      '// surviving pixel identically and just uncover more field below.',
      'uniform vec2 uPat;',
      'uniform float uTime;',
      'uniform vec2 uSeed;',
      'uniform vec3 uC1, uC2, uC3, uBg;',
      '// Cursor trail — xy pos in centered aspect-corrected space, z decaying',
      '// strength, w spread (grows with age: the wake blooms as it dissolves).',
      'uniform vec4 uTrail[' + TRAIL_N + '];',
      '// Per-point cursor velocity — momentum and stroke orientation.',
      'uniform vec2 uTrailV[' + TRAIL_N + '];',
      '// Click ripples — xy origin in pc space, z age in seconds (large = dead).',
      'uniform vec3 uRipple[' + RIPPLE_N + '];',
      '// Idle gates — 1 while any trail point / ripple is alive, else 0.',
      'uniform float uTrailOn;',
      'uniform float uRippleOn;',
      'float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }',
      'float noise(vec2 p){',
      '  vec2 i=floor(p), f=fract(p);',
      '  float a=hash(i), b=hash(i+vec2(1.,0.)), c=hash(i+vec2(0.,1.)), d=hash(i+vec2(1.,1.));',
      '  vec2 u=f*f*(3.-2.*f);',
      '  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);',
      '}',
      'float fbm(vec2 p){',
      '  float v=0., a=0.5;',
      '  // 5 octaves: at the capped DPR the 6th is sub-pixel.',
      '  for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; }',
      '  return v;',
      '}',
      'void main(){',
      '  // y measured down from the canvas top, so a height change cannot move it.',
      '  vec2 frag = vec2(gl_FragCoord.x, uPat.y - (uRes.y - gl_FragCoord.y));',
      '  vec2 uv = frag / uPat;',
      '  float aspect = uPat.x / uPat.y;',
      '  float intro = smoothstep(0.0, 1.6, uTime);',
      '  float zoom  = mix(0.45, 1.0, intro);',
      '  float scale = (2.6 + 0.8 * clamp(1.0 - aspect, 0.0, 0.6)) * zoom;',
      '  vec2  pc    = (uv - 0.5) * vec2(aspect, 1.0);',
      '  vec2  p     = pc * scale + uSeed;',
      '  // Pen wake — each trail point is a divergence-free dipole (gaussian',
      '  // streamfunction sb*G): forward flow at the pen tip, return flow',
      '  // curling back along the flanks — the mushroom curl of a real stir.',
      '  // Incompressible by construction, so the fog is pushed around, never',
      '  // created or destroyed. The spread (tp.w) grows with age while the',
      '  // strength decays, so the wake blooms outward as it dissolves.',
      '  vec2 warp = vec2(0.0);',
      '  // The gates skip both loops when nothing is alive; every term would',
      '  // be zero anyway, so the drawn output is bit-identical.',
      '  if (uTrailOn > 0.5) {',
      '  for (int i = 0; i < ' + TRAIL_N + '; i++) {',
      '    vec4 tp = uTrail[i];',
      '    vec2 d = pc - tp.xy;',
      '    float vl = length(uTrailV[i]);',
      '    vec2 dir = vl > 0.001 ? uTrailV[i] / vl : vec2(1.0, 0.0);',
      '    vec2 prp = vec2(-dir.y, dir.x);',
      '    float sa = dot(d, dir);',
      '    float sb = dot(d, prp);',
      '    float g2 = tp.w * tp.w;',
      '    float ka = 90.0 / g2, kb = 180.0 / g2;',
      '    float G = exp(-(sa*sa*ka + sb*sb*kb));',
      '    // Reverse flank flow clamped and the cross term halved — the pure',
      '    // dipole derivatives flip sign too sharply for a warped noise field',
      '    // and read as tearing.',
      '    warp += (dir * clamp(1.0 - 2.0*kb*sb*sb, -0.5, 1.0) + prp * (ka*sa*sb)) * G * tp.z * vl * 0.5;',
      '  }',
      '  }',
      '  // Click ripples — an expanding ring that nudges the fog outward at',
      '  // its front and carries a faint glint (added to col further down).',
      '  float ripLight = 0.0;',
      '  if (uRippleOn > 0.5) {',
      '  for (int i = 0; i < ' + RIPPLE_N + '; i++) {',
      '    vec3 rp = uRipple[i];',
      '    float dist = length(pc - rp.xy);',
      '    // (dist - radius) squared by hand — pow() is undefined for x<0 in ES.',
      '    float dr = (dist - rp.z * 0.5) * 14.0;',
      '    float band = exp(-dr * dr);',
      '    float amp = max(0.0, 1.0 - rp.z / ' + RIPPLE_S.toFixed(1) + ');',
      '    amp *= amp;',
      '    warp += (pc - rp.xy) / max(dist, 0.001) * band * amp * 0.2;',
      '    ripLight += band * amp;',
      '  }',
      '  }',
      '  // Soft-saturate so overlapping stirs can never tear the field.',
      '  warp /= 1.0 + 2.5 * length(warp);',
      '  p += warp * scale * 0.35;',
      '  // Ambient current — the ink drifts slowly across the frame. The back',
      '  // layer inherits it at 0.55x via pBack, giving free parallax.',
      '  p += uTime * vec2(0.022, -0.008);',
      '  vec2 m = 0.6 * vec2(fbm(p*0.35 + 0.03*uTime), fbm(p*0.35 + vec2(4.0,2.0) - 0.03*uTime));',
      '  p += m;',
      '  float t = uTime * 0.065;',
      '  // Back layer — slower, larger scale, softer movement. Sits behind everything else.',
      '  vec2 pBack = p * 0.55 + vec2(7.3, 11.7);',
      '  float tBack = uTime * 0.032;',
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
      '  // God rays — slanted underwater light shafts from the surface. Two',
      '  // layers at different scales/speeds drift past each other for parallax',
      '  // depth; caustic shimmer replaces the old swinging beam fan.',
      '  vec2 rd = normalize(vec2(0.28, -1.0));',
      '  float across = dot(pc - vec2(0.0, 0.7), vec2(-rd.y, rd.x)) + uSeed.x * 0.1;',
      '  float depth = clamp((0.7 - pc.y) / 1.4, 0.0, 1.0);',
      '  float tR = uTime * 0.06;',
      '  // Near layer: broad, slow, bright. Far layer: finer, faster, opposite drift.',
      '  float rayN = pow(noise(vec2(across * 6.0 + tR, 2.7)), 3.0);',
      '  float rayF = pow(noise(vec2(across * 14.0 - tR * 1.8, 9.1)), 3.0);',
      '  float shimmer = 0.7 + 0.3 * fbm(vec2(across * 4.0, uTime * 0.12));',
      '  float rays = (rayN * 0.9 + rayF * 0.5) * shimmer;',
      '  float fadeTop = smoothstep(1.0, 0.1, depth);',
      '  float scatter = smoothstep(0.25, 0.85, f);',
      '  float beamIntro = smoothstep(0.0, 1.2, uTime);',
      '  col += uC1 * rays * fadeTop * scatter * 0.7 * beamIntro;',
      '  // Ripple glint — the ring front catches light where the fog is dense.',
      '  col += uC1 * ripLight * scatter * 0.25;',
      '  // Depth cue — the water column darkens slightly toward the bottom.',
      '  col *= 1.0 - depth * 0.14;',
      '  col *= 1.0 + (1.0 - intro) * 0.6;',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n');

    // Compile + link are only *queued* here — no status queries. A status or
    // uniform query forces the main thread to wait for the shader compiler,
    // which is what used to stall the page before first paint. With the
    // KHR_parallel_shader_compile extension the driver compiles on background
    // threads and readiness is polled below; without it finishInit() runs
    // immediately — the old synchronous behaviour.
    const parallelExt = gl.getExtension('KHR_parallel_shader_compile');
    const vs = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vs, VERT);
    gl.compileShader(vs);
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fs, FRAG);
    gl.compileShader(fs);
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);

    let realSetPalette = null; // set by finishInit once the program is live
    let queuedPalette = null;  // palette requested before that (apply() runs early)

    function finishInit() {
      if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) ||
          !gl.getShaderParameter(fs, gl.COMPILE_STATUS) ||
          !gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        console.error('shader compile/link', gl.getShaderInfoLog(vs),
          gl.getShaderInfoLog(fs), gl.getProgramInfoLog(prog));
        canvas.style.display = 'none';
        return;
      }
      gl.useProgram(prog);

      const buf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
      const aLoc = gl.getAttribLocation(prog, 'a');
      gl.enableVertexAttribArray(aLoc);
      gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

      const uRes    = gl.getUniformLocation(prog, 'uRes');
      const uPat    = gl.getUniformLocation(prog, 'uPat');
      const uTrail  = gl.getUniformLocation(prog, 'uTrail');
      const uTrailV = gl.getUniformLocation(prog, 'uTrailV');
      const uRipple = gl.getUniformLocation(prog, 'uRipple');
      const uTime   = gl.getUniformLocation(prog, 'uTime');
      const uSeed   = gl.getUniformLocation(prog, 'uSeed');
      const uTrailOn  = gl.getUniformLocation(prog, 'uTrailOn');
      const uRippleOn = gl.getUniformLocation(prog, 'uRippleOn');
      const uC1     = gl.getUniformLocation(prog, 'uC1');
      const uC2     = gl.getUniformLocation(prog, 'uC2');
      const uC3     = gl.getUniformLocation(prog, 'uC3');
      const uBg     = gl.getUniformLocation(prog, 'uBg');

      // Random per-page-load offset so the smoke pattern starts in a different
      // place every time. Doesn't affect the intro ramp since it leaves uTime alone.
      gl.uniform2f(uSeed, Math.random() * 100, Math.random() * 100);

      let everDrawn = false; // set on the first frame; guards the resize repaint
      // Pattern-space pin — the uPat counterpart. 100lvh keeps the canvas box
      // stable in real browsers, but in-app browsers (Instagram et al.) resize
      // the whole webview as their chrome collapses, so the box legitimately
      // changes height there. Re-pin only when the WIDTH changes (rotation,
      // real window resize); height-only changes keep the pin and the field
      // stays put while the buffer grows or crops beneath it.
      let patW = 0, patH = 0;       // device px — drives uPat
      let patCssW = 0, patCssH = 0; // CSS px — drives toPc
      function resize() {
        // The smoke is naturally soft so a lower render resolution is invisible —
        // DPR-3 phones especially benefit from a tighter cap.
        const dprCap = window.innerWidth <= 640 ? 1.25 : 1.5;
        const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
        // Size from the canvas box, not the window, so browser-UI-driven
        // innerHeight changes never reach the buffer in normal browsers.
        const w = Math.max(1, Math.floor(canvas.clientWidth  * dpr));
        const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
        if (w !== patW) {
          patW = w; patH = h;
          patCssW = canvas.clientWidth; patCssH = canvas.clientHeight;
          gl.uniform2f(uPat, patW, patH);
        }
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h;
          gl.viewport(0, 0, w, h);
          gl.uniform2f(uRes, w, h);
          // Reallocating the buffer clears it to transparent, and the throttled
          // frame loop may not repaint for up to ~33ms — that gap flashes,
          // especially crossing the 640px dprCap flip. Repaint right now with
          // the last frame's uniforms (skip before the first real frame, when
          // the palette isn't set yet).
          if (everDrawn) gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        } else {
          gl.uniform2f(uRes, w, h);
        }
      }
      resize();
      window.addEventListener('resize', resize);

      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Run the intro at full 60fps; throttle steady-state to 30fps to halve GPU load.
      const INTRO_MS = 1700;
      // 30ms, not 1000/30: rAF ticks land on ~16.7ms steps, so a 33.33ms gate
      // rejects the 33.3ms tick and the real cadence collapsed to ~20fps (a draw
      // every 50ms). 30ms accepts every second tick on 60Hz displays (every
      // fourth on 120Hz) — an even, true 30fps.
      const FRAME_INTERVAL_MS = 30;
      let start = performance.now();
      let lastDraw = 0;
      let paused = false;
      let pausedAt = 0;

      // Cursor trail — the listeners only sample the raw pointer; a smoothed
      // "brush" glides toward it every frame (in updateTrail) and deposits the
      // trail points from its own continuous motion, so the wake flows even
      // though input events arrive in discrete jumps. While any point is alive
      // we draw at full 60fps.
      const TRAIL_MS = 4000;   // a stroke dissolves over ~4s, like ink settling
      const trailPts = [];
      const trailData = new Float32Array(TRAIL_N * 4);
      const trailVelData = new Float32Array(TRAIL_N * 2);
      let curX = null, curY = null;     // raw pointer, pc space
      let brushX = null, brushY = null; // smoothed brush
      // Map client coords into the pinned pattern space (not the live canvas
      // box) so pointer input lands exactly where the shader samples, even
      // mid-collapse in an in-app browser.
      const toPc = (cx, cy) => [
        (cx / patCssW - 0.5) * (patCssW / patCssH),
        0.5 - cy / patCssH,
      ];
      if (!reduceMotion) {
        const notePointer = (cx, cy) => { [curX, curY] = toPc(cx, cy); };
        window.addEventListener('mousemove', e => notePointer(e.clientX, e.clientY), { passive: true });
        window.addEventListener('touchmove', e => {
          if (e.touches.length && !scrolling()) notePointer(e.touches[0].clientX, e.touches[0].clientY);
        }, { passive: true });
      }

      // Click / tap ripples — a light ring spreads through the fog, except when
      // the press lands on something interactive (links, buttons). Mouse clicks
      // ripple on the press; a touch waits for the lift and only ripples if the
      // finger didn't travel — a scroll flick starts with the same pointerdown,
      // and pulsing the fog on every scroll start read as noise, not intent.
      const ripples = [];
      const rippleData = new Float32Array(RIPPLE_N * 3); // refilled every frame by updateRipples
      if (!reduceMotion) {
        const spawnRipple = (cx, cy) => {
          const [x, y] = toPc(cx, cy);
          ripples.push({ x, y, t: performance.now() });
          if (ripples.length > RIPPLE_N) ripples.shift();
        };
        let press = null; // pending touch/pen press awaiting tap confirmation
        window.addEventListener('pointerdown', e => {
          if (e.target.closest && e.target.closest('a, button')) return;
          if (e.pointerType === 'mouse') spawnRipple(e.clientX, e.clientY);
          else press = { x: e.clientX, y: e.clientY };
        }, { passive: true });
        window.addEventListener('pointerup', e => {
          if (press && e.pointerType !== 'mouse' &&
              Math.hypot(e.clientX - press.x, e.clientY - press.y) < 12) {
            spawnRipple(e.clientX, e.clientY);
          }
          press = null;
        }, { passive: true });
        // The browser claimed the gesture for scrolling — not a tap.
        window.addEventListener('pointercancel', () => { press = null; }, { passive: true });
      }

      // Fills rippleData ages for `now`; returns true while any ring is alive.
      function updateRipples(now) {
        let active = false;
        for (let i = 0; i < RIPPLE_N; i++) {
          const r = ripples[i];
          const age = r ? (now - r.t) / 1000 : 99;
          rippleData[i * 3]     = r ? r.x : 0;
          rippleData[i * 3 + 1] = r ? r.y : 0;
          rippleData[i * 3 + 2] = age;
          if (age < RIPPLE_S) active = true;
        }
        return active;
      }

      // Refreshes trailData for `now`; returns true if any point is alive.
      // Each stir eases in (no pop), advects along its own damped momentum so
      // the disturbance drifts with the medium, then relaxes out slowly.
      let lastTrailNow = 0;
      function updateTrail(now) {
        const dt = lastTrailNow ? Math.min(100, Math.max(1, now - lastTrailNow)) : 16;
        lastTrailNow = now;

        // Glide the brush toward the raw pointer and deposit points from the
        // brush's motion — smooth position, smooth velocity, smooth spawn.
        if (curX !== null) {
          if (brushX === null) { brushX = curX; brushY = curY; }
          const px = brushX, py = brushY;
          const k = 1 - Math.exp(-dt / 90);
          brushX += (curX - brushX) * k;
          brushY += (curY - brushY) * k;
          // Velocity in pc-units/s, scaled so ~2 screen-heights/s hits the cap.
          let vx = (brushX - px) / dt * 250;
          let vy = (brushY - py) / dt * 250;
          const mag = Math.hypot(vx, vy);
          if (mag > 0.5) { vx *= 0.5 / mag; vy *= 0.5 / mag; }
          // Spacing and lifetime both scale with speed: a fast sweep lays
          // sparser points that die sooner, so a point always fades out before
          // the ring evicts it — evicting a still-strong point pops visibly.
          // (Vigorous stirring dissipating faster is also just how fluids work.)
          const spacing = 0.02 + mag * 0.16;
          const last = trailPts[trailPts.length - 1];
          if (mag > 0.02 &&
              (!last || Math.hypot(brushX - last.x, brushY - last.y) >= spacing)) {
            const life = Math.min(TRAIL_MS,
              (TRAIL_N - 2) * spacing / Math.max(mag, 0.02) * 900);
            trailPts.push({ x: brushX, y: brushY, vx, vy, t: now, life });
            if (trailPts.length > TRAIL_N) trailPts.shift();
          }
        }

        const damp = Math.exp(-dt / 900);
        let active = false;
        for (let i = 0; i < TRAIL_N; i++) {
          const pt = trailPts[i];
          let s = 0, spread = 1;
          if (pt) {
            pt.x += pt.vx * dt * 0.0004;
            pt.y += pt.vy * dt * 0.0004;
            pt.vx *= damp; pt.vy *= damp;
            const age = now - pt.t;
            const fadeIn = Math.min(1, age / 150);
            const k = Math.max(0, 1 - age / pt.life);
            s = fadeIn * k * k;
            // The wake blooms outward (up to ~2.2x) as it dissolves.
            spread = 1 + 1.2 * Math.min(1, age / pt.life);
          }
          trailData[i * 4]     = pt ? pt.x : 0;
          trailData[i * 4 + 1] = pt ? pt.y : 0;
          trailData[i * 4 + 2] = s;
          trailData[i * 4 + 3] = spread; // 1 even for empty slots — avoids /0 in shader
          trailVelData[i * 2]     = pt ? pt.vx : 0;
          trailVelData[i * 2 + 1] = pt ? pt.vy : 0;
          if (s > 0) active = true;
        }
        return active;
      }

      function frame(now) {
        if (paused) return;
        const elapsed = now - start;
        const inIntro = elapsed < INTRO_MS;
        const trailActive = updateTrail(now);
        const rippleActive = updateRipples(now);
        // A live trail normally forces 60fps — not while scrolling, when the GPU
        // is needed for tiles; hold the 30fps cadence instead.
        if (inIntro || (trailActive && !scrolling()) || rippleActive || now - lastDraw >= FRAME_INTERVAL_MS) {
          const t = reduceMotion ? 7.3 : elapsed * 0.001;
          gl.uniform1f(uTime, t);
          gl.uniform1f(uTrailOn, trailActive ? 1 : 0);
          gl.uniform1f(uRippleOn, rippleActive ? 1 : 0);
          gl.uniform4fv(uTrail, trailData);
          gl.uniform2fv(uTrailV, trailVelData);
          gl.uniform3fv(uRipple, rippleData);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          everDrawn = true;
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

      // CSS saturate() as a matrix on the palette. The shader output is a
      // linear blend of these four colours, so this equals the old
      // `filter: saturate()` on the canvas minus one full-screen filter pass.
      function saturate([r, g, b], s) {
        return [
          (0.213 + 0.787 * s) * r + (0.715 - 0.715 * s) * g + (0.072 - 0.072 * s) * b,
          (0.213 - 0.213 * s) * r + (0.715 + 0.285 * s) * g + (0.072 - 0.072 * s) * b,
          (0.213 - 0.213 * s) * r + (0.715 - 0.715 * s) * g + (0.072 + 0.928 * s) * b,
        ];
      }

      // Smoke palette is sourced from CSS — `--smoke-bg/c1/c2/c3/sat` per theme
      // in style.css. JS reads the active values via getComputedStyle so any
      // palette tweak only needs to happen in CSS. Accent (uC1) flows in via
      // the --accent variable (set on <html> by apply() from TWEAK_DEFAULTS).
      realSetPalette = function (_theme, accentHex) {
        const cs = getComputedStyle(document.documentElement);
        const sat = parseFloat(cs.getPropertyValue('--smoke-sat')) || 1;
        // --smoke-c1 (ocean cyan) overrides the accent for the shader highlight;
        // themes without it fall back to the site accent.
        const [c1, c2, c3, bg] = [
          cs.getPropertyValue('--smoke-c1').trim() || accentHex,
          cs.getPropertyValue('--smoke-c2'),
          cs.getPropertyValue('--smoke-c3'),
          cs.getPropertyValue('--smoke-bg'),
        ].map(h => saturate(hexToRgb(h), sat));
        gl.useProgram(prog);
        gl.uniform3f(uC1, c1[0], c1[1], c1[2]);
        gl.uniform3f(uC2, c2[0], c2[1], c2[2]);
        gl.uniform3f(uC3, c3[0], c3[1], c3[2]);
        gl.uniform3f(uBg, bg[0], bg[1], bg[2]);
      };
      if (queuedPalette) realSetPalette(queuedPalette[0], queuedPalette[1]);
    }

    if (parallelExt) {
      // Poll readiness without blocking; the canvas just stays transparent for
      // the few frames the background compile takes (the smoke fades in from
      // near the page background anyway, so nothing visibly changes).
      (function poll() {
        if (gl.getProgramParameter(prog, parallelExt.COMPLETION_STATUS_KHR)) finishInit();
        else requestAnimationFrame(poll);
      })();
    } else {
      finishInit();
    }

    // Callable straight away — apply() runs before the program is ready, so
    // early palette requests queue and finishInit applies the latest one.
    return function setPalette(theme, accentHex) {
      if (realSetPalette) realSetPalette(theme, accentHex);
      else queuedPalette = [theme, accentHex];
    };
  })();

  // ============================================================================
  //  Upcoming shows — rendered above the mix list under an "upcoming" divider
  //  with the live slot time. The pulsing LIVE chip only shows between `start`
  //  and `until` (both instants with timezone offset) — before the slot the
  //  card carries just the date and time; entries without `start` show the
  //  chip whenever the card is up. Past `until` the card stops rendering on
  //  its own, so a stale date never shows even before the list is updated.
  //  Once a show has aired, move it into MIXES with its stream URL.
  // ============================================================================
  const UPCOMING = [];

  // ============================================================================
  //  Mix data — pulled from the real Linktree export
  // ============================================================================
  const MIXES = [
    { code: 'LUS-056', title: 'August Radio', series: 'lus', platform: 'youtube', tag: 'LUSOPHONICA', date: '22.08.2026', y: 2026, sub: 'Residency solo', img: 'assets/mix-lus-056.jpeg', url: 'https://youtu.be/sUSVFPTJj1w' },
    { code: 'LUS-055', title: 'July Radio', series: 'lus', platform: 'youtube', tag: 'LUSOPHONICA', date: '17.07.2026', y: 2026, sub: 'Residency solo', img: 'assets/mix-lus-055.jpeg', url: 'https://youtu.be/5_h7jc8kwR8' },
    { code: 'LUS-054', title: 'June Radio', series: 'lus', platform: 'youtube', tag: 'LUSOPHONICA', date: '03.06.2026', y: 2026, sub: 'Residency solo', img: 'assets/mix-lus-054.jpeg', url: 'https://youtu.be/twljVtkxQZE' },
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
    youtube:    '<svg viewBox="0 0 28.57 20" width="14" height="10" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M27.9727 3.12324C27.6259 1.84956 26.6296 0.846416 25.3644 0.496002 23.0405 -0.130233 14.2858 0 14.2858 0S5.53113 -0.130233 3.20718 0.495876C1.94189 0.846416 0.945749 1.84956 0.598918 3.12324-0.0238482 5.46426-0.0238482 9.99826-0.0238482 9.99826S-0.0238482 14.5323 0.598918 16.8733C0.945749 18.147 1.94196 19.1066 3.20725 19.4571 5.53113 20.0833 14.2858 20.0833 14.2858 20.0833S23.0405 20.0833 25.3644 19.4571C26.6296 19.1066 27.6259 18.147 27.9727 16.8733 28.5965 14.5323 28.5965 9.99826 28.5965 9.99826S28.5965 5.46426 27.9727 3.12324zM11.4287 14.2854L18.6991 9.99835L11.4287 5.71132V14.2854z"/></svg>',
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
    const upcoming = UPCOMING.filter(m => Date.now() < Date.parse(m.until));
    if (upcoming.length) {
      html += `<div class="yr yr-up" style="--yi:${i}"><span class="yr-num">upcoming</span><span class="yr-line"></span></div>`;
      for (const m of upcoming) {
        const idx = i++;
        const live = !m.start || Date.now() >= Date.parse(m.start);
        html += `
        <a href="${m.url || '#'}" class="mix mix-up" data-series="${m.series}" style="--i:${idx}"${m.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>
          <div class="mix-art">
            <img src="${m.img}" alt="" loading="eager" decoding="async">
          </div>
          <div class="mix-body">
            <div class="mix-meta">
              <span class="mix-date">${esc(m.date)}</span>
            </div>
            <div class="mix-title">${esc(m.title)}</div>
            <div class="mix-sub"><span>${esc(m.when)}</span><span>${esc(m.tz)}</span></div>
          </div>
          <div class="mix-right">
            <span class="mix-tag">${esc(m.tag)}</span>
            <span class="mix-live${live ? ' is-live' : ''}"${m.start ? ` data-start="${esc(m.start)}" data-until="${esc(m.until)}"` : ''} aria-label="Broadcast live"><span class="mix-live-dot"></span>live</span>
          </div>
        </a>`;
      }
    }
    for (const m of MIXES) {
      if (m.y !== currentY) {
        currentY = m.y;
        html += `<div class="yr" style="--yi:${i}"><span class="yr-num">${m.y}</span><span class="yr-line"></span></div>`;
      }
      const idx = i++;
      // All art loads eagerly — the whole set is ~170KB of 100px JPEGs, and
      // lazy loading only made covers pop in late on a fast scroll.
      html += `
        <a href="${m.url || '#'}" class="mix" data-series="${m.series}" data-platform="${m.platform}" style="--i:${idx}"${m.url ? ' target="_blank" rel="noopener noreferrer"' : ''}>
          <div class="mix-art">
            <img src="${m.img}" alt="" loading="eager" decoding="async">
          </div>
          <div class="mix-body">
            <div class="mix-meta">
              <span class="mix-date">${esc(m.date)}</span>
            </div>
            <div class="mix-title">${esc(m.title)}</div>
          </div>
          <div class="mix-right">
            <span class="mix-tag">${esc(m.tag)}</span>
            ${platformBadge(m.platform)}
          </div>
        </a>`;
    }
    mixesEl.innerHTML = html;
  }
  render();
  initMagneticText();

  // Flip the LIVE chip on/off at the slot boundaries on a page left open,
  // without re-rendering (that would replay the entrance animations).
  (function initLiveChips() {
    const MAX_DELAY = 0x7fffffff; // setTimeout clamp — beyond this a reload handles it
    mixesEl.querySelectorAll('.mix-live[data-start]').forEach(chip => {
      const at = (instant, fn) => {
        const delay = Date.parse(instant) - Date.now();
        if (delay > 0 && delay < MAX_DELAY) setTimeout(fn, delay + 1000);
      };
      at(chip.dataset.start, () => chip.classList.add('is-live'));
      at(chip.dataset.until, () => chip.classList.remove('is-live'));
    });
  })();

  // ============================================================================
  //  Load cascade — cards and year dividers in the initial viewport run the
  //  smoke-emerge entrance, continuing the hero cascade via --i / --yi.
  //  Everything below the fold is plain visible from the start: scrolling
  //  triggers no animation at all.
  // ============================================================================
  (function initLoadCascade() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const vh = window.innerHeight;
    mixesEl.querySelectorAll('.mix, .yr').forEach(el => {
      if (el.getBoundingClientRect().top < vh + 50) el.classList.add('bloom-load');
    });
  })();

  // ============================================================================
  //  Page state — applies theme / accent / grain from TWEAK_DEFAULTS.
  //  Theme follows the OS dark/light preference.
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
  }

  apply();
})();
