/* Version stamps for the surf pages' own scripts and stylesheets: every
   reference to a local .js or .css file (in SURFING/*.html, and quoted file
   names inside SURFING/*.js, like the map's coast.js) gets ?v=<first 8 of
   the file's SHA-1>. A file that changes gets a new URL, so a browser never
   mixes an old cached file with new ones; unchanged files stay cached.

     node SURFING/tools/stamp.mjs            stamp in place (prints what moved)
     node SURFING/tools/stamp.mjs --check    exit 1 if anything is unstamped or stale

   Scripts first, then pages, since a script's own stamp depends on the
   stamps inside it. surf-stamp.yml runs it on every push. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const ROOT = path.resolve(DIR, '..');
const check = process.argv.includes('--check');
// Line endings don't count, so a Windows checkout (CRLF) stamps the same as CI's (LF).
const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')).digest('hex').slice(0, 8);

// A local file named in a page or script: "x.js", "x.css" (next to the
// page) or "/tally.js" (from the site root). Anything with a scheme or a
// // host is someone else's.
function localFile(ref) {
  if (/^[a-z]+:|^\/\//i.test(ref)) return null;
  const f = ref.startsWith('/') ? path.join(ROOT, ref) : path.join(DIR, ref);
  return fs.existsSync(f) ? f : null;
}

let moved = 0;
function stamp(file, re) {
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(re, (all, pre, ref, _v, post) => {
    const f = localFile(ref);
    return f ? `${pre}${ref}?v=${hash(f)}${post}` : all;
  });
  if (after !== before) {
    moved++;
    console.log((check ? 'stale: ' : 'stamped: ') + path.relative(ROOT, file));
    if (!check) fs.writeFileSync(file, after);
  }
}

const files = fs.readdirSync(DIR);
// Quoted local script names inside scripts ('coast.js'); twice, in case a
// stamped script is itself named in another.
for (let pass = 0; pass < 2; pass++) {
  for (const f of files.filter((x) => x.endsWith('.js'))) stamp(path.join(DIR, f), /(['"])([\w./-]+\.js)(\?v=\w*)?(['"])/g);
}
// src= and href= in pages.
for (const f of files.filter((x) => x.endsWith('.html'))) stamp(path.join(DIR, f), /((?:src|href)=")([\w./-]+\.(?:js|css))(\?v=\w*)?(")/g);

if (check && moved) { console.error(`${moved} file(s) need stamping: node SURFING/tools/stamp.mjs`); process.exit(1); }
if (!moved) console.log('stamps current');
