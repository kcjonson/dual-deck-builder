# Terrain fields (DDB-288)

Date: 2026-10-07. Code: `src/renderer/game/map/` (`Noise.ts`, `Terrain.ts`, `Biome.ts`, `TerrainSites.ts`), timed by `scripts/terrain-bench.mjs`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 1. Terrain. Follows [seeded-prng.md](./seeded-prng.md) and [map-params.md](./map-params.md).

## Context

Terrain is the first stage of the area map pipeline: continuous fields over the disc (elevation, moisture, contamination), the biomes read off them, the metro and towns, hotspots, what's impassable, and what it costs to cross. Every later stage samples it. Water traces rivers over elevation, growth steers by cost and stops at impassable ground, POIs and stops read biomes and ruins, and the renderer bakes the map's image from it. The fields have to be pure functions of (x, y), sampleable at any resolution, fast enough to leave room in generation's 200 ms for everything else, and the same for a seed in every engine as far as cheaply possible. The spec left the noise source open (open question 3) and gave the field model in a paragraph.

The stage takes validated `MapParams` and its own stream, the pipeline's `terrain` fork, and returns a `Terrain`: `generateTerrain({ params, rng })`.

## Noise is written in the repo

- The `simplex-noise` package (MIT, small). It builds each layer's permutation from a `() => number` it calls 255 times, then samples with its own gradient set and scale. Every map would depend on those internals staying put across versions, so a dependency bump could move every map with nothing in this repo changing, and it adds a dependency and lockfile churn for about a hundred lines of code. It has no derivatives.
- An in-repo function (chosen). `SimplexNoise` is 2D simplex noise in Gustavson's formulation: Perlin's skewed grid, (0.5 - r^2)^4 corner kernels, sixteen unit gradients, and a permutation of 0 to 255 from `Rng.shuffle`, whose draw count the PRNG record already pins (255 draws a layer). Sampling is adds, multiplies, compares, and integer ops, the floor done with `| 0` and the skew constants written out, so a seed's noise is bit-identical in every engine and thresholds can branch on it. That covers the fields too: the same goldens come out of Node 24's V8 and Electron 25's. It also returns its exact derivatives, which slope needs (below), and has an early-out sum, `fractalWithin`, that stops once the octaves left can't bring the value into the range a caller cares about.

A sample takes about 21 ns on V8, derivatives included. The scale, 99.2, is just under 81 * sqrt(6) / 2, the reciprocal of the largest sum three corners can reach with unit gradients, so samples stay inside (-1, 1); the early-out relies on that bound.

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

The metro is `metroSize` of the radius around the compound. Inside it the fields are scrub's: moisture 0.45, no contamination, the plains flattened to 30% of their roll, and no mountains, canyons, or badlands. Moisture and contamination blend back to their own out to the blend radius (the metro plus half its radius, or 6% of the map's, whichever is more), and relief fades in over a further tenth of the radius, on squared distance so no square root is taken. Hotspots are centred past the blend radius plus the largest crater, and no cliff stands inside the relief radius. So the metro is always flat scrub with nothing impassable, which a property test checks across the tuning ranges, the extreme corners included.

## Hotspots and towns

Both are dart-thrown, a Poisson-disc sample: candidates drawn uniformly over a ring of the disc (in its bounding square, redrawn until inside, so no square root or trig), each kept only if it's far enough from those kept before. A feature gets 48 candidates and is left out if none fits, which the spacing makes vanishingly rare across the tuning ranges; tests check every one asked for is placed.

- Hotspots: crater radius 14 to 26 units, impassable; plume 5 to 8 times the crater, contamination at the centre 0.75 to 1, falling off as (1 - d^2 / r^2)^2; centres at least a quarter of the radius apart, between the blend radius plus the largest crater and 0.9 of the radius.
- Towns: radius 0.25 to 0.4 of the metro's, at least 20 units; centres 0.22 of the radius apart, wholly between the blend radius and 0.9 of the radius, 20 units clear of craters, in a cell a road from the metro can reach (below), and for the first half of their candidates out of mountains and canyons.

## Slope, obstacles, and cost

Elevation carries its exact gradient, worked through every term alongside it: the noise's own derivatives, then the chain rule through masks, blends, crests, and the canyon profile. Forward differences took two more elevation samples per slope, which made cost and the full sample three times as dear as elevation. With the gradient they're about one and a half times. A test holds it to central differences, which agree to rounding except within a step of a crease, where ridge and gully noise crosses zero.

- Grade is the gradient's size times `RELIEF`, 150: rise over run with elevation 1 standing 150 world units high.
- Obstacles, in precedence: a crater, water (from the water stage), a cliff: grade 1 or steeper in rough country. Steep ground outside rough country isn't a cliff, only costly.
- Travel cost per world unit: the biome's base cost plus 3 x (grade / 1)^2, so 1 on flat scrub and Infinity on impassable ground; steep ground outside rough country costs more than 3 on top. Base costs: scrub 1, desert 1.25, canyons 1.5, badlands 1.8, mire 2.2, mountains 2.5. Growth tunes these.
- The cliff test compares squared gradients, so no branch depends on a square root. `grade` takes one, for display.
- Canyon walls are bands, not hairlines. A first version scaled a canyon's width with its strength as well as its depth, so its wall grade never fell however faint it got: a middling map was laced with cliffs a twentieth of a unit wide and under half a unit high, which growth sampling every few units would hit or miss by chance. A canyon's width now depends on ruggedness alone, so a faint canyon is shallow and gentle rather than narrow, and its walls hold one grade over their middle 60%, so a wall steep enough to be a cliff is one across most of its width. Measured across the slope at every cliff point on a 150-cell grid, cliffs' bands have medians of 8.6 to 10.4 units, and 1% to 4.4% of cliff ground sits in bands under 2 units, the tapered tips every cliff has; the first version put 13% there at aridity 0.6 and 39% in the Rust Belt, and a test holds the line between.

## Keeping the land connected

Ridged noise makes crest lines that enclose its valleys, and canyon lines close into loops. With cliffs wherever the slope ran steep, the first version left a quarter of the passable land, and 4% of the outer band, reachable from the metro at the steepest corner of the tuning range (coverage 1, ruggedness 1, aridity 0, contamination 1). Its fix scaled ridges and gullies by roughness but left canyons out, and a flood fill over 2-unit cells still found the start reaching only 52% to 95% of the outer band at that corner over 50 seeds, 21% at the smallest metro, and as little as 81.5% of it at the Badlands' defaults, with towns cut off behind canyon walls.

Cliffs now stand only in rough country, with no exceptions:

- Rough country is where the roughness layer is above a floor calibrated to 10% to 35% of the land past the relief radius, by `ruggedness`, and never inside the relief radius. Well under half, an excursion set of a smooth layer breaks into islands, and the land around them connects across the map.
- Mountains, canyons, and badlands keep 30% of their height outside it, so slopes there seldom reach the cliff grade, and if one does it's only costly.
- It's decided per cell of a 16-unit lattice, from the layer at the cell's centre. Then a flood fill from the metro over the cells that aren't rough, wholly inside the disc and clear of craters, is exact: every cell it reaches joins the metro through ground no cliff can stand on. Towns are placed only in reached cells. Building a map's terrain, lattice and fill included, takes about 1.3 ms at radius 600, 2 ms at the default 1000, and 3.2 ms at the largest, 1600.

Measured with a 4-connected flood fill over 2-unit cells from the metro, as the share of the outer band's (0.85 to 0.95 of the radius) passable ground it reaches, over the first 200 seeds of a fixed sequence:

| Parameters | Least | 5th percentile | Median | Towns cut off |
| --- | --- | --- | --- | --- |
| steepest corner, radius 600 | 87.3% | 93.1% | 96.9% | 0 of 1,000 |
| steepest corner, radius 600, smallest metro | 87.3% | 93.0% | 96.9% | 0 of 1,000 |
| Badlands, radius 600 | 96.2% | 97.7% | 99.4% | 0 of 600 |
| High Desert defaults | 98.1% | 98.9% | 99.5% | 0 of 600 |
| Badlands defaults | 96.7% | 98.2% | 99.1% | 0 of 600 |
| Mixed defaults | 99.3% | 99.7% | 100% | 0 of 1,000 |
| Rust Belt defaults | 99.2% | 99.9% | 100% | 0 of 1,600 |
| Floodlands defaults | 99.6% | 99.9% | 100% | 0 of 1,000 |

At the steepest corner with the largest radius and smallest metro, 40 seeds give 95.3% to 98.0% of the outer band, median 96.8%, with no town cut off in 200. Nothing guarantees a share outright, since rough islands could close into a ring round the metro, but the least share over all 1,640 maps is 87.3%. A test holds the first two seeds of each of the first three sets above 80% on a 4-unit grid, with every town reached.

## The water seam

Rivers and lakes are the water stage's (DDB-289). `WaterLayer` is one method for now, `isWater(x, y)`, and `terrain.withWater(layer)` returns a `Terrain` sharing the land with water added to the obstacles (a crater still reads as a crater) and to cost (Infinity). The water stage will widen it: growth crosses rivers square-on at bridges, so it needs to tell a lake from a river and know which way a river runs. It traces over `elevation` and `slope`, forks its own streams from the terrain stream under names not used here, and decides how water meets the metro, which this stage keeps passable. Town placement's flood fill knows cliffs and craters, not water, so a river can still cut a town off from the metro until a bridge crosses it.

## Streams

The stage forks its stream by feature: `plains`, `ranges`, `rangeBreaks`, `ridges`, `roughness`, `moisture`, `canyons`, `badlands`, `gullies`, `contamination`, `hotspots`, and `towns`. It never draws from the stream itself. So towns and hotspots never move the land, and a parameter change moves only what reads it, as the PRNG record intends. Goldens pin three seeds' hotspots, towns, and full samples at four points; a deliberate change to any constant or formula moves them and every map, so it ships with a generator version bump (DDB-296).

## Performance

Measured with `scripts/terrain-bench.mjs` on a Ryzen 9 5950X: a 256 x 256 grid over the disc's bounding square, median over the five environments and three seeds each.

| Query | Node 24 (V8 13.6) | Electron 25 (V8 11.4) |
| --- | --- | --- |
| build (`generateTerrain`) | 2.23 ms | 2.21 ms |
| `sample`, every field | 620 ns (41 ms a grid) | 641 ns (42 ms a grid) |
| `elevation` | 411 ns | 423 ns |
| `slope` | 415 ns | 426 ns |
| `biome` | 551 ns | 571 ns |
| `impassable` | 425 ns | 443 ns |
| `travelCost` | 576 ns | 589 ns |

A grid of every field at 256 is about 41 ms here, a fifth of generation's budget, and perhaps half again on a mid-range laptop. No gameplay stage samples like that: growth's cost lookups, a few per candidate step, should come to tens of thousands, around 20 ms at these rates. Sampling allocates nothing, though `SimplexNoise.sample` is past V8's 460-byte inlining limit, so each octave is a call that boxes its doubles; the scavenges that leaves cost about 5% of sampling time. A smaller kernel, or octave loops with the kernel written in, is the lever if a consumer needs more.

## Consequences

- Every number here is a starting value for the Map Lab (DDB-299), which should show biome shares, rough country, and the reachable share of the edge alongside its timings.
- Saves keep the gameplay map, so terrain only matters for loading as a picture; because sampling is arithmetic, a shared seed draws the same terrain in any engine as well.
- The renderer (DDB-298) can shade from `sample`'s slope without sampling neighbours, and should draw cliffs from `obstacle` so roads never seem to cross one.
- Growth (DDB-290) has `travelCost`, Infinity on impassable ground, and `obstacle` to tell water (bridgeable) from the rest. Cliffs are bands several units across but taper at their tips, so a step's samples should sit a few units apart rather than only at its ends. `rough(x, y)` says where cliffs can stand at all.
