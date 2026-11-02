/* Spots: the cams and their local knowledge — shared by index.html (live cams) and week.html (16-day outlook).
   Where each spot's settings came from (sources, what changed, confidence): data/local-knowledge.md.
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
  swell: [240, 320], size: [0.6, 2.0], period: 9, exposure: 0.8, wind: [30, 120], tide: { range: [0, 1], dir: null, text: 'all tides' },
  notes: 'Caparica’s beach breaks take W–NW swell, less of it the further north (Cabo Raso shelters the north end). The groyne field from São João to Praia Nova shapes short wedges; south of it the banks are open and shift. An E/NE wind cleans it, the summer nortada blows it side-on, and the water is worse after heavy rain (the Tagus).',
};

// Praia do Norte's local knowledge, kept separate so another cam on the
// same beach can share it.
const NAZARE = {
  swell: [240, 335], size: [0.8, 2.2], period: 9, exposure: 0.9, gain: 1.4, wind: [20, 140], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
  notes: 'The big-wave beach: the canyon offshore focuses long-period W–NW groundswell into the giant days. On normal days it’s a heavy beach break, lefts and rights over sand with a hollow inside bar and very strong currents: low to mid tide, an E–NE wind in the morning, and not alone above ~2 m. Praia da Vila, round the headland, is the gentler option.',
};
const CAMS = [
  {
    id:      'nazare-norte',
    name:    'Praia do Norte',
    town:    'Nazaré', area: 'Nazaré', zone: 'Praia do Norte',
    country: 'Portugal',
    tags:    ['beach break', 'big wave', 'canyon', 'heavy'],
    lat: 39.617, lng: -9.083, faces: 280,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
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
    lat: 39.3755, lng: -9.3357, faces: 10,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [280, 20], size: [0.9, 3.0], period: 9, exposure: 0.6, wind: [120, 230], tide: { range: [0.45, 0.95], dir: 'rising', text: 'mid to high, on the push' },
      notes: 'Left-hand reef over flat rock and sand on the north side of the peninsula, facing almost the opposite way to Supertubos: it wants N–NW swell and a S wind, the setup that blows Supertubos onshore. Mid to high tide on the push; urchins, and a competitive crowd when it’s on.',
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
    lat: 39.3483, lng: -9.3660, faces: 248,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [210, 310], size: [1.0, 3.0], period: 10, exposure: 0.7, wind: [340, 100], tide: { range: [0.3, 1], dir: null, text: 'mid to high' },
      notes: 'Shallow sandbanks that throw hollow A-frames, the WSL contest wave: a W–SW groundswell and a N to NE wind, mid to high tide; head-high to double overhead, heavy closeouts when it’s huge. Expert when it’s on, crowded enough to be dangerous; best in autumn, mostly flat in summer.',
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
    lat: 38.8262, lng: -9.469, faces: 300,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [260, 340], size: [0.6, 2.5], period: 9, wind: [60, 150], tide: { range: [0.1, 0.6], dir: 'rising', text: 'low to mid, rising' },
      notes: 'Small village bay with rocks at both ends: A-frame peaks and wedgy lefts off the south cliffs where the stream comes out. Best on a small to moderate NW swell at lower tide (dumpy at high), cleaned by an E–SE wind; crowded at weekends.',
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
    lat: 38.8185, lng: -9.4752, faces: 294,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [260, 350], size: [0.6, 2.5], period: 9, wind: [60, 150], tide: { range: [0.2, 0.8], dir: 'rising', text: 'low to mid, rising' },
      notes: 'The most consistent beach on this coast, powerful and fast-dropping: a left on the north side, a peak in the middle and the right off the pool reef at the north end. W–NW swell, E–SE wind; strong rips once it’s overhead, and big NW winter swells close it out. Not for beginners.',
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
    lat: 38.8121, lng: -9.4789, faces: 302,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [260, 350], size: [0.6, 2.5], period: 9, wind: [60, 160], tide: { range: [0.2, 0.8], dir: 'rising', text: 'low to mid, rising' },
      notes: 'The south end of Praia Grande, a little sheltered by the slate cliffs and usually less crowded than the north: same powerful beach break on W–NW swell with an E–SE wind, best on a rising low to mid tide; rips when it’s big.',
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
    lat: 38.8037, lng: -9.4848, faces: 298,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [260, 350], size: [0.6, 2.2], period: 9, wind: [70, 170], tide: { range: [0.15, 0.6], dir: 'rising', text: 'low to mid, rising' },
      notes: 'Cliff-backed cove: short, hollow, ledgey peaks both ways over sand and rock, best on a WNW swell and a rising low to mid tide with an E–SE wind. Submerged rocks; for intermediate to experienced surfers.',
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
    lat: 38.7370, lng: -9.4726, faces: 277,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [270, 340], size: [0.6, 2.4], period: 9, wind: [60, 170], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'Exposed beach break that catches every swell going, the indicator for the Lisbon coast: NW is best, with an E wind (S winds are fine too). The summer nortada blows it out by late morning, so go early. Lefts and rights over sand with rocks; strong rips that run north along the beach.',
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
    lat: 38.7306, lng: -9.4750, faces: 289,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [270, 340], size: [0.6, 2.4], period: 9, wind: [60, 170], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
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
    lat: 38.7252, lng: -9.4766, faces: 289,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [260, 340], size: [0.6, 2.4], period: 9, wind: [60, 170], tide: { range: [0.1, 0.8], dir: null, text: 'low to high, not the top' },
      notes: 'The smaller bay just south of Guincho, sand with rock and some reef: same NW swell and E wind as Guincho, less crowded, a little more tucked in at the south corner. Sources disagree on tide, so it’s set wide.',
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
    lat: 38.6936, lng: -9.3698, faces: 188,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [200, 300], size: [0.5, 2.2], period: 10, exposure: 0.45, wind: [340, 60], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'Bico: a long, fat right point over flat rock and sand, 150–300 m on a good day, the Linha’s most reliable wave and a longboard favourite; Bafureira next door is a reef A-frame. Needs a SW–W swell or a big long-period NW wrapping in; a N–NE wind is offshore. Urchins and crowds.',
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
    lat: 38.6856, lng: -9.3537, faces: 198,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [200, 290], size: [1.0, 2.5], period: 11, exposure: 0.45, wind: [330, 60], tide: { range: [0, 0.5], dir: null, text: 'low' },
      notes: 'Right-hand reef over sharp rock, short and hollow, that needs a big W–SW swell to break (it rarely does). A N wind is offshore, so it works when the west coast is blown out; best around low tide. For experienced surfers.',
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
    lat: 38.6792, lng: -9.3352, faces: 205,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [200, 290], size: [0.6, 2.5], period: 10, exposure: 0.45, wind: [340, 60], tide: { range: [0.3, 0.8], dir: 'rising', text: 'mid, on the rise' },
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
    lat: 38.6845, lng: -9.3123, faces: 187,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [200, 290], size: [1.0, 2.5], period: 10, exposure: 0.35, wind: [300, 60], tide: { range: [0.45, 1], dir: 'rising', text: 'mid to high, on the push' },
      notes: 'A fast, powerful, tubing right-hand point over a reef plateau at the Oeiras end of the Linha, the wave the Salvem o Surf campaign saved; it only breaks on a big SW–W swell, with a N–NW wind, mid to high tide on the push. Urchins and rocks, localism; for experienced surfers.',
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
    lat: 38.6569, lng: -9.2513, faces: 234,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: { ...CAPARICA, tide: { range: [0.4, 1], dir: null, text: 'mid to high' }, notes: 'Open sand north of the groynes: softer, longer A-frame walls than the town beaches, best mid to high tide; the Cova do Vapor groynes to the north give heavier wedges.' + CAPARICA.notes },
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
    lat: 38.6449, lng: -9.2419, faces: 243,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: { ...CAPARICA, size: [0.6, 1.8], notes: 'Right in front of town by the surf centre, in the groyne field: short, hollow, mostly right-hand wedges off the jetties, the busiest lineup on the coast; it can’t hold much size before closing out.' + CAPARICA.notes },
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
    lat: 38.6376, lng: -9.2354, faces: 248,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: { ...CAPARICA, size: [0.6, 1.8], notes: 'The southernmost beach between the groynes: a powerful right that starts over the jetty rocks and runs onto the sand, lefts and rights in front of them; fewer people than CDS on weekdays.' + CAPARICA.notes },
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
    lat: 38.6303, lng: -9.2284, faces: 239,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: { ...CAPARICA, size: [0.6, 2.2], notes: 'South of the last groyne, open sandbanks: semi-hollow peaks, emptier than the town beaches; a shifty rip and a hard paddle when it’s big.' + CAPARICA.notes },
    type:    'video',
    embed:   'https://www.youtube-nocookie.com/embed/_LUOa8uffGE?autoplay=1&mute=1&playsinline=1&rel=0',
    link:    'https://www.youtube.com/watch?v=_LUOa8uffGE',
    source:  'Playocean (YouTube)',
    thumb:   'https://i.ytimg.com/vi/_LUOa8uffGE/hqdefault_live.jpg',
  },
  {
    id:      'caparica-riviera',
    name:    'Riviera',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.6197, lng: -9.2202, faces: 243,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: { ...CAPARICA, size: [0.6, 2.2], notes: 'Open beach break south of the groynes, softer and mellower: a longboard and learner stretch on smaller days.' + CAPARICA.notes },
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
    lat: 38.617, lng: -9.2184, faces: 244,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: { ...CAPARICA, size: [0.6, 2.2], notes: 'Open sandbank beach by Praia da Rainha, south of Riviera: hollow peaks both ways, empty on weekdays.' + CAPARICA.notes },
    type:    'video',
    embed:   'https://www.youtube-nocookie.com/embed/oDbKeeojgyk?autoplay=1&mute=1&playsinline=1&rel=0',
    link:    'https://www.youtube.com/watch?v=oDbKeeojgyk',
    source:  'Playocean (YouTube)',
    thumb:   'https://i.ytimg.com/vi/oDbKeeojgyk/hqdefault_live.jpg',
  },
  {
    id:      'caparica-infante',
    name:    'Infante',
    town:    'Costa da Caparica', area: 'Caparica', zone: 'Costa da Caparica',
    country: 'Portugal',
    tags:    ['beach break', 'west facing', 'caparica', 'almada'],
    lat: 38.6002, lng: -9.2094, faces: 252,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: { ...CAPARICA, size: [0.6, 2.2], notes: 'Further south under the cliffs, where the longshore drift builds the most consistent banks: often the best waves and the fewest people on the Caparica stretch.' + CAPARICA.notes },
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
    lat: 38.5719, lng: -9.1961, faces: 247,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [230, 300], size: [0.8, 3.0], period: 9, wind: [30, 140], tide: { range: [0, 0.6], dir: null, text: 'low to mid' },
      notes: 'Open beach south of Caparica: A-frame peaks over sand, best at low to mid tide; it gets less swell than town on small days but holds a big swell better. Since the 2025–26 winter storms two permanent rip channels have formed, so pick the peak with care.',
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
    lat: 38.4830, lng: -9.1855, faces: 280,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [250, 330], size: [0.6, 3.0], period: 9, exposure: 0.85, wind: [40, 150], tide: { range: [0, 0.7], dir: null, text: 'low to mid' },
      notes: 'A powerful, hollow wedge breaking close to the sand, short rides, best at low to mid tide on W–NW swell with an E wind; the rips are notorious. Empty, and mostly flat in summer.',
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
    lat: 38.4648, lng: -9.1925, faces: 290,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [250, 330], size: [1.0, 3.0], period: 9, exposure: 0.85, wind: [50, 160], tide: { range: [0, 0.6], dir: 'rising', text: 'low to mid, rising' },
      notes: 'Sand and rock reef under the cliffs: the main peak splits both ways (the left is usually better), heavy on the inside and bigger than it looks from the beach. Needs a solid W–NW swell; urchins and rocks, a local crowd. For experienced surfers.',
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
    lat: 37.2926, lng: -8.8653, faces: 240,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [210, 330], size: [0.5, 2.5], period: 9, exposure: 0.65, wind: [0, 120], tide: { range: [0.3, 0.8], dir: 'rising', text: 'mid, on the rise' },
      notes: 'Cliff-ringed bay open to the SW, sheltered from N wind: a sand beach break for all levels on small days (it closes out in the middle when big) and a fast, hollow right over rock at the north end by the harbour that needs a solid 1.5 m+ swell. Very consistent; autumn is best.',
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
    lat: 38.9872, lng: -9.4194, faces: 249,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [260, 340], size: [0.6, 3.5], period: 10, exposure: 0.75, wind: [50, 140], tide: { range: [0.35, 0.85], dir: 'rising', text: 'mid to high, on the push' },
      notes: 'The heart of the Ericeira World Surfing Reserve and its contest venue: a long right point over reef and some sand, 150–300 m on a good NW swell, mellow on small days and powerful when it holds a big swell. Mid tide; rocks, urchins and a very crowded lineup.',
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
    lat: 38.9755, lng: -9.4204, faces: 270,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [250, 340], size: [0.8, 2.5], period: 11, exposure: 0.75, wind: [60, 150], tide: { range: [0.3, 0.8], dir: null, text: 'mid' },
      notes: 'Reef and sand A-frame in front of the Boardriders skatepark, about 1 km north of Praia do Norte: the steeper, ledgey right on the north side is the wave, a slower left to the south. Mid tide (too little water at low); urchins and rocks; dumpy when it’s big.',
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
    lat: 38.9576, lng: -9.4155, faces: 250,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [240, 320], size: [1.0, 2.5], period: 10, exposure: 0.6, wind: [40, 130], tide: { range: [0.1, 0.6], dir: null, text: 'low to mid' },
      notes: 'Town beach south of the harbour, sand and flat rock: a right off the north headland, an inside A-frame and a left to the south. Sheltered, so it only comes alive on bigger NW swells, when the open beaches are maxing out; best at lower tide with an E wind.',
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
    lat: 38.942, lng: -9.4155, faces: 292,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      swell: [230, 330], size: [0.6, 2.5], period: 9, wind: [50, 130], tide: { range: [0.2, 0.8], dir: null, text: 'mid' },
      notes: 'River-mouth beach break: a central A-frame and a left by the river mouth, banks shaped by the river; Ericeira’s main learner spot and protected from N winds. Strong rips drifting north towards the rocks; dirty water after rain.',
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
    lat: 38.932, lng: -9.42, faces: 278,   // facing from Sentinel-2 shorelines, checked against OSM (2026-11-02)
    best: {
      exposure: 0.95, swell: [250, 330], size: [0.6, 2.2], period: 9, wind: [50, 130], tide: { range: [0, 0.7], dir: null, text: 'low to mid' },
      notes: 'The area’s swell magnet: a long beach with many A-frame peaks, easily maxed out with heavy closeouts as it picks up. Best at low to mid tide with an E wind; the main peak by the car park is crowded, quieter walking towards Vigia.',
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
