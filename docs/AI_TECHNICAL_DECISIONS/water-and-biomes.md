# Water, biomes, hazards, and the cost of a move (DDB-289)

Date: 2026-10-09. Code: `_legacy/src/renderer/game/map/` (`Water.ts`, `Rivers.ts`, `Lakes.ts`, and `Terrain.ts` laying them over the land; `AreaMapPipeline.ts` runs the stage). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 2. Water and 3. Biomes, hazards, and cost. Builds Map 5 of [realistic-map.md](./realistic-map.md) on the land of [terrain-erosion.md](./terrain-erosion.md), and replaces its canyon, badlands, and lowland stand-ins and terrain-fields.md's moisture layer, rough-country lattice, and biome costs.

## Context

Map 4 left the water stage an immutable `LandSurface`: the eroded grid, its range mask, and the finished land's drainage as typed arrays, plus a list of what it wanted done (terrain-erosion.md, What the water stage gets). The spec's sections 2 and 3 say what to build: drainage with rain weighted by moisture and the ranges, rivers traced from a stream threshold set by `riverDensity` and given a meander by `riverMeander`, width by drainage area, `lakes` reservoirs dammed in valleys, natural lakes where the land holds water, moisture from `aridity`, noise, the rivers, and height, biomes as categories the game reads with the colour a blend, hotspots, cliffs only in rough country, and a cost of moving along the land rather than of standing on it.

The constraints were Map 4's. Everything that feeds the gameplay map is exactly rounded arithmetic, so a seed's water is the same on every platform and regenerates on load. And the water is plain data, the way the land is.

## The stage

The pipeline runs terrain, water, highways, growth. Water draws from `root.fork('map', m).fork('terrain', t).fork('water', w)`, forked by feature: `moisture`, `flats`, `reservoirs`, and `meander`. It never draws from the stream itself, so a reservoir's draws never move a meander.

`generateWater({ params, terrain, rng })` returns a `Water`: its `surface`, an immutable `WaterSurface` of plain data, and `water.terrain`, the land with the water laid over it through `terrain.withWater(water)`. The terrain stage's own product stays the land alone, and every stage after water reads `water.terrain`. `Water` is the real `WaterLayer`; a test can stand in its own.

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

Tracing (`traceRivers`): at a confluence the river carries on from its biggest tributary, ties to the lower cell, and the others end on the cell where they join. So a main river is one chain from its source to where it leaves, and every river cell is in exactly one chain. A river reaching a lake ends on the lake's first cell, and one leaving a lake starts on its last. A river ends at a confluence, in a lake, at an outlet on the edge, or, on a closed basin, at its sink. An outlet no river flows into is a single cell, and isn't a river.

Each chain becomes a line (`riverPolylines`):

- The cell centres simplified by Douglas-Peucker at 0.6 of a cell, which takes out the eight-direction staircase, down to 0.35 of that where the land's grade passes 0.15, so a river in a steep valley keeps to its floor instead of cutting over a spur.
- Three passes of Chaikin, then points evenly along the line a cell apart, so a long straight run has somewhere to bend.
- The meander, a sideways offset from 90-unit noise along the river: 0.4 of a cell anywhere, at any grade and any `riverMeander`, plus up to 1.4 cells at `riverMeander` 1, full on ground flatter than grade 0.015 and none past 0.06. It tapers over 30 units at each end, and is held within 0.6 of the line's radius of curvature, eased away from a tight bend so the points beside it can't cross there either.
- One more pass of Chaikin, which rounds off the corners an offset of a cell or two leaves between points a cell apart. The first cut's lines turned more than 30 degrees at 7.3% of their points inside the disc, over five maps at radius 1000; these do at 0.6%.

The first cut meandered on flat ground only and didn't resample, so where Douglas-Peucker had dropped a run of cells on a slope the line was a ruler. Over QA's 30 maps at radius 1000, five environments by six seeds, 87 of 1,335 rivers were a single straight segment over 40 units long, and 80 straight stretches inside the disc ran past 60 units, 31 of them on the grid's eight directions and 19 past 100, the longest 235. Measured the same way, a run of segments within a degree of the heading it started on, no river over 40 units is a single segment, and the longest straight stretch is 33 units, three and a half cells; a test holds every river on eight maps under five cells.

Tributaries are drawn after the river they join and end on its line, the nearest point to their meeting cell, so every confluence touches. Width is 1.2 units at the threshold, plus 0.75 for each step of the square root of the area's multiple of it, up to 9, read off the chain's cell the same share of the way along by length. A river that ends on another's cell or a lake's takes its own last cell's area there, and so does its `RiverInfo.area`, so a river running into a lake isn't sized as the lake's whole inflow. A river rising where many small flows meet on flat ground starts already broad, so a river widens from 1.2 over its first 40 units.

The lines are where the water is. `RiverIndex` files each segment in 16-unit buckets, and a point is in a river within half the river's width there of the centreline, the width running straight between a segment's ends. It also finds every centreline a move crosses, with how far along the move, the width there, and the sine of the crossing angle, which is what bridges are made of. So the picture, the save's polylines, and play all read the same lines.

## Lakes

Natural lakes come first, from Map 4's sites: cells whose land drainage level stands more than 0.01 units above them, joined side by side, at least 4 cells, at least 0.25 units deep somewhere, in country whose moisture before the rivers averages 0.55 or more. Their level is the land's own fill level, cell by cell.

There are few of them. Erosion drains wet, gentle country thoroughly, so Floodlands has hardly any pits: at radius 800 seed 5 has one of 10 cells and seed 43 one, both past the rim, and seed 41 none. Rugged maps keep more, mostly in the grid's margin: Mixed seed 7 at radius 1000 has pits of 1,149, 219, 71, and 67 cells, all past the rim. So natural lakes appear mostly on wet rugged maps, and the Floodlands' lakes are its five reservoirs.

Reservoirs, `lakes` of them (`placeReservoirs`): candidate dams are river cells whose area is 3 to 80 times the threshold, rivers worth damming short of the main stems, in a valley at least 0.8 units deep three cells either side, past the relief radius and inside 0.88 of the radius. They're tried in an order shuffled from the `reservoirs` fork, up to 120 floods, 0.25 of the radius apart. Each draws a target size of 30 to 220 cells, and the level is the highest, up to 30 units above the dam, that the lake holds at, found by halving:

- The dam is a wall across the river through the dam cell, three cells each side of it, square to the outflow. Water stands on its line and above it; the ground below it stays dry.
- The lake at a level is the cells of the dam's catchment, everything that drains to it, lower than the level and joined to the dam: side by side, or corner to corner where the four cells round the corner average under the level, which is when the drawn shore joins them too. Every lake cell drains to the dam through the lake.
- It holds when every cell joined to it that way and under the level is in it, bar what the wall holds back, so its level stops at the lowest saddle out of its valley; when it stays within its size; and when it keeps off blocked cells and other lakes.

A reservoir under 30 cells or 0.5 units deep at its dam is dropped.

The first cut flooded up the routing's donor tree alone, which went wrong two ways. A lake stood over land beside it that drained elsewhere, since the tree never looked sideways: over QA's 102 maps, 200 of 215 reservoirs had a dry neighbour under their level, 29 by more than a unit and the deepest by 15.5 (Badlands seed 7 at radius 1200); over 90 maps at radius 800 to 1200, 24 of 180 had one joined to the lake and outside a three-cell wall's reach, by up to 13.6 units. And its arms ran diagonally from cell to cell, which the bilinear depth field draws as beads: 168 of those maps' 193 lakes drew in more than one piece. Holding the level at the saddles needed the wall: a single-cell dam whose flanks counted as saddles kept 3 reservoirs of 180 over 90 maps, since the ground beside a dam on these gentle valleys stands only a few tenths of a unit over it. Now, over the same 90 maps at radius 800 to 1200, 180 reservoirs still place, none has a joined neighbour under its level outside the wall's reach, none draws in pieces, and the mean depth at the dam is 0.92 units against 0.98. Counted QA's way, every neighbour bar the dam's outflow, the deepest is 4.7 units, all of it below the wall or across a corner too high for the water, and the level stands at most 0.64 units over the ground beside the dam, against 14.6.

The valley's depth is in world units, and this land is gentle in them: at radius 1000 a candidate's valley is 1.4 units deep at the median on Mixed and 0.8 on Floodlands. The prototype's dams of 8 to 16 units would flood whole basins here, so the size target, not a depth, sets a reservoir.

Lakes keep off the metro's blend radius, a cell and 20 units past every town and crater, and the grid's outermost cells, where drainage leaves; and a cell of land from every other lake, so two lakes never run together.

The map reads lakes off a depth field per cell: under a lake its level less the land, at least 0.002; just past its shore the level less the land there, at most -0.002; elsewhere -1. Read bilinear, its zero is the shore, which follows the land's contour at the level between a lake's cells and its dry neighbours. `lakeOf` names each cell's lake. Each reservoir keeps its dam, the dam cell's centre and the way the river leaves through it, a natural POI site for Map 10.

`lakes` 0 is a map with no standing water at all, natural lakes included. `rivers` 0 is a closed basin: its rivers end at the sink and none leaves the map.

## Moisture, low ground, and canyons

One walk down the water's routing, downstream first, gives every cell the river or lake its drainage reaches first, how far along the drainage, and how high above its surface (`nearestWater`). The height is height above the nearest drainage, which hydrology calls HAND and which is what "low ground beside a river" means.

- Wetness spreads from the water: 0.5 for a creek at the threshold, 0.1 more for each step of the square root of the area's multiple of it, up to 1, and 1 beside a lake, fading to nothing 120 units along the drainage and 12 units above the water. Moisture is the moisture before the rivers plus 0.35 of it.
- Low ground (`lowland`) is 1 on the water, 0.5 at the map's lowland level above it, and 0 at twice that. The level is the height above its water that 45% of the land outside the ranges lies under, past the relief radius and inside the disc, and never under a unit. It replaces Map 4's lowland level, the elevation 55% of a map's land lay under, calibrated the same way so a rugged map has as much low ground as a gentle one. The first cut used a fixed three units, which made mire follow ruggedness, since a rugged map's land stands higher over its rivers. Floodlands seed 11 at radius 800 is 36% mire at ruggedness 0.15 and 35% at 0.85, which a test holds within five points, as Map 4's did.
- Canyons are the deepest river valleys on dry maps: a river cell's cut is how deep a valley it runs in, below the lower of the cells three away either side across its deepest direction, and the cells within 24 units of it along the drainage and below that rim share it. It's calibrated as Map 4's were, 10% of the land outside the ranges at a dryness of 0.55 and up, none at 0.45 and under, and only where badlands have room (`featureRoom`): none in the metro, easing in to the relief radius, and none at the foot of the ranges, whose flanks cut as deep as any valley. Where the river valleys hold less than that share, all of them are canyons (`positiveQuantile`).

## Biomes

The thresholds are terrain-fields.md's, unchanged: mountains, canyons, mire (low ground of a half or more, moisture plus a quarter of contamination 0.75 or more), badlands (and moisture under 0.6), desert (moisture under 0.3), scrub. What changed is the fields under them: moisture, low ground, and canyons from the water, and badlands from the eroded slope (below).

Seed 7 at radius 1000, as shares of the disc, against Map 4's stand-ins:

| Environment | Mountains | Scrub | Desert | Mire | Badlands | Canyons | Map 4 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Mixed | 24 | 43 | 10 | 14 | 5 | 3 | 24, 45, 12, 9, 6, 3 |
| High Desert | 34 | 18 | 32 | 1 | 9 | 6 | 34, 15, 38, -, 8, 6 |
| Rust Belt | 14 | 50 | 10 | 21 | 5 | 0 | mire 17 |
| Floodlands | 9 | 52 | 0 | 38 | 1 | 0 | mire 41 |
| Badlands | 34 | 21 | 18 | 6 | 16 | 6 | 34, 21, 21, 4, 16, 6 |

Seed 3 lands within about three points of these on every environment. Rivers cover 1.1% to 1.4% of the disc. Lakes cover the most on the Floodlands, whose five reservoirs take 1.6% of the disc at the median over QA's 18 maps and up to 2.9%; the other environments' lakes take 0.6% or less at the median, and the High Desert, at `lakes` 0, none.

The bake draws no biome at all: the land's colour is a continuous blend of moisture (buff, khaki, sage), height (grey-brown from elevation 0.2 to 0.6), and contamination (rust, up to 0.2 of the way), read on the colour lattice and interpolated, so country shades from one kind to the next. The game still reads the categories. The first cut tinted up to 0.45 of the way, which review found too strong.

## Rough country and cliffs from eroded slope

Rough country was terrain-fields.md's 16-unit lattice of noise islands, unrelated to the land under it. Now it's the steep land: the eroded grid's grade averaged over a cell each way, `ruggedness`'s share of the land past the relief radius, 10% to 35% as before, calibrated by quantile. Steep land runs in belts along the ranges, so the grade is swayed by 0.7 of a 300-unit, 2-octave noise layer (the terrain stream's `roughness` fork) before the quantile, which breaks a belt into stretches with gaps.

Cliffs are the steepest of the rough country by the same averaged grade, unswayed, read bilinear: 5% times ruggedness squared of the land past the relief radius, calibrated by quantile over the rough cells, and none where the averaged grade is under 0.5, so a gentle map's quota doesn't put cliffs on mild slopes. That's main's share by its grade rule, which past the relief radius at radius 1000, seed 7, was 0% at ruggedness 0, 1.2% at 0.5, 3.2% at the High Desert's 0.65, 4.0% at the Badlands' 0.8, and 5.2% at 1. These come out at 0%, 0.8%, 1.5%, 2.6%, and 4.3%: the calibration counts cell centres, and a point needs both its bilinear fields past their thresholds, which the corners of a band undercut.

The first cut stood cliffs wherever rough country's grade at a point reached 1, as the lattice had. Eroded land is a run of gullies, each side steep at a point, so that drew a stripe of cliff along every gully side, a barcode across each escarpment; and with rough country following the steep ground, 65% to 100% of the ground graded 1 or more was cliff by map, 5.1% of the disc on Mixed, 7.2% on the High Desert, and 10.1% on the Badlands at seed 7, radius 1000. Now an escarpment is one band, 4% to 28% of the ground graded 1 or more is cliff by map, and over QA's sweep cliffs cover 0.1% to 2.3% of the disc by environment at the median, against main's 0.1% to 3.6%. A cliff reads no elevation, only two bilinear lookups.

The land grid's cells carry the measure, read bilinear, and the cliffs' too. A bilinear value can't pass its corners, so a square between four cell centres all under the threshold has no rough point in it, and the flood fill from the metro over those squares, wholly inside the disc and clear of craters, is exact: `surelyReachable` is as sufficient as the lattice's was, on 9.4-unit squares instead of 16-unit cells. Towns take candidates only from reached squares whose eight neighbours are reached too, a square clear of rough ground, since a town's centre a unit from a cliff passed the old test and failed the 4-unit flood fill's.

Badlands use the same averaged grade, without the noise, weighted toward toxic ground (0.3 plus 0.7 of the cell's contamination), outside the ranges by Map 4's clearance, at the field model's share, 0.7 x ruggedness x (0.3 + 0.7 x contamination) of the land outside the ranges.

How much of the edge the start reaches, by a 4-unit flood fill over `impassable` from the metro, over the first 20 seeds of the sequence the old figures sampled:

| Parameters | Least | Median | Towns cut off |
| --- | --- | --- | --- |
| steepest corner, radius 600 | 95.3% | 99.8% | 0 of 100 |
| Badlands, radius 600 | 100% | 100% | 0 of 60 |
| High Desert defaults | 100% | 100% | 0 of 60 |
| Mixed defaults | 100% | 100% | 0 of 100 |

With the first cut's cliffs the Badlands' least was 67.0%, one seed in 20 walled along part of its rim by a cliff belt, and on the lattice 98.4%. With rivers bridged and lakes impassable the figures move by under 0.6 of a point. The tests hold the first two seeds of three sets above 80%, with every town reached.

## Hazards

Hotspots keep the terrain stage's placement, but a crater now keeps off the land's drainage: no cell within two cells of its rim carries 40 cells of drainage, under the least any river needs at the densest `riverDensity` and the heaviest rain. Before, 21 of 128 craters over 40 maps at radius 1000 sat on a river, cutting it, with the river drawn across the crater; now none do, every hotspot still placed. Hotspots and towns still come before the water, so the water keeps its lakes off them; moving them after it, into the spec's `places` and `hazards` stages, is Map 6's (DDB-442).

## The cost of a move

`terrain.moveCost(x0, y0, x1, y1, roadClass)` is the spec's: the distance times one plus the grade along the move squared, weighted by class (highway 26, back road 10, trail 3.5) and by `curviness` (0.2 times at 0 to 1.8 at 1, 1 at the default, so 0.5 is the prototype's), plus the slope across the move squared, weighted by class (3, 1.2, 0.3), plus a bridge for each river it crosses. The grade along is the climb between the ends' elevations, terraces and all; the slope across is the gradient's part square to the move at its middle.

- A bridge costs 130, 210, or 280 world units of flat road by class, and as much again for every 8 units it runs, its length the river's width over the sine of the crossing angle. So crossings stay short and square-on by cost, and highways bridge most readily.
- No bridge runs longer than 24 units, so a broad river is crossed only near square. A first cut refused any crossing more than 45 degrees off square; outward growth, turning ten degrees a step, met rivers 45 to 70 degrees off square often enough that rivers stopped 19 of 90 highways. The road network's links, eight ways from every cell, crossed creeks as shallow as 1.3 degrees off their line, on decks running down the water, so no crossing is less than 30 degrees off the river's line now, the metro's included (road-network.md, The edge cost field).
- A highway or back road can't climb a grade past 1.1 along a move (the prototype's rule); a trail can.
- Infinity where the move's end or middle is impassable, short of river water it bridges. A caller stepping further than a cell or so samples its own way, as growth does.
- The metro's rivers aren't obstacles and cost nothing to cross: its streets bridge them wherever they meet, out to a unit past its edge, so a highway leaving it over a river leaves on a bridge.
- `bridgeSpans` gives the stretches of a move on its bridges: the bridge's span either side of where it crosses and a unit past that. Inside the metro every crossing 30 degrees or more off the river's line is a bridge, however long.
- A move of no length costs nothing. One whose length isn't a finite positive number, from a NaN coordinate say, is Infinity, never a free move.

There's no biome term. The spec's cost has none, and `BIOME_COSTS`, the per-point `travelCost`, and `TerrainSample.cost` are gone: a cost of standing on a point can't follow contours, and two cost models would disagree.

## Drawing it

The area map's look for the land, water, and cliffs is [area-map-atlas-style.md](./area-map-atlas-style.md)'s; how the TypeScript bake and view drew them (provisional calls 18 to 20) is in [area-map-view.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/area-map-view.md). Dam marks, river names, and the atlas palette are Map 19's.

## Determinism

Everything on the gameplay path is adds, multiplies, divides, compares, square roots, and floors, with no trig or other libm transcendentals; the bake and the view aren't on it. Float32 fields round to nearest under IEEE, and with floating-point contraction off (`-ffp-contract=off`, which salal's foundation sets for GCC and Clang) no multiply and add fuse, so the same seed and params give the same water on every platform. The tests pin two maps' water, a Mixed map at radius 800 and a Floodlands closed basin, as hashes of moisture, the lake depth field, and the river points, with their river and lake counts, and three terrains' samples with a move's cost each.

## What Maps 6 to 8 get

- Places and hazards (Map 6, DDB-442) read `water.terrain` and the water: `surface.area` and `receivers` for river valleys and confluences, `lowland` for valley floors, `moisture`, `lakeOf` and the lake list for keeping off water, and each reservoir's dam, a POI site for the dam and pump house (Map 10). Towns and hotspots still come from the terrain stage, before the water, so rivers don't avoid towns, and the strict town placement no longer keeps towns off canyons, which the water now makes; moving both after the water, into `places` and `hazards`, is Map 6's.
- Road links (Maps 7 and 8): `moveCost` is the reference definition of what a move costs a class, which charges climbs, side slopes, and bridges and is Infinity on impassable ground. Map 7 builds a per-map edge cost field for its search from the same parts, class-independent per edge (the grade squared, the slope across squared, the bridge factor, whether it's blocked, rough squares sampled every half unit), weighted by class at search time, and tests that field against `moveCost`. `bridgeSpans` and `riverCrossings` say where a road crosses water, the spec's bridges and candidate "bridge out" spots. Growth's bridges aren't recorded on the network; Map 7's are.
- The save (Map 18) keeps `lines` and the lakes' shores; the depth field is regenerated, since the land is.

## In the C++ alpha

`libs/rules/map/` (`Water`, `Rivers`, `Lakes`, and `DrainageRouter::accumulate` with rain; 2026-10-30, DDB-571) builds stage 2 with this record's numbers, provisional calls 1 to 9, on `root.fork("map", m).fork("terrain", t).fork("water", w)`, forked by `moisture`, `flats`, `reservoirs`, and `meander`. The noise is salal's (terrain-fields.md, Noise is the engine's), and the meander reads one row of its layer per river, 13.7 units apart, as the simplex did.

What differs:

- `Water` is its own product beside the terrain's, plain data on the land grid: its routing with the rain-weighted area, moisture, the lake depth field and `lakeOf`, the rivers (each its chain of cells and its line, a width per point), and the lakes with their dams. There's no `terrain.withWater`; whatever reads both reads both.
- Rain-weighted area sums each cell's donors highest level first, ties highest index first, the rule above, done by walking the cells in that order rather than by the router's own. Unit rain still sums whole numbers in the router's order.
- Lakes keep off the blend radius, the grid's outermost cells, and each other by a cell of land (provisional call 8). They no longer keep off towns and craters: those come after the water now, in the hazards and places stages, and keep off the lakes themselves.
- Stage 3's fields followed (2026-10-30, DDB-571), with this record's numbers, provisional calls 10 to 12 and 14. The land-only ones, contamination before the plumes, rough country, cliffs, open squares, and badlands (`LandFields`), are part of the terrain's product, built with the land on the terrain stream's `contamination` and `roughness` forks, since they read nothing but the land; they can be built over a land surface on their own, which the tests do to vary their parameters without eroding again. The ones that follow the water, height above the nearest water and distance along the drainage to it, low ground, and canyons, are the water's, per cell.
- `Ground` is what reads them: a view over the terrain and the water (and the hazards, once they're laid), the fields of (x, y) sampled bilinear between cells, elevation and slope bicubic, and the biome from them. The metro's fields are applied there, per point: moisture eases to scrub's 0.45 and contamination to none over the blend ring.
- `Biome` keeps the thresholds above and names its six for JSON (`scrub`, `desert`, `mire`, `badlands`, `canyons`, `mountains`), which the stop tables will key on; the Map Lab's labels wait for the Map Lab.
- The river index, what's impassable, and the cost of a move followed (2026-10-30, DDB-571), with provisional calls 16 and 17 as they are:
  - `RiverIndex` files each river segment in the 16-unit buckets its water reaches and is built with the water. Its queries are const: a segment filed in several of a move's buckets counts in the first of them it shares with the move, where the TypeScript stamped segments as it went, and crossings come to a visitor, so nothing allocates.
  - A crossing's side of the river is half-open, its segment's end counted and its start not, so a move through the point where two segments meet crosses once. The TypeScript's strict test missed those, which on its lines' arbitrary coordinates was a near miss, and a test here hit at once.
  - `Ground` answers `waterAt`, `bridged` (the metro and a unit past it), and `obstacle`, a crater, then a lake, then a river outside the metro's bridges, then a cliff. `withRivers` stands other rivers' water in, which is how the tests lay a straight river of a chosen width.
  - `MoveCost` is the road's side: the class weights, curviness, the grade and bridge limits, and bridge spans, over a `Ground`. A cost comes with the bridges' share of it. `RoadClass` and its JSON names, `highway`, `backRoad`, and `trail`, live there for the roads to share.
  - With river widths held to 9 and no crossing under 30 degrees, no bridge over a generated river runs past 18 units, so the 24-unit limit never binds today; it guards water wider than the widths allow now.

Seed 7 at radius 1000 under salal's noise, as shares of a lattice over the disc:

| Environment | Mountains | Scrub | Desert | Mire | Badlands | Canyons |
| --- | --- | --- | --- | --- | --- | --- |
| Mixed | 24 | 52 | 1 | 15 | 5 | 3 |
| High Desert | 33 | 13 | 39 | 0 | 9 | 6 |
| Rust Belt | 15 | 58 | 0 | 25 | 3 | 0 |
| Floodlands | 9 | 51 | 0 | 39 | 0 | 0 |
| Badlands | 33 | 23 | 17 | 3 | 18 | 6 |

Close to the TypeScript's table above but for desert. Salal's gradient noise spreads less of its range than the simplex did, so moisture before the rivers swings less either side of the map's level: Mixed has almost no desert where it had a tenth, and the High Desert more. The spread (provisional call 1) is the Map Lab's to retune, not this build's.

The base contamination field, the calibrated noise under the plumes, stays on the terrain stream's `contamination` fork, as it was, and comes with the terrain's other land-only fields (rough country, cliffs, badlands) in stage 3; the hazards stage lays its plumes over it. The other way was to fork it from the hazards stream, since contamination is hazard country. But the base field depends on the seed and `contamination` alone, not on where the water or the craters go, so on the terrain stream a retry of the water or the hazards never moves it, and the badlands, which read it before the plumes, stay with the land they're cut from. On the hazards stream every hazards retry would redraw the toxic ground under the whole map, and with it the badlands and the mire, when all a retry needs is somewhere else for the craters.

The tests pin behaviour, not bits: the rain sums against a sum written by its definition, every cell draining to the land's outlets and never more than twice the noise uphill on the land's levels, every river following its drainage to an outlet through its confluences and lakes, tributaries ending on the river they join, widths in range, no river ruler-straight for five cells, reservoirs as many as asked, each held behind its dam with its cells draining through it, lakes apart and off the start, moisture in range and wetter beside rivers and with aridity, and the pipeline's water the one built straight from its stream. Natural lakes and reservoirs are each checked on a hand-built grid too.

## Consequences

- Every map moves: its moisture, biomes, rough country, cliffs, towns, and hotspots, and so its roads. Saves keep resolved params and regenerate the land.
- `Terrain.travelCost`, `TerrainSample.cost`, and `BIOME_COSTS` are gone; `moveCost` replaces them. `Obstacle` is `crater`, `lake`, `river`, or `cliff`.
- Rough country follows the steep ground, and cliffs stand on its averaged grade at about main's share, a band per escarpment; the start reaches as much of the edge as on main or more (above).
- On a closed basin, rivers running along the inside of the rim wander a little into the grid's outermost cells, past the disc: 191 points on the `rivers` 0 map of QA's sweep, against 108 for the first cut, where nothing leaves the map either way.

## Provisional calls

Calls the spec and realistic-map.md left to the build, made the simplest way consistent with them, for Kevin to approve or adjust:

1. Moisture before the rivers: the map's level, plus 0.55 either way of 650-unit, 2-octave noise, less 0.6 a unit of elevation. Rain 0.5 plus that moisture, times one plus 0.6 of the range mask.
2. The routing's noise: one 80-unit octave of 0.0015 of elevation, grade under 0.01, rather than Garbrecht and Martz.
3. The stream threshold: 700 cells of rain at `riverDensity` 0 to 110 at 1, linear.
4. River lines: Douglas-Peucker at 0.6 of a cell, 0.35 of that past grade 0.15; three Chaikin passes; points evenly a cell apart; a meander from 90-unit noise of 0.4 of a cell anywhere plus up to 1.4 cells at `riverMeander` 1, full below grade 0.015 and none past 0.06, tapering over 30 units at each end and held within 0.6 of the line's radius of curvature, eased away from tight bends; one more Chaikin pass.
5. Width: 1.2 units at the threshold, plus 0.75 a step of the square root of the area's multiple of it, up to 9; widening from 1.2 over a source's first 40 units.
6. Reservoirs: dams on rivers 3 to 80 times the threshold, in valleys 0.8 units deep three cells either side, past the relief radius and inside 0.88 of the radius, 0.25 of the radius apart; a wall three cells each side of the dam, square to the outflow; lakes joined side by side, or across a corner whose four cells average under the level, held below the lowest saddle; 30 to 220 cells, 0.5 to 30 units deep at the dam; 120 floods tried at most.
7. Natural lakes: the land's pits 0.01 units wet, joined side by side, at least 4 cells and 0.25 units deep, in country of moisture 0.55 or more before the rivers. `lakes` 0 turns them off with the reservoirs.
8. Lakes keep off the blend radius, the grid's outermost cells, and a cell of land from each other. Towns and craters, which come after the water, keep off the lakes.
9. Wetness beside water: 0.5 for a creek, 0.1 more a step of the square root of the area's multiple, up to 1, and 1 beside a lake; fading out 120 units along the drainage and 12 units above the water; 0.35 of it added to moisture.
10. Low ground: 1 on the water, 0.5 at the height above it that 45% of the land outside the ranges lies under, never under a unit, 0 at twice that.
11. Canyons: river valleys cut three cells either side, spread 24 units along the drainage and up to the rim, 10% of the land outside the ranges from dryness 0.55, none at 0.45, only where badlands have room.
12. Rough country: the eroded grade averaged a cell each way, swayed by 0.7 of a 300-unit, 2-octave noise layer, 10% to 35% of the land past the relief radius by `ruggedness`; cliffs the steepest of it by the averaged grade alone, 5% times ruggedness squared of the land past the relief radius, none under an averaged grade of 0.5.
13. Towns from reached squares a square clear of rough ground.
14. Badlands: the averaged grade weighted 0.3 plus 0.7 of contamination, at the field model's share.
15. Craters keep off cells with 40 cells' drainage within two cells of their rim.
16. Move cost: grade weights 26, 10, and 3.5 by class times 0.2 to 1.8 by `curviness`; side-slope weights 3, 1.2, and 0.3; no highway or back road on a climb past 1.1; bridges 130, 210, and 280 units of flat road by class for an 8-unit bridge, times one plus its length over 8; no bridge longer than 24 units; a bridge's deck a unit past the water either side; no biome term.
17. The metro's rivers are bridged everywhere, out to a unit past its edge.
18. The land's colour: dry (226, 208, 160), middling (200, 194, 152), wet (150, 172, 128) by moisture; grey-brown (160, 146, 128) from elevation 0.2 to 0.6; rust (176, 112, 80) up to 0.2 by contamination. Lakes (96, 138, 186) with a (52, 86, 140) shore.
19. Rivers drawn at their world width, at least a pixel, widths rounded to 0.75 units, at 0.35 alpha past the rim.
20. The bake's cliffs closed over a node, two texels, and anti-aliased over a texel.
