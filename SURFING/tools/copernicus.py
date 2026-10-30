#!/usr/bin/env python3
"""Copernicus Marine's Iberian wave forecast (IBI, 1/36 deg ~ 2.5 km, hourly,
run twice a day) at every spot and buoy, for the surf worker to blend.

The finest wave model there is for this coast: it has the swell split into
its trains (primary and secondary swell, wind sea), unlike most global
models. tools/worker/forecast.js adds it to the blend as one more model,
weighted by its record at the buoys like the rest (tools/skill.mjs).

    node SURFING/tools/points.mjs > points.json
    python SURFING/tools/copernicus.py points.json [--post] [--out ibi.json]
    python SURFING/tools/copernicus.py --grid [--post] [--out grid.json]

--grid samples the whole coast the map shows instead (every second cell,
~5.5 km; every 3 hours for 48): wave height, swell direction and peak
period, for the map's swell field and height heat map (POST /grid/swell).

With COPERNICUSMARINE_SERVICE_USERNAME / _PASSWORD set it reads through the
copernicusmarine toolbox with that account; without them, from the same
public ARCO store the toolbox uses. --post sends the result to the worker
(FEEDBACK_URL + /ibi, with FEEDBACK_KEY).

Each point takes the nearest sea cell (the grid's coastal cells can be
land); points close together are read as one window so each block of the
store is fetched once."""
import datetime as dt
import json
import math
import os
import sys
import urllib.request

import numpy as np

try:  # the operating system's certificates, where a network inspects TLS (optional)
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass

import xarray as xr

DATASET = 'cmems_mod_ibi_wav_anfc_0.027deg_PT1H-i'
# The same model run back over past years (a reanalysis); it reaches to a
# few months ago, the analysis-forecast's own archive covers since then.
REANALYSIS = 'cmems_mod_ibi_wav_my_0.027deg_PT1H-i'
PUBLIC = ('https://s3.waw3-1.cloudferro.com/mdl-arco-geo-032/arco/IBI_ANALYSISFORECAST_WAV_005_005/'
          'cmems_mod_ibi_wav_anfc_0.027deg_PT1H-i_202411/geoChunked.zarr')
# IBI's names → the blend's (Open-Meteo's), with how many decimals to keep.
VARS = {
    'VHM0': ('wave_height', 2), 'VTPK': ('wave_peak_period', 1), 'VMDR': ('wave_direction', 0), 'VTM02': ('wave_period', 1),
    'VHM0_SW1': ('swell_wave_height', 2), 'VTM01_SW1': ('swell_wave_period', 1), 'VMDR_SW1': ('swell_wave_direction', 0),
    'VHM0_SW2': ('secondary_swell_wave_height', 2), 'VTM01_SW2': ('secondary_swell_wave_period', 1), 'VMDR_SW2': ('secondary_swell_wave_direction', 0),
    'VHM0_WW': ('wind_wave_height', 2), 'VTM01_WW': ('wind_wave_period', 1), 'VMDR_WW': ('wind_wave_direction', 0),
}
PUBLIC_MAPS = PUBLIC.replace('mdl-arco-geo-032', 'mdl-arco-time-032').replace('geoChunked.zarr', 'timeChunked.zarr')   # chunked by time step: whole maps
PAST_H, AHEAD_H = 48, 10 * 24
# The map's grid: the coast from the Algarve's west coast to Nazaré, out to sea.
GRID_BOX = (36.8, 40.1, -10.3, -8.5)              # lat from, lat to, lng from, lng to
GRID_STEP, GRID_HOURS, GRID_EVERY = 2, 48, 3
GRID_VARS = {'VHM0': ('h', 100), 'VMDR_SW1': ('d', 1), 'VTPK': ('p', 10)}   # stored as whole cm, degrees, tenths of a second
REACH = 3            # cells around a point searched for sea (~8 km)


def open_dataset(t0, t1, dataset=DATASET):
    if os.environ.get('COPERNICUSMARINE_SERVICE_USERNAME'):
        try:
            import copernicusmarine as cm
            ds = cm.open_dataset(dataset_id=dataset, variables=list(VARS), start_datetime=t0.isoformat(), end_datetime=t1.isoformat(),
                                 minimum_latitude=35.5, maximum_latitude=43.5, minimum_longitude=-11.5, maximum_longitude=-5.5,
                                 service='arco-time-series')   # chunked for time series at points
            return ds, 'copernicusmarine (account)'
        except Exception as e:  # keep going on the public store
            print(f'toolbox unavailable ({e}); reading the public store', file=sys.stderr)
    ds = xr.open_zarr(PUBLIC, consolidated=True, zarr_format=2)[list(VARS)]
    return ds.sel(time=slice(np.datetime64(t0.replace(tzinfo=None)), np.datetime64(t1.replace(tzinfo=None)))), 'public ARCO store'


def open_maps(t0, t1):
    """The same model, chunked a whole map per time step (what a grid wants)."""
    box = dict(minimum_latitude=GRID_BOX[0], maximum_latitude=GRID_BOX[1], minimum_longitude=GRID_BOX[2], maximum_longitude=GRID_BOX[3])
    if os.environ.get('COPERNICUSMARINE_SERVICE_USERNAME'):
        try:
            import copernicusmarine as cm
            ds = cm.open_dataset(dataset_id=DATASET, variables=list(GRID_VARS), start_datetime=t0.isoformat(), end_datetime=t1.isoformat(),
                                 service='arco-geo-series', **box)
            return ds, 'copernicusmarine (account)'
        except Exception as e:
            print(f'toolbox unavailable ({e}); reading the public store', file=sys.stderr)
    ds = xr.open_zarr(PUBLIC_MAPS, consolidated=True, zarr_format=2)[list(GRID_VARS)]
    ds = ds.sel(latitude=slice(GRID_BOX[0], GRID_BOX[1]), longitude=slice(GRID_BOX[2], GRID_BOX[3]))
    return ds.sel(time=slice(np.datetime64(t0.replace(tzinfo=None)), np.datetime64(t1.replace(tzinfo=None)))), 'public ARCO store'


def grid(now):
    """The coast as a grid, every 3 hours from now for 48: land cells are null."""
    t0 = now.replace(hour=now.hour - now.hour % GRID_EVERY)
    want = [t0 + dt.timedelta(hours=h) for h in range(0, GRID_HOURS + 1, GRID_EVERY)]
    ds, source = open_maps(t0, want[-1])
    ds = ds.isel(latitude=slice(None, None, GRID_STEP), longitude=slice(None, None, GRID_STEP))
    have = [str(t)[:16] for t in ds['time'].values]
    times = [t.strftime('%Y-%m-%dT%H:%M') for t in want if t.strftime('%Y-%m-%dT%H:%M') in have]
    ds = ds.sel(time=[np.datetime64(t) for t in times]).load()
    lats, lngs = ds['latitude'].values, ds['longitude'].values
    out = {'v': 1, 'source': source, 'dataset': DATASET, 'built': now.isoformat()[:16], 'times': times,
           'lat0': round(float(lats[0]), 4), 'dlat': round(float(lats[1] - lats[0]), 5), 'nlat': len(lats),
           'lng0': round(float(lngs[0]), 4), 'dlng': round(float(lngs[1] - lngs[0]), 5), 'nlng': len(lngs)}
    for v, (name, scale) in GRID_VARS.items():
        a = ds[v].values   # time, lat, lng
        out[name] = [[None if not np.isfinite(x) else int(round(float(x) * scale)) for x in a[t].ravel()] for t in range(len(times))]
    sea = sum(x is not None for x in out['h'][0])
    print(f'{source}: grid {len(lats)}x{len(lngs)} ({sea} sea cells), {len(times)} steps {times[0]} to {times[-1]}', file=sys.stderr)
    return out


def post(path, body):
    url, key = os.environ['FEEDBACK_URL'].rstrip('/'), os.environ['FEEDBACK_KEY']
    req = urllib.request.Request(f'{url}{path}', data=body.encode(), method='POST',
                                 headers={'Content-Type': 'application/json', 'User-Agent': 'allfield-surfcams/1.0', 'X-Surf-Key': key})
    with urllib.request.urlopen(req, timeout=120) as r:
        print('worker:', r.read().decode()[:300], file=sys.stderr)


def clusters(cells, span=20):
    """Group (y, x) cells so each group's window stays small."""
    groups = []
    for i, (y, x) in sorted(enumerate(cells), key=lambda p: p[1]):
        for g in groups:
            ys, xs = [cells[j][0] for j in g] + [y], [cells[j][1] for j in g] + [x]
            if max(ys) - min(ys) <= span and max(xs) - min(xs) <= span:
                g.append(i)
                break
        else:
            groups.append([i])
    return groups


def sample(ds, points):
    """Each point's nearest sea cell (within ~12 km): {id: {cell, km, var: [...]}}."""
    lats, lngs = ds['latitude'].values, ds['longitude'].values
    cells = [(int(np.abs(lats - p['lat']).argmin()), int(np.abs(lngs - p['lng']).argmin())) for p in points]
    out = {}
    for g in clusters(cells):
        y0 = max(0, min(cells[i][0] for i in g) - REACH); y1 = max(cells[i][0] for i in g) + REACH + 1
        x0 = max(0, min(cells[i][1] for i in g) - REACH); x1 = max(cells[i][1] for i in g) + REACH + 1
        win = ds.isel(latitude=slice(y0, y1), longitude=slice(x0, x1)).load()
        sea = np.isfinite(win['VHM0'].values).mean(axis=0) > 0.9
        wl, wg = win['latitude'].values, win['longitude'].values
        for i in g:
            p = points[i]
            best = None
            for yy, xx in zip(*np.nonzero(sea)):
                d = math.hypot((wl[yy] - p['lat']) * 111.2, (wg[xx] - p['lng']) * 111.2 * math.cos(math.radians(p['lat'])))
                if best is None or d < best[0]:
                    best = (d, yy, xx)
            if best is None or best[0] > 12:
                print(f'{p["id"]}: no sea cell within reach', file=sys.stderr)
                continue
            d, yy, xx = best
            rec = {'cell': [round(float(wl[yy]), 4), round(float(wg[xx]), 4)], 'km': round(d, 1)}
            for v, (name, nd) in VARS.items():
                a = win[v].values[:, yy, xx]
                rec[name] = [None if not np.isfinite(x) else (round(float(x), nd) if nd else int(round(float(x)))) for x in a]
            out[p['id']] = rec
    return out


def history(pts, start, end, out_path):
    """The spots' hours from `start` to `end` (UTC dates): the reanalysis while
    it reaches, the analysis-forecast's archive after. For backfill.mjs."""
    import copernicusmarine as cm
    t0 = dt.datetime.fromisoformat(start).replace(tzinfo=dt.timezone.utc)
    t1 = dt.datetime.fromisoformat(end).replace(tzinfo=dt.timezone.utc) + dt.timedelta(hours=23)
    out = {'v': 1, 'from': start, 'to': end, 'times': [], 'parts': [], 'spots': {}}
    # The reanalysis while it reaches. While Copernicus extends it, its
    # newest days are on the time axis but still empty, so it ends at the
    # last hour with any heights; the analysis-forecast's archive from there.
    ds_r, src_r = open_dataset(t0, t1, REANALYSIS)
    times_r = [str(t)[:16] for t in ds_r['time'].values]
    rec_r = sample(ds_r, pts['spots']) if times_r else {}
    h = VARS['VHM0'][0]
    filled = [i for i in range(len(times_r)) if any(r[h][i] is not None for r in rec_r.values())]
    n_r = filled[-1] + 1 if filled else 0
    parts = [(REANALYSIS, times_r[:n_r], {sid: {k: (v[:n_r] if isinstance(v, list) else v) for k, v in r.items()} for sid, r in rec_r.items()}, src_r)] if n_r else []
    last_r = dt.datetime.fromisoformat(times_r[n_r - 1]).replace(tzinfo=dt.timezone.utc) if n_r else t0 - dt.timedelta(hours=1)
    if last_r < t1:
        ds, source = open_dataset(last_r + dt.timedelta(hours=1), t1, DATASET)
        parts.append((DATASET, [str(t)[:16] for t in ds['time'].values], sample(ds, pts['spots']), source))
    for dataset, times, rec, source in parts:
        n0 = len(out['times'])
        out['times'] += times
        out['parts'].append({'dataset': dataset, 'from': times[0] if times else None, 'to': times[-1] if times else None, 'source': source})
        for sid, r in rec.items():
            o = out['spots'].setdefault(sid, {'cell': r['cell'], 'km': r['km']})
            for name, _ in VARS.values():
                o.setdefault(name, [None] * n0)
                o[name] += r[name]
        for o in out['spots'].values():   # a spot missing from a part: nulls there
            for name, _ in VARS.values():
                o.setdefault(name, [])
                o[name] += [None] * (len(out['times']) - len(o[name]))
        print(f'{dataset}: {len(times)} hours {times[0] if times else "-"} to {times[-1] if times else "-"}, {len(rec)} spots', file=sys.stderr)
    open(out_path, 'w', encoding='utf-8').write(json.dumps(out, separators=(',', ':')))
    print('wrote', out_path, file=sys.stderr)


def main():
    args = sys.argv[1:]
    if '--history' in args:
        i = args.index('--history')
        history(json.load(open(args[0], encoding='utf-8')), args[i + 1], args[i + 2], args[args.index('--out') + 1])
        return
    out_path = args[args.index('--out') + 1] if '--out' in args else None
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
    if '--grid' in args:
        body = json.dumps(grid(now), separators=(',', ':'))
        if out_path:
            open(out_path, 'w', encoding='utf-8').write(body)
        if '--post' in args:
            post('/grid/swell', body)
        return
    pts = json.load(open(args[0], encoding='utf-8'))
    t0, t1 = now - dt.timedelta(hours=PAST_H), now + dt.timedelta(hours=AHEAD_H)
    ds, source = open_dataset(t0, t1)
    lats, lngs = ds['latitude'].values, ds['longitude'].values
    times = [str(t)[:16] for t in ds['time'].values]
    if not times:
        sys.exit('no times in that window')

    points = [('spots', p) for p in pts['spots']] + [('buoys', p) for p in pts['buoys']]
    cells = [(int(np.abs(lats - p['lat']).argmin()), int(np.abs(lngs - p['lng']).argmin())) for _, p in points]
    out = {'v': 1, 'source': source, 'dataset': DATASET, 'built': now.isoformat()[:16], 'times': times, 'spots': {}, 'buoys': {}}
    for g in clusters(cells):
        y0 = max(0, min(cells[i][0] for i in g) - REACH); y1 = max(cells[i][0] for i in g) + REACH + 1
        x0 = max(0, min(cells[i][1] for i in g) - REACH); x1 = max(cells[i][1] for i in g) + REACH + 1
        win = ds.isel(latitude=slice(y0, y1), longitude=slice(x0, x1)).load()
        sea = np.isfinite(win['VHM0'].values).mean(axis=0) > 0.9          # cells that are sea nearly all the time
        wl, wg = win['latitude'].values, win['longitude'].values
        for i in g:
            kind, p = points[i]
            best = None
            for yy, xx in zip(*np.nonzero(sea)):
                d = math.hypot((wl[yy] - p['lat']) * 111.2, (wg[xx] - p['lng']) * 111.2 * math.cos(math.radians(p['lat'])))
                if best is None or d < best[0]:
                    best = (d, yy, xx)
            if best is None or best[0] > 12:
                print(f'{kind} {p["id"]}: no sea cell within reach', file=sys.stderr)
                continue
            d, yy, xx = best
            rec = {'cell': [round(float(wl[yy]), 4), round(float(wg[xx]), 4)], 'km': round(d, 1)}
            for v, (name, nd) in VARS.items():
                a = win[v].values[:, yy, xx]
                rec[name] = [None if not np.isfinite(x) else (round(float(x), nd) if nd else int(round(float(x)))) for x in a]
            out[kind][p['id']] = rec
    print(f'{source}: {len(out["spots"])} spots, {len(out["buoys"])} buoys, {len(times)} hours {times[0]} to {times[-1]}', file=sys.stderr)

    body = json.dumps(out, separators=(',', ':'))
    if out_path:
        open(out_path, 'w', encoding='utf-8').write(body)
    if '--post' in args:
        post('/ibi', body)


if __name__ == '__main__':
    main()
