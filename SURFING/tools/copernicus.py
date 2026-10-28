#!/usr/bin/env python3
"""Copernicus Marine's Iberian wave forecast (IBI, 1/36 deg ~ 2.5 km, hourly,
run twice a day) at every spot and buoy, for the surf worker to blend.

The finest wave model there is for this coast: it has the swell split into
its trains (primary and secondary swell, wind sea), unlike most global
models. tools/worker/forecast.js adds it to the blend as one more model,
weighted by its record at the buoys like the rest (tools/skill.mjs).

    node SURFING/tools/points.mjs > points.json
    python SURFING/tools/copernicus.py points.json [--post] [--out ibi.json]

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
import xarray as xr

DATASET = 'cmems_mod_ibi_wav_anfc_0.027deg_PT1H-i'
PUBLIC = ('https://s3.waw3-1.cloudferro.com/mdl-arco-geo-032/arco/IBI_ANALYSISFORECAST_WAV_005_005/'
          'cmems_mod_ibi_wav_anfc_0.027deg_PT1H-i_202411/geoChunked.zarr')
# IBI's names → the blend's (Open-Meteo's), with how many decimals to keep.
VARS = {
    'VHM0': ('wave_height', 2), 'VTPK': ('wave_peak_period', 1), 'VMDR': ('wave_direction', 0), 'VTM02': ('wave_period', 1),
    'VHM0_SW1': ('swell_wave_height', 2), 'VTM01_SW1': ('swell_wave_period', 1), 'VMDR_SW1': ('swell_wave_direction', 0),
    'VHM0_SW2': ('secondary_swell_wave_height', 2), 'VTM01_SW2': ('secondary_swell_wave_period', 1), 'VMDR_SW2': ('secondary_swell_wave_direction', 0),
    'VHM0_WW': ('wind_wave_height', 2),
}
PAST_H, AHEAD_H = 48, 10 * 24
REACH = 3            # cells around a point searched for sea (~8 km)


def open_dataset(t0, t1):
    if os.environ.get('COPERNICUSMARINE_SERVICE_USERNAME'):
        try:
            import copernicusmarine as cm
            ds = cm.open_dataset(dataset_id=DATASET, variables=list(VARS), start_datetime=t0.isoformat(), end_datetime=t1.isoformat(),
                                 minimum_latitude=35.5, maximum_latitude=43.5, minimum_longitude=-11.5, maximum_longitude=-5.5,
                                 service='arco-geo-series')
            return ds, 'copernicusmarine (account)'
        except Exception as e:  # keep going on the public store
            print(f'toolbox unavailable ({e}); reading the public store', file=sys.stderr)
    ds = xr.open_zarr(PUBLIC, consolidated=True, zarr_format=2)[list(VARS)]
    return ds.sel(time=slice(np.datetime64(t0.replace(tzinfo=None)), np.datetime64(t1.replace(tzinfo=None)))), 'public ARCO store'


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


def main():
    args = sys.argv[1:]
    pts = json.load(open(args[0], encoding='utf-8'))
    out_path = args[args.index('--out') + 1] if '--out' in args else None
    now = dt.datetime.now(dt.timezone.utc).replace(minute=0, second=0, microsecond=0)
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
        url, key = os.environ['FEEDBACK_URL'].rstrip('/'), os.environ['FEEDBACK_KEY']
        req = urllib.request.Request(f'{url}/ibi?key={key}', data=body.encode(), method='POST',
                                     headers={'Content-Type': 'application/json', 'User-Agent': 'allfield-surfcams/1.0'})
        with urllib.request.urlopen(req, timeout=120) as r:
            print('worker:', r.read().decode()[:300], file=sys.stderr)


if __name__ == '__main__':
    main()
