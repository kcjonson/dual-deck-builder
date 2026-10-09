# Terrain fields (DDB-288)

Date: 2026-10-07. Code: `src/renderer/game/map/` (`Noise.ts`, `Terrain.ts`, `Biome.ts`, `TerrainSites.ts`), timed by `scripts/terrain-bench.mjs`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 1. Terrain. Follows [seeded-prng.md](./seeded-prng.md) and [map-params.md](./map-params.md).

The land's relief, the plains, ranges, ridges, canyons, and badlands layers this record built elevation from, was replaced on 2026-10-09 by uplift and erosion: [terrain-erosion.md](./terrain-erosion.md). What's here still holds for the noise, moisture, contamination, the biome thresholds, the start's blends, hotspots, towns, rough country, cliffs, cost, and the water seam, as noted where the eroded land changed them.

## Context

Terrain is the first stage of the area map pipeline: continuous fields over the disc (elevation, moisture, contamination), the biomes read off them, the metro and towns, hotspots, what's impassable, and what it costs to cross. Every later stage samples it. Water traces rivers over elevation, growth steers by cost and stops at impassable ground, POIs and stops read biomes and ruins, and the renderer bakes the map's image from it. The fields have to be pure functions of (x, y), sampleable at any resolution, fast enough to leave room in generation's 200 ms for everything else, and the same for a seed in every engine as far as cheaply possible. The spec left the noise source open (open question 3) and gave the field model in a paragraph.

The stage takes validated `MapParams` and its own stream, the pipeline's `terrain` fork, and returns a `Terrain`: `generateTerrain({ params, rng })`.

## Noise is written in the repo

- The `simplex-noise` package (MIT, small). It builds each layer's permutation from a `() => number` it calls 255 times, then samples with its own gradient set and scale. Every map would depend on those internals staying put across versions, so a dependency bump could move every map with nothing in this repo changing, and it adds a dependency and lockfile churn for about a hundred lines of code. It has no derivatives.
- An in-repo function (chosen). `SimplexNoise` is 2D simplex noise in Gustavson's formulation: Perlin's skewed grid, (0.5 - r^2)^4 corner kernels, twelve unit gradients, and a permutation of 0 to 255 from `Rng.shuffle`, whose draw count the PRNG record already pins (255 draws a layer, rarely more). Sampling is adds, multiplies, compares, and integer ops, the floor done with `| 0` and the skew constants written out, so a seed's noise is bit-identical in every engine and thresholds can branch on it. That covers the fields too: the same goldens come out of Node 24's V8 and Electron 25's. It also returns its exact derivatives, which slope needs (below), and its fractal sum takes optional bounds: given the range a caller cares about, it stops once the octaves left can't bring the value there. One loop serves both, so a value that comes back with bounds is the same to the bit as without. A value exactly on a bound is the exception: the checks compare the sum before it's divided, so it can land on either side, and on a few large maps the one rough-lattice cell whose roughness equals the floor exactly is marked rough that way.

A sample takes about 21 ns on V8, derivatives included.

The gradients are picked against the grid. Its edges run at 45, -15, and 105 degrees, and where the gradients at both ends of an edge are square to it, a single-octave layer is exactly zero along the whole edge, so a ridged layer (ridges, range lines) creases there in a short straight line. Sixteen gradients 22.5 degrees apart, the first set tried, hold the two square to the long diagonals and leave about one long diagonal in 64 zero: 140 of the 24,576 edges a test walks over eight seeds. Twelve, 30 degrees apart from east, come no nearer than 15 degrees to square with any edge, and the test finds no edge zero. The permutation's values hash to them by remainder for the first 252 and to east, north, west, and south for the last four, so the set still averages to nothing and spreads as far along any line as along another. The scale, 99.2, is just under 81 * sqrt(6) / 2, the reciprocal of the largest sum three corners can reach with any unit gradients, so samples stay inside (-1, 1) whatever the set, and the early-out relies on that bound. A test works both out over a fine grid of the cell: that largest sum, and the twelve's own, 0.976 once scaled.

Any set still leaves one short straight crease at every lattice vertex, which is the kernel's doing, not the set's: a layer is zero at every vertex, and near one its own kernel outweighs the rest, so the zero line through it runs straight to within a thousandth of a lattice unit for about 0.4 units (up to 0.47), and a ridged layer creases along it. It's cosmetic.

Fewer directions could favour some. Any finite set leaves a comb of slightly favoured slope directions, a tooth per gradient, and one octave alone shows it about as strongly with twelve as with sixteen: over 3.2 million samples the slope histogram's 12-fold term is 0.043 against the sixteen's 16-fold 0.047, beside the grid's own 6-fold at 0.027 against 0.030. The four extra axis gradients add a 4-fold term of about 0.0025 (the sampling floor is 0.0006), which favours the axes over the diagonals by about 0.3%: on its own it would put 50.2% of slopes nearer an axis than a diagonal. Nothing shows at first or second order. In the terrain the comb washes out: over 10,000 maps, 2,000 seeds of each environment, 10-degree bins of slope direction hold 0.985 to 1.012 of an even share and no harmonic of the histogram passes 0.003, the comb's included, and in range country, where ridges set the slope, the crest axes' harmonics stay at 0.003 or under.

## The fields

Feature sizes are world units, not shares of the radius, so a bigger map has more of everything rather than bigger mountains, and roads, which step and keep clear in world units, meet the same terrain on any map. Every value below is a starting value for the Map Lab to tune. Elevation, the range mask, canyons, and badlands now come from the eroded land (terrain-erosion.md); the layers left are these:

| Layer | Noise | Shaped by |
| --- | --- | --- |
| Roughness | 2 octaves, 360 units: rough country is where it's above its calibrated floor, decided per cell of a 16-unit lattice | `ruggedness`: rough country is 10% to 35% of the land past the relief radius |
| Moisture | 2 octaves, 650 units, spread 0.55 around the map's level, plus 0.5 per unit of elevation below 0.06, about the plains' on the eroded land, minus above | `aridity` |
| Contamination | 2 octaves, 450 units; hotspot plumes combine over it as 1 - (1 - c)(1 - p) | `contamination`, the toxic share; `hotspots` |

Each threshold behind a share (rough country's floor, toxic ground, and on the eroded land the range mask, canyons, and badlands) is a quantile of its layer over a lattice of the disc, taken past the radius where the feature fades in, so `contamination` 0.3 means that share of the country beyond the metro's surroundings on every map, whatever the noise drew. Shares of 0 and 1 are infinite thresholds: none and all.

`aridity` follows the spec as written, 0 dry desert to 1 wet ground and mire, which reads backwards for the name. Whether to rename it or flip it is open (DDB-405), so the mapping lives in one function, `moistureLevel(aridity)`, and either change is a line there.

## Biomes

Thresholds on the fields, first match wins:

| Biome | Where |
| --- | --- |
| Mountains | the range mask is 0.5 or more: range country, ridges and valleys alike |
| Canyons | the canyon field is 0.5 or more: deep in a valley cut into dry land |
| Toxic mire | elevation under 0.05 (0.42 on the field model's scale), and moisture plus 0.25 x contamination is 0.75 or more |
| Badlands | the badlands field is 0.5 or more and moisture under 0.6 |
| Barren desert | moisture under 0.3 |
| Scrub | the middling rest |

Mountains' share then is `mountainCoverage` by construction. Mire needs low, wet ground, and contamination counts toward wet, so toxic ground goes to mire sooner. Ruins aren't a biome: `ruin(x, y)` is 1 inside the metro or a town and fades to 0 at twice its radius, over whatever land it stands on, for POIs, stops, and the scenery's street grids to read.

## The start

The metro is `metroSize` of the radius around the compound. Inside it the fields are scrub's: moisture 0.45, no contamination, no mountains, canyons, or badlands, and flat land (terrain-erosion.md, The metro). Moisture and contamination blend back to their own out to the blend radius (the metro plus half its radius, or 6% of the map's, whichever is more). Ranges, canyons, and badlands ramp in from the metro's edge out to the relief radius, a tenth of the map's radius past the blend radius, on squared distance so no square root is taken. Hotspots are centred past the blend radius plus the largest crater, and no cliff stands inside the relief radius. So the metro is always flat scrub with nothing impassable, which a property test checks across the tuning ranges, the extreme corners included.

## Hotspots and towns

Both are Poisson-disc samples: candidates drawn uniformly, each kept only if it's far enough from those kept before. Hotspots are dart-thrown over a ring of the disc (in its bounding square, redrawn until inside, so no square root or trig); one gets 48 candidates and is left out if none fits, which their spacing makes vanishingly rare across the tuning ranges, and tests check every one asked for is placed.

- Hotspots: crater radius 14 to 26 units, impassable; plume 5 to 8 times the crater, contamination at the centre 0.75 to 1, falling off as (1 - d^2 / r^2)^2; centres at least a quarter of the radius apart, between the blend radius plus the largest crater and 0.9 of the radius.
- Towns: radius 0.25 to 0.4 of the metro's, at least 20 units; centres 0.22 of the radius apart, wholly between the blend radius and 0.9 of the radius, and 20 units clear of craters. Candidates come from the cells the metro's flood fill reaches (below) whose centres lie in that ring: a cell picked evenly and a point picked evenly inside it, so every candidate is ground a road can reach. The first 24 of a town's 48 candidates also have to be out of mountains and canyons (the range mask and canyon field under a quarter). If none fits, the town walks the same cells in an order shuffled from the towns stream (once a map) and takes the first centre with room, so a town is left out only when no reached cell's centre in the ring has room for it. Dart-thrown over the whole ring and kept only where reachable, towns came up short on 17% of maps at the most crowded corner of the tuning range (coverage 1, ruggedness 1, aridity 0, contamination 1, 6 hotspots, 12 towns, metro 0.25, radius 600); from the reachable cells, none of 500 seeds at that corner or at nine neighbours of it, 5,000 maps in all, is short a town.

## Slope, obstacles, and cost

Elevation carries its exact gradient: the eroded grid's bicubic gradient, plus range country's fine relief through the chain rule (terrain-erosion.md). Forward differences took two more elevation samples per slope, which made cost and the full sample three times as dear as elevation. A test holds the gradient to central differences on a round-numbered grid over three maps, where one-sided slopes that disagree would mark a crease, and allows none.

- Grade is the gradient's size times `RELIEF`, 150: rise over run with elevation 1 standing 150 world units high.
- Obstacles, in precedence: a crater, water (from the water stage), a cliff: grade 1 or steeper in rough country. Steep ground outside rough country isn't a cliff, only costly.
- Travel cost per world unit: the biome's base cost plus 3 x (grade / 1)^2, so 1 on flat scrub and Infinity on impassable ground; steep ground outside rough country costs more than 3 on top. Base costs: scrub 1, desert 1.25, canyons 1.5, badlands 1.8, mire 2.2, mountains 2.5. Growth tunes these.
- The cliff test compares squared gradients, so no branch depends on a square root. `grade` takes one, for display.
- Cliffs are bands, not hairlines, which growth sampling every few units would hit or miss by chance. The field model's canyons once laced a middling map with cliffs a twentieth of a unit wide; eroded slopes are steep across cells nine units wide, and a test holds the share of cliff ground in bands under 2 units under 8%, and the median band over 6 units, on four maps.

## Keeping the land connected

Ridged noise makes crest lines that enclose its valleys, and canyon lines close into loops. With cliffs wherever the slope ran steep, the field model's first version left a quarter of the passable land, and 4% of the outer band, reachable from the metro at the steepest corner of the tuning range (coverage 1, ruggedness 1, aridity 0, contamination 1), with towns cut off behind canyon walls. Eroded ranges are steeper still, so the rule holds on the eroded land too.

Cliffs stand only in rough country, with no exceptions:

- Rough country is where the roughness layer is above a floor calibrated to 10% to 35% of the land past the relief radius, by `ruggedness`. Well under half, an excursion set of a smooth layer breaks into islands, and the land around them connects across the map.
- It's decided per cell of a 16-unit lattice, from the layer at the cell's centre, and a cell counts only if all of it lies past the relief radius. Then a flood fill from the metro over the cells that aren't rough, wholly inside the disc and clear of craters, is exact: every cell it reaches joins the metro through ground no cliff can stand on. Towns are placed only in reached cells, and `surelyReachable(x, y)` reads the fill. It's sufficient only: false means not proven, not a pocket. It reads false on all rough ground, where roads can often still find a way, on open ground rough cells ring off, and in cells at the rim or touching a crater, and it ignores water. On the field model it was false for 15% to 33% of the ground a 2-unit flood fill over `impassable` reaches, most of that rough. So the Map Lab's reach readout is a fine flood fill over `impassable`, not this.

Nothing guarantees how much of the edge the start reaches: rough islands could close into a ring round the metro, or one can lie across the outer band and wall a stretch of it off against the rim. terrain-erosion.md measures it on the eroded land, where 20 seeds at the steepest corner keep at least 95% of the outer band's passable ground in reach. A test holds the first two seeds of each of three sets above 80% on a 4-unit grid, with every town reached.

## The water seam

Rivers and lakes are the water stage's (DDB-289). `WaterLayer` is one method for now, `isWater(x, y)`, and `terrain.withWater(layer)` returns a `Terrain` sharing the land with water added to the obstacles (a crater still reads as a crater) and to cost (Infinity). The water stage will widen it: growth crosses rivers square-on at bridges, so it needs to tell a lake from a river and know which way a river runs. It traces over the eroded land's drainage (`terrain.surface`, terrain-erosion.md), forks its own streams from the terrain stream under names not used here, and decides how water meets the metro, which this stage keeps passable. Town placement's flood fill knows cliffs and craters, not water, so a river can still cut a town off from the metro until a bridge crosses it, and towns are placed before lakes fill the low basins, so the water stage keeps its lakes off them; it can read `terrain.towns`.

## Streams

The stage forks its stream by feature: for the land `hills`, `ranges`, `rangeWarp`, `rangeBreaks`, `grain`, `outlets`, and `initial`, and for the rest `detail`, `roughness`, `moisture`, `contamination`, `hotspots`, and `towns`. It never draws from the stream itself. So towns and hotspots never move the land, and a parameter change moves only what reads it, as the PRNG record intends. Goldens pin three seeds' hotspots, towns, and full samples at four points; a deliberate change to any constant or formula moves them and every map, so it ships with a generator version bump (DDB-296).

## Performance

`scripts/terrain-bench.mjs` times the stage; terrain-erosion.md has the eroded land's figures, building and sampling both. Sampling allocates nothing, though `SimplexNoise.sample` is past V8's 460-byte inlining limit, so each octave is a call that boxes its doubles; the scavenges that leaves cost about 5% of sampling time. A smaller kernel, or octave loops with the kernel written in, is the lever if a consumer needs more.

## Consequences

- Every number here is a starting value for the Map Lab (DDB-299), which should show biome shares, rough country, and the share of the edge a fine flood fill over `impassable` reaches, alongside its timings.
- Saves keep the gameplay map, so terrain only matters for loading as a picture; because sampling is arithmetic, a shared seed draws the same terrain in any engine as well.
- The renderer (DDB-298) can shade from `sample`'s slope without sampling neighbours, and should draw cliffs from `obstacle` so roads never seem to cross one. Cliffs end in straight cuts along the 16-unit lattice where a rough cell meets one that isn't: rough country is decided by cell and height point by point, so the same steep wall carries on past the line as passable, costly ground, and drawn from `obstacle` the cut shows where a road can cross.
- Growth (DDB-290) has `travelCost`, Infinity on impassable ground, and `obstacle` to tell water (bridgeable) from the rest. `surelyReachable(x, y)` proves ground reachable but never proves it cut off, so growth shouldn't steer away from where it reads false; its own search over `impassable` is what finds the pockets. Cliffs stand only where `rough(x, y)`, a lookup in the lattice, and there they taper at their tips and steep crests can leave slivers under a unit wide, so a step should be sampled at a unit or less inside rough cells; outside them no cliff stands, and `impassable` checks the lattice before it reads any elevation.
