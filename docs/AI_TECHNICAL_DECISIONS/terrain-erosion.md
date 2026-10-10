# Terrain from uplift and erosion (DDB-441)

Date: 2026-10-09. Code: `src/renderer/game/map/` (`LandGrid.ts`, `Uplift.ts`, `Drainage.ts`, `Erosion.ts`, `Land.ts`, `MapMath.ts`, and `Terrain.ts` reading them; `worker/mapGenerationProtocol.ts` carries the land across the worker boundary), timed by `scripts/terrain-bench.mjs`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 1. Terrain. Builds decision 1 of [realistic-map.md](./realistic-map.md), and replaces the relief half of [terrain-fields.md](./terrain-fields.md)'s field model: its plains, ranges, ridges, canyons, and badlands layers.

## Context

Realistic-map decision 1 picked the method: an uplift field cut down by stream-power erosion, so ranges, valleys, and a drainage network that runs downhill everywhere come out of one process. Its offline prototype showed the look and gave the numbers. This stage builds it in the game: the land on a grid a fifth wider than the disc, outlets on the grid's edge, dry terraces, elevation sampled bicubic, and the drainage kept as plain data for the water stage (Map 5, DDB-289).

The constraints were the spec's. The land is regenerated on load rather than saved, so it has to come out to the same bits in every engine, which rules out `Math.sin`, `exp`, `pow`, `hypot`, and `**` anywhere a value branches or feeds the grid. The `Terrain` interface (`sample`, `elevation`, `slope`, `obstacle`, and then `travelCost`, which the water stage replaced with `moveCost`) keeps its shape, since road growth, its checks, and the area map's bake all read it. And the grid stages share a budget of 1 second on a mid-range laptop, against the prototype's 460 to 550 ms for erosion alone.

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

A cell's water level is its height, or 1e-7 above its lowest neighbour's level where that's higher, and an outlet's is its height: the levels a priority flood from the outlets gives (Barnes 2014), so pits and flats fill to their spill and drain outward from it. They're the one solution of that rule as long as a flood rise still raises a level, x + 1e-7 > x, which holds for heights within 2^30, about a billion, of zero. So any way of finding them gives the same bits, up to the sign of a zero: a height of -0 whose lowest neighbour stands exactly 1e-7 below it can come out -0 one way and 0 another. The router keeps the levels.

Each cell drains to the neighbour that falls furthest per unit of distance on the levels, a diagonal's drop counted at 1 / sqrt(2), ties to the lower index: steepest descent, so every cell's level is strictly above its receiver's. Every cell of a plane tilted 10 degrees off east drains east, and of a 35-degree one north-east, as the tests check, and 35% to 43% of the disc's cells drain diagonally on real maps. Draining each cell to whichever neighbour the flood reached it from instead follows the flood's order, not the slope's: every cell of the 10-degree plane drains diagonally, and range flanks come out striped at 45 degrees.

`DrainageRouter` finds the levels and receivers in time linear in the grid wherever the land drains freely, after Braun and Willett (2013), and runs the priority flood only where water stands:

- One scan in index order finds each cell's steepest fall on the heights, its local receiver. A cell whose steepest fall is less than 1e-7 is a root: an outlet, or a pit.
- A cell's basin is the root its chain of local receivers ends at, found by walking the chain to a cell whose basin is known. The outlets' basins together are the ocean, and every cell of it stands at its height, since each falls 1e-7 or more to a cell that does.
- Neighbouring cells in two basins make a pass at the higher of their heights. A pit's spill is the lowest, over every way to the ocean, of the highest pass on the way: a widest-path Dijkstra over the basins, a few hundred on a map.
- The flood runs over each pit's cells under its limit, its spill and a band of 1e-4, from the cells round them, which stand at their heights. A cell reached at its own height waits in a heap; one reached under water goes in a FIFO, 1e-7 above the level just settled, so the FIFO's levels never fall and the two together keep level order. The cells round a lake in its own basin stand over its limit, so what they'd offer it is left out, and most of a lake fills from its spill through the FIFO with no heap work.
- Then it's checked. Every level must settle under its limit, so nothing left out could have lowered one, and a cell round the flood that drains into it keeps its height only if no level beside it now raises it. A lake more than a thousand cells across, whose levels climb past the band, fails, and the flood runs again over the pits' whole basins, which hold all the water there is, leaving nothing out. Once the check holds, every level obeys the rule, so the levels are the flood's exactly. The exactness is the check's, not the spills': a spill found too low leaves water out, which the check catches, and one too high floods cells it needn't, so a wrong spill costs time, never bits.
- Receivers are the local ones except in and beside the flood, where they're the steepest fall on the levels: a cell standing at its height whose local receiver does too falls to that same neighbour on the levels. A cell beside one whose height isn't a number takes its receiver on the levels too, since that neighbour's level, a flood rise over its lowest neighbour's, isn't at least its height.
- The order walks each cell's chain of receivers down to a cell already listed and lists the walk bottom up, so every cell comes after the one it drains to.

On real maps the pits' catchments cover 85% to 99% of the grid, since each iteration's diffusion leaves pits along the channels, but the water standing in them is 1.4% to 3% of the full-size grid and about 14% of the coarse pass's, and the flood with its band covers barely more. The tests hold the router to a plain priority flood written cell by cell, on random, terraced, and near-level grids, a height that isn't a number, and a lake too wide for the band: the same levels, receivers, and areas to the bit. Erosion's own loops smooth and cut to the same bits as the plain ones too, the edge aside, which keeps its heights rather than adding them a Laplacian of 0 and so would keep a -0 the plain loop turns to 0; the land never holds a -0.

`accumulate` without rain sums whole numbers, exact in any order, walking the order upstream first. With rain, each cell sums its donors highest level first, ties highest index first, so the rounding doesn't depend on the order the routing lists cells in. `accumulateArea({ drainage, rain })` does the same into a new array, without routing again.

## Erosion

Braun and Willett's implicit stream-power solver with m 0.5 and n 1, as the spec says. Each iteration smooths hillslopes first, a share of the four-neighbour Laplacian, then routes drainage, accumulates area, and updates every cell downstream first, h = (h + dt U + F h_r) / (1 + F) with F = dt K sqrt(area) / distance. Area and distance are both counted in cells, so stream power's steady state is the same land at any cell size, since m / n = 0.5 balances the square root of an area against a length; a test checks the steady state cell by cell, each cell U d / (K sqrt(area)) above its receiver. Diffusion doesn't scale that way: it's a share of the Laplacian per cell, so on cells twice as wide the same share smooths four times as much per world unit, and the coarse pass takes a quarter of it.

Diffusion goes first so each iteration ends on stream power. Smoothing a channel's banks into it after the update leaves pits along the channel, and after the last iteration nothing drains them. Over 90 maps, five environments by six seeds at radius 800, 1000, and 1200, diffusion last at 0.08 and 0.04 leaves water standing in 2% or more of the grid on 44 maps; diffusion first at 0.05 and 0.025, on 19.

Diffusion is 0.05 at ruggedness 0 and 0.025 at 1, so rugged ranges keep sharper slopes. At 0.024 and 0.004, with receivers in the flood's order, rugged flanks show the grid as 45-degree striping and blocks; with steepest descent and this diffusion the gullies follow the fall line, though on a flank facing close to a grid axis, and on the gentle ground at a range's foot, they still run along it. The surface erosion starts from is 0.05 of the uplift, so ranges start as ridges, plus 0.02 of 120-unit noise, and the outlets hold 0.

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

`RELIEF`, the world units elevation 1 stands, is 100, down from the field model's 150. At 150 the eroded ranges, steeper than the field model's, put grade 1 or more on a fifth of Mixed, and since cliffs stand wherever rough country reaches grade 1, the bake drew whole 16-unit roughness cells of cliff, blocks across the ranges. At 100, over five environments by two seeds at radius 1000, cliffs covered 0% to 3.6% of the disc by environment on that lattice, against 0.2% to 5.3% on the field model, and ground graded 1 or more covers 0.5% to 12%, against 0.3% to 6.9%. `RELIEF` lives in `Land.ts` now, since the metro's flattening measures grades with it, and `Terrain.ts` re-exports it.

`Terrain` samples the grid with `GridSampler.bicubic`, Catmull-Rom through the cell centres, smooth in value and slope, so the bake's hill shading has no facets and slope is the exact gradient. A dry map's terraces go on that value (Terraces, below). Range country adds fine relief for the picture: 60-unit, 3-octave noise times 0.006 of the bicubic mask, with its gradient. Plain noise, not ridged, so the land has no crease; the slope test allows none.

## Terraces

Below an aridity of 0.4, full at 0.1, elevation is pulled toward 7 benches a unit, each flat for 55% of its height and rising over the next 37%, by 0.8 at full dryness. Mesas in the ranges come out as blocky as the benches below them, which reads as the spec's mesas and escarpments.

`Terrain` terraces what it samples, not the grid: `terraceHeight` of the bicubic value, its gradient scaled by `terraceSlope`, the terrace's derivative, by the chain rule. Terraced cell by cell, a grid's risers fall between cells, and the bicubic draws a riser crossing a slope as a row of steps along the cells, barcodes on every flank. Terraced as it's sampled, a riser follows the land's contours. The grid, and so its drainage, is the same at any aridity, as a test checks.

The pull is the same everywhere past the blend radius and never all the way, so terracing is monotone: a higher point stays higher, and the land drains the same way terraced or not. The prototype pulled less in range country, which reorders heights wherever the mask changes across a slope; its own drainage then crossed High Desert's plains in long straight diagonals. The pull does fade out over the blend ring, by the same ease as the metro's other fields, so the metro is flat ground rather than a bench; there two points' heights can swap as the pull changes between them, in the picture only, since drainage is the grid's.

Cliffs on a dry map are mostly risers, steeper than the slope they cross and narrower: a cliff band's median width across the slope is 5 units in the High Desert and 6 in the Badlands, against 11 on a map that isn't terraced, and under 2% of cliff ground lies in bands narrower than 2 units, which roads checked every half unit don't slip through. On the field model's rough-country lattice, High Desert's cliffs covered 2.6% to 2.8% of the disc on seeds 7 and 3, and Badlands' 3.4% to 3.6%; cliffs now stand on the land grid's averaged grade instead, a band along the steepest escarpments rather than each riser (water-and-biomes.md).

## The metro

The spec has the lift fade to nothing round the metro. Built that way, it came out two ways wrong. Ground with no lift erodes dead flat, and drainage crosses a dead flat in ruler-straight lines: the flood fills it cell by cell, and the rivers through High Desert's metro ran straight diagonals for hundreds of units. And the metro isn't flat anyway, because erosion is nonlocal: rivers from the ranges still cross it and cut valleys, and with ranges all round it (coverage 1, radius 1600) the metro sat in an intermontane basin with a valley cut 21 units deep through it and grades of 2.

So the ranges fade to nothing round the metro and the hills to half, and after erosion the land is routed once more and flattened:

- `flattenMetro` only ever lowers land. It lowers toward the metro's exit level, the lowest water level in it, where its water leaves, rather than its lowest cell, which would sink the metro into a basin. Inside the metro each cell keeps 15% of its height above that level, or less where 15% would leave a grade over 0.1, the same share for every cell, so heights keep their order and water runs across the metro as it did, only shallower. The share eases back to the land's own height at the blend radius.
- The ring keeps less of its inner edge than its outer, which dams the ways water left the metro: a pond backs up behind the dam and spills to the lowest way out, taking the others' water with it. So after lowering, `flattenMetro` walks the routing from before it upstream first, and where a cell's old receiver was below it, lowers the receiver to the cell's new height at most. Every way out stays open and nothing is raised. On Floodlands seed 1 at radius 1200, 778 of the metro's cells leave the ring at 113 degrees and 356 at -150, as before flattening; dammed, all 1160 leave at -150. A test holds a Rust Belt metro to its two ways out.
- After the final routing, `fillMetroWater` raises standing water inside the blend radius, and all the water it connects to, to its level: pits below the exit level, and the ones the blend ring makes by lowering its inner edge more than its outer, become flat ground at the level they'd fill to. Each level is above its receiver's, so the routing stands as it was, and the levels equal the land there.

Measured by sampling the terrain on polar grids of the metro, its steepest grade is 0.022 on the five environments' defaults and 0.039 over 48 maps at the corners of the tuning ranges, rivers 0 and 6 among them, with no standing water in the metro or the blend ring. The cap is 0.1 cell to cell, and the test's bar on the grid is 0.15, room for the bicubic's overshoot. The ring keeps the land's own steepness where ranges come close, terraced on a dry map, up to grade 5 at those corners.

## What the water stage gets

`terrain.surface` is a frozen `LandSurface`: the grid, the finished elevation and the range mask per cell, `closedBasin`, and `drainage`, the finished land's drainage as plain typed arrays: `receivers` (-1 at an outlet), `levels`, `area` (one unit of rain a cell), `order` (downstream first), and `outlets`. The arrays are read-only by contract, since typed arrays can't be frozen. `terrainFromSurface({ params, rng, surface })` builds the rest of the terrain over a surface grown elsewhere, refusing one whose grid isn't `landGridFor(params.radius)` or whose arrays don't fit it.

Water stands where a level is above the land. Over 90 maps, five environments by six seeds at radius 800, 1000, and 1200, that's a median 0.57% of the grid and at most 8.5%, 2% or more on 19 maps; inside the disc the median is 0.03% and the most 5.6%, since most of it lies in the grid's margin past the rim. The tests hold it under 10% on every map and 2% at the median over the five environments. They're the coarse pass's last pits, which more coarse iterations drain, but 40 and 10 already take the land to 350 ms at radius 1200, so they stay, for the water stage as lake sites.

The water stage ([water-and-biomes.md](./water-and-biomes.md)) routes the finished land again with noise of under a hundredth of grade added, which breaks up the metro's filled flats and the eight-direction runs on gentle slopes that the land's own drainage crosses in ruler-straight lines; weights the rain by moisture and the ranges; takes the pits as natural lake sites where the country is wet; and sends its own arrays across the worker boundary beside the land's.

## Crossing the worker boundary

The generation worker ([map-pipeline-worker.md](./map-pipeline-worker.md)) used to send no terrain, the client running the terrain stage again on the winning stream, which cost 2 ms for the analytic fields and would cost the whole erosion now. Instead `encodeAreaMap` puts `terrain.surface` in the transfer, its seven typed arrays in the transfer list beside the road network's two, and `decodeAreaMap` rebuilds the terrain with `terrainFromSurface` on the winning terrain stream, refreezing the surface. Transferring detaches the arrays from the worker's terrain, so the worker encodes after its last stage, and is terminated once it has replied.

Over five environments by three seeds, a decode takes 11 ms median at radius 1000 and 28 ms at 1600 in Node 24, and about 20 ms and 60 to 130 ms on Chromium's main thread, sending 2.6 MB and 6.6 MB, against 236 and 670 ms in Node to grow the land again.

## What the field model lost

The plains, ranges, ridges, canyons, badlands, and gully layers are gone, with the derivative bookkeeping that carried their gradients and the canyon wall profile. Canyons, badlands, low ground, moisture, rough country, and cliffs now come from the water and the eroded slope ([water-and-biomes.md](./water-and-biomes.md)), which replaced the stand-ins this stage kept them working with.

## Determinism

The land is built from adds, multiplies, divides, compares, square roots, and floors, which ECMAScript gives exactly, and from noise and draws that are too. ESLint holds generation to that: under `src/renderer/game/map/`, tests aside, it rejects `Math.sin`, `cos`, `tan` and their inverses, `exp` and `log` in all their forms, `pow`, `hypot`, `cbrt`, the hyperbolics, and `**`. The road tests' fixtures, which place a test's own departures and measure what growth made, disable it line by line with their reasons. The tests pin a hash of the eroded grid and its receivers for two maps, a Mixed map at radius 800 and a High Desert closed basin, computed in a separate Node process from the Jest run that checks them, and a fresh copy of the module erodes the same bits.

The terrain stream forks by feature: `hills`, `ranges`, `rangeWarp`, `rangeBreaks`, `grain`, `outlets`, and `initial` for the land, and `detail`, `roughness`, `contamination`, `hotspots`, and `towns` for the rest; moisture's noise moved to the water stream. So towns, hotspots, contamination, and anything past the terrain stage never move the land; a test changes six such parameters and gets the same grid.

## Performance

`node scripts/terrain-bench.mjs --radii 800,1000,1200,1600`, Node 24 (V8 13.6), the same shared desktop, the median of three seeds per radius and environment. Other work on the desktop slows every column alike, by half again in a busy spell, the uplift's included, so these are from a quiet one:

| Radius | Grid | Mixed | High Desert | Rust Belt | Floodlands | Badlands | Uplift | Erosion | Drainage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 800 | 204 x 204 | 78 ms | 76 | 74 | 77 | 77 | 16 | 59 | 2.1 |
| 1000 | 256 x 256 | 126 | 131 | 156 | 133 | 127 | 27 | 98 | 3.4 |
| 1200 | 308 x 308 | 188 | 193 | 188 | 187 | 192 | 38 | 145 | 4.8 |
| 1600 | 410 x 410 | 347 | 346 | 348 | 352 | 355 | 69 | 271 | 8.8 |

Erosion is the land's time less the uplift's and the final drainage's; it includes elevation and the metro's routing and flattening, a few milliseconds. The whole terrain build, the land and the terrain's fields over it, is 89 ms at radius 800, 150 at 1000, 212 at 1200, and 400 at 1600, and the water stage adds 18 to 66. Sampling at radius 1000: a full sample 432 ns, elevation 142, slope 142, a 9-unit move's cost 648.

Routing is about three quarters of erosion's time: 52 routings a land, 40 at half size, 10 at full, and the final two, at under 60 ns a cell. The scan for local receivers takes about 30% of it, labelling basins and finding their passes and spills a third, the flood and its candidates a fifth, most of that the coarse pass's lakes, which hold 14% of its grid, and listing the order an eighth. The scan costs about 14 ns a cell even unrolled, most of it the branch on which neighbour falls furthest, which no ordering of the work makes predictable. The rest of erosion is diffusion, the area, and the implicit solve's square root and divide per cell.

The spec gives the grid stages a second on a mid-range laptop. At radius 1200 the land takes 190 ms here and the water about 30; with roads (Maps 7 and 8) estimated at 140 to 210 ms, the grid stages come to 0.36 to 0.43 s on this desktop, or 0.6 to 0.95 s on a mid-range laptop taking 1.6 to 2.2 times as long. At radius 1600 the land alone takes 350 ms. Whenever the pipeline goes back to the terrain stage, a map restart or a retry escalated up to it, the land grows again, erosion and all; retries of the stages after it reuse it.

Under Jest a terrain at radius 1000 takes about 0.3 s to build, and 0.8 s with coverage on, which CI runs. So the terrain tests build each parameter set once a file, and the sweeps stay at 15 sets.

## Consequences

- The area map gallery scene's land and roads move, and its goldens re-baseline with this change.
- Every generated map moves. Nothing saved holds the land (it regenerates on load), but saves made before this load onto a different picture under the same roads, and DDB-296's generator version should count this change.
- The field model's records stay in terrain-fields.md where they still hold: the noise, contamination, the start's blends, and sites. Rough country, cliffs, cost, and the water are water-and-biomes.md's.

## Provisional calls

Calls the spec and realistic-map.md left to the build, made the simplest way consistent with them, for Kevin to approve or adjust:

1. The grid: `2 * round(0.128 * radius)` cells a side, even, so cells stay about 9.4 units at any radius.
2. Hills lift 0.04 to 0.12 by ruggedness, which has no parameter of its own.
3. Ranges: belts of a 1500 by 520 unit layer, 3 octaves at gain 0.45, warped 160 units at 800, breaks added at a quarter weight from a 500-unit layer before the coverage quantile, a mask ramp of 0.26, and a lift of 0.7 to 1.8 by ruggedness.
4. Drainage by steepest descent on the water levels, a diagonal's drop counted at 1 / sqrt(2), ties to the lower index.
5. Erosion: dt 1.2, K 0.11, uplift rate 0.1; 40 iterations at half size, then 10 at full; diffusion 0.05 at ruggedness 0 to 0.025 at 1, a quarter of it on the coarse pass, before the routing in each iteration; the starting surface 0.05 of the uplift plus 0.02 of 120-unit noise.
6. Elevation h / sqrt(h^2 + 36) over the eroded height, with `RELIEF` 100.
7. Outlets spread evenly round the edge with half a spacing of jitter; a closed basin's sink 0.55 of the radius out.
8. Terraces below aridity 0.4, full at 0.1: 7 benches a unit, risers over 0.55 to 0.92 of each step, a pull of 0.8, the same in the ranges as out of them, applied as the terrain is sampled and faded out over the blend ring.
9. The metro: the hills lift at half round it rather than not at all; after erosion it's lowered toward its exit level, keeping 15% of its relief or less where a grade would pass 0.1, easing out to the blend radius, the ways water left it lowered through the ring with it, and standing water inside the blend radius is filled to its level.
10. Standing water left where the coarse pass leaves it, under 2% of the grid on most maps, rather than more iterations to drain it.
11. Fine relief in range country: 60-unit, 3-octave noise at 0.006 times the mask.
