"""Tides from tide tables, not a model: harmonic constants fitted to each
tide gauge's own record, then predicted ahead. The worker uses the
predictions for every spot's tide (its nearest gauge) in place of the ocean
model's sea level. See stations.js for the gauges.

  python SURFING/tools/tides.py fit       a year of each gauge's readings
                                          (EMODnet ERDDAP, slow: ~20 s a
                                          month a gauge) -> SURFING/data/tide-fit.json
                                          Run by hand, about once a year.
  python SURFING/tools/tides.py predict   hourly heights from the fit, two
                                          days back to 400 ahead ->
                                          SURFING/data/tides.json
                                          Monthly, by .github/workflows/surf-tides.yml.
  python SURFING/tools/tides.py history FROM TO OUT
                                          hourly heights for past dates (UTC), for
                                          tools/backfill.mjs; same shape as tides.json
  python SURFING/tools/tides.py check     the fit against its last month,
                                          held out: how far off, in height
                                          and in the time of high and low.

tides.json: { "built", "start" (UTC hour of the first value), "step": 1,
"gauges": { id: [cm above mean sea level, ...] } } -- whole centimetres,
one an hour.

Needs numpy and utide (pip install numpy utide)."""
import csv
import io
import json
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import utide

try:  # the operating system's certificates, where a network inspects TLS (optional)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, '..', 'data')
FIT = os.path.join(DATA, 'tide-fit.json')
OUT = os.path.join(DATA, 'tides.json')
ERDDAP = 'https://platform-erddap.emodnet-physics.eu/erddap/tabledap/'
UA = {'User-Agent': 'allfield-surf-tides/1 (allfield.online)'}
DAYS_BACK, DAYS_AHEAD = 2, 400
HOLD_OUT = 30          # days at the end of the record kept back to test the fit
MAX_DT = 15            # minutes: a gauge whose held-out high/low times are worse is left out


def gauges():
    """The gauges from stations.js (id, name, ds, lat)."""
    src = open(os.path.join(HERE, '..', 'stations.js'), encoding='utf-8').read()
    block = src[src.index('const GAUGES'):]
    block = block[:block.index('];')]
    return [dict(re.findall(r"(\w+): '([^']*)'", line)) | {'lat': float(re.search(r'lat: ([-\d.]+)', line).group(1))}
            for line in block.splitlines() if "id: '" in line]


def month_starts(t0, t1):
    t = t0.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while t < t1:
        nxt = (t + timedelta(days=32)).replace(day=1)
        yield max(t, t0), min(nxt, t1)
        t = nxt


def fetch_month(ds, a, b):
    """One month of a gauge's raw readings as CSV text ('' if it can't be had)."""
    q = f"{ERDDAP}{ds}.csv?time,SLEV&time%3E={a:%Y-%m-%dT%H:%M:%SZ}&time%3C{b:%Y-%m-%dT%H:%M:%SZ}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(q, headers=UA), timeout=300) as r:
                return r.read().decode('utf-8')
        except Exception as e:  # slow or briefly down: try again
            if attempt == 3:
                print(f'  {ds} {a:%Y-%m}: {e}', file=sys.stderr)
            time.sleep(10 * (attempt + 1))
    return ''


def fetch_hourly(ds, t0, t1):
    """A gauge's readings between t0 and t1, averaged to the hour: {epoch hour: metres}.
    Four months at a time (the server takes ~20 s a month)."""
    months = list(month_starts(t0, t1))
    with ThreadPoolExecutor(4) as pool:
        texts = list(pool.map(lambda ab: fetch_month(ds, *ab), months))
    sums = {}
    for (a, _), text in zip(months, texts):
        n = 0
        for row in list(csv.reader(io.StringIO(text)))[2:]:
            try:
                x = float(row[1])
            except (ValueError, IndexError):
                continue
            if not np.isfinite(x):
                continue
            h = int(datetime.fromisoformat(row[0].replace('Z', '+00:00')).timestamp() // 3600)
            s = sums.setdefault(h, [0.0, 0])
            s[0] += x
            s[1] += 1
            n += 1
        print(f'  {ds} {a:%Y-%m}: {n} readings')
    return {h: s / c for h, (s, c) in sums.items() if c >= 3}


def clean(hours):
    """Drop spikes: readings more than 0.5 m off a running median of their neighbours."""
    hs = sorted(hours)
    v = np.array([hours[h] for h in hs])
    keep = np.ones(len(v), bool)
    for i in range(len(v)):
        lo, hi = max(0, i - 3), min(len(v), i + 4)
        if abs(v[i] - np.median(v[lo:hi])) > 0.5:
            keep[i] = False
    return np.array(hs)[keep], v[keep]


def times(hs):
    """Epoch hours as datetimes, the way utide takes them."""
    return (np.asarray(hs, dtype='int64') * 3600).astype('datetime64[s]')


def solve(hs, v, lat):
    return utide.solve(times(hs), v, lat=lat, method='ols', conf_int='none', trend=False, nodal=True, verbose=False)


def coef_to_json(c):
    def plain(x):
        if isinstance(x, np.ndarray):
            return x.tolist()
        if isinstance(x, (np.floating, np.integer)):
            return x.item()
        if isinstance(x, dict):
            return {k: plain(y) for k, y in x.items()}
        return x
    return {k: plain(c[k]) for k in c}


def coef_from_json(d):
    c = utide.utilities.Bunch()
    for k, x in d.items():
        if isinstance(x, dict):
            c[k] = utide.utilities.Bunch({kk: (np.array(xx) if isinstance(xx, list) else xx) for kk, xx in x.items()})
        else:
            c[k] = np.array(x) if isinstance(x, list) else x
    return c


def predict(coef, t0h, n):
    return utide.reconstruct(times(t0h + np.arange(n)), coef, verbose=False).h


def cmd_fit():
    t1 = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    t0 = t1 - timedelta(days=380)
    out = {'built': f'{t1:%Y-%m-%dT%H:%M}', 'from': f'{t0:%Y-%m-%d}', 'gauges': {}}
    for g in gauges():
        print(g['id'])
        cache = os.path.join(HERE, f".tide-{g['id']}.npy")
        if os.path.exists(cache) and time.time() - os.path.getmtime(cache) < 2 * 86400:   # a re-run the same day
            hs, v = np.load(cache)
            hs = hs.astype(int)
        else:
            hs, v = clean(fetch_hourly(g['ds'], t0, t1))
            np.save(cache, np.vstack([hs, v]))   # for `check`, and re-runs; not committed
        if len(v) < 24 * 200:
            print(f"  {g['id']}: only {len(v)} hours, skipped", file=sys.stderr)
            continue
        # A gauge whose own last month it can't predict (a broken or shifted
        # record) is left out; its spots take the next nearest gauge.
        q = holdout(hs, v, g['lat'])
        print(f"  held-out month: high/low within {q['dt']:.0f} min (median), height RMS {q['rms']:.0f} cm")
        if q['dt'] > MAX_DT:
            print(f"  {g['id']}: left out, its times are off by more than {MAX_DT} min", file=sys.stderr)
            continue
        coef = solve(hs, v, g['lat'])
        out['gauges'][g['id']] = {'check': q, 'hours': int(len(v)), 'mean': float(np.mean(v)), 'coef': coef_to_json(coef)}
        names = [str(n).strip() for n in coef['name']]
        print(f"  {len(v)} hours, M2 amplitude {coef['A'][names.index('M2')]:.2f} m")
    json.dump(out, open(FIT, 'w'), separators=(',', ':'))
    print('wrote', FIT)


def cmd_predict():
    fit = json.load(open(FIT))
    now_h = int(datetime.now(timezone.utc).timestamp() // 3600)
    t0h, n = now_h - DAYS_BACK * 24, (DAYS_BACK + DAYS_AHEAD) * 24
    out = {'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M'), 'fit': fit['built'],
           'start': datetime.fromtimestamp(t0h * 3600, timezone.utc).strftime('%Y-%m-%dT%H:%M'), 'step': 1, 'gauges': {}}
    for gid, g in fit['gauges'].items():
        coef = coef_from_json(g['coef'])
        h = predict(coef, t0h, n) - coef['mean']
        out['gauges'][gid] = [int(round(x * 100)) for x in h]
    json.dump(out, open(OUT, 'w'), separators=(',', ':'))
    print('wrote', OUT, f"{len(out['gauges'])} gauges x {n} hours from {out['start']}")


def cmd_history(start, end, out_path):
    fit = json.load(open(FIT))
    t0h = int(datetime.fromisoformat(start).replace(tzinfo=timezone.utc).timestamp() // 3600)
    t1h = int(datetime.fromisoformat(end).replace(tzinfo=timezone.utc).timestamp() // 3600) + 24
    out = {'built': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M'), 'fit': fit['built'],
           'start': datetime.fromtimestamp(t0h * 3600, timezone.utc).strftime('%Y-%m-%dT%H:%M'), 'step': 1, 'gauges': {}}
    for gid, g in fit['gauges'].items():
        coef = coef_from_json(g['coef'])
        out['gauges'][gid] = [int(round(x * 100)) for x in predict(coef, t0h, t1h - t0h) - coef['mean']]
    json.dump(out, open(out_path, 'w'), separators=(',', ':'))
    print('wrote', out_path, f"{len(out['gauges'])} gauges x {t1h - t0h} hours from {out['start']}")


def extremes(hs, v):
    """High and low waters: hour (fractional, by a parabola through each turning point) and kind."""
    out = []
    for i in range(1, len(v) - 1):
        if hs[i + 1] - hs[i - 1] != 2:
            continue
        hi, lo = v[i] > v[i - 1] and v[i] >= v[i + 1], v[i] < v[i - 1] and v[i] <= v[i + 1]
        if hi or lo:
            den = v[i - 1] - 2 * v[i] + v[i + 1]
            off = 0.5 * (v[i - 1] - v[i + 1]) / den if den else 0
            out.append((hs[i] + off, 'H' if hi else 'L'))
    return out


def holdout(hs, v, lat):
    """Fit without the last month, predict it: height RMS (cm; surge and the
    rest are weather, not tide) and how far off the high and low waters are
    (minutes, median and 90%)."""
    cut = hs.max() - HOLD_OUT * 24
    train, test = hs < cut, hs >= cut
    coef = solve(hs[train], v[train], lat)
    th = hs[test]
    p = predict(coef, int(th[0]), int(th[-1] - th[0] + 1))
    resid = v[test] - p[th - th[0]]
    ob, pr = extremes(th, v[test]), extremes(np.arange(th[0], th[-1] + 1), p)
    dt = []
    for t, k in ob:
        near = [abs(t - u) for u, kk in pr if kk == k and abs(t - u) < 3]
        if near:
            dt.append(min(near) * 60)
    return {'rms': round(float(np.sqrt(np.mean(resid ** 2)) * 100), 1), 'dt': round(float(np.median(dt)), 1) if dt else 999,
            'dt90': round(float(np.percentile(dt, 90)), 1) if dt else 999, 'n': len(dt)}


def cmd_check():
    """Each gauge's held-out month (see holdout)."""
    for g in gauges():
        path = os.path.join(HERE, f".tide-{g['id']}.npy")
        if not os.path.exists(path):
            continue
        hs, v = np.load(path)
        q = holdout(hs.astype(int), v, g['lat'])
        print(f"{g['id']:8s} held-out {HOLD_OUT} d: height RMS {q['rms']:.1f} cm, high/low within {q['dt']:.0f} min (median), {q['dt90']:.0f} min (90%) of {q['n']}")


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'history':
        cmd_history(sys.argv[2], sys.argv[3], sys.argv[4])
    else:
        {'fit': cmd_fit, 'predict': cmd_predict, 'check': cmd_check}[sys.argv[1] if len(sys.argv) > 1 else 'predict']()
