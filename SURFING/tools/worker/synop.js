/* ---------- SYNOP: the weather stations' hourly coded reports ----------
   Part of the surf worker (see main.js; tools/build-worker.mjs bundles it).

   IPMA's open feed only keeps a day, and now and then it goes quiet (7–8 Nov
   2026: 27 of 34 hours null at every station). Its synoptic stations (ids
   12005NN) are WMO 085NN, and their reports also go out on the GTS, which
   Ogimet archives. history.js fills those stations' missing hours from
   there. Checked against IPMA's own readings for 1–6 Nov (Lisboa, Cabo
   Carvoeiro, Sagres): same hour, wind within ~1 km/h, direction ~12° (IPMA
   gives 8 compass points), air ~0.5 °C.

   One Ogimet line: "08535,2026,11,07,03,00,AAXX 07031 08535 05/// /0503 10144 …=="
   decodeSynop(line) → { wmo, t: "2026-11-07T03:00", ws (km/h), wd (°), air (°C) }
   or null when the line isn't a land SYNOP. ws / wd / air are null when not
   reported; calm is ws 0, wd null; variable is wd null. */
function decodeSynop(line) {
  const p = String(line).trim().split(',');
  if (p.length < 7 || !/^\d{5}$/.test(p[0]) || !/^\d{4}$/.test(p[1])) return null;
  const [wmo, y, mo, d, h] = p;
  const g = p.slice(6).join(',').replace(/=+$/, '').trim().split(/\s+/);
  if (g[0] !== 'AAXX' || g.length < 5 || !/^\d{4}[\d/]$/.test(g[1])) return null;
  // iw (end of YYGGiw): 0/1 wind in m/s, 3/4 in knots, / not reported.
  const iw = g[1][4], unit = iw === '0' || iw === '1' ? 3.6 : iw === '3' || iw === '4' ? 1.852 : null;
  let ws = null, wd = null, i = 5;   // g[2] station, g[3] iRiXhVV, g[4] Nddff
  const m = /^[\d/](\d\d|\/\/)(\d\d|\/\/)$/.exec(g[4]);
  if (!m) return null;
  if (unit && m[2] !== '//') {
    let ff = +m[2];
    if (ff === 99 && /^00\d\d\d$/.test(g[5] || '')) { ff = +g[5].slice(2); i = 6; }   // 99 or more: in a 00fff group
    ws = Math.round(ff * unit * 10) / 10;
    const dd = m[1] === '//' ? null : +m[1];
    wd = ws === 0 || dd == null || dd === 0 || dd > 36 ? null : (dd * 10) % 360;   // 99: variable
  }
  // 1sTTT, air temperature in tenths, is the first group after the wind when present.
  const t = /^1([01])(\d\d\d)$/.exec(g[i] || '');
  const air = t ? (t[1] === '1' ? -1 : 1) * (+t[2] / 10) : null;
  return { wmo, t: `${y}-${mo}-${d}T${h}:00`, ws, wd, air };
}
