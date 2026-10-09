# Terrain from uplift and erosion (DDB-441)

Date: 2026-10-09. Code: `src/renderer/game/map/` (`LandGrid.ts`, `Uplift.ts`, `Drainage.ts`, `Erosion.ts`, `Land.ts`, and `Terrain.ts` reading them), timed by `scripts/terrain-bench.mjs`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), Pipeline, 1. Terrain. Builds decision 1 of [realistic-map.md](./realistic-map.md), and replaces the relief half of [terrain-fields.md](./terrain-fields.md)'s field model: its plains, ranges, ridges, canyons, and badlands layers.

## Context

Realistic-map decision 1 picked the method: an uplift field cut down by stream-power erosion, so ranges, valleys, and a drainage network that runs downhill everywhere come out of one process. Its offline prototype showed the look and gave the numbers. This stage builds it in the game: the land on a grid a fifth wider than the disc, outlets on the grid's edge, dry terraces, elevation sampled bicubic, and the drainage kept as plain data for the water stage (Map 5, DDB-289).

The constraints were the spec's. The land is regenerated on load rather than saved, so it has to come out to the same bits in every engine, which rules out `Math.sin`, `exp`, `pow`, `hypot`, and `**` anywhere a value branches or feeds the grid. The `Terrain` interface (`sample`, `elevation`, `slope`, `obstacle`, `travelCost`) keeps its shape, since road growth, its checks, and the area map's bake all read it. And the grid stages share a budget of 1 second on a mid-range laptop, against the prototype's 460 to 550 ms for erosion alone.

## The grid

`landGridFor(radius)` gives `2 * round(0.128 * radius)` cells a side over a square reaching 1.2 times the radius each way: 256 at radius 1000, 204 at 800, 308 at 1200, cells 9.3 to 9.45 units across at any radius. The size is always even, so the coarse pass's grid covers it two cells to one. Cells run row by row from the south-west corner; `cellCentre`, `cellAt`, and `GridSampler` (bicubic with its exact gradient, and bilinear) are the grid's whole vocabulary.

## Uplift

`buildUplift` lifts every cell by a hill term and a range term, both from `Noise.ts`'s simplex, whose sampling is plain arithmetic:

- Hills: a 450-unit, 3-octave layer, 0.04 to 0.12 of lift by ruggedness, varying 80% either way. The prototype set this per environment; there's no parameter for it, so ruggedness carries it.
- Ranges: a 3-octave layer, gain 0.45, with 1500-unit wavelength along the map's grain and 520 across it, sampled at points bent by a 160-unit warp. A 500-unit, 2-octave breaks layer is added at a quarter weight. Range country is where the sum passes the quantile of itself over the cells inside the disc past the relief radius that `mountainCoverage` asks for, ramping over 0.26 of it, so the mask is half at the threshold and exactly `mountainCoverage` of that land is range country on every map, gaps included. Ranges lift 0.7 to 1.8 by ruggedness.
- The grain is `unitVector(180 * draw)`, Geometry.ts's polynomial sine and cosine, not `Math.cos` and `Math.sin` as the prototype had it.

The prototype multiplied each range's lift by its breaks layer instead (down to 0.45 in a gap) and calibrated coverage on the belt layer alone, so its gaps sat inside "range country" and its mask's share drifted from the parameter. Adding the breaks before the quantile keeps the share exact: the test holds it to within one cell's share over six seeds and four coverages. The cost is gaps that cut a belt rather than notch it, which a quarter weight keeps rare.

Ranges run with the grain loosely rather than ruler-straight. Measured as how much the mask changes 150 units along the grain against across it, over seeds 11 to 24 at radius 600, the ratio ran 0.50 to 0.96, a mean of 0.76; the warp and the breaks, which are the same every way, are what loosen it.

## Erosion

Braun and Willett's implicit stream-power solver with m 0.5 and n 1, as the spec says. Each iteration routes drainage by priority flood from the outlets (`DrainageRouter`), accumulates area, and updates every cell downstream first, h = (h + dt U + F h_r) / (1 + F) with F = dt K sqrt(area) / distance, then adds hillslope diffusion, a share of the four-neighbour Laplacian. Area and distance are both counted in cells, which makes the steady state the same land at any cell size, since m / n = 0.5 balances the square root of an area against a length; a test checks the steady state cell by cell, each cell U d / (K sqrt(area)) above its receiver.

The priority flood breaks ties by cell index, so its order never depends on how the heap was built or the order outlets are listed. A cell enters the queue at its own height, or 1e-7 above the cell that reached it where that's higher, so pits and flats fill as they're reached and drain outward from their spill. That entry is the cell's water level, and the router keeps it: water runs downhill everywhere on the levels, and where a level stands above the land, water stands in a pit.

Run coarse first, as the spec planned. Measured on Mixed, High Desert, Rust Belt, Floodlands, and Badlands at radius 1000, seed 7, on a desktop Ryzen 9 5950X shared with other work:

| Schedule | Land, ms | Mean change from a full-size run |
| --- | --- | --- |
| 50 iterations at full size | 451 to 485 | |
| 30 at half size, 20 at full | 254 to 303 | 0.007 to 0.025 |
| 40 at half, 10 at full (chosen) | 192 to 212 | 0.008 to 0.026 |
| 45 at half, 5 at full | 162 to 180 | 0.009 to 0.028 |

The change is in elevation, which runs 0 to about 0.7 on these maps. The coarse runs put their rivers in different cells from the full-size run's (only 12% to 17% of cells with more than 200 cells of drainage are shared), but the ranges and the character of the drainage are the same, and a coarse run's land is as valid an eroded landscape as a full one's. 40 and 10 keeps most of the full size's fine valleys for about 40% of its time; 45 and 5 leaves the coarse pass's two-cell valleys showing.

Diffusion is 0.024 at ruggedness 0 and 0.004 at 1, so rugged ranges keep sharper slopes. The surface erosion starts from is 0.05 of the uplift, so ranges start as ridges, plus 0.02 of 120-unit noise, and the outlets hold 0.

## Outlets

`rivers` cells on the grid's edge, spread round its perimeter from a drawn start, each jittered within half its share, so no two come within half an even spacing. They're the only cells with no receiver, so the region's drainage leaves by exactly that many main rivers. With `rivers` 0 there's one sink, 0.55 of the radius out in a drawn direction, and everything drains to it: a closed basin, its floor at 0, for the water stage to make a dry lake of.

## Elevation

The prototype normalised each map's eroded height to its own 0.2% and 99.5% quantiles, which cancels most of what ruggedness and coverage do to how tall the land stands: a map with no ranges stretched its hills to the same peaks as the most rugged. Here eroded height h becomes elevation h / sqrt(h^2 + 36), close to h / 6 below about 3 and easing toward 1 above, so a gentle map stays low, a rugged one stands tall, and nothing flattens at a clamp. On the environments' defaults the plains run about 0.03 to 0.1 and the peaks 0.55 to 0.8; the steepest corner of the tuning ranges reaches 0.86. `RELIEF` stays 150, so on Mixed a fifth of the disc is graded 1 or steeper, almost all of it in the ranges, against about 2% on the field model.

`Terrain` samples the grid with `GridSampler.bicubic`, Catmull-Rom through the cell centres, smooth in value and slope, so the bake's hill shading has no facets and slope is the exact gradient. Range country adds fine relief for the picture: 60-unit, 3-octave noise times 0.006 of the bicubic mask, with its gradient. Plain noise, not ridged, so the land has no crease; the slope test allows none.

## Terraces

Below an aridity of 0.4, full at 0.1, elevation is pulled toward 7 benches a unit, each flat for 55% of its height and rising over the next 37%, by 0.8 at full dryness. The prototype pulled less in range country, which reorders heights wherever the mask changes across a slope; its own drainage then crossed High Desert's plains in long straight diagonals, the flood draining filled flats outward cell by cell. The pull is the same everywhere here, so terracing never reorders heights and the land drains as it did before (four cells in 24,000 change receiver on a test map, where a bench squeezes two heights within the flood's 1e-7). Mesas in the ranges come out as blocky as the benches below them, which reads as the spec's mesas and escarpments.

## The metro

The spec has the lift fade to nothing round the metro. Built that way, it came out two ways wrong. Ground with no lift erodes dead flat, and drainage crosses a dead flat in ruler-straight lines: the flood fills it cell by cell, and the rivers through High Desert's metro ran straight diagonals for hundreds of units. And the metro isn't flat anyway, because erosion is nonlocal: rivers from the ranges still cross it and cut valleys, and with ranges all round it (coverage 1, radius 1600) the metro sat in an intermontane basin with a valley cut 21 units deep through it and grades of 2.

So the ranges fade to nothing round the metro, the hills fade to half, and after erosion and terraces `flattenMetro` keeps 15% of the metro's relief about its mean, easing back to the land's own at the blend radius. Inside the metro the flattening is the same for every cell, so a river crossing it still runs the way it did, only shallower. Measured over polar grids of the metro, the steepest grade in it is 0.02 or less on the five environments' defaults and 0.32 at the worst corner of the tuning ranges, where it meets the blend ring.

## What the water stage gets

`terrain.surface` is a `LandSurface`: the grid, the finished elevation and the range mask per cell, `closedBasin`, and `drainage`, the finished land's drainage as plain typed arrays: `receivers` (-1 at an outlet), `levels`, `area` (one unit of rain a cell), `order` (downstream first), and `outlets`. Water stands in under 2% of cells, the last of the coarse pass's pits and the flattened metro's edge; elsewhere every cell is above the cell it drains to.

For Map 5, the water stage:

- Can re-accumulate area with rain over the same receivers and order (`DrainageRouter.accumulate(rain)`), or reroute over the finished elevation with `routeDrainage`, which gives the same receivers.
- Will find straight D8 runs where drainage crosses gentle, even slopes. It's the eight-direction routing, not the land, and the spec's river smoothing and `riverMeander` are the place to break them up.
- Gets natural lake sites for free: a cell whose level stands above its elevation holds water until it spills.

## What the field model lost, and what Map 5 still owns

The plains, ranges, ridges, canyons, badlands, and gully layers are gone, with the derivative bookkeeping that carried their gradients and the canyon wall profile. What the field model also did, and Map 5 (DDB-289) reworks, is kept and adapted only as far as keeping the stages after it working:

- Canyons and badlands are biome categories still, but read off the eroded land rather than drawn. Canyons are the valleys cut deepest below the lower of the cells three either side, across whichever of four directions cuts deepest, 10% of the land outside the ranges on maps of aridity 0.45 and under, none above 0.55. Badlands are the most broken ground, the land's curvature blurred over three cells, their share the field model's (0.7 x ruggedness x (0.3 + 0.7 x contamination)) of the land outside the ranges. Both keep three cells off any range lift, since a range's foot bends the land as hard as any gully, and out of the metro. They're stand-ins: the water stage should read canyons off its rivers.
- Biome thresholds are the field model's but for mire's elevation, which reads the new scale: under 0.05, where it was under 0.42. Moisture's lowland term measures from 0.06, the plains on most maps, where it measured from the field model's plains at 0.42.
- Rough country is still the 16-unit roughness lattice, and cliffs still stand only there, wherever the eroded slope reaches grade 1. Realistic-map.md has rough country and cliffs coming from eroded slope; that's Map 5's.
- Moisture, contamination, hotspots, towns, cost, and the `WaterLayer` seam are unchanged.

On seed 7's five environments the biome shares come out near the field model's: Mixed 24% mountains, 47% scrub, 12% desert, 8% mire, 7% badlands, 3% canyons (field model 24, 37, 15, 13, 8, 4); High Desert 34% mountains, 35% desert, 17% scrub, 8% badlands, 6% canyons (33, 36, 15, 11, 5); Badlands 34% mountains, 22% scrub, 21% desert, 16% badlands, 6% canyons, 2% mire (33, 16, 20, 21, 6, 5). Floodlands carries more mire, 51% against 44%. Cliffs cover 0.5% to 8% of the disc by environment, against 0.2% to 5%, since eroded ranges are steeper than the field model's.

How much of the edge the start reaches, by a 4-unit flood fill over `impassable` from the metro, as the share of the outer band's passable ground, over the first 20 seeds of the sequence terrain-fields.md samples:

| Parameters | Least | 5th percentile | Median | Towns cut off |
| --- | --- | --- | --- | --- |
| steepest corner, radius 600 | 95.2% | 96.2% | 98.8% | 0 of 100 |
| Badlands, radius 600 | 98.5% | 99.1% | 99.8% | 0 of 60 |
| High Desert defaults | 98.5% | 98.5% | 99.1% | 0 of 60 |
| Mixed defaults | 99.8% | 99.8% | 99.9% | 0 of 100 |

The outward road growth that Map 7 replaces copes with the new land unchanged: its unit and property tests pass, and `scripts/road-growth.mjs check` passes on 50 maps sampled across the tuning ranges.

## Determinism

The land is built from adds, multiplies, divides, compares, square roots, and floors, which ECMAScript gives exactly, and from noise and draws that are too. The tests pin a hash of the eroded grid and its receivers for two maps, a Mixed map at radius 800 and a terraced closed basin, computed in a separate Node process from the Jest run that checks them, and a fresh copy of the module erodes the same bits.

The terrain stream forks by feature: `hills`, `ranges`, `rangeWarp`, `rangeBreaks`, `grain`, `outlets`, and `initial` for the land, and `detail`, `moisture`, `roughness`, `contamination`, `hotspots`, and `towns` for the rest. So towns, hotspots, contamination, and anything past the terrain stage never move the land; a test changes six such parameters and gets the same grid.

## Performance

`node scripts/terrain-bench.mjs`, Node 24 (V8 13.6), the same shared desktop, the median of three seeds per radius and environment:

| Radius | Grid | Mixed | High Desert | Rust Belt | Floodlands | Badlands | Uplift | Erosion | Drainage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 800 | 204 x 204 | 118 ms | 115 | 116 | 115 | 116 | 15 | 95 | 4.9 |
| 1000 | 256 x 256 | 193 | 192 | 194 | 192 | 190 | 25 | 159 | 8.0 |
| 1200 | 308 x 308 | 289 | 297 | 301 | 300 | 287 | 37 | 241 | 12.4 |

Erosion is the land's time less the uplift's and the final drainage's; it includes elevation, terraces, and the metro, a few milliseconds. The whole terrain build at radius 1000 is 205 ms, about a fifth of the grid stages' budget on this machine, so perhaps a third on a mid-range laptop, against the prototype's 550 ms for erosion alone. Sampling got cheaper with it: a full sample 416 ns (626 on the field model), elevation 176 ns (396), slope 171 ns (397), travel cost 345 ns (583).

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
4. Erosion: dt 1.2, K 0.11, uplift rate 0.1; 40 iterations at half size, then 10 at full; diffusion 0.024 at ruggedness 0 to 0.004 at 1; the starting surface 0.05 of the uplift plus 0.02 of 120-unit noise.
5. Elevation h / sqrt(h^2 + 36) over the eroded height, with `RELIEF` left at 150.
6. Outlets spread evenly round the edge with half a spacing of jitter; a closed basin's sink 0.55 of the radius out.
7. Terraces below aridity 0.4, full at 0.1: 7 benches a unit, risers over 0.55 to 0.92 of each step, a pull of 0.8, the same in the ranges as out of them.
8. The metro: the hills lift at half round it rather than not at all, and after erosion the metro keeps 15% of its relief.
9. Fine relief in range country: 60-unit, 3-octave noise at 0.006 times the mask.
10. Until Map 5: canyons and badlands as above, mire under elevation 0.05, and moisture's lowland level at 0.06.
