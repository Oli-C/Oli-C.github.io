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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(root, 'app.js')],
  outfile:     join(root, 'app.bundle.min.js'),
  bundle:      true,
  minify:      true,
  format:      'esm',
  target:      'es2020',
  legalComments: 'none',
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
