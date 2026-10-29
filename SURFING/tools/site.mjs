/* The site's own plain scripts (spots.js, stations.js, score.js, …) for the
   Node tools and tests, loaded as the browser loads them: one after another
   into one shared global scope, so the tools score exactly as the pages do.

     import { loadSite } from './site.mjs';
     const site = loadSite();                       // spots, stations, score
     const { CAMS, score, BUOYS } = site;           // any top-level name

   Each call gets a fresh scope (its own localStorage stand-in, its own
   sharedSkill), so tests can set things up without leaking. */
import fs from 'node:fs';
import vm from 'node:vm';

export const SITE_FILES = ['spots.js', 'stations.js', 'swan.js', 'score.js'];

export function loadSite(files = SITE_FILES, globals = {}) {
  const mem = new Map();
  const localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const ctx = vm.createContext({ console, fetch: globalThis.fetch, setTimeout, clearTimeout, URL, localStorage, ...globals });
  for (const f of files) vm.runInContext(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  // Top-level const / let / function names live in the scope, not on the
  // context object, so read them by evaluating the name there.
  const cache = new Map();
  return new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      if (!cache.has(name)) cache.set(name, vm.runInContext(`typeof ${name} === 'undefined' ? undefined : ${name}`, ctx));
      return cache.get(name);
    },
    set(_, name, value) {   // assign to a top-level let (e.g. sharedSkill, units)
      ctx.__v = value;
      vm.runInContext(`${name} = __v`, ctx);
      cache.delete(name);
      return true;
    },
  });
}
