"""How the banks are breaking, from the cams (no AI): time-averaged frames.

Averaging a minute of video blurs the moving sea out and leaves white
where waves break again and again (coastal scientists' "timex" image). A
long unbroken white band along the beach is a closeout; white broken by
dark gaps is peaks with channels between; little white, little breaking.

The cams pan round a loop of preset views (~17 s at each, ~2 min a loop),
so each cam is recorded for a few minutes at 1 frame a second, the frames
grouped into the views it stopped on (pans dropped, each view collected
over every pass), and only views looking straight out to sea are used: a
sea band across the whole width with sand below it, the shoreline running
across the view rather than down it. For each, per column
(along the beach): the sea band (horizon to shoreline), and how much of
it is foam in the averaged image. Then:

  cover     share of the beach with breaking
  longest   the longest unbroken stretch of breaking, as a share of the beach
  gaps      channels: breaks in the white wider than 3% of the view
  shore     share of the breaking that's in the shorebreak (the band's
            lowest fifth) rather than out on a bar
  label     'flat' (cover < 0.15), 'shorebreak' (most of it at the shore),
            'closing out' (longest >= 0.6), 'peaky' (2+ gaps and cover
            >= 0.25), else 'mixed'

A cam's reading is its views' together (medians; label by majority).
Spots opt in with `banks: true` in spots.js.

  python SURFING/tools/banks.py [--secs 480] [--img DIR] [--out FILE] [--post]

--post sends { t, cams: { id: reading } } with each cam's clearest view as
a JPEG to the worker (POST /banks; FEEDBACK_URL, FEEDBACK_KEY).
Needs numpy, pillow, imageio-ffmpeg. surf-banks.yml runs it hourly by day.
"""
import base64, io, json, math, os, subprocess, sys, time, urllib.request
import datetime as dt
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageDraw
import imageio_ffmpeg

HERE = os.path.dirname(os.path.abspath(__file__))
SURF = os.path.dirname(HERE)
FF = imageio_ffmpeg.get_ffmpeg_exe()
W, H = 480, 270          # analysis frame size
S = 2                    # the picture is kept at S x that (960x540: sharp on a phone; MEO streams are 1080p)
TW, TH = 96, 54          # thumbnails for telling views apart
SAME = 0.9               # correlation for "the same view"
MIN_VIEW_S = 30          # seconds of a view needed for a reading
BREAK = 0.05             # share of a column's sea band that's foam for it to count as breaking


def cams():
    js = ("const fs=require('fs'),vm=require('vm'),c={};vm.createContext(c);"
          f"vm.runInContext(fs.readFileSync({json.dumps(os.path.join(SURF, 'spots.js'))},'utf8')+';this.C=CAMS',c);"
          "console.log(JSON.stringify(c.C.filter(x=>x.banks&&x.type==='hls').map(x=>({id:x.id,url:x.embed,lat:x.lat,lng:x.lng}))))")
    return json.loads(subprocess.run(['node', '-e', js], capture_output=True, text=True, check=True).stdout)


def sun_up(lat, lng, when=None):
    """Sun more than 5 degrees up (good enough for 'is there light')."""
    t = when or dt.datetime.now(dt.timezone.utc)
    n = t.timetuple().tm_yday
    decl = math.radians(23.44) * math.sin(math.radians(360 / 365 * (n - 81)))
    ha = math.radians(15 * (t.hour + t.minute / 60 + lng / 15 - 12))
    alt = math.asin(math.sin(math.radians(lat)) * math.sin(decl) + math.cos(math.radians(lat)) * math.cos(decl) * math.cos(ha))
    return math.degrees(alt) > 5


def corr(a, b):
    a, b = a - a.mean(), b - b.mean()
    return float((a * b).sum() / math.sqrt((a * a).sum() * (b * b).sum() + 1e-9))


def record(url, secs):
    """The stopped views in `secs` of a cam: [{ frames, sum (H, W, 3), hi (H*S, W*S, 3), thumb }].
    Frames come in at S x the analysis size; the analysis reads them shrunk
    (S x S averaged), the picture keeps them whole."""
    p = subprocess.Popen([FF, '-loglevel', 'error', '-i', url, '-t', str(secs), '-vf', f'fps=1,scale={W * S}:{H * S}',
                          '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], stdout=subprocess.PIPE)
    views, run = [], None
    def close(r):
        if not r or r['n'] < 5:   # a pan, or a glimpse
            return
        th = r['thumbs'] / r['n']
        v = next((v for v in views if corr(v['thumb'], th) > SAME), None)
        if v is None:
            views.append({'frames': 0, 'sum': np.zeros((H, W, 3), np.float64), 'hi': np.zeros((H * S, W * S, 3), np.float32), 'thumb': th})
            v = views[-1]
        v['frames'] += r['n']; v['sum'] += r['sum']; v['hi'] += r['hi']
    while True:
        n = W * S * H * S * 3
        buf = p.stdout.read(n)
        if len(buf) < n:
            break
        hi = np.frombuffer(buf, np.uint8).reshape(H * S, W * S, 3)
        f = hi.reshape(H, S, W, S, 3).mean((1, 3))
        th = np.asarray(Image.fromarray(f.mean(2).astype(np.uint8)).resize((TW, TH), Image.BILINEAR), np.float64)
        if run is None or corr(run['first'], th) < SAME:
            close(run)
            run = {'first': th, 'n': 0, 'sum': np.zeros((H, W, 3), np.float64), 'hi': np.zeros((H * S, W * S, 3), np.float32), 'thumbs': np.zeros((TH, TW))}
        run['n'] += 1; run['sum'] += f; run['hi'] += hi; run['thumbs'] += th
    close(run)
    p.wait()
    return views


def analyse(timex):
    """One averaged view: its sea band and breaking, or None if it doesn't look straight out to sea."""
    img = timex / 255.0
    r, g, b = img[..., 0], img[..., 1], img[..., 2]
    v = img.max(2)
    s = (v - img.min(2)) / np.maximum(v, 1e-6)
    sand = (r - b > 0.08) & (v > 0.35)
    # Per column, from the bottom: the shoreline is where the sand ends.
    shore = np.full(W, -1)
    for x in range(W):
        col = sand[:, x]
        y = H - 1
        while y > H * 0.3 and not col[y]:   # anything in front of the sand (fences, posts, people)
            y -= 1
        while y > H * 0.3 and col[y]:
            y -= 1
        shore[x] = y if y > H * 0.3 else -1
    # The horizon: the strongest change in brightness between rows, in the
    # stretch above the sea (rows as medians, so the cam's logo box and
    # posts don't count).
    rows = np.median(v, axis=1)
    rows = np.convolve(rows, np.ones(3) / 3, mode='same')
    top = int(np.median(shore[shore > 0])) if (shore > 0).any() else -1
    if top < H * 0.4:
        return None
    lo = max(int(H * 0.2), top - int(H * 0.55))
    grad = np.abs(np.diff(rows[lo: top - int(H * 0.06)]))
    horizon = int(np.argmax(grad)) + lo + 3 if len(grad) > 5 else -1
    good = (shore > 0) & (shore - horizon > H * 0.08)
    if horizon < 0 or good.mean() < 0.7:
        return None
    # Looking out to sea, not along the beach: the shoreline runs across the
    # view, not down it (along the beach, breaking bunches up and can't be judged).
    sy = shore[good]
    if np.percentile(sy, 90) - np.percentile(sy, 10) > H * 0.15:
        return None
    # Foam: whiter and brighter than the open water just inside the horizon.
    band_px = [(horizon + 2, shore[x], x) for x in range(W) if good[x]]
    outer = np.concatenate([v[y0: y0 + max(2, (y1 - y0) // 5), x] for y0, y1, x in band_px])
    outer_s = np.concatenate([s[y0: y0 + max(2, (y1 - y0) // 5), x] for y0, y1, x in band_px])
    v0, s0 = float(np.median(outer)), float(np.median(outer_s))
    foam = (v > v0 + 0.12) & (s < max(0.12, s0 * 0.6))
    frac = np.zeros(W); shore_part = np.zeros(W)
    for y0, y1, x in band_px:
        col = foam[y0:y1, x]
        frac[x] = col.mean()
        lo = col[int(len(col) * 0.8):]
        shore_part[x] = lo.sum() / max(col.sum(), 1)
    xs = np.where(good)[0]
    breaking = frac[xs] > BREAK
    cover = float(breaking.mean())
    # Runs of breaking and of gaps along the beach (gaps narrower than 3% don't count).
    runs, cur, val = [], 0, breaking[0]
    for b_ in breaking:
        if b_ == val: cur += 1
        else: runs.append((val, cur)); val, cur = b_, 1
    runs.append((val, cur))
    min_gap = max(3, int(len(xs) * 0.03))
    merged = []
    for val, n in runs:
        if not val and n < min_gap and merged and merged[-1][0]:
            merged[-1] = (True, merged[-1][1] + n)
        elif merged and merged[-1][0] == val:
            merged[-1] = (val, merged[-1][1] + n)
        else:
            merged.append((val, n))
    longest = max([n for val, n in merged if val] or [0]) / len(xs)
    inner = merged[1:-1] if len(merged) > 2 else []
    gaps = sum(1 for val, n in inner if not val)
    shore_share = float(np.average(shore_part[xs][breaking], weights=frac[xs][breaking])) if breaking.any() else 0.0
    label = ('flat' if cover < 0.15 else 'shorebreak' if shore_share >= 0.6 else
             'closing out' if longest >= 0.6 else 'peaky' if gaps >= 2 and cover >= 0.25 else 'mixed')
    return {'cover': round(cover, 3), 'longest': round(longest, 3), 'gaps': gaps, 'shore': round(shore_share, 3), 'label': label,
            'horizon': horizon, 'shoreline': int(np.median(shore[good])), 'width': round(good.mean(), 3),
            'frac': frac, 'shore_y': shore, 'good': good, 'foam': foam}


def reading(cam, secs):
    t0 = time.time()
    views = record(cam['url'], secs)
    out = []
    for i, vw in enumerate(sorted(views, key=lambda v: -v['frames'])):
        if vw['frames'] < MIN_VIEW_S:
            continue
        timex = vw['sum'] / vw['frames']
        a = analyse(timex)
        if a:
            out.append((vw['frames'], vw['hi'] / vw['frames'], a))
    res = {'secs': round(time.time() - t0), 'views_seen': len(views), 'views': len(out)}
    if not out:
        return res, None
    med = lambda k: round(float(np.median([a[k] for _, _, a in out])), 3)
    labels = [a['label'] for _, _, a in out]
    res.update(cover=med('cover'), longest=med('longest'), gaps=int(np.median([a['gaps'] for _, _, a in out])), shore=med('shore'),
               label=max(set(labels), key=labels.count), each=[{k: a[k] for k in ('label', 'cover', 'longest', 'gaps', 'shore')} | {'secs': n} for n, _, a in out])
    if os.environ.get('BANKS_VIEWS'):
        for i, (n, timex, a) in enumerate(out):
            marked(timex, a).save(os.path.join(os.environ['BANKS_VIEWS'], f"{cam['id']}-{i}-{a['label'].replace(' ', '')}.jpg"), quality=85)
    # The clearest view (the most seconds of it).
    n, timex, a = out[0]
    return res, marked(timex, a)


def marked(timex, a):
    """The averaged view (at S x the analysis size) with its sea band (white:
    horizon, sand: shoreline) and, along the bottom, where it's breaking (red)."""
    im = Image.fromarray(timex.clip(0, 255).astype(np.uint8)).convert('RGB')
    d = ImageDraw.Draw(im)
    for x in range(W):
        if a['good'][x]:
            X = x * S
            d.rectangle([X, a['horizon'] * S, X + S - 1, a['horizon'] * S + S - 1], fill=(255, 255, 255))
            y = int(a['shore_y'][x]) * S
            d.rectangle([X, y, X + S - 1, y + S - 1], fill=(255, 210, 120))
            if a['frac'][x] > BREAK:
                d.rectangle([X, (H - 6) * S, X + S - 1, H * S - 1], fill=(255, 80, 80))
    return im


def main(args):
    secs = int(args[args.index('--secs') + 1]) if '--secs' in args else 480
    img_dir = args[args.index('--img') + 1] if '--img' in args else None
    now = dt.datetime.now(dt.timezone.utc)
    todo = [c for c in cams() if sun_up(c['lat'], c['lng'], now)]
    if not todo:
        print('dark: nothing to read'); return
    out, imgs = {}, {}
    with ThreadPoolExecutor(len(todo)) as ex:
        for c, (res, im) in zip(todo, ex.map(lambda c: reading(c, secs), todo)):
            out[c['id']] = res
            print(c['id'], json.dumps({k: v for k, v in res.items() if k != 'each'}), flush=True)
            if im is not None:
                buf = io.BytesIO(); im.save(buf, 'JPEG', quality=80); imgs[c['id']] = buf.getvalue()
                if img_dir:
                    os.makedirs(img_dir, exist_ok=True); im.save(os.path.join(img_dir, c['id'] + '.jpg'), quality=85)
    payload = {'t': now.strftime('%Y-%m-%dT%H:%M'), 'cams': out}
    if '--out' in args:
        json.dump(payload, open(args[args.index('--out') + 1], 'w'), indent=1)
    if '--post' in args:
        url, key = os.environ['FEEDBACK_URL'].rstrip('/'), os.environ['FEEDBACK_KEY']
        payload['img'] = {k: base64.b64encode(v).decode() for k, v in imgs.items()}
        req = urllib.request.Request(url + '/banks', data=json.dumps(payload).encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'X-Surf-Key': key, 'User-Agent': 'allfield-banks/1.0'})
        print(urllib.request.urlopen(req, timeout=60).read().decode()[:300])


if __name__ == '__main__':
    main(sys.argv[1:])
