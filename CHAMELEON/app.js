import * as THREE             from 'three';
import { EffectComposer }     from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }         from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass }    from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }         from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass }           from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass }         from 'three/addons/postprocessing/OutputPass.js';
import { RGBELoader }         from 'three/addons/loaders/RGBELoader.js';

// =============================================================================
//  Posters — Chameleon event poster archive (WebP-encoded from the print archive)
// =============================================================================
// Each entry: { img, title, meta, venue, lineup, url?, featured? }
//   title  — what shows as the headliner line on the info card
//   lineup — full bill (including headliner); the renderer surfaces the
//            non-headliner names as "support" below the title
//   venue  — venue + city, rendered on its own line below the date
const POSTERS = [
  // ---- 2026 (featured upcoming + Crescent residency)
  { img: 'posters/Chameleon - 3 Nights at the Crescent - 30 May 2026.webp', title: 'Chameleon · 3 Nights at the Crescent', meta: '24 May 2026, 30 May 2026, 5 Jun 2026', venue: 'The Crescent, York', lineup: [], url: 'https://www.seetickets.com/event/chameleon-the-crescent-season-ticket/the-crescent/3634501', featured: true },
  { img: 'posters/Midland & SR (Special Request) - 13 Feb 2026.webp',       title: 'Special Request, Midland, Rosie',      meta: '13 Feb 2026', venue: 'The Crescent, York', lineup: ['Midland', 'Special Request', 'Rosie'] },

  // ---- 2025
  { img: 'posters/Call Super - Chameleon 6th Birthday - 12 Dec 2025.webp',  title: 'Call Super · Chameleon 6th Birthday',  meta: '12 Dec 2025', venue: 'Bluebox, York',     lineup: ['Call Super', 'Deo'] },
  { img: 'posters/Objekt - 29 Nov 2025.webp',                                title: 'Objekt',                               meta: '29 Nov 2025', venue: 'The Crescent, York', lineup: ['Objekt', 'Deo', 'B:Cam'] },
  { img: 'posters/Deo b2b Parris - 2 May 2025.webp',                         title: 'Deo b2b Parris',                       meta: '2 May 2025',  venue: 'The Crescent, York', lineup: ['Deo', 'Parris'] },
  { img: 'posters/Rene Wise - 14 Mar 2024.webp',                             title: 'Rene Wise',                            meta: '14 Mar 2025', venue: 'Bluebox, York',     lineup: ['Rene Wise', 'Deo', 'Oren'] },
  { img: 'posters/Orla - 15 Feb 2025.webp',                                  title: 'Or:la',                                meta: '15 Feb 2025', venue: 'The Crescent, York', lineup: ['Or:la', 'Deo'] },
  { img: 'posters/Chameleon Free Party - 2 - 31 Jan 2025.webp',              title: 'Chameleon Free Party · 2',             meta: '31 Jan 2025', venue: 'Bluebox, York',     lineup: [] },

  // ---- 2024
  { img: 'posters/Special Request b2b Hutch - 5th Birthday - 13 Dec 2024.webp', title: 'Special Request b2b Hutch · 5th Birthday', meta: '13 Dec 2024', venue: 'Bluebox, York',         lineup: ['Special Request', 'Hutch', 'Allfield', 'Deo', 'James Frances', 'Mike Jones', 'se.arle'] },
  { img: 'posters/Pearson Sound - 29 Nov 2024.webp',                          title: 'Pearson Sound',                          meta: '29 Nov 2024', venue: 'The Crescent, York',    lineup: ['Pearson Sound'] },
  { img: 'posters/Chameleon Disco - 2 Nov 2024.webp',                         title: 'Chameleon Disco',                        meta: '2 Nov 2024',  venue: 'Bluebox, York',         lineup: ['Filip U', 'Mike Jones', 'se.arle'] },
  { img: 'posters/Chameleon x Meridian - Peckham Audio - 18 Oct 2024.webp',   title: 'Chameleon × Meridian · Peckham Audio',   meta: '18 Oct 2024', venue: 'Peckham Audio, London', lineup: ['Deo', 'B:Cam', 'Flo Ruby', 'Allfield', 'Owari', 'forms', 'Yuba'] },
  { img: 'posters/Chameleon Free Party - 21 Sep 2024.webp',                   title: 'Chameleon Free Party',                   meta: '21 Sep 2024', venue: 'Bluebox, York',         lineup: ['benjics', 'Harkirit', 'Deo'] },
  { img: 'posters/Ben UFO - 10 Aug 2024.webp',                                title: 'Ben UFO',                                meta: '10 Aug 2024', venue: 'The Crescent, York',    lineup: ['Ben UFO', 'Deo'] },
  { img: 'posters/OnRo - 29 Jun 2024.webp',                                   title: 'On Rotation',                            meta: '29 Jun 2024', venue: 'Bluebox, York',         lineup: ['Adam Pits', "Chris l'Anson", 'Lisene', 'Deo', 'se.arle'] },
  { img: 'posters/Chameleon Techno Soundclash - 7 Jun 2024.webp',             title: 'A Techno Soundclash',                    meta: '7 Jun 2024',  venue: 'Bluebox, York',         lineup: ['Deo', 'Harkirit', 'Tor', 'Burley', 'Perseus Traxx', 'Andy Kidd'] },
  { img: 'posters/Martyn - 4 May 2024.webp',                                  title: 'Martyn',                                 meta: '4 May 2024',  venue: 'The Crescent, York',    lineup: ['Martyn'] },
  { img: 'posters/Community Night - 19 Apr 2024.webp',                        title: 'Community Night',                        meta: '19 Apr 2024', venue: 'Bluebox, York',         lineup: ['Lilo', 'Filip U', 'benjics', 'Deo & Oren', 'Gastah & Laqai', 'Huge O', 'se.arle', 'lo.pan', 'Harkirit'] },
  { img: 'posters/Fold - 22 Mar 2024.webp',                                   title: 'Fold',                                   meta: '22 Mar 2024', venue: 'Bluebox, York',         lineup: ['Fold'] },
  { img: 'posters/Stenny - 1 Mar 2024.webp',                                  title: 'Stenny',                                 meta: '1 Mar 2024',  venue: 'Bluebox, York',         lineup: ['Stenny', 'B:Cam'] },
  { img: 'posters/Call Super - 16 Feb 2024.webp',                             title: 'Call Super',                             meta: '16 Feb 2024', venue: 'The Crescent, York',    lineup: ['Call Super', 'Deo'] },
  { img: 'posters/Cham & Friends - Vol. 3 - 2 Feb 2024.webp',                 title: 'Cham & Friends · Vol. 3',                meta: '2 Feb 2024',  venue: 'Bluebox, York',         lineup: ['Oren'] },
  { img: 'posters/Bakey b2b Breaka - 19 Jan 2024.webp',                       title: 'Bakey & Breaka',                         meta: '19 Jan 2024', venue: 'Bluebox, York',         lineup: ['Bakey', 'Breaka'] },

  // ---- 2023
  { img: 'posters/Chameleon 4th Birthday - 15 Dec 2023.webp',                 title: 'Hutch · Chameleon 4th Birthday',         meta: '15 Dec 2023', venue: 'Bluebox, York',         lineup: ['Hutch', 'Deo', 'Allfield', 'Joe Hell'] },
  { img: 'posters/Kitsta - 3 Nov 2023.webp',                                  title: 'Kitsta',                                 meta: '3 Nov 2023',  venue: 'Bluebox, York',         lineup: ['Kitsta', 'se.arle'] },
  { img: 'posters/Reni b2b Ploy - 13 Oct 2023.webp',                          title: 'Re:ni b2b Ploy',                         meta: '13 Oct 2023', venue: 'The Crescent, York',    lineup: ['re:ni', 'Ploy', 'Deo'] },
  { img: 'posters/Residents Night - 22 Sep 2023.webp',                        title: 'Residents Night',                        meta: '22 Sep 2023', venue: 'Bluebox, York',         lineup: ['Allfield', 'B:Cam', 'Deo', 'Owari', 'Yuba'] },
  { img: 'posters/OnRo x Chameleon - 9th Birthday - 23 Sep 2023.webp',        title: 'On Rotation',                            meta: '3 Sep 2023',  venue: 'Plant & Deck, Leeds',   lineup: ['Adam Pits', "Chris l'Anson", 'Deo', 'Allfield', 'B:Cam'] },
  { img: 'posters/Cham & Friends - Vol. 2 - 21 Jul 2023.webp',                title: 'Deo, Oren, se.arle',                     meta: '21 Jul 2023', venue: 'Bluebox, York',         lineup: ['Deo', 'Oren', 'se.arle'] },
  { img: 'posters/Midland - 9 Jun 2023.webp',                                 title: 'Midland',                                meta: '9 Jun 2023',  venue: 'The Crescent, York',    lineup: ['Midland', 'Lara David'] },
  { img: 'posters/Deo - 2 Jun 2023.webp',                                     title: 'Deo',                                    meta: '2 Jun 2023',  venue: 'Bluebox, York',         lineup: ['Deo'] },
  { img: 'posters/Cham & Friends - Vol. 2 - 30 Apr 2023.webp',                title: 'Cham & Friends · Vol. 2',                meta: '30 Apr 2023', venue: 'Bluebox, York',         lineup: ['Litherland', 'B:Cam b2b Deo', 'se.arle', 'Yuba'] },
  { img: 'posters/Cham & Friends - Vol. 1 - 14 Apr 2023.webp',                title: 'Cham & Friends · Vol. 1',                meta: '14 Apr 2023', venue: 'Bluebox, York',         lineup: ['Allfield', 'Oren', 'Harkirit', 'Sizeup'] },
  { img: 'posters/Marv - 17 Mar 2023.webp',                                   title: 'Marv B',                                 meta: '17 Mar 2023', venue: 'Bluebox, York',         lineup: ['Marv B', 'Yuba'] },
  { img: 'posters/Barker - 17 Feb 2023.webp',                                 title: 'Barker (Live)',                          meta: '17 Feb 2023', venue: 'The Crescent, York',    lineup: ['Barker', 'Deo'] },
  { img: 'posters/Tan - 3 Feb 2023.webp',                                     title: 'Tañ',                                    meta: '3 Feb 2023',  venue: 'Bluebox, York',         lineup: ['Tañ', 'B:Cam', 'Allfield'] },
  { img: 'posters/Space Cadets - 20 Jan 2023.webp',                           title: 'Space Cadets',                           meta: '20 Jan 2023', venue: 'Bluebox, York',         lineup: ['Adam Pits', 'Deo', 'Lisene'] },

  // ---- 2022
  { img: 'posters/Hutch - Chameleon 3rd Birthday - 3 Dec 2022.webp',          title: 'Hutch · Chameleon 3rd Birthday',         meta: '2 Dec 2022',  venue: 'Bluebox, York',         lineup: ['Hutch', 'Allfield', 'B:Cam', 'Deo', 'New Ends', 'Yuba'] },
  { img: 'posters/Pangaea - 14 Oct 2022.webp',                                title: 'Pangaea',                                meta: '14 Oct 2022', venue: 'The Crescent, York',    lineup: ['Pangaea', 'Deo'] },
  { img: 'posters/Chameleon Residents - 29 Sep 2022.webp',                    title: 'A Sum Of',                               meta: '30 Sep 2022', venue: 'Bluebox, York',         lineup: ['Allfield', 'B:Cam', 'Deo', 'Owari', 'Yuba'] },
  { img: 'posters/Breaka & Tom VR - 18 Jun 2022.webp',                        title: 'Breaka & Tom VR',                        meta: '18 Jun 2022', venue: 'The Crescent, York',    lineup: ['Breaka', 'Tom VR', 'Owari'] },
  { img: 'posters/Chameleon Intimate Party - 17 Apr 2022.webp',               title: 'An Intimate Party',                      meta: '17 Apr 2022', venue: 'Bluebox, York',         lineup: ['Deo', 'Allfield', 'Yuba', 'B:Cam'] },
  { img: 'posters/The Chameleon - Residents - 18 Mar 2022.webp',              title: 'The Chameleon',                          meta: '18 Mar 2022', venue: 'Bluebox, York',         lineup: ['Allfield', 'B:Cam', 'Deo', 'Owari', 'New Ends', 'Yuba'] },
  { img: 'posters/Barker - 25 Feb 2022.webp',                                 title: 'Barker',                                 meta: '25 Feb 2022', venue: 'Bluebox, York',         lineup: ['Barker', 'Oren', 'Deo', 'Yuba'] },
  { img: 'posters/Lenzman & Fox - 13 Feb 2022.webp',                          title: 'Lenzman & Fox',                          meta: '13 Feb 2022', venue: 'Bluebox, York',         lineup: ['Lenzman', 'Fox', 'Deo'] },
  { img: 'posters/Adam Pits - 21 Jan 2022.webp',                              title: 'Adam Pits',                              meta: '21 Jan 2022', venue: 'Bluebox, York',         lineup: ['Adam Pits', 'Allfield', 'B:Cam', 'Deo', 'Yuba', 'Owari'] },

  // ---- 2021
  { img: 'posters/Back to Basics - 3 Dec 2021.webp',                          title: 'Back to Basics',                         meta: '3 Dec 2021',  venue: 'Bluebox, York',         lineup: ['Allfield', 'B:Cam', 'Deo', 'Owari'] },
  { img: 'posters/Hutch - 29 Oct 2021.webp',                                  title: 'Hutch',                                  meta: '29 Oct 2021', venue: 'Bluebox, York',         lineup: ['Hutch', 'Allfield', 'Deo', 'Savio', 'New Ends'] },
  { img: 'posters/Send Return - 1 Oct 2021.webp',                             title: 'Send / Return',                          meta: '1 Oct 2021',  venue: 'Bluebox, York',         lineup: ['Owari', 'Allfield', 'B:Cam', 'Deo'] },

  // ---- 2020 (earliest known flyer — first venue)
  { img: 'posters/Chameleon 002 x The Lounge - 21 Feb 2020.webp',             title: 'Chameleon 002 · The Lounge',             meta: '21 Feb 2020', venue: 'The Lounge, York',      lineup: [] },
];

// Chronological sort — featured stays at the anchor, the rest run oldest → newest
// around the rotunda starting one slot clockwise from the featured.
{
  const MONTHS = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const parseMeta = s => {
    if (!s) return Infinity;
    if (/^\d{4}$/.test(s)) return Date.UTC(+s, 0, 1);
    const m = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (m) {
      const mon = MONTHS[m[2].toLowerCase().slice(0, 3)];
      if (mon !== undefined) return Date.UTC(+m[3], mon, +m[1]);
    }
    return Infinity;
  };
  POSTERS.sort((a, b) => {
    if (a.featured) return -1;
    if (b.featured) return 1;
    return parseMeta(a.meta) - parseMeta(b.meta);
  });

  // Assign museum-style index labels — each comma-separated date in meta
  // counts as a distinct event, so the Crescent residency (3 nights) takes
  // 3 slots. Featured/multi-date posters get a range like "48–50".
  const dateEvents = [];
  for (const p of POSTERS) {
    const dates = (p.meta || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const d of dates) dateEvents.push({ poster: p, time: parseMeta(d) });
  }
  dateEvents.sort((a, b) => a.time - b.time);
  const totalEvents = dateEvents.length;
  const posterPositions = new Map();
  dateEvents.forEach((e, i) => {
    const pos = i + 1;
    const arr = posterPositions.get(e.poster);
    if (arr) arr.push(pos); else posterPositions.set(e.poster, [pos]);
  });
  for (const p of POSTERS) {
    const positions = posterPositions.get(p) || [];
    if (positions.length === 0) { p.indexLabel = ''; continue; }
    const first = positions[0], last = positions[positions.length - 1];
    p.indexLabel = first === last
      ? `${first} / ${totalEvents}`
      : `${first}–${last} / ${totalEvents}`;
  }
}

// =============================================================================
//  Gallery dimensions (metres) — open-air circular rotunda
// =============================================================================
const ROOM = { radius: 18, height: 6.0 };
const EYE_Y = 1.65;
const WALK_MARGIN = 1.5;
const WALKABLE_R   = ROOM.radius - WALK_MARGIN;
const VIEW_DISTANCE = 2.0;   // how far from a poster the camera glides

// =============================================================================
//  Renderer / scene / camera
// =============================================================================
// Cheap mobile detection — used throughout to dial down expensive features.
// "pointer: coarse" catches touch screens; the user-agent fallback also
// catches headless / iPad-in-desktop-mode etc.
const isMobile = window.matchMedia('(pointer: coarse)').matches
              || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

// Build-time-injected version string (build.mjs replaces __SITE_VERSION__
// with `v0.<git-commit-count>`). Falls back to a dev marker when run
// unbundled (i.e. the substitution didn't happen).
// eslint-disable-next-line no-undef
const SITE_VERSION = typeof __SITE_VERSION__ !== 'undefined' ? __SITE_VERSION__ : 'v0.dev';

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
  logarithmicDepthBuffer: true,   // prevents z-fighting on distant near-coplanar surfaces
});
// Render 1.5× the screen's native DPR — modest supersample for sharp edges
// without melting the GPU. Capped at 3 so a 3×-DPR display doesn't spike.
renderer.setPixelRatio(Math.min(window.devicePixelRatio * 1.5, 3));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.60;
const canvasEl = renderer.domElement;
document.getElementById('app').appendChild(canvasEl);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#000000');
// Atmospheric fog — a touch heavier now so opposite-side posters soften into
// haze (gives the rotunda real depth) without fully dissolving. Pure black
// keeps the void feel.
scene.fog = new THREE.FogExp2('#000000', 0.030);

const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 600);

// =============================================================================
//  Intro fly-through (Artisans d'idées style) — camera starts deep in the fog
//  far behind the spawn point, glides forward, and lands at eye height.
// =============================================================================
const INTRO_SPAWN = new THREE.Vector3(0, EYE_Y, ROOM.radius * 0.30);
const intro = {
  active: false,            // flipped on by manager.onLoad once textures are in
  t0: 0,
  duration: 6800,           // ms
  // Start WAY further out and ABOVE — the easeOutCubic curve below makes the
  // camera enter at peak speed and decelerate as it approaches the rotunda.
  fromPos:   new THREE.Vector3(5.0, 5.5, ROOM.radius * 10.0),
  toPos:     INTRO_SPAWN.clone(),
  fromYaw:   0.10,
  toYaw:     0,
  fromPitch: -0.05,
  toPitch:   0,
};
// Camera lives at the start of the fly path until manager.onLoad fires
camera.position.copy(intro.fromPos);
camera.lookAt(0, 2.0, 0);

// =============================================================================
//  Loading manager
// =============================================================================
const manager = new THREE.LoadingManager();
const loadbar = document.getElementById('loadbar');
const splash  = document.getElementById('loading');
const promptEl = document.getElementById('prompt');
// Distinct, chip-style hints per input device — keeps the HUD readable
// without trying to cover every modality at once.
promptEl.innerHTML = isMobile
  ? '<kbd>swipe</kbd>look<span class="sep">·</span>'
  + '<kbd>pinch</kbd>zoom<span class="sep">·</span>'
  + '<kbd>tap</kbd>focus'
  : '<kbd>drag</kbd>look<span class="sep">·</span>'
  + '<kbd>wasd</kbd>move<span class="sep">·</span>'
  + '<kbd>scroll</kbd>zoom<span class="sep">·</span>'
  + '<kbd>click</kbd>focus';

manager.onProgress = (_url, loaded, total) => {
  const pct = total ? Math.round((loaded / total) * 100) : 0;
  loadbar.style.width = pct + '%';
};
manager.onLoad = () => {
  loadbar.style.width = '100%';
  setTimeout(() => splash.classList.add('hidden'), 200);
  setTimeout(() => splash.remove(), 1200);
  // Kick the fly-through the moment the splash starts fading away.
  setTimeout(() => {
    intro.active = true;
    intro.t0 = performance.now();
  }, 280);
};

const texLoader = new THREE.TextureLoader(manager);

// =============================================================================
//  Lighting — moody: almost no ambient, just the pillar and a hint of moon
// =============================================================================
// Very faint hemisphere — barely lifts the floor / paintings out of pure black
scene.add(new THREE.HemisphereLight(0x8a8e9a, 0x0a0c10, 2.10));

// Moon — cool directional, dim
const moon = new THREE.DirectionalLight(0xb4c0d0, 0.18);
moon.position.set(-8, 18, -6);
scene.add(moon);

// === Central pillar of light ===
// A bright vertical column at the rotunda's centre, the "axis mundi"
// kamimae's intro text refers to as "the central pillar of light".
// Symmetric gradient — brightest at the cylinder's mid-height (floor level).
// CylinderGeometry UV: v=0 at cylinder bottom, v=1 at top. With CanvasTexture
// default flipY=true: canvas BOTTOM → v=0 → cylinder bottom, canvas TOP → v=1
// → cylinder top. The MIDDLE of the canvas = the middle of the cylinder.
const pillarTex = (() => {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 512;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0.00, 'rgba(255,250,235,0)');      // top of canvas / cylinder = far sky → gone
  g.addColorStop(0.15, 'rgba(255,250,235,0.08)');
  g.addColorStop(0.35, 'rgba(255,250,235,0.55)');
  g.addColorStop(0.50, 'rgba(255,250,235,1)');      // middle of canvas / cylinder = floor level → brightest
  g.addColorStop(0.65, 'rgba(255,250,235,0.55)');
  g.addColorStop(0.85, 'rgba(255,250,235,0.08)');
  g.addColorStop(1.00, 'rgba(255,250,235,0)');      // bottom of canvas / cylinder = far below floor → gone
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();

// Beam centred on the floor: extends 60 m up AND 60 m down through the hole.
// Fog + the texture gradient combine so both ends dissolve into atmosphere.
const PILLAR_H = 120;
const PILLAR_Y = 0;            // cylinder centred ON the floor

const pillar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.22, 0.22, PILLAR_H, 24, 1, true),
  new THREE.MeshBasicMaterial({
    map: pillarTex,
    color: 0xfff4dc,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  })
);
pillar.position.y = PILLAR_Y;
scene.add(pillar);

// Wider, softer outer glow cylinder
const halo = new THREE.Mesh(
  new THREE.CylinderGeometry(1.4, 1.4, PILLAR_H, 24, 1, true),
  new THREE.MeshBasicMaterial({
    map: pillarTex,
    color: 0xfff4dc,
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: true,
  })
);
halo.position.y = PILLAR_Y;
scene.add(halo);

pillar.userData.baseOpacity = pillar.material.opacity;
halo.userData.baseOpacity   = halo.material.opacity;

// Floor light "pool" — baked radial gradient texture on a flat disc, sized
// to cover what the old PointLight used to illuminate. No per-fragment
// lighting work: just one alpha-blended quad. The pulse animation
// modulates this disc's opacity instead of a real light's intensity.
const pillarPoolTex = (() => {
  // 1024×1024 source so bilinear sampling across the 10m floor disc has
  // ~4× finer texel data than the previous 256² canvas. Eliminates the
  // banded patches iOS Safari was producing in the gradient mid-tones.
  const SZ = 1024;
  const c = document.createElement('canvas');
  c.width = c.height = SZ;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(SZ/2, SZ/2, 0, SZ/2, SZ/2, SZ/2);
  // Hot centre with a long soft falloff — like a tall column of light
  // scattering through fog onto the floor.
  g.addColorStop(0.00, 'rgba(255, 232, 188, 1.00)');
  g.addColorStop(0.10, 'rgba(255, 226, 175, 0.92)');
  g.addColorStop(0.30, 'rgba(255, 216, 158, 0.55)');
  g.addColorStop(0.55, 'rgba(255, 208, 148, 0.28)');
  g.addColorStop(0.80, 'rgba(255, 200, 140, 0.10)');
  g.addColorStop(1.00, 'rgba(255, 200, 140, 0.00)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, SZ, SZ);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
})();
const pillarPool = new THREE.Mesh(
  new THREE.CircleGeometry(10.0, 64),
  new THREE.MeshBasicMaterial({
    map:        pillarPoolTex,
    transparent: true,
    opacity:    0.40,
    blending:   THREE.AdditiveBlending,
    depthWrite: false,
    fog:        false,
  })
);
pillarPool.rotation.x = -Math.PI / 2;
pillarPool.position.y = 0.01;
pillarPool.userData.baseOpacity = pillarPool.material.opacity;
scene.add(pillarPool);

// ---- Floor: prebaked Concrete040 PBR pack (ambientCG style) at 1K — three
// WebP maps totalling ~775 KB. Switched away from runtime canvas noise so
// load-time CPU cost drops to zero and the floor has actual photographic
// detail rather than procedural grain.
const floorColorTex     = texLoader.load('textures/concrete/concrete_color.webp', t => {
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
});
const floorNormalTex    = texLoader.load('textures/concrete/concrete_normal.webp', t => {
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
});
const floorRoughnessTex = texLoader.load('textures/concrete/concrete_roughness.webp', t => {
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
});

// =============================================================================
//  Rotunda shell — circular floor disc only. No walls, no ceiling.
//  Posters float in open space; fog hides the absence of architecture.
// =============================================================================

// Floor material: MeshPhysicalMaterial with clearcoat for polished-concrete reflectivity
// Floor tile scale — each tile is ~2 m, denser repeat than before so the
// concrete texture's micro-detail is readable at walking distance.
const floorRepeat = [ROOM.radius / 2, ROOM.radius / 2];
[floorColorTex, floorNormalTex, floorRoughnessTex].forEach(t => t.repeat.set(...floorRepeat));
// Mobile uses the lighter MeshStandardMaterial — no clearcoat / anisotropy
// (those are some of the most expensive uniforms / branches in the PBR
// Warm tint multiplied with the grey concrete albedo — free way to get
// chroma into the floor without paying for a second directional light.
const FLOOR_TINT = 0xf2e6c8;   // pale ochre — lifts the outer floor out of shadow
const floorMat = new THREE.MeshPhysicalMaterial({
  color:              FLOOR_TINT,
  map:                floorColorTex,
  normalMap:          floorNormalTex,
  roughnessMap:       floorRoughnessTex,
  normalScale:        new THREE.Vector2(0.55, 0.55),
  metalness:          0.0,
  clearcoat:          0.08,
  clearcoatRoughness: 0.90,
  anisotropy:         0.4,
  anisotropyRotation: 0,
  envMapIntensity:    0.35,
});

// Floor — ring with an open hole at the centre so the light shaft can
// pass through. Inner radius matches the halo (1.4 m) so the beam fits
// neatly through the cut-out.
const FLOOR_INNER = 1.5;
const floor = new THREE.Mesh(
  new THREE.RingGeometry(FLOOR_INNER, ROOM.radius, 96, 1),
  floorMat
);
floor.rotation.x = -Math.PI / 2;
floor.userData.isFloor = true;
scene.add(floor);

// Dark inner-edge band — gives the hole a defined lip rather than melting
// into the air
const innerLip = new THREE.Mesh(
  new THREE.RingGeometry(FLOOR_INNER - 0.05, FLOOR_INNER, 96, 1),
  new THREE.MeshBasicMaterial({ color: 0x0a0b0d, side: THREE.DoubleSide, fog: false })
);
innerLip.rotation.x = -Math.PI / 2;
innerLip.position.y = 0.002;
scene.add(innerLip);

// No wall. The posters float in open space — fog + the floor disc are the
// only things that suggest a "room" boundary now.


// =============================================================================
//  Star field — points on a large hemisphere overhead
// =============================================================================
{
  const STAR_COUNT = 2200;
  const STAR_R = 380;
  const pos    = new Float32Array(STAR_COUNT * 3);
  const colour = new Float32Array(STAR_COUNT * 3);
  for (let i = 0; i < STAR_COUNT; i++) {
    // Uniform on sphere, but biased toward upper hemisphere
    const u = Math.random();
    const v = Math.random() * 0.55 + 0.45;   // 0.45..1  → upper hemisphere
    const theta = 2 * Math.PI * u;
    const phi   = Math.acos(2 * v - 1);
    pos[3*i]   = STAR_R * Math.sin(phi) * Math.cos(theta);
    pos[3*i+1] = STAR_R * Math.cos(phi);
    pos[3*i+2] = STAR_R * Math.sin(phi) * Math.sin(theta);

    // Slight colour variance — most white, a few cooler / warmer
    const tint = Math.random();
    const b    = 0.55 + Math.random() * 0.45;   // brightness
    if (tint < 0.7)      { colour[3*i] = b; colour[3*i+1] = b; colour[3*i+2] = b; }
    else if (tint < 0.85){ colour[3*i] = b * 0.85; colour[3*i+1] = b * 0.92; colour[3*i+2] = b; }
    else                  { colour[3*i] = b; colour[3*i+1] = b * 0.88; colour[3*i+2] = b * 0.75; }
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('color',    new THREE.BufferAttribute(colour, 3));

  // Round-pixel sprite via a small canvas texture
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0,   'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  g.addColorStop(1,   'rgba(255,255,255,0)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 64, 64);
  const starSprite = new THREE.CanvasTexture(c);

  const starMat = new THREE.PointsMaterial({
    size: 1.2,
    sizeAttenuation: true,
    map: starSprite,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // Expose for twinkle in the tick loop — keep an immutable copy of the base
  // colours so we can dim individual stars then restore them on a sine.
  scene.userData.stars = {
    points: stars,
    base:   new Float32Array(colour),
    count:  STAR_COUNT,
  };
}

// =============================================================================
//  Smoke clouds — fill the tunnel between the camera's intro start and the
//  rotunda entrance. The camera flies THROUGH these on the way in.
// =============================================================================
{
  const SMOKE_COUNT = 75;
  const smokeTex = (() => {
    // Wispier smoke: build from several offset radial gradients rather than
    // a single centred one, so the silhouette isn't a perfect circle. Then
    // overlay turbulence-style alpha noise to break up the soft edges.
    const SIZE = 512;
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d');

    // 7 overlapping soft puffs at random offsets
    for (let i = 0; i < 7; i++) {
      const cx = SIZE / 2 + (Math.random() - 0.5) * SIZE * 0.5;
      const cy = SIZE / 2 + (Math.random() - 0.5) * SIZE * 0.5;
      const rr = SIZE * (0.22 + Math.random() * 0.20);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rr);
      g.addColorStop(0,   'rgba(230, 232, 240, 0.55)');
      g.addColorStop(0.5, 'rgba(190, 194, 206, 0.22)');
      g.addColorStop(1,   'rgba(0, 0, 0, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    // Soft falloff at the edges so the sprite quad's corners are always
    // fully transparent — kills any rectangular billboard outline.
    const edge = ctx.createRadialGradient(SIZE / 2, SIZE / 2, SIZE * 0.30, SIZE / 2, SIZE / 2, SIZE * 0.50);
    edge.addColorStop(0, 'rgba(0, 0, 0, 0)');
    edge.addColorStop(1, 'rgba(0, 0, 0, 1)');
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, SIZE, SIZE);
    ctx.globalCompositeOperation = 'source-over';

    // Subtle alpha jitter — high-freq, low amplitude. No more visible "bubbles".
    const img = ctx.getImageData(0, 0, SIZE, SIZE);
    for (let i = 0; i < img.data.length; i += 4) {
      const a = img.data[i + 3];
      if (a < 4) continue;
      img.data[i + 3] = Math.max(0, Math.min(255, a + (Math.random() - 0.5) * 30));
    }
    ctx.putImageData(img, 0, 0);

    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  })();

  const smoke = [];
  // Clouds fill the corridor between the rotunda and the camera's start
  // position. Each sprite gets a unique texture rotation so the field doesn't
  // read as "the same shape over and over".
  for (let i = 0; i < SMOKE_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: smokeTex,
      color: 0xb2b9c6,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
      rotation: Math.random() * Math.PI * 2,    // every puff oriented differently
    });
    const s = new THREE.Sprite(mat);
    const scale = 14 + Math.random() * 22;
    s.scale.set(scale, scale, 1);
    // Distribute along the corridor with bias toward the camera start
    const t = Math.random();
    const z = ROOM.radius * 0.8 + Math.pow(t, 0.5) * ROOM.radius * 9.6;
    s.position.set(
      (Math.random() - 0.5) * 38,
      Math.random() * 7 - 0.5,
      z,
    );
    s.userData.targetOpacity = 0.40 + Math.random() * 0.25;
    s.userData.driftX        = (Math.random() - 0.5) * 0.06;
    s.userData.driftY        = 0.02 + Math.random() * 0.05;
    s.userData.rotRate       = (Math.random() - 0.5) * 0.06;     // rad/s — gentle swirl
    // Start AT target opacity — the splash covers the canvas during the first
    // ~700 ms of intro anyway, so there's no visible "pop into existence".
    s.material.opacity = s.userData.targetOpacity;
    scene.add(s);
    smoke.push(s);
  }
  scene.userData.smoke = smoke;

  // ---- Gallery smoke ---- soft clouds drifting inside the rotunda,
  // permanently visible. Denser near the central pillar so they catch the
  // light as they rise through it.
  //
  // Reject positions whose sprite quad would land behind the central plaque
  // (plaque @ ~(0, 1.7, 1.9), opaque ~1.7 × 2.9 m) — without this the plaque
  // silhouette cuts hard rectangular holes through nearby smoke clouds.
  const PLAQUE_CX = 0, PLAQUE_CZ = 1.9;
  const PLAQUE_MIN_DIST = 2.6;   // metres from plaque centre (X,Z) below which a sprite gets rejected
  function pickSmokeXZ(scale) {
    for (let i = 0; i < 12; i++) {
      const r = 1.7 + Math.pow(Math.random(), 1.4) * (ROOM.radius - 3.5);
      const a = Math.random() * Math.PI * 2;
      const sx = r * Math.cos(a), sz = r * Math.sin(a);
      const d = Math.hypot(sx - PLAQUE_CX, sz - PLAQUE_CZ);
      if (d >= PLAQUE_MIN_DIST + scale * 0.3) return [sx, sz];
    }
    // After several rejections, push the sample tangentially clear of the plaque
    const a = Math.random() * Math.PI * 2;
    const r = 5 + Math.random() * 6;
    return [r * Math.cos(a), r * Math.sin(a) - PLAQUE_CZ * 0.5];
  }

  const innerSmoke = [];
  const INNER = 20;
  for (let i = 0; i < INNER; i++) {
    const mat = new THREE.SpriteMaterial({
      map: smokeTex,
      color: 0x868e9a,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      fog: true,
    });
    const s = new THREE.Sprite(mat);
    const scale = 1.5 + Math.random() * 1.6;     // 1.5–3.1 m
    s.scale.set(scale, scale, 1);
    const [sx, sz] = pickSmokeXZ(scale);
    const minY = scale / 2 + 0.3;
    const maxY = ROOM.height - scale / 2 - 0.2;
    const yPos = minY + Math.random() * Math.max(0.1, maxY - minY);
    s.position.set(sx, yPos, sz);
    s.userData.targetOpacity = 0.18 + Math.random() * 0.14;
    s.userData.scale         = scale;
    s.userData.minY          = minY;
    s.userData.maxY          = maxY;
    s.userData.driftX        = (Math.random() - 0.5) * 0.05;
    s.userData.driftY        = 0.04 + Math.random() * 0.05;
    s.userData.rotRate       = (Math.random() - 0.5) * 0.05;     // swirl
    mat.rotation             = Math.random() * Math.PI * 2;
    scene.add(s);
    innerSmoke.push(s);
  }
  scene.userData.innerSmoke   = innerSmoke;
  scene.userData.pickSmokeXZ  = pickSmokeXZ;
}

// =============================================================================
//  Floating dust particles — slow drift in the air, lit by the central pillar
// =============================================================================
{
  const DUST_COUNT = 80;
  const pos = new Float32Array(DUST_COUNT * 3);
  for (let i = 0; i < DUST_COUNT; i++) {
    const a  = Math.random() * Math.PI * 2;
    const r  = Math.sqrt(Math.random()) * ROOM.radius * 0.92;
    pos[3*i]     = r * Math.cos(a);
    pos[3*i + 1] = 0.4 + Math.random() * (ROOM.height - 0.6);
    pos[3*i + 2] = r * Math.sin(a);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  // Solid-filled circle (no alpha gradient) — iOS Safari's WebGL has known
  // bugs with PointsMaterial + radial-gradient sprites where corner alpha=0
  // pixels misread as a colour-swapped channel and render as green specks.
  // A solid disc renders consistently on every device.
  const dc = document.createElement('canvas');
  dc.width = dc.height = 32;
  const dctx = dc.getContext('2d');
  dctx.fillStyle = '#fff0dc';
  dctx.beginPath();
  dctx.arc(16, 16, 14, 0, Math.PI * 2);
  dctx.fill();
  const dustSprite = new THREE.CanvasTexture(dc);

  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({
    map: dustSprite,
    size: 0.08,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.4,                  // lower opacity since edges aren't soft now
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: true,
  }));
  scene.add(dust);

  // Hook for slow drift each frame
  scene.userData.dust = dust;

  // --- Pillar dust sparkle — extra bright motes confined inside the halo
  // radius (r < 1.4) so they catch the warm pillar light. Reads as
  // "motes drifting through the beam".
  const SPARK_COUNT = 30;
  const sparkPos = new Float32Array(SPARK_COUNT * 3);
  for (let i = 0; i < SPARK_COUNT; i++) {
    const r = Math.sqrt(Math.random()) * 1.2;
    const a = Math.random() * Math.PI * 2;
    sparkPos[3*i]   = r * Math.cos(a);
    sparkPos[3*i+1] = Math.random() * (ROOM.height - 0.4) + 0.2;
    sparkPos[3*i+2] = r * Math.sin(a);
  }
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const spark = new THREE.Points(sparkGeo, new THREE.PointsMaterial({
    map: dustSprite,
    color: 0xfff0c8,           // warm — matches the pillar light
    size: 0.06,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,                // no fog inside the bright halo
  }));
  scene.add(spark);
  scene.userData.spark = spark;
}

// =============================================================================
//  Posters
// =============================================================================
// Painting "frames" — kamimae style: no thick mat / no dark surround.
// Each painting is rendered as a slightly luminous panel floating on the wall
// with a hairline edge. The painting reads as the OBJECT, not a "framed photo".
const interactives = [];

// Painting groups collected so the tick loop can bob them in place
const paintings = [];

// Card resources shared across all paintings — single material instance saves
// per-draw uniform updates; geometries shared per size so 47 non-featured cards
// reference the same BoxGeometry on the GPU.
// Warm cream tint for poster albedo — sells the impression of being lit by
// the central pillar's wash without paying for any real light on these
// unlit MeshBasicMaterials.
const POSTER_BASE_COLOR = new THREE.Color(0xf6e8cc);
const CARD_PAD   = 0.07;
const CARD_DEPTH = 0.025;
const cardMat = new THREE.MeshStandardMaterial({ color: 0x1f2125, roughness: 0.9, metalness: 0 });
const _cardGeomCache = new Map();
function _cardGeom(w, h) {
  const key = `${w.toFixed(3)}x${h.toFixed(3)}`;
  let g = _cardGeomCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w + CARD_PAD * 2, h + CARD_PAD * 2, CARD_DEPTH);
    _cardGeomCache.set(key, g);
  }
  return g;
}

function makePoster({ img, title, meta, url, indexLabel, venue, lineup, w, h }, parent) {
  const tex = texLoader.load(img, t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  });

  const group = new THREE.Group();

  // Backing card — shared geometry (size keyed) + shared material across all paintings
  const card = new THREE.Mesh(_cardGeom(w, h), cardMat);
  card.position.z = -CARD_DEPTH / 2;
  card.renderOrder = 0;
  group.add(card);

  // The painting itself — unlit basic material so colours stay true
  // regardless of how dim the room is. Color multiplier dims pure-white pixels
  // so they don't punch through the moody ambient and trigger bloom.
  // Base tint — slight warm cream so all posters read as kissed by the warm
  // pillar wash rather than sitting on a cold neutral. Click-flash multiplies
  // around this base, so it's the colour each painting "rests" at.
  const artMat = new THREE.MeshBasicMaterial({ map: tex, color: POSTER_BASE_COLOR, fog: true });
  const art = new THREE.Mesh(new THREE.PlaneGeometry(w, h), artMat);
  art.position.z = 0.002;
  art.renderOrder = 1;
  art.userData = { title, meta, url, indexLabel, venue, lineup, isPoster: true, group, edge: card, artMat };
  group.add(art);
  interactives.push(art);

  // Floating motion params — each painting bobs at a slightly different
  // freq + phase so the ring isn't in lockstep
  group.userData.bobAmp   = 0.015 + Math.random() * 0.018;   // 1.5–3.3 cm (subtle)
  group.userData.bobFreq  = 0.3 + Math.random() * 0.3;
  group.userData.bobPhase = Math.random() * Math.PI * 2;
  group.userData.paintingIdx = paintings.length;
  group.userData.artMat = artMat;             // back-ref for click-flash + others
  paintings.push(group);

  parent.add(group);
  return group;
}

// Posters placed evenly around the cylinder. Angle θ = 0 is +X. The featured
// poster is anchored at -Z (north), opposite the camera spawn at +Z.
const ALL = POSTERS;       // featured first in the list, then the rest
const N   = ALL.length;    // 8 total

// ---- Baked "blob" shadow texture — used under the plaque only now.
// Soft radial alpha gradient laid flat just above the floor.
const blobShadowTex = (() => {
  const bc = document.createElement('canvas');
  bc.width = bc.height = 128;
  const bx = bc.getContext('2d');
  const g = bx.createRadialGradient(64, 64, 0, 64, 64, 62);
  g.addColorStop(0,    'rgba(0, 0, 0, 0.70)');
  g.addColorStop(0.55, 'rgba(0, 0, 0, 0.28)');
  g.addColorStop(1,    'rgba(0, 0, 0, 0)');
  bx.fillStyle = g;
  bx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(bc);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const blobShadowMat = new THREE.MeshBasicMaterial({
  map: blobShadowTex,
  transparent: true,
  depthWrite: false,
  fog: true,
});

// ---- Single reusable "overhead light flash" sprite — when the user clicks
// a poster from afar, this sprite is briefly positioned just above that
// poster and faded in/out to draw the eye to the target. Skipped when the
// camera is already close to the poster (would just be glare in the face).
const overheadFlashTex = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const cx = c.getContext('2d');
  const g = cx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0.00, 'rgba(255, 244, 210, 1.00)');
  g.addColorStop(0.30, 'rgba(255, 226, 170, 0.55)');
  g.addColorStop(0.70, 'rgba(255, 210, 145, 0.14)');
  g.addColorStop(1.00, 'rgba(255, 200, 140, 0.00)');
  cx.fillStyle = g;
  cx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const overheadFlash = new THREE.Sprite(new THREE.SpriteMaterial({
  map:        overheadFlashTex,
  transparent: true,
  blending:   THREE.AdditiveBlending,
  depthWrite: false,
  fog:        true,
  opacity:    0,
}));
overheadFlash.scale.set(0.30, 0.30, 1);
overheadFlash.visible = false;
scene.add(overheadFlash);

function placePosterAt(p, angle, isFeatured) {
  const w = 1.15;
  const h = 1.5;
  const y = 1.7;

  const g = makePoster({ ...p, w, h }, scene);

  // Float at this radius (no wall — paintings are free-standing)
  const r = ROOM.radius - 0.3;
  g.position.set(r * Math.cos(angle), y, r * Math.sin(angle));
  g.userData.baseY = y;

  // Face the centre (inward normal)
  const normal = new THREE.Vector3(-Math.cos(angle), 0, -Math.sin(angle));
  g.userData.normal = normal;
  g.rotation.y = Math.atan2(normal.x, normal.z);

  // Featured poster keeps its larger size but no longer gets a spotlight or
  // halo — it should read like the rest of the gallery, just bigger.
}

// Featured at north (-Z) = angle 3π/2 (so cos=0, sin=-1)
placePosterAt(ALL[0], -Math.PI / 2, true);

// Remaining 7 distributed across the other 7/8 slots evenly around the circle
const rest = ALL.slice(1);
for (let i = 0; i < rest.length; i++) {
  // Skip the featured slot (-π/2). Offset by half-step so neighbours don't crowd.
  const angle = -Math.PI / 2 + (i + 1) * (Math.PI * 2 / N);
  placePosterAt(rest[i], angle, false);
}

// =============================================================================
//  Central plaque — shrine of names + community thanks
// =============================================================================
{
  // The plaque face is a pre-baked WebP (see CHAMELEON/photos/plaque.webp,
  // generated from /tmp/render-plaque.html via headless Chrome). Avoids the
  // runtime canvas paint + GPU re-upload + web-font flash that the previous
  // CanvasTexture approach required.
  const PLAQUE_TEX_W = 1536, PLAQUE_TEX_H = 2600;   // source pixels, used for aspect + photo overlay UVs
  const plaqueTex = texLoader.load('photos/plaque.webp', t => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  });

  // -- Build the plaque mesh --
  const w = 1.7;
  const h = w * (PLAQUE_TEX_H / PLAQUE_TEX_W);   // preserve source-image aspect
  const plaqueGroup = new THREE.Group();

  // Dark metal backing (frame)
  const backing = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.04),
    new THREE.MeshStandardMaterial({ color: 0x0a0c10, roughness: 0.5, metalness: 0.35 })
  );
  backing.position.z = -0.02;
  plaqueGroup.add(backing);

  // The plaque face — unlit so it reads cleanly in the dim moonlit room
  const face = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: plaqueTex, color: 0xc8c8c8, fog: true })
  );
  face.position.z = 0.002;
  plaqueGroup.add(face);

  // Event photo is now baked directly into plaque.webp (with feathered edges),
  // so no separate 3D overlay plane is needed — saves a draw call, a texture
  // upload, and the alpha-blend cost of a transparent plane.

  // ---- "made by allfield" credit on the back of the plaque ----
  // Transparent canvas so only the text pixels render over the dark backing.
  {
    const bc = document.createElement('canvas');
    bc.width = 1024; bc.height = 256;
    const bx = bc.getContext('2d');
    bx.textAlign = 'center';
    bx.textBaseline = 'middle';

    // Credit line
    bx.fillStyle = '#a8aeb6';
    bx.font = 'italic 400 64px "Anek Kannada", system-ui, sans-serif';
    bx.fillText('made by allfield', 512, 110);

    // Auto-incrementing build version (tracks git commit count, set at
    // bundle time in build.mjs).
    bx.fillStyle = '#6e747c';
    bx.font = '500 22px "Anek Kannada", system-ui, sans-serif';
    if ('letterSpacing' in bx) bx.letterSpacing = '3px';
    bx.fillText(SITE_VERSION, 512, 180);
    if ('letterSpacing' in bx) bx.letterSpacing = '0px';

    const backTex = new THREE.CanvasTexture(bc);
    backTex.colorSpace = THREE.SRGBColorSpace;
    backTex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const backW = w * 0.5;
    const backH = backW * (256 / 1024);
    const back = new THREE.Mesh(
      new THREE.PlaneGeometry(backW, backH),
      new THREE.MeshBasicMaterial({ map: backTex, transparent: true, fog: true })
    );
    back.position.set(0, 0, -0.041);   // 1 mm behind the backing's back face
    back.rotation.y = Math.PI;          // face -Z so it reads from behind
    plaqueGroup.add(back);
  }

  // At the foot of the pillar — just outside its glow halo (~1.4 m radius)
  const plaqueZ = 1.9;
  plaqueGroup.position.set(0, EYE_Y + 0.05, plaqueZ);
  scene.add(plaqueGroup);

  // Blob shadow under the plaque — slightly larger ellipse to match its mass
  {
    const blob = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 1.4),
      blobShadowMat
    );
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(0, 0.013, plaqueZ);
    blob.renderOrder = -2;
    scene.add(blob);
  }

  // ---- Make the plaque clickable: it glides the camera to a viewing position
  // facing it, same affordance as the painting cards. The face is now the
  // single ray-hit target (photo is baked into the same texture).
  plaqueGroup.userData.normal = new THREE.Vector3(0, 0, 1);   // faces +Z (camera spawn side)
  const plaqueMeta = {
    title: '',
    meta:  '',
    url:   '',
    isPoster:     true,                  // re-uses the existing click-to-glide path
    isPlaque:     true,
    group:        plaqueGroup,
    viewDistance: 3.6,                    // further back than posters (plaque is taller)
  };
  face.userData  = { ...plaqueMeta };
  interactives.push(face);

  // Tiny warm spotlight on the plaque so it doesn't sit in pure black
  const plaqueLight = new THREE.SpotLight(0xf1ead4, 1.4, 6, Math.PI / 5, 0.7, 1.2);
  plaqueLight.position.set(0, EYE_Y + 2.5, plaqueZ);
  plaqueLight.target.position.set(0, EYE_Y, plaqueZ);
  scene.add(plaqueLight); scene.add(plaqueLight.target);
}

// =============================================================================
//  Click ripple marker on the floor
// =============================================================================
const ripple = (() => {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.16, 0.3, 48),
    new THREE.MeshBasicMaterial({ color: 0xbfc6d0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);

  let t0 = 0, dur = 0.7, active = false;
  function fire(x, z) {
    ring.position.set(x, 0.02, z);
    ring.visible = true;
    ring.scale.setScalar(0.5);
    ring.material.opacity = 0.9;
    t0 = performance.now();
    active = true;
  }
  function update() {
    if (!active) return;
    const t = (performance.now() - t0) / 1000 / dur;
    if (t >= 1) { active = false; ring.visible = false; return; }
    const e = 1 - Math.pow(1 - t, 3);
    ring.scale.setScalar(0.5 + e * 1.4);
    ring.material.opacity = (1 - e) * 0.9;
  }
  return { fire, update };
})();

// =============================================================================
//  Camera rig — independent yaw / pitch (no PointerLockControls)
// =============================================================================
const cam = {
  yaw:        intro.fromYaw,
  pitch:      intro.fromPitch,
  targetYaw:  intro.fromYaw,
  targetPitch:intro.fromPitch,
};
camera.rotation.order = 'YXZ';

function applyCameraRotation() {
  camera.rotation.y = cam.yaw;
  camera.rotation.x = cam.pitch;
  camera.rotation.z = 0;
}
applyCameraRotation();

// =============================================================================
//  Drag-to-look (mouse + touch)
// =============================================================================
const LOOK_SENS_DESKTOP = 0.0035;
const LOOK_SENS_TOUCH   = 0.0060;        // a touch more responsive on small screens
const PITCH_MAX = Math.PI / 180 * 70;

// Active pointers, keyed by pointerId. Supports:
//   • 1 pointer down → drag-to-look
//   • 2 pointers down → pinch-to-dolly (mobile zoom = move forward / back)
const pointers = new Map();              // id → { x, y, startX, startY, startT, kind, dragging }
let primaryId   = null;                  // pointer driving the drag-to-look
let pinchActive = false;
let pinchPrevDist = 0;
const DRAG_THRESHOLD_PX = 6;
const CLICK_MAX_DUR_MS  = 350;
const PINCH_SCALE       = 0.014;          // similar feel to wheel-dolly

function pinchDistance() {
  const arr = [...pointers.values()];
  if (arr.length < 2) return 0;
  return Math.hypot(arr[0].x - arr[1].x, arr[0].y - arr[1].y);
}

canvasEl.addEventListener('pointerdown', e => {
  if (intro.active) return;
  // Left (0) clicks-and-drags; middle (1) is drag-only (no click) so users
  // can pan the view without triggering navigation. Right-click left alone.
  if (e.button !== undefined && e.button !== 0 && e.button !== 1) return;
  if (e.button === 1) e.preventDefault();   // suppress browser autoscroll
  markInteraction();
  pointers.set(e.pointerId, {
    x: e.clientX, y: e.clientY,
    startX: e.clientX, startY: e.clientY,
    startT: performance.now(),
    kind: e.pointerType === 'touch' ? 'touch' : 'mouse',
    button: e.button ?? 0,
    dragging: false,
  });
  canvasEl.setPointerCapture(e.pointerId);

  if (pointers.size === 1) {
    primaryId = e.pointerId;
  } else if (pointers.size === 2) {
    // Second finger landed — switch to pinch mode
    pinchActive = true;
    pinchPrevDist = pinchDistance();
    canvasEl.classList.remove('dragging');
    promptEl.classList.add('hide');
    // Mark every pointer currently involved as "was in a pinch" so neither
    // finger's eventual release triggers a tap-to-glide. Without this, the
    // second-released finger can fire handleClick(...) on pointerup because
    // pinchActive flips to false before its release event lands.
    for (const p of pointers.values()) p.wasInPinch = true;
  }
});

canvasEl.addEventListener('pointermove', e => {
  if (intro.active) return;
  markInteraction();
  const p = pointers.get(e.pointerId);
  if (!p) { handleHover(e.clientX, e.clientY); return; }
  const prevX = p.x, prevY = p.y;
  p.x = e.clientX;
  p.y = e.clientY;

  if (pinchActive) {
    // Two-finger pinch — feed the distance delta into the existing dolly drain
    const d = pinchDistance();
    const delta = d - pinchPrevDist;
    pinchPrevDist = d;
    dollyTarget.dist += delta * PINCH_SCALE;
    return;
  }

  if (e.pointerId !== primaryId) return;
  if (!p.dragging) {
    const movedTotal = Math.hypot(p.x - p.startX, p.y - p.startY);
    if (movedTotal > DRAG_THRESHOLD_PX) {
      p.dragging = true;
      canvasEl.classList.add('dragging');
      promptEl.classList.add('hide');
    } else {
      return;
    }
  }
  // Per-frame delta against the previous reported position
  const stepX = p.x - prevX;
  const stepY = p.y - prevY;
  const sens = p.kind === 'touch' ? LOOK_SENS_TOUCH : LOOK_SENS_DESKTOP;
  // Touch: swipe in the direction you want to look (FPS-style — finger right → view turns right).
  // Desktop: drag-the-world style (finger right → view turns left, matches the rest of the web).
  if (p.kind === 'touch') {
    cam.targetYaw   += stepX * sens;
    cam.targetPitch += stepY * sens;
  } else {
    cam.targetYaw   -= stepX * sens;
    cam.targetPitch -= stepY * sens;
  }
  if (cam.targetPitch >  PITCH_MAX) cam.targetPitch =  PITCH_MAX;
  if (cam.targetPitch < -PITCH_MAX) cam.targetPitch = -PITCH_MAX;
});

canvasEl.addEventListener('pointerup', e => {
  const p = pointers.get(e.pointerId);
  if (!p) return;
  pointers.delete(e.pointerId);
  try { canvasEl.releasePointerCapture(e.pointerId); } catch (_) {}

  // Was this a quick tap (no drag, no pinch)? Trigger click-to-glide.
  // Middle-button presses are drag-only — never count as a click.
  // Pointers flagged `wasInPinch` participated in a two-finger gesture and
  // are excluded too, even after pinchActive has already flipped off.
  const dur = performance.now() - p.startT;
  if (!p.dragging && !pinchActive && !p.wasInPinch && dur < CLICK_MAX_DUR_MS && p.button !== 1) {
    handleClick(p.x, p.y);
  }

  if (pinchActive) {
    if (pointers.size < 2) {
      // Second finger lifted — pinch over. If a finger remains, treat as fresh drag
      pinchActive = false;
      const remaining = pointers.values().next().value;
      if (remaining) {
        primaryId = [...pointers.keys()][0];
        remaining.startX = remaining.x;
        remaining.startY = remaining.y;
        remaining.startT = performance.now();
        remaining.dragging = false;
      }
    }
  } else if (e.pointerId === primaryId) {
    canvasEl.classList.remove('dragging');
    primaryId = pointers.size ? [...pointers.keys()][0] : null;
  }
});

canvasEl.addEventListener('pointercancel', e => {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchActive = false;
  if (pointers.size === 0) {
    canvasEl.classList.remove('dragging');
    primaryId = null;
  }
});

// Prevent the context menu so right-clicks (some trackpads) don't pop up
canvasEl.addEventListener('contextmenu', e => e.preventDefault());

// =============================================================================
//  Mouse wheel — dolly along the camera's forward vector, clamped to room
// =============================================================================
const WHEEL_DOLLY = 0.012;   // metres per pixel of deltaY
const dollyTarget = { dist: 0 };  // signed metres to apply over the next few frames

// =============================================================================
//  Keyboard movement — WASD + arrow keys for free walking
// =============================================================================
const moveKeys = { f: false, b: false, l: false, r: false };

window.addEventListener('keydown', e => {
  if (intro.active) return;
  // When focused on a painting (info card visible), left/right arrows step
  // between posters instead of strafing — matches the on-screen nav arrows.
  const onPoster = document.getElementById('card').classList.contains('show');
  if (onPoster && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
    navigatePainting(e.code === 'ArrowLeft' ? -1 : +1);
    markInteraction();
    e.preventDefault();
    return;
  }
  let handled = true;
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    moveKeys.f = true; break;
    case 'KeyS': case 'ArrowDown':  moveKeys.b = true; break;
    case 'KeyA': case 'ArrowLeft':  moveKeys.l = true; break;
    case 'KeyD': case 'ArrowRight': moveKeys.r = true; break;
    default: handled = false;
  }
  if (handled) {
    if (glide.active) glide.active = false;   // keyboard cancels click-glide
    promptEl.classList.add('hide');
    markInteraction();
    e.preventDefault();
  }
});

window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'KeyW': case 'ArrowUp':    moveKeys.f = false; break;
    case 'KeyS': case 'ArrowDown':  moveKeys.b = false; break;
    case 'KeyA': case 'ArrowLeft':  moveKeys.l = false; break;
    case 'KeyD': case 'ArrowRight': moveKeys.r = false; break;
  }
});

canvasEl.addEventListener('wheel', e => {
  if (intro.active) { e.preventDefault(); return; }
  e.preventDefault();
  markInteraction();
  // Normalise deltas across line/page modes
  let delta = e.deltaY;
  if (e.deltaMode === 1) delta *= 16;       // lines
  else if (e.deltaMode === 2) delta *= 100; // pages
  // Scroll down = forward, scroll up = back. Inverted feels more natural.
  dollyTarget.dist += -delta * WHEEL_DOLLY;
  promptEl.classList.add('hide');
}, { passive: false });

// =============================================================================
//  Raycasting — hover + click
// =============================================================================
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function clientToNdc(x, y) {
  ndc.x = (x / window.innerWidth)  *  2 - 1;
  ndc.y = (y / window.innerHeight) * -2 + 1;
}

function pickPoster(x, y) {
  clientToNdc(x, y);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObjects(interactives, false);
  return hits[0] || null;
}

function pickFloor(x, y) {
  clientToNdc(x, y);
  ray.setFromCamera(ndc, camera);
  const hits = ray.intersectObject(floor, false);
  return hits[0] || null;
}

let hoverTimer = 0;
let hoveredArt = null;
function handleHover(x, y) {
  // Throttle: only check every ~50 ms
  const now = performance.now();
  if (now - hoverTimer < 50) return;
  hoverTimer = now;
  const hit = pickPoster(x, y);
  const newArt = hit ? hit.object : null;

  if (newArt !== hoveredArt) {
    // Restore the previous one
    if (hoveredArt && hoveredArt.userData.edge) {
      hoveredArt.userData.edge.material.opacity = 0.55;
    }
    hoveredArt = newArt;
    if (hoveredArt && hoveredArt.userData.edge) {
      hoveredArt.userData.edge.material.opacity = 1.0;
    }
  }

  if (newArt) canvasEl.classList.add('hover-poster');
  else        canvasEl.classList.remove('hover-poster');
}

function handleClick(x, y) {
  promptEl.classList.add('hide');
  // Priority: poster first, then floor
  const poster = pickPoster(x, y);
  if (poster) {
    glideToPoster(poster.object);
    return;
  }
  const floorHit = pickFloor(x, y);
  if (floorHit) {
    const p = floorHit.point;
    glideToFloor(p.x, p.z);
    ripple.fire(p.x, p.z);
  }
}

// =============================================================================
//  Glide / tween system
// =============================================================================
const glide = {
  active: false,
  pending: false,    // true during the jiggle wind-up before startGlide fires
  t0: 0, dur: 1,
  fromPos: new THREE.Vector3(), toPos: new THREE.Vector3(),
  fromYaw: 0, toYaw: 0,
  fromPitch: 0, toPitch: 0,
  onDone: null,
};

function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }

function wrapYawDelta(from, to) {
  // Find shortest signed rotation from -> to within [-PI, PI]
  let d = to - from;
  while (d >  Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + d;
}

const INNER_BAN_R = 1.7;   // can't walk inside the floor hole
function clampWalkable(x, z) {
  const r = Math.hypot(x, z);
  if (r > WALKABLE_R) {
    const k = WALKABLE_R / r;
    return { x: x * k, z: z * k };
  }
  if (r < INNER_BAN_R) {
    if (r < 0.0001) return { x: 0, z: INNER_BAN_R };
    const k = INNER_BAN_R / r;
    return { x: x * k, z: z * k };
  }
  return { x, z };
}

function startGlide(toX, toZ, toYaw, toPitch, onDone) {
  const fromX = camera.position.x;
  const fromZ = camera.position.z;
  const dist  = Math.hypot(toX - fromX, toZ - fromZ);
  const yawDelta = Math.abs(wrapYawDelta(cam.yaw, toYaw) - cam.yaw);

  // Short-range clicks: skip the position glide entirely and just hand the
  // look targets to the exponential damping. A real glide here would cram a
  // significant yaw change into ~0.6 s and read as a "spasm".
  if (dist < 0.6) {
    cam.targetYaw   = wrapYawDelta(cam.yaw, toYaw);
    cam.targetPitch = toPitch;
    if (onDone) onDone();
    return;
  }

  // Duration scales with whichever motion is larger so that short-but-
  // heavily-rotating glides don't whip past too quickly.
  const dur = Math.min(2.2, Math.max(0.6 + 0.18 * dist, 0.5 + 0.45 * yawDelta));

  glide.fromPos.set(fromX, EYE_Y, fromZ);
  glide.toPos.set(toX, EYE_Y, toZ);
  glide.fromYaw   = cam.yaw;
  glide.toYaw     = wrapYawDelta(cam.yaw, toYaw);
  glide.fromPitch = cam.pitch;
  glide.toPitch   = toPitch;
  glide.dur = dur;
  glide.t0  = performance.now();
  glide.active = true;
  glide.onDone = onDone || null;

  // Also seed look targets so smoothing matches the tween
  cam.targetYaw   = glide.toYaw;
  cam.targetPitch = toPitch;
}

function updateGlide() {
  if (!glide.active) return;
  const t = (performance.now() - glide.t0) / 1000 / glide.dur;
  if (t >= 1) {
    camera.position.set(glide.toPos.x, EYE_Y, glide.toPos.z);
    cam.yaw   = glide.toYaw;
    cam.pitch = glide.toPitch;
    glide.active = false;
    if (glide.onDone) { const fn = glide.onDone; glide.onDone = null; fn(); }
    return;
  }
  const e = easeOutCubic(t);
  camera.position.x = glide.fromPos.x + (glide.toPos.x - glide.fromPos.x) * e;
  camera.position.z = glide.fromPos.z + (glide.toPos.z - glide.fromPos.z) * e;
  cam.yaw   = glide.fromYaw   + (glide.toYaw   - glide.fromYaw)   * e;
  cam.pitch = glide.fromPitch + (glide.toPitch - glide.fromPitch) * e;
}

function glideToFloor(targetX, targetZ) {
  const c = clampWalkable(targetX, targetZ);
  // Face direction of travel (only if meaningful distance)
  const dx = c.x - camera.position.x;
  const dz = c.z - camera.position.z;
  const distSq = dx*dx + dz*dz;
  let yaw = cam.yaw;
  if (distSq > 0.04) {
    yaw = Math.atan2(dx, dz) + Math.PI;  // camera looks down -Z by default, so atan2 of forward
  }
  hideCard();
  startGlide(c.x, c.z, yaw, cam.pitch);
}

let currentPaintingIdx = -1;  // -1 = none focused yet; bumped to the painting's index on each glideToPoster

function navigatePainting(delta) {
  if (intro.active || !paintings.length) return;
  if (currentPaintingIdx < 0) {
    // First nav: pick the painting whose angular position is closest to the
    // direction the camera is currently facing (skipping the featured slot
    // if it's behind us, so the first arrow tap moves to something nearby).
    camera.getWorldDirection(_tmpFwd);
    const camAng = Math.atan2(_tmpFwd.z, _tmpFwd.x);
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < paintings.length; i++) {
      const p = paintings[i];
      const a = Math.atan2(p.position.z, p.position.x);
      let d = Math.abs(a - camAng);
      while (d > Math.PI) d = Math.PI * 2 - d;
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    currentPaintingIdx = bestIdx;
  } else {
    currentPaintingIdx = (currentPaintingIdx + delta + paintings.length) % paintings.length;
  }
  const group = paintings[currentPaintingIdx];
  const art = group.children.find(c => c.userData && c.userData.isPoster);
  if (art) glideToPoster(art, false);   // arrow nav: no rock + no wind-up delay
}

document.getElementById('navPrev').addEventListener('click', () => navigatePainting(-1));
document.getElementById('navNext').addEventListener('click', () => navigatePainting(+1));

function glideToPoster(art, withRock = true) {
  const group = art.userData.group;
  // Track which painting is "current" for the prev/next arrow nav (not for the plaque)
  if (!art.userData.isPlaque && group.userData.paintingIdx !== undefined) {
    currentPaintingIdx = group.userData.paintingIdx;
  }
  const normal = group.userData.normal.clone();
  // Allow per-target override (plaque needs more distance than a painting)
  const viewDist = art.userData.viewDistance ?? VIEW_DISTANCE;
  // Position: in front of target, at eye height
  const wx = group.position.x + normal.x * viewDist;
  const wz = group.position.z + normal.z * viewDist;
  const c = clampWalkable(wx, wz);
  // Yaw to face poster: look from camera toward poster centre
  const yaw = Math.atan2(group.position.x - c.x, group.position.z - c.z) + Math.PI;
  // Use the painting's baseY so the pitch target doesn't jitter with the bob
  const targetY = group.userData.baseY ?? group.position.y;
  const dy = targetY - EYE_Y;
  const flatDist = Math.hypot(group.position.x - c.x, group.position.z - c.z);
  const pitch = Math.atan2(dy, flatDist);
  // Paintings: show the info card + nav arrows immediately at click time so
  // there's no waiting through the glide to see what you clicked.
  // Plaque: no card (it has no title/meta).
  if (art.userData.isPlaque) hideCard();
  else                       showCard(art);
  // Posters: kick off a damped jiggle, then start the glide a beat later so
  // the user sees the click register before the camera takes over. Plaque
  // is already the central focus, so skip the wind-up for it.
  if (art.userData.isPlaque || !withRock) {
    startGlide(c.x, c.z, yaw, pitch, null);
  } else {
    group.userData.rockT0  = performance.now();
    group.userData.flashT0 = performance.now();
    // Overhead light flash — only if camera is more than ~3 m out from this
    // poster, so close-up clicks don't get a glare in the face.
    const cdx = camera.position.x - group.position.x;
    const cdz = camera.position.z - group.position.z;
    if (Math.hypot(cdx, cdz) > 3.0) {
      overheadFlash.position.set(group.position.x, group.userData.baseY + 1.25, group.position.z);
      overheadFlash.visible = true;
      overheadFlash.userData.t0 = performance.now();
    }
    glide.pending = true;
    setTimeout(() => {
      glide.pending = false;
      startGlide(c.x, c.z, yaw, pitch, null);
    }, 130);
  }
}

// =============================================================================
//  Info card
// =============================================================================
const cardEl   = document.getElementById('card');
const cardBody = document.getElementById('cardBody');
let cardArt = null;

// "29 Jun 2024" → "Saturday 29th June 2024"; "2021" stays "2021"; empty stays empty.
const _FULL_MONTH = {
  jan: 'January', feb: 'February', mar: 'March',     apr: 'April',
  may: 'May',     jun: 'June',     jul: 'July',      aug: 'August',
  sep: 'September', oct: 'October', nov: 'November', dec: 'December',
};
const _MONTH_IDX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4,  jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const _DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function _ordinal(n) {
  if (n >= 11 && n <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}
function _parseOne(p) {
  const m = p.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const monKey = m[2].toLowerCase().slice(0, 3);
  if (!_FULL_MONTH[monKey]) return null;
  return { day: +m[1], monKey, year: +m[3] };
}
function _formatOne(p, withYear) {
  const dow = _DAYS[new Date(Date.UTC(p.year, _MONTH_IDX[p.monKey], p.day)).getUTCDay()];
  return `${dow} ${_ordinal(p.day)} ${_FULL_MONTH[p.monKey]}${withYear ? ` ${p.year}` : ''}`;
}
const _DAY_SHORT   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const _MONTH_SHORT = { jan:'Jan',feb:'Feb',mar:'Mar',apr:'Apr',may:'May',jun:'Jun',
                       jul:'Jul',aug:'Aug',sep:'Sep',oct:'Oct',nov:'Nov',dec:'Dec' };
function _formatOneCompact(p) {
  const dow = _DAY_SHORT[new Date(Date.UTC(p.year, _MONTH_IDX[p.monKey], p.day)).getUTCDay()];
  return `${dow} ${p.day} ${_MONTH_SHORT[p.monKey]} ${p.year}`;
}
function compactDate(s) {
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return s;
  if (s.includes(',')) {
    const parts = s.split(',').map(_parseOne);
    if (parts.every(Boolean)) return parts.map(_formatOneCompact).join(' · ');
  }
  const single = _parseOne(s);
  return single ? _formatOneCompact(single) : s;
}
function formalDate(s) {
  if (!s) return '';
  if (/^\d{4}$/.test(s)) return s;

  // Multi-date: comma-separated. Drop the year on all but the last entry
  // when every date shares the same year, to keep the line scannable.
  if (s.includes(',')) {
    const parts = s.split(',').map(_parseOne);
    if (parts.every(Boolean)) {
      const sameYear = parts.every(p => p.year === parts[0].year);
      return parts
        .map((p, i) => _formatOne(p, !sameYear || i === parts.length - 1))
        .join(' · ');
    }
  }

  const single = _parseOne(s);
  return single ? _formatOne(single, true) : s;
}

const navPrevEl = document.getElementById('navPrev');
const navNextEl = document.getElementById('navNext');

// Normalise a stage name for comparison — strips stylisation suffixes
// (e.g. "Deo_" → "deo", "Oren." → "oren") and case so headliner-vs-lineup
// matching is reliable.
function _normName(n) {
  return n.toLowerCase().replace(/[_.\s]+$/g, '').replace(/\s+/g, ' ').trim();
}

function showCard(art) {
  cardArt = art;
  const { title, meta, indexLabel, venue, lineup } = art.userData;

  // "Artists · Subtitle" — artists stay on a single line (b2b / & preserved);
  // anything after " · " becomes the small italic event subtitle.
  const dotSplit = title.split(' · ');
  const primary   = dotSplit[0];
  let   subtitle  = dotSplit.slice(1).join(' · ');

  // Birthday subtitles ("Chameleon 6th Birthday", "5th Birthday", etc.) get
  // pulled out into a top-right badge instead of taking a body line.
  let badgeText = '';
  if (subtitle && /birthday/i.test(subtitle)) {
    badgeText = subtitle.replace(/^chameleon\s+/i, '');
    subtitle = '';
  }

  // Support DJs = lineup minus anyone already named in the title primary.
  // Title parts split on , & and " b2b " — same separators we accept in titles.
  const titleParts = primary.split(/\s*,\s*|\s+&\s+|\s+b2b\s+/i).map(_normName);
  const support = (lineup || []).filter(n => !titleParts.includes(_normName(n)));

  // Stale badge from a previous card needs clearing before render
  const oldBadge = cardEl.querySelector('.badge');
  if (oldBadge) oldBadge.remove();
  if (badgeText) {
    const b = document.createElement('div');
    b.className = 'badge';
    b.textContent = badgeText;
    cardEl.appendChild(b);
  }

  cardBody.replaceChildren();

  if (indexLabel) {
    const idx = document.createElement('div');
    idx.className = 'index';
    idx.textContent = indexLabel;
    cardBody.appendChild(idx);
  }

  const artistEl = document.createElement('div');
  artistEl.className = 'artist';
  artistEl.textContent = primary;
  cardBody.appendChild(artistEl);

  if (subtitle) {
    const sub = document.createElement('div');
    sub.className = 'subtitle';
    sub.textContent = subtitle;
    cardBody.appendChild(sub);
  }

  if (support.length > 0) {
    const sup = document.createElement('div');
    sup.className = 'support';
    sup.textContent = 'w/ ' + support.join(', ');
    cardBody.appendChild(sup);
  }

  const div = document.createElement('span');
  div.className = 'divider';
  cardBody.appendChild(div);

  const dateText = compactDate(meta);
  if (dateText) {
    const m = document.createElement('div');
    m.className = 'meta';
    m.textContent = dateText;
    cardBody.appendChild(m);
  }
  if (venue) {
    const v = document.createElement('div');
    v.className = 'venue';
    v.textContent = venue;
    cardBody.appendChild(v);
  }

  cardEl.classList.add('show');
  navPrevEl.classList.add('show');
  navNextEl.classList.add('show');
}
function hideCard() {
  cardArt = null;
  cardEl.classList.remove('show');
  navPrevEl.classList.remove('show');
  navNextEl.classList.remove('show');
  const b = cardEl.querySelector('.badge');
  if (b) b.remove();
}
cardEl.addEventListener('click', () => {
  if (cardArt && cardArt.userData.url) window.open(cardArt.userData.url, '_blank', 'noopener');
});

// =============================================================================
//  Environment map — real night-sky HDRI as an equirectangular Radiance
//  .hdr (RGBE encoded, 512×256, ~350 KB vs the original 1.5 MB EXR). PMREM
//  pre-filters it for env-map use, so this lower-res source looks identical
//  to a 1K HDRI after filtering. Drives the floor's PBR reflections + adds
//  proper HDR ambient IBL. Background stays the procedural starfield.
//
//  Skipped on mobile: HDR float values sampled at lower fragment precision
//  produce chromatic banding (green/magenta dots) near additive bright
//  sources like the pillar pool. HemisphereLight + tone-mapping exposure
//  carry the ambient there instead. Also saves a 350 KB download.
// =============================================================================
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  new RGBELoader(manager).load('textures/env/night-sky.hdr', tex => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    pmrem.dispose();
  });
}

// =============================================================================
//  Post-processing — bloom + vignette + subtle grain
//
//  Composer renders into a 16-bit half-float render target so channel values
//  above 1.0 (from additive lights, bloom, HDRI reflections) survive the
//  entire post chain without 8-bit quantisation banding. Without this the
//  pillar pool's additive contribution + ACES tonemap shoulder produces
//  green/magenta speckles on mobile (whose default framebuffer is strict
//  8-bit RGBA). The half-float RT is the standard Three.js HDR pipeline.
// =============================================================================
// Hardware MSAA (samples: 4) on a standard 8-bit RT. Edge anti-aliasing at
// GPU rasterisation stage, much cheaper than half-float MSAA which has 8×
// the memory bandwidth. The grain pass dithers any banding in dim mids.
const composerRT = new THREE.WebGLRenderTarget(
  window.innerWidth, window.innerHeight,
  { samples: 4 }
);
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth * 0.5, window.innerHeight * 0.5),
  0.22, 0.3, 1.0
);
composer.addPass(bloom);

// Subtle post passes (grade / vignette / grain / smaa) — all skipped on mobile
// because each is a full-screen pass and together they add ~2-3 ms / frame
// that mobile GPUs can't always afford. Bloom is preserved as the one
// signature post-pass.
const SUBTLE_POST = true;

// Color grade — subtle cool shadows / warm highlights. Anchors the palette
// without leaning Instagram-y.
const gradePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.6 },                                  // blend amount
    shadowTint:    { value: new THREE.Color(0.88, 0.93, 1.04) }, // slight teal in darks
    highlightTint: { value: new THREE.Color(1.03, 1.00, 0.95) }, // slight warm in lights
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec3 shadowTint;
    uniform vec3 highlightTint;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
      vec3 tint = mix(shadowTint, highlightTint, smoothstep(0.25, 0.75, l));
      c.rgb = mix(c.rgb, c.rgb * tint, strength);
      gl_FragColor = c;
    }
  `,
});
if (SUBTLE_POST) composer.addPass(gradePass);

// Vignette — radial edge darkening. Subtle, cinematic, drops attention onto the centre.
const vignettePass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.05 },     // a hint of edge dim, no more
    softness: { value: 0.80 },     // only the outer ~20 % of screen sees any darkening
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform float softness;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 p = vUv - 0.5;
      float d = dot(p, p) * 4.0;   // 0 at centre, ~1 at corners
      float v = smoothstep(softness, 1.0, d);
      c.rgb *= 1.0 - v * strength;
      gl_FragColor = c;
    }
  `,
});
if (SUBTLE_POST) composer.addPass(vignettePass);

// Subtle film grain — kills colour banding in the dark sky and adds a hint
// of texture. Animated via a time uniform so the grain shimmers.
const grainPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null },
    time:     { value: 0 },
    amount:   { value: 0.010 },     // barely-visible grain — just enough to break banding
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float n = hash(vUv + fract(time)) - 0.5;
      c.rgb += n * amount;
      gl_FragColor = c;
    }
  `,
});
if (SUBTLE_POST) composer.addPass(grainPass);

// SMAA — sub-pixel anti-aliasing on the final composite. ~3 full-screen
// internal passes — skipped on mobile (renderer's MSAA is good enough there).
// SMAA pass removed — hardware MSAA on the composerRT (samples: 4) is
// cheaper and visually similar quality for geometric edges.

composer.addPass(new OutputPass());

// =============================================================================
//  Main loop — look smoothing + glide + ripple + render
// =============================================================================
const LOOK_DAMP = 14;       // higher = snappier; lower = silkier
let last = performance.now();

// Allocations lifted out of the tick loop to avoid per-frame GC pressure
const _tmpFwd = new THREE.Vector3();

// Idle-bob ramp anchor: timestamp of the last frame a controlling animation
// (glide / intro / movement / pinch) was active. The bob amplitude smoothly
// ramps from 0 back to full over the seconds following.
let bobControlledLast = performance.now();

// Idle frame-rate throttle — drop to ~30 fps when the user isn't moving
// or interacting. Pulse / bob / dust still animate smoothly at 30.
// (idle-throttle helpers removed — render is always vsync-paced now)
const markInteraction = () => {};

function tick() {
  const now = performance.now();
  const dt  = Math.min(0.05, (now - last) / 1000);
  last = now;

  // ----- Floating paintings: each bobs gently in place + click rock -----
  {
    const t = now * 0.001;
    for (const p of paintings) {
      p.position.y = p.userData.baseY +
        Math.sin(t * p.userData.bobFreq + p.userData.bobPhase) * p.userData.bobAmp;
      // Click-rock: damped left-right tilt around the poster's local Z axis
      // for ~240 ms — a quick "jiggle" before the camera starts gliding.
      if (p.userData.rockT0 !== undefined) {
        const elapsed = (now - p.userData.rockT0) / 1000;
        const dur = 0.24;
        if (elapsed >= dur) {
          p.rotation.z = 0;
          p.userData.rockT0 = undefined;
        } else {
          const norm = elapsed / dur;
          const amp = (1 - norm) * 0.11;             // peak ~6°, decays linearly
          p.rotation.z = Math.sin(norm * Math.PI * 4) * amp;   // 2 oscillations
        }
      }
      // (overhead light flash is global, handled outside the per-poster loop)
      // Click-flash: brief overbright on the painting albedo (~200 ms half-sine
      // lobe peaking at 1.85× the resting POSTER_BASE_COLOR).
      if (p.userData.flashT0 !== undefined && p.userData.artMat) {
        const elapsed = (now - p.userData.flashT0) / 1000;
        const dur = 0.20;
        if (elapsed >= dur) {
          p.userData.artMat.color.copy(POSTER_BASE_COLOR);
          p.userData.flashT0 = undefined;
        } else {
          const k = 1 + Math.sin((elapsed / dur) * Math.PI) * 0.85;
          p.userData.artMat.color.copy(POSTER_BASE_COLOR).multiplyScalar(k);
        }
      }
    }
  }

  // (Pillar pulse removed — pillar/halo/pool opacities stay at their base
  // values, so the light reads as steady rather than breathing.)

  // ----- Overhead poster-click flash: fade in fast, decay slower (~360 ms)
  if (overheadFlash.visible) {
    const elapsed = (now - overheadFlash.userData.t0) / 1000;
    const dur = 0.36;
    if (elapsed >= dur) {
      overheadFlash.visible = false;
      overheadFlash.material.opacity = 0;
    } else {
      // 0 → 1 → 0 with quick rise and a slightly slower fall
      const t = elapsed / dur;
      const env = t < 0.30
        ? (t / 0.30)                           // sharp 0→1 rise in first 30%
        : 1 - ((t - 0.30) / 0.70);             // gentle 1→0 fall after
      overheadFlash.material.opacity = env * 0.9;
    }
  }

  // ----- Gallery smoke: drift + slow fade-in to target opacity -----
  if (scene.userData.innerSmoke) {
    const k = 1 - Math.exp(-0.6 * dt);
    for (const s of scene.userData.innerSmoke) {
      s.position.x += s.userData.driftX * dt;
      s.position.y += s.userData.driftY * dt;
      s.material.rotation += s.userData.rotRate * dt;
      // Wrap back to the floor when the sprite's TOP edge passes the ceiling
      if (s.position.y > s.userData.maxY) {
        s.position.y = s.userData.minY;
        const [sx, sz] = scene.userData.pickSmokeXZ(s.userData.scale);
        s.position.x = sx;
        s.position.z = sz;
      }
      const dop = s.userData.targetOpacity - s.material.opacity;
      if (dop < -0.001 || dop > 0.001) s.material.opacity += dop * k;
    }
  }

  // ----- Smoke clouds: drift + swirl + fade. Runs every frame, even during intro -----
  if (scene.userData.smoke) {
    const k = 1 - Math.exp(-2.2 * dt);
    for (const s of scene.userData.smoke) {
      s.position.x += s.userData.driftX * dt;
      s.position.y += s.userData.driftY * dt;
      if (s.position.y > 8) s.position.y = -1;
      s.material.rotation += s.userData.rotRate * dt;
      const ahead = s.position.z < camera.position.z - 1.5;
      const target = ahead ? s.userData.targetOpacity : 0;
      const delta = target - s.material.opacity;
      if (delta < -0.001 || delta > 0.001) s.material.opacity += delta * k;
    }
  }

  // ----- star twinkle -----
  if (scene.userData.stars) {
    const S = scene.userData.stars;
    const arr = S.points.geometry.attributes.color.array;
    const base = S.base;
    const tt = now * 0.001;
    // Update a random subset each frame — 30 stars / 2200 total = light cost
    for (let i = 0; i < 30; i++) {
      const idx = (Math.random() * S.count) | 0;
      const phase = idx * 0.137;
      const k = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(tt * 0.9 + phase));
      const o = idx * 3;
      arr[o]     = base[o]     * k;
      arr[o + 1] = base[o + 1] * k;
      arr[o + 2] = base[o + 2] * k;
    }
    S.points.geometry.attributes.color.needsUpdate = true;
  }

  // ----- slow dust drift -----
  if (scene.userData.dust) {
    const dust = scene.userData.dust;
    dust.rotation.y += dt * 0.012;
    const arr = dust.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * 0.08;
      if (arr[i + 1] > ROOM.height) arr[i + 1] = 0.4;
    }
    dust.geometry.attributes.position.needsUpdate = true;
  }

  // ----- pillar sparkle: drift up + reset into halo when above ceiling -----
  if (scene.userData.spark) {
    const spark = scene.userData.spark;
    const arr = spark.geometry.attributes.position.array;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i + 1] += dt * 0.12;
      if (arr[i + 1] > ROOM.height) {
        const r = Math.sqrt(Math.random()) * 1.2;
        const a = Math.random() * Math.PI * 2;
        arr[i]     = r * Math.cos(a);
        arr[i + 1] = 0.2;
        arr[i + 2] = r * Math.sin(a);
      }
    }
    spark.geometry.attributes.position.needsUpdate = true;
  }

  // ----- Intro fly-through: take over everything until landed -----
  if (intro.active) {
    const t = Math.min(1, (now - intro.t0) / intro.duration);
    // easeOutQuart — max velocity at t=0, decelerating more gradually than
    // easeOutCubic. The camera coasts longer, the deceleration is more felt.
    const e = 1 - Math.pow(1 - t, 4);

    // Horizontal: eased lerp on x + z
    camera.position.x = intro.fromPos.x + (intro.toPos.x - intro.fromPos.x) * e;
    camera.position.z = intro.fromPos.z + (intro.toPos.z - intro.fromPos.z) * e;

    // Vertical: HOLD the high start altitude until the camera is inside the
    // rotunda (z < ROOM.radius + 4), then descend over the last few metres.
    // This keeps the camera safely above the painting ring (tops at y ≈ 2.45 m)
    // when crossing the south poster band.
    const Y_HOLD_Z = ROOM.radius + 4;
    let yProg = 0;
    if (camera.position.z < Y_HOLD_Z) {
      yProg = (Y_HOLD_Z - camera.position.z) / (Y_HOLD_Z - intro.toPos.z);
      if (yProg < 0) yProg = 0; else if (yProg > 1) yProg = 1;
      yProg = yProg < 0.5 ? 4 * yProg * yProg * yProg : 1 - Math.pow(-2 * yProg + 2, 3) / 2;
    }
    camera.position.y = intro.fromPos.y + (intro.toPos.y - intro.fromPos.y) * yProg;

    cam.yaw   = intro.fromYaw   + (intro.toYaw   - intro.fromYaw)   * e;
    cam.pitch = intro.fromPitch + (intro.toPitch - intro.fromPitch) * e;
    cam.targetYaw   = cam.yaw;
    cam.targetPitch = cam.pitch;

    if (t >= 1) {
      intro.active = false;
      // Hand off control: show prompt. Auto-hide it after 7s. Nav arrows
      // are tied to the info card — they only appear when focused on a poster.
      promptEl.classList.add('show');
      setTimeout(() => promptEl.classList.add('hide'), 7000);
    }

    applyCameraRotation();
    grainPass.uniforms.time.value = now * 0.001;
    composer.render();
    requestAnimationFrame(tick);
    return;
  }

  // Exponential smoother on yaw/pitch toward targets (skipped during glide
  // because glide already drives cam.yaw / cam.pitch directly).
  if (!glide.active) {
    const k = 1 - Math.exp(-LOOK_DAMP * dt);
    cam.yaw   += (cam.targetYaw   - cam.yaw)   * k;
    cam.pitch += (cam.targetPitch - cam.pitch) * k;
  }

  updateGlide();
  ripple.update();

  // ----- wheel-dolly drain: ease accumulated wheel input into camera motion -----
  if (Math.abs(dollyTarget.dist) > 0.0005 && !glide.active) {
    const dk = 1 - Math.exp(-9 * dt);   // smoother for dolly
    const step = dollyTarget.dist * dk;
    dollyTarget.dist -= step;
    camera.getWorldDirection(_tmpFwd);
    _tmpFwd.y = 0; _tmpFwd.normalize();
    let nx = camera.position.x + _tmpFwd.x * step;
    let nz = camera.position.z + _tmpFwd.z * step;
    const c = clampWalkable(nx, nz);
    camera.position.x = c.x;
    camera.position.z = c.z;
  }

  // ----- keyboard movement (WASD / arrows) -----
  if (!glide.active && (moveKeys.f || moveKeys.b || moveKeys.l || moveKeys.r)) {
    const SPEED = 4.2;   // m/s
    let mx = (moveKeys.r ? 1 : 0) - (moveKeys.l ? 1 : 0);
    let mz = (moveKeys.f ? 1 : 0) - (moveKeys.b ? 1 : 0);
    const len = Math.hypot(mx, mz);
    if (len > 0) { mx /= len; mz /= len; }
    camera.getWorldDirection(_tmpFwd);
    _tmpFwd.y = 0; _tmpFwd.normalize();
    // right = forward × up  →  for forward (fx,0,fz):  right = (-fz, 0, fx)
    const rx = -_tmpFwd.z;
    const rz =  _tmpFwd.x;
    const dx = (_tmpFwd.x * mz + rx * mx) * SPEED * dt;
    const dz = (_tmpFwd.z * mz + rz * mx) * SPEED * dt;
    const c = clampWalkable(camera.position.x + dx, camera.position.z + dz);
    camera.position.x = c.x;
    camera.position.z = c.z;
  }

  // Idle camera bob — barely-there breathing motion when the user is still.
  // Ramped in via a 3 s smoothstep after any controlling animation ends so
  // there's no perceptible "jump" the moment the intro fly-through or a glide
  // hands off control.
  if (intro.active || glide.active || moveKeys.f || moveKeys.b
      || moveKeys.l || moveKeys.r
      || Math.abs(dollyTarget.dist) >= 0.001
      || pointers.size > 0) {
    bobControlledLast = now;
  }
  if (!intro.active && !glide.active) {
    // Drive the sine off elapsed-since-handoff so the bob always starts at
    // phase 0 (sin = 0). Combined with the smoothstep amplitude ramp this
    // gives a true zero-value, zero-velocity start.
    // Long deadband + slow ramp + tiny amplitude — the breathing is meant to
    // be almost subliminal so arrivals at posters / the plaque feel settled.
    const tHandoff = Math.max(0, (now - bobControlledLast) * 0.001 - 1.5);  // 1.5 s deadband
    const raw = Math.min(1, tHandoff / 6);                                  // 6 s ramp
    const bobRamp = raw * raw * (3 - 2 * raw);                              // smoothstep
    const bob = (Math.sin(tHandoff * 1.05) * 0.005 + Math.sin(tHandoff * 0.43) * 0.003) * bobRamp;
    camera.position.y = EYE_Y + bob;
  } else {
    camera.position.y = EYE_Y;
  }

  // Step-away / look-away dismiss: fade the info card + nav arrows out once
  // the camera has visibly moved on from the focused poster — either past the
  // viewing distance, or turned far enough away that the poster is offscreen.
  if (cardArt && !glide.active && !glide.pending && !intro.active) {
    const cg = cardArt.userData.group;
    const cdx = cg.position.x - camera.position.x;
    const cdz = cg.position.z - camera.position.z;
    const distSq = cdx * cdx + cdz * cdz;
    if (distSq > 3.2 * 3.2) {
      hideCard();
    } else if (distSq > 0.04) {
      camera.getWorldDirection(_tmpFwd);
      const flat = Math.hypot(_tmpFwd.x, _tmpFwd.z) || 1;
      const fx = _tmpFwd.x / flat, fz = _tmpFwd.z / flat;
      const len = Math.sqrt(distSq);
      const dot = (cdx * fx + cdz * fz) / len;
      // cos(22°) ≈ 0.93 — even small head-turns dismiss the card
      if (dot < 0.93) hideCard();
    }
  }

  applyCameraRotation();

  grainPass.uniforms.time.value = now * 0.001;
  composer.render();
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

// =============================================================================
//  Resize
// =============================================================================
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});
