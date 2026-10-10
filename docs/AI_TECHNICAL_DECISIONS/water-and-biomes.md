# Water, biomes, hazards, and the cost of a move (DDB-289)

Date: 2026-10-09. Code: `src/renderer/game/map/` (`Water.ts`, `Rivers.ts`, `Lakes.ts`, and `Terrain.ts` laying them over the land; `AreaMapPipeline.ts` runs the stage; `worker/mapGenerationProtocol.ts` carries it across the worker boundary), and `ui/areaMap/` (`terrainBake.ts`, `riverGeometry.ts`, `AreaMapView.ts`), timed by `scripts/terrain-bench.mjs`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 2. Water and 3. Biomes, hazards, and cost. Builds Map 5 of [realistic-map.md](./realistic-map.md) on the land of [terrain-erosion.md](./terrain-erosion.md), and replaces its canyon, badlands, and lowland stand-ins and terrain-fields.md's moisture layer, rough-country lattice, and biome costs.

## Context

Map 4 left the water stage a frozen `LandSurface`: the eroded grid, its range mask, and the finished land's drainage as typed arrays, plus a list of what it wanted done (terrain-erosion.md, What the water stage gets). The spec's sections 2 and 3 say what to build: drainage with rain weighted by moisture and the ranges, rivers traced from a stream threshold set by `riverDensity` and given a meander by `riverMeander`, width by drainage area, `lakes` reservoirs dammed in valleys, natural lakes where the land holds water, moisture from `aridity`, noise, the rivers, and height, biomes as categories the game reads with the colour a blend, hotspots, cliffs only in rough country, and a cost of moving along the land rather than of standing on it.

The constraints were Map 4's. Everything that feeds the gameplay map is exactly rounded arithmetic, so a seed's water is the same in every engine and regenerates on load; the map folder's lint holds that. The old outward growth keeps running until Map 7 replaces it, on the new costs. And the water has to cross the worker boundary as plain arrays, the way the land does.

## The stage

The pipeline runs terrain, water, highways, growth. Water draws from `root.fork('map', m).fork('terrain', t).fork('water', w)`, forked by feature: `moisture`, `flats`, `reservoirs`, and `meander`. It never draws from the stream itself, so a reservoir's draws never move a meander.

`generateWater({ params, terrain, rng })` returns a `Water`: its `surface`, a frozen `WaterSurface` of plain data, and `water.terrain`, the land with the water laid over it through `terrain.withWater(water)`. The terrain stage's own product stays the land alone, and every stage after water reads `water.terrain`. `Water` is the real `WaterLayer`; a test can stand in its own.

Until water is laid, a terrain's moisture is the map's level by `aridity`, its low ground and canyons are nothing, and so it has no mire and no canyons. Nothing after the water stage reads that land-only terrain except to build on it.

## Moisture before the rivers, and rain

Moisture per cell starts as the map's level, `moistureLevel(aridity)`, plus 0.55 either way of a 650-unit, 2-octave noise layer, less 0.6 per unit of elevation: the spec's level, broad noise, and drier with height. The noise moved from the terrain stream's `moisture` fork to the water stream's, since moisture is now the water's.

Rain is 0.5 plus that moisture, times one plus 0.6 of the range mask: wet country rains more, the ranges most. It runs from 0.5 to 2.4 a cell.

## Routing again, with the flats broken

The land's drainage runs eight ways only, and where Map 4 fills the metro's standing water it leaves dead-flat ground the priority flood crosses cell by cell. Of the two fixes Map 4 named, this takes the second: route the finished land once more with a little noise added, one 80-unit octave of 0.0015 of elevation, 0.15 world units, whose steepest grade is under a hundredth. Garbrecht and Martz's flat resolution gives each flat a gradient toward its outlet, which still drains a big flat in parallel straight lines; noise gives every flat its own small relief, so the water wanders. On any real slope the noise is too small to matter, so rivers stay in the valleys erosion cut.

Measured as the longest run of cells inside the metro, of those with 20 cells' drainage or more, each draining the same way as the cell before it: High Desert's seed 42 at radius 1000 goes from 28 cells to 16, and the most rugged corner's seed 3 from 36 to 12. A test holds both under 70% of the land's own run.

The cost is that a river no longer follows the land's receivers exactly: a cell can drain to a neighbour up to twice the noise's amplitude higher than itself, or up its pit to where it spills. The test of water running downhill allows that much and no more.

Rain-weighted drainage area comes from the new routing (`routeDrainage` with the rain), not `accumulateArea` over the land's receivers, since those are the receivers the flats run straight on.

## Rivers

A river cell is one whose rain-weighted area passes the stream threshold, 700 cells of rain at `riverDensity` 0 to 110 at 1, 405 at the default: about the prototype's density on these maps. Area isn't per world unit, and the land grid's cells are about 9.4 units on any map, so one threshold serves every radius.

Tracing (`traceRivers`): at a confluence the river carries on from its biggest tributary, ties to the lower cell, and the others end on the cell where they join. So a main river is one chain from its source to where it leaves, and every river cell is in exactly one chain. A river reaching a lake ends on the lake's first cell, and one leaving a lake starts on its last. A river ends at a confluence, in a lake, at an outlet on the edge, or, on a closed basin, at its sink.

Each chain becomes a line (`riverPolylines`): the cell centres simplified by Douglas-Peucker at 0.6 of a cell, which takes out the eight-direction staircase, three passes of Chaikin, then the meander, a sideways offset of up to 1.4 cells at `riverMeander` 1 from 90-unit noise along the river, full on ground flatter than grade 0.015 and none past 0.06, tapering over 30 units at each end. Tributaries are drawn after the river they join and end on its line, the nearest point to their meeting cell, so every confluence touches. Width is 1.2 units at the threshold, plus 0.75 for each step of the square root of the area's multiple of it, up to 9, read off the chain's cell the same share of the way along by length. A river rising where many small flows meet on flat ground starts already broad, so a river widens from 1.2 over its first 40 units.

The lines are where the water is. `RiverIndex` files each segment in 16-unit buckets, and a point is in a river within half the river's width there of the centreline, the width running straight between a segment's ends. It also finds every centreline a move crosses, with how far along the move, the width there, and the sine of the crossing angle, which is what bridges are made of. So the picture, the save's polylines, and play all read the same lines.

## Lakes

Natural lakes come first, from Map 4's sites: components of cells whose land drainage level stands more than 0.01 units above them, at least 4 cells, at least 0.25 units deep somewhere, in country whose moisture before the rivers averages 0.55 or more. Their level is the land's own fill level, cell by cell.

There are few of them. Erosion drains wet, gentle country thoroughly, so Floodlands has hardly any pits: at radius 800 seed 5 has one of 10 cells and seed 43 one, both past the rim, and seed 41 none. Rugged maps keep more, mostly in the grid's margin: Mixed seed 7 at radius 1000 has pits of 1,149, 219, 71, and 67 cells, all past the rim. So natural lakes appear mostly on wet rugged maps, and the Floodlands' lakes are its five reservoirs.

Reservoirs, `lakes` of them (`placeReservoirs`): candidate dams are river cells whose area is 3 to 80 times the threshold, rivers worth damming short of the main stems, in a valley at least 0.8 units deep three cells either side, past the relief radius and inside 0.88 of the radius. They're tried in an order shuffled from the `reservoirs` fork, up to 120 floods, 0.25 of the radius apart. Each draws a target size of 30 to 220 cells, and the level is the highest, up to 30 units above the dam, whose lake stays within that size, found by halving: a lake is every cell upstream of the dam, through the water's routing, lower than the level and reached through cells lower than it, so it floods up the valley and its side branches and never spills over a ridge or downstream. A lake that reaches a blocked cell or another lake is too big, and the halving lowers it. A reservoir under 30 cells or 0.5 units deep at its dam is dropped.

The valley's depth is in world units, and this land is gentle in them: at radius 1000 a candidate's valley is 1.4 units deep at the median on Mixed and 0.8 on Floodlands. The prototype's dams of 8 to 16 units would flood whole basins here, so the size target, not a depth, sets a reservoir.

Lakes keep off the metro's blend radius, a cell and 20 units past every town and crater, and the grid's outermost cells, where drainage leaves; and a cell of land from every other lake, so two lakes never run together.

The map reads lakes off a depth field per cell: under a lake its level less the land, at least 0.002; just past its shore the level less the land there, at most -0.002; elsewhere -1. Read bilinear, its zero is the shore, which follows the land's contour at the level between a lake's cells and its dry neighbours. `lakeOf` names each cell's lake. Each reservoir keeps its dam, the dam cell's centre and the way the river leaves through it, a natural POI site for Map 10.

`lakes` 0 is a map with no standing water at all, natural lakes included. `rivers` 0 is a closed basin: its rivers end at the sink and none leaves the map.

## Moisture, low ground, and canyons

One walk down the water's routing, downstream first, gives every cell the river or lake its drainage reaches first, how far along the drainage, and how high above its surface (`nearestWater`). The height is height above the nearest drainage, which hydrology calls HAND and which is what "low ground beside a river" means.

- Wetness spreads from the water: 0.5 for a creek at the threshold, 0.1 more for each step of the square root of the area's multiple of it, up to 1, and 1 beside a lake, fading to nothing 120 units along the drainage and 12 units above the water. Moisture is the moisture before the rivers plus 0.35 of it.
- Low ground (`lowland`) is 1 at the water's level, falling to 0 three units above it, half at 1.5. It replaces Map 4's lowland level, the elevation 55% of a map's land lay under. The land is gentle in world units, so most of it sits a few units above its drainage: outside the ranges, lowland's median runs 0.28 to 0.66 by environment and seed.
- Canyons are the deepest river valleys on dry maps: a river cell's cut is how deep a valley it runs in, below the lower of the cells three away either side across its deepest direction, and the cells within 24 units of it along the drainage and below that rim share it. It's calibrated as Map 4's were, 10% of the land outside the ranges at a dryness of 0.55 and up, none at 0.45 and under, none in the metro, easing in to the relief radius. Where the river valleys hold less than that share, all of them are canyons (`positiveQuantile`).

## Biomes

The thresholds are terrain-fields.md's, unchanged: mountains, canyons, mire (low ground of a half or more, moisture plus a quarter of contamination 0.75 or more), badlands (and moisture under 0.6), desert (moisture under 0.3), scrub. What changed is the fields under them: moisture, low ground, and canyons from the water, and badlands from the eroded slope (below).

Seed 7 at radius 1000, as shares of the disc, against Map 4's stand-ins:

| Environment | Mountains | Scrub | Desert | Mire | Badlands | Canyons | Map 4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mixed | 24 | 43 | 10 | 14 | 5 | 3 | 24, 45, 12, 9, 6, 3 |
| High Desert | 34 | 18 | 32 | 1 | 10 | 6 | 34, 15, 38, -, 8, 6 |
| Rust Belt | 14 | 49 | 10 | 23 | 5 | 0 | mire 17 |
| Floodlands | 9 | 43 | 0 | 47 | 1 | 0 | mire 41 |
| Badlands | 34 | 20 | 18 | 6 | 17 | 6 | 34, 21, 21, 4, 16, 6 |

Seed 3 lands within about three points of these on every environment. Rivers cover about 1.1% of the disc and lakes up to 1.5%.

The bake draws no biome at all: the land's colour is a continuous blend of moisture (buff, khaki, sage), height (grey-brown from elevation 0.2 to 0.6), and contamination (rust, up to 0.45 of the way), read on the colour lattice and interpolated, so country shades from one kind to the next. The game still reads the categories.

## Rough country and cliffs from eroded slope

Rough country was terrain-fields.md's 16-unit lattice of noise islands, unrelated to the land under it. Now it's the steep land: the eroded grid's grade averaged over a cell each way, `ruggedness`'s share of the land past the relief radius, 10% to 35% as before, calibrated by quantile. Steep land runs in belts along the ranges, so the grade is swayed by 0.7 of a 300-unit, 2-octave noise layer (the terrain stream's `roughness` fork) before the quantile, which breaks a belt into stretches with gaps. Cliffs stand where rough country reaches grade 1, as before.

The land grid's cells carry the measure, read bilinear. A bilinear value can't pass its corners, so a square between four cell centres all under the threshold has no rough point in it, and the flood fill from the metro over those squares, wholly inside the disc and clear of craters, is exact: `surelyReachable` is as sufficient as the lattice's was, on 9.4-unit squares instead of 16-unit cells. Towns take candidates only from reached squares whose eight neighbours are reached too, a square clear of rough ground, since a town's centre a unit from a cliff passed the old test and failed the 4-unit flood fill's.

Badlands use the same averaged grade, without the noise, weighted toward toxic ground (0.3 plus 0.7 of the cell's contamination), outside the ranges by Map 4's clearance, at the field model's share, 0.7 x ruggedness x (0.3 + 0.7 x contamination) of the land outside the ranges.

The cost: rough country is no longer independent of slope, so nearly all the steep ground is in it, and more of it is cliff. Over the disc at radius 1000, seed 7: Mixed 5.1%, High Desert 7.2%, Rust Belt 1.9%, Floodlands 0.6%, Badlands 10.1%, against 0% to 3.6% on the lattice. Ranges come out walled; on a dry map the terrace risers ring the mesas, with gaps where rivers cut through. How much of the edge the start reaches, by a 4-unit flood fill over `impassable` from the metro, over the first 20 seeds of the sequence the old figures sampled:

| Parameters | Least | Median | Towns cut off |
| --- | --- | --- | --- |
| steepest corner, radius 600 | 96.2% | 99.0% | 0 of 100 |
| Badlands, radius 600 | 67.0% | 95.1% | 0 of 60 |
| High Desert defaults | 97.7% | 99.7% | 0 of 60 |
| Mixed defaults | 99.7% | 99.9% | 0 of 100 |

The Badlands' least was 98.4% on the lattice: one seed in 20 has a cliff belt along part of its rim. With rivers bridged and lakes impassable the figures move by under 0.3 of a point. The tests hold the first two seeds of three sets above 80%, with every town reached.

## Hazards

Hotspots keep the terrain stage's placement, but a crater now keeps off the land's drainage: no cell within two cells of its rim carries 40 cells of drainage, under the least any river needs at the densest `riverDensity` and the heaviest rain. Before, 21 of 128 craters over 40 maps at radius 1000 sat on a river, cutting it, with the river drawn across the crater; now none do, every hotspot still placed. Hotspots and towns still come before the water, so the water keeps its lakes off them; moving them after it, into the spec's `hazards` and `places` stages, is Maps 6 and 9's.

## The cost of a move

`terrain.moveCost(x0, y0, x1, y1, roadClass)` is the spec's: the distance times one plus the grade along the move squared, weighted by class (highway 26, back road 10, trail 3.5) and by `curviness` (0.2 times at 0 to 1.8 at 1, 1 at the default, so 0.5 is the prototype's), plus the slope across the move squared, weighted by class (3, 1.2, 0.3), plus a bridge for each river it crosses. The grade along is the climb between the ends' elevations, terraces and all; the slope across is the gradient's part square to the move at its middle.

- A bridge costs 130, 210, or 280 world units of flat road by class for one 8 units long, times one plus its length over 8, its length the river's width over the sine of the crossing angle. So crossings stay short and square-on by cost, and highways bridge most readily.
- No bridge runs longer than 24 units, so a creek can be crossed at almost any angle and a broad river only near square. A first cut refused any crossing more than 45 degrees off square; outward growth, turning ten degrees a step, met rivers 45 to 70 degrees off square often enough that rivers stopped 19 of 90 highways.
- A highway or back road can't climb a grade past 1.1 along a move (the prototype's rule); a trail can.
- Infinity where the move's end or middle is impassable, short of river water it bridges. A caller stepping further than a cell or so samples its own way, as growth does.
- The metro's rivers aren't obstacles and cost nothing to cross: its streets bridge them wherever they meet, out to a unit past its edge, so a highway leaving it over a river leaves on a bridge.
- `onBridge` says whether a point of a move is over water it bridges: within the bridge's span of where it crosses, a unit either side.

There's no biome term. The spec's cost has none, and `BIOME_COSTS`, the per-point `travelCost`, and `TerrainSample.cost` are gone: a cost of standing on a point can't follow contours, and two cost models would disagree. A full move costs about 0.9 microseconds.

## The old growth on the new costs

Outward growth stays until Map 7, adapted only where the water and the move cost made it:

- A step's cost is `moveCost` per world unit, and the lookahead is the move on from the step's end along its heading.
- The passable rule lets a step through river water where it's on a bridge (`isPassable`, read by `checkRoadNetwork` too), and nowhere else; lakes, craters, and cliffs never.
- Rivers aren't walls for the wall lookahead or the branch room probes, since a road can bridge them.
- A back road degrades on its running cost over the land, bridges aside, so crossing a river doesn't turn it into a trail.

`node scripts/road-growth.mjs check --maps 100` finds no map failing a first attempt across the tuning ranges, and the property tests pass. The networks are smaller, over five environments by three seeds at radius 1000:

| | main | this |
| --- | --- | --- |
| Steps, median | 1,508 | 1,161 |
| Stretches, median | 214 | 168 |
| Road, units, median | 30,731 | 23,766 |
| Highways reaching the rim | 82% | 53% |
| Stretches that kept their steps | 16 of 2,922 | 309 of 2,270 |

Of the 42 highways that stop short, cliffs block 29, lakes 4, rivers 4, and 5 end for other reasons; on main 13 of 16 were cliffs. So the change is mostly rough country's, which now walls the steep flanks growth used to climb, not the costs. Growth's checks don't cover how far roads reach, nothing was tuned, and Map 7's least-cost links route through the passes instead.

## Crossing the worker boundary

`WaterSurface` is plain data: the routing's `receivers` and `area`, `moisture`, `lowland`, `canyons`, and `lakeDepth` as Float32Array, `lakeOf` as Int16Array, the rivers' `lines` packed end to end (points, a width per point, and offsets), and small lists of rivers and lakes. Its ten arrays go in the transfer list beside the land's seven and the network's two, and `decodeAreaMap` rebuilds the terrain over the land, then `waterFromSurface({ terrain, surface })` the water over that, refreezing it and filing the river index, 0.3 ms at radius 1000. It refuses a surface for another grid or with arrays that don't fit. `encodeAreaMap` used to refuse a terrain with water; that refusal is gone.

The water adds about 30 bytes a cell: 2 MB at radius 1000 and 5 MB at 1600, beside the land's 2.6 and 6.6. The terrain's own fields, rebuilt over the land, take 19 ms at radius 1000, where Map 4's whole decode took 11; most of the difference is badlands' contamination per cell.

## Rendering

- The bake blends the land's colour (above), fills lakes from the depth field, a bilinear lookup per texel, with a darker shore where a texel beside one is dry, and draws craters and cliffs as before.
- Rivers draw live, under the fog and the roads, as runs of one width each, widths rounded to 0.75 units so a river widens in a few steps, at their world width but never under a pixel, simplified by zoom as the roads are, and fainter past the rim, where the land fades but the rivers go on. A `water` layer toggle turns them off.
- Dam marks, river names, and the atlas palette are Map 19's.

The gallery's two area map scenes re-baseline.

## Determinism

Everything on the gameplay path is adds, multiplies, divides, compares, square roots, and floors; the bake and the view aren't on it. Float32 fields are rounded to nearest by IEEE in every engine. The tests pin two maps' water, a Mixed map at radius 800 and a Floodlands closed basin, as hashes of moisture, the lake depth field, and the river points, with their river and lake counts, computed in a separate Node process from the Jest run that checks them, and three terrains' samples with a move's cost each. The terrain's pins move with this change: towns sit on new squares, hotspots keep off the drainage, and badlands read the slope.

## Performance

`node scripts/terrain-bench.mjs --radii 800,1000,1200,1600 --runs 3 --seeds 3`, Node 24, the same shared desktop as Map 4's figures, busier this time: the land ran 10% to 35% slower than its record.

| Radius | Mixed | High Desert | Rust Belt | Floodlands | Badlands | Fields | Rebuild | Rivers | Lakes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 800 | 20 ms | 19 | 23 | 16 | 19 | 12.3 | 0.2 | 27 | 2 |
| 1000 | 31 | 28 | 30 | 32 | 22 | 19.3 | 0.3 | 41 | 2 |
| 1200 | 43 | 42 | 40 | 46 | 38 | 31.3 | 0.4 | 59 | 2 |
| 1600 | 65 | 66 | 84 | 70 | 82 | 44.0 | 0.8 | 111 | 2 |

The water stage is the first five columns, against the prototype's 40 to 50 ms at radius 1000. Fields is `terrainFromSurface`, which the worker and the client each pay; rebuild is `waterFromSurface`. Routing again, a priority flood, is about two fifths of the stage, and it's O(n log n) like erosion's; DDB-448's O(n) routing would speed both. Sampling at radius 1000, with water: a full sample 544 ns (455 on Map 4), elevation 167, slope 179, biome 506, impassable 136, and a 9-unit move's cost 872.

## What Maps 6 to 8 get

- Settlements (Map 6) read `water.terrain` and the water: `surface.area` and `receivers` for river valleys and confluences, `lowland` for valley floors, `lakeOf` and the lake list for keeping off water, and each reservoir's dam for the dam and pump house POI (Map 10). Towns and hotspots still come from the terrain stage; moving them after the water, into `places` and `hazards`, is theirs.
- Road links (Maps 7 and 8) route with `moveCost` per class over moves of about a cell, which charges climbs, side slopes, and bridges, and is Infinity on impassable ground; a path search samples its own moves past a cell. `onBridge` and `riverCrossings` say where a road crosses water, the spec's bridges and candidate "bridge out" spots. Growth's bridges aren't recorded on the network; Map 7's are.
- The save (Map 18) keeps `lines` and the lakes' shores; the depth field is regenerated, since the land is.

## Consequences

- Every map moves: its moisture, biomes, rough country, cliffs, towns, and hotspots, and so its roads. Saves keep resolved params and regenerate the land, so a save made before this loads onto different water and biomes under the same roads, and DDB-296's generator version should count this change.
- `Terrain.travelCost`, `TerrainSample.cost`, and `BIOME_COSTS` are gone; `moveCost` replaces them. `Obstacle` is `crater`, `lake`, `river`, or `cliff`.
- Rough country follows the steep ground, so cliffs cover two to three times the share they did, and the start's reach of the edge on the Badlands has a worse tail (above).

## Provisional calls

Calls the spec and realistic-map.md left to the build, made the simplest way consistent with them, for Kevin to approve or adjust:

1. Moisture before the rivers: the map's level, plus 0.55 either way of 650-unit, 2-octave noise, less 0.6 a unit of elevation. Rain 0.5 plus that moisture, times one plus 0.6 of the range mask.
2. The routing's noise: one 80-unit octave of 0.0015 of elevation, grade under 0.01, rather than Garbrecht and Martz.
3. The stream threshold: 700 cells of rain at `riverDensity` 0 to 110 at 1, linear.
4. River lines: Douglas-Peucker at 0.6 of a cell, three Chaikin passes; meander up to 1.4 cells at `riverMeander` 1 from 90-unit noise, full below grade 0.015, none past 0.06, tapering over 30 units at each end.
5. Width: 1.2 units at the threshold, plus 0.75 a step of the square root of the area's multiple of it, up to 9; widening from 1.2 over a source's first 40 units.
6. Reservoirs: dams on rivers 3 to 80 times the threshold, in valleys 0.8 units deep three cells either side, past the relief radius and inside 0.88 of the radius, 0.25 of the radius apart; lakes of 30 to 220 cells, 0.5 to 30 units deep at the dam; 120 floods tried at most.
7. Natural lakes: the land's pits 0.01 units wet, at least 4 cells and 0.25 units deep, in country of moisture 0.55 or more before the rivers. `lakes` 0 turns them off with the reservoirs.
8. Lakes keep off the blend radius, a cell and 20 units past towns and craters, the grid's outermost cells, and a cell of land from each other.
9. Wetness beside water: 0.5 for a creek, 0.1 more a step of the square root of the area's multiple, up to 1, and 1 beside a lake; fading out 120 units along the drainage and 12 units above the water; 0.35 of it added to moisture.
10. Low ground: 1 at the water's level, 0 three units above it.
11. Canyons: river valleys cut three cells either side, spread 24 units along the drainage and up to the rim, 10% of the land outside the ranges from dryness 0.55, none at 0.45.
12. Rough country: the eroded grade averaged a cell each way, swayed by 0.7 of a 300-unit, 2-octave noise layer, 10% to 35% of the land past the relief radius by `ruggedness`; cliffs at grade 1 in it, as before.
13. Towns from reached squares a square clear of rough ground.
14. Badlands: the averaged grade weighted 0.3 plus 0.7 of contamination, at the field model's share.
15. Craters keep off cells with 40 cells' drainage within two cells of their rim.
16. Move cost: grade weights 26, 10, and 3.5 by class times 0.2 to 1.8 by `curviness`; side-slope weights 3, 1.2, and 0.3; no highway or back road on a climb past 1.1; bridges 130, 210, and 280 units of flat road by class for an 8-unit bridge, times one plus its length over 8; no bridge longer than 24 units; a bridge's deck a unit past the water either side; no biome term.
17. The metro's rivers are bridged everywhere, out to a unit past its edge.
18. Growth on the new costs: steps scored per unit of `moveCost`, rivers bridged where crossed and no wall, back roads degrading on their cost over the land without bridges.
19. The land's colour: dry (226, 208, 160), middling (200, 194, 152), wet (150, 172, 128) by moisture; grey-brown (160, 146, 128) from elevation 0.2 to 0.6; rust (176, 112, 80) up to 0.45 by contamination. Lakes (96, 138, 186) with a (52, 86, 140) shore.
20. Rivers drawn at their world width, at least a pixel, widths rounded to 0.75 units, at 0.35 alpha past the rim.
