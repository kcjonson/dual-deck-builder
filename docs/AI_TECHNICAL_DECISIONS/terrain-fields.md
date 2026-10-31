# Terrain fields (DDB-288)

Date: 2026-10-07. Code: `_legacy/src/renderer/game/map/` (`Noise.ts`, `Terrain.ts`, `Biome.ts`, `TerrainSites.ts`). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 1. Terrain. Follows [seeded-prng.md](./seeded-prng.md) and [map-params.md](./map-params.md).

The land's relief, the plains, ranges, ridges, canyons, and badlands layers this record built elevation from, gave way to uplift and erosion: [terrain-erosion.md](./terrain-erosion.md). Moisture, rough country, cliffs, cost, and the water then went to the water stage: [water-and-biomes.md](./water-and-biomes.md). Towns went to the places stage, and hotspots to its hazards stage on the same rules: [places.md](./places.md). What's here still holds for the noise, contamination, the biome thresholds, the start's blends, and hotspots, as noted where the later stages changed them.

## Context

Terrain is the first stage of the area map pipeline: continuous fields over the disc (elevation, moisture, contamination), the biomes read off them, the metro and towns, hotspots, what's impassable, and what it costs to cross. Every later stage samples it. Water traces rivers over elevation, growth steers by cost and stops at impassable ground, POIs and stops read biomes and ruins, and the renderer bakes the map's image from it. The fields have to be pure functions of (x, y), sampleable at any resolution, cheap enough to leave room in generation for everything else, and the same for a seed on every platform as far as cheaply possible. The spec left the noise source open (open question 3) and gave the field model in a paragraph.

The stage takes validated `MapParams` and its own stream, the pipeline's `terrain` fork, and returns a `Terrain`: `generateTerrain({ params, rng })`.

## Noise is the engine's

In the C++ alpha (2026-10-30, DDB-571) the noise is salal foundation's (`random/HashNoise.h`): gradient noise on a square lattice, each corner's gradient from an integer hash of the corner and a seed, quintic fade, summed in octaves by `fractalNoise2`. A layer's seed is its feature's fork of the stage stream, `stream.fork("hills").seed()`, so a layer takes no draws at all, where the simplex below took 255 for its permutation, and the same feature names still keep one layer from moving another. It's single precision and plain arithmetic, so it's as bit-identical across platforms as the simplex was, and the engine already keeps it for worldsim, so a second noise in the game would only be one more to keep.

What the TypeScript's simplex had that salal's noise doesn't yet: exact derivatives, the bounded early-out, and octaves offset off each other's lattice points (every octave of salal's sum is zero at the first octave's integer points). The terrain stage needs only values so far, except the fine relief range country adds for the picture, whose slope needs the noise's gradient; that waits on salal's noise returning derivatives, rather than a second noise here. The gradient analysis below is the simplex's: salal's twelve cube-edge gradients flatten to axes and diagonals in 2D, so the square lattice's 4-fold comb is what the alpha's slope histogram will show, if anything does through erosion.

The TypeScript's choice, which the rest of this section records:

- The `simplex-noise` package (MIT, small). It builds each layer's permutation from a `() => number` it calls 255 times, then samples with its own gradient set and scale. Every map would depend on those internals staying put across versions, so a dependency bump could move every map with nothing in this repo changing, and it adds a dependency and lockfile churn for about a hundred lines of code. It has no derivatives.
- An in-repo function (chosen). `SimplexNoise` is 2D simplex noise in Gustavson's formulation: Perlin's skewed grid, (0.5 - r^2)^4 corner kernels, twelve unit gradients, and a permutation of 0 to 255 from `Rng.shuffle`, whose draw count the PRNG record already pins (255 draws a layer, rarely more). Sampling is adds, multiplies, compares, and integer ops, the floor done in integer ops (`| 0` in the TypeScript) and the skew constants written out, so with floating-point contraction off (`-ffp-contract=off`, which salal's foundation sets for GCC and Clang) a seed's noise is bit-identical on every platform and thresholds can branch on it. That covers the fields too. It also returns its exact derivatives, which slope needs (below), and its fractal sum takes optional bounds: given the range a caller cares about, it stops once the octaves left can't bring the value there. One loop serves both, so a value that comes back with bounds is the same to the bit as without. A value exactly on a bound is the exception: the checks compare the sum before it's divided, so it can land on either side, and on a few large maps the one rough-lattice cell whose roughness equals the floor exactly is marked rough that way.

The gradients are picked against the grid. Its edges run at 45, -15, and 105 degrees, and where the gradients at both ends of an edge are square to it, a single-octave layer is exactly zero along the whole edge, so a ridged layer (ridges, range lines) creases there in a short straight line. Sixteen gradients 22.5 degrees apart, the first set tried, hold the two square to the long diagonals and leave about one long diagonal in 64 zero: 140 of the 24,576 edges a test walks over eight seeds. Twelve, 30 degrees apart from east, come no nearer than 15 degrees to square with any edge, and the test finds no edge zero. The permutation's values hash to them by remainder for the first 252 and to east, north, west, and south for the last four, so the set still averages to nothing and spreads as far along any line as along another. The scale, 99.2, is just under 81 * sqrt(6) / 2, the reciprocal of the largest sum three corners can reach with any unit gradients, so samples stay inside (-1, 1) whatever the set, and the early-out relies on that bound. A test works both out over a fine grid of the cell: that largest sum, and the twelve's own, 0.976 once scaled.

Any set still leaves one short straight crease at every lattice vertex, which is the kernel's doing, not the set's: a layer is zero at every vertex, and near one its own kernel outweighs the rest, so the zero line through it runs straight to within a thousandth of a lattice unit for about 0.4 units (up to 0.47), and a ridged layer creases along it. It's cosmetic.

Fewer directions could favour some. Any finite set leaves a comb of slightly favoured slope directions, a tooth per gradient, and one octave alone shows it about as strongly with twelve as with sixteen: over 3.2 million samples the slope histogram's 12-fold term is 0.043 against the sixteen's 16-fold 0.047, beside the grid's own 6-fold at 0.027 against 0.030. The four extra axis gradients add a 4-fold term of about 0.0025 (the sampling floor is 0.0006), which favours the axes over the diagonals by about 0.3%: on its own it would put 50.2% of slopes nearer an axis than a diagonal. Nothing shows at first or second order. In the terrain the comb washes out: over 10,000 maps, 2,000 seeds of each environment, 10-degree bins of slope direction hold 0.985 to 1.012 of an even share and no harmonic of the histogram passes 0.003, the comb's included, and in range country, where ridges set the slope, the crest axes' harmonics stay at 0.003 or under.

## The fields

Feature sizes are world units, not shares of the radius, so a bigger map has more of everything rather than bigger mountains, and roads, which step and keep clear in world units, meet the same terrain on any map. Every value below is a starting value for the Map Lab to tune. Elevation and the range mask now come from the eroded land (terrain-erosion.md), and moisture, rough country, canyons, and badlands from the water and the eroded slope (water-and-biomes.md); the layer left is this:

| Layer | Noise | Shaped by |
| --- | --- | --- |
| Contamination | 2 octaves, 450 units; hotspot plumes combine over it as 1 - (1 - c)(1 - p) | `contamination`, the toxic share; `hotspots` |

Each threshold behind a share (toxic ground, and on the eroded land the range mask, rough country, canyons, and badlands) is a quantile of its layer over a lattice of the disc or the land's cells, taken past the radius where the feature fades in, so `contamination` 0.3 means that share of the country beyond the metro's surroundings on every map, whatever the noise drew. Shares of 0 and 1 are infinite thresholds: none and all.

`aridity` follows the spec as written, 0 dry desert to 1 wet ground and mire, which reads backwards for the name. Whether to rename it or flip it is open (DDB-405), so the mapping lives in one function, `moistureLevel(aridity)`, and either change is a line there.

## Biomes

Thresholds on the fields, first match wins:

| Biome | Where |
| --- | --- |
| Mountains | the range mask is 0.5 or more: range country, ridges and valleys alike |
| Canyons | the canyon field is 0.5 or more: deep in a river valley cut into dry country (water-and-biomes.md) |
| Toxic mire | low ground, at least half as low as the water's level beside it (water-and-biomes.md), and moisture plus 0.25 x contamination is 0.75 or more |
| Badlands | the badlands field is 0.5 or more and moisture under 0.6 |
| Barren desert | moisture under 0.3 |
| Scrub | the middling rest |

Mountains' share then is `mountainCoverage` by construction. Mire needs low, wet ground, and contamination counts toward wet, so toxic ground goes to mire sooner. Ruins aren't a biome: ruin is 1 inside the metro or a town and fades to 0 at twice its radius, over whatever land it stands on, for POIs, stops, and the scenery's street grids to read (read from the places now, villages included: places.md).

## The start

The metro is `metroSize` of the radius around the compound. Inside it the fields are scrub's: moisture 0.45, no contamination, no mountains, canyons, or badlands, and flat land (terrain-erosion.md, The metro). Moisture and contamination blend back to their own out to the blend radius (the metro plus half its radius, or 6% of the map's, whichever is more). Ranges, canyons, and badlands ramp in from the metro's edge out to the relief radius, a tenth of the map's radius past the blend radius, on squared distance so no square root is taken. Hotspots are centred past the blend radius plus the largest crater, and no cliff stands inside the relief radius. So the metro is always flat scrub with nothing impassable, which a property test checks across the tuning ranges, the extreme corners included.

## Hotspots

Hotspots are Poisson-disc samples: candidates drawn uniformly, each kept only if it's far enough from those kept before, dart-thrown over a ring of the disc (in its bounding square, redrawn until inside, so no square root or trig); one gets 48 candidates and is left out if none fits, which their spacing makes vanishingly rare across the tuning ranges, and tests check every one asked for is placed.

Crater radius 14 to 26 units, impassable; plume 5 to 8 times the crater, contamination at the centre 0.75 to 1, falling off as (1 - d^2 / r^2)^2; centres at least a quarter of the radius apart, between the blend radius plus the largest crater and 0.9 of the radius, and off the land's drainage, so no crater sits on a river (water-and-biomes.md, Hazards). The hazards stage places them now, on these rules, with craters also keeping off lakes (places.md, Hazards).

## Slope, cost, and connectivity

Slope is the eroded land's exact gradient (terrain-erosion.md), and grade is that times `RELIEF`. Obstacles, rough country and cliffs, the cost of a move, and keeping the land connected to the metro are the water stage's: [water-and-biomes.md](./water-and-biomes.md).

## Streams

The stage forks its stream by feature: for the land `hills`, `ranges`, `rangeWarp`, `rangeBreaks`, `grain`, `outlets`, and `initial`, and for the rest `detail`, `roughness`, `contamination`, `hotspots`, and `towns`; moisture's noise is the water stream's now. It never draws from the stream itself. So towns and hotspots never move the land, and a parameter change moves only what reads it, as the PRNG record intends. Tests pin three seeds' hotspots, towns, and full samples at four points; a deliberate change to any constant or formula moves them and every map, so it ships with a generator version bump (DDB-296).

## Consequences

- Every number here is a starting value to tune. The map tuning tool (the TypeScript build's Map Lab, DDB-299) should show biome shares, rough country, and the share of the edge a fine flood fill over `impassable` reaches.
- Saves keep the gameplay map, so terrain only matters for loading as a picture; because sampling is arithmetic, a shared seed draws the same terrain on every platform as well.
- The renderer (DDB-298) can shade from `sample`'s slope without sampling neighbours. It draws cliffs from `cliffDepth`, the same fields `obstacle` reads, closed over two texels (water-and-biomes.md), so roads never seem to cross one.
