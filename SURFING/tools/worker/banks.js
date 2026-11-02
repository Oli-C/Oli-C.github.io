/* ---------- How the banks are breaking (tools/banks.py) ----------
   POST /banks          admin: { t, cams: { id: reading }, img: { id: base64 JPEG } };
                        each reading is filed in the history database (banks),
                        each cam's latest marked-up view kept in KV (banks:img:<id>)
   GET  /banks?id=&days= a cam's readings, newest first (1–30 days, default 7)
   GET  /banks/img?id=   its latest marked-up view (JPEG)

   A reading: label ('flat' | 'shorebreak' | 'closing out' | 'peaky' |
   'mixed'), cover, longest, gaps, shore, views (how many of the cam's
   views it came from) and each (the views one by one).

   From space (tools/sat_banks.py, Sentinel-2, every clear pass):
   POST /banks/sat           admin: { t, scene, cams: { id: reading }, img: { id: base64 JPEG } }
   GET  /banks/sat?id=&days= a spot's readings, newest first (1–120 days, default 30)
   GET  /banks/sat/img?id=   its latest strip (JPEG)
   A reading: label ('flat' | 'inside only' | 'continuous' | 'channels' |
   'patchy'), cover, longest, gaps, bar_m (how far out the outer breaking
   is), cloud, faces (the beach's facing as found from the shoreline). */
const SAT_LABELS = ['flat', 'inside only', 'continuous', 'channels', 'patchy'];
const BANK_LABELS = ['flat', 'shorebreak', 'closing out', 'peaky', 'mixed'];
const unit = (v) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : null);

async function handleBanks(req, env, url, json) {
  if (!url.pathname.startsWith('/banks')) return null;
  if (!env.DB) return json({ error: 'no history database bound' }, 503);
  if (url.pathname.startsWith('/banks/sat')) return handleSat(req, env, url, json);
  if (req.method === 'POST' && url.pathname === '/banks') {
    if (!(await isAdmin(req, env))) return json({ error: 'no' }, 403);
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!b || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(b.t || '') || !b.cams || typeof b.cams !== 'object') return json({ error: 'bad reading' }, 400);
    const stmts = [];
    for (const [id, r] of Object.entries(b.cams)) {
      if (!byId(id) || !r || !BANK_LABELS.includes(r.label)) continue;
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO banks (spot, t, label, cover, longest, gaps, shore, views, each) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, b.t, r.label, unit(r.cover), unit(r.longest), Number.isInteger(r.gaps) ? r.gaps : null, unit(r.shore), Number.isInteger(r.views) ? r.views : null,
          JSON.stringify(Array.isArray(r.each) ? r.each.slice(0, 8) : [])));
    }
    if (stmts.length) await env.DB.batch(stmts);
    let imgs = 0;
    for (const [id, b64] of Object.entries(b.img || {})) {
      if (!byId(id) || typeof b64 !== 'string' || b64.length > 400000) continue;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      await env.FEEDBACK.put('banks:img:' + id, bytes, { metadata: { t: b.t } });
      imgs++;
    }
    return json({ ok: true, filed: stmts.length, images: imgs });
  }
  if (req.method !== 'GET') return null;
  const id = url.searchParams.get('id') || '';
  if (!byId(id)) return json({ error: 'id=<spot>' }, 400);
  if (url.pathname === '/banks/img') {
    const { value, metadata } = await env.FEEDBACK.getWithMetadata('banks:img:' + id, 'arrayBuffer');
    if (!value) return json({ error: 'no view yet' }, 404);
    return new Response(value, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=600', 'Access-Control-Allow-Origin': '*', 'X-Banks-Time': (metadata && metadata.t) || '' } });
  }
  if (url.pathname === '/banks') {
    const days = Math.min(30, Math.max(1, parseInt(url.searchParams.get('days') || '7', 10) || 7));
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 16);
    const r = await env.DB.prepare('SELECT t, label, cover, longest, gaps, shore, views FROM banks WHERE spot = ? AND t >= ? ORDER BY t DESC LIMIT 400').bind(id, since).all();
    return json({ id, days, readings: r.results }, 200, { 'Cache-Control': 'public, max-age=600' });
  }
  return null;
}

async function handleSat(req, env, url, json) {
  if (req.method === 'POST' && url.pathname === '/banks/sat') {
    if (!(await isAdmin(req, env))) return json({ error: 'no' }, 403);
    let b;
    try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400); }
    if (!b || !/^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(b.t || '') || !b.cams || typeof b.cams !== 'object') return json({ error: 'bad reading' }, 400);
    const stmts = [];
    for (const [id, r] of Object.entries(b.cams)) {
      if (!byId(id) || !r || !SAT_LABELS.includes(r.label)) continue;
      stmts.push(env.DB.prepare('INSERT OR REPLACE INTO sat_banks (spot, t, label, cover, longest, gaps, bar_m, cloud, faces, scene) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, b.t, r.label, unit(r.cover), unit(r.longest), Number.isInteger(r.gaps) ? r.gaps : null, typeof r.bar_m === 'number' ? Math.round(r.bar_m) : null,
          unit(r.cloud), typeof r.faces === 'number' ? Math.round(r.faces) : null, String(b.scene || '').slice(0, 200)));
    }
    if (stmts.length) await env.DB.batch(stmts);
    let imgs = 0;
    for (const [id, b64] of Object.entries(b.img || {})) {
      if (!byId(id) || typeof b64 !== 'string' || b64.length > 400000) continue;
      const had = await env.FEEDBACK.getWithMetadata('sat:img:' + id);
      if (had.metadata && had.metadata.t > b.t) continue;   // keep the newest pass
      await env.FEEDBACK.put('sat:img:' + id, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), { metadata: { t: b.t } });
      imgs++;
    }
    return json({ ok: true, filed: stmts.length, images: imgs });
  }
  if (req.method !== 'GET') return null;
  const id = url.searchParams.get('id') || '';
  if (!byId(id)) return json({ error: 'id=<spot>' }, 400);
  if (url.pathname === '/banks/sat/img') {
    const { value, metadata } = await env.FEEDBACK.getWithMetadata('sat:img:' + id, 'arrayBuffer');
    if (!value) return json({ error: 'no pass yet' }, 404);
    return new Response(value, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600', 'Access-Control-Allow-Origin': '*', 'X-Sat-Time': (metadata && metadata.t) || '' } });
  }
  if (url.pathname === '/banks/sat') {
    const days = Math.min(120, Math.max(1, parseInt(url.searchParams.get('days') || '30', 10) || 30));
    const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 16);
    const r = await env.DB.prepare('SELECT t, label, cover, longest, gaps, bar_m, cloud FROM sat_banks WHERE spot = ? AND t >= ? ORDER BY t DESC LIMIT 200').bind(id, since).all();
    return json({ id, days, readings: r.results }, 200, { 'Cache-Control': 'public, max-age=1800' });
  }
  return null;
}
