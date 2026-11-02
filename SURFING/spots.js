/* Spots: the cams and their local knowledge — shared by index.html (live cams) and week.html (16-day outlook).
   Plain script, no modules, so file:// and GitHub Pages both work. */

/* ---------------------------------------------------------------------------
   CAMS — add a new webcam by appending an entry.

     id      url-safe slug, used for deep links (surfing/#guincho-norte)
     name    spot name shown on the card
     town    nearest town / area
     area    the group it's listed under and the filter chip it sits in
     zone    finer locality shown on the card (e.g. "Baleal")
     country
     tags    extra search words (break type, orientation, nicknames…)
     lat/lng the camera's beach — where the pin goes and where directions
             lead. Checked against OpenStreetMap where it names the beach.
     faces   compass bearing the beach looks out to sea (270 = west). Used
             to spot onshore wind and to fetch conditions from a point just
             offshore rather than on the sand.
     best    local knowledge, used by the score:
               swell   [from, to] compass window the spot likes swell from
               size    [min, max] metres of swell it works in
               period  seconds — the period it starts to get good at
               exposure 0–1: how much of a swell from OUTSIDE the window
                         still reaches the beach (open beach ~0.85,
                         tucked-away south-facer ~0.45). Default 0.85.
               gain    multiplier on swell height at the beach (Nazaré's
                         canyon: 1.4). Default 1.
               wind    [from, to] compass window of offshore wind
               tide    { range: [lo, hi] of the tide the spot likes, where
                         0 = today's low water and 1 = high water;
                         dir: 'rising' | 'falling' | null; text: shown }
               notes   a sentence or two for the viewer
     type    'hls'   — a raw HLS stream (.m3u8) played in our own player
                       (Plyr; Safari plays HLS natively, other browsers load
                       hls.js), shown 16:9. Tiles in the grid also play it.
             'video' — a player-only embed (YouTube live, official cam embed),
                       shown 16:9
             'page'  — a full web page in a frame (no player-only embed
                       available), shown tall
             'none'  — no camera (yet): left out of the Cams grid, but on
                       the map, in Best right now and the 16-day outlook, with
                       its score and session logging; its viewer points to
                       the nearest cams. Leave out embed, link and source.
     embed   the .m3u8 URL for 'hls', otherwise the URL loaded in the iframe
     poster  optional still shown before an 'hls' stream starts
     fallback optional page URL framed instead if an 'hls' stream won't play
     link    the cam's own page, for the "open on source" button
     source  who runs / hosts the cam
     thumb   optional preview image (also the tile's backdrop until it plays)
     viewLabel  what the cam above looks at, when the spot has more views
     views   more cams at the same spot: [{ key, label, type, embed, alt?,
             thumb?, poster? }]. Each gets its own tile on the Cams page
             (id '<spot>~<key>', named '<spot> · <label>'), sharing the spot's
             forecast; the viewer switches between them. Nowhere else (map,
             16-day, sessions) sees them: they're CAM_VIEWS, not CAMS.
     banks   true: read how its banks are breaking from the cam, hourly by day
             (tools/banks.py: time-averaged frames, no AI)

   Areas are listed in the order they first appear here, so keep the array
   roughly north → south.
--------------------------------------------------------------------------- */

// Shared local knowledge for the Caparica jetty beaches.
const CAPARICA = {
  swell: [240, 320], size: [0.6, 2.0], period: 9, exposure: 0.8, wind: [30, 120], tide: { range: [0, 1], dir: 'rising', text: 'all tides, best on the push' },
  notes: 'Jetty-sheltered beach breaks with gentle banks, the surf-school stretch south of Lisbon. Takes most W/NW swell and works on every tide, best as it rises; above ~2 m it starts to wall up. E/NE wind cleans it; the summer nortada blows it side-on.',
};

// Praia do Norte's local knowledge, kept separate so another cam on the
// same beach can share it.
const NAZARE = {
  swell: [260, 330], size: [0.6, 2.5], period: 9, exposure: 0.9, gain: 1.4, wind: [60, 150], tide: { range: [0.2, 0.8], dir: null, text: 'mid' },
  notes: 'The big-wave beach, the Nazaré Canyon focuses any W–NW swell into something far heavier than the numbers suggest. For paddling it’s a powerful, shifty beach break that’s best small (under ~2 m), mid tide, with an E/SE wind; above that it’s tow-in country and the rips are serious. Experienced surfers only. Praia da Vila, round the headland, is the gentler option.',
};
const CAMS = [
  {
    id:      'nazare-norte',
    name:    'Praia do Norte',
    town:    'Nazaré', area: 'Nazaré', zone: 'Praia do Norte',
    country: 'Portugal',
    tags:    ['beach break', 'big wave', 'canyon', 'heavy'],
    lat: 39.6080, lng: -9.0856, faces: 290,   // OSM coastline, the beach north of the fort
    best: NAZARE,
    type:    'hls',
    embed:   'https://deliverys5.quanteec.com/contents/encodings/live/528309e0-caee-4b99-3933-3530-6d61-63-b69a-caa00a3177f6d/master.m3u8',
    poster:  'https://deliverys5.quanteec.com/contents/encodings/live/528309e0-caee-4b99-3933-3530-6d61-63-b69a-caa00a3177f6d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/100/Nazare-Praia-do-Norte',
    link:    'https://gosurf.fr/webcam/fr/100/Nazare-Praia-do-Norte',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCnazareparadonorte_1_1.stream/media.jpg',
  },
  {
    id:      'peniche-lagide',
    name:    'Praia do Lagide',
    town:    'Peniche', area: 'Peniche', zone: 'Baleal',
    country: 'Portugal',
    tags:    ['reef break', 'left', 'baleal'],
    lat: 39.3734, lng: -9.3367, faces: 320,   // OSM coastline, north side of the Baleal isthmus
    best: {
      swell: [270, 350], size: [0.6, 3.0], period: 9, exposure: 0.6, wind: [120, 200], tide: { range: [0.3, 0.8], dir: 'rising', text: 'mid, on the rise' },
      notes: 'Long, mellow left over flat reef on the north side of Baleal. Likes W–NW swell with a S/SE wind; rocks and urchins show at low tide, so mid tide on the push is the call. Handles size when the beaches max out. Busy, and the bodyboarders have priority on the inside.',
    },
    type:    'hls',
    embed:   'https://deliverys5.quanteec.com/contents/encodings/live/d2d6a6b5-eeee-4850-3134-3530-6d61-63-8b84-8bfc9f91f211d/master.m3u8',
    poster:  'https://deliverys5.quanteec.com/contents/encodings/live/d2d6a6b5-eeee-4850-3134-3530-6d61-63-8b84-8bfc9f91f211d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/102/Peniche-Praia-do-Lagide',
    link:    'https://gosurf.fr/webcam/fr/102/Peniche-Praia-do-Lagide',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BClagide_1_1.stream/media.jpg',
  },
  {
    id:      'peniche-supertubos',
    name:    'Supertubos',
    town:    'Peniche', area: 'Peniche', zone: 'Peniche south',
    country: 'Portugal',
    tags:    ['beach break', 'barrels', 'wsl'],
    lat: 39.3483, lng: -9.3660, faces: 250,   // OSM coastline at the end of Estrada da Supertubos
    best: {
      swell: [210, 290], size: [1.0, 3.0], period: 10, exposure: 0.7, wind: [20, 100], tide: { range: [0.4, 1], dir: null, text: 'mid to high' },
      notes: 'Heavy, hollow beach break, the "European Pipeline" and the WSL contest site. Wants SW–W swell from head high to double overhead with a NE/E wind, mid to high tide; bigger than that it closes out. Advanced only, and crowded. Sept–Nov is prime.',
    },
    type:    'hls',
    embed:   'https://ds1-cache.quanteec.com/contents/encodings/live/d0b0b725-f0cd-4ac6-3234-3530-6d61-63-9da6-3f3819b83f9ad/master.m3u8',
    poster:  'https://ds1-cache.quanteec.com/contents/encodings/live/d0b0b725-f0cd-4ac6-3234-3530-6d61-63-9da6-3f3819b83f9ad/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/103/Peniche-Praia-do-Supertubos',
    link:    'https://gosurf.fr/webcam/fr/103/Peniche-Praia-do-Supertubos',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCsupertubos_1_1.stream/media.jpg',
  },
  {
    id:      'praia-das-macas',
    name:    'Praia das Maçãs',
    town:    'Colares', area: 'Sintra', zone: 'Praia das Maçãs',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'sintra', 'colares'],
    lat: 38.8262, lng: -9.469, faces: 285,   // OSM: Praia das Maçãs
    best: {
      swell: [260, 340], size: [0.6, 2.5], period: 9, wind: [40, 130], tide: { range: [0.3, 0.9], dir: null, text: 'mid' },
      notes: 'Village beach break north of Praia Grande, with banks shaped by the stream at its mouth; picks up W–NW swell well, cleaned by an E wind and blown out early by the nortada. Mid tide is usually best.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/praiadasmacas/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
  },
  {
    id:      'praia-grande-norte',
    name:    'Praia Grande Norte',
    town:    'Sintra', area: 'Sintra', zone: 'Praia Grande',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'bodyboard', 'colares'],
    lat: 38.8185, lng: -9.4752, faces: 260,   // OSM coastline, north end below Praia Pequena
    best: {
      swell: [260, 330], size: [0.6, 2.5], period: 9, wind: [40, 130], tide: { range: [0.4, 1], dir: 'rising', text: 'mid to high' },
      notes: 'The open northern half of Praia Grande, wider, sandier banks and a bit more exposed than the south end, so it picks up the most swell and is first to blow out in a nortada. Same recipe: W–NW swell, E/NE wind, mid to high tide as the shorebreak at low is heavy. Lots of room when the south end is crowded; strong rips when it’s big.',
    },
    type:    'hls',
    embed:   'https://ds2-cache.quanteec.com/contents/encodings/live/97f4c14c-c861-44cf-3634-3530-6d61-63-8d1d-f07b2cd93deed/master.m3u8',
    poster:  'https://ds2-cache.quanteec.com/contents/encodings/live/97f4c14c-c861-44cf-3634-3530-6d61-63-8d1d-f07b2cd93deed/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/113/Sintra-Praia-Grande-Norte',
    link:    'https://gosurf.fr/webcam/fr/113/Sintra-Praia-Grande-Norte',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCpraiagrande_1_1.stream/media.jpg',
    viewLabel: 'Praia Grande Norte',
    views:   [{ key: 'pequena', label: 'Praia Pequena', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/bcpraiapequena/playlist.m3u8' }],   // MEO's partner feeds
  },
  {
    id:      'praia-grande-sul',
    name:    'Praia Grande Sul',
    town:    'Sintra', area: 'Sintra', zone: 'Praia Grande',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'bodyboard', 'colares'],
    lat: 38.8121, lng: -9.4789, faces: 255,   // OSM: Praia Grande do Rodízio, south end
    best: {
      swell: [260, 330], size: [0.6, 2.5], period: 9, wind: [40, 130], tide: { range: [0.4, 1], dir: 'rising', text: 'mid to high' },
      notes: 'Sintra’s long, open beach break, consistent, punchy and a bodyboarding stronghold. The south end has the best-shaped banks and a rock ledge for shelter. Takes W–NW swell with an E/NE wind; low tide is a heavy shorebreak, so mid to high on the push is the call. Rips when it’s big; the nortada blows it out in summer afternoons.',
    },
    type:    'hls',
    embed:   'https://ds1-cache.quanteec.com/contents/encodings/live/f05e1d93-57cf-4e07-3734-3530-6d61-63-8b8c-a57a96c1fc1ed/master.m3u8',
    poster:  'https://ds1-cache.quanteec.com/contents/encodings/live/f05e1d93-57cf-4e07-3734-3530-6d61-63-8b8c-a57a96c1fc1ed/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/114/Sintra-Praya-Grande-Sul',
    link:    'https://gosurf.fr/webcam/fr/114/Sintra-Praya-Grande-Sul',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCpraiagrande2_1_1.stream/media.jpg',
  },
  {
    id:      'adraga',
    name:    'Adraga',
    town:    'Almoçageme', area: 'Sintra', zone: 'Praia da Adraga',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'sintra', 'rocks'],
    lat: 38.8037, lng: -9.4848, faces: 265,   // OSM: Praia da Adraga
    best: {
      swell: [250, 330], size: [0.6, 2.2], period: 9, wind: [40, 120], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'Cliff-backed cove south of Praia Grande, peaks off sand between rocks; shelters a little from N wind under the cliffs. Low to mid tide; the rocks show at low, so watch them.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/bcadraga/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
    swanLike: 'praia-grande-sul',   // its SWAN table until a SWAN run includes it
  },
  {
    id:      'guincho-norte',
    name:    'Guincho Norte',
    town:    'Cascais', area: 'Cascais', zone: 'Guincho',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'sintra-cascais'],
    lat: 38.7370, lng: -9.4726, faces: 270,   // OSM coastline, north end (beach centre 38.7337, -9.4728)
    best: {
      swell: [270, 340], size: [0.6, 2.4], period: 9, wind: [60, 130], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'Exposed beach break that catches every swell going, NW is best, with an E wind. The summer nortada (N wind) blows it side-shore by late morning, so go early. Low to mid tide works best; strong currents when it gets big. The north end is the more open, punchier bank.',
    },
    type:    'hls',
    embed:   'https://ds2-cache.quanteec.com/contents/encodings/live/61f5d898-0c04-4515-3934-3530-6d61-63-87e5-3432badee226d/master.m3u8',
    poster:  'https://ds2-cache.quanteec.com/contents/encodings/live/61f5d898-0c04-4515-3934-3530-6d61-63-87e5-3432badee226d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/116/Cascais-Praia-Do-Guincho-Norte',
    link:    'https://gosurf.fr/webcam/fr/116/Cascais-Praia-Do-Guincho-Norte',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCpraiaguinchosul_1_1.stream/media.jpg',
  },
  {
    // GoSurf's Sul page plays the stream viewsurf names "guinchonorte" (and
    // the Norte page plays "guinchosul") — check which way round is right.
    id:      'guincho-sul',
    name:    'Guincho Sul',
    town:    'Cascais', area: 'Cascais', zone: 'Guincho',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'sintra-cascais'],
    lat: 38.7306, lng: -9.4750, faces: 265,   // OSM coastline, south end by the Muchaxo
    best: {
      swell: [270, 340], size: [0.6, 2.4], period: 9, wind: [60, 130], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'The southern end of Guincho, tucked in a touch under the headland so it holds a little longer when the nortada picks up. Same recipe as the north end: NW swell, E wind, low to mid tide, and early. Rips run hard along the rocks when it’s big.',
    },
    type:    'hls',
    embed:   'https://ds1-cache.quanteec.com/contents/encodings/live/8d2e5d1c-5771-49c8-3834-3530-6d61-63-a417-988a6df6a2f2d/master.m3u8',
    poster:  'https://ds1-cache.quanteec.com/contents/encodings/live/8d2e5d1c-5771-49c8-3834-3530-6d61-63-a417-988a6df6a2f2d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/115/Cascais-Praia-Do-Guincho-Sul',
    link:    'https://gosurf.fr/webcam/fr/115/Cascais-Praia-Do-Guincho-Sul',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCpraiaguinchonorte_1_1.stream/media.jpg',
  },
  {
    id:      'cresmina',
    name:    'Cresmina',
    town:    'Cascais', area: 'Cascais', zone: 'Guincho',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'guincho', 'cascais'],
    lat: 38.7252, lng: -9.4766, faces: 270,   // OSM: Praia da Cresmina
    best: {
      swell: [260, 340], size: [0.6, 2.4], period: 9, wind: [60, 130], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'The smaller beach just south of Guincho, under the dunes, with rock at each end; same recipe as Guincho (NW swell, E wind, low to mid tide) and the same nortada problem, a little more tucked in at the south corner.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/crismina/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
    swanLike: 'guincho-sul',   // its SWAN table until a SWAN run includes it
  },
  {
    id:      'sao-pedro-estoril',
    name:    'São Pedro do Estoril',
    town:    'Estoril', area: 'Cascais', zone: 'Linha de Cascais',
    country: 'Portugal',
    tags:    ['reef break', 'right', 'south facing', 'linha de cascais', 'sao pedro', 'bafureira', 'bico'],
    lat: 38.6936, lng: -9.3698, faces: 180,
    best: {
      swell: [200, 300], size: [0.5, 2.2], period: 10, exposure: 0.45, wind: [340, 60], tide: { range: [0, 0.7], dir: 'falling', text: 'low to mid, on the drop' },
      notes: 'Reef and point setups, Bafureira’s right on the left of the bay, the Bico point next door. A decent NW groundswell wraps into the Linha at roughly half size, so there’s usually something small and rideable here; the reefs line up properly from about a metre of SW–W swell, with a N/NE wind. Low to mid on a dropping tide is the usual call. Intermediate and up; less crowded than Bico.',
    },
    type:    'hls',
    embed:   'https://ds1-cache.quanteec.com/contents/encodings/live/5fcf6d21-f52c-422a-3035-3530-6d61-63-98fa-626cced74f41d/master.m3u8',
    poster:  'https://ds1-cache.quanteec.com/contents/encodings/live/5fcf6d21-f52c-422a-3035-3530-6d61-63-98fa-626cced74f41d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/117/Estoril-Praia-de-Sao-Pedro-do-Estoril',
    link:    'https://gosurf.fr/webcam/fr/117/Estoril-Praia-de-Sao-Pedro-do-Estoril',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCsaopedroestoria_1_1.stream/media.jpg',
  },
  {
    id:      'parede',
    name:    'Parede',
    town:    'Cascais', area: 'Cascais', zone: 'Linha de Cascais',
    country: 'Portugal',
    tags:    ['reef', 'south facing', 'cascais', 'linha'],
    lat: 38.6856, lng: -9.3537, faces: 185,   // OSM: Praia da Parede
    best: {
      swell: [200, 290], size: [0.8, 2.5], period: 11, exposure: 0.45, wind: [330, 60], tide: { range: [0, 0.5], dir: null, text: 'low' },
      notes: 'Rocky reef on the Linha with rights and lefts that need a proper SW–W swell, or a big long-period NW wrapping round Cabo Raso. A N wind is offshore, so it works when the west coast is blown out. Best at low tide; shallow, for experienced surfers.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/parede/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
    swanLike: 'sao-pedro-estoril',   // its SWAN table until a SWAN run includes it
  },
  {
    id:      'carcavelos',
    name:    'Carcavelos',
    town:    'Carcavelos', area: 'Cascais', zone: 'Linha de Cascais',
    country: 'Portugal',
    tags:    ['beach break', 'south facing', 'linha de cascais'],
    lat: 38.6792, lng: -9.3352, faces: 190,   // OSM: Praia de Carcavelos
    best: {
      swell: [200, 290], size: [0.8, 2.5], period: 10, exposure: 0.45, wind: [340, 60], tide: { range: [0.3, 0.8], dir: 'rising', text: 'mid, on the rise' },
      notes: 'Lisbon’s town beach. Faces south, so it needs a proper SW–W swell, or a big long-period NW to wrap round Cabo Raso. Sheltered from the nortada and best in a N/NE wind, it’s the call when Guincho is blown out. Works all tides, best mid and rising. Crowded; watch the rips.',
    },
    type:    'hls',
    embed:   'https://ds2-cache.quanteec.com/contents/encodings/live/7dbfbd58-2c72-4c87-3135-3530-6d61-63-a1b9-8dc2ff272a5cd/master.m3u8',
    poster:  'https://ds2-cache.quanteec.com/contents/encodings/live/7dbfbd58-2c72-4c87-3135-3530-6d61-63-a1b9-8dc2ff272a5cd/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/118/Carcavelos-Praia-de-Carcavelos',
    link:    'https://gosurf.fr/webcam/fr/118/Carcavelos-Praia-de-Carcavelos',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCcarcavelos_1_1.stream/media.jpg',
    viewLabel: 'Carcavelos',
    views:   [{ key: 'calhau', label: 'Calhau', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/carcavelos2/playlist.m3u8' }],   // MEO's partner feeds
  },
  {
    id:      'santo-amaro',
    name:    'Santo Amaro',
    town:    'Oeiras', area: 'Cascais', zone: 'Linha de Cascais',
    country: 'Portugal',
    tags:    ['beach break', 'reef', 'south facing', 'oeiras', 'linha'],
    lat: 38.6845, lng: -9.3123, faces: 190,   // OSM: Praia de Santo Amaro de Oeiras
    best: {
      swell: [200, 290], size: [0.8, 2.5], period: 10, exposure: 0.4, wind: [330, 60], tide: { range: [0.3, 0.9], dir: null, text: 'mid' },
      notes: 'Sandy bay with reef at the ends at the Oeiras end of the Linha, east of Carcavelos and more sheltered still: it needs a big swell to break, then works in a N wind when the open coast is messy.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/santoamaro/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
    swanLike: 'carcavelos',   // its SWAN table until a SWAN run includes it
  },
  {
    id:      'caparica-sao-joao',
    name:    'São João',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada', 'sao joao', 'beginner'],
    lat: 38.6569, lng: -9.2513, faces: 260,   // OSM: Praia de São João; the Caparica front runs NNE–SSW, so it faces WSW
    best: { ...CAPARICA, notes: 'The northernmost Caparica beach and the roomiest. Waves are flatter and fatter than further south, a good hunting ground for learners and improvers, though an E wind in autumn can throw up glassy little wedges. ' + CAPARICA.notes },
    banks:   true,   // its cam's bank readings (tools/banks.py)
    type:    'hls',
    embed:   'https://deliverys5.quanteec.com/contents/encodings/live/f829148a-5ae5-4a90-3735-3530-6d61-63-b215-b6a95fb68802d/master.m3u8',
    poster:  'https://deliverys5.quanteec.com/contents/encodings/live/f829148a-5ae5-4a90-3735-3530-6d61-63-b215-b6a95fb68802d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/124/Costa-Caparica-Praia-do-Sao-Joao',
    link:    'https://gosurf.fr/webcam/fr/124/Costa-Caparica-Praia-do-Sao-Joao',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCcostacaparicasaojoao_1_1.stream/media.jpg',
    viewLabel: 'São João',
    views:   [{ key: 'norte', label: 'Praia do Norte', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/costacaparicasaojoao/playlist.m3u8' }],   // MEO's partner feeds
  },
  {
    id:      'caparica-cds',
    name:    'CDS',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.6449, lng: -9.2419, faces: 250,   // OSM: Praia do CDS, shore normal ~245° (EMODnet fit)
    best: { ...CAPARICA, notes: 'Right in front of town by the surf centre, between two jetties that groom the banks. ' + CAPARICA.notes },
    banks:   true,   // its cam's bank readings (tools/banks.py)
    type:    'hls',
    embed:   'https://ds1-cache.quanteec.com/contents/encodings/live/b969e298-ceb4-4132-3635-3530-6d61-63-82b6-c59507e55b39d/master.m3u8',
    poster:  'https://ds1-cache.quanteec.com/contents/encodings/live/b969e298-ceb4-4132-3635-3530-6d61-63-82b6-c59507e55b39d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/123/Costa-Caparica-Praia-do-CDS',
    link:    'https://gosurf.fr/webcam/fr/123/Costa-Caparica-Praia-do-CDS',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCcostacaparicacds_1_1.stream/media.jpg',
    viewLabel: 'CDS',
    views:   [{ key: 'sul', label: 'Sul', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/costacaparicabernard/playlist.m3u8' }, { key: 'tarquinio', label: 'Tarquínio', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/bctarquinho/playlist.m3u8' }],   // MEO's partner feeds
  },
  {
    id:      'caparica-praia-nova',
    name:    'Praia Nova',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.6376, lng: -9.2354, faces: 250,   // OSM: Praia Nova, between CDS and Riviera on the same jetty-lined front
    best: { ...CAPARICA, notes: 'Between the jetties just south of CDS, so it works much like it. ' + CAPARICA.notes },
    type:    'hls',
    // MEO's partner feeds (their partners' embedded player), not published
    // ones: straight out past the groyne, and the wide look south from
    // Barracuda. If they stop, set type back to 'none' and drop the view.
    embed:   'https://video-auth1.iol.pt/beachcam/bccaparicanovapraia/playlist.m3u8',
    viewLabel: 'Out past the groyne',
    views:   [{ key: 'south', label: 'south', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/bcbarracuda/playlist.m3u8' }],
    fallback: 'https://beachcam.meo.pt/livecams/costa-da-caparica-praia-nova/',
    link:    'https://beachcam.meo.pt/livecams/costa-da-caparica-praia-nova/',
    source:  'MEO Beachcam',
  },
  {
    id:      'caparica-saude',
    name:    'Saúde',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.6303, lng: -9.2284, faces: 250,   // OSM: Praia da Saúde
    best: { ...CAPARICA, notes: 'South of Praia Nova where the jetties end. Its cam is Playocean’s Caparica 2 panorama from the cliff (placed here by the groyne in its view). ' + CAPARICA.notes },
    type:    'video',
    embed:   'https://www.youtube-nocookie.com/embed/_LUOa8uffGE?autoplay=1&mute=1&playsinline=1&rel=0',
    link:    'https://www.youtube.com/watch?v=_LUOa8uffGE',
    source:  'Playocean (YouTube)',
    thumb:   'https://i.ytimg.com/vi/_LUOa8uffGE/hqdefault_live.jpg',
    swanLike: 'caparica-praia-nova',   // its SWAN table until the Caparica fine grid is rerun with it
  },
  {
    id:      'caparica-riviera',
    name:    'Riviera',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.6197, lng: -9.2202, faces: 250,   // OSM: Praia da Riviera, shore normal ~240° (EMODnet fit)
    best: { ...CAPARICA, notes: 'South of town, where the jetties thin out, so a touch more open and more push than CDS. ' + CAPARICA.notes },
    banks:   true,   // its cam's bank readings (tools/banks.py)
    type:    'hls',
    embed:   'https://ds2-cache.quanteec.com/contents/encodings/live/033c1cda-143d-4a55-3835-3530-6d61-63-a933-f44c0821ad62d/master.m3u8',
    poster:  'https://ds2-cache.quanteec.com/contents/encodings/live/033c1cda-143d-4a55-3835-3530-6d61-63-a933-f44c0821ad62d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/125/Costa-Caparica-Praia-do-Riviera',
    link:    'https://gosurf.fr/webcam/fr/125/Costa-Caparica-Praia-do-Riviera',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCriviera_1_1.stream/media.jpg',
  },
  {
    id:      'caparica-casa-do-sol',
    name:    'Casa do Sol',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.617, lng: -9.2184, faces: 250,   // OSM: Casa do Sol, at Praia da Rainha
    best: { ...CAPARICA, notes: 'By Casa do Sol at Praia da Rainha, south of Riviera. Its cam is Playocean’s Caparica panorama from the cliff over the dunes (placed here from its view). ' + CAPARICA.notes },
    type:    'video',
    embed:   'https://www.youtube-nocookie.com/embed/oDbKeeojgyk?autoplay=1&mute=1&playsinline=1&rel=0',
    link:    'https://www.youtube.com/watch?v=oDbKeeojgyk',
    source:  'Playocean (YouTube)',
    thumb:   'https://i.ytimg.com/vi/oDbKeeojgyk/hqdefault_live.jpg',
    swanLike: 'caparica-riviera',   // its SWAN table until the Caparica fine grid is rerun with it
  },
  {
    id:      'caparica-infante',
    name:    'Infante',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.6002, lng: -9.2094, faces: 250,   // OSM: Praia do Infante
    best: { ...CAPARICA, notes: 'Open beach between Casa do Sol and Fonte da Telha, past the jetties, under the cliffs. Its cam is Playocean’s, looking straight out from Praia do Infante. ' + CAPARICA.notes },
    type:    'video',
    embed:   'https://www.youtube-nocookie.com/embed/9K9f_tgRDXI?autoplay=1&mute=1&playsinline=1&rel=0',
    link:    'https://www.youtube.com/watch?v=9K9f_tgRDXI',
    source:  'Playocean (YouTube)',
    thumb:   'https://i.ytimg.com/vi/9K9f_tgRDXI/hqdefault_live.jpg',
    swanLike: 'caparica-riviera',   // its SWAN table until the Caparica fine grid is rerun with it
    viewLabel: 'Infante',
    views:   [{ key: 'sereia', label: 'Sereia', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/bcwaikiki/playlist.m3u8' }],   // MEO's partner feeds
  },
  {
    id:      'fonte-da-telha',
    name:    'Fonte da Telha',
    town:    'Fonte da Telha', area: 'Caparica', zone: 'South of the jetties',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.5719, lng: -9.1961, faces: 250,   // OSM: Fonte da Telha beach, shore normal ~245° (EMODnet fit)
    best: {
      swell: [230, 300], size: [0.6, 2.5], period: 9, wind: [30, 110], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'Open, exposed beach south of the Caparica jetties with more punch than town, picks up local windswell as well as groundswell, so it’s rarely flat. WSW swell and an ENE wind is the recipe; even a light onshore ruins it. Low to mid tide; often crowded.',
    },
    banks:   true,   // its cam's bank readings (tools/banks.py)
    type:    'hls',
    embed:   'https://ds2-cache.quanteec.com/contents/encodings/live/a31a9026-5ced-4668-3935-3530-6d61-63-aa32-b07694268059d/master.m3u8',
    poster:  'https://ds2-cache.quanteec.com/contents/encodings/live/a31a9026-5ced-4668-3935-3530-6d61-63-aa32-b07694268059d/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/126/Fonte-da-Telha-Praia-da-Fonte-Telha',
    link:    'https://gosurf.fr/webcam/fr/126/Fonte-da-Telha-Praia-da-Fonte-Telha',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCfontedatelha_1_1.stream/media.jpg',
    viewLabel: 'Norte',
    views:   [{ key: 'sul', label: 'Sul', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/bcbambu/playlist.m3u8' }],   // MEO's partner feeds
  },
  {
    id:      'meco',
    name:    'Meco',
    town:    'Aldeia do Meco', area: 'Sesimbra', zone: 'Praia do Meco',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'sesimbra', 'meco', 'moinho de baixo'],
    lat: 38.4830, lng: -9.1855, faces: 260,   // OSM: Praia do Meco / Moinho de Baixo
    best: {
      swell: [250, 330], size: [0.6, 2.5], period: 9, exposure: 0.85, wind: [40, 120], tide: { range: [0, 0.7], dir: null, text: 'low to mid' },
      notes: 'Long open beach break south of Lagoa de Albufeira, out of the Caparica shelter, so it usually has more size than Fonte on a NW swell. Shifting sand banks; an E wind cleans it. Its cam is Playocean’s at Bar do Peixe (MEO Beachcam has one too, on their site only).',
    },
    type:    'video',
    embed:   'https://www.youtube-nocookie.com/embed/EqnyST2s53I?autoplay=1&mute=1&playsinline=1&rel=0',
    link:    'https://www.youtube.com/watch?v=EqnyST2s53I',
    source:  'Playocean (YouTube)',
    thumb:   'https://i.ytimg.com/vi/EqnyST2s53I/hqdefault_live.jpg',
    viewLabel: 'Bar do Peixe',
    views:   [{ key: 'meo', label: 'MEO cam', type: 'hls', embed: 'https://video-auth1.iol.pt/beachcam/bcmeco/playlist.m3u8' }],   // MEO's partner feeds
  },
  {
    id:      'bicas',
    name:    'Bicas',
    town:    'Aldeia do Meco', area: 'Sesimbra', zone: 'Praia das Bicas',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'sesimbra', 'meco'],
    lat: 38.4648, lng: -9.1925, faces: 265,   // OSM: Praia das Bicas
    best: {
      swell: [250, 330], size: [0.6, 2.4], period: 9, exposure: 0.85, wind: [45, 120], tide: { range: [0, 0.6], dir: null, text: 'low' },
      notes: 'Sandy beach break under the cliffs north of Cabo Espichel, the most exposed of the Meco stretch: picks up W and NW swell, best at low tide with an E wind (MEO Beachcam).',
    },
    type:    'hls',
    // MEO's partner feed (the one their partners' embedded player uses), not a
    // published one: if it stops, set type back to 'none' and the viewer links
    // out to MEO's page as before.
    embed:   'https://video-auth1.iol.pt/beachcam/bcpraiadasbicas/playlist.m3u8',
    fallback: 'https://beachcam.meo.pt/livecams/praia-das-bicas/',
    link:    'https://beachcam.meo.pt/livecams/praia-das-bicas/',
    source:  'MEO Beachcam',
  },
  {
    id:      'arrifana',
    name:    'Praia da Arrifana',
    town:    'Aljezur', area: 'Algarve', zone: 'Costa Vicentina',
    country: 'Portugal',
    tags:    ['beach break', 'right', 'point', 'aljezur', 'vicentina'],
    lat: 37.2926, lng: -8.8653, faces: 250,   // OSM: Praia da Arrifana, the bay below the village
    best: {
      swell: [250, 320], size: [0.8, 2.5], period: 9, exposure: 0.5, wind: [340, 110], tide: { range: [0.3, 0.8], dir: 'rising', text: 'mid, on the rise' },
      notes: 'Horseshoe bay under high cliffs on the Costa Vicentina, with a beach break through the middle and a long right-hand point over rocks at the north end when a solid W/NW swell runs. The cliffs shelter it from the nortada, so it’s often the call when the open beaches are blown out. Mid tide on the push; N/NE wind. Point is for experienced surfers; the beach suits everyone and gets crowded.',
    },
    type:    'hls',
    embed:   'https://ds1-cache.quanteec.com/contents/encodings/live/a91257ec-cafd-4eeb-3436-3530-6d61-63-b7ab-31c6e7bb583bd/master.m3u8',
    poster:  'https://ds1-cache.quanteec.com/contents/encodings/live/a91257ec-cafd-4eeb-3436-3530-6d61-63-b7ab-31c6e7bb583bd/poster.jpg',
    fallback: 'https://gosurf.fr/webcam/fr/131/Arrifana-Praia-da-Arrifana',
    link:    'https://gosurf.fr/webcam/fr/131/Arrifana-Praia-da-Arrifana',
    source:  'MEO Beachcam via viewsurf',
    thumb:   'https://films.viewsurf.com/BCarrifana_1_1.stream/media.jpg',
  },
  {
    id:      'ribeira-d-ilhas',
    name:    'Ribeira d’Ilhas',
    town:    'Ericeira', area: 'Ericeira', zone: 'Mafra',
    country: 'Portugal',
    tags:    ['point', 'reef', 'right', 'ericeira', 'mafra', 'world surfing reserve'],
    lat: 38.9872, lng: -9.4194, faces: 275,   // OSM: Ribeira d'Ilhas beach, the bay north of Ericeira
    best: {
      swell: [280, 330], size: [1.0, 3.0], period: 10, exposure: 0.75, wind: [50, 140], tide: { range: [0.35, 0.85], dir: 'rising', text: 'mid to high, on the push' },
      notes: 'The heart of the Ericeira World Surfing Reserve: a long, walling right-hand point over reef and boulders that peels for a couple of hundred metres on a clean NW swell. Handles size well and holds its shape at 2–3 m when the beaches close out. Mid to high tide on the push is the classic call; low tide gets fast and shallow on the inside. E/NE wind is dead offshore. WSL contest venue, so expect a crowd and a strong local pack when it’s on.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/bcmafraribeira/playlist.m3u8',
    link:    'https://beachcam.meo.pt/livecams/ribeira-dilhas/',
    source:  'MEO Beachcam',
  },
  {
    id:      'matadouro',
    name:    'Matadouro',
    town:    'Ericeira', area: 'Ericeira', zone: 'Ericeira',
    country: 'Portugal',
    tags:    ['reef', 'right', 'west facing', 'ericeira', 'mafra'],
    lat: 38.9755, lng: -9.4204, faces: 285,   // OSM: Praia do Matadouro
    best: {
      swell: [280, 340], size: [1.0, 3.0], period: 11, exposure: 0.75, wind: [60, 150], tide: { range: [0.3, 0.9], dir: null, text: 'mid to high' },
      notes: 'Right-hand reef at the north end of Ericeira town, by the old slaughterhouse: a heavy wedge on a clean NW swell with an E wind. Shallow rock; for experienced surfers.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/matadouroskatepark/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
  },
  {
    id:      'ericeira-sul',
    name:    'Praia do Sul',
    town:    'Ericeira', area: 'Ericeira', zone: 'Ericeira',
    country: 'Portugal',
    tags:    ['beach break', 'reef', 'south-west facing', 'ericeira', 'mafra'],
    lat: 38.9576, lng: -9.4155, faces: 240,   // OSM: Praia do Sul, Ericeira
    best: {
      swell: [240, 320], size: [0.8, 2.5], period: 10, exposure: 0.6, wind: [20, 110], tide: { range: [0.3, 0.9], dir: null, text: 'mid' },
      notes: 'Town beach south of the harbour, facing SW with rock and reef along it: tucked away from the north, so it comes alive on bigger NW swells when the open beaches are too much, best in a NE–E wind.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/praiadosulericeira/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
  },
  {
    id:      'foz-do-lizandro',
    name:    'Foz do Lizandro',
    town:    'Ericeira', area: 'Ericeira', zone: 'Mafra',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'ericeira', 'mafra', 'river mouth'],
    lat: 38.942, lng: -9.4155, faces: 270,   // OSM: Praia da Foz do Lizandro
    best: {
      swell: [250, 330], size: [0.6, 2.5], period: 9, wind: [50, 130], tide: { range: [0.2, 0.8], dir: null, text: 'mid' },
      notes: 'Beach break at the Lizandro river mouth south of Ericeira, banks shaped by the river; consistent and busy with surf schools. W–NW swell, E wind, mid tide.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/fozdolizandro/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
  },
  {
    id:      'sao-juliao',
    name:    'São Julião',
    town:    'Ericeira', area: 'Ericeira', zone: 'Mafra',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'ericeira', 'mafra', 'sintra'],
    lat: 38.9295, lng: -9.4213, faces: 270,   // OSM: Praia de São Julião
    best: {
      swell: [250, 330], size: [0.6, 2.5], period: 9, wind: [50, 130], tide: { range: [0, 1], dir: null, text: 'all tides' },
      notes: 'Long open beach break south of Foz do Lizandro, exposed to everything from the west, so it has size when Ericeira is small; works most tides, blown out by the nortada.',
    },
    type:    'hls',
    embed:   'https://video-auth1.iol.pt/beachcam/bcsaojuliao/playlist.m3u8',   // MEO's partner feed (see Bicas)
    link:    'https://beachcam.meo.pt/livecams/',
    source:  'MEO Beachcam',
  },
];


// Home areas first; anything else follows in the order it appears in CAMS.
const AREA_ORDER = ['Cascais', 'Caparica'];
// A spot's extra cams (views), each a cam of its own for the Cams page and
// the viewer, pointing back at its spot (of) for the forecast.
const CAM_VIEWS = CAMS.flatMap((c) => (c.views || []).map((v) => ({
  ...c, alt: undefined, thumb: undefined, poster: undefined, ...v, views: undefined,
  id: `${c.id}~${v.key}`, of: c.id, name: `${c.name} · ${v.label}`,
})));
const AREAS = [...new Set(CAMS.map((c) => c.area))]
  .sort((a, b) => (AREA_ORDER.includes(a) ? AREA_ORDER.indexOf(a) : 99) - (AREA_ORDER.includes(b) ? AREA_ORDER.indexOf(b) : 99));

// With no filter the map opens on the home stretch (Sintra → Caparica)
// rather than zoomed out to fit Nazaré and the Algarve too.
const HOME_AREAS = ['Sintra', 'Cascais', 'Caparica'];


/* ---------- Tune overrides ----------
   The live page's ?tune mode saves adjusted numbers for a spot on this
   device; both pages apply them over the defaults above. Paste the exported
   JSON into the spot's `best` block to make a change permanent. */
const BEST_DEFAULTS = Object.fromEntries(CAMS.map((c) => [c.id, JSON.parse(JSON.stringify(c.best))]));
let TUNE_OVERRIDES = {};
try { TUNE_OVERRIDES = JSON.parse(localStorage.getItem('surf-tune') || '{}') || {}; } catch {}
for (const c of CAMS) {
  const o = TUNE_OVERRIDES[c.id];
  if (!o) continue;
  for (const [k, v] of Object.entries(o)) {
    if (k === 'tide') c.best.tide = { ...c.best.tide, ...v };
    else c.best[k] = Array.isArray(v) ? v.slice() : v;
  }
}
const saveTune = () => { try { localStorage.setItem('surf-tune', JSON.stringify(TUNE_OVERRIDES)); } catch {} };
