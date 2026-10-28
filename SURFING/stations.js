/* Where the forecasts are checked against measurements: the wave buoys
   and tide gauges, all read from EMODnet Physics ERDDAP (open data).
   Plain script like spots.js, shared by the worker (tools/worker/history.js,
   bundled in), tools/skill.mjs and tools/points.mjs (via tools/site.mjs).

     id     short name, used in the history database (buoy:<id>, tide:<id>)
     ds     the ERDDAP dataset
     wind   the buoy has an anemometer (and mean wave direction); the IH
            coastal buoys carry waves and sea temperature only, and ERDDAP
            refuses a request naming a variable the dataset lacks */

const BUOYS = [
  { id: 'nazare', name: 'Nazaré coastal buoy (IH)', ds: 'TS_70_6200199_MO_UND', lat: 39.56, lng: -9.21, wind: true },
  { id: 'sines', name: 'Sines coastal buoy (IH)', ds: 'TS_70_Sines-coast-buoy_MO_UND', lat: 37.9211, lng: -8.9289 },
  { id: 'leixoes', name: 'Leixões coastal buoy (IH)', ds: 'TS_70_Leixoes-coast-buoy_MO_UND', lat: 41.3167, lng: -8.9833 },
  { id: 'faro', name: 'Faro coastal buoy (IH)', ds: 'TS_70_Faro-coast-buoy_MO_UND', lat: 36.9047, lng: -7.8983 },
  { id: 'silleiro', name: 'Cabo Silleiro buoy (Puertos del Estado)', ds: 'TS_70_6200084_MO_UND', lat: 42.12, lng: -9.43, wind: true },
  { id: 'cadiz', name: 'Golfo de Cádiz buoy (Puertos del Estado)', ds: 'TS_70_6200085_MO_UND', lat: 36.49, lng: -6.96, wind: true },
];
const GAUGES = [
  { id: 'cascais', name: 'Cascais tide gauge', ds: 'TS_70_CascaisTG_TG_UND', lat: 38.6833, lng: -9.4167 },
  { id: 'nazare', name: 'Nazaré tide gauge', ds: 'TS_70_NazareTG_TG_UND', lat: 39.586, lng: -9.074 },
  { id: 'lagos', name: 'Lagos tide gauge', ds: 'TS_70_LagosTG_TG_UND', lat: 37.1, lng: -8.6667 },
  { id: 'leixoes', name: 'Leixões tide gauge', ds: 'TS_70_LeixoesTG_TG_UND', lat: 41.1867, lng: -8.7045 },
];
const ERDDAP = 'https://platform-erddap.emodnet-physics.eu/erddap/tabledap/';
// What to ask a buoy for (see `wind` above).
const buoyVars = (b) => (b.wind ? ['VHM0', 'VTPK', 'VPED', 'VMDR', 'WSPD', 'WDIR', 'TEMP'] : ['VHM0', 'VTPK', 'VPED', 'TEMP']);
// Buoy anemometers sit ~3–4 m up; a log profile over sea puts 10 m ~9% higher.
const BUOY_WIND_10M = 1.09;
