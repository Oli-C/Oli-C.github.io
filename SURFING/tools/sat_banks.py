"""The banks from space: Sentinel-2 (10 m, free, every 2-5 days at ~11:30 UTC).

In near-infrared, water is black and whitewater bright, so the breaking
shows as bands off the beach: one long band is a closeout, bands broken by
dark gaps are peaks and channels, and how far out the outer band sits is
where the bar is. Sand is bright too but warm in colour, foam is white,
so the two are told apart by colour.

For each spot in AREAS (cams or not), on each clear scene: a strip of
coast 1.4 km long (700 m either side), aligned with the way the beach
faces, from 150 m inland to 700 m out. Per 10 m along the beach: the
shoreline (where the sand ends) and the foam seaward of it. Then

  cover     share of the strip with breaking beyond the swash (> 30 m out)
  longest   longest unbroken stretch of breaking, as a share of the strip
  gaps      channels: breaks in it 50 m wide or more
  bar_m     median distance of the outermost breaking from the shoreline
  label     'flat' (cover < 0.15), 'inside only' (the breaking within 60 m
            of the shore), 'channels' (cut by 1+ gaps), 'continuous'
            (unbroken over 3/4 of it), else 'patchy'. Not closeouts: from
            space a big day is white right across, broken waves and all
  cloud     share of the strip under cloud or its shadow (over 10%: skipped)

Scenes from Element 84's Earth Search catalogue (public, no key), read a
window at a time from the cloud-optimised files.

  python SURFING/tools/sat_banks.py [--days 5] [--img DIR] [--out FILE] [--post]

--post sends each scene's readings and each spot's image to the worker
(POST /banks/sat; FEEDBACK_URL, FEEDBACK_KEY). Needs numpy, pillow,
rasterio. surf-sat.yml runs it daily.
"""
import base64, datetime as dt, io, json, math, os, subprocess, sys, urllib.request
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.warp import transform, transform_bounds
from rasterio.enums import Resampling
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SURF = os.path.dirname(HERE)
STAC = 'https://earth-search.aws.element84.com/v1/search'
AREAS = ('Caparica', 'Sesimbra')
ALONG, BACK, OUT, STEP = 700, 150, 700, 10      # metres
SWASH, MIN_GAP, MAX_CLOUD, MAX_BAR = 30, 50, 0.10, 500   # metres, metres, share, metres
BANDS = {'blue': 'B02', 'green': 'B03', 'red': 'B04', 'nir': 'B08'}
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')


def spots():
    js = ("const fs=require('fs'),vm=require('vm'),c={};vm.createContext(c);"
          f"vm.runInContext(fs.readFileSync({json.dumps(os.path.join(SURF, 'spots.js'))},'utf8')+';this.C=CAMS',c);"
          f"console.log(JSON.stringify(c.C.filter(x=>{json.dumps(list(AREAS))}.includes(x.area)).map(x=>({{id:x.id,lat:x.lat,lng:x.lng,faces:x.faces}}))))")
    return json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout)


def scenes(bbox, days):
    end = dt.datetime.now(dt.timezone.utc)
    body = {'collections': ['sentinel-2-l2a'], 'bbox': bbox, 'limit': 50,
            'datetime': f"{(end - dt.timedelta(days=days)).strftime('%Y-%m-%dT00:00:00Z')}/{end.strftime('%Y-%m-%dT%H:%M:%SZ')}",
            'query': {'eo:cloud_cover': {'lt': 80}}, 'sortby': [{'field': 'properties.datetime', 'direction': 'desc'}]}
    req = urllib.request.Request(STAC, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', 'User-Agent': 'allfield-sat/1.0'})
    return json.load(urllib.request.urlopen(req, timeout=60))['features']


def read_scene(item, bbox):
    """The bbox window of each band at 10 m, as reflectance; SCL (cloud classes) brought to the same grid."""
    bands, meta = {}, None
    for key in BANDS:
        with rasterio.open(item['assets'][key]['href']) as ds:
            win = from_bounds(*transform_bounds('EPSG:4326', ds.crs, *bbox), ds.transform).round_offsets().round_lengths()
            bands[key] = ds.read(1, window=win).astype(np.float32) / 10000
            if meta is None:
                meta = {'crs': ds.crs, 'transform': ds.window_transform(win), 'shape': bands[key].shape}
    with rasterio.open(item['assets']['scl']['href']) as ds:
        win = from_bounds(*transform_bounds('EPSG:4326', ds.crs, *bbox), ds.transform)
        bands['scl'] = ds.read(1, window=win, out_shape=meta['shape'], resampling=Resampling.nearest)
    return bands, meta


def strip(spot, bands, meta, faces=None):
    """The beach's strip in its own frame: rows across the beach (seaward up), columns along it."""
    x0, y0 = transform('EPSG:4326', meta['crs'], [spot['lng']], [spot['lat']])
    x0, y0 = x0[0], y0[0]
    th = math.radians(spot['faces'] if faces is None else faces)
    sea = np.array([math.sin(th), math.cos(th)])         # east, north: seaward
    alg = np.array([sea[1], -sea[0]])                    # along the beach
    ns = np.arange(OUT, -BACK - 1, -STEP)                # seaward first
    ss = np.arange(-ALONG, ALONG + 1, STEP)
    X = x0 + ns[:, None] * sea[0] + ss[None, :] * alg[0]
    Y = y0 + ns[:, None] * sea[1] + ss[None, :] * alg[1]
    inv = ~meta['transform']
    cols, rows = inv * (X, Y)
    r = np.clip(np.round(rows).astype(int), 0, meta['shape'][0] - 1)
    c = np.clip(np.round(cols).astype(int), 0, meta['shape'][1] - 1)
    return {k: v[r, c] for k, v in bands.items()}, ns


def shoreline(s):
    """Per column, the last land row before the sea (rows run seaward first), and the land mask."""
    b, r, n = s['blue'], s['red'], s['nir']
    warm = (r - b) / np.maximum(r + b, 1e-4)
    land = ((n > 0.12) & (warm > 0.12)) | (s['scl'] == 4)   # sand and dunes (warm, bright), vegetation
    H, Wd = n.shape
    shore = np.full(Wd, -1)
    for x in range(Wd):
        col, y = land[:, x], H - 1
        while y > 0 and not col[y]:
            y -= 1
        while y > 0 and col[y]:
            y -= 1
        shore[x] = y
    return shore, land, warm


def facing(spot, bands, meta):
    """The way this beach actually faces, from the shoreline in a clear scene: the strip is
    turned until the shoreline runs straight across it (spots.js's facing is a first guess)."""
    f = spot['faces']
    for _ in range(2):
        s, _ = strip(spot, bands, meta, f)
        shore, _, _ = shoreline(s)
        ok = shore > 0
        xs = np.where(ok)[0]
        if len(xs) < len(shore) * 0.6:
            return f
        slope = np.polyfit(xs, shore[xs], 1)[0]           # rows per column, both 10 m
        f = (f + math.degrees(math.atan(slope))) % 360
    return f


def analyse(s, ns):
    b, n = s['blue'], s['nir']
    cloud = float(np.isin(s['scl'], [3, 8, 9, 10]).mean())
    if (s['scl'] == 0).mean() > 0.1:                     # off the edge of this scene
        return None, None
    # Fog and thin cloud the scene's own classes miss: open sea is near-black
    # in infrared, so a bright sea is weather.
    if float(np.median(s['nir'][: s['nir'].shape[0] // 3])) > 0.06:
        cloud = 1.0
    shore, land, warm = shoreline(s)
    foam = (n > 0.05) & (b > 0.07) & (warm < 0.12) & ~land   # whitewater: bright in infrared, white not warm
    H, Wd = n.shape
    ok = shore > int(H * 0.25)
    if ok.mean() < 0.6:
        return None, cloud
    dist = lambda x, y: (shore[x] - y) * STEP              # metres seaward of the shoreline
    outer = np.full(Wd, np.nan); breaking = np.zeros(Wd, bool); share = np.zeros(Wd)
    for x in range(Wd):
        if not ok[x]:
            continue
        ys = np.where(foam[: shore[x], x])[0]
        far = ys[[SWASH < dist(x, y) <= MAX_BAR for y in ys]] if len(ys) else ys
        breaking[x] = len(far) >= 2
        share[x] = len(far) / max(1, (shore[x] - max(0, shore[x] - (OUT // STEP))))
        if len(far):
            outer[x] = dist(x, far.min())
    xs = np.where(ok)[0]
    br = breaking[xs]
    cover = float(br.mean())
    runs, val, cur = [], br[0], 0
    for v in br:
        if v == val: cur += 1
        else: runs.append((val, cur)); val, cur = v, 1
    runs.append((val, cur))
    min_gap = MIN_GAP // STEP
    merged = []
    for v, k in runs:
        if not v and k < min_gap and merged and merged[-1][0]:
            merged[-1] = (True, merged[-1][1] + k)
        elif merged and merged[-1][0] == v:
            merged[-1] = (v, merged[-1][1] + k)
        else:
            merged.append((v, k))
    longest = max([k for v, k in merged if v] or [0]) / len(xs)
    gaps = sum(1 for v, k in (merged[1:-1] if len(merged) > 2 else []) if not v)
    bar = float(np.nanmedian(outer[xs][br])) if br.any() else None
    near = float(np.mean([1 if (o <= 60) else 0 for o in outer[xs][br]])) if br.any() else 0.0
    # From space a big day is white right across, broken waves and all, so it
    # can't tell a closeout from a good day; what it shows is where the bar is
    # and whether channels cut through it.
    label = ('flat' if cover < 0.15 else 'inside only' if near >= 0.7 else
             'channels' if gaps >= 1 and cover >= 0.25 else 'continuous' if longest >= 0.75 else 'patchy')
    return {'cover': round(cover, 3), 'longest': round(longest, 3), 'gaps': gaps, 'bar_m': None if bar is None else round(bar),
            'label': label, 'cloud': round(cloud, 3), 'foam': foam, 'shore': shore, 'ok': ok}, cloud


def picture(s, a):
    """The strip as seen, sea up, a bit brighter, foam it counted in red along the top."""
    rgb = np.stack([s['red'], s['green'], s['blue']], -1)
    img = (np.clip(rgb / 0.25, 0, 1) ** 0.6 * 255).astype(np.uint8)
    im = Image.fromarray(img).resize((img.shape[1] * 3, img.shape[0] * 3), Image.NEAREST)
    if a:
        px = im.load()
        for x in range(img.shape[1]):
            if a['ok'][x] and a['foam'][: a['shore'][x], x].sum() >= 2:
                for dx in range(3):
                    for dy in range(4):
                        px[x * 3 + dx, dy] = (255, 80, 80)
    return im


def main(args):
    days = int(args[args.index('--days') + 1]) if '--days' in args else 5
    img_dir = args[args.index('--img') + 1] if '--img' in args else None
    sp = spots()
    lats, lngs = [s['lat'] for s in sp], [s['lng'] for s in sp]
    bbox = [min(lngs) - 0.03, min(lats) - 0.02, max(lngs) + 0.03, max(lats) + 0.02]
    found = scenes(bbox, days)
    # A day can have two scenes (one orbit, two processings or tiles), each
    # maybe only part-covering the coast: per spot, the clearest that covers it.
    by_day = {}
    for f in found:
        by_day.setdefault(f['properties']['datetime'][:10], []).append(f)
    results = []
    for day, items in sorted(by_day.items(), reverse=True):
        items.sort(key=lambda f: f['properties'].get('eo:cloud_cover', 100))
        read = []
        for item in items:
            try:
                read.append((item, *read_scene(item, bbox)))
            except Exception as e:
                print(day, item['id'], 'unreadable:', e)
        if not read:
            continue
        t = read[0][0]['properties']['datetime'][:16]
        cams, imgs, used = {}, {}, set()
        for spot in sp:
            a = why = None
            for item, bands, meta in read:
                f = facing(spot, bands, meta)
                s, ns = strip(spot, bands, meta, f)
                a, cloud = analyse(s, ns)
                if cloud is None:
                    why = 'not covered'; a = None; continue
                if cloud > MAX_CLOUD:
                    why = f'cloudy ({cloud:.0%})'; a = None; continue
                if a is None:
                    why = 'no shoreline'; continue
                used.add(item['id']); break
            if a is None:
                print(f"{t} {spot['id']}: {why}")
                continue
            cams[spot['id']] = {k: a[k] for k in ('label', 'cover', 'longest', 'gaps', 'bar_m', 'cloud')} | {'faces': round(f)}
            im = picture(s, a)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=82); imgs[spot['id']] = buf.getvalue()
            if img_dir:
                os.makedirs(img_dir, exist_ok=True); im.save(os.path.join(img_dir, f"{day}-{spot['id']}.jpg"), quality=85)
            print(t, spot['id'], json.dumps(cams[spot['id']]), flush=True)
        if cams:
            results.append({'t': t, 'scene': ','.join(sorted(used)), 'cams': cams, 'img': imgs})
    if '--out' in args:
        out = args[args.index('--out') + 1]
        if os.path.dirname(out):
            os.makedirs(os.path.dirname(out), exist_ok=True)   # nothing clear to draw: no strips, so maybe no folder yet
        json.dump([{k: v for k, v in r.items() if k != 'img'} for r in results], open(out, 'w'), indent=1)
    if '--post' in args:
        url, key = os.environ['FEEDBACK_URL'].rstrip('/'), os.environ['FEEDBACK_KEY']
        for r in sorted(results, key=lambda r: r['t']):   # oldest first, so the newest image is the one kept
            body = dict(r, img={k: base64.b64encode(v).decode() for k, v in r['img'].items()})
            req = urllib.request.Request(url + '/banks/sat', data=json.dumps(body).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', 'X-Surf-Key': key, 'User-Agent': 'allfield-sat/1.0'})
            print(r['t'], urllib.request.urlopen(req, timeout=60).read().decode()[:200])


if __name__ == '__main__':
    main(sys.argv[1:])
