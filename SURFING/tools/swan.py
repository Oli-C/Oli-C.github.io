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
  python SURFING/tools/swan.py merge            every area's result -> SURFING/swan.js
  python SURFING/tools/swan.py report           the table against score.js's hand-set rule

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
def swan_input(meta, period, dirn):
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
COMPUTE
STOP
"""


def run_case(area, meta, period, dirn, exe):
    d = os.path.join(WORK, area, 'cases', f'T{period:02d}D{dirn:03d}')
    os.makedirs(d, exist_ok=True)
    tab = os.path.join(d, 'points.tab')
    if os.path.exists(tab) and os.path.getsize(tab) > 0:
        return period, dirn, read_tab(tab), 0.0
    with open(os.path.join(d, 'INPUT'), 'w') as f:
        f.write(swan_input(meta, period, dirn))
    t0 = time.time()
    env = dict(os.environ, OMP_NUM_THREADS='1')
    p = subprocess.run([exe], cwd=d, env=env, capture_output=True, text=True)
    if p.returncode != 0 or not os.path.exists(tab):
        prt = os.path.join(d, 'PRINT')
        tail = open(prt).read()[-3000:] if os.path.exists(prt) else p.stdout[-2000:] + p.stderr[-2000:]
        raise RuntimeError(f'SWAN failed for T{period} D{dirn}:\n{tail}')
    return period, dirn, read_tab(tab), time.time() - t0


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


def merge():
    out = {'periods': PERIODS, 'dirs': DIRS, 'nearDepth': NEAR_DEPTH, 'spots': {}}
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
   refraction and focusing. Regenerate rather than edit. */
const SWAN = {json.dumps(out, separators=(',', ':'))};
""")
    print('wrote', OUT, len(out['spots']), 'spots')


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
    elif cmd == 'merge':
        merge()
    elif cmd == 'report':
        report()
    else:
        print(__doc__)
