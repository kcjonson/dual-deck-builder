# Terrain fields (DDB-288)

Date: 2026-10-07. Code: `src/renderer/game/map/` (`Noise.ts`, `Terrain.ts`, `Biome.ts`, `TerrainSites.ts`), timed by `scripts/terrain-bench.mjs`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 1. Terrain. Follows [seeded-prng.md](./seeded-prng.md) and [map-params.md](./map-params.md).

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

Feature sizes are world units, not shares of the radius, so a bigger map has more of everything rather than bigger mountains, and roads, which step and keep clear in world units, meet the same terrain on any map. Every value below is a starting value for the Map Lab to tune.

| Layer | Noise | Shaped by |
| --- | --- | --- |
| Plains | 3 octaves, 900-unit wavelength, level 0.42 plus or minus 0.18 | nothing; flattened toward the metro |
| Mountain ranges | belts along the zero lines of a 1300-unit layer (1 - \|n\|), plus a quarter of a 520-unit layer that breaks them into stretches | `mountainCoverage`, the share of the country they cover |
| Ridges | 3 octaves of ridged noise, 300 units, standing on the ranges, 0.06 of lift plus 0.2 to 0.4 of height | `ruggedness`: height, crest sharpness (from a rounded 1 - n^2 to a creased (1 - \|n\|)^3), and octave gain (0.45 to 0.62) |
| Roughness | 2 octaves, 360 units: rough country is where it's above its calibrated floor, decided per cell of a 16-unit lattice; mountains, canyons, and badlands climb from 30% of their height at the floor to all of it 0.2 above | `ruggedness`: rough country is 10% to 35% of the land past the relief radius |
| Canyons | the zero lines of a 2-octave, 520-unit layer, a flat floor (0.35 of the half-width) and walls that rise at one grade over their middle 60%; 0.2 deep at full strength in rough country; they fade out where a 420-unit sample dips | width by `ruggedness` alone (0.35 to 1 of the full half-width); depth by that, the map's dryness (begins at 0.35, full at 0.75), and roughness |
| Badlands | patches from a 2-octave, 480-unit layer; gullies inside them from a 2-octave, 60-unit ridged layer, 0.03 to 0.09 of relief | share 0.7 x `ruggedness` x (0.3 + 0.7 x `contamination`); relief by `ruggedness` |
| Moisture | 2 octaves, 650 units, spread 0.55 around the map's level, plus 0.5 per unit of elevation below the plains' level (before canyons and badlands cut it), minus above | `aridity` |
| Contamination | 2 octaves, 450 units; hotspot plumes combine over it as 1 - (1 - c)(1 - p) | `contamination`, the toxic share; `hotspots` |

Each threshold behind a share (the range mask, badlands patches, rough country's floor, toxic ground) is a quantile of its layer over a lattice of the disc, 20 samples to the radius, taken past the radius where the feature fades in, so `mountainCoverage` 0.25 means a quarter of the country beyond the metro's surroundings on every map, whatever the noise drew. Shares of 0 and 1 are infinite thresholds: none and all.

`aridity` follows the spec as written, 0 dry desert to 1 wet ground and mire, which reads backwards for the name. Whether to rename it or flip it is open (DDB-405), so the mapping lives in one function, `moistureLevel(aridity)`, and either change is a line there.

## Biomes

Thresholds on the fields, first match wins:

| Biome | Where |
| --- | --- |
| Mountains | the range mask is 0.5 or more: range country, ridges and valleys alike |
| Canyons | 0.5 or more into a canyon: the floor and lower walls of one that isn't faint |
| Toxic mire | elevation under 0.42, and moisture plus 0.25 x contamination is 0.75 or more |
| Badlands | the patch is 0.5 or more and moisture under 0.6 |
| Barren desert | moisture under 0.3 |
| Scrub | the middling rest |

Mountains' share then is `mountainCoverage` by construction. Mire needs low, wet ground, and contamination counts toward wet, so toxic ground goes to mire sooner. Ruins aren't a biome: `ruin(x, y)` is 1 inside the metro or a town and fades to 0 at twice its radius, over whatever land it stands on, for POIs, stops, and the scenery's street grids to read.

## The start

The metro is `metroSize` of the radius around the compound. Inside it the fields are scrub's: moisture 0.45, no contamination, the plains flattened to 30% of their roll, and no mountains, canyons, or badlands. Moisture and contamination blend back to their own out to the blend radius (the metro plus half its radius, or 6% of the map's, whichever is more). Mountains, canyons, and badlands ramp in from the metro's edge out to the relief radius, a tenth of the map's radius past the blend radius, on squared distance so no square root is taken; on the defaults they're already at about a quarter of full strength at the blend radius. Hotspots are centred past the blend radius plus the largest crater, and no cliff stands inside the relief radius. So the metro is always flat scrub with nothing impassable, which a property test checks across the tuning ranges, the extreme corners included.

## Hotspots and towns

Both are Poisson-disc samples: candidates drawn uniformly, each kept only if it's far enough from those kept before. Hotspots are dart-thrown over a ring of the disc (in its bounding square, redrawn until inside, so no square root or trig); one gets 48 candidates and is left out if none fits, which their spacing makes vanishingly rare across the tuning ranges, and tests check every one asked for is placed.

- Hotspots: crater radius 14 to 26 units, impassable; plume 5 to 8 times the crater, contamination at the centre 0.75 to 1, falling off as (1 - d^2 / r^2)^2; centres at least a quarter of the radius apart, between the blend radius plus the largest crater and 0.9 of the radius.
- Towns: radius 0.25 to 0.4 of the metro's, at least 20 units; centres 0.22 of the radius apart, wholly between the blend radius and 0.9 of the radius, and 20 units clear of craters. Candidates come from the cells the metro's flood fill reaches (below) whose centres lie in that ring: a cell picked evenly and a point picked evenly inside it, so every candidate is ground a road can reach. The first 24 of a town's 48 candidates also have to be out of mountains and canyons. If none fits, the town walks the same cells in an order shuffled from the towns stream (once a map) and takes the first centre with room, so a town is left out only when no reached cell's centre in the ring has room for it. Dart-thrown over the whole ring and kept only where reachable, towns came up short on 17% of maps at the most crowded corner of the tuning range (coverage 1, ruggedness 1, aridity 0, contamination 1, 6 hotspots, 12 towns, metro 0.25, radius 600); from the reachable cells, none of 500 seeds at that corner or at nine neighbours of it, 5,000 maps in all, is short a town.

## Slope, obstacles, and cost

Elevation carries its exact gradient, worked through every term alongside it: the noise's own derivatives, then the chain rule through masks, blends, crests, and the canyon profile. Forward differences took two more elevation samples per slope, which made cost and the full sample three times as dear as elevation. With the gradient they're about one and a half times. A test holds it to central differences on a round-numbered grid over three maps, where one-sided slopes that disagree would mark a crease, where ridge or gully noise crosses zero; it catches a canyon wall's slope with its sign flipped, or a term dropped from the mountains, gullies, or plains. It allows no crease: the ridge, range, and break layers shift both axes alike, so many of its points sit on those layers' lattice edges, where gradients square to an edge would leave creases.

- Grade is the gradient's size times `RELIEF`, 150: rise over run with elevation 1 standing 150 world units high.
- Obstacles, in precedence: a crater, water (from the water stage), a cliff: grade 1 or steeper in rough country. Steep ground outside rough country isn't a cliff, only costly.
- Travel cost per world unit: the biome's base cost plus 3 x (grade / 1)^2, so 1 on flat scrub and Infinity on impassable ground; steep ground outside rough country costs more than 3 on top. Base costs: scrub 1, desert 1.25, canyons 1.5, badlands 1.8, mire 2.2, mountains 2.5. Growth tunes these.
- The cliff test compares squared gradients, so no branch depends on a square root. `grade` takes one, for display.
- Canyon walls are bands, not hairlines. A first version scaled a canyon's width with its strength as well as its depth, so its wall grade never fell however faint it got: a middling map was laced with cliffs a twentieth of a unit wide and under half a unit high, which growth sampling every few units would hit or miss by chance. A canyon's width now depends on ruggedness alone, so a faint canyon is shallow and gentle rather than narrow, and its walls hold one grade over their middle 60%, so a wall steep enough to be a cliff is one across most of its width. Measured across the slope at every cliff point on a 150-cell grid, on the seeds the tests use, cliffs' bands have medians of 7.9 to 10.1 units, and 1.4% to 4.2% of cliff ground sits in bands under 2 units, the tapered tips every cliff has; other seeds spread wider (seeds 50 to 57 on the same four settings give medians of 7.3 to 11.6 units and up to 5.2% under 2 units, and seed 729569308 at aridity 0.6 gives 3% with a median of 8.7). The first version put 13% there at aridity 0.6 and 39% in the Rust Belt, and a test holds the line between. Mountain crests and badlands gullies still leave thin slivers, as they did before the canyon fix: over those 37 maps, up to 1.6% of cliff ground is in bands under a unit wide, in runs mostly under 10 units long, though some pass 30 (seed 21 at aridity 0.6 has one near (-290, 950)).

## Keeping the land connected

Ridged noise makes crest lines that enclose its valleys, and canyon lines close into loops. With cliffs wherever the slope ran steep, the first version left a quarter of the passable land, and 4% of the outer band, reachable from the metro at the steepest corner of the tuning range (coverage 1, ruggedness 1, aridity 0, contamination 1). Its fix scaled ridges and gullies by roughness but left canyons out, and a flood fill over 2-unit cells still found the start reaching only 52% to 95% of the outer band at that corner over 50 seeds, 21% at the smallest metro, and as little as 81.5% of it at the Badlands' defaults, with towns cut off behind canyon walls.

Cliffs now stand only in rough country, with no exceptions:

- Rough country is where the roughness layer is above a floor calibrated to 10% to 35% of the land past the relief radius, by `ruggedness`. Well under half, an excursion set of a smooth layer breaks into islands, and the land around them connects across the map.
- Mountains, canyons, and badlands stand at 30% of their height where the roughness layer is under its floor and climb to full height 0.2 above it, point by point rather than by cell, so slopes away from rough country seldom reach the cliff grade, and if one does it's only costly.
- It's decided per cell of a 16-unit lattice, from the layer at the cell's centre, and a cell counts only if all of it lies past the relief radius. Then a flood fill from the metro over the cells that aren't rough, wholly inside the disc and clear of craters, is exact: every cell it reaches joins the metro through ground no cliff can stand on. Towns are placed only in reached cells, and `surelyReachable(x, y)` reads the fill. It's sufficient only: false means not proven, not a pocket. It reads false on all rough ground, where roads can often still find a way, on open ground rough cells ring off, and in cells at the rim or touching a crater, and it ignores water. Over 20 seeds of each environment's defaults and of the steepest corner, it's false for 15% to 33% of the ground a 2-unit flood fill over `impassable` reaches, most of that rough. So the Map Lab's reach readout, like the table below, is a fine flood fill over `impassable`, not this.

Measured with a 4-connected flood fill over 2-unit cells from the metro, as the share of the outer band's (0.85 to 0.95 of the radius) passable ground it reaches, over the first 200 seeds of the sequence the tests sample. These are figures for these seeds; 200 seeds of another sequence reach as little as 83.8% at the steepest corner, and 84.2% with the smallest metro.

| Parameters | Least | 5th percentile | Median | Towns cut off |
| --- | --- | --- | --- | --- |
| steepest corner, radius 600 | 72.9% | 92.7% | 97.0% | 0 of 1,000 |
| steepest corner, radius 600, smallest metro | 72.9% | 92.9% | 96.9% | 0 of 1,000 |
| Badlands, radius 600 | 95.4% | 97.8% | 99.3% | 0 of 600 |
| High Desert defaults | 98.2% | 98.8% | 99.5% | 0 of 600 |
| Badlands defaults | 97.8% | 98.3% | 99.1% | 0 of 600 |
| Mixed defaults | 99.1% | 99.7% | 100% | 0 of 1,000 |
| Rust Belt defaults | 99.3% | 99.9% | 100% | 0 of 1,600 |
| Floodlands defaults | 99.5% | 100% | 100% | 0 of 1,000 |

At the steepest corner with the largest radius and smallest metro, 40 seeds give 95.3% to 98.3% of the outer band, median 97.3%, with no town cut off in 200. Nothing guarantees a share outright: rough islands could close into a ring round the metro, or one can lie across the outer band and wall a stretch of it off against the rim, as on the sequence's sixth seed, the least in the table, where a quarter of the band is cut off. That's a tail: over 30,000 seeds at the steepest corner, about one map in 370 keeps under 85% of the band in reach and one in 2,000 under 80%, and the least kept 71.3%, though another run of 30,000 found one keeping about 66%. No town was cut off in any of them. A test holds the first two seeds of each of the first three sets above 80% on a 4-unit grid, with every town reached.

## The water seam

Rivers and lakes are the water stage's (DDB-289). `WaterLayer` is one method for now, `isWater(x, y)`, and `terrain.withWater(layer)` returns a `Terrain` sharing the land with water added to the obstacles (a crater still reads as a crater) and to cost (Infinity). The water stage will widen it: growth crosses rivers square-on at bridges, so it needs to tell a lake from a river and know which way a river runs. It traces over `elevation` and `slope`, forks its own streams from the terrain stream under names not used here, and decides how water meets the metro, which this stage keeps passable. Town placement's flood fill knows cliffs and craters, not water, so a river can still cut a town off from the metro until a bridge crosses it, and towns are placed before lakes fill the low basins, so the water stage keeps its lakes off them; it can read `terrain.towns`.

## Streams

The stage forks its stream by feature: `plains`, `ranges`, `rangeBreaks`, `ridges`, `roughness`, `moisture`, `canyons`, `badlands`, `gullies`, `contamination`, `hotspots`, and `towns`. It never draws from the stream itself. So towns and hotspots never move the land, and a parameter change moves only what reads it, as the PRNG record intends. Goldens pin three seeds' hotspots, towns, and full samples at four points; a deliberate change to any constant or formula moves them and every map, so it ships with a generator version bump (DDB-296).

## Performance

Measured with `scripts/terrain-bench.mjs` on a quiet Ryzen 9 5950X: a 256 x 256 grid over the disc's bounding square, the median over the five environments and three seeds each, and the median of three runs.

| Query | Node 24 (V8 13.6) | Electron 25 (V8 11.4) |
| --- | --- | --- |
| build (`generateTerrain`) | 2.36 ms | 2.34 ms |
| `sample`, every field | 626 ns (41 ms a grid) | 651 ns (43 ms a grid) |
| `elevation` | 396 ns | 409 ns |
| `slope` | 397 ns | 412 ns |
| `biome` | 543 ns | 586 ns |
| `impassable` | 94 ns | 98 ns |
| `travelCost` | 583 ns | 605 ns |

A grid of every field at 256 is about 41 ms here, a fifth of generation's budget, and perhaps half again on a mid-range laptop. No gameplay stage samples like that: growth's cost lookups, a few per candidate step, should come to tens of thousands, around 20 ms at these rates. Sampling allocates nothing, though `SimplexNoise.sample` is past V8's 460-byte inlining limit, so each octave is a call that boxes its doubles; the scavenges that leaves cost about 5% of sampling time. A smaller kernel, or octave loops with the kernel written in, is the lever if a consumer needs more.

## Consequences

- Every number here is a starting value for the Map Lab (DDB-299), which should show biome shares, rough country, and the share of the edge a fine flood fill over `impassable` reaches, alongside its timings.
- Saves keep the gameplay map, so terrain only matters for loading as a picture; because sampling is arithmetic, a shared seed draws the same terrain in any engine as well.
- The renderer (DDB-298) can shade from `sample`'s slope without sampling neighbours, and should draw cliffs from `obstacle` so roads never seem to cross one. Cliffs end in straight cuts along the 16-unit lattice where a rough cell meets one that isn't: rough country is decided by cell and height point by point, so the same steep wall carries on past the line as passable, costly ground, and drawn from `obstacle` the cut shows where a road can cross.
- Growth (DDB-290) has `travelCost`, Infinity on impassable ground, and `obstacle` to tell water (bridgeable) from the rest. `surelyReachable(x, y)` proves ground reachable but never proves it cut off, so growth shouldn't steer away from where it reads false; its own search over `impassable` is what finds the pockets. Cliffs stand only where `rough(x, y)`, a lookup in the lattice, and there they taper at their tips and mountain crests and gullies leave slivers under a unit wide, so a step should be sampled at a unit or less inside rough cells; outside them no cliff stands, and `impassable` checks the lattice before it reads any elevation.
