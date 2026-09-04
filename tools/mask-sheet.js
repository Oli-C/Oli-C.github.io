// Generates assets/mask-art-sheet.webp: the sprite sheet of unique ink-bleed
// masks behind .mix-art (see style.css). Run from the repo root:
//   node tools/mask-sheet.js
// Needs rsvg-convert (librsvg) and cwebp (webp) — both on Homebrew.
//
// Tile = the original SVG recipe (horizontal alpha gradient displaced by
// fractalNoise), each with its own feTurbulence seed. Rendered with a margin
// and cropped so the displacement never drags canvas-edge transparency in,
// supersampled 2x to smooth the displacement aliasing, alpha quantised to
// 64 levels (invisible under a photo, halves the bytes), and laid out with
// gutters filled by edge-clamped copies of the neighbouring tile so bilinear
// sampling at a tile edge never bleeds a neighbour's opposite edge in.
// Env overrides: T (tile px) G (gutter px) COLS ROWS SS (supersample) Q (quant
// step) OUT. Changing T, G or COLS means updating mask-size / --mask-pos too.
const fs = require('fs'), os = require('os'), path = require('path'), zlib = require('zlib'), { execFileSync } = require('child_process');
const env = (k, d) => process.env[k] !== undefined ? +process.env[k] : d;
const T = env('T', 96), G = env('G', 8), COLS = env('COLS', 6), ROWS = env('ROWS', 6), SS = env('SS', 2), Q = env('Q', 4);
const OUT = process.env.OUT || 'assets/mask-art-sheet.webp';
const N = COLS * ROWS;
const seeds = [3, 11]; for (let s = 17; seeds.length < N; s += 7) seeds.push(s);   // 3 and 11 were the original two edges
const scale = i => [28, 26, 30, 28, 27, 29][i % 6];
const M = Math.ceil(0.22 * T), R = SS * (T + 2 * M), u = 100 / T;                  // margin px, render px, units per output px
const vb = `${-M * u} ${-M * u} ${(T + 2 * M) * u} ${(T + 2 * M) * u}`;
const svg = (seed, sc) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='${vb}' width='${R}' height='${R}' preserveAspectRatio='none'><defs><linearGradient id='g' gradientUnits='userSpaceOnUse' x1='0' x2='100'><stop offset='0.42' stop-color='#000'/><stop offset='1' stop-color='#000' stop-opacity='0'/></linearGradient><filter id='f' filterUnits='userSpaceOnUse' x='-60' y='-60' width='220' height='220'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.05' numOctaves='3' seed='${seed}'/><feDisplacementMap in='SourceGraphic' scale='${sc}' xChannelSelector='R' yChannelSelector='G'/></filter></defs><rect x='-60' y='-60' width='220' height='220' fill='url(#g)' filter='url(#f)'/></svg>`;

// Minimal PNG decoder (8-bit, non-interlaced) returning the alpha plane.
function dec(b) { let o = 8, idat = [], w, h, ct;
  while (o < b.length) { const len = b.readUInt32BE(o), t = b.toString('ascii', o + 4, o + 8), d = b.slice(o + 8, o + 8 + len);
    if (t === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9]; } else if (t === 'IDAT') idat.push(d); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat)); const bpp = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct]; const st = w * bpp; const out = Buffer.alloc(h * st);
  for (let y = 0; y < h; y++) { const f = raw[y * (st + 1)]; const src = raw.slice(y * (st + 1) + 1, (y + 1) * (st + 1)); const prev = y ? out.slice((y - 1) * st, y * st) : Buffer.alloc(st);
    for (let x = 0; x < st; x++) { const a = x >= bpp ? out[y * st + x - bpp] : 0, b2 = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b2; else if (f === 3) v += (a + b2) >> 1; else if (f === 4) { const p = a + b2 - c, pa = Math.abs(p - a), pb = Math.abs(p - b2), pc = Math.abs(p - c); v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b2 : c); }
      out[y * st + x] = v & 255; } }
  const alpha = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) alpha[i] = ct === 4 ? out[i * 2 + 1] : ct === 6 ? out[i * 4 + 3] : out[i * bpp];
  return { w, h, alpha }; }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mask-sheet-'));
const tiles = [];
for (let i = 0; i < N; i++) {
  fs.writeFileSync(`${tmp}/tile.svg`, svg(seeds[i], scale(i)));
  execFileSync('rsvg-convert', ['-w', String(R), '-h', String(R), `${tmp}/tile.svg`, '-o', `${tmp}/tile.png`]);
  const { w, alpha } = dec(fs.readFileSync(`${tmp}/tile.png`));
  const t = new Uint8Array(T * T);                                                   // box-downsample by SS, crop margin, quantise
  for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) { let s = 0;
    for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) s += alpha[((M + y) * SS + dy) * w + (M + x) * SS + dx];
    t[y * T + x] = Math.min(255, Math.round(s / (SS * SS) / Q) * Q); }
  tiles.push(t);
}
fs.rmSync(tmp, { recursive: true, force: true });

// Sheet coordinate -> (tile index, local px); gutter halves clamp to the nearer tile's edge row/column.
const W = COLS * T + (COLS - 1) * G, H = ROWS * T + (ROWS - 1) * G;
function map(X, n) { let c = Math.floor(X / (T + G)); let l = X - c * (T + G);
  if (l >= T) { if (l - T < G / 2) l = T - 1; else { c = Math.min(c + 1, n - 1); l = 0; } } return [c, l]; }
const px = Buffer.alloc(W * H * 2);                                                  // grey+alpha, grey = 0
for (let Y = 0; Y < H; Y++) { const [r, y] = map(Y, ROWS);
  for (let X = 0; X < W; X++) { const [c, x] = map(X, COLS); px[(Y * W + X) * 2 + 1] = tiles[r * COLS + c][y * T + x]; } }

// PNG encode: colour type 4 (grey+alpha), adaptive per-scanline filter, zlib 9.
const bpp = 2, st = W * bpp, lines = [];
for (let y = 0; y < H; y++) { const cur = px.slice(y * st, (y + 1) * st), prev = y ? px.slice((y - 1) * st, y * st) : Buffer.alloc(st);
  let best = null, bestSum = Infinity;
  for (let f = 0; f < 5; f++) { const o = Buffer.alloc(st + 1); o[0] = f; let sum = 0;
    for (let x = 0; x < st; x++) { const a = x >= bpp ? cur[x - bpp] : 0, b = prev[x], c = x >= bpp ? prev[x - bpp] : 0; let v = cur[x];
      if (f === 1) v -= a; else if (f === 2) v -= b; else if (f === 3) v -= (a + b) >> 1; else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v -= (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      v &= 255; o[x + 1] = v; sum += v < 128 ? v : 256 - v; }
    if (sum < bestSum) { bestSum = sum; best = o; } }
  lines.push(best); }
const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t, 'ascii'), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 4;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(Buffer.concat(lines), { level: 9, memLevel: 9 })), chunk('IEND', Buffer.alloc(0))]);

const pngPath = OUT.replace(/\.webp$/, '') + '.png';
fs.writeFileSync(pngPath, png);
if (OUT.endsWith('.webp')) { execFileSync('cwebp', ['-quiet', '-lossless', '-z', '9', '-exact', pngPath, '-o', OUT]); fs.unlinkSync(pngPath); }
console.log(`${OUT}: ${W}x${H}, ${COLS}x${ROWS} tiles of ${T}px, gutter ${G}, ss ${SS}, q ${Q}: ${fs.statSync(OUT).size} bytes; mask-size ${(W / T * 100).toFixed(4)}% ${(H / T * 100).toFixed(4)}%`);
