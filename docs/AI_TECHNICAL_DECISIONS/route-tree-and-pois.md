# The route tree, legs, meeting points, POIs, and strongholds (DDB-445, DDB-291)

Date: 2026-10-10. Code: `src/renderer/game/map/RouteTree.ts` (the tree, meeting points, legs, and `routesTo`), `Pois.ts` (strongholds, POIs, typing), `PoiData.ts` with `data/pois.json` and `data/factions.json`, `PoiChecks.ts`, and the two stages in `AreaMapPipeline.ts`. Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), guarantees 2 and 4 to 8, stages 6 and 7, Routes, Validation and retries. Follows [realistic-map.md](./realistic-map.md), decision 3, which defines the tree, legs, and meeting points, and runs on [map-pipeline-worker.md](./map-pipeline-worker.md)'s runner. Carries over the data files and readers from the closed #177.

## Context

Maps 9 and 10 make the routes: every place's way home, the meeting points where two or three ways home end, strongholds and POIs on those, and legs for what the routes use. The run loop (DDB-454) and the route descriptors (Map 14) read routes as legs from the compound.

The roads they need don't exist yet. Road links and the road graph (Maps 7 and 8) will build a network with loops; today's network is growth's, which is a tree, so it has no stretch off every way home and no leaf with three roads, and therefore no meeting points. So both stages were built and tested on synthetic networks, hand-built meshes with loops and a random planar mesh generator (`meshTesting.ts`), and wired into the pipeline after growth in a lenient mode that reports what it can't place instead of failing.

## The route tree

Dijkstra from the compound, node 0, over the stretches at their classes' speeds (highway 260, back road 160, trail 90 units an hour, realistic-map.md's provisional call 6). Stretches are undirected here: a way home drives one whichever way its points run, so the outward `from` and `to` and the `parent` link growth writes are ignored, and nothing changes when Map 8's network drops them.

- Ties go to the lower stretch id. A node's parent is the least of every candidate, compared on (hours, stretch id), not whichever the heap pops first, so the tree doesn't depend on the heap. The heap is keyed by (hours, node) for the same reason.
- Hours are found at `travelPace` 1 and scaled after. The pace multiplies every class alike, so it can't change a way home, and scaling after means rounding can't tip a tie either.
- The product is plain data: per node, the next stretch and node home, depth, and hours (Infinity where the roads don't reach); per stretch, its length and hours; and the meeting points. Typed arrays, which structured clone carries across the worker boundary as they are.

Meeting points are found in the tree stage, not the POI stage. They depend only on the network and `routeSplit`, and a POI stage that reruns, or escalates and comes back, reuses them, as the spec's Performance section asks.

- On a stretch: no way home uses it, and the ways home of its two ends split, at the last node they share, no later than `routeSplit` of the shorter one's hours. A stretch whose one end is on the other's way home splits at that end, which passes only when it's the compound.
- Three-way: a node no way home passes through (no node's next step home is it), with exactly three roads, whose three neighbours' ways home split pairwise by the same rule. Its routes are the three roads in, one of them the node's own way home reversed.

The split is found by walking both nodes up to equal depth, then together. A POI has at most three arrivals, so a lowest-common-ancestor index wasn't worth building.

## Legs

A leg is a piece of the tree between the compound, a place where routes split, and a POI, so legs depend on where the POIs are. They're built by `buildLegs` at the end of the POI stage and kept in its product.

Options:

1. A draw-free stage of its own after the POIs. It would add a link to the stream chain that the spec's stream list doesn't name, and nest the stops' stream one level deeper, for no draws.
2. Inside the POI stage (chosen). The POIs and their legs are always made together and fail together.

How they're cut:

- The pruned tree is the ways home of every arrival's node. A node on it is a boundary when two or more ways go on from it: branches of the pruned tree, and arrivals leaving it for a POI. The compound always is.
- Each leg runs from a boundary along the tree until the next boundary, or, where the only way on is an arrival, on into the POI. Its pieces name the stretch, which way it's driven, and how far: the whole stretch, or into a POI partway along one, the arrival's length.
- Legs come out parents first, from the compound, each node's branches by node id and then its arrivals by POI and arrival. A leg's `to` is the node it ends at: a boundary, a three-way POI's node, or -1 partway along a stretch, where `poi` names the POI.

`routesTo(layer, poi)` walks each arrival's last leg back through its parents and returns each route as its leg ids from the compound out, with its length and hours, in the arrivals' order: quickest first, ties to the lower node. `legPoints(network, leg)` gives a leg's road as one polyline, outward, for drawing and for placing stops.

## Strongholds

- The sectors' rotation is drawn on the `sectors` fork within one sector's width, then stepped by an eighth of a sector, up to 8 steps, until every sector holds a site in the outer band, 0.72 to 0.97 of the radius. When no step does, the drawn rotation is kept and the sectors without one fail.
- Which sector a point is in uses no trig: each boundary is a `unitVector`, and a point's angle from the first boundary is a diamond angle in that boundary's frame, which grows with the true angle and needs only adds, multiplies, and divides.
- Each sector in turn seats one stronghold, on the free site in it whose best untaken faction fits best. The fit is #177's: biome counts at the site and six points 40 units round it, inside the disc, weighted by the faction's biome weights, plus its ruin weight times the ruin there, averaged, plus a jitter per faction drawn once on the `factions` fork so close calls vary between maps. Ties go to the site that scores better by geography, then the earlier site.
- A stronghold is a POI of type `stronghold`, listed before the others, with its faction and sector in `strongholds`. Its routes are legs like any POI's.

## POIs

- Candidate sites: every 12 units along each meeting stretch, inside a margin of 18 units or 0.3 of the stretch, whichever is less, and each three-way point's node. Each scores 0.6 times a draw on the `sites` fork, plus 1.5 times the ruin there, plus 0.5 within 45 units of a highway, plus 1.2 at a three-way point, since a third route is a soft goal.
- Rings: four, from the metro's edge to 0.95 of the radius, aiming for 5, 7, 9, and 9 times `poiDensity`, rounded. Sites go best score first into the ring their distance puts them in, while that ring is under its target.
- A site is free while no stretch of its meeting point is taken. Taking one marks its stretch, or a three-way point's three, so there's at most one POI on a stretch, a POI's arrival node is never another POI, and every road into a POI is one of its routes (guarantee 4). Guarantee 5 holds because every meeting point already splits in time.
- Spacing: every site 0.075 of the radius from everything placed, and strongholds 0.15 from each other.
- Type by location: the first placement rule in `pois.json` whose conditions hold, one of its types picked by a draw on the `types` fork, one draw per POI whether it's used or not. The rules are #177's, extended with schools, general stores, clinics, truck stops, quarries, and mines.
- Then the first ring is typed to cover food, water, and fuel, quickest POI first: a POI keeps its location's type if that yields something still needed, or else takes the type yielding the most of what's still needed, preferring one whose placement rule holds there. A resource still missing after the first ring is a failure.

Every draw comes from a fork of the stage's stream named for its use (`sectors`, `factions`, `sites`, `types`), so adding draws to one never moves another.

## Checks

`checkPoiLayer` checks the tree, the POIs, and the legs from the data alone, so the map validator (DDB-296) can run it on a loaded map: the ways home are a tree; each POI on a stretch is inside it, off every way home, alone on it, and arrives from both its ends; each three-way POI is on a leaf whose every road is an arrival; no route passes any POI's node or stretch; two or three arrivals from different nodes that split in time; legs carry on from their parents piece by piece and each route ends at its POI on its arrival's stretch; spacing; and one stronghold per sector of the saved rotation, in the band.

## Strict mode, and what Maps 7 and 8 do

`poisStage({ strict })` is off in `areaMapPipeline` until the road graph replaces growth.

- Lenient (now): the stage's check runs `checkPoiLayer` without the sector rule, so a bug still fails it, and the layer's `failures` list what it missed: sectors with no stronghold, and cover the first ring doesn't yield. On growth's network that's every sector and all three resources, with no POIs, and the map goes on.
- Strict: `failures` and every violation fail the stage. After its 8 attempts it escalates to the roads, which rerun on their next attempt; escalation is the runner's (map-pipeline-worker.md).

To turn it on, Map 8:

1. Points `ROUTE_TREE_STAGE` and `poisStage` at the roads stage's product, and the escalation at the roads stage, in place of `growth`.
2. Passes `pois: { strict: true }` in `areaMapPipeline`.
3. Adds the roads stage's own loop check from the spec's Validation section, so escalations stay rare.

`roadTesting.growMap` already throws when any stage needed a retry, so its tests will see a POI stage that couldn't place.

## Measured

Random meshes at radius 1000, 90 units apart (360 nodes, 620 to 670 stretches, 86 to 136 meeting points, 0 to 6 of them three-way), 4 strongholds, `poiDensity` 1: on all 20, every sector seated a stronghold and all 30 POIs were placed, and the checks found nothing. The route tree took 0.1 to 0.6 ms and the POI stage 0.8 to 2.5 ms in Jest, after a first map of 2 and 7 ms. These meshes loop far more than real roads do, so they say the code is right and fast, not how real maps will fill; Map 8 measures that.

## Stubs for the MVP

Each is a follow-up:

- Tiers: a POI's tier is its ring plus one, a stronghold's 5, until tiers in hours (DDB-292). Guarantee 6's "outside the starting reveal by at least one tier" isn't checked.
- The starting reveal and fog aren't modelled (DDB-294). The first ring stands in for the starting reveal in the food, water, and fuel cover.
- Typing by place and water: towns and villages show only as ruin, water plants come from low or wet ground, and nothing types a dam. Places (Map 6) and water (Map 5) make the spec's list possible.
- Saves keep nothing of it; the map regenerates on load, since it's deterministic (DDB-436).

## Consequences

- The run loop and Map 14 read `products.pois`: `pois[i].arrivals` and `routesTo(layer, pois[i])`, legs by id from `layer.legs`, and each leg's pieces or `legPoints`.
- Stops (Map 12) and knowledge (Map 15) key on leg ids, which are stable for a given map.
- A POI stage rerun reuses the tree and its meeting points; only the candidate list is rebuilt, since its scores draw on the attempt's stream.

## Provisional calls

Calls the spec left open, made the simplest way consistent with it, for Kevin to approve or adjust:

1. Ways home tie to the lower stretch id; hours are found at pace 1 and scaled.
2. Legs are built inside the POI stage, not a stage of their own.
3. Sites every 12 units along a meeting stretch, kept 18 units or 0.3 of its length from each end.
4. Site scores: 0.6 noise, 1.5 times ruin, 0.5 within 45 units of a highway, 1.2 for a three-way point.
5. POI spacing 0.075 of the radius from everything; strongholds 0.15 from each other.
6. A stronghold's site is the best fit for its best untaken faction, sampled at the site and six points 40 units round it, with a jitter of up to 0.1 per faction per map; ties to the better geography.
7. Strongholds are POIs of type `stronghold`, listed first, tier 5.
8. Types and yields: the placement rules and yield table in `pois.json`, which add schools, general stores, clinics, truck stops, quarries, and mines to #177's.
9. The first ring covers food, water, and fuel, quickest first, keeping a location's type where it already yields something needed.
10. A POI's arrivals, and so its routes, are listed quickest first, ties to the lower node.
11. Tier stand-in: ring plus one.
12. The POI stage is lenient until Map 8 turns strict mode on.
