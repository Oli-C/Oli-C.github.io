#!/usr/bin/env node
/* The points tools/copernicus.py samples: each spot's offshore point (the
   one every model is asked for, score.js offshore()) and the wave buoys the
   models are checked against (tools/skill.mjs, tools/worker/history.js).

     node SURFING/tools/points.mjs > points.json */
import fs from 'node:fs';

const read = (u) => fs.readFileSync(new URL(u, import.meta.url), 'utf8');
const { CAMS, offshore } = new Function(read('../spots.js') + read('../score.js') + '; return { CAMS, offshore };')();
const BUOYS = [
  { id: 'nazare', lat: 39.56, lng: -9.21 },
  { id: 'sines', lat: 37.9211, lng: -8.9289 },
  { id: 'leixoes', lat: 41.3167, lng: -8.9833 },
  { id: 'faro', lat: 36.9047, lng: -7.8983 },
  { id: 'silleiro', lat: 42.12, lng: -9.43 },
  { id: 'cadiz', lat: 36.49, lng: -6.96 },
];
const spots = CAMS.map((c) => { const [lat, lng] = offshore(c).map(Number); return { id: c.id, lat, lng }; });
process.stdout.write(JSON.stringify({ spots, buoys: BUOYS }, null, 1) + '\n');
