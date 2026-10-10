# Places and hazards (DDB-442)

Date: 2026-10-10. Code: `src/renderer/game/map/` (`Hazards.ts`, `Places.ts`, `PlaceNames.ts`, `Highways.ts` for growth's departures, `Terrain.ts` laying the hazards over the land; `AreaMapPipeline.ts` runs the stages; `worker/mapGenerationProtocol.ts` carries them across the worker boundary), and `ui/areaMap/` (`AreaMapView.ts`, `terrainBake.ts`), timed and drawn by `scripts/road-growth.mjs places` and `png`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Seeds and determinism, Pipeline, 3. Biomes, hazards, and cost, and 4. Settlements. Builds Map 6 of [realistic-map.md](./realistic-map.md) on the water of [water-and-biomes.md](./water-and-biomes.md), and replaces terrain-fields.md's town placement and the old `highways` stand-in stage.

## Context

Map 5 left towns and hotspots in the terrain stage, before the water: lakes kept off them, but rivers ran wherever they liked, and towns were dart-thrown over ground a road could reach with no regard for valleys or rivers. The spec puts both after the water, in a `hazards` stage and a `places` stage, on streams of those names (Seeds and determinism), and says where places go: the metro; towns and villages by a suitability score, best first, spaced; crossroads Poisson-spaced by `roadDensity`; and exits at the rim. Road links (Maps 7 and 8) join the places, so the places have to be plain data that crosses the worker boundary, and every one has to be somewhere a road can reach. Until those maps land, the old outward growth still builds the roads.

## The stages

The pipeline runs terrain, water, hazards, places, then growth. Hazards draw from `root.fork('map', m).fork('terrain', t).fork('water', w).fork('hazards', h)`, places one level down, and growth one more. The `highways` stage is gone: its job, where highways leave the metro, now follows from the places' highway exits.

Each stage forks its stream by feature and never draws from it directly: hazards on `hotspots`; places on `suitability`, `towns`, `villages`, `exits`, `crossroads`, and `names`. Asking for more villages never moves a town or an exit, and naming never moves a place. The spec lists `names` among the streams; here it's a fork of the places stream, since names belong to places and a stage of its own would only add a link to the chain.

## Hazards

`generateHazards({ params, terrain, rng })` reads `water.terrain` and returns `Hazards`: its `hotspots`, plain data, and `hazards.terrain`, the land with its water and these hazards (`terrain.withHazards`), what every stage after reads. `Hazards` is the terrain's `HazardLayer`: a crater test and the plumes added to the contamination, the same arithmetic in the same order as before, so a hotspot contaminates exactly as it did.

The rules are Map 5's, kept for parity: centres past the blend radius by the largest crater and inside 0.9 of the radius, a quarter of the radius apart, and no cell within two cells of the crater carrying 40 cells of the land's drainage, so no crater sits on a river. One rule turned round: lakes used to keep a cell and 20 units off craters; now craters keep that far off lakes, since the lakes come first. The draws are the same calls on the `hotspots` fork, now of the hazards stream rather than the terrain's, so every seed's craters move.

Two things followed from taking hotspots out of the terrain stage:

- Badlands weigh the map's contamination noise, not the plumes, since the terrain stage builds them before any hotspot exists. Their share is calibrated as before, so the map has as much badlands, a little less of it round craters.
- The terrain no longer knows its towns, its craters, or its ruins. `Terrain.towns`, `ruin`, `surelyReachable`, and `TerrainSample.ruin` are gone; `Terrain.hotspots` reads the hazard layer, empty before it's laid.

## Where a road surely reaches

The terrain keeps `openSquares`: per square between land cell centres, whether no cliff stands in it and it lies wholly inside the disc. A cliff is rough and steep at once, each read bilinear, which can't pass the largest of a square's four corners, so a square whose corners are all under the rough threshold, or all under the cliff threshold, holds no cliff. The places stage floods from the metro over those squares, less any a crater reaches into and any with a lake cell at a corner. A lake's shore lies between its cells and their dry neighbours, so a square with four dry corners holds no lake; rivers don't stop the fill, since roads bridge them. The fill is exact for cliffs, craters, and lakes, and costs a pass over the squares, a millisecond or two.

The old towns' fill kept off every square with a rough corner, which walls off far more than the cliffs do: rough country is a tenth to a third of the land past the relief radius, cliffs a few percent. Run that way, the fill missed stretches of the rim a road can get to, and exits held to it needed a retry on a quarter of campaign maps.

A cell is usable when the four squares round its centre are reached, its centre keeps 4 units off any river's water (`Water.nearRiver`, exact: the river index scans the buckets within reach) and off rough country, and it's outside the ranges' heart (a range mask under 0.5). Towns, villages, and crossroads stand only on usable cells, at their centres, and exits on reached squares (below), so every place is reachable from the metro, across rivers by bridges.

## Suitability

Every usable cell gets a score:

- 1.2 for level ground, falling to nothing at a grade of 0.25, the eroded grid's grade from its neighbours either side;
- 0.6 times the water's low ground, the valley floor;
- 1.1 beside a river or lake, falling to nothing 60 units off by a chamfer distance over the cells, half as much for a creek at the stream threshold as for a river four steps of the square root of its area's multiple of it or more, and three quarters for a lake;
- 0.6 near a confluence, a river cell with two river cells draining into it, falling to nothing 90 units off;
- less 0.8 a unit of elevation and 1.2 of the range mask;
- plus 0.4 of an even draw per cell, drawn for every cell in order so one cell's noise never depends on another's.

The prototype's terms, with its Gaussians made smoothsteps so the score is exact arithmetic. Over five environments by three seeds at radius 1000, every town and village sits within 60 units of river water, at a median of 10, against a median of 75 for the passable land between 300 and 900 units out.

## Towns and villages

Taken best first, ties by cell index, each kept when it's its kind's spacing from the others of its kind and from those placed before (towns a quarter of the radius apart, villages a tenth from villages and towns), past the metro's edge by 0.8 of its spacing, with its ruins outside the blend radius, inside 0.92 of the radius, 20 units clear of every crater, and a cell clear of every lake. The checks use the largest ruins a kind can draw, so one pass down the ranking settles them; each place's ruins are drawn once it's placed: a town's a quarter to 0.4 of the metro's radius and at least 20 units, as before, a village's 0.08 to 0.14 and at least 8.

Where the land has no room, fewer are placed: the old placement's fallback walk, which put a town anywhere a road reached once the good ground ran out, is gone, since the spec rules out the ranges' heart. At the tuning range's most mountainous corner, coverage 1 at radius 600, no town fits; across the campaign ranges every map gets all it asks for (`road-growth.mjs places`, below).

Names come from a first part and an ending, 35 by 22 (Ashford, Cold Springs), none repeated on a map, and no first part used twice while one is left, so a map doesn't fill with Copper this and Copper that. Placeholder words until the atlas or a writer gives regions their own.

## Crossroads

Usable cells no steeper than a grade of 0.6, inside 0.93 of the radius and past the metro's edge by half the spacing, in an order shuffled from the `crossroads` fork, each kept when it's the spacing from every crossroads before it and three quarters of it from every town, village, and exit. The spacing is the spec's, 140 units at `roadDensity` 0 to 70 at 1. A spatial hash keeps it fast. That's dart throwing to a jam over the usable land: at radius 1000 a median of 135 crossroads over five environments by three seeds, 109 to 167, against the prototype's "about 100", which ran over less land; four times as many at `roadDensity` 1 as at 0, give or take the edges.

## Exits

Highway exits take the old departures' bearings, `highways` of them, evenly spread, turned, and jittered a third of the gap, at least `highwaySeparation` apart (`exitBearings`, moved from `Highways.ts`). Each sits a cell and a half in from the rim, so the square under it lies wholly inside the disc, and slides up to 8 degrees either way, a degree at a time, to the bearing with the least grade, averaged there and a cell further in, plus 0.0175 a degree slid. A point only counts when the square under it is one the flood fill reached and no river's water lies within 4 units of it. Where a cliff band, a lake, or a river runs along the rim on a bearing, the exit comes in along it a cell at a time, up to six cells, to the first point that counts, paying 0.02 of grade a cell, so a sliver of land cut off between a lake and the rim no longer holds an exit. Over QA's 150 campaign-range maps, 55 of 1,905 exits came in; at nine highways 40 degrees apart over 120 tuning-range maps, 102 of 2,159. An exit slides at most half its slack toward a neighbour, so two sliding toward each other still keep the separation.

Where some highway exit finds no such ground within its slide, the whole set turns a degree at a time, either way, up to half the gap between exits, which keeps every gap and so the separation, until every exit finds some. That's what lets nine highways 40 degrees apart, which have no slack to slide in, find their ground. Only when no turn works do the highways keep their drawn bearings, off reached ground, for the stage's check to catch. Before exits could come in, nine highways at 40 degrees on a rugged 600-radius map found no turn that worked, and the stage spent its eight attempts before the map restarted.

A back-road exit goes in each gap between highway exits 30 degrees wide or more, near its middle (up to half its room either way, drawn on the `back` fork at the gap's index), slid the same way, and at least 12 degrees from either highway exit; one that finds no reached ground within its slide is left out. Every gap is at least `highwaySeparation`, so at a separation of 30 or more every gap takes one where the ground allows, six back roads at the default six highways; under that, a gap the jitter squeezes below 30 takes none.

### The stage's check

`PLACES_STAGE` checks its output with `checkPlaces`, built from the land, its water, and its hazards alone: every place but the metro has to stand on a square the flood fill reaches and out of river water, or the stage fails, and the runner reruns it on its next stream, a fresh draw of bearings and turn. Past its eight attempts the map restarts, as for any stage. Over QA's 150 campaign-range maps, its 120 across the tuning ranges, the same 120 again at nine highways 40 degrees apart, and `road-growth.mjs check`'s 50, the check never failed: no retry, no restart, every exit reached by a 4-unit flood fill from the metro and none on impassable ground. Over five environments by three seeds at radius 1000, the exits' median grade is 0.038 against 0.059 for the reachable rim at large.

## The data: what Maps 7 and 8 read

```ts
interface Places {
	readonly metro: Metro;                       // { id: 0, kind: 'metro', x: 0, y: 0, radius }
	readonly towns: readonly Settlement[];       // { id, kind: 'town', x, y, radius, name, suitability }, best ground first
	readonly villages: readonly Settlement[];    // { id, kind: 'village', ... }
	readonly crossroads: readonly Crossroads[];  // { id, kind: 'crossroads', x, y }
	readonly exits: readonly Exit[];             // { id, kind: 'exit', x, y, bearing, highway }, highways first, counterclockwise
}
```

`placeList(places)` lists every place in id order, the metro first, then towns, villages, crossroads, and exits, which is what a Gabriel graph over places wants. `ruinsOf(places)` is the metro, towns, and villages, what the bake shades. Positions are world units with the compound at the origin; an exit's bearing is degrees counterclockwise from east. Everything is frozen.

## The old growth on the new places

Growth keeps its own rules. Its highways now leave the metro toward the highway exits: `highwayDepartures` puts each on the metro's edge on its exit's bearing, with its drift drawn on the growth stream's `highways` fork at its index. Nothing else changed, so growth doesn't aim at the exit's slid point or route through towns; Map 7's least-cost highways from the exits do. `node scripts/road-growth.mjs check --maps 50` finds no map failing a first attempt, and the property tests pass.

## Crossing the worker boundary

The hotspots and the places are small and go by structured clone beside the land's and water's transferred arrays. `decodeAreaMap` rebuilds the hazards over the decoded water from the hotspots (`new Hazards`), and refreezes the places. Nothing the client does reruns the places stage.

## Rendering

`AreaMapData` takes the places, optional, and the view draws them on a `places` layer between the roads and the compound, a constant size on screen: towns a dark dot with a white ring and their name, villages a smaller one named once the zoom passes 0.6 pixels a world unit (a 1000-radius map fitted to the screen is about 0.34), crossroads a small grey dot, and exits a dark ring. A place under the fog isn't drawn. The bake shades the ruins it's given, the metro's, towns', and villages', darker out to twice their radius. Map 19 restyles all of it.

## Determinism

Everything on the gameplay path is adds, multiplies, divides, compares, and square roots; bearings become unit vectors through `unitVector`. Sorting the ranked cells breaks ties by index. The tests pin two maps' places and hotspots as hashes of their coordinates, with their counts and town names, computed in a separate Node process from the Jest run that checks them. The terrain's pins move (badlands and contamination at the old plumes), and so do the water's (lakes no longer keep off towns and craters).

## Performance

`node scripts/road-growth.mjs places --seeds 3 --repeat 2`, Node 24 on the shared desktop, medians over five environments by three seeds, each map's fastest of two runs:

| Radius | Hazards, ms | Places, ms | Slowest places, ms | Crossroads |
| --- | --- | --- | --- | --- |
| 600 | 0.1 | 6.1 | 11.2 | 34 to 51 |
| 1000 | 0.0 | 20.2 | 26.3 | 109 to 167 |
| 1600 | 0.0 | 51.0 | 75.4 | 282 to 425 |

Most of the places stage is per-cell passes over the land grid (the grade, three chamfer distances, the flood fill, the score) and sorting the scored cells. Its check floods the squares again, a millisecond or two. It runs once in the worker; the client only clones the result.

## Consequences

- Every map moves: its hotspots, its lakes (which no longer keep off towns and craters), its badlands near the old plumes, its towns, and with the departures its roads.
- `Terrain.towns`, `Terrain.ruin`, `Terrain.surelyReachable`, `TerrainSample.ruin`, `placeTowns`, `planHighways`, and the `highways` stage are gone; `Terrain.openSquares`, `Terrain.withHazards`, and `Water.nearRiver` are new.
- The POI stage (route-tree-and-pois.md) reads the land from the hazards stage, craters and all, and ruin from the places through `poiGround`: `ruinAt` over the metro, towns, and villages, where it read the terrain's metro and towns. Villages count as ruins now, which nudges the POIs that look for ruin.
- On very mountainous maps fewer towns and villages are placed than asked for.

## Provisional calls

Calls the spec and realistic-map.md left to the build, made the simplest way consistent with them, for Kevin to approve or adjust:

1. Hazards keep Map 5's crater rules; craters keep a cell and 20 units off lakes, the old lake clearance turned round.
2. Badlands weigh the contamination noise without the plumes.
3. Suitability: 1.2 for level ground, gone at grade 0.25; 0.6 of low ground; 1.1 beside a river or lake, gone at 60 units, half for a creek, full at four steps of the square root of the area's multiple of the threshold, three quarters for a lake; 0.6 near a confluence, gone at 90 units; less 0.8 of elevation and 1.2 of the range mask; none where the mask reaches 0.5; plus 0.4 of an even draw per cell.
4. Towns a quarter of the radius apart and villages a tenth, villages that far from towns too; past the metro's edge by 0.8 of their spacing; ruins outside the blend radius, inside 0.92 of the radius, 20 units off craters, and a cell off lakes; a town's ruins a quarter to 0.4 of the metro's radius, at least 20, a village's 0.08 to 0.14, at least 8. Fewer places where there's no room, never one in the ranges' heart.
5. Place centres 4 units off any river's water and off rough country, on cells whose four squares a flood fill from the metro reaches past cliffs, craters, and lakes.
6. Crossroads on usable cells no steeper than grade 0.6, inside 0.93 of the radius, past the metro's edge by half their spacing, three quarters of it from towns, villages, and exits.
7. Exits a cell and a half in from the rim, or up to six cells further in at 0.02 of grade a cell, on a square the flood fill reaches and 4 units off river water, slid up to 8 degrees in 1-degree steps to the least grade averaged there and a cell in, plus 0.0175 a degree slid, each at most half its slack toward a neighbour; the whole set turned a degree at a time, up to half a gap either way, when some highway exit finds no such ground; a back-road exit in each gap of 30 degrees or more, up to half its room either side of the middle, 12 degrees or more from a highway exit, left out where it finds no such ground.
8. Names from 35 first parts and 22 endings, unique on a map, no first part repeated while one is left, numbered past the 770 pairings.
9. Places drawn plain: towns 5 pixels with their names, villages 3.5 named from a zoom of 0.6, crossroads 2, exits a 4-pixel ring; none under the fog.
