# Surf cams

Live cams, scores and a 7-day outlook for the Portuguese coast, at
[allfield.online/SURFING](https://allfield.online/SURFING/).

## How it fits together

```
GitHub Pages (this folder)          Cloudflare worker (tools/worker → tools/surf-worker.js)
  index.html  cams, map, viewer       hourly: blend every model for every spot → KV fc:latest
  week.html   7-day outlook           GET /forecast, /skill, /history/status, /obs, /health
     │  read /forecast, /skill        accounts, favourites, sessions (/a/*, /s)
     └─ fall back to Open-Meteo        D1 surf-history: measurements + forecasts by lead day
                                      ▲ POST /skill, /ibi (X-Surf-Key)
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
| `toolbar.js` / `.css` | the bar on every surf page |
| `account.js` / `.css` | accounts, favourites, the account button |
| `cams.css`, `cams-*.js` | the cams page, in load order: `core` (state, conditions), `grid`, `map`, `viewer`, `sessions`, `tune`, `main` (wiring, last) |
| `week.css`, `week.js` | the 7-day page |
| `data/` | public, anonymised: model skill, logged sessions |
| `tools/worker/` | the worker's sources; `build-worker.mjs` bundles them |
| `tools/skill.mjs`, `copernicus.py`, `points.mjs` | the scheduled jobs |
| `tools/test/` | tests |

The browser scripts are plain scripts sharing one scope, loaded in the order
the page lists them; a file may use what an earlier one defines at load time,
and anything later only inside functions it calls afterwards.

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
