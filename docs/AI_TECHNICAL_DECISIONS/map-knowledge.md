# Starting knowledge and the fog, the map's side (DDB-571)

Date: 2026-10-31. Code: `libs/rules/map/MapKnowledge` (the starting knowledge, what a run reveals, which POIs are found, and the reveal's half of Guarantees 6), `LandFog` (the land fog's cells), `packs/base/map/knowledge.json` (the sights and the first rumors), and the map validator in `AreaMapPipeline` (`validateAreaMap`, `mapValidator`). Specs: [Area Map Generation](../specs/Area%20Map%20Generation.md), Guarantees 6 and 7, 10. Starting knowledge, Knowledge and fog, Validation and retries; [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), Fog of war and The area map. Builds on [route-tree-and-pois.md](./route-tree-and-pois.md), whose legs and tiers this reads, and [stops-and-routes.md](./stops-and-routes.md), whose `MapToday` and `outlookOf` read leg knowledge. The TypeScript never built either (DDB-294), so there's nothing to port: this is the spec's.

## Context

`RouteOutlook` already reads a leg as charted, rumored, or uncharted, and `MapToday::legs` is how the campaign tells it, but nothing said what a campaign knows at founding, so `mapToday` leaves the legs empty and every leg reads charted. The campaign keeps the legs runs charted (`MapState::chartedLegs`) and the POIs they cleared; what starts charted was left to the map. The land fog, the coarse bitset the spec has over the disc, had no type at all.

## Options considered

Where stage 10 goes:

1. **A pipeline stage after the stops,** on a `knowledge` link in the stream chain. Every save names its stages' attempts, and the replay refuses one missing a gameplay stage, so every campaign saved before it would fail to load, and the campaign's tests, which name the stages, would need changing in a library this work can't touch. It would also nest the dressing a link deeper, for a stage that takes no draws.
2. **A pure function of the gameplay map (chosen).** It takes no draws and nothing generation makes reads it, so it's worked out whenever it's wanted, the way a POI's name or a leg's profile is, and never saved. The legs inside the POI stage went the same way (route-tree-and-pois.md, call 2).

Whether the land fog is saved:

1. **The bitset in the save,** as the spec's saved state lists it.
2. **Worked out from what the save already names (left to the campaign).** The land a run reveals is a function of the legs it charted and the POI it reached, both in `MapState`, so the starting land plus each charted leg's sight plus each cleared POI's is the whole fog. Nothing in the spec reveals land any other way yet: the radio rumors legs. The functions here serve either, since `LandFog` is plain data the campaign can keep or work out.

## Decision

**The starting knowledge** is `startingKnowledge(args)`, over the network, the POI layer, the params, and `KnowledgeTuning`. It returns a `MapKnowledge`: each leg's `LegKnowledge` (the enum moved here from `RouteOutlook`) and a `LandFog`. Out from the compound, parents first, so every charted leg's parent is charted:

- Every leg whose tier is `startingReveal` or less is charted, and so is one wholly on city streets (`RoadStretch::street`). A leg's tier is the stops' (`legTiers`, the lowest tier of the POIs whose routes drive it), so it follows the POI tiers, the stand-in today and stage 8's once tiers come from hours.
- Each highway goes one leg further: a leg off charted road (or out of the compound) that's more highway than any other class, ties to the highway, and in the next tier, `startingReveal + 1`. It reads what the first rule charted, so a highway never runs on two legs. A leg toward nothing nearer than two tiers out stays uncharted, so a highway never charts the road into a stronghold, which is tier 5.
- The radio's first rumors: of every route to a POI in the next tier, the first leg off charted road, nearest first by the route's hours, ties to the lower leg, until `startingRumors` (2) are rumored.
- Every other leg is uncharted. One leaving charted road is a stub into the fog; that's the view's to draw from the legs' parents.
- The land within `sight` of every charted leg's road, and of every street, those no route drives included, is revealed, so the metro reads as explored.

**What a run reveals as it passes**, over the map and never into it:

- `driveLeg(knowledge, args, leg)`: the leg charted, and the land within `sight` of its road.
- `reachPoi(knowledge, args, poi)`: the land within `poiSight` of the POI.
- `rumorLeg(knowledge, leg)`: an uncharted leg rumored, a charted one left charted.
- `isFound(knowledge, args, poi)`: the POI's land is revealed, or one of its last legs, the legs into it, is rumored or charted.

Nothing takes knowledge back: each only raises a leg's knowledge or adds land, so a revealed stop stays revealed whatever order runs come home in.

**The land fog** (`LandFog`) is 64 by 64 cells over the square the disc sits in, a `uint64_t` a row, so a cell is 2r / 64 across (31.25 units at radius 1000). A cell is revealed when its centre is within sight of a line, by the squared distance to each segment, which is exact arithmetic. `revealedAt` reads the cell under a point, one past the square's edge reading the edge cell; `exploredShare` is the revealed share of the cells whose centres lie on the disc, the area map's explored percentage.

**The tuning** is pack content, `map/knowledge.json`, read strictly by `readKnowledgeTuning` with the rest of `MapContent`: `sight` and `poiSight` as shares of the radius, 0.06 and 0.12 (60 and 120 units at radius 1000, about two cells and four), `poiSight` at least `sight`, and `startingRumors`, 2. It's in `MapContent` because the validator reads it, and so a run's `MapLayers` already carries it.

**The map validator** (DDB-296's) is `validateAreaMap(map, input)` and, as the pipeline's accept hook, `mapValidator(input)`. Each gameplay stage's own check is already the validator's for its layer (`checkRoads`, `checkPoiLayer`, `checkStopLayer`, and the hazards' and places'), so:

- The hook adds only what no one layer holds, after the stage that completes it: past the POIs, `revealProblems`, the starting knowledge's half of Guarantees 6. A stronghold within a tier of the starting reveal (tier under `startingReveal + 2`), or found at the start, fails the POIs as their own check would, so they retry, and past their attempts escalate to the roads.
- `generateAreaMap` runs it on every generation, before any hook the caller passes. A replay checks nothing, so it never moves a saved map.
- `validateAreaMap` runs every stage's check and the hook's over a whole map, each problem as `stage: rule: detail`, so a map a load made again is held to every guarantee as a fresh one is.
- The dressing touching nothing isn't a runtime check: it reads every layer through const references and writes only its own product, and the slow lane makes the gameplay map to the bit at the dressing's other params.
- Guarantee 7 needs nothing more: the first ring's tier 1 POIs cover food, water, and fuel (the POI stage's cover), tier 1 is always inside the reveal, and the stops' `finds` rule holds the Find: driver floor in tiers 1 and 2.

## For the campaign

What `mapToday` should call, with `layers` a run's `MapLayers`:

```cpp
const map::KnowledgeArgs args{.network = layers.network, .pois = layers.pois, .params = layers.params, .tuning = layers.content.knowledge};
map::MapKnowledge known = map::startingKnowledge(args);
for (const int leg : campaign.mapState.chartedLegs) {
	map::driveLeg(known, args, leg);
}
for (const int poi : campaign.mapState.clearedPois) {
	map::reachPoi(known, args, poi);
}
today.legs = known.legs;
```

`isFound(known, args, poi)` says which POIs the area map shows and the run can pick, strongholds found included, and `exploredShare(known.land)` the explored percentage. A rumor the radio mast or an event hands out is `rumorLeg`, which the campaign keeps as its own list. A load can hold the map it made to every guarantee with `validateAreaMap(loaded.map, {.params = origin.params, .content = mapContent})`, 8 to 15 ms in RelWithDebInfo.

The fingerprint covers the POIs' tiers and the legs, which the starting knowledge reads, but not the stretches' classes, their geometry, or the routes' hours, which it reads too. A generator change that moved only those could change what a save starts knowing without failing its load; hashing `startingKnowledge`'s legs into `mapFingerprint` would close that, at the cost of every save made before it.

## Measured

On 24 campaign maps `rollParams` made from seeds 1 to 24, radius 900 to 1200, every environment: 20 to 35 of 84 to 122 legs start charted and 2 rumored; 4 to 7 POIs are found at the start, the 3 to 6 in tier 1 and up to 2 more whose land or rumored road is seen; 7 to 13% of the disc is explored at a reveal of 1, 17 to 24% at 2. No stronghold is within sight at either reveal, and the validator rejected nothing, so no map moved: every one won on the attempts it won before. The starting knowledge takes 0.1 to 0.2 ms in RelWithDebInfo.

## Provisional calls

Calls the spec left open, made the simplest way consistent with it, for Kevin to approve or adjust (gameplay calls 430 to 435):

1. A leg is inside the starting reveal when its tier, the lowest of the POIs whose routes drive it, is `startingReveal` or less; a leg wholly on city streets is charted too, out from the compound.
2. "Each highway is charted one leg further" is each leg off charted road that's more highway than any other class and in the next tier: one leg, never two, and never a leg toward nothing nearer than two tiers out.
3. The radio's first rumors are 2 legs, each the first leg off charted road on a route to a POI in the next tier, nearest by the route's hours.
4. Driving a leg reveals the land within 0.06 of the radius of its road, and reaching a POI within 0.12 of it; a fog cell is revealed when its centre is.
5. Reaching a POI reveals a disc round it, which takes in the last stretch of each of its other routes; "the ends of its other routes' last legs" is read as their ends at the POI, since a long last leg's far end can stand hundreds of units off.
6. Every POI is found by the stronghold's rule, its land revealed or a leg into it rumored or charted, and "a leg to it" is one of its last legs, since the first legs of every route are charted from the start.

## Consequences

- `mapToday`'s legs come from `startingKnowledge` with the campaign's charted legs over it; until the campaign does that, every leg still reads charted.
- The area map's frame, its markers, and its stubs read a `MapKnowledge`: revealed land, found POIs, and each leg's knowledge with its parent's.
- A stronghold found at the start now fails the POI stage. On the maps measured it never is; retuning `sight` wider could make it so, which reruns the POIs on those seeds.
- Stage 8 replaces the tier stand-in under the starting reveal without a change here, but it moves every leg's tier, and so what starts charted.
- Left: the radio mast's rumors by level (uncharted legs within L legs of charted road), a POI rumored by the radio without its road, and a scout escort seeing two stops ahead. Each is a rule over the same legs and the campaign's state.
