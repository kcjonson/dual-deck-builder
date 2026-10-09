# Terrain from uplift and erosion (DDB-441)

Date: 2026-10-09. Code: `src/renderer/game/map/` (`LandGrid.ts`, `Uplift.ts`, `Drainage.ts`, `Erosion.ts`, `Land.ts`, `MapMath.ts`, and `Terrain.ts` reading them; `worker/mapGenerationProtocol.ts` carries the land across the worker boundary), timed by `scripts/terrain-bench.mjs`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 1. Terrain. Builds decision 1 of [realistic-map.md](./realistic-map.md), and replaces the relief half of [terrain-fields.md](./terrain-fields.md)'s field model: its plains, ranges, ridges, canyons, and badlands layers.

## Context

Realistic-map decision 1 picked the method: an uplift field cut down by stream-power erosion, so ranges, valleys, and a drainage network that runs downhill everywhere come out of one process. Its offline prototype showed the look and gave the numbers. This stage builds it in the game: the land on a grid a fifth wider than the disc, outlets on the grid's edge, dry terraces, elevation sampled bicubic, and the drainage kept as plain data for the water stage (Map 5, DDB-289).

The constraints were the spec's. The land is regenerated on load rather than saved, so it has to come out to the same bits in every engine, which rules out `Math.sin`, `exp`, `pow`, `hypot`, and `**` anywhere a value branches or feeds the grid. The `Terrain` interface (`sample`, `elevation`, `slope`, `obstacle`, `travelCost`) keeps its shape, since road growth, its checks, and the area map's bake all read it. And the grid stages share a budget of 1 second on a mid-range laptop, against the prototype's 460 to 550 ms for erosion alone.

## The grid

`landGridFor(radius)` gives `2 * round(0.128 * radius)` cells a side over a square reaching 1.2 times the radius each way: 256 at radius 1000, 204 at 800, 308 at 1200, cells 9.3 to 9.45 units across at any radius. The size is always even, so the coarse pass's grid covers it two cells to one. Cells run row by row from the south-west corner; `cellCentre`, `cellAt`, and `GridSampler` (bicubic with its exact gradient, and bilinear) are the grid's whole vocabulary. A coordinate that isn't a number clamps to the grid's edge in the samplers and gives -1 from `cellAt`, rather than indexing past the arrays.

## Uplift

`buildUplift` lifts every cell by a hill term and a range term, both from `Noise.ts`'s simplex, whose sampling is plain arithmetic:

- Hills: a 450-unit, 3-octave layer, 0.04 to 0.12 of lift by ruggedness, varying 80% either way. The prototype set this per environment; there's no parameter for it, so ruggedness carries it.
- Ranges: a 3-octave layer, gain 0.45, with 1500-unit wavelength along the map's grain and 520 across it, sampled at points bent by a 160-unit warp. A 500-unit, 2-octave breaks layer is added at a quarter weight. Range country is where the sum passes the quantile of itself over the cells inside the disc past the relief radius that `mountainCoverage` asks for, ramping over 0.26 of it, so the mask is half at the threshold and exactly `mountainCoverage` of that land is range country on every map, gaps included. Ranges lift 0.7 to 1.8 by ruggedness.
- The grain is `unitVector(180 * draw)`, Geometry.ts's polynomial sine and cosine, not `Math.cos` and `Math.sin` as the prototype had it.

The prototype multiplied each range's lift by its breaks layer instead (down to 0.45 in a gap) and calibrated coverage on the belt layer alone, so its gaps sat inside "range country" and its mask's share drifted from the parameter. Adding the breaks before the quantile keeps the share exact: the test holds it to within one cell's share over six seeds and four coverages. The cost is gaps that cut a belt rather than notch it, which a quarter weight keeps rare.

Ranges run with the grain loosely rather than ruler-straight. Measured as how much the mask changes 150 units along the grain against across it, over seeds 11 to 24 at radius 600, the ratio ran 0.50 to 0.96, a mean of 0.76; the warp and the breaks, which are the same every way, are what loosen it.

## Drainage

`DrainageRouter` routes by priority flood from the outlets (Barnes 2014). A cell enters the queue at its own height, or 1e-7 above the cell that reached it where that's higher, so pits and flats fill as they're reached and drain outward from their spill. That entry is the cell's water level, and the router keeps it. The queue breaks ties by cell index, so its order never depends on how the heap was built or the order outlets are listed.

When a cell leaves the queue it drains to the neighbour, among those that left before it, that falls furthest per unit of distance on the levels, a diagonal's drop counted at 1 / sqrt(2), ties to the lower index. Every neighbour lower than a cell has left the queue by then, so this is steepest descent, and every cell's level is strictly above its receiver's. The first build drained each cell to whichever neighbour had reached it, which is the flood's order, not the slope's: on a plane tilted 10 degrees off east every cell drained diagonally, and range flanks came out striped at 45 degrees. Now every cell of that plane drains east, and of a 35-degree one north-east, as the tests check, and 33% to 40% of cells drain diagonally on real maps. With the rest of the review's fixes, the land takes about 13% longer than the first build did.

`accumulateArea({ drainage, rain })` sums rain down a drainage's receivers in its order into a new array, without routing again; the router's own `accumulate` does the same in place.

## Erosion

Braun and Willett's implicit stream-power solver with m 0.5 and n 1, as the spec says. Each iteration smooths hillslopes first, a share of the four-neighbour Laplacian, then routes drainage, accumulates area, and updates every cell downstream first, h = (h + dt U + F h_r) / (1 + F) with F = dt K sqrt(area) / distance. Area and distance are both counted in cells, so stream power's steady state is the same land at any cell size, since m / n = 0.5 balances the square root of an area against a length; a test checks the steady state cell by cell, each cell U d / (K sqrt(area)) above its receiver. Diffusion doesn't scale that way: it's a share of the Laplacian per cell, so on cells twice as wide the same share smooths four times as much per world unit, and the coarse pass takes a quarter of it.

Diffusion goes first so each iteration ends on stream power. Smoothing a channel's banks into it after the update leaves pits along the channel, and after the last iteration nothing drains them. With diffusion last, raising it to 0.08 and 0.04 left water standing in 2% or more of the grid on 44 of the 90 maps QA sweeps; with diffusion first, at 0.05 and 0.025, 19 of 90.

Diffusion is 0.05 at ruggedness 0 and 0.025 at 1, so rugged ranges keep sharper slopes. At the first build's 0.024 and 0.004, with receivers in the flood's order, rugged flanks showed the grid as 45-degree striping and blocks; with steepest descent and this diffusion the gullies follow the fall line, though on a flank facing close to a grid axis they still run along it. The surface erosion starts from is 0.05 of the uplift, so ranges start as ridges, plus 0.02 of 120-unit noise, and the outlets hold 0.

Run coarse first, as the spec planned. Measured on Mixed, High Desert, Rust Belt, Floodlands, and Badlands at radius 1000, seed 7, on a desktop Ryzen 9 5950X shared with other work:

| Schedule | Land, ms | Mean change from a full-size run |
| --- | --- | --- |
| 50 iterations at full size | 480 to 559 | |
| 30 at half size, 20 at full | 287 to 321 | 0.007 to 0.023 |
| 40 at half, 10 at full (chosen) | 215 to 256 | 0.009 to 0.026 |
| 45 at half, 5 at full | 182 to 237 | 0.011 to 0.030 |

The change is in elevation, which runs 0 to about 0.7 on these maps. The coarse runs put their rivers in different cells from the full-size run's (only 14% to 16% of cells with more than 200 cells of drainage are shared), but the ranges and the character of the drainage are the same, and a coarse run's land is as valid an eroded landscape as a full one's. 40 and 10 keeps most of the full size's fine valleys for under half its time; 45 and 5 leaves the coarse pass's two-cell valleys showing.

## Outlets

`rivers` cells on the grid's edge, spread round its perimeter from a drawn start, each jittered within half its share, so no two come within half an even spacing. They're the only cells with no receiver, so the region's drainage leaves by exactly that many main rivers. With `rivers` 0 there's one sink, 0.55 of the radius out in a drawn direction, and everything drains to it: a closed basin, its floor at 0, for the water stage to make a dry lake of.

## Elevation

The prototype normalised each map's eroded height to its own 0.2% and 99.5% quantiles, which cancels most of what ruggedness and coverage do to how tall the land stands: a map with no ranges stretched its hills to the same peaks as the most rugged. Here eroded height h becomes elevation h / sqrt(h^2 + 36), close to h / 6 below about 3 and easing toward 1 above, so a gentle map stays low, a rugged one stands tall, and nothing flattens at a clamp. On the environments' defaults the plains run about 0.03 to 0.1 and the peaks 0.55 to 0.8; the steepest corner of the tuning ranges reaches 0.86.

`RELIEF`, the world units elevation 1 stands, is 100, down from the field model's 150. At 150 the eroded ranges, steeper than the field model's, put grade 1 or more on a fifth of Mixed, and since cliffs stand wherever rough country reaches grade 1, the bake drew whole 16-unit roughness cells of cliff, blocks across the ranges. At 100, over QA's sweep, cliffs cover 0% to 4.4% of the disc by environment, against 0.2% to 5.3% on the field model, and ground graded 1 or more covers 0.5% to 17%, against 0.3% to 6.9%. `RELIEF` lives in `Land.ts` now, since the metro's flattening measures grades with it, and `Terrain.ts` re-exports it.

`Terrain` samples the grid with `GridSampler.bicubic`, Catmull-Rom through the cell centres, smooth in value and slope, so the bake's hill shading has no facets and slope is the exact gradient. Range country adds fine relief for the picture: 60-unit, 3-octave noise times 0.006 of the bicubic mask, with its gradient. Plain noise, not ridged, so the land has no crease; the slope test allows none.

## Terraces

Below an aridity of 0.4, full at 0.1, elevation is pulled toward 7 benches a unit, each flat for 55% of its height and rising over the next 37%, by 0.8 at full dryness. The prototype pulled less in range country, which reorders heights wherever the mask changes across a slope; its own drainage then crossed High Desert's plains in long straight diagonals, the flood draining filled flats outward cell by cell. The pull is the same everywhere here, so terracing never reorders heights and leaves no pits: water stands where it stood before terracing, to within cells a bench squeezes within the flood's 1e-7 of each other (under 0.1% of cells on the test maps, and QA's 80-map terrace sweep passes). It squeezes some drops more than others, so on a bench the steepest way down can change. Mesas in the ranges come out as blocky as the benches below them, which reads as the spec's mesas and escarpments.

## The metro

The spec has the lift fade to nothing round the metro. Built that way, it came out two ways wrong. Ground with no lift erodes dead flat, and drainage crosses a dead flat in ruler-straight lines: the flood fills it cell by cell, and the rivers through High Desert's metro ran straight diagonals for hundreds of units. And the metro isn't flat anyway, because erosion is nonlocal: rivers from the ranges still cross it and cut valleys, and with ranges all round it (coverage 1, radius 1600) the metro sat in an intermontane basin with a valley cut 21 units deep through it and grades of 2.

So the ranges fade to nothing round the metro and the hills to half, and after erosion and terraces the land is routed once more and flattened:

- `flattenMetro` only ever lowers land, so it never dams a river. It lowers toward the metro's exit level, the lowest water level in it, where its water leaves, rather than its lowest cell, which would sink the metro into a basin. Inside the metro each cell keeps 15% of its height above that level, or less where 15% would leave a grade over 0.1, the same share for every cell, so heights keep their order and drainage across the metro runs as it did, only shallower. The share eases back to the land's own height at the blend radius.
- After the final routing, `fillMetroWater` raises standing water inside the blend radius, and all the water it connects to, to its level: pits below the exit level, and the ones the blend ring makes by lowering its inner edge more than its outer, become flat ground at the level they'd fill to. Each level is above its receiver's, so the routing stands as it was, and the levels equal the land there.

The first build flattened to the metro's mean and raised what lay below it, which dammed rivers crossing the metro and drowned it in what they backed up. Measured by sampling the terrain on polar grids of the metro, its steepest grade is 0.017 on the five environments' defaults and 0.043 over 48 maps at the corners of the tuning ranges, rivers 0 and 6 among them, with no standing water in the metro or the blend ring. The ring keeps the land's own steepness where ranges come close, up to grade 2.1 at those corners.

## What the water stage gets

`terrain.surface` is a frozen `LandSurface`: the grid, the finished elevation and the range mask per cell, `closedBasin`, and `drainage`, the finished land's drainage as plain typed arrays: `receivers` (-1 at an outlet), `levels`, `area` (one unit of rain a cell), `order` (downstream first), and `outlets`. The arrays are read-only by contract, since typed arrays can't be frozen. `terrainFromSurface({ params, rng, surface })` builds the rest of the terrain over a surface grown elsewhere, refusing one whose grid isn't `landGridFor(params.radius)` or whose arrays don't fit it.

Water stands where a level is above the land. Over QA's 90-map sweep that's a median 0.57% of the grid and at most 8.5%, 2% or more on 19 maps; inside the disc the median is about 0.1% and the most 5.6%, since most of it lies in the grid's margin past the rim. The tests hold it under 10% on every map and 2% at the median over the five environments. They're the coarse pass's last pits, which more coarse iterations drain, but 48 and 10 already took the land past 350 ms at radius 1200, so they stay, for the water stage as lake sites.

For Map 5, the water stage:

- Re-accumulates area with rain weighted by moisture and the ranges over the same receivers and order with `accumulateArea({ drainage, rain })`, or reroutes the finished elevation with `routeDrainage`, which gives the same receivers.
- Gets natural lake and reservoir sites for free: a cell whose level stands above its elevation holds water until it spills.
- Will find straight runs where drainage crosses gentle, even slopes, fewer since steepest descent but still eight directions. The spec's river smoothing and `riverMeander` are the place to break them up.
- Lays its water with `Terrain.withWater`, a layer of functions, which `encodeAreaMap` refuses to send: the water stage sends its own arrays across the worker boundary beside the land's, and the decode lays them back.

## Crossing the worker boundary

The generation worker ([map-pipeline-worker.md](./map-pipeline-worker.md)) used to send no terrain, the client running the terrain stage again on the winning stream, which cost 2 ms for the analytic fields and would cost the whole erosion now. Instead `encodeAreaMap` puts `terrain.surface` in the transfer, its seven typed arrays in the transfer list beside the road network's two, and `decodeAreaMap` rebuilds the terrain with `terrainFromSurface` on the winning terrain stream, refreezing the surface. Transferring detaches the arrays from the worker's terrain, so the worker encodes after its last stage, and is terminated once it has replied.

Measured in Node 24 over five environments by three seeds, a decode takes 11 ms median at radius 1000 and 28 ms at 1600, sending 2.6 MB and 6.6 MB, against 230 and 660 ms to grow the land again. QA measured 14 and 34 ms.

## What the field model lost, and what Map 5 still owns

The plains, ranges, ridges, canyons, badlands, and gully layers are gone, with the derivative bookkeeping that carried their gradients and the canyon wall profile. What the field model also did, and Map 5 (DDB-289) reworks, is kept and adapted only as far as keeping the stages after it working:

- Canyons and badlands are biome categories still, but read off the eroded land rather than drawn. Canyons are the valleys cut deepest below the lower of the cells three either side, across whichever of four directions cuts deepest, 10% of the land outside the ranges on maps of aridity 0.45 and under, none above 0.55. Badlands are the most broken ground, the land's curvature blurred over three cells, their share the field model's (0.7 x ruggedness x (0.3 + 0.7 x contamination)) of the land outside the ranges. Both keep three cells off any range lift, since a range's foot bends the land as hard as any gully, and out of the metro; a map whose shares are both 0 skips them. They're stand-ins: the water stage should read canyons off its rivers.
- Low ground is measured on each map's own land: its lowland level is the elevation 55% of the land outside the ranges lies under, and `lowland` goes from 1 to 0 across it over 0.02 of elevation. Mire needs lowland of a half or more where it needed elevation under 0.42 on the field model, and moisture gains 0.5 a unit of elevation below the level and loses it above. A fixed level followed ruggedness, since rugged maps stand taller: at elevation 0.05, mire on a Floodlands map at radius 800 fell from 55% to 29% between ruggedness 0.15 and 0.85, and on the lowland level it's 35% and 36%. Both are stand-ins until the water stage spreads wetness from its rivers.
- Rough country is still the 16-unit roughness lattice, and cliffs still stand only there, wherever the eroded slope reaches grade 1. Realistic-map.md has rough country and cliffs coming from eroded slope; that's Map 5's.
- Moisture's noise, contamination, hotspots, towns, cost, and the `WaterLayer` seam are unchanged.

On seed 7's five environments the biome shares come out near the field model's: Mixed 24% mountains, 45% scrub, 12% desert, 9% mire, 6% badlands, 3% canyons (field model 24, 37, 15, 13, 8, 4); High Desert 34% mountains, 37% desert, 15% scrub, 8% badlands, 6% canyons (33, 36, 15, 11, 5); Badlands 34% mountains, 21% desert, 21% scrub, 16% badlands, 6% canyons, 4% mire (33, 20, 16, 21, 6, 5). Floodlands carries 41% mire against 44%, and Rust Belt 17%.

How much of the edge the start reaches, by a 4-unit flood fill over `impassable` from the metro, as the share of the outer band's passable ground, over the first 20 seeds of the sequence terrain-fields.md samples:

| Parameters | Least | 5th percentile | Median | Towns cut off |
| --- | --- | --- | --- | --- |
| steepest corner, radius 600 | 97.0% | 97.7% | 99.4% | 0 of 100 |
| Badlands, radius 600 | 99.3% | 99.4% | 99.9% | 0 of 60 |
| High Desert defaults | 99.1% | 99.2% | 99.6% | 0 of 60 |
| Mixed defaults | 99.9% | 100% | 100% | 0 of 100 |

The outward road growth that Map 7 replaces copes with the new land unchanged: its unit and property tests pass, and `scripts/road-growth.mjs check` passes on 50 maps sampled across the tuning ranges with none failing a first attempt.

## Determinism

The land is built from adds, multiplies, divides, compares, square roots, and floors, which ECMAScript gives exactly, and from noise and draws that are too. ESLint holds generation to that: under `src/renderer/game/map/`, tests aside, it rejects `Math.sin`, `cos`, `tan` and their inverses, `exp` and `log` in all their forms, `pow`, `hypot`, `cbrt`, the hyperbolics, and `**`. The road tests' fixtures, which place a test's own departures and measure what growth made, disable it line by line with their reasons. The tests pin a hash of the eroded grid and its receivers for two maps, a Mixed map at radius 800 and a terraced closed basin, computed in a separate Node process from the Jest run that checks them, and a fresh copy of the module erodes the same bits.

The terrain stream forks by feature: `hills`, `ranges`, `rangeWarp`, `rangeBreaks`, `grain`, `outlets`, and `initial` for the land, and `detail`, `moisture`, `roughness`, `contamination`, `hotspots`, and `towns` for the rest. So towns, hotspots, contamination, and anything past the terrain stage never move the land; a test changes six such parameters and gets the same grid.

## Performance

`node scripts/terrain-bench.mjs --radii 800,1000,1200,1600`, Node 24 (V8 13.6), the same shared desktop, the median of three seeds per radius and environment:

| Radius | Grid | Mixed | High Desert | Rust Belt | Floodlands | Badlands | Uplift | Erosion | Drainage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 800 | 204 x 204 | 141 ms | 137 | 140 | 142 | 141 | 16 | 119 | 5.6 |
| 1000 | 256 x 256 | 233 | 227 | 232 | 236 | 228 | 25 | 197 | 9.4 |
| 1200 | 308 x 308 | 349 | 346 | 352 | 354 | 357 | 36 | 302 | 14.3 |
| 1600 | 410 x 410 | 657 | 647 | 662 | 667 | 653 | 66 | 566 | 27.2 |

Erosion is the land's time less the uplift's and the final drainage's; it includes elevation, terraces, the metro's routing and flattening, a few milliseconds. The whole terrain build at radius 1000 is 243 ms. Sampling: a full sample 416 ns (626 on the field model), elevation 128 ns (396), slope 138 ns (397), travel cost 352 ns (583).

The spec gives the grid stages a second on a mid-range laptop. Scaling this desktop's numbers to one, the review put the land with water and roads at about 1.0 to 1.4 s at radius 1200: over budget on the largest maps once the water stage lands, before counting radius 1600, where the land alone takes nearly twice radius 1200's time. Whenever the pipeline goes back to the terrain stage, a map restart or a retry escalated up to it, the land grows again, erosion and all; retries of the stages after it reuse it. Routing is most of erosion's time, a priority flood, O(n log n), fifty times over. The lever is routing in O(n): receivers by steepest descent straight from the heights, with the priority flood run only over the cells in pits. It isn't built.

Under Jest a terrain at radius 1000 takes about 0.3 s to build, and 0.8 s with coverage on, which CI runs. So the terrain tests build each parameter set once a file, and the sweeps stay at 15 sets.

## Consequences

- The area map gallery scene's land and roads move, and its goldens re-baseline with this change.
- Every generated map moves. Nothing saved holds the land (it regenerates on load), but saves made before this load onto a different picture under the same roads, and DDB-296's generator version should count this change.
- The field model's records stay in terrain-fields.md where they still hold: the noise, the start's blends, sites, rough country, cliffs, cost, and the water seam.

## Provisional calls

Calls the spec and realistic-map.md left to the build, made the simplest way consistent with them, for Kevin to approve or adjust:

1. The grid: `2 * round(0.128 * radius)` cells a side, even, so cells stay about 9.4 units at any radius.
2. Hills lift 0.04 to 0.12 by ruggedness, which has no parameter of its own.
3. Ranges: belts of a 1500 by 520 unit layer, 3 octaves at gain 0.45, warped 160 units at 800, breaks added at a quarter weight from a 500-unit layer before the coverage quantile, a mask ramp of 0.26, and a lift of 0.7 to 1.8 by ruggedness.
4. Drainage by steepest descent on the water levels, a diagonal's drop counted at 1 / sqrt(2), ties to the lower index.
5. Erosion: dt 1.2, K 0.11, uplift rate 0.1; 40 iterations at half size, then 10 at full; diffusion 0.05 at ruggedness 0 to 0.025 at 1, a quarter of it on the coarse pass, before the routing in each iteration; the starting surface 0.05 of the uplift plus 0.02 of 120-unit noise.
6. Elevation h / sqrt(h^2 + 36) over the eroded height, with `RELIEF` 100.
7. Outlets spread evenly round the edge with half a spacing of jitter; a closed basin's sink 0.55 of the radius out.
8. Terraces below aridity 0.4, full at 0.1: 7 benches a unit, risers over 0.55 to 0.92 of each step, a pull of 0.8, the same in the ranges as out of them.
9. The metro: the hills lift at half round it rather than not at all; after erosion it's lowered toward its exit level, keeping 15% of its relief or less where a grade would pass 0.1, easing out to the blend radius, and standing water inside the blend radius is filled to its level.
10. Standing water left where the coarse pass leaves it, under 2% of the grid on most maps, rather than more iterations to drain it.
11. Fine relief in range country: 60-unit, 3-octave noise at 0.006 times the mask.
12. Until Map 5: canyons and badlands as above; the lowland level at the elevation 55% of the land outside the ranges lies under, with a ramp of 0.02, for mire and moisture.
