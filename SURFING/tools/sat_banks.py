"""The banks from space: Sentinel-2 (10 m, free, every 2-5 days at ~11:30 UTC).

In near-infrared, water is black and whitewater bright, so the breaking
shows as bands off the beach: bands broken by dark gaps are peaks and
channels, and how far out the outer band sits is where the bar is. Sand is
bright too but warm in colour; wet sand, rock and concrete (groynes) are
white enough to pass for foam, but shortwave infrared (B11) tells them
apart: water swallows it, foam included (SWIR/NIR 0.2-0.5), while they
reflect it (1 and up).

For every spot (cams or not), area by area (each its own window, since
they fall on different tiles), on each clear scene: a strip of
coast 1.4 km long (700 m either side), aligned with the way the beach
faces, from 150 m inland to 700 m out. Per 10 m along the beach: the
shoreline (where the land ends) and the foam seaward of it, in patches;
a patch under 20 m deep (a speck, a whitecap, the swash line) doesn't
count, and stretches of breaking or gaps under 50 m along the beach are
ignored. Then

  cover     share of the strip with breaking (a shorebreak counts)
  longest   longest unbroken stretch of breaking, as a share of the strip
  gaps      channels, on days with breaking along 40% or more: 50 m or
            more with none, or where the outer breaking pulls back to
            under half the bar's distance (a rip, the shorebreak still
            white), with breaking either side
  bar_m     median distance from the shoreline to the outer edge of the
            breaking (grows with the swell: checked over 60 days, r 0.7)
  label     'flat' (cover < 0.15), 'inside only' (bar_m 60 m or less),
            'channels' (1+ channels), 'continuous' (unbroken over 3/4 of
            it), else 'patchy'. Not closeouts: from space a big day is
            white right across, broken waves and all
  cloud     share of the strip under cloud or its shadow (over 10%: skipped)

Scenes from Element 84's Earth Search catalogue (public, no key), read a
window at a time from the cloud-optimised files.

  python SURFING/tools/sat_banks.py [--days 5] [--img DIR] [--out FILE] [--post]

--post sends each scene's readings and each spot's image to the worker
(POST /banks/sat; FEEDBACK_URL, FEEDBACK_KEY). Needs numpy, pillow,
rasterio. surf-sat.yml runs it daily.
"""
import base64, datetime as dt, io, json, math, os, subprocess, sys, time, urllib.error, urllib.request
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from rasterio.warp import transform, transform_bounds
from rasterio.enums import Resampling
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
SURF = os.path.dirname(HERE)
STAC = 'https://earth-search.aws.element84.com/v1/search'
ALONG, BACK, OUT, STEP = 700, 150, 700, 10      # metres
MAX_CLOUD, MAX_BAR = 0.10, 500     # share, metres
RATIO = 0.7          # SWIR / NIR: foam 0.2-0.5, sand, rock and concrete 1 and up
MIN_RUN = 50         # metres along the beach: shorter stretches of breaking (specks) or gaps don't count
BANDS = {'blue': 'B02', 'green': 'B03', 'red': 'B04', 'nir': 'B08'}
os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')


def spots():
    js = ("const fs=require('fs'),vm=require('vm'),c={};vm.createContext(c);"
          f"vm.runInContext(fs.readFileSync({json.dumps(os.path.join(SURF, 'spots.js'))},'utf8')+';this.C=CAMS',c);"
          "console.log(JSON.stringify(c.C.map(x=>({id:x.id,area:x.area,lat:x.lat,lng:x.lng,faces:x.faces}))))")
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
    # Shortwave infrared (20 m): water, foam included, swallows it; sand,
    # wet sand, rock and concrete don't. What tells foam from a groyne.
    with rasterio.open(item['assets']['swir16']['href']) as ds:
        win = from_bounds(*transform_bounds('EPSG:4326', ds.crs, *bbox), ds.transform)
        bands['swir'] = ds.read(1, window=win, out_shape=meta['shape'], resampling=Resampling.bilinear).astype(np.float32) / 10000
    return bands, meta


def strip(spot, bands, meta, faces=None, k=1):
    """The beach's strip in its own frame: rows across the beach (seaward up),
    columns along it, every STEP m (the nearest pixel: what's measured). k > 1:
    every STEP/k m, blended from the four nearest pixels (bilinear), for the
    picture only, so the turned strip has smooth edges, not stair-steps."""
    x0, y0 = transform('EPSG:4326', meta['crs'], [spot['lng']], [spot['lat']])
    x0, y0 = x0[0], y0[0]
    th = math.radians(spot['faces'] if faces is None else faces)
    sea = np.array([math.sin(th), math.cos(th)])         # east, north: seaward
    alg = np.array([sea[1], -sea[0]])                    # along the beach
    ns = np.arange(OUT, -BACK - 1, -STEP / k)            # seaward first
    ss = np.arange(-ALONG, ALONG + 1, STEP / k)
    X = x0 + ns[:, None] * sea[0] + ss[None, :] * alg[0]
    Y = y0 + ns[:, None] * sea[1] + ss[None, :] * alg[1]
    inv = ~meta['transform']
    cols, rows = inv * (X, Y)
    if k > 1:
        rows, cols = rows - 0.5, cols - 0.5                # pixel centres
        r0 = np.clip(np.floor(rows).astype(int), 0, meta['shape'][0] - 2)
        c0 = np.clip(np.floor(cols).astype(int), 0, meta['shape'][1] - 2)
        fr, fc = np.clip(rows - r0, 0, 1), np.clip(cols - c0, 0, 1)
        lerp = lambda v: ((v[r0, c0] * (1 - fc) + v[r0, c0 + 1] * fc) * (1 - fr) + (v[r0 + 1, c0] * (1 - fc) + v[r0 + 1, c0 + 1] * fc) * fr)
        return {b: lerp(bands[b]) for b in ('red', 'green', 'blue')}, ns
    r = np.clip(np.round(rows).astype(int), 0, meta['shape'][0] - 1)
    c = np.clip(np.round(cols).astype(int), 0, meta['shape'][1] - 1)
    return {b: v[r, c] for b, v in bands.items()}, ns


def shoreline(s):
    """Per column, the last land row before the sea (rows run seaward first), and the land mask."""
    b, r, n = s['blue'], s['red'], s['nir']
    warm = (r - b) / np.maximum(r + b, 1e-4)
    ratio = s['swir'] / np.maximum(n, 1e-3)
    land = ((n > 0.12) & (warm > 0.12)) | (s['scl'] == 4) | ((n > 0.05) & (ratio >= RATIO))   # sand (warm, bright), vegetation, and wet sand / rock / concrete (bright in SWIR)
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
    ratio = s['swir'] / np.maximum(n, 1e-3)
    foam = (n > 0.05) & (b > 0.07) & (warm < 0.12) & (ratio < RATIO) & ~land   # whitewater: bright in NIR, white, dark in SWIR
    H, Wd = n.shape
    ok = shore > int(H * 0.25)
    if ok.mean() < 0.6:
        return None, cloud
    # Per column: the foam seaward of the shoreline, in runs (rows). A run
    # under 20 m deep is a speck, a whitecap or the swash line, and doesn't
    # count; any other is breaking (a shorebreak too). outer: how far out the
    # furthest of it reaches.
    outer = np.full(Wd, np.nan)
    brk = np.zeros(Wd, bool)
    for x in range(Wd):
        if not ok[x]:
            continue
        col = foam[: shore[x], x][::-1]                    # from the shore outward
        y, far = 0, 0.0
        while y < len(col):
            if col[y]:
                y0 = y
                while y < len(col) and col[y]:
                    y += 1
                d0, d1 = y0 * STEP, y * STEP                # metres out, inner and outer edge
                if y - y0 >= 2 and d0 <= MAX_BAR:
                    far = max(far, d1)
            y += 1
        if far:
            brk[x], outer[x] = True, far
    xs = np.where(ok)[0]
    br = brk[xs].copy()
    m = MIN_RUN // STEP
    def runs(v):
        out, i = [], 0
        while i < len(v):
            j = i
            while j < len(v) and v[j] == v[i]:
                j += 1
            out.append((bool(v[i]), i, j)); i = j
        return out
    for v, i, j in runs(br):                               # specks of breaking out
        if v and j - i < m:
            br[i:j] = False
    for v, i, j in runs(br):                               # narrow gaps in
        if not v and j - i < m and i > 0 and j < len(br):
            br[i:j] = True
    cover = float(br.mean())
    longest = max([j - i for v, i, j in runs(br) if v] or [0]) / len(xs)
    o = outer[xs]
    bar = float(np.nanmedian(o[br])) if br.any() else None
    # Channels: on a day with real breaking, stretches of 50 m or more where
    # there's none, or where the outer breaking pulls back to under half the
    # bar's distance (a rip through the bar, the shorebreak still white),
    # with breaking either side.
    gaps = 0
    if bar and cover >= 0.4:
        sm = np.array([np.nanmedian(o[max(0, i - 2): i + 3]) if br[max(0, i - 2): i + 3].any() else 0 for i in range(len(o))])
        gap = ~br | (np.nan_to_num(sm) < 0.5 * bar)
        gaps = sum(1 for v, i, j in runs(gap) if v and j - i >= m and i > 0 and j < len(gap))
    label = ('flat' if cover < 0.15 else 'inside only' if bar is not None and bar <= 60 else
             'channels' if gaps >= 1 else 'continuous' if longest >= 0.75 else 'patchy')
    full = np.zeros(Wd, bool); full[xs] = br
    return {'cover': round(cover, 3), 'longest': round(longest, 3), 'gaps': gaps, 'bar_m': None if bar is None else round(bar),
            'label': label, 'cloud': round(cloud, 3), 'brk': full, 'outer': outer, 'shore': shore, 'ok': ok}, cloud


def picture(spot, bands, meta, faces, a, k=6):
    """The strip as seen, sea up, a bit brighter, foam it counted in red along
    the top: sampled every STEP/k m (bilinear), so it's sharp on a phone (the
    panel shows it up to 480 px wide). Still 10 m pixels underneath."""
    s, _ = strip(spot, bands, meta, faces, k)
    rgb = np.stack([s['red'], s['green'], s['blue']], -1)
    im = Image.fromarray((np.clip(rgb / 0.25, 0, 1) ** 0.6 * 255).astype(np.uint8))
    if a:
        d = ImageDraw.Draw(im)
        for x in range(len(a['brk'])):
            if a['brk'][x]:
                d.rectangle([x * k, 0, x * k + k - 1, 7], fill=(255, 80, 80))
    return im


def main(args):
    days = int(args[args.index('--days') + 1]) if '--days' in args else 5
    img_dir = args[args.index('--img') + 1] if '--img' in args else None
    by_area = {}
    for spot in spots():
        by_area.setdefault(spot['area'], []).append(spot)
    results = []
    for area, sp in by_area.items():
        print(f'--- {area}: {len(sp)} spots', flush=True)
        try:
            results += area_readings(sp, days, img_dir)
        except Exception as e:
            print(area, 'failed:', e, flush=True)
    finish(results, args)


def area_readings(sp, days, img_dir):
    """Every clear pass over these spots in the last `days`: [{ t, scene, cams, img }]."""
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
            im = picture(spot, bands, meta, f, a)
            buf = io.BytesIO(); im.save(buf, 'JPEG', quality=82); imgs[spot['id']] = buf.getvalue()
            if img_dir:
                os.makedirs(img_dir, exist_ok=True); im.save(os.path.join(img_dir, f"{day}-{spot['id']}.jpg"), quality=85)
            print(t, spot['id'], json.dumps(cams[spot['id']]), flush=True)
        if cams:
            results.append({'t': t, 'scene': ','.join(sorted(used)), 'cams': cams, 'img': imgs})
    return results


def send(req, tries=6):
    """POST, waiting out the worker's rate guard (429, Retry-After) and
    retrying a dropped connection or a server error, on a long backfill."""
    for i in range(tries):
        try:
            return urllib.request.urlopen(req, timeout=60).read().decode()[:200]
        except urllib.error.HTTPError as e:
            if (e.code != 429 and e.code < 500) or i == tries - 1:
                raise
            time.sleep(int(e.headers.get('Retry-After') or 30) + 2 if e.code == 429 else 10 * (i + 1))
        except (urllib.error.URLError, ConnectionError, TimeoutError):
            if i == tries - 1:
                raise
            time.sleep(10 * (i + 1))


def finish(results, args):
    """--out writes the readings, --post sends them (and the strips) to the worker."""
    if '--out' in args:
        out = args[args.index('--out') + 1]
        if os.path.dirname(out):
            os.makedirs(os.path.dirname(out), exist_ok=True)   # nothing clear to draw: no strips, so maybe no folder yet
        json.dump([{k: v for k, v in r.items() if k != 'img'} for r in results], open(out, 'w'), indent=1)
    if '--post' in args:
        url, key = os.environ['FEEDBACK_URL'].rstrip('/'), os.environ['FEEDBACK_KEY']
        failed = 0
        for r in sorted(results, key=lambda r: r['t']):   # oldest first, so the newest image is the one kept
            body = dict(r, img={k: base64.b64encode(v).decode() for k, v in r['img'].items()})
            req = urllib.request.Request(url + '/banks/sat', data=json.dumps(body).encode(), method='POST',
                                         headers={'Content-Type': 'application/json', 'X-Surf-Key': key, 'User-Agent': 'allfield-sat/1.0'})
            try:
                print(r['t'], send(req))
            except Exception as e:   # one bad post doesn't lose the rest
                print(r['t'], 'not sent:', e)
                failed += 1
        if failed:
            sys.exit(f'{failed} of {len(results)} not sent')


if __name__ == '__main__':
    main(sys.argv[1:])
