# Stops on legs, route descriptors, and the run loop's routes (DDB-293, DDB-295)

Date: 2026-10-10. Code: `src/renderer/game/map/Stops.ts` (the stage, `rollStop`), `StopData.ts` with `data/stops.json`, `data/stopTables.json`, and `data/routes.json`, `StopChecks.ts`, `RouteDescriptors.ts`, the stage in `AreaMapPipeline.ts`, and `campaign/MapRoutes.ts` (`routeOffers`, `offersForDay`). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), guarantee 10, stages 8 and 9, Routes, Seeds and determinism, Validation and retries; [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), the run route screen, the drive, Racing the dark, and Stops. Follows [route-tree-and-pois.md](./route-tree-and-pois.md), whose legs and `routesTo` this reads, and runs on [map-pipeline-worker.md](./map-pipeline-worker.md)'s runner.

## Context

Maps 12 and 14 sit between the route tree and a playable run. The run loop (DDB-454, PR #201) drives a route's legs and their stops and shows each route's fuel, hours, and risk, from mock routes; it needs the real map's. Map 12 puts stops on the legs the POIs' routes use, and Map 14 describes each route the way the run route screen shows it.

Two of the inputs aren't built. Tiers in hours and territories are stage 8 (DDB-292), deferred for the MVP, and fog is DDB-294. So a leg's tier is a stand-in, territory is no one's everywhere, and every leg is charted. Like #202's, the tests run on `meshTesting`'s random meshes with a POI layer placed over them (`meshMap`). A map with no POIs has no legs, and gets no stops.

## The stage

`STOPS_STAGE` runs after the POIs, on the `stops` stream nested under the POIs' winning stream. It retries only itself, as the spec says the stops and dressing do: `localRetry`, so past its cap a debug build throws and a release build keeps the attempt with the fewest problems, and the map never restarts for it. Its check is `checkStopLayer`, which reads only the map's data and reports every problem, which local retries need to rank attempts.

Every draw comes from a fork named for its use: each leg's from `fork('leg', id)`, the Find: driver choices from `fork('finds')`, and the contents' root from `fork('contents')`. A leg's stops depend on its own fork and the stops behind it, so nothing about one leg moves another's draws.

The product is plain data, which crosses the worker boundary by structured clone with the POIs: each stop with its leg, how far along it (`along` in world units and `at` as a share), its point, type, skulls, and the class and biome its type was drawn by; one profile per leg (its stops, tier, territory, length by class and by biome, its main highway, its middle); the contents' seed; how many stops the daylight check took off; and what it couldn't keep. A stop's id is its index in the map's stops, stable for a given map, as DDB-281's review asked: never a `Model.id`.

## Counts and positions

A leg's count is its length of each class over that class's spacing, summed, times `stopDensity`, rounded up or down by a draw. The spec says "plus or minus one"; a draw on the fraction is that, read so the map's total comes to what its road earns, and so a short leg gets a stop only as often as its length earns one. That answers DDB-290's QA note about tiny trail stretches at the rim: a 10-unit stretch earns a tenth of a stop, not one. The count is then capped at what the leg holds at `minGap` between stops, inside its ends.

Positions are by arc length along the leg's pieces: the leg minus a clearance at each end is cut into one slot per stop, and each stop aims at its slot's middle, moved by up to half the slot by a draw. It goes to the nearest point in its slot that's `minGap` past the stop before and clear of every junction partway along the leg: a node where three or more roads meet, not one where the leg only changes stretch, at a class change or a roadside point. The nearest such point is the aim, an end of the slot, or a junction's clearance either side, so those are all it tries; a slot with none loses its stop. A slot is at least `minGap` wide, so the stop before always leaves the next room. Points come from `legPoints` in one walk, and `checkStopLayer` checks the clearances.

## Types and the stop tables

A stop's type is drawn from the stop tables by the class of the piece it's on, the biome at its point, its leg's tier, and its territory. The spec keys the tables on all four, and a full cross product would be 90 rows a territory. So the tables hold a weight per type for each class, and a multiplier per type for each biome, tier, and territory, 1 when left out; a stop's weights are their product. The shipped tables are `data/stopTables.json`, and a map's `stopTables` param replaces them whole.

The tables are read whole and compiled once, into cumulative sums for every class, biome, tier, and territory, over every type and over the calm types alone. A row with nothing to draw, or with no calm type, fails when the tables are read, naming the row, not partway through some seed's map (DDB-281's review notes). The params' tables are compiled once per object, so a stage's retries don't compile them again.

Types: the spec's stop table with Find split by what it finds, since the Find: driver floor is per kind: ambush, warband, checkpoint, wreck, distress, garage, hazard, and the five finds. Uncharted isn't a type; it's what a fogged stop looks like. A fight's skulls are fixed with its type, 1 at tier 1 rising half a skull a tier times `dangerCurve`, rounded by a draw, a warband's one more, up to 3, since the route card shows risk before a stop is revealed.

## The per-route rules

No more than two fights in a row, and a non-fight in any three. Read literally the two are one rule. They differ if a checkpoint, which can turn into a fight, isn't a non-fight: then three stops of fights and checkpoints break the second rule and not the first, and the first still bites at three fights. That's the reading taken (a provisional call).

Routes share legs, so the rules can't be checked route by route as stops are drawn. They don't need to be. Every leg has one parent, so the stops behind a leg are the same on every route through it, and legs come parents first. Drawing leg by leg from the compound out, carrying the last two types behind each leg, a stop whose two predecessors are both fights or checkpoints draws from the calm types alone. Every route keeps both rules by construction, and `checkStopLayer` walks every route to every POI again to say so.

Two facts the later steps lean on: turning a stop calm, or adding a calm one, never breaks a rule; and taking away a fight or a checkpoint never does either.

## Find: driver

First a soft rate per tier: at least `rates[tier]` of a tier's stops, rounded down, are Find: driver (0 in tiers 1 and 2 and 4% beyond, shipped). Then the floor: at least `driverFinds` in tiers 1 and 2. Each shortfall turns a stop into a Find: driver, an event first, then a hazard, a garage, a checkpoint, another find, and a fight last, on a leg with none yet where it can, picked by a draw among the best. Where the floor's legs hold too few stops to turn, a Find: driver goes into the gap where it can stand furthest from the stops either side, clear of junctions; it keeps `minGap` where the legs have room, and may sit closer where they don't. Only a map with legs but none in tiers 1 and 2 misses it, and says so in the layer's failures.

## The daylight check

Guarantee 10: every POI in tiers 1 to 3 has a route whose estimated run fits in `daylightHours`: twice its driving hours (out, and home down the cleared road), its stops' hours, and the objective's.

The spec has a failure rerun the stage with fewer stops on the offending routes. A rerun on a fresh stream knows nothing of which routes failed, so the stage does the thinning itself, after placing and before its check: a POI with no route home by dark sheds stops from its quickest route, on legs fewer routes share first, then the costliest in hours, the furthest out first, until the estimate fits. A fight or a checkpoint can always go; a calm stop only where every route through its leg keeps the rules without it. A Find: driver goes last, and only where the floor and its tier's rate still hold, or by moving to the widest gap on another leg of its tiers, off this route and only onto a leg where its half hour tips no POI that's home by dark past it. Without that last rule two POIs could hand one find back and forth. Thinning only takes stops away and a moved find never tips anyone, so a POI that fit still fits; the check still makes up to four passes, in case.

A POI whose quickest route runs past dark with no stops at all can't be mended by stops. It's in the layer's failures, and the check lets it through: on the ring stand-in, a tier 3 POI can sit further out than a run can go and come back. Tiers in hours (DDB-292) put the tier 3 to 4 boundary where runs stop fitting, and the failure goes away. Anything else the check finds fails the stage, which retries on its next stream.

## Contents

`rollStop(map, stopId, roll)` rolls a stop's contents when the run reveals it, from `stop:<id>` at the roll count, forked from the layer's contents seed: the same stop and roll always give the same contents, and a cleared leg's stops reroll when the count goes up. The contents are plain JSON, so the save can keep a revealed stop's (DDB-432's call 12): the stop, the roll, its type, its hours (a hazard's rolled between half an hour and two), a seed for the run to draw the rest from (a fight's raiders, a found driver, an event's outcome), and for a hazard its kind, for a supplies find its haul. Each field draws on a fork of its own. Everything else a stop holds belongs to the run controller (DDB-322), which draws it from the seed.

## Route descriptors

`describeRoutes(map, poi, { knowledge })` gives each of a POI's routes, quickest first, as the run route screen shows it, from the POI layer and the stop layer alone:

- Name: from the route's own road, the legs no other route to the POI uses, since that's what tells routes apart. A biome with a name ("Through the mire") where it covers half of that road, or else the dominant class's: "Route N highway", numbered by the highway with the most length on that road (its stretches' `highway` index, the order of its exit among the highway exits, plus one, as the shields number it), "Back roads", "Trails". Two routes to one POI that come out alike get the side they come in from, "Back roads from the north", and any still alike their letter.
- Knowledge: the least known leg, by a function from leg to charted, rumored, or uncharted that defaults to charted everywhere until fog exists.
- Stops as far as known: a charted leg's with their types, a rumored leg's as stops of unknown type, and from the first uncharted leg on, a direction and the next stop, as the spec has it: every leg past it counts as uncharted.
- Hours: out is the drive plus the known stops' hours, with unknown types at three quarters of an hour and an uncharted leg's at what its road would earn; at the objective, 1.5 hours, 2 at a stronghold; home is the drive alone. `estimated` says when any leg isn't charted.
- The return against dark: the hour it's back, leaving at 06:00, dark at dawn plus `daylightHours`, and the spare daylight, below 0 past dark.
- Fuel: a unit per 150 units of road, out and back, at least one, the mock routes' rate.
- Risk: the worst known fight's skulls, 0 with none known.

`poiNames` stands in for place names until the names stream: a POI's type and its bearing from the compound, "Salvage yard, north-east", a stronghold's faction's, numbered where two would match.

## The run loop's routes

`routeOffers(map)` gives every route on the map in the run loop's route model (`RunRoute`, with its `RouteDestination`, `RouteLeg`, and `RouteStop`), POI by POI. Ids come from the map's own (`poi-3`, `route-3-1`, `leg-12`, `stop-40`), so a map gives the same routes however often it's asked, which `departRun`'s check that a route is on offer needs. A run carries every stop on its legs, whatever the route card knows. Fights are fights with their skulls, and every other stop is a quiet stretch (DDB-432's call 70) until the run has screens for events, finds, garages, and hazards. Hours are rounded to tenths and lengths to whole units, as the mock's are. Risk is the route card's, with 1 for a route with no fight, since the model's risk runs 1 to 3. A destination yields what its POI's type does (`data/pois.json`), in place of #201's tier ranges; meds aren't among the run's yields yet, so they're left out, and a stronghold yields nothing until it has rules of its own.

`offersForDay` stands in for the area map screen (DDB-43), which picks a POI: it keeps the run loop's contract of two or three destinations a day with a tier 1 one among them, drawn from `fork('routes', day)` off the campaign's seed, each with every route it has. Only destinations with a route home by dark are offered, since a run has no night yet (call 5), read from the descriptors' unrounded hours rather than the run's tenths, which can round a run a minute past dark back inside it; and never a stronghold.

`getAreaMap(campaign)` is asynchronous and the run loop's `routesOnOffer` isn't, so the route pick loads the map first and passes it in, with the mock kept for a campaign without one, in tests and dev.

## Measured

Random meshes at radius 1000, 80 to 90 units apart, 34 POIs and 125 to 130 legs each, shipped tuning, 14 hours of daylight: 131 to 158 stops a map, 4.6 to 5.7 a route on average and 11 at most; the daylight check took 13 to 36 stops off; 0 to 3 tier 3 POIs a map ran past dark with no stops. Placing them took 2 to 5 ms in Jest after a first map of 12 ms. On the road graph's maps (Maps 7 and 8), about 145 stops a map at radius 900 and 185 at 1200.

## Provisional calls

Calls the spec left open, made the simplest way consistent with it, for Kevin to approve or adjust. The tuning numbers are starting values for the Map Lab.

1. A leg's count is rounded up or down by a draw on its fraction, then capped at what the leg holds at 40 units between stops, the least gap between the stops it's dealt.
2. Spacing per stop: highway 150 units, back road 120, trail 100. Clearance 15 units from a leg's ends and 8 from a junction partway along it, a node where three or more roads meet; jitter half a slot.
3. Stop tables as class weights times biome, tier, and territory multipliers; the shipped weights in `data/stopTables.json` (highways lean to ambushes and checkpoints, trails to hazards, mire triples hazards, no warbands in tier 1, no one's ground halves checkpoints).
4. A checkpoint isn't a non-fight for the per-route rules.
5. A fight's skulls are fixed with the map: 1 at tier 1, half a skull more a tier times `dangerCurve`, rounded by a draw; a warband one more; at most 3.
6. Find: driver at no set rate in tiers 1 and 2 beyond the floor, and at least 4% of the stops in tiers 3 to 5; a stop turned into one is an event first and a fight last; the floor adds stops where it must.
7. Stop hours for the estimate: fight 1, warband 1.5, event, find, and checkpoint 0.5, garage 1, hazard 1 (its contents roll 0.5 to 2); the objective 1.5, a stronghold's 2.
8. The daylight check thins inside the stage, the POI's quickest route only, own legs first, then the costliest stops, then the furthest out, and moves a Find: driver it can't spare.
9. Contents: a hazard is a storm, radiation, a sinkhole, or a flooded underpass; a supplies find is one resource, 2 to 5 food or water, 1 to 3 fuel, 1 to 2 meds, or 5 to 15 scrap.
10. A leg's tier is the lowest tier of the POIs whose routes use it, with POIs on the ring + 1 stand-in; every stop is on no one's ground.
11. Route names come from the route's own road; a biome names it at half of that; highways are numbered by their index + 1; duplicates take the side they come in from, then a letter.
12. Fuel is a unit per 150 units of road, out and back, at least one; an unknown stop counts three quarters of an hour; a run leaves at 06:00.
13. Risk is the worst known fight; the run's is at least 1.
14. Every stop that isn't a fight runs as a quiet stretch.
15. A day offers a tier 1 destination and up to two from tiers 2 and 3, only those with a route home by dark, never a stronghold.
16. A POI's name is its type and its bearing from the compound until the names stream.
17. A destination yields its POI type's food, water, fuel, and scrap; meds wait for the run to carry them, and a stronghold yields nothing yet.

## Consequences

- The run loop's `routesOnOffer` reads `offersForDay` over the campaign's map in place of its mock; the state machine doesn't change.
- Stage 8 (DDB-292) replaces two stand-ins: the leg tier, where its tiers in hours become the stops' tiers, and the territory, which the tables already key on.
- The map validator (DDB-296) runs `checkStopLayer`; the Map Lab (DDB-299) can show stops by type and the readout's stops by type from the layer.
- Knowledge (DDB-294) passes its leg states to `describeRoutes`; the descriptors already show rumored and uncharted legs.
- The save (DDB-436) keeps stop ids as they are, and a revealed stop's contents from `rollStop`.
