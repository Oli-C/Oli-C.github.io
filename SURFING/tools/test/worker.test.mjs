/* The worker bundle (tools/surf-worker.js, so build it first), against an
   in-memory KV and a faked network: accounts, sessions, favourites, the
   admin key, rate limits, the Copernicus and skill uploads, and an hourly
   forecast build end to end.
     node SURFING/tools/build-worker.mjs && node --test SURFING/tools/test/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeFetch } from './fake-net.mjs';
import { loadWorker } from './worker-env.mjs';

globalThis.fetch = fakeFetch;
const dev = { id: 'abcdef0123456789abcd', kind: 'phone', os: 'iOS', browser: 'Safari' };
const ago = (h) => new Date(Date.now() - h * 3.6e6);

test('accounts: sign up, in, recover, change, ban, lock', async () => {
  const { call, kv } = await loadWorker();
  assert.equal((await call('POST', '/a/signup', { name: 'Oli', password: 'short', dt: 5000, dev })).status, 400);
  assert.equal((await call('POST', '/a/signup', { name: 'Oli', password: 'longenough1', dt: 500, dev })).body.error, 'too quick');
  assert.equal((await call('POST', '/a/signup', { name: 'Oli', password: 'longenough1', dt: 5000, hp: 'x', dev })).status, 400, 'honeypot');
  assert.equal((await call('POST', '/a/signup', { name: '<script>', password: 'longenough1', dt: 5000, dev })).status, 400);
  const up = await call('POST', '/a/signup', { name: 'Oli', password: 'longenough1', dt: 5000, dev });
  assert.equal(up.status, 200);
  assert.match(up.body.recovery, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.equal((await call('POST', '/a/signup', { name: 'oli ', password: 'longenough1', dt: 5000, dev }, { ip: '10.0.0.2' })).status, 409, 'names are unique, any case');
  assert.equal((await call('GET', '/a/me', null, { token: up.body.token })).body.name, 'Oli');
  assert.equal((await call('POST', '/a/login', { name: 'OLI', password: 'wrongpass1', dev })).status, 401);
  const inn = await call('POST', '/a/login', { name: 'oli', password: 'longenough1', dev });
  assert.equal(inn.status, 200);
  const rec = await call('POST', '/a/recover', { name: 'Oli', code: up.body.recovery.toLowerCase().replace(/-/g, ' '), password: 'newpassword2', dev });
  assert.equal(rec.status, 200);
  assert.notEqual(rec.body.recovery, up.body.recovery, 'a fresh code');
  assert.equal((await call('GET', '/a/me', null, { token: inn.body.token })).status, 401, 'reset signs out everywhere');
  assert.equal((await call('POST', '/a/recover', { name: 'Oli', code: up.body.recovery, password: 'x'.repeat(9), dev }, { ip: '10.0.0.3' })).status, 401, 'a used code is spent');
  const pw = await call('POST', '/a/password', { old: 'newpassword2', password: 'changed555', dev }, { token: rec.body.token });
  assert.equal(pw.status, 200);
  assert.equal((await call('GET', '/a/admin/reset?name=Oli', null, { key: 'nope' })).status, 403);
  const ad = await call('GET', '/a/admin/reset?name=oli', null, { key: 'test-key' });
  assert.ok(ad.body.recovery, 'admin reset hands back a code');
  assert.equal((await call('GET', '/a/admin/ban?key=test-key&name=Oli')).body.banned, true, 'a ?key= link still works by hand');
  assert.equal((await call('POST', '/a/login', { name: 'Oli', password: 'changed555', dev }, { ip: '10.0.0.4' })).status, 403);
  await call('GET', '/a/admin/ban?name=Oli&on=0', null, { key: 'test-key' });
  for (let i = 0; i < 10; i++) await call('POST', '/a/login', { name: 'Oli', password: `bad${i}xxxxxx`, dev }, { ip: `10.1.0.${i}` });
  assert.match((await call('POST', '/a/login', { name: 'Oli', password: 'changed555', dev }, { ip: '10.1.1.1' })).body.error, /wait an hour/);
  assert.ok(![...kv.values()].some((v) => /longenough1|newpassword2|changed555/.test(v)), 'no plain passwords stored');
});

test('sessions need an account, and are checked', async () => {
  const { call, kv } = await loadWorker();
  const { body: { token } } = await call('POST', '/a/signup', { name: 'Surfer', password: 'longenough1', dt: 5000, dev });
  const at = ago(3), local = at.toISOString().slice(0, 13) + ':00';
  const s = { id: 'nazare-norte', local, start: at.toISOString(), mins: 60, rating: 3, size: 2, surface: 1, hours: [{ t: local, k: { h: 1.5, p: 11, d: 290, ws: 10, wd: 90 } }], dt: 9000, dev, name: 'Spoofed' };
  assert.equal((await call('POST', '/s', s)).status, 401);
  assert.equal((await call('POST', '/s', s, { token })).status, 200);
  assert.equal((await call('POST', '/s', s, { token })).status, 409, 'the same session twice');
  assert.equal((await call('POST', '/s', { ...s, local: new Date(Date.now() + 864e5).toISOString().slice(0, 16) }, { token })).status, 400, 'not in the future');
  assert.equal((await call('POST', '/s', { ...s, hours: [{ t: local, k: { h: 99, ws: 10 } }] }, { token })).status, 400, 'physical ranges');
  assert.equal((await call('POST', '/s', s, { token, origin: 'https://evil.example' })).status, 403, 'browsers on other sites');
  const stored = JSON.parse([...kv.entries()].find(([k]) => k.startsWith('s:'))[1]);
  assert.equal(stored.name, 'Surfer', 'the account name, not one in the body');
  assert.equal((await call('POST', '/v', { id: 'x' })).status, 410, 'verdicts retired');
  assert.equal((await call('GET', '/stats')).status, 403, 'stats are private');
  const people = await call('GET', '/people', null, { key: 'test-key' });
  assert.ok(people.body.people.some((p) => p.name === 'Surfer' && p.sessions === 1));
  const exp = await call('GET', '/export', null, { key: 'test-key' });
  assert.equal(exp.body.sessions.length, 1);
});

test('favourites follow the account', async () => {
  const { call } = await loadWorker();
  const { body: { token } } = await call('POST', '/a/signup', { name: 'Fan', password: 'longenough1', dt: 5000, dev });
  assert.deepEqual((await call('GET', '/a/favs', null, { token })).body.favs, []);
  const r = await call('POST', '/a/favs', { favs: ['guincho-norte', 'not-a-spot', 'carcavelos', 'guincho-norte', 42] }, { token });
  assert.deepEqual([...r.body.favs], ['guincho-norte', 'carcavelos'], 'known spots, once each, in order');
  assert.equal((await call('POST', '/a/favs', { favs: new Array(41).fill('carcavelos') }, { token })).status, 400);
  assert.equal((await call('GET', '/a/favs')).status, 401);
});

test('rate limits per IP', async () => {
  const { call } = await loadWorker();
  const auth = [];
  for (let i = 0; i < 12; i++) auth.push((await call('POST', '/a/login', { name: 'x', password: 'y', dev }, { ip: '10.9.0.1' })).status);
  assert.deepEqual(auth.slice(9), [401, 429, 429], 'sign-in: 10 a minute');
  const reads = [];
  for (let i = 0; i < 125; i++) reads.push((await call('GET', '/health', null, { ip: '10.9.0.2' })).status);
  assert.equal(reads.filter((s) => s === 429).length, 5, 'reads: 120 a minute');
  const ups = [];
  for (let i = 0; i < 5; i++) ups.push((await call('POST', '/a/signup', { name: `User ${i}`, password: 'longenough1', dt: 5000, dev }, { ip: '10.9.0.3' })).status);
  assert.deepEqual(ups, [200, 200, 200, 429, 429], 'three new accounts a day per IP');
});

test('uploads: Copernicus IBI and the skill record', async () => {
  const { call, kv } = await loadWorker();
  const times = Array.from({ length: 48 }, (_, i) => new Date(Date.now() + (i - 12) * 3.6e6).toISOString().slice(0, 13) + ':00');
  const series = (x) => times.map(() => x);
  const run = { built: times[12], times, spots: { 'guincho-norte': { wave_height: series(2), swell_wave_height: series(1.9), swell_wave_period: series(11), swell_wave_direction: series(300), wave_peak_period: series(14) }, 'no-such-spot': {} }, buoys: {} };
  assert.equal((await call('POST', '/ibi', run, { key: 'nope', origin: null })).status, 403);
  assert.equal((await call('POST', '/ibi', { ...run, times: ['yesterday'] }, { key: 'test-key', origin: null })).status, 400);
  const ok = await call('POST', '/ibi', run, { key: 'test-key', origin: null });
  assert.equal(ok.body.spots, 1, 'unknown spots dropped');
  assert.ok(kv.has('ibi:latest'));
  assert.equal((await call('GET', '/skill')).status, 404);
  assert.equal((await call('POST', '/skill', { updated: 'x', wind: {}, wave: {} }, { origin: null })).status, 403);
  assert.equal((await call('POST', '/skill', { updated: '2026-10-28T00:00:00Z', wind: {}, wave: {} }, { key: 'test-key', origin: null })).status, 200);
  assert.equal((await call('GET', '/skill')).body.updated, '2026-10-28T00:00:00Z');
});

test('forecast: the hourly build, end to end', async () => {
  const { call, kv } = await loadWorker();
  const times = Array.from({ length: 96 }, (_, i) => new Date(Date.now() + (i - 24) * 3.6e6).toISOString().slice(0, 13) + ':00');
  const s = (x) => times.map(() => x);
  await call('POST', '/ibi', { built: times[24], times, spots: { 'guincho-norte': { wave_height: s(2), swell_wave_height: s(1.9), swell_wave_period: s(11), swell_wave_direction: s(300), wave_peak_period: s(14) } }, buoys: {} }, { key: 'test-key', origin: null });
  const r = await call('GET', '/forecast/refresh', null, { key: 'test-key', origin: null });
  assert.equal(r.status, 200);
  const fc = (await call('GET', '/forecast')).body;
  assert.equal(Object.keys(fc.spots).length, (await import('../site.mjs')).loadSite().CAMS.length, 'every spot');
  assert.ok(fc.ibi, 'built with the IBI run');
  for (const [id, x] of Object.entries(fc.spots)) {
    assert.equal(x.days.length, 2 + 16, `${id}: two days back, today and fifteen ahead`);
    assert.ok(x.days.every((d, i) => i === 0 || d.date > x.days[i - 1].date), `${id}: days in order, none twice`);
    for (const d of x.days) for (const k of d.hours) for (const f of ['h', 'p', 'd', 'ws', 'wd', 'tn']) assert.ok(k[f] != null, `${id} ${k.t} ${f}`);
  }
  const src = Object.values(fc.spots['guincho-norte'].src)[0].src;
  assert.ok(src.swell.some((r) => r.name === 'Copernicus IBI'), 'IBI among the sources');
  assert.ok(kv.has(`fc:day:${new Date().toISOString().slice(0, 10)}`), 'today archived');
  assert.ok(kv.has('fc:ext'), 'the far days kept for the next builds');
  const far = fc.spots['guincho-norte'].days.at(-1), near = fc.spots['guincho-norte'].days[3];
  assert.ok(far.conf < near.conf, 'the far days are less sure');
});
