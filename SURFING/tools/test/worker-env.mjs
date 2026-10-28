/* The worker bundle (tools/surf-worker.js) with an in-memory KV, for tests:
   const { worker, env, kv, call } = await loadWorker();  */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export async function loadWorker() {
  // The bundle is an ES module in a .js file; Node wants .mjs for that.
  const src = fs.readFileSync(new URL('../surf-worker.js', import.meta.url), 'utf8');
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'surf-worker-')), 'w.mjs');
  fs.writeFileSync(file, src);
  const { default: worker } = await import(pathToFileURL(file).href);
  const kv = new Map();
  const env = {
    EXPORT_KEY: 'test-key',
    FEEDBACK: {
      get: async (k) => (kv.has(k) ? kv.get(k) : null),
      put: async (k, v) => { kv.set(k, String(v)); },
      delete: async (k) => { kv.delete(k); },
      list: async ({ prefix }) => ({ keys: [...kv.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name })), list_complete: true }),
    },
  };
  // One request: method, path, JSON body, and who's asking.
  async function call(method, p, body, { token, ip = '10.0.0.1', origin = 'https://allfield.online', key } = {}) {
    const headers = { 'CF-Connecting-IP': ip };
    if (origin) headers.Origin = origin;
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    if (key) headers['X-Surf-Key'] = key;
    const r = await worker.fetch(new Request('https://worker.test' + p, { method, headers, body: body ? JSON.stringify(body) : undefined }), env);
    return { status: r.status, body: await r.json().catch(() => null) };
  }
  return { worker, env, kv, call };
}
