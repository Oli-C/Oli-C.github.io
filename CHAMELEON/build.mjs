// Build script for the CHAMELEON gallery.
//
// Usage (from anywhere with node):
//   cd /path/to/Oli-C.github.io/CHAMELEON
//   npm install --no-save esbuild       # one-time, if not already present
//   node build.mjs
//
// Output: ./app.bundle.min.js (referenced from index.html). Re-run after
// editing app.js, the vendor/three tree, or anything they import.

import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

// Auto-incrementing version stamped onto the plaque back. Tied to git
// commit count so it bumps with each commit — no manual maintenance.
const commitCount = (() => {
  try { return execSync('git rev-list --count HEAD', { cwd: root }).toString().trim(); }
  catch { return '0'; }
})();
const SITE_VERSION = `v0.${commitCount}`;
console.log(`stamping ${SITE_VERSION}`);

await build({
  entryPoints: [join(root, 'app.js')],
  outfile:     join(root, 'app.bundle.min.js'),
  bundle:      true,
  minify:      true,
  format:      'esm',
  target:      'es2020',
  legalComments: 'none',
  define: {
    __SITE_VERSION__: JSON.stringify(SITE_VERSION),
  },
  plugins: [{
    name: 'three-resolver',
    setup(b) {
      // Resolve the bare specifiers that match our importmap.
      b.onResolve({ filter: /^three$/ }, () => ({
        path: join(root, 'vendor/three/build/three.module.js'),
      }));
      b.onResolve({ filter: /^three\/addons\// }, args => ({
        path: args.path.replace(
          /^three\/addons\//,
          join(root, 'vendor/three/examples/jsm/') + '/'
        ).replace(/\/+/g, '/'),
      }));
    },
  }],
});

console.log('built ./app.bundle.min.js');

// Small copies of the posters (posters/sm/, 512 px tall) for the ring: the
// gallery shows these everywhere and fetches a full-size poster only for the
// one being looked at (see makePoster / sharpen in app.js). Made here for any
// poster that has none, or whose copy is older than it. Needs cwebp
// (brew install webp); without it the gallery falls back to the full files.
import { readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
const posters = join(root, 'posters'), small = join(posters, 'sm');
mkdirSync(small, { recursive: true });
let made = 0;
for (const f of readdirSync(posters).filter((n) => n.endsWith('.webp'))) {
  const src = join(posters, f), out = join(small, f);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) continue;
  try { execSync(`cwebp -quiet -q 84 -resize 0 512 ${JSON.stringify(src)} -o ${JSON.stringify(out)}`); made++; }
  catch { console.warn(`no small copy for ${f} (is cwebp installed?)`); }
}
console.log(`small posters: ${made} made`);
