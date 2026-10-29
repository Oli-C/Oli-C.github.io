# Surf cams

Live cams, scores and a 16-day outlook for the Portuguese coast, at
[allfield.online/SURFING](https://allfield.online/SURFING/).

## How it fits together

```
GitHub Pages (this folder)          Cloudflare worker (tools/worker → tools/surf-worker.js)
  index.html     cams, map, viewer    hourly: blend every model for every spot → KV fc:latest,
  week.html      16-day outlook         and the map's wind grid
  insights.html  a spot's trends      GET /forecast, /grid, /skill, /history/*, /obs, /health
  account.html   account, my spots,   accounts, favourites, suggestions, sessions (/a/*, /s)
                 suggest, sessions    D1 surf-history: measurements + forecasts by lead day
     │  read the worker first (every page, every load; the browser keeps it 5 min)
     └─ else this device's recent copy, else Open-Meteo blended here
                                      ▲ POST /skill, /ibi, /grid/swell (X-Surf-Key)
GitHub Actions                       │
  surf-skill    every 3 h: score the models against IPMA stations and buoys,
                train on logged sessions → data/skill.json + POST /skill
  surf-ibi      every 6 h: Copernicus IBI at every spot and buoy → POST /ibi
  worker-bundle on worker/scoring changes: build, test, deploy
```

The pages and the worker score with the **same code**: the worker bundles
`spots.js`, `stations.js` and `score.js`, and the Node tools load them through
`tools/site.mjs`. A spot's forecast is built once, in `blendSpot()` (score.js),
whoever builds it.

## Files

| | |
|---|---|
| `spots.js` | the spots and their local knowledge |
| `stations.js` | the buoys and tide gauges the models are checked against |
| `score.js` | models, blending, scoring, light, tides — shared by everything |
| `geo.js` | per-spot exposure from coastline geometry (`tools/exposure.mjs`) |
| `coast.js` | land polygons the map's swell layers stop at, from the OSM coastline (`tools/coast.mjs`; run by hand if the grids' area changes) |
| `toolbar.js` / `.css` | the bar on every surf page |
| `account.js` / `.css` | accounts, favourites, the toolbar's account link |
| `account.html`, `account-page.js` | the account page: sign in, my spots (in order), suggest a spot (`/a/suggest`; Oli reads them at `GET /suggestions`), my sessions (`GET /s/mine`) |
| `cams.css`, `cams-*.js` | the cams page, in load order: `core` (state, conditions), `grid`, `map`, `viewer`, `sessions`, `tune`, `main` (wiring, last) |
| `week.css`, `week.js` | the 16-day page: day cards, or a compact table of day scores |
| `insights.html` / `.css` / `.js` | a spot's history beside its logged sessions: trends, what it likes, what the forecast has learned |
| `data/` | public, anonymised: model skill, logged sessions |
| `tools/worker/` | the worker's sources; `build-worker.mjs` bundles them |
| `tools/skill.mjs`, `copernicus.py`, `points.mjs` | the scheduled jobs |
| `tools/test/` | tests |

The browser scripts are plain scripts sharing one scope, loaded in the order
the page lists them; a file may use what an earlier one defines at load time,
and anything later only inside functions it calls afterwards.

## History

The worker keeps, in D1 (`surf-history`), from 26 Oct 2026 on:

- `spot_day`: every spot's finished days summed up (score, best part of the day,
  size, swell and second swell, wind, surface, tides, light, and the build that
  scored it): `GET /history/spot?id=&from=&to=`
- `spot_hour`: the conditions behind them, hour by hour and raw, so a later
  scoring can be rerun over them: `GET /history/spot/hours?id=&date=`
- `obs`: what the IPMA stations, buoys and tide gauges measured; `fc`: every
  wave model's forecast at the buoys by days ahead (`GET /skill/waves`)

## Tests

```
node SURFING/tools/build-worker.mjs
node --test SURFING/tools/test/*.test.mjs
```

No dependencies. The scoring (including a pinned table: change it in the same
commit as a deliberate scoring change) and the worker against an in-memory KV
and a faked network. The worker workflow runs them and deploys nothing if
they fail.

## Secrets

Cloudflare: `EXPORT_KEY` (Secrets Store), bindings `FEEDBACK` (KV), `DB` (D1),
`RL_*` (rate limits). GitHub Actions: `FEEDBACK_URL`, `FEEDBACK_KEY`,
`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`,
`COPERNICUSMARINE_SERVICE_USERNAME` / `_PASSWORD`. None are in this repo.
