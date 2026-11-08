/* SYNOP decoding (worker/synop.js) and the worker's filling of IPMA's
   missing hours from it (history.js fillSynop), against a stand-in D1 and
   network. The worker sources load as the bundle loads them: plain scripts
   in one scope, after the site's own.
     node --test SURFING/tools/test/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadSite } from '../site.mjs';

function load(globals = {}) {
  const site = loadSite();
  const ctx = vm.createContext({ console, URL, CAMS: site.CAMS, km: site.km, ...globals });
  for (const f of ['synop.js', 'history.js']) vm.runInContext(fs.readFileSync(new URL(`../worker/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  return (name) => vm.runInContext(name, ctx);
}

test('decodeSynop: wind, units, calm, variable, missing, temperature', () => {
  const decode = load()('decodeSynop');
  // Real Lisboa report: 50°, 3 m/s measured, 14.8 °C.
  assert.deepEqual({ ...decode('08535,2026,11,07,00,00,AAXX 07001 08535 05/// /0403 10148 20114 30118 40211 52007 60002 333 10162==') },
    { wmo: '08535', t: '2026-11-07T00:00', ws: 10.8, wd: 40, air: 14.8 });
  // Cabo Carvoeiro: no temperature group, 160°, 2 m/s.
  const cc = decode('08531,2026,11,05,10,00,AAXX 05101 08531 05/// /1602 29073 30155 40193 52022 60002 333 3/003==');
  assert.equal(cc.ws, 7.2); assert.equal(cc.wd, 160); assert.equal(cc.air, null);
  // Sagres: wind not reported (iw /), negative temperature.
  const sg = decode('08533,2026,11,05,10,00,AAXX 0510/ 08533 05/// ///// 11023 20076==');
  assert.equal(sg.ws, null); assert.equal(sg.wd, null); assert.equal(sg.air, -2.3);
  // Knots; calm; variable; 99+ in a 00fff group.
  assert.equal(decode('08535,2026,11,07,00,00,AAXX 07004 08535 05/// /2710 10148==').ws, 18.5);
  assert.deepEqual([decode('08535,2026,11,07,00,00,AAXX 07001 08535 05/// /0000 10148==')].map((o) => [o.ws, o.wd])[0], [0, null]);
  assert.equal(decode('08535,2026,11,07,00,00,AAXX 07001 08535 05/// /9902 10148==').wd, null);
  assert.equal(decode('08535,2026,11,07,00,00,AAXX 07004 08535 05/// /2799 00105 10148==').ws, 194.5);
  assert.equal(decode('08535,2026,11,07,00,00,AAXX 07004 08535 05/// /2799 00105 10148==').air, 14.8);
  // Not SYNOP lines.
  for (const l of ['', 'Status: 501 too many requests', '08535,2026,11,07,00,00,NIL==']) assert.equal(decode(l), null);
});

test('fillSynop: files only the synoptic stations\' missing hours, last week', async () => {
  const H = 36e5, hour = (ago) => new Date(Math.floor(Date.now() / H) * H - ago * H).toISOString().slice(0, 13) + ':00';
  const syn = (t, wmo, body) => `${wmo},${t.slice(0, 4)},${t.slice(5, 7)},${t.slice(8, 10)},${t.slice(11, 13)},00,AAXX ${t.slice(8, 10)}${t.slice(11, 13)}1 ${wmo} 05/// ${body}==`;
  const stations = [
    { geometry: { coordinates: [-9.405, 39.361] }, properties: { idEstacao: 1200531, localEstacao: 'Cabo Carvoeiro' } },   // by Peniche
    { geometry: { coordinates: [-9.149, 38.719] }, properties: { idEstacao: 1200535, localEstacao: 'Lisboa (Geofísico)' } },
    { geometry: { coordinates: [-9.300, 38.800] }, properties: { idEstacao: 1210702, localEstacao: 'not synoptic' } },
    { geometry: { coordinates: [-25.0, 37.0] }, properties: { idEstacao: 1200512, localEstacao: 'Azores, far away' } },
  ];
  const ogimet = [
    syn(hour(10), '08535', '/2203 10150'),   // missing: filed
    syn(hour(11), '08535', '/2205 10160'),   // IPMA has it: left alone
    syn(hour(10), '08531', '/0000 10140'),   // missing, calm: filed
    syn(hour(10), '08512', '/2203 10150'),   // not near a spot
    syn(hour(1), '08535', '/2203 10150'),    // too recent: IPMA may yet
    syn(hour(9 * 24), '08535', '/2203 10150'), // older than a week
    'garbage',
  ].join('\n');
  let asked = null;
  const fetch = async (url) => {
    url = String(url);
    if (url.endsWith('stations.json')) return new Response(JSON.stringify(stations));
    if (url.startsWith('https://www.ogimet.com/')) { asked = url; return new Response(ogimet); }
    throw new Error('unexpected ' + url);
  };
  const inserted = [];
  const db = {
    prepare: (sql) => ({
      sql,
      bind: () => ({ all: async () => ({ results: [{ src: 'ipma:1200535', t: hour(11) }] }) }),
    }),
    batch: async (stmts) => { inserted.push(...stmts.map((s) => s.sql)); return stmts.map(() => ({ meta: { changes: 2 } })); },
  };
  const get = load({ fetch, Response });
  const n = await get('fillSynop')(db);
  assert.equal(n, 2);
  assert.match(asked, /block=085&begin=\d{12}&end=\d{12}$/);
  const sql = inserted.join('\n');
  assert.match(sql, new RegExp(`'ipma:1200535','${hour(10)}',10\\.8,225,15\\)`), 'Lisboa, 220° snapped to SW');
  assert.match(sql, new RegExp(`'ipma:1200531','${hour(10)}',0,NULL,14\\)`), 'Cabo Carvoeiro, calm');
  assert.equal((sql.match(/'ipma:/g) || []).length, 2, 'nothing else');

  // Ogimet down: noted, not an error (the watch fails on "error").
  const down = load({ fetch: async (u) => (String(u).endsWith('stations.json') ? new Response(JSON.stringify(stations)) : new Response('busy', { status: 503 })), Response });
  assert.equal(await down('fillSynop')(db), 'unavailable: ogimet 503');
});
