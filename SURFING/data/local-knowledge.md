# Local knowledge: sources behind spots.js

Researched 2026-11-02: four parallel web searches (English and Portuguese) over MEO Beachcam's per-beach "Surf Info" panels, surf-forecast.com, wannasurf.com (mondo.surf largely mirrors it, so they count once), surfnerd.com, The Surf Atlas, the Ericeira World Surfing Reserve, surf schools and camps, Portuguese blogs and news. A setting was changed only where two or more independent sources agreed; conflicts are noted and left alone. **No source gives a minimum swell period for any spot**, so `period` is unchanged throughout.

**Facings** were re-measured from space: `tools/sat_banks.py` turns a 1.4 km strip of coast until the shoreline it finds in Sentinel-2 runs straight across, median over up to five clear passes. They were cross-checked against OpenStreetMap coastline bearings measured by the researchers. Several were 20–40° out. Lagide (rocky reef) gave one pass only; its facing leans on OSM and MEO's N swell / S wind.

Confidence: **H** high, **M** medium, **L** low.

## Nazaré, Peniche, Arrifana

**nazare-norte**, Praia do Norte (M)
- Swell: W–NW best for the canyon. Range 216–335° per mondo.
- Wind: E. Wannasurf gives N–SE and mondo 6–132°.
- Tide: low per MEO, low to mid per wannasurf and mondo. Surf-forecast says all.
- Character: a heavy beach break with a hollow inside bar and very strong currents.
- Level: don't surf it alone above about 2 m (wannasurf); MEO rates it high difficulty.
- The canyon: the Instituto Hidrográfico model doubles a 10 m wave at Praia do Norte. That is for big, long-period NW/W swell; nobody quantifies the effect on ordinary days.
- Position: the old point was the headland cliff by the Forno de Orca cave. It's moved to the beach at 39.617, −9.083, facing 280° from space. At 39.613 the strip still caught the headland's curve.
- Changed: swell 240–335°, size 0.8–2.2 m, wind 20–140°, tide 0–0.6.
- Sources: beachcam.meo.pt/livecams/praia-do-norte/ · surf-forecast.com/breaks/Nazare · en.wannasurf.com/spot/Europe/Portugal/North_Beira/praia_do_norte/ · mondo.surf/surf-spot/praia-do-norte/guide/1191 · nazarewaves.com/en/Home/InfoNorthCanyon · hidrografico.pt/en/infoteca/ocean-knowledge/test/

**peniche-lagide** (M–H)
- Swell: N per MEO, NNW per surf-forecast. Wannasurf gives N, NW, W and mondo 263–8°.
- Wind: S per MEO and surf-forecast; mondo 128–236°.
- Tide: mid to high, rising (wannasurf, mondo, surf-forecast). MEO says high.
- Character: a mainly left reef over flat rock and sand. One source (surfnesslodge) says mainly right. Urchins; a competitive crowd.
- WSL: Baleal faces almost 180° from Supertubos and is the contest's fallback.
- Position: the old point was a car park. It's moved to the break at 39.3755, −9.3357.
- Changed: facing 320° → 10°, swell 280–20°, size 0.9–3 m, wind 120–230°, tide 0.45–0.95 rising.
- Sources: beachcam.meo.pt/livecams/lagide/ · surf-forecast.com/breaks/Lagide/ · en.wannasurf.com/spot/Europe/Portugal/Central_Peniche/lagide/ · mondo.surf/surf-spot/lagide/guide/1033 · surfnesslodge.com/en/?p=2361 · worldsurfleague.com/posts/148370

**peniche-supertubos** (H)
- Swell: SW–W, though WSL says it takes almost any Atlantic direction.
- Wind: NE–E, but best on a N wind (WSL, Surf Atlas, wannasurf).
- Tide: mid to high.
- Size: head-high to double overhead.
- Swell type: long-period groundswell of 10–16 s.
- Character: shallow sand A-frames, lefts often better. Expert; dangerously crowded.
- Season: best in autumn, mostly flat in summer.
- Changed: facing 248° (was 250°), swell 210–310°, wind 340–100°, tide 0.3–1.
- Sources: beachcam.meo.pt/livecams/peniche-supertubos/ · worldsurfleague.com/posts/148370 · thesurfatlas.com/surfing-portugal/supertubos/ · wannasurf supertubos · surf-forecast.com/breaks/Supertubos

**arrifana** (M)
- Swell: W, NW and occasionally S. Mondo gives 201–336°.
- Wind: E–NE; the cliffs shelter it from N wind.
- Tide: conflicting (all tides vs best near low), so it's left unchanged.
- Character: a sand beach for all levels on small days, closing out mid-bay when big. A hollow right over rock and boulders at the north end needs about 1.5 m or more.
- Consistency: very consistent.
- Changed: facing 240° (was 250°), swell 210–330°, size 0.5–2.5 m, exposure 0.65, wind 0–120°.
- Sources: beachcam.meo.pt/livecams/arrifana/ · surf-forecast.com/breaks/Arrifana · wannasurf arrifana · mondo.surf/surf-spot/arrifana/guide/4964 · thesurfatlas.com/surfing-portugal/arrifana-surf/

## Sintra

All four MEO panels are identical boilerplate (W|NW swell, E|SE wind, all tides), so they were used only where they're specific.

**praia-das-macas** (M)
- Swell: NW best.
- Wind: E–ESE.
- Tide: conflicting. Surf Atlas and surfnerd say lower tide, rising; MEO, mondo and wannasurf say all tides.
- Character: a small bay with rocks at both ends, A-frames, and wedgy lefts by the stream mouth. Intermediate; crowded.
- Facing: OSM 290–297°, satellite 301°.
- Changed: facing 300°, wind 60–150°, tide 0.1–0.6 rising.
- Sources: MEO praia-das-macas · surf-forecast.com/breaks/Praiadas-Macas · surfnerd praia-das-macas · mondo 5043 · wannasurf praia_das_mas · thesurfatlas.com/surfing-portugal/praia-das-macas/

**praia-grande-norte / -sul** (M)
- Swell: W–NNW, with NW best.
- Wind: E, workable ENE–SE. The south end has some shelter under the cliffs.
- Tide: all tides, rising better. High tide dumps (surfnerd).
- Character: the most consistent beach on this coast, powerful, with strong rips. Intermediate and up.
- Facing: OSM 293–305°, satellite 294° (north) and 302° (south). The old facings were about 40° out.
- Changed: facings 294° and 302°, swell 260–350°, wind 60–150° (north) and 60–160° (south), tide 0.2–0.8 rising.
- Sources: MEO praia-grande · surf-forecast.com/breaks/Praia-Grande · surfnerd praia-grande-lisbon · mondo 5033 and 5025 · wannasurf praia_grande and praia_pequena · thesurfatlas.com/surfing-portugal/praia-grande-portugal/ · worldbeachguide.com/portugal/surf/praia-grande.htm

**adraga** (M)
- Swell: WNW. Wannasurf and mondo also list N and NE.
- Wind: SE–E.
- Tide: low to mid, rising. Three sources agree.
- Character: short, hollow, ledgey peaks over sand and rock. Intermediate to experienced.
- Facing: OSM about 300°, satellite 298°.
- Changed: facing 298°, swell 260–350°, wind 70–170°, tide 0.15–0.6 rising.
- Sources: MEO praia-da-adraga · surf-forecast.com/breaks/Adraga · wannasurf adraga · mondo 5024

## Cascais / Oeiras

**guincho-norte / -sul** (H for swell, wind and bottom; M for tide)
- Swell: W–NW (MEO); NW "gets in almost 100%" (Surf Cascais).
- Wind: E, with S also good (MEO "E | S", Surf Cascais).
- Tide: conflicting (all tides vs low to mid), so it's left unchanged.
- Character: the indicator beach for Lisbon. Sand with rocks; strong rips running north.
- Wind problem: the nortada blows it out on summer afternoons.
- Facing: satellite 277° (north) and 289° (south); surfnerd says WNW.
- Changed: facings 277° and 289°, wind 60–170°.
- Sources: MEO praia-do-guincho and praia-do-guincho-norte · surf-forecast.com/breaks/Praiado-Guincho · wannasurf guincho · surfnerd praia-do-guincho · thesurfatlas.com/surfing-portugal/praia-do-guincho/ · surfcascais.com · ericeirasurfhouse.com

**cresmina** (L–M)
- Swell and wind: as Guincho (MEO W–NW swell, E wind).
- Tide: sources conflict, so it's set wide at 0.1–0.8.
- Character: mixed sand and rock; quieter than Guincho.
- Changed: facing 289°, wind 60–170°, tide 0.1–0.8.
- Sources: MEO cresmina · wannasurf Cresmina · portugalsurfspots.com · ericeirasurfhouse.com

**sao-pedro-estoril** (M)
- Bico: a long, fat right point over flat rock and sand, popular with longboarders.
- Bafureira: a reef A-frame.
- Swell: SW–W, or a big long-period NW.
- Wind: N–NE.
- Tide: the falling preference applies only to Bafureira; Bico likes low and rising. So there's no preference.
- Changed: facing 188° (was 180°), tide 0–0.6.
- Sources: MEO sao-pedro-do-estoril and bafureira · wannasurf Sao_Pedro, bico, bafureira · surfnerd bica · mondo 5041 · thesurfatlas.com cascais-surfing

**parede** (M–H)
- Character: a right-hand reef over sharp rock, short and hollow.
- Swell: needs a big W–SW swell and rarely breaks (MEO "Baixa"; surf-forecast 2/10).
- Wind: N–NE.
- Tide: around low.
- Changed: facing 198°, size 1–2.5 m.
- Sources: MEO parede · surf-forecast.com/breaks/Parede · wannasurf parede · mondo 5026 · surfnerd parede

**carcavelos** (H)
- Swell: SW–W. A NW swell barely reaches it; a big W makes it unsurfable.
- Wind: N–NE.
- Tide: mid, rising.
- Character: mostly lefts with shifting sandbars, and slabby lefts by the fort. Very crowded.
- Changed: facing 205°, size 0.6–2.5 m.
- Sources: MEO praia-de-carcavelos and carcavelos-calhau · surf-forecast.com/breaks/Carcavelos · surfnerd carcavelos · wannasurf carcavelos · thesurfatlas.com · surftotal.com item 26712

**santo-amaro** (M–H)
- Character: a fast, powerful, tubing right-hand point over a reef plateau. The wave the Salvem o Surf campaign saved.
- Swell: a big SW–W.
- Wind: N–NW.
- Tide: mid to high (MEO "Cheia").
- Level: low frequency; urchins; localism.
- Changed: facing 187°, size 1–2.5 m, exposure 0.35, wind 300–60°, tide 0.45–1 rising.
- Sources: MEO santo-amaro · surf-forecast.com/breaks/Santo-Amaro · wannasurf santa_amaro · surfnerd santa-amaro · en.wikipedia.org/wiki/Salvem_o_surf

## Caparica, Fonte da Telha, Meco, Bicas

The Caparica beaches fall into three stretches:
- **São João:** open sand, softer, mid to high tide.
- **The groyne field (CDS, Praia Nova, Praia do Norte, Tarquínio):** 7 groynes, EC1–EC7. Short, mostly right-hand wedges off the rocks, and it can't hold much size.
- **South of Praia Nova (Saúde, Riviera, Casa do Sol, Infante):** open sandbanks, emptier, often the best banks.

No source backs "best on the push", so the shared tide preference is gone. About 1,000,000 m³ of sand was placed from São João to Saúde in 2026, so the banks will have reset. Facings come from space: 234–252°.

- **caparica-sao-joao** (M): tide 0.4–1 (mid to high).
- **caparica-cds** (M): size 0.6–1.8 m. It can't hold mid-size swell, per a wannasurf commenter.
- **caparica-praia-nova** (L–M): size 0.6–1.8 m. A right off the last groyne.
- **caparica-saude / -riviera / -casa-do-sol / -infante** (L): size 0.6–2.2 m. Casa do Sol may be "Poste" on wannasurf; its placement is unverified.
- **fonte-da-telha** (M):
  - Tide: low to mid.
  - Size: holds a bigger swell than the town beaches.
  - Rips: two permanent rip channels since the 2025–26 storms (local blog, June 2026).
  - Changed: size 0.8–3 m, wind 30–140°.
- **meco** (M):
  - Character: a powerful, hollow shorebreak wedge with notorious rips. Low to mid tide.
  - Changed: facing 280° (was 260°), size 0.6–3 m, wind 40–150°.
- **bicas** (M):
  - Character: sand and rock reef; the left is usually better; it needs a solid swell.
  - Level: urchins, localism; for experienced surfers.
  - Changed: facing 290° (was 265°), size 1–3 m, wind 50–160°, tide 0–0.6 rising.
- Sources:
  - MEO: costa-da-caparica, costa-da-caparica-cds, costa-da-caparica-praia-nova, costa-da-caparica-riviera, costa-de-caparica-sao-joao-cova-do-vapor, fonte-da-telha(-sul), praia-do-meco, praia-das-bicas
  - wannasurf and mondo pages for each beach
  - surf-forecast: Sao-Joao, Praia-da-Saude, Fonte-da-Telha, Praia-do-Meco, Bicas_1
  - surfnerd bicas
  - playocean.net beach pages
  - thesurfatlas.com costa-da-caparica-surf
  - theportugalguides.com costa-da-caparica-surf
  - palavrassalgadas.wordpress.com/2026/06/19/o-mar-da-fonte-da-telha-esta-diferente/
  - visitsesimbra.pt/praias/293
  - stormrider.surf/region/lisbon

## Ericeira

The World Surfing Reserve's own material covers Pedra Branca, Reef, Ribeira d'Ilhas, Cave, Crazy Left, Coxos and São Lourenço, but not Matadouro, Praia do Sul, Foz or São Julião.

- **ribeira-d-ilhas** (H):
  - Character: a right point over reef, 150–300 m. Beginners on small days, holds a big swell.
  - Swell: NW best.
  - Tide: mid.
  - Changed: facing 249° (was 275°; OSM 253–260°), swell 260–340°, size 0.6–3.5 m.
- **matadouro** (M):
  - Position: in front of the Boardriders skatepark, about 1 km north of Ericeira's Praia do Norte.
  - Character: a reef and sand A-frame; the right is the wave. Mid tide (too little water at low); dumpy when big.
  - Changed: facing 270° (OSM 262°, satellite 273°), swell 250–340°, size 0.8–2.5 m, tide 0.3–0.8.
- **ericeira-sul** (M–L):
  - Character: sheltered, so it needs a bigger NW swell; best at lower tide.
  - Changed: facing 250°, size 1–2.5 m, wind 40–130°, tide 0.1–0.6.
- **foz-do-lizandro** (M–L):
  - Character: a river-mouth beach break and learner spot.
  - Tide: badly conflicting, so the 0.2–0.8 compromise stays.
  - Changed: facing 292°, swell 230–330°.
- **sao-juliao** (M):
  - Character: the swell magnet, easily maxed out. Low to mid tide.
  - Position: the main peak is about 250 m north of the old point.
  - Changed: position 38.932, −9.420; facing 278°; exposure 0.95; size 0.6–2.2 m; tide 0–0.7.
- Sources:
  - MEO: ribeira-dilhas, matadouro, ericeira-praia-do-sul, foz-do-lizandro, sao-juliao
  - surf-forecast, surfnerd, mondo and wannasurf pages for each
  - thesurfatlas.com/surfing-portugal/ericeira-surf/
  - sunshineseeker.com/destinations/ericeira/
  - lapointcamps.com/blog/top-6-surf-spots-in-ericeira-portugal
  - worldbeachguide ribeira-dilhas
