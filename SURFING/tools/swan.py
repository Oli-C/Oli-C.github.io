"""How much of an offshore swell reaches each spot, from SWAN (the TU Delft
nearshore wave model, swanmodel.sourceforge.io) run over the real seabed.

For each area: EMODnet's bathymetry (~1/16', ~115 m) on a regular grid, the
land cut to the OpenStreetMap coastline (coast.js); then SWAN, stationary,
no wind, a 1.5 m JONSWAP swell on the open boundaries, for every period in
PERIODS and direction in DIRS. At each spot, the wave height at its
'nearshore point' (seaward from the beach, first water NEAR_DEPTH deep)
over the offshore height, divided by plain shoaling to that depth (linear
theory, which score.js's breaking factor already carries from deep water),
is how much of the swell gets there: sheltering, refraction, focusing.

  python SURFING/tools/swan.py prep AREA        bathymetry + the spots' points -> work/AREA
  python SURFING/tools/swan.py run AREA [--quick] [--jobs N]
                                                SWAN for every case -> work/AREA/result.json
  python SURFING/tools/swan.py fine NAME [--quick] [--jobs N] [--heights 1,2]
                                                a fine grid nested in its area (below)
                                                -> work/fine-NAME/result.json
  python SURFING/tools/swan.py merge            every result -> SURFING/swan.js (keeps
                                                what's there for anything not rerun)
  python SURFING/tools/swan.py report           the table against score.js's hand-set rule

Fine grids, for the spots that matter most: ~30-45 m, the same EMODnet
depths interpolated (no finer survey is published for this coast), driven
by the spectra their area's run writes along their edges (SWAN nesting),
for offshore heights of 1, 2 and 4 m (the edge spectra scaled), so that
breaking on big days shows. At each spot SWAN's breaking height is the
highest Hs along a line out from the beach (before it breaks it only
grows; after, it falls), over the offshore height. Diffraction is on where
headlands shelter the spots (the Cascais line).

Run by .github/workflows/surf-swan.yml (by hand; SWAN's Linux build, an
area a job). Needs numpy and tifffile; `run` needs swan.exe on PATH or in
SWAN_EXE. Regenerate rather than edit swan.js."""
import json
import math
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import numpy as np

try:  # the operating system's certificates, where a network inspects TLS (optional)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
SURF = os.path.join(HERE, '..')
WORK = os.path.join(HERE, 'swan-work')
OUT = os.path.join(SURF, 'swan.js')

PERIODS = [6, 8, 10, 12, 14, 16, 18]                  # s, peak period
DIRS = [180, 195, 210, 225, 240, 255, 270, 285, 300, 315, 330, 345, 0]   # from, nautical
HS = 1.5                 # m, offshore significant height on the boundaries
SPREAD = 20              # degrees, directional spread of a swell
NEAR_DEPTH = 8.0         # m: a spot's nearshore point is the first water this deep
SEARCH_M = 2500          # how far out to look for it
G = 9.81

# Each area's box (W, S, E, N) runs well past its spots, so the open
# boundaries (which get the full offshore swell) don't reach them.
AREAS = {
    'lisbon':   {'box': (-9.75, 38.45, -9.10, 38.88), 'res': 0.00125,
                 'spots': ['guincho-norte', 'guincho-sul', 'sao-pedro-estoril', 'carcavelos', 'caparica-sao-joao',
                           'caparica-cds', 'caparica-praia-nova', 'caparica-riviera', 'fonte-da-telha']},
    'sintra':   {'box': (-9.75, 38.68, -9.40, 39.00), 'res': 0.00125, 'spots': ['praia-grande-norte', 'praia-grande-sul']},
    'ericeira': {'box': (-9.70, 38.85, -9.36, 39.12), 'res': 0.00125, 'spots': ['ribeira-d-ilhas']},
    'peniche':  {'box': (-9.75, 39.20, -9.25, 39.55), 'res': 0.00125, 'spots': ['peniche-lagide', 'peniche-supertubos']},
    'nazare':   {'box': (-9.50, 39.45, -9.03, 39.80), 'res': 0.00125, 'spots': ['nazare-norte']},
    'arrifana': {'box': (-9.15, 37.15, -8.84, 37.45), 'res': 0.00125, 'spots': ['arrifana']},
}
# Fine grids, nested in an area: (W, S, E, N), resolution in degrees.
FINE = {
    'caparica': {'parent': 'lisbon', 'box': (-9.32, 38.55, -9.17, 38.68), 'res': 0.0004, 'diffrac': False,
                 'spots': ['caparica-sao-joao', 'caparica-cds', 'caparica-praia-nova', 'caparica-riviera', 'fonte-da-telha']},
    'cascais':  {'parent': 'lisbon', 'box': (-9.42, 38.655, -9.30, 38.72), 'res': 0.0003, 'diffrac': True,
                 'spots': ['sao-pedro-estoril', 'carcavelos']},
    'nazare':   {'parent': 'nazare', 'box': (-9.17, 39.55, -9.06, 39.66), 'res': 0.0003, 'diffrac': False,
                 'spots': ['nazare-norte']},
    'peniche':  {'parent': 'peniche', 'box': (-9.43, 39.32, -9.30, 39.40), 'res': 0.0003, 'diffrac': False,
                 'spots': ['peniche-supertubos', 'peniche-lagide']},
}
HEIGHTS = [1, 2, 4]          # m, offshore
NATIVE = 1 / 960             # EMODnet's DTM: 1/16 arc-minute
TRANSECT_STEP = 20           # m between points on a spot's line out to sea
TRANSECT_DEPTH = 15.0        # m: the line runs out to this depth
NEST_STEP = 0.002            # degrees between the edge spectra an area writes for a fine grid

WCS = ('https://ows.emodnet-bathymetry.eu/wcs?service=WCS&version=1.0.0&request=GetCoverage&coverage=emodnet:mean'
       '&crs=EPSG:4326&bbox={w},{s},{e},{n}&resx={r}&resy={r}&format=image/tiff')


# ---------- the spots and the coastline, from the site's own files ----------
def site_json(expr):
    """Evaluate `expr` with spots.js and coast.js loaded (Node), as JSON."""
    js = ("const fs=require('fs'),vm=require('vm'),c={};vm.createContext(c);"
          f"for(const f of ['spots.js','coast.js'])vm.runInContext(fs.readFileSync({json.dumps(SURF)}+'/'+f,'utf8')+';this.CAMS=typeof CAMS!=\"undefined\"?CAMS:this.CAMS;this.COAST=typeof COAST!=\"undefined\"?COAST:this.COAST',c);"
          f"process.stdout.write(JSON.stringify((({expr}))(c)))")
    return json.loads(subprocess.check_output(['node', '-e', js], text=True))


def spots():
    return {c['id']: c for c in site_json("c=>c.CAMS.map(x=>({id:x.id,name:x.name,lat:x.lat,lng:x.lng,faces:x.faces}))")}


def land_rings():
    q, rings = site_json('c=>[c.COAST.q,c.COAST.rings]')
    out = []
    for r in rings:
        a = np.cumsum(np.array(r, dtype=float).reshape(-1, 2), axis=0) / q   # (lat, lng)
        out.append(a)
    return out


def inside(lat, lng, ring):
    """Even-odd point in polygon, vectorised over grid points (lat, lng arrays)."""
    y, x = ring[:, 0], ring[:, 1]
    res = np.zeros(lat.shape, bool)
    j = len(ring) - 1
    for i in range(len(ring)):
        yi, xi, yj, xj = y[i], x[i], y[j], x[j]
        cond = (yi > lat) != (yj > lat)
        with np.errstate(divide='ignore', invalid='ignore'):
            xc = (xj - xi) * (lat - yi) / (yj - yi) + xi
        res ^= cond & (lng < xc)
        j = i
    return res


# ---------- prep ----------
def fetch_bathy(box, res):
    w, s, e, n = box
    url = WCS.format(w=w, s=s, e=e, n=n, r=res)
    for attempt in range(5):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'allfield-surf-swan/1'}), timeout=600) as r:
                data = r.read()
            break
        except Exception as e:
            if attempt == 4:
                raise
            print('  bathymetry retry:', e)
            time.sleep(20 * (attempt + 1))
    import io
    import tifffile
    return tifffile.imread(io.BytesIO(data)).astype(float)   # elevation, m; row 0 is the north edge


def prep(area):
    a = AREAS[area]
    w, s, e, n = a['box']
    res = a['res']
    d = os.path.join(WORK, area)
    os.makedirs(d, exist_ok=True)
    print(area, 'bathymetry...')
    elev = fetch_bathy(a['box'], res)
    ny, nx = elev.shape
    lats = n - (np.arange(ny) + 0.5) * res          # cell centres, north to south
    lngs = w + (np.arange(nx) + 0.5) * res
    LAT, LNG = np.meshgrid(lats, lngs, indexing='ij')
    land = np.zeros(elev.shape, bool)
    for ring in land_rings():
        if ring[:, 0].max() < s or ring[:, 0].min() > n or ring[:, 1].max() < w or ring[:, 1].min() > e:
            continue
        land |= inside(LAT, LNG, ring)
    depth = -elev
    depth[land] = -5.0                                # dry
    depth[(~land) & (depth < 0.5)] = 0.5              # sea the DTM calls land or a wash: shallow water
    np.savetxt(os.path.join(d, 'bottom.dat'), depth, fmt='%.2f')
    # The spots' nearshore points: seaward from the beach, first water NEAR_DEPTH deep.
    sp = spots()
    pts = []
    for sid in a['spots']:
        c = sp[sid]
        pts.append(near_point(c, depth, lats, lngs, res))
        p = pts[-1]
        print(f"  {sid}: point {p['lat']:.5f},{p['lng']:.5f} at {p['depth']:.1f} m, {p['dist']:.0f} m out")
    meta = {'area': area, 'box': a['box'], 'res': res, 'nx': nx, 'ny': ny, 'points': pts,
            'wet': float((depth > 0).mean())}
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
    with open(os.path.join(d, 'points.loc'), 'w') as f:
        for p in pts:
            f.write(f"{p['lng']:.6f} {p['lat']:.6f}\n")
    print(f"  grid {nx}x{ny}, {meta['wet'] * 100:.0f}% sea")


def depth_at(depth, lats, lngs, res, lat, lng):
    i = int(round((lats[0] - lat) / res))
    j = int(round((lng - lngs[0]) / res))
    if 0 <= i < len(lats) and 0 <= j < len(lngs):
        return depth[i, j]
    return None


def near_point(c, depth, lats, lngs, res):
    """Out from the spot along the way its beach faces (and up to 40° either
    side), the first point NEAR_DEPTH deep, nearest first."""
    best = None
    for off in (0, -10, 10, -20, 20, -30, 30, -40, 40):
        b = math.radians((c['faces'] + off) % 360)
        for dist in range(50, SEARCH_M, 25):
            lat = c['lat'] + dist * math.cos(b) / 110540
            lng = c['lng'] + dist * math.sin(b) / (111320 * math.cos(math.radians(c['lat'])))
            dd = depth_at(depth, lats, lngs, res, lat, lng)
            if dd is None:
                break
            if dd >= NEAR_DEPTH:
                if best is None or dist < best['dist']:
                    best = {'id': c['id'], 'lat': lat, 'lng': lng, 'depth': float(dd), 'dist': dist, 'bearing': (c['faces'] + off) % 360}
                break
        if best and off and abs(off) >= 20:
            break
    if not best:
        raise SystemExit(f"{c['id']}: no water {NEAR_DEPTH} m deep within {SEARCH_M} m")
    return best


# ---------- run ----------
def nest_cmds(nests):
    """An area run's lines writing the edge spectra for fine grids."""
    out = []
    for name in nests:
        w, s, e, n = FINE[name]['box']
        mx, my = max(2, round((e - w) / NEST_STEP)), max(2, round((n - s) / NEST_STEP))
        out.append(f"NGRID '{name}' {w:.6f} {s:.6f} 0. {e - w:.6f} {n - s:.6f} {mx} {my}")
        out.append(f"NESTOUT '{name}' 'nest-{name}.dat'")
    return '\n'.join(out)


def swan_input(meta, period, dirn, nests=()):
    w, s, e, n = meta['box']
    res, nx, ny = meta['res'], meta['nx'], meta['ny']
    x0, y0 = w + res / 2, s + res / 2
    xl, yl = (nx - 1) * res, (ny - 1) * res
    sides = '\n'.join(f'BOUNDSPEC SIDE {sd} CCW CONSTANT PAR {HS} {period} {dirn} {SPREAD}' for sd in ('N', 'W', 'S', 'E'))
    return f"""PROJECT '{meta['area']}' '{period:02d}{dirn // 15:02d}'
SET LEVEL=0. NAUTICAL
MODE STATIONARY TWODIMENSIONAL
COORDINATES SPHERICAL
CGRID REGULAR {x0:.6f} {y0:.6f} 0. {xl:.6f} {yl:.6f} {nx - 1} {ny - 1} CIRCLE 36 0.04 1.0 31
INPGRID BOTTOM REGULAR {x0:.6f} {y0:.6f} 0. {nx - 1} {ny - 1} {res} {res}
READINP BOTTOM 1. '../../bottom.dat' 1 0 FREE
BOUND SHAPESPEC JONSWAP 3.3 PEAK DSPR DEGREES
{sides}
OFF WCAPPING
OFF QUADRUPL
BREAKING CONSTANT 1.0 0.73
FRICTION JONSWAP CONSTANT 0.038
TRIAD
NUM STOPC 0.005 0.01 0.005 99.5 STAT 40
POINTS 'P' FILE '../../points.loc'
TABLE 'P' NOHEADER 'points.tab' HSIGN TPS DIR DEPTH
{nest_cmds(nests)}
COMPUTE
STOP
"""


def swan(d, text, exe, label, need=('points.tab',)):
    """Run SWAN in directory d on INPUT `text`; seconds taken (0 if already done)."""
    os.makedirs(d, exist_ok=True)
    if all(os.path.exists(os.path.join(d, f)) and os.path.getsize(os.path.join(d, f)) > 0 for f in need):
        return 0.0
    with open(os.path.join(d, 'INPUT'), 'w') as f:
        f.write(text)
    t0 = time.time()
    p = subprocess.run([exe], cwd=d, env=dict(os.environ, OMP_NUM_THREADS='1'), capture_output=True, text=True)
    if p.returncode != 0 or not all(os.path.exists(os.path.join(d, f)) for f in need):
        prt = os.path.join(d, 'PRINT')
        tail = open(prt).read()[-3000:] if os.path.exists(prt) else p.stdout[-2000:] + p.stderr[-2000:]
        raise RuntimeError(f'SWAN failed for {label}:\n{tail}')
    return time.time() - t0


def run_case(area, meta, period, dirn, exe, nests=()):
    d = os.path.join(WORK, area, 'cases', f'T{period:02d}D{dirn:03d}')
    secs = swan(d, swan_input(meta, period, dirn, nests), exe, f'{area} T{period} D{dirn}',
                ['points.tab'] + [f'nest-{x}.dat' for x in nests])
    return period, dirn, read_tab(os.path.join(d, 'points.tab')), secs


def read_tab(path):
    rows = []
    for line in open(path):
        v = line.split()
        if len(v) >= 4:
            rows.append([float(x) for x in v[:4]])          # Hsig, Tps, Dir, Depth
    return rows


def run(area, quick=False, jobs=None):
    d = os.path.join(WORK, area)
    meta = json.load(open(os.path.join(d, 'meta.json')))
    exe = os.environ.get('SWAN_EXE', 'swan.exe')
    cases = [(p, dd) for p in ([12] if quick else PERIODS) for dd in ([285] if quick else DIRS)]
    jobs = jobs or os.cpu_count() or 2
    print(f'{area}: {len(cases)} SWAN runs, {jobs} at a time')
    out = {}
    t0 = time.time()
    with ThreadPoolExecutor(jobs) as pool:
        for period, dirn, rows, secs in pool.map(lambda c: run_case(area, meta, c[0], c[1], exe), cases):
            out[f'{period}/{dirn}'] = rows
            print(f'  T{period} D{dirn}: ' + ' '.join(f"{r[0]:.2f}" for r in rows) + f'  ({secs:.0f} s)', flush=True)
    print(f'{area}: done in {(time.time() - t0) / 60:.1f} min')
    json.dump({'meta': meta, 'hs': HS, 'cases': out}, open(os.path.join(d, 'result.json'), 'w'))


# ---------- fine grids ----------
def depth_fine(box, res):
    """EMODnet depths (native) bilinearly onto a fine grid, the land cut to the
    OSM coastline. The DTM's land cells count as just awash for the
    interpolation, so the coast comes from the coastline, not the DTM."""
    w, s, e, n = box
    pad = 4 * NATIVE
    elev = fetch_bathy((w - pad, s - pad, e + pad, n + pad), NATIVE)
    elev = np.minimum(elev, -0.3)
    ny0, nx0 = elev.shape
    lat0 = (n + pad) - (np.arange(ny0) + 0.5) * NATIVE
    lng0 = (w - pad) + (np.arange(nx0) + 0.5) * NATIVE
    ny, nx = round((n - s) / res), round((e - w) / res)
    lats = n - (np.arange(ny) + 0.5) * res
    lngs = w + (np.arange(nx) + 0.5) * res
    fi = np.clip((lat0[0] - lats) / NATIVE, 0, ny0 - 1.001)
    fj = np.clip((lngs - lng0[0]) / NATIVE, 0, nx0 - 1.001)
    i0, j0 = fi.astype(int), fj.astype(int)
    ti, tj = (fi - i0)[:, None], (fj - j0)[None, :]
    a = elev[np.ix_(i0, j0)]
    b = elev[np.ix_(i0, j0 + 1)]
    c = elev[np.ix_(i0 + 1, j0)]
    d = elev[np.ix_(i0 + 1, j0 + 1)]
    z = a * (1 - ti) * (1 - tj) + b * (1 - ti) * tj + c * ti * (1 - tj) + d * ti * tj
    LAT, LNG = np.meshgrid(lats, lngs, indexing='ij')
    land = np.zeros(z.shape, bool)
    for ring in land_rings():
        if ring[:, 0].max() < s or ring[:, 0].min() > n or ring[:, 1].max() < w or ring[:, 1].min() > e:
            continue
        land |= inside(LAT, LNG, ring)
    depth = -z
    depth[land] = -5.0
    depth[(~land) & (depth < 0.3)] = 0.3
    return depth, lats, lngs


def transect(c, depth, lats, lngs, res):
    """Points out from the beach, every TRANSECT_STEP m, from the first water
    to TRANSECT_DEPTH deep (or 3 km over a shallow shelf): the way the beach
    faces, unless land blocks it (a beach in a bay); then the nearest bearing,
    up to 60° either side, that's clear."""
    def line(bearing):
        b = math.radians(bearing)
        pts, wet, blocked = [], False, False
        for dist in range(0, 3000, TRANSECT_STEP):
            lat = c['lat'] + dist * math.cos(b) / 110540
            lng = c['lng'] + dist * math.sin(b) / (111320 * math.cos(math.radians(c['lat'])))
            dd = depth_at(depth, lats, lngs, res, lat, lng)
            if dd is None:
                break
            if dd > 0:
                wet = True
                pts.append({'lat': lat, 'lng': lng, 'depth': float(dd), 'dist': dist, 'bearing': bearing % 360})
                if dd >= TRANSECT_DEPTH:
                    break
            elif wet:
                blocked = True
                break
        return pts, blocked
    best = []
    for off in (0, -15, 15, -30, 30, -45, 45, -60, 60):
        pts, blocked = line(c['faces'] + off)
        if len(pts) >= 5 and not blocked:
            return pts
        if pts and (not best or pts[-1]['depth'] > best[-1]['depth']):
            best = pts
    if len(best) < 5:
        raise SystemExit(f"{c['id']}: too little water on its line out to sea")
    return best


def prep_fine(name):
    f = FINE[name]
    d = os.path.join(WORK, f'fine-{name}')
    os.makedirs(d, exist_ok=True)
    print(f'fine {name}: bathymetry...')
    depth, lats, lngs = depth_fine(f['box'], f['res'])
    np.savetxt(os.path.join(d, 'bottom.dat'), depth, fmt='%.2f')
    sp = spots()
    lines, spots_meta = [], []
    for sid in f['spots']:
        pts = transect(sp[sid], depth, lats, lngs, f['res'])
        spots_meta.append({'id': sid, 'first': len(lines), 'n': len(pts), 'points': pts})
        lines += [f"{p['lng']:.6f} {p['lat']:.6f}" for p in pts]
        print(f"  {sid}: {len(pts)} points bearing {pts[0]['bearing']}°, {pts[0]['depth']:.1f} to {pts[-1]['depth']:.1f} m over {pts[-1]['dist']} m")
    open(os.path.join(d, 'points.loc'), 'w').write('\n'.join(lines) + '\n')
    ny, nx = depth.shape
    meta = {'fine': name, 'box': f['box'], 'res': f['res'], 'nx': nx, 'ny': ny, 'spots': spots_meta, 'wet': float((depth > 0).mean())}
    json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), indent=1)
    print(f'  grid {nx}x{ny}, {meta["wet"] * 100:.0f}% sea')


def fine_input(meta, tag, diffrac):
    w, s, e, n = meta['box']
    res, nx, ny = meta['res'], meta['nx'], meta['ny']
    x0, y0 = w + res / 2, s + res / 2
    xl, yl = (nx - 1) * res, (ny - 1) * res
    diff = 'DIFFRAC 1 0.2 5' if diffrac else ''
    return f"""PROJECT '{meta['fine'][:16]}' '{tag}'
SET LEVEL=0. NAUTICAL
MODE STATIONARY TWODIMENSIONAL
COORDINATES SPHERICAL
CGRID REGULAR {x0:.6f} {y0:.6f} 0. {xl:.6f} {yl:.6f} {nx - 1} {ny - 1} CIRCLE 36 0.04 1.0 31
INPGRID BOTTOM REGULAR {x0:.6f} {y0:.6f} 0. {nx - 1} {ny - 1} {res} {res}
READINP BOTTOM 1. '../../bottom.dat' 1 0 FREE
BOUNDNEST1 NEST 'nest.dat' CLOSED
OFF WCAPPING
OFF QUADRUPL
BREAKING CONSTANT 1.0 0.73
FRICTION JONSWAP CONSTANT 0.038
TRIAD
{diff}
NUM STOPC 0.005 0.01 0.005 99.5 STAT 40
POINTS 'P' FILE '../../points.loc'
TABLE 'P' NOHEADER 'points.tab' HSIGN DEPTH
COMPUTE
STOP
"""


def scale_nest(src, dst, f):
    """Copy an edge-spectra file with every spectrum's energy times f."""
    lines = open(src).read().splitlines()
    out, i = [], 0
    while i < len(lines):
        out.append(lines[i])
        if lines[i].strip().upper() == 'FACTOR' and i + 1 < len(lines):
            out.append(f'  {float(lines[i + 1]) * f:.6E}')
            i += 2
            continue
        i += 1
    open(dst, 'w').write('\n'.join(out) + '\n')


def breaking(rows, sm):
    """SWAN's breaking height on a spot's line: the highest Hs in the water."""
    seg = rows[sm['first']:sm['first'] + sm['n']]
    return max([r[0] for r in seg if r[1] > 0.3 and r[0] > 0] or [0])


def run_fine(name, quick=False, jobs=None, heights=None):
    f = FINE[name]
    area = f['parent']
    exe = os.environ.get('SWAN_EXE', 'swan.exe')
    jobs = jobs or os.cpu_count() or 2
    ameta = json.load(open(os.path.join(WORK, area, 'meta.json')))
    fd = os.path.join(WORK, f'fine-{name}')
    meta = json.load(open(os.path.join(fd, 'meta.json')))
    cases = [(p, dd) for p in ([12] if quick else PERIODS) for dd in ([285] if quick else DIRS)]
    heights = heights or HEIGHTS
    # One results file per set of heights, written as each case finishes, so
    # a job that runs out of time keeps what it got (merge reads them all).
    res_path = os.path.join(fd, 'result' + ('' if heights == HEIGHTS else '-H' + '-'.join(map(str, heights))) + '.json')
    t0 = time.time()
    print(f'fine {name}: {len(cases)} area runs for its edges, then {len(cases) * len(heights)} fine runs, {jobs} at a time')
    with ThreadPoolExecutor(jobs) as pool:
        for period, dirn, _, secs in pool.map(lambda c: run_case(area, ameta, c[0], c[1], exe, [name]), cases):
            print(f'  edges T{period} D{dirn} ({secs:.0f} s)', flush=True)

    def one(c):
        h, period, dirn = c
        cd = os.path.join(fd, 'cases', f'H{h}T{period:02d}D{dirn:03d}')
        os.makedirs(cd, exist_ok=True)
        nest = os.path.join(WORK, area, 'cases', f'T{period:02d}D{dirn:03d}', f'nest-{name}.dat')
        if not os.path.exists(os.path.join(cd, 'nest.dat')):
            scale_nest(nest, os.path.join(cd, 'nest.dat'), (h / HS) ** 2)
        tag = f'{h}{period:02d}{DIRS.index(dirn):x}'
        secs = swan(cd, fine_input(meta, tag, f['diffrac']), exe, f'{name} H{h} T{period} D{dirn}')
        rows = [[float(x) for x in line.split()[:2]] for line in open(os.path.join(cd, 'points.tab')) if len(line.split()) >= 2]
        return h, period, dirn, rows, secs

    out = {}
    with ThreadPoolExecutor(jobs) as pool:
        for h, period, dirn, rows, secs in pool.map(one, [(h, p, dd) for h in heights for p, dd in cases]):
            out[f'{h}/{period}/{dirn}'] = rows
            hb = [breaking(rows, sm) for sm in meta['spots']]
            print(f'  H{h} T{period} D{dirn}: breaking ' + ' '.join(f'{x:.2f}' for x in hb) + f'  ({secs:.0f} s)', flush=True)
            json.dump({'meta': meta, 'cases': out}, open(res_path, 'w'))
    print(f'fine {name}: done in {(time.time() - t0) / 60:.1f} min')
    json.dump({'meta': meta, 'cases': out}, open(res_path, 'w'))


# ---------- merge ----------
def shoaling(period, depth):
    """Linear-theory shoaling coefficient from deep water to `depth`."""
    w = 2 * math.pi / period
    k = w * w / G
    for _ in range(60):                                          # dispersion: w^2 = g k tanh(k h)
        k = k - (G * k * math.tanh(k * depth) - w * w) / (G * math.tanh(k * depth) + G * k * depth / math.cosh(k * depth) ** 2)
    kh = k * depth
    cg = 0.5 * (1 + 2 * kh / math.sinh(2 * kh)) * w / k
    cg0 = G * period / (4 * math.pi)
    return math.sqrt(cg0 / cg)


def load_existing():
    if not os.path.exists(OUT):
        return {}
    try:
        return json.loads(open(OUT).read().split('const SWAN = ', 1)[1].rstrip().rstrip(';'))
    except (IndexError, ValueError):
        return {}


def merge():
    old = load_existing()
    out = {'periods': PERIODS, 'dirs': DIRS, 'nearDepth': NEAR_DEPTH, 'heights': HEIGHTS,
           'spots': dict(old.get('spots', {})), 'fine': dict(old.get('fine', {}))}
    for name in FINE:
        fd = os.path.join(WORK, f'fine-{name}')
        paths = [os.path.join(fd, f) for f in (os.listdir(fd) if os.path.isdir(fd) else []) if f.startswith('result') and f.endswith('.json')]
        if not paths:
            continue
        meta, cases = None, {}
        for path in paths:                       # one file per job (by heights), maybe partial
            r = json.load(open(path))
            meta = meta or r['meta']
            cases.update(r['cases'])
        need = [f'{h}/{p}/{d}' for h in HEIGHTS for p in PERIODS for d in DIRS]
        missing = [x for x in need if x not in cases]
        if missing:
            print(f'fine {name}: {len(missing)} of {len(need)} cases missing (e.g. {missing[0]}); not used')
            continue
        for sm in meta['spots']:
            k = [[[round(breaking(cases[f'{h}/{p}/{d}'], sm) / h, 3) for d in DIRS] for p in PERIODS] for h in HEIGHTS]
            out['fine'][sm['id']] = {'grid': name, 'res': meta['res'], 'k': k}
    for area in AREAS:
        path = os.path.join(WORK, area, 'result.json')
        if not os.path.exists(path):
            print('no result for', area)
            continue
        r = json.load(open(path))
        for i, p in enumerate(r['meta']['points']):
            k = []
            for period in PERIODS:
                row = []
                for dirn in DIRS:
                    rows = r['cases'].get(f'{period}/{dirn}')
                    h = rows[i][0] if rows and rows[i][0] >= 0 else 0.0
                    row.append(round(h / r['hs'] / shoaling(period, p['depth']), 3))
                k.append(row)
            out['spots'][p['id']] = {'area': area, 'lat': round(p['lat'], 5), 'lng': round(p['lng'], 5), 'depth': round(p['depth'], 1), 'k': k}
    with open(OUT, 'w', newline='\n') as f:
        f.write(f"""/* Generated by tools/swan.py on {time.strftime('%Y-%m-%d')}: how much of an offshore swell
   reaches each spot, from SWAN over EMODnet's bathymetry (see the tool).
   k[period][direction] is the swell's height at the spot's nearshore point
   ({NEAR_DEPTH:g} m deep, seaward of the beach) over its offshore height, less
   plain shoaling (score.js's breaking factor carries that): the sheltering,
   refraction and focusing. fine[spot].k[height][period][direction], for
   the spots with a fine grid: SWAN's breaking height (the highest Hs on a
   line out from the beach) over the offshore height, for offshore heights
   of {', '.join(map(str, HEIGHTS))} m. Regenerate rather than edit. */
const SWAN = {json.dumps(out, separators=(',', ':'))};
""")
    print('wrote', OUT, len(out['spots']), 'spots,', len(out['fine']), 'with fine grids')


# ---------- report ----------
def report():
    swan = json.loads(open(OUT).read().split('const SWAN = ', 1)[1].rstrip().rstrip(';'))
    sp = spots()
    print(f"{'spot':22s} {'per':>4s} " + ' '.join(f'{d:>5d}' for d in DIRS))
    for sid, s in swan['spots'].items():
        for pi, period in enumerate(PERIODS):
            if period not in (8, 12, 16):
                continue
            print(f"{(sid if pi == 1 else ''):22s} {period:4d}s " + ' '.join(f"{v:5.2f}" for v in s['k'][pi]))
        print(f"{'':22s}  faces {sp[sid]['faces']}")


if __name__ == '__main__':
    cmd = sys.argv[1] if len(sys.argv) > 1 else ''
    if cmd == 'prep':
        prep(sys.argv[2])
    elif cmd == 'run':
        jobs = int(sys.argv[sys.argv.index('--jobs') + 1]) if '--jobs' in sys.argv else None
        run(sys.argv[2], quick='--quick' in sys.argv, jobs=jobs)
    elif cmd == 'fine':
        name = sys.argv[2]
        jobs = int(sys.argv[sys.argv.index('--jobs') + 1]) if '--jobs' in sys.argv else None
        if not os.path.exists(os.path.join(WORK, FINE[name]['parent'], 'meta.json')):
            prep(FINE[name]['parent'])
        if not os.path.exists(os.path.join(WORK, f'fine-{name}', 'meta.json')):
            prep_fine(name)
        heights = [float(x) if '.' in x else int(x) for x in sys.argv[sys.argv.index('--heights') + 1].split(',')] if '--heights' in sys.argv else None
        run_fine(name, quick='--quick' in sys.argv, jobs=jobs, heights=heights)
    elif cmd == 'merge':
        merge()
    elif cmd == 'report':
        report()
    else:
        print(__doc__)
