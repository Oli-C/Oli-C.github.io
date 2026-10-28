#!/usr/bin/env node
/* The points tools/copernicus.py samples: each spot's offshore point (the
   one every model is asked for, score.js offshore()) and the wave buoys the
   models are checked against (stations.js).

     node SURFING/tools/points.mjs > points.json */
import { loadSite } from './site.mjs';

const { CAMS, BUOYS, offshore } = loadSite();
const spots = CAMS.map((c) => { const [lat, lng] = offshore(c).map(Number); return { id: c.id, lat, lng }; });
const buoys = BUOYS.map(({ id, lat, lng }) => ({ id, lat, lng }));
process.stdout.write(JSON.stringify({ spots, buoys }, null, 1) + '\n');
