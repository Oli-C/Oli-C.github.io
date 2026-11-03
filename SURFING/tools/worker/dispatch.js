/* ---------- Starting GitHub Actions jobs on time ----------
   GitHub's own schedules are best-effort and often skipped; this worker's
   hourly cron never misses, so it starts the jobs that must run on time
   (workflow_dispatch through GitHub's API):

     surf-banks.yml  the cams' bank readings, every hour 07–18 UTC
     surf-skill.yml  the models' record, every 3 hours
     surf-ibi.yml    Copernicus IBI, every 6 hours (01, 07, 13, 19 UTC)
     surf-sat.yml    the satellite bank readings, daily at 19 UTC
     surf-watch.yml  the freshness check, every 3 hours

   Those have no GitHub schedule of their own, except surf-watch: it keeps
   one as a backstop, so if these starts ever stop it notices the stale
   readings and opens an issue.

   Needs the secret GH_DISPATCH_TOKEN: a fine-grained GitHub token for
   Oli-C/Oli-C.github.io with Actions: read and write, nothing else. Without
   it nothing is started (and only surf-watch's backstop schedule runs). The last
   round is kept in KV (dispatch:last) and shown on /health.

   One-off jobs spread over days (a backfill in chunks, say, to stay inside
   D1's daily writes) go in a queue in KV, dispatch:queue, a JSON list of
   { file, inputs }: at 01 UTC the first is started with its inputs, and
   taken off the list once GitHub has it (204). /health shows what's left. */
const GH_REPO = 'Oli-C/Oli-C.github.io';
const DISPATCH = [
  { file: 'surf-banks.yml', when: (h) => h >= 7 && h <= 18 },
  { file: 'surf-skill.yml', when: (h) => h % 3 === 0 },
  { file: 'surf-ibi.yml', when: (h) => h % 6 === 1 },
  { file: 'surf-sat.yml', when: (h) => h === 19 },
  { file: 'surf-watch.yml', when: (h) => h % 3 === 1 },
];

const QUEUE_HOUR = 1;
async function startJob(token, file, inputs) {
  try {
    const r = await fetch(`https://api.github.com/repos/${GH_REPO}/actions/workflows/${file}/dispatches`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'allfield-surf-worker' },
      body: JSON.stringify(inputs ? { ref: 'master', inputs } : { ref: 'master' }),
    });
    return r.status;   // 204: started
  } catch (e) { return 'error: ' + e.message; }
}

async function dispatchJobs(env, now = new Date()) {
  const token = await readSecret(env.GH_DISPATCH_TOKEN);
  if (!token) return null;
  const h = now.getUTCHours(), out = {};
  for (const d of DISPATCH) if (d.when(h)) out[d.file] = await startJob(token, d.file);
  if (h === QUEUE_HOUR) {
    let q = [];
    try { q = JSON.parse((await env.FEEDBACK.get('dispatch:queue')) || '[]'); } catch {}
    if (Array.isArray(q) && q.length) {
      const job = q[0], st = await startJob(token, job.file, job.inputs);
      out['queued ' + job.file + ' ' + JSON.stringify(job.inputs || {})] = st;
      if (st === 204) await env.FEEDBACK.put('dispatch:queue', JSON.stringify(q.slice(1)));
    }
  }
  await env.FEEDBACK.put('dispatch:last', JSON.stringify({ t: now.toISOString().slice(0, 16), out }));
  return out;
}
