# Area Map Generation

Status: design. Gameplay it serves: [Compound and Supply Runs](./Compound%20and%20Supply%20Runs.md). Decision records: [compound-and-area-map.md](../AI_TECHNICAL_DECISIONS/compound-and-area-map.md), and for the geography, the road network, and the route tree, [realistic-map.md](../AI_TECHNICAL_DECISIONS/realistic-map.md).

The area map is generated once, when a campaign founds its compound, from a seed and a set of map parameters. Everything after that (fog lifting, roads charted, stops cleared and coming back) is state layered over the generated map, never a regeneration.

The shape to aim for is a page of a printed state road atlas. The compound sits in the ruins of a metro at the centre of a region that looks like real country: mountain ranges, rivers in the valleys they carved, lakes, towns where the land puts them, and a road network joining them that follows the terrain and closes into loops the way real roads do. Over that network sits the game's own layer, the route tree: from every place on the roads there's one way home, so the routes a run can take branch outward from the compound like a tree, and two or three of those branches end at each point of interest. The tree is chosen over the roads; it isn't their shape.

![Mixed, seed 7: the atlas look, with one POI's two routes](../design/realistic-map/mixed-seed-7.png)

## Three layers: the land and its roads, the route tree, and the dressing

- The land and its roads: terrain, water, settlements, and every road on the map, highways, back roads, and trails alike. It's a real network, with loops, generated from the land. By itself it carries no gameplay.
- The route tree: for every place on the road network, its way home. Routes to POIs are made of ways home, stops sit on the roads routes use, and knowledge and tiers are kept for them. Roads no route uses are still roads on the map, drawn like any other, but nothing happens on them.
- Dressing: street grids, rail lines, place and feature labels, contamination hatching. It makes the page read as an atlas and carries no gameplay at all. It's generated last, from its own stream, and writes nothing back.

![The route tree over the same map: every route to every POI, coloured by the road it leaves the city on](../design/realistic-map/route-tree-mixed-seed-7.png)

## Guarantees

Hard guarantees hold for every map the generator returns, for any parameters inside their tuning ranges. The validator checks each one, and a map that fails is regenerated (see Validation and retries).

1. Deterministic: the same seed, parameters, and generator version produce the same map.
2. Tree-shaped routes: every place on the road network has exactly one way home except a POI, which is where two or three ways home end. So routes never cross or rejoin anywhere but at their POI, and every road a route uses is driven in one direction only, outward.
3. Real roads: roads meet only at junctions, cross water only at bridges, never cross impassable ground, and every place on the network is reachable from the compound.
4. Destinations, not waypoints: no route passes through a POI, and every road into a POI is one of its routes.
5. Real choices: every POI has two or three routes, and any two of them share nothing past `routeSplit` of the shorter one's hours (provisionally a half: they split before halfway). A run's choice always covers at least the far half of the drive.
6. Strongholds all around: one per sector, sectors evenly spaced around the compound, each stronghold in the outer band and outside the starting reveal by at least one tier.
7. A survivable start: inside the starting reveal there's at least one POI yielding each of food, water, and fuel, and at least one Find: driver stop within tiers 1 and 2.
8. Readable: labels have room, POIs keep their spacing, and no POI sits on a junction.
9. Dressing is inert: removing all dressing changes no gameplay data, and roads no route uses carry no stops and no knowledge.
10. Home by dark early on: every POI in tiers 1 to 3 has at least one route whose estimated run (drive out, stops, objective, drive home) fits in `daylightHours`. Tiers 4 and 5 may not; runs into the night are a late-game mechanic.

Soft goals are scored, not required: a third route where a site offers one, routes to a POI that differ in road class and length, biome variety, and faction territories of similar size. Three routes are the exception on a real road network, not the rule (the decision record has the measurements).

## Map parameters

All generation reads one `MapParams` object: the seed plus a set of tunable characteristics. During the prototype every parameter is a control in the Map Lab (below). In the finished game the parameters are rolled from the seed along with everything else.

Each parameter has a tuning range (what the Map Lab allows, and what the guarantees must survive), a default, and a campaign range (what the finished game rolls from, usually narrower; balance knobs like `routesTarget` and `driverFinds` hold one value). Values below are starting points for the Map Lab to settle; the ones the realistic map added or changed are provisional calls listed in [realistic-map.md](../AI_TECHNICAL_DECISIONS/realistic-map.md).

### World

| Parameter | Tuning range | Default | Campaign | What it does |
| --- | --- | --- | --- | --- |
| `seed` | any uint32 | random | the campaign's | every random stream |
| `environment` | High Desert, Rust Belt, Floodlands, Badlands, Mixed | Mixed | any | a preset that sets world, road network, and dressing defaults, never gameplay ones; any can still be overridden (see Environments) |
| `radius` | 600 to 1600 | 1000 | 800 to 1200 | world units; map size, and with it campaign length |
| `aridity` | 0 to 1 | 0.5 | 0.1 to 0.9 | dry desert to wet ground and mire |
| `mountainCoverage` | 0 to 1 | 0.25 | 0.05 to 0.45 | share of the land in mountain ranges |
| `ruggedness` | 0 to 1 | 0.5 | 0.15 to 0.85 | how high and sharp ranges stand: rolling hills to steep ridges and narrow passes |
| `rivers` | 0 to 6 | 2 | 0 to 5 | main rivers: the outlets where the region's drainage leaves it; 0 is a closed basin |
| `riverDensity` | 0 to 1 | 0.5 | 0.3 to 0.7 | how much of the drainage shows as streams and tributaries |
| `riverMeander` | 0 to 1 | 0.5 | 0.2 to 0.8 | how much rivers wander on flat ground |
| `lakes` | 0 to 8 | 2 | 0 to 6 | lakes and reservoirs held in valleys, impassable |
| `contamination` | 0 to 1 | 0.3 | 0.1 to 0.7 | how much of the map is toxic; feeds mire and hazards |
| `hotspots` | 0 to 6 | 3 | 1 to 5 | blast sites and spills: craters and strong contamination |
| `metroSize` | 0.08 to 0.25 | 0.15 | 0.12 to 0.2 | metro ruins radius as a share of `radius` |
| `towns` | 0 to 12 | 5 | 2 to 9 | ruined towns outside the metro, drawn as street grids |
| `villages` | 0 to 40 | 20 | 12 to 28 | smaller named places the roads join |

### Road network

| Parameter | Tuning range | Default | Campaign | What it does |
| --- | --- | --- | --- | --- |
| `highways` | 3 to 9 | 6 | 5 to 7 | highways leaving the metro for the rim, toward cities beyond the area |
| `highwaySeparation` | 20 to 60 degrees | 35 | 25 to 45 | minimum angle between where highways leave the area |
| `roadDensity` | 0 to 1 | 0.5 | 0.35 to 0.65 | how close the crossroads sit that county roads join: 140 units apart at 0, 70 at 1 |
| `loops` | 0 to 1 | 0.5 | 0.3 to 0.7 | how readily a new road joins two places the roads already connect: only past a detour of 1.9 times at 0, past 1.1 times at 1 |
| `curviness` | 0 to 1 | 0.5 | 0.25 to 0.75 | how far roads wind to keep their grades gentle: ruler-straight to switchbacks |
| `trailShare` | 0 to 1 | 0.5 | 0.25 to 0.75 | how readily roads through rough country are trails |
| `brokenHighways` | 0 to 4 | 2 | 1 to 4 | highway spans that collapsed; they're drawn with their gap and no route crosses them |

### Gameplay

| Parameter | Tuning range | Default | Campaign | What it does |
| --- | --- | --- | --- | --- |
| `strongholds` | 2 to 8 | 4 | 3 to 5 | strongholds, one per sector |
| `poiDensity` | 0.5 to 2 | 1 | 0.8 to 1.2 | multiplies the POI target per ring (5, 7, 9, 9 at 1) |
| `routesTarget` | 2 or 3 | 3 | 3 | routes to aim for per POI (2 is always required) |
| `routeSplit` | 0.3 to 0.7 | 0.5 | 0.5 | how far along the shorter of two routes to a POI they may still share road |
| `startingReveal` | 1 to 2 tiers | 1 | 1 | how much starts charted |
| `stopDensity` | 0.5 to 2 | 1 | 0.8 to 1.2 | multiplies stop counts per leg |
| `dangerCurve` | 0.5 to 2 | 1 | 0.9 to 1.1 | how fast encounters scale with tier |
| `driverFinds` | 1 to 4 | 2 | 2 | Find: driver floor within tiers 1 and 2 |
| `daylightHours` | 10 to 16 | 14 | 13 to 15 | dawn to dark; how long a run has before night |
| `travelPace` | 0.5 to 2 | 1 | 0.9 to 1.1 | multiplies hours per unit of road for every class |
| `stopTables` | JSON | shipped tables | shipped tables | stop type weights per class, biome, tier, and territory |

### Dressing

| Parameter | Tuning range | Default | Campaign | What it does |
| --- | --- | --- | --- | --- |
| `dressing` | 0 to 1 | 0.6 | 0.4 to 0.8 | master scale for everything below |
| `streetGrids` | 0 to 1 | 0.7 | 0.5 to 0.9 | how built-up the metro and towns look, and how much of each grid survives |
| `railLines` | 0 to 4 | 1 | 0 to 3 | rail lines crossing the region |

### Environments

`environment` sets the defaults of world, road network, and dressing parameters, never gameplay ones, so it changes the land and not the rules. A parameter it leaves alone keeps the default above, and Mixed leaves all of them alone: the defaults above are Mixed's. A value set explicitly, in the Map Lab or a preset, wins over the environment's, and the Map Lab shows which values are the environment's, which are overridden, and which the parameter validator changed.

High Desert is dry tableland of benches and escarpments, cut by a few deep valleys, with long straight roads and few towns. Rust Belt is old industry in rolling river country, dense with towns, spills, rail, and paved roads. The Floodlands are low, wet, and flat, with looping rivers, reservoirs, and mire. The Badlands are broken, toxic ground where roads give out to trails. Starting values for the Map Lab to tune, blank where the environment keeps the default:

| Parameter | High Desert | Rust Belt | Floodlands | Badlands |
| --- | --- | --- | --- | --- |
| `aridity` | 0.15 | 0.55 | 0.85 | 0.3 |
| `mountainCoverage` | 0.35 | 0.15 | 0.1 | 0.35 |
| `ruggedness` | 0.65 | 0.35 | 0.25 | 0.8 |
| `rivers` | 1 | 3 | 4 | 1 |
| `riverDensity` | 0.35 | | 0.65 | 0.4 |
| `riverMeander` | 0.3 | | 0.75 | |
| `lakes` | 0 | | 5 | 1 |
| `contamination` | 0.2 | 0.45 | 0.4 | 0.6 |
| `hotspots` | 2 | 4 | | 4 |
| `metroSize` | | 0.18 | | |
| `towns` | 3 | 8 | | 3 |
| `villages` | 14 | 26 | | 14 |
| `roadDensity` | 0.4 | 0.6 | | 0.4 |
| `loops` | 0.4 | 0.6 | | 0.4 |
| `curviness` | 0.4 | | 0.6 | 0.65 |
| `trailShare` | | 0.35 | | 0.7 |
| `brokenHighways` | | 3 | | |
| `streetGrids` | | 0.85 | | |
| `railLines` | | 2 | | |

Each value sits at least a step inside its campaign range. Half an environment's rolls land on each side of its value however little room that side has (see Randomising for the finished game), so a value on an end of the range would put half or more of them exactly on that end. High Desert's 0 lakes is the one value on an end, on purpose: about two High Desert maps in three have no lakes. `brokenHighways`' campaign range runs to 4 so that Rust Belt's 3 sits a step in, since a step down would be the default. The wider range tilts the four environments that keep the default of 2 toward 3, with 22% of their rolls on 3 against 12.5% on 1 and none on 4: the cost of keeping Rust Belt off the end.

### Randomising for the finished game

- `rollParams(seed)` draws every parameter from its campaign range on the `params` stream, environment first (an even pick) and the rest around that environment's defaults. Each parameter draws on its own fork of `params`, named by its key (`environment`, `radius`, and so on), so a parameter's draw depends only on the seed, its key, its own range and step, and the environment's value for it: adding, removing, reordering, or retuning a parameter, or an option pinning one, never moves another parameter's draw.
- What `rollParams` returns is coupled in three ways the draws aren't. The validator raises `highways` to fit `strongholds` in about one roll in five, so retuning `strongholds` moves `highways`. Every number centres on its environment's value, so retuning an environment's value, or a default it inherits, moves that parameter's rolls on that environment. And the environment is picked by its place in the list, so adding, removing, or reordering an environment changes which one a seed rolls, and with it every number.
- Each number reaches at most half its campaign range either side of the environment's value, never past the range, and is snapped to the parameter's step in the Map Lab. The draw splits at that value: half land below it and half above, however little room a side has, each half a triangle that's likeliest at the value and thins to nothing at its bound. So each campaign range holds every environment's value a step in from its ends (see Environments) and has each end within reach of one of them, and a range no environment moves sits evenly round its default. Generation then runs on the rolled parameters with the same seed.
- Rolled parameters go through the parameter validator like any others. Campaign ranges leave room for its rules (`highways` 5 to 7 covers `strongholds` 3 to 5 plus 2, and 7 highways fit 45 degrees apart), so a rolled value never leaves its campaign range, and the Map Lab's preview of a roll lists what the validator changed.
- Later, player-facing options (a difficulty, a region type) can pin some parameters and let the rest roll.
- The save stores the resolved parameters, not just the seed.

## Seeds and determinism

- A campaign has a 32-bit seed, shown in campaign history and enterable from the Map Lab.
- Generation uses a seeded PRNG, sfc32, in which every stream is rebuilt from a uint32 seed; the algorithm, the stream hash, and how many draws each call takes are in [seeded-prng.md](../AI_TECHNICAL_DECISIONS/seeded-prng.md). `Math.random` is never called during generation.
- Each stage draws from its own named stream: `terrain`, `water`, `hazards`, `places`, `roads`, `pois`, `stops`, `dressing`, `names`. A stage's stream forks from its upstream stage's winning stream, with the stage's attempt: the roads stage of map attempt 2 that runs after terrain attempt 0, water attempt 1, and hazards and places attempt 0 draws from `root.fork('map', 2).fork('terrain', 0).fork('water', 1).fork('hazards', 0).fork('places', 0).fork('roads', a)`. Every stage is a link in the chain, the ones that take no draws included. A retry of a stage never replays a stream that already failed, attempt numbers are counted per stage and never collide across stages, and a rerun upstream gives every stage after it fresh streams. The route tree and the tiers take no draws. The parameters roll from a `params` stream derived from the seed alone, and founding the campaign deals its starting pool from a `founding` stream of its own (Compound and Supply Runs, Founding the compound). Changing the stop tables never moves a road, and nothing in the dressing stage can reach the roads or the route tree. A parameter change only moves what depends on it, though terrain changes move the roads that follow the terrain.
- Game code, map and campaign included and tests too, never reads an unseeded source: lint rejects direct `Math.random` and crypto random calls (Web Crypto's and Node's) everywhere but `freshSeed()`, which mints root seeds, and anything reached through an import takes an `Rng`.
- Terrain, erosion, and drainage use only adds, multiplies, divides, compares, and square roots, which ECMAScript rounds exactly, so a seed's land is the same in every engine. Least-cost paths and the route tree break ties by index. Where something branches on a value that came from `Math.sin`, `exp`, or friends, which aren't bit-identical across engines, a cheap exact alternative is used instead (road-growth.md's trig-free unit vectors are one).

## World space

- The area is a disc of radius `radius` with the compound at the origin.
- The land is generated on a square grid a fifth wider than the disc each way, about 9 world units a cell (256 cells a side at radius 1000; provisional), so the disc is a window onto a larger country: rivers flow in and out of it and ranges run past its rim. Roads, POIs, and everything the game uses stay inside the disc.
- Screens scale world space to fit. The area map shows the whole disc, cropped to what's been uncovered plus a margin; the run route screen crops to the compound, the POI, and its routes.

## Pipeline

Eleven stages, in order. Each takes the earlier stages' output and its own stream. Stages 1 to 10 make the gameplay map; stage 11 dresses it. The numbers in this section are the prototype's starting values for the Map Lab to settle, each a provisional call in [realistic-map.md](../AI_TECHNICAL_DECISIONS/realistic-map.md), and the prototype's renders are there too.

### 1. Terrain: uplift and erosion

Mountains are where the land is pushed up, and valleys are what rivers cut into it. So the terrain is built the way the land was, from an uplift field and fluvial erosion, rather than drawn as noise.

- Uplift: a low, varied lift everywhere (rolling country), plus mountain ranges, which lift far more. Ranges are elongated belts of a broad noise layer stretched along one grain per map (real ranges in a region run roughly parallel) and bent by a warp, covering `mountainCoverage` of the land past the metro; the coverage threshold is a quantile of the layer, so the share holds on every map, as terrain-fields.md does it now. A second layer breaks belts into stretches with gaps, where passes form. `ruggedness` scales how hard ranges lift and how little their slopes are smoothed. Near the compound the ranges fade out and the hills lift less, and once erosion is done the metro is flattened, since rivers still cut valleys across it, so it sits on flat ground (terrain-erosion.md, The metro).
- Erosion: stream-power erosion solved implicitly (Braun and Willett's method), about 50 iterations. Each iteration routes drainage by priority flood from the outlets, accumulates drainage area, and lowers every cell toward its downstream neighbour by a rate that grows with the square root of the area above it, then smooths hillslopes a little. Rivers cut valleys back into the uplift, ranges break into ridges and spurs, and the result is a drainage network that runs downhill everywhere by construction.
- Outlets: `rivers` points on the grid's edge where the drainage leaves, so the region's water gathers into that many main rivers. With 0, it drains to an interior basin instead (a dry lake, for deserts).
- Dry maps weather into tablelands: below an `aridity` of about 0.4 the eroded elevation is pulled toward terraces, flat benches with steep risers, so High Desert reads as mesas and escarpments rather than green ridges.
- Elevation for everything after is the eroded grid, sampled bicubic, plus a little fine noise in rough country for the picture.

### 2. Water

- Drainage: a final priority flood over the finished elevation, with rain weighted by moisture and heavier in the ranges, gives every cell its downstream neighbour and drainage area.
- Rivers: cells whose drainage area passes a threshold set by `riverDensity`, traced from their sources down to a confluence, a lake, or the edge, then smoothed and given a meander on flat ground by `riverMeander`. Width grows with drainage area, so a river reads as a creek near its source and a broad river near its outlet.
- Lakes: `lakes` reservoirs, each held behind a dam on a river in a valley and filled up to a level, which floods the valley and its side branches into a lake of real shape; a few natural lakes where the land holds water (Floodlands). Lakes and the river channel are impassable except where a road crosses at a bridge.
- Moisture: from `aridity`, a broad noise layer, wetness spreading from the rivers, and drier with height.

### 3. Biomes, hazards, and cost

- Biomes come from the fields: mountains (range country), canyons (deep valleys on dry maps), toxic mire (wet, low, and contaminated), badlands, barren desert (dry), and scrub for the middling rest. The game reads them as categories (stop tables, POI types, faction fit). The picture never draws them as flat patches: colour is a continuous blend of elevation, moisture, and contamination, so country shades from one kind to the next.
- Hotspots (`hotspots`): blast sites and spills, spread out past the metro, each an impassable crater in a plume of contamination.
- Cliffs: ground too steep for any road, only in rough country.
- Impassable: water (bar bridges), craters, cliffs. No road or POI goes on it.
- Travel cost for a road between neighbouring cells: the distance, times one plus a grade term (the climb along the move, squared, weighted by class and by `curviness`) and a side-slope term, plus a bridge cost to cross a river, growing with the river's size. Cost along a move rather than of a cell is what makes roads follow contours and valley floors.

### 4. Settlements

- The metro: ruins around the origin, `metroSize` of the radius. The compound sits at its centre.
- Towns (`towns`) and villages (`villages`) go where real ones do: each cell gets a suitability score, highest on flat valley floors beside a river (more at a confluence), lower with height and steepness, none in range country's heart, on water, or by a crater, plus a little noise. Places are taken best first, keeping a spacing (towns about a quarter of the radius apart, villages a tenth), so towns string along the river valleys and gather at the junctions the roads will make.
- Crossroads: unnamed places Poisson-spaced across usable land by `roadDensity`, where county roads meet. They're what makes the network a mesh rather than a few lines between towns.
- Exits: where the `highways` leave the area at the rim, `highwaySeparation` apart, each slid along the rim to the gentlest ground nearby; and a few back-road exits between them.

### 5. Roads

Roads join places along the cheapest way over the land, and a new road goes in only where the roads already there make too long a detour. That's the classic hierarchical method for regional networks (Galin et al.), and it's what gives the network loops without doubling every road.

- Highways first: from each highway exit to the compound, through the best town near its bearing, by a least-cost path with highway weights (grades cost a highway more than any other class, bridges less). Existing highway is cheaper to follow than new ground, so highways merge into trunks near the city the way real ones do.
- Back roads: the candidate links are a Gabriel graph over every place (towns, villages, crossroads, exits), shorter links first. Each link's least-cost path is found with existing roads a little cheaper than new ground and ground right beside a road dearer, so a road joins another or keeps its distance rather than running alongside it. A link that joins places not yet connected always goes in. A link between places already connected goes in only if the roads between them are longer than its own path by the detour factor `loops` sets. Every new road that goes in closes a loop.
- Class: highways stay highways. A back road becomes a trail where it crosses rough country, by `trailShare`. A few trails run into the high country from villages near it, to passes, mines, and lookouts, and stop there.
- Bridges and passes: a road crosses a river where the path pays the bridge cost, which keeps crossings short and square-on; each crossing is a bridge (a candidate spot for a "bridge out" hazard). The highest point of a road over a range is a pass, which the dressing can label.
- Broken highways (`brokenHighways`): highway spans that collapsed. A span is broken only if every place stays reachable without it; the map draws it with its gap, and the network loses it.
- The metro: roads entering the metro run to the compound. Their pieces inside the metro are city streets, charted from the start; the rest of the metro's grid is dressing.
- Geometry: the paths are traced as cells, simplified, and smoothed (Chaikin) with the junctions held still. The network is plain data, as now: nodes (the compound, places, junctions, exits, class changes, dead ends, and roadside points that split stretches longer than about 140 units) and stretches between nodes, each with its class, its length, its polyline, and its bridges. Where two paths cross, they share a junction, so the network is planar; junctions closer than a cell merge.

A real network at radius 1000 is about 36,000 to 47,000 units of road, 450 to 600 nodes, and 110 to 190 independent loops (prototype, five environments). Routes use about two fifths of it.

### 6. The route tree

- Every place's way home is its quickest route to the compound over the road network, at the classes' speeds (Dijkstra, ties broken by index). Together the ways home are a tree rooted at the compound, spanning the network.
- The route tree is that tree, pruned to what routes use, plus the last piece of each route into its POI. A leg is a piece of the route tree between two places where something happens to routes: the compound, a place where routes split, or a POI. Legs are the unit stops, knowledge, and travel time work in.
- The route tree depends only on the road network, never on where POIs go, so placing, moving, or retuning POIs never changes any place's way home.

### 7. POIs and strongholds

POIs go where two or three ways home meet.

- Meeting points: a stretch no way home uses joins two places whose ways home differ. A POI anywhere along it splits it in two, and each piece is an arrival: the route from that side is that end's way home plus the piece. It's a candidate if those two ways home split no later than `routeSplit` of the shorter one's hours (guarantee 5).
- Three-way meeting points: a place no way home passes through (a leaf of the tree) with exactly three roads, whose three ways home split pairwise early enough. A POI there has three routes. They're rare on a real network.
- At most one POI on a stretch, and none on a junction, so no route passes a POI, and every road into a POI is one of its routes (guarantee 4).
- Strongholds first, `strongholds` of them, one per sector in the outer band (0.72 to 0.97 of `radius`), each the best fit for its faction (Mire-Crawlers want mire, Dune Striders desert) among its sector's meeting points. The sectors' rotation is drawn, then stepped by an eighth of a sector, up to 8 steps, until every sector holds a meeting point; if none does, the POIs stage fails and escalates to the roads, which rerun.
- Then POIs by ring: four rings from the metro's edge out to 0.95 of the radius, with targets 5, 7, 9, and 9 times `poiDensity`, the best meeting points by geography first, kept a spacing apart. Targets are aims, not promises: over 20 prototype maps the median map placed all 30 it aimed for and the leanest half of them.
- Type comes from where a POI lands: hospitals, malls, and schools in towns; stores and clinics in villages; a dam and pump house at a reservoir's dam; water plants by rivers; fuel depots and truck stops on highways; quarries and mines in the ranges; farms and silos in open lowland; salvage yards anywhere. Type sets the yield table. Inside the starting reveal, the first POIs are typed to cover food, water, and fuel before location does (guarantee 7).

### 8. Tiers and territories

- Tier: travel time in hours from the compound along the route tree, banded into tiers 1 to 5. A leg's tier is its far end's; a POI's is its quickest route's. The tier 3 to 4 boundary sits where an estimated run (out, typical stops, objective, home) stops fitting in `daylightHours`, so tiers 4 and 5 are night country. Strongholds are always tier 5. Stops are placed in stage 9, after tiers, so the daylight check (guarantee 10) runs after stage 9 and a failure reruns stage 9 with fewer stops on the offending routes before anything earlier. Tier sets encounter pools and skull counts, scaled by `dangerCurve`.
- Territory: each stronghold claims the legs and POIs nearest to it in travel time over the road network. Tier 1 is no one's ground, worked by scavengers. Territory sets checkpoint owners, raider rosters, stop weights, and place names.

### 9. Stops

- Stops sit only on legs, never on roads no route uses.
- Count per leg: for each class along the leg, its length over the class's stop spacing, times `stopDensity`, plus or minus one, clamped to the leg's range.
- Positions: spread evenly along the leg with jitter, kept clear of both ends and of junctions.
- Type: a weighted draw from `stopTables`, keyed by road class, the biome at that point, tier, and territory. Highways favour raider ambushes and checkpoints, towns favour wrecks, finds, and distress signals, mire favours hazards, and a bridge is a candidate for a "bridge out" hazard.
- Per route rules, checked on every route to every POI: no more than two fights in a row, at least one non-fight stop in any three.
- Map rules: `driverFinds` Find: driver stops within tiers 1 and 2, then a soft rate per tier so the pool can be refilled through the campaign without counting on luck.
- A stop's type is fixed at generation. Its exact contents are rolled when first revealed, from a stream keyed by the stop's id and its roll count, and the save keeps a revealed stop's rolled contents. When a cleared leg's stops come back, the roll count goes up and they reroll.

### 10. Starting knowledge

- The metro's streets and every leg inside the first `startingReveal` tiers are charted, with the land around them revealed.
- Each highway is charted one leg further: everyone knows where the highways go.
- Every other leg leaving revealed ground is uncharted, drawn as a stub into the fog.
- One or two legs toward the next tier's POIs start rumored, the radio's first rumors.
- No stronghold is revealed (guarantee 6 makes this true).

### 11. Dressing

Generated last, from the `dressing` stream, reading everything before it and writing nothing back. Everything here scales with `dressing`.

- Street grids: each town gets a grid at a random rotation, the metro several districts at different angles meeting along old district lines. Spacing and how many blocks survive come from `streetGrids`; missing blocks read as rubble.
- Rail lines (`railLines`): long gentle curves from edge to edge along valleys, bridging rivers, drawn with the rail pattern, never as a road.
- Contamination: plumes hatched round each crater, and mire stippled.
- Labels: place names by size (the metro in capitals), river names along their courses, range names spaced along each range's long axis, lake and reservoir names, pass names, highway shields with route numbers, POI and stronghold names. Placed by priority with collision boxes, so a label that can't fit is dropped rather than overlapping.

Dressing isn't saved; it's regenerated on load from the seed, the parameters, and the saved map.

## Routes

A route to a POI is one of its arrivals: the way home of the place it arrives from, driven outward, then the road into the POI. A POI with three arrivals has exactly three routes, and nothing needs searching: walk the route tree's parent links from each arrival to the compound.

- Two routes to a POI split before `routeSplit` of the shorter one (guarantee 5) and never meet again until the POI (guarantee 2). They may leave the compound on the same highway; past the split they share nothing.
- Every leg is driven one way only, outward, so a leg's stops always come in the same order, whoever drives it.
- Each route is described for the run route screen: a name from its dominant class and biome ("Route 9 highway", "Back roads", "Through the Mire"), knowledge (the least known leg on it), fuel, hours (out, objective, home) and the projected return against dark, stops as far as known, and risk.
- Routes may run through fog. That's the uncharted choice, shown as dashed road and a first stop.
- The run comes home down the route it took, as now.

![Run route view, High Desert seed 3: three routes to one POI, split in the city and apart until they arrive](../design/realistic-map/run-route-high-desert-seed-3.png)

## Knowledge and fog

Two layers, both saved state:

- Land fog: a coarse bitset over the disc (64 by 64 cells). Revealed land shows the atlas: terrain, water, every road, towns, labels, and any POI on it.
- Road knowledge: one of charted, rumored, or uncharted per leg (Compound and Supply Runs, Fog of war). Roads no route uses have no knowledge state; they show as plain roads wherever their land is revealed.

Reveal rules:

- Driving a leg charts it, reveals land within a sight radius of it, and shows every leg leaving its far end as an uncharted stub.
- Reaching a POI reveals a larger radius around it, including the ends of its other routes' last legs.
- The radio mast, at level L, turns uncharted legs within L legs of charted road into rumored ones, and can rumor a POI.
- A stronghold is found when its land is revealed or a leg to it becomes rumored.

## What changes after generation

- Never changes: terrain, water, the road network and its geometry, classes, the route tree and its legs, POIs, tiers, territories, stop types, dressing.
- Saved state: land fog, leg knowledge, each stop's state (cleared on which day, roll count, rolled contents once revealed), POI stock and depletion, strongholds taken.
- Cleared stops come back after a cooldown (5 days), rerolled. Taking a stronghold reweights its territory's stop tables (fewer checkpoints and warbands).

## Validation and retries

- The parameter validator runs first. It wraps the seed to uint32 the way the PRNG coerces it, replaces an unknown environment with Mixed and a value that isn't a number with the environment's default, rounds whole-number parameters, and clamps every value into its tuning range. Then it clamps the combinations the generator can't honour: `highways` is raised to `strongholds` plus 2 (where even 9 highways can't do that, `strongholds` comes down to 7 first, for now: see open question 5), and `highwaySeparation` is lowered to 360 / `highways`, rounded down, since that many departures can't sit further apart. Each clamp is reported with the parameter, its old and new value, and why, and the Map Lab lists them: "highways raised to 6 (strongholds + 2)". Stop tables pass through as plain JSON for the stops stage; anything in them JSON can't hold is an error naming its path, not a clamp.
- The map validator checks every hard guarantee from the map's data alone, so it checks a loaded map the way it checks a fresh one: planarity and clearance by a sweep over every pair of road polylines (grid buckets keep it fast), passability, that every place reaches the compound, that the route tree is a tree whose only joins are POIs, each POI's routes and where they split, one stronghold per sector against the saved sector rotation, tiers, the daylight estimates, and that dressing touches nothing.
- Each stage either returns its output or fails with a reason. The pipeline also takes an optional `accept(map, stage)` hook, called after each stage's own checks, which can reject that stage's output; a rejection counts as that stage's failure. A failing stage reruns on its next attempt (later stages rerun after it, on fresh streams). Up to 8 attempts a stage, or 1 for a stage that takes no draws, since it would only repeat itself; then restart the whole map on the next attempt, up to 32. A stage can instead name an upstream stage to escalate to, which reruns on its next attempt with everything after it: the POIs escalate to the roads when no sector rotation seats every stronghold. The stops and dressing stages retry only themselves and never restart the map: past their cap, debug builds throw and release builds log and keep their best attempt. Past the map cap generation throws; debug builds stop there, and release builds log and found the campaign on the next seed, its params rolled and its pool dealt from that seed, so the campaign's seed always reproduces it.
- The roads stage fails when its network has fewer loops than the POIs need (`poiDensity` times 30, plus `strongholds`), and reruns when POI placement can't seat every stronghold, which escalates to it; a different attempt places different crossroads and links them in a different order.
- Health metric, tracked by the tests and shown in the Map Lab: first-attempt pass rate per stage. The target after retries is no failures in 10,000 seeds, across the tuning ranges.

## Performance

- Generation runs once, at founding, off the frame: in a Web Worker in the web build and the Electron renderer alike, behind the founding screen. Loading a campaign never reruns a gameplay stage.
- The grid stages (terrain, water, settlements, roads) are the heavy ones. Budget, provisional: 1 second on a mid-range laptop, 2.5 seconds at the web minimum spec. The prototype, plain JavaScript on a desktop, takes 0.75 to 1 second for them at 256 cells a side, most of it erosion (about 550 ms) and road paths (140 to 210 ms). Running erosion coarse first (128 cells, then a few iterations at 256) and bounding each path search to an ellipse round its two ends are the planned levers.
- The graph stages (route tree, POIs, tiers, stops, knowledge, the validator) keep the 200 ms budget, on the same machines; the prototype's take under 30 ms. A stage that reruns reuses everything its upstream built once (the route tree, meeting points, spatial indexes) and allocates nothing per candidate.
- The Map Lab caches each stage's output by its inputs, so a gameplay parameter reruns only the graph stages, live, and a world parameter regenerates everything, with a progress readout.
- Rendering: the land bakes into one image per map when the map is generated or loaded, in the same worker; fog draws over it; roads, routes, and markers draw live, since their state and highlighting change.
- Expected sizes at radius 1000: 450 to 600 nodes, 560 to 770 stretches, about 40,000 units of road, about 30 POIs, about 300 stops.

## Saving

- The save holds the resolved parameters, the seed, the generator version, the map attempt and each stage's winning attempt (streams nest, so the land's stream and the dressing's hang from every attempt above them), and the gameplay map: every line the map draws, as it was generated, so roads, water, and the land always agree; and the route layer. Concretely: the road network (nodes, and stretches with class, length, and polyline), rivers (polylines and widths), lake shores, crater circles, place names and positions, the route tree (each node's parent stretch), legs, POIs (site, arrivals, type, ring), strongholds (site, faction, sector) and the sector rotation, tiers, territories, stops, and the saved state above.
- Polylines are stored simplified (Douglas-Peucker at about one world unit) as fixed-point deltas, nodes and polyline ends on the same grid so junctions still match exactly (DDB-436). Estimated at radius 1000 from the prototype: roads 1,900 to 2,700 points, about 10,000 to 14,000 characters; rivers and shores about 7,000; everything else about 20,000. So about 40,000 characters for the map, well inside the 800,000-character save budget.
- The land under those lines (elevation, moisture, hillshade) is regenerated on load from the seed, the parameters, and the attempts, in the worker, since it's only a picture once the map exists. Because erosion is plain arithmetic it regenerates bit-identically in every engine; a generator change can only shift the shading under the saved lines, never play.
- Saves live in local storage in both the web and Electron builds, each deployed build under keys of its own ([campaign-save-and-load.md](../AI_TECHNICAL_DECISIONS/campaign-save-and-load.md)). A save has a budget of 800,000 characters, so three copies of it fit local storage's 5 MiB at two bytes a character with room for the settings and history; builds served from one origin share that 5 MiB.

## Rendering: the road atlas

The area map, the run route screen, and the Map Lab all draw a map the same way: like a page of a printed state road atlas. Kevin's direction, 2026-10-08.

- Land: muted, light colours from a continuous blend of elevation and moisture (buff for dry ground, pale khaki in between, sage where it's wet, warmer grey-brown in the ranges), with soft hillshade lit from the north-west, stronger in high country and never harsh. No flat biome patches. Contamination tints the land rust and is hatched; craters are drawn as craters.
- Water: rivers in blue, width by size, under the roads; lakes and reservoirs filled blue with a darker shore line and a dam mark.
- Roads by class: highways bold, an orange-red fill in a dark casing, with route-number shields; back roads thin grey with a pale edge; trails dashed. Bridges get ticks either side. A collapsed highway span is drawn as broken casing with a cross.
- Towns as ruined street-grid patches (the metro as several districts), villages as small built-up patches, both named. Place labels have a halo and avoid each other.
- Gameplay over the atlas: POIs as circled glyphs by type, strongholds as diamonds, the compound as a star; the selected POI's routes as wide translucent bands under the road lines, side by side where they share road, lettered; knowledge as stops and stubs on legs; fog as a pale wash.
- Outside the disc, the land fades to paper, with rivers still faintly drawn, so the area reads as one region on a larger map.

The renders in the decision record are the target.

## The Map Lab (prototype tuning tool)

A section of the Developer screen for generating maps and tuning the parameters by eye, built from the engine's existing controls (Slider, NumberInput, Select, Toggle, SegmentedControl). Wireframe on the design canvas.

![Map Lab wireframe](../design/supply-runs/map-lab.png)

- Map view, with pan and zoom, and layer toggles: the atlas, terrain fields as heatmaps (elevation, uplift, drainage area, moisture, contamination), water, roads by class, crossroads and links, the route tree coloured by the road it leaves the city on, meeting points, POIs and strongholds, tiers, territories, fog as it would be at the start, and the routes for a selected POI.
- Parameters panel, grouped as in Map parameters: every parameter as a control, the seed with a new-seed button and a lock, and the environment preset, with values set by the preset shown differently from ones overridden.
- Regeneration on change, debounced and cached by stage. A step-through for erosion and for road links (play, pause, step) to watch the land and the network form.
- "Roll campaign params" previews what the finished game would roll for the current seed.
- Readout: each guarantee pass or fail, attempts per stage, milliseconds per stage, any parameter clamps, and counts (nodes, stretches, loops, road length by class, meeting points, POIs per ring against their targets, three-route POIs, stops by type).
- Presets: save and load parameter sets as JSON, kept in the repo (`src/renderer/game/data/mapPresets/`), and copy the current parameters to the clipboard. A preset holds the seed, the environment, and only the values that override the environment; a complete parameter set is a preset with every value overridden. An unknown parameter in a preset is an error, so a misspelling can't be dropped silently. Seed plus parameters reproduces a map exactly, though a preset that leaves values to its environment follows that environment's tuning.
- "Start a campaign here" founds a compound on the current map, for playtesting.

## Testing

- Unit tests: PRNG streams, parameter validation and `rollParams`, the erosion step and drainage on small hand-built grids (water runs downhill, every cell drains to an outlet), Poisson spacing, least-cost paths (grade along the move, bridges, reuse), the detour test, graph extraction and planarity, the route tree, meeting points and where routes split, POI typing, stop rules.
- Property tests over seeds (500 in CI, 10,000 locally or nightly), with parameters sampled across their tuning ranges: every hard guarantee.
- Dressing is inert: for a set of seeds, generate with `dressing` 0 and 1 and assert the gameplay map is identical.
- POIs never move the route tree: generate with `poiDensity` at its ends and assert every place's way home is the same.
- Snapshot: one fixed seed and parameter set's serialized map, so an unintended generator change fails a test. An intended one bumps the generator version and the snapshot together.

## Open questions

1. Map size against campaign length: how many runs should a campaign take? The default `radius` and POI counts follow from that.
2. Which parameters become player-facing in the finished game (region type, map size, difficulty), and which only ever roll.
3. Strongholds against highways (DDB-395). The tuning ranges allow 8 strongholds but at most 9 highways, so the validator lowers `strongholds` to 7 when even 9 highways can't cover it plus 2: a stand-in, since it puts a value the slider offers out of reach. Keep that rule, or stop the `strongholds` tuning range at 7?
4. With `strongholds` at least 2, `highways` 3 never survives validation, which raises it to 4, so the slider's lowest notch does nothing (DDB-395). Raise the `highways` tuning range's floor to 4, or keep it?
5. Roads no route uses: should some become usable later (a cleared barricade, a rebuilt bridge), which would mean a campaign event that changes ways home? Not in the first build: the route tree never changes after generation.
6. `routeSplit`: is a half the right floor for how different two routes to a POI must be? Splitting inside tier 1 for every POI, the old rule, places too few far POIs on a real network (the decision record has the numbers).
