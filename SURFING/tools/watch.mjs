/* Is everything still running? Checks that each moving part of the surf
   forecast has done its job recently, and fails (so GitHub emails) naming
   whatever has gone stale. surf-watch.yml runs it every 3 hours.

     node SURFING/tools/watch.mjs

   What it checks, and how old is too old:
     the worker's forecast build (hourly, worker cron)          3 h
     the Copernicus IBI run it's using (surf-ibi.yml, 6-hourly)  14 h
     the models' record (surf-skill.yml, 3-hourly)               8 h
     IPMA station readings filed (hourly, worker cron)           3 h
     the full history run (6-hourly, worker cron)                8 h
     the newest buoy and tide gauge readings filed               48 h (EMODnet runs a day behind)
     the cams' bank readings (surf-banks, hourly by day)          3 h, 09–18 UTC only
     the satellite bank readings (surf-sat, every clear pass)     21 days (cloud can hide the coast for a fortnight)
     the page counter worker answering                           -
   Exits 1 with a line per problem; prints a line per check either way. */
const SURF = 'https://surf-feedback.odj-clarke.workers.dev';
const TALLY = 'https://allfield-tally.odj-clarke.workers.dev';
const H = 36e5;

const problems = [];
const ageH = (t) => (t ? (Date.now() - Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(t) ? t : t + 'Z')) / H : Infinity);
function check(name, t, maxH) {
  const a = ageH(t);
  const line = `${name}: ${t || 'never'} (${Number.isFinite(a) ? a.toFixed(1) + ' h ago' : 'no time'}, limit ${maxH} h)`;
  if (!(a <= maxH)) problems.push(line);
  console.log((a <= maxH ? 'ok    ' : 'STALE ') + line);
}
async function get(url) {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'allfield-watch/1.0' } });
      if (r.ok) return await r.json();
      if (i === 2) throw new Error(`${url} → ${r.status}`);
    } catch (e) { if (i === 2) throw e; }
    await new Promise((res) => setTimeout(res, 5000));
  }
}

try {
  const fc = await get(`${SURF}/forecast`);
  check('forecast build', fc.built, 3);
  check('IBI run in it', fc.ibi, 14);
  check('models\' record', fc.skill, 8);
} catch (e) { problems.push(`forecast: ${e.message}`); console.log('FAIL  forecast:', e.message); }

try {
  const st = await get(`${SURF}/history/status`);
  const kind = (k) => (st.obs || []).find((o) => o.kind === k);
  check('IPMA readings', kind('ipma') && kind('ipma').last, 3);
  check('buoy readings', kind('buoy') && kind('buoy').last, 48);
  check('tide gauge readings', kind('tide') && kind('tide').last, 48);
  const full = (st.runs || []).find((r) => r.kind === 'full');
  check('full history run', full && full.t, 8);
  if (full) {
    const note = JSON.parse(full.note || '{}');
    for (const [k, v] of Object.entries(note)) if (typeof v === 'string' && v.startsWith('error')) problems.push(`full history run, ${k}: ${v}`);
  }
} catch (e) { problems.push(`history: ${e.message}`); console.log('FAIL  history:', e.message); }

// Bank readings: the newest at any reading cam / any spot.
try {
  const hour = new Date().getUTCHours();
  const cams = ['caparica-cds', 'caparica-sao-joao', 'caparica-riviera', 'fonte-da-telha'];
  const cam = (await Promise.all(cams.map((id) => get(`${SURF}/banks?id=${id}&days=2`).catch(() => null))))
    .flatMap((j) => (j && j.readings) || []).map((r) => r.t).sort().pop();
  if (hour >= 9 && hour <= 18) check('cam bank readings', cam, 3);
  else console.log(`ok    cam bank readings: ${cam || 'none'} (not checked at night)`);
  const sat = (await Promise.all(['caparica-cds', 'guincho-norte', 'ribeira-d-ilhas'].map((id) => get(`${SURF}/banks/sat?id=${id}&days=60`).catch(() => null))))
    .flatMap((j) => (j && j.readings) || []).map((r) => r.t).sort().pop();
  check('satellite bank readings', sat, 21 * 24);
} catch (e) { problems.push(`banks: ${e.message}`); console.log('FAIL  banks:', e.message); }

try {
  const t = await get(`${TALLY}/health`);
  console.log(t.ok ? 'ok    page counter answering' : 'FAIL  page counter');
  if (!t.ok) problems.push('page counter: not ok');
} catch (e) { problems.push(`page counter: ${e.message}`); console.log('FAIL  page counter:', e.message); }

if (problems.length) {
  for (const p of problems) console.log(`::error::${p}`);
  process.exit(1);
}
console.log('all current');
