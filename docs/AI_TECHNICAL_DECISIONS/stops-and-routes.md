# Stops on legs, route descriptors, and the run loop's routes (DDB-293, DDB-295)

Date: 2026-10-10. Code: `_legacy/src/renderer/game/map/Stops.ts` (the stage, `rollStop`), `StopData.ts` with `data/stops.json`, `data/stopTables.json`, and `data/routes.json`, `StopChecks.ts`, `RouteDescriptors.ts`, the stage in `AreaMapPipeline.ts`, and `campaign/MapRoutes.ts` (`routeOffers`). Spec: [Area Map Generation](../specs/Area%20Map%20Generation.md), guarantee 10, stages 8 and 9, Routes, Seeds and determinism, Validation and retries; [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md), the run route screen, the drive, Racing the dark, and Stops. Follows [route-tree-and-pois.md](./route-tree-and-pois.md), whose legs and `routesTo` this reads, and runs on [map-pipeline-worker.md](./map-pipeline-worker.md)'s runner.

## Context

Maps 12 and 14 sit between the route tree and a playable run. The run loop (DDB-454, PR #201) drives a route's legs and their stops and shows each route's fuel, hours, and risk, from mock routes; it needs the real map's. Map 12 puts stops on the legs the POIs' routes use, and Map 14 describes each route the way the run route screen shows it.

Two of the inputs aren't built. Tiers in hours and territories are stage 8 (DDB-292), deferred for the MVP, and fog is DDB-294. So a leg's tier is a stand-in, territory is no one's everywhere, and every leg is charted. Like #202's, the tests run on `meshTesting`'s random meshes with a POI layer placed over them (`meshMap`). A map with no POIs has no legs, and gets no stops.

## The stage

`STOPS_STAGE` runs after the POIs, on the `stops` stream nested under the POIs' winning stream. It retries only itself, as the spec says the stops and dressing do: `localRetry`, so past its cap a debug build throws and a release build keeps the attempt with the fewest problems. The one exception is the fight floor (guarantee 11): the stage's `keepable` refuses an attempt with a `floor` problem, and with nothing else to keep, the map restarts on its next attempt. Its check is `checkStopLayer`'s hard rules, which read only the map's data and report every problem, which local retries need to rank attempts; its soft ones, a route outside its band or short of half its band on its own road, are in the layer's failures instead.

Every draw comes from a fork named for its use: each leg's from `fork('leg', id)`, its count and fight draws first and then three a stop, the Find: driver choices from `fork('finds')` and `fork('rates')`, the top-up's types from `fork('fill')`, and the contents' root from `fork('contents')`.

The product is plain data, which crosses the worker boundary by structured clone with the POIs: each stop with its leg, how far along it (`along` in world units and `at` as a share), its point, type, skulls, and the class and biome its type was drawn by; one profile per leg (its stops, tier, territory, length by class and by biome, its main highway, its middle); the contents' seed; how many stops the daylight check took off; and what it couldn't keep. A stop's id is its index in the map's stops, stable for a given map, as DDB-281's review asked: never a `Model.id`.

## Counts and positions (DDB-524)

A route's stops come to its destination tier's band, and its fights to the band's fights, from `stops.json`'s `bands` (Runs and Encounters, How many stops). Legs are shared, so the stage allocates over the route tree parents first, and every leg has one parent, so the stops behind a leg are the same on every route through it.

- A leg starts from what its road earns: its length of each class over that class's spacing, summed, times `stopDensity`, rounded up or down by a draw.
- That's clamped from above by its room at `tightGap` (12 units) and by the tightest route through it: its band's most, less what's behind, less the stops its own road still has to hold, its need (`ownRoadNeed`: the fight floor or half the band's minimum, whichever is more).
- And from below by the loosest route's band minimum, less what's behind and the room on its legs past this one; on a route's own road, by its need less the own road past it.
- Where the two cross, the upper bound wins and the route falls short of its band, which the layer reports. The POI stage only seats a POI whose routes' own road has room for the need (route-tree-and-pois.md, Own road), so the own road always takes it.

Fights are allocated the same way, after the counts and before any type: a leg earns its stops times the share of fights in its routes' bands (the least of them), rounded by a draw, clamped by the tightest route's fight ceiling less the floor its own road still has to hold, and lifted on a route's own road to the floor it still needs. A leg no single POI owns keeps at least one calm stop, and a leg holds no more fights than the rules let it.

Room and spacing are `StopRoom.ts`'s, which the POI stage seats on: a leg's stops sit a gap apart, half a gap in from the clearance at its ends, so a leg of usable road holds that over the gap, rounded down, where no junction is in the way. The stage takes the widest gap from `minGap` (40) down to `tightGap` the leg has room for, so short legs close up and long ones keep 40. Positions are by arc length along the leg's pieces: the leg inside its ends is cut into one slot per stop, and each aims at its slot's middle, moved by up to half the slot by a draw, to the nearest point in its slot a gap past the stop before and clear of every junction partway along the leg. Where a junction leaves a slot with no such point, the leg's stops pack from its inner end at the gap instead, which its room says fits. Points come from `legPoints` in one walk, and `checkStopLayer` checks the clearances.

## Dormant extras

Each route's own last leg also carries up to two dormant calm stops, one on from game stage 2 and one from 4 (`stops.json`'s `extras`). The allocator keeps room for them back on that leg from everything but the route's own-road need, so a band minimum it can't meet there falls to the legs behind it or goes short, and the extras take what room is left past the leg's stops at `tightGap`. The POI stage seats on the need alone, so a last leg with room for only its need gets no extras: over 30 maps, 21, 23, 33, 7, and 4% of routes by tier have none, and 10, 8, 15, 5, and 4% one, nearly all on last legs whose room is the need or one more, the rest thinned by daylight at tiers 2 and 3. Seating for the extras too would leave them on every such route at the cost of about a fifth of the POIs (586 seated over the 30 maps against 734). They take slots spread among the leg's stops, are listed apart in the leg's `extras` with each stop's `stage`, and no route reads them until game stage is kept (DDB-339), so the route card, departure, and the run all see stage 0 today. A calm stop added never breaks a per-route rule, so the rules that hold at stage 0 hold at every stage; the daylight check counts the extras on.

## Types and the stop tables

A stop's type is drawn from the stop tables by the class of the piece it's on, the biome at its point, its leg's tier, and its territory. The spec keys the tables on all four, and a full cross product would be 90 rows a territory. So the tables hold a weight per type for each class, and a multiplier per type for each biome, tier, and territory, 1 when left out; a stop's weights are their product. The shipped tables are `data/stopTables.json`, and a map's `stopTables` param replaces them whole.

The type comes in two draws: the allocation says which stops are fights, then the tables pick ambush or warband for a fight and a calm type for the rest. A type the run can't resolve weighs 0 whatever the tables give it, so a stop that does nothing is never placed: `RESOLVABLE_STOP_TYPES` in `StopData.ts` is the one list, today the fights, the three finds, and the wreck and distress the event screen resolves. Garages, hazards, checkpoints, and settler and vehicle finds keep their table weights for when their screens exist; adding one to the list turns it on.

The tables are read whole and compiled once, into cumulative sums for every class, biome, tier, and territory, over the fights and over the calm types the run resolves. A row with no fight or no calm type to draw fails when the tables are read, naming the row, not partway through some seed's map (DDB-281's review notes). The params' tables are compiled once per object, so a stage's retries don't compile them again.

Types: the spec's stop table with Find split by what it finds, since the Find: driver floor is per kind: ambush, warband, checkpoint, wreck, distress, garage, hazard, and the five finds. Uncharted isn't a type; it's what a fogged stop looks like. A fight's skulls are fixed with its type, 1 at tier 1 rising half a skull a tier times `dangerCurve`, rounded by a draw, a warband's one more, up to 3, since the route card shows risk before a stop is revealed.

## The per-route rules

No more than two fights in a row, and a non-fight in any three. Read literally the two are one rule. They differ if a checkpoint, which can turn into a fight, isn't a non-fight: then three stops of fights and checkpoints break the second rule and not the first, and the first still bites at three fights. That's the reading taken (a provisional call).

Routes share legs, so the rules can't be checked route by route as stops are drawn. They don't need to be. Every leg has one parent, so the stops behind a leg are the same on every route through it, and legs come parents first. Leg by leg from the compound out, carrying the last two stops behind each leg, the stage orders a leg's fights (`arrange`): of every arrangement that keeps the rules, the one ending on the fewest fights, then the most evenly spread, the earliest on a tie; a leg no POI owns ends calm wherever it can, so a route's floor fights can follow it. With no arrangement that keeps the rules it takes a fight fewer, which the floor check catches. `checkStopLayer` walks every route to every POI again.

The checks gain the band and floor rules: `floor`, every route's fight floor, all of it on its own road, hard and never kept; `fightBand`, no more fights than the band's most, hard; `extras`, a dormant extra calm, on a stage the tuning has, on a route's own last leg, hard; and `band` and `ownRoad`, a route's stops in its band and half its band's minimum on its own road, soft.

Two facts the later steps lean on: turning a stop calm, or adding a calm one, never breaks a rule; and taking away a fight or a checkpoint never does either.

## Find: driver

First a soft rate per tier: at least `rates[tier]` of a tier's stops, rounded down, are Find: driver (0 in tiers 1 and 2 and 4% beyond, shipped), again after the top-up below adds stops. Then the floor: at least `driverFinds` in tiers 1 and 2. Each shortfall turns a calm stop into a Find: driver, never a fight or a dormant extra, an event first, then another find, on a leg with none yet where it can, picked by a draw among the best. Where the floor's legs hold too few calm stops to turn, a Find: driver goes into the gap where it can stand furthest from the stops either side, at least `tightGap` from each, clear of junctions, and only on a leg where every route is under its band's most. Only a map with legs but none in tiers 1 and 2 misses it, and says so in the layer's failures.

## The daylight check

Guarantee 10: every POI in tiers 1 to 3 has a route whose estimated run fits in `daylightHours`: twice its driving hours (out, and home down the cleared road), its stops' hours, and the objective's.

The spec has a failure rerun the stage with fewer stops on the offending routes. A rerun on a fresh stream knows nothing of which routes failed, so the stage does the thinning itself, after placing and before its check: a POI with no route home by dark sheds stops from its quickest route, its extras first, then its calm stops, then a Find: driver, then a fight above every floor; within each, one whose going leaves every route through its leg in its band first, on legs fewer routes share, then the costliest in hours, the furthest out first, until the estimate fits. A calm stop goes only where every route through its leg keeps the rules without it, and a fight only where every route through its leg keeps its floor, on its own road too. A Find: driver goes only where the floor and its tier's rate still hold, or by moving to the widest gap on another leg of its tiers, off this route and only onto a leg where its half hour tips no POI that's home by dark past it. Without that last rule two POIs could hand one find back and forth. Thinning only takes stops away and a moved find never tips anyone, so a POI that fit still fits; the check still makes up to four passes, in case.

A POI that can't get home by dark carrying only its fight floor can't be mended by stops, and the floor is hard. The POI stage tiers such a POI 4 by the same estimate (call 261), so on a real map it doesn't come up; a layer built some other way still lists a POI past dark with no stops at all in its failures, and the check lets it through. Anything else the check finds fails the stage, which retries on its next stream.

Thinning shared road can leave other routes under their band. After the daylight check, a route under its band's minimum takes calm stops back on its own road, drawn on `fork('fill')`, where its own legs have room at `tightGap` and the stop tips no POI home by dark past it; where they have no room, or the stop would tip one past dark, its latest dormant extra turns on from the start instead, which the daylight check already counted, on a leg where every route is under its band's most. Over the 30 `gen` maps it leaves 0, 0, 3, 1, and 0% of routes under their band by tier, where thinning alone left about a fifth to two fifths; the 3% left at tier 3 are the ones daylight holds down.

## Contents

`rollStop(map, stopId, roll)` rolls a stop's contents when the run reveals it, from `stop:<id>` at the roll count, forked from the layer's contents seed: the same stop and roll always give the same contents, and a cleared leg's stops reroll when the count goes up. The contents are plain JSON, so the save can keep a revealed stop's (call 12 in [gameplay-calls.md](../gameplay-calls.md)): the stop, the roll, its type, its hours (a hazard's rolled between half an hour and two), a seed for the run to draw the rest from (a fight's raiders, a found driver, an event's outcome), and for a hazard its kind, for a supplies find its haul. Each field draws on a fork of its own. Everything else a stop holds belongs to the run controller (DDB-322), which draws it from the seed.

## Route descriptors

`describeRoutes(map, poi, { knowledge })` gives each of a POI's routes, quickest first, as the run route screen shows it, from the POI layer, the stop layer, and the dressing's route numbers:

- Name: from the route's own road, the legs no other route to the POI uses, since that's what tells routes apart. A biome with a name ("Through the mire") where it covers half of that road, or else the dominant class's: "Route N highway", N the route number on the shields of that road's main highway (below), "Back roads", "Trails". Two routes to one POI that come out alike get the side they come in from, "Back roads from the north", and any still alike their letter.
- Knowledge: the least known leg, by a function from leg to charted, rumored, or uncharted that defaults to charted everywhere until fog exists.
- Stops as far as known: a charted leg's with their types, a rumored leg's as stops of unknown type, and from the first uncharted leg on, a direction and the next stop, as the spec has it: every leg past it counts as uncharted.
- Hours: out is the drive plus the known stops' hours, with unknown types at three quarters of an hour and an uncharted leg's at what its road would earn; at the objective, 1.5 hours, 2 at a stronghold; home is the drive alone. `estimated` says when any leg isn't charted.
- The return against dark: the hour it's back, leaving at 06:00, dark at dawn plus `daylightHours`, and the spare daylight, below 0 past dark.
- Fuel: a unit per 150 units of road, out and back, at least one, the mock routes' rate.
- Risk: the worst known fight's skulls, 0 with none known.

### POI names

POIs take their names from Map 6's places (`map/PoiNames.ts`, DDB-472): a town's or village's name and the POI type's label in title case, "Elk Creek Clinic". A place lends its name within a quarter of the map's radius of it (`PLACE_REACH`, the towns' spacing); a POI with no town or village that near keeps the stand-in it had, its type and bearing from the compound, "Clinic, north-east". A stronghold is its faction's, "Mire-Crawlers stronghold", whatever stands near it. The metro, crossroads, and exits have no names to lend.

Pairs of POI and place within reach are taken nearest first, so where two clinics are near Elk Creek the nearer is Elk Creek Clinic and the other takes the next place in its reach without one. One whose places in reach all have one is numbered after the nearest, "Elk Creek Clinic 2", and so is any stand-in another POI already took. On the campaign maps `rollParams` makes from seeds 1 to 6 (radius 900 to 1200), 142 of 176 POIs, about four in five, had a town or village in reach; the nearest lay 7 to 667 units off.

The names are worked out on read, from the POI and places layers alone, and take no draws: generation makes the same map it did, so the generator version stays where it was, and since a load makes the map again from its seed and attempts, the names come back with it and nothing about them is saved. `mapPoiNames(map)` works them out once a map, and the area map, the run route screen, and the run's routes (`routeOffers`) all read it, so a POI is named alike everywhere. A route the run set off on keeps the destination name it was saved with, so a save made mid-run before this change shows the old name until the run is home, and the log keeps what it said.

### Highway route numbers

A highway route takes its number from the highway's shields (DDB-499), so the route card's "Route 47 highway" is the 47 the shields along it carry, the labels the dressing places (`MapLabels.ts`) and the area map will draw once it draws shields (DDB-447). The highway is the main one of the route's own leg with the most highway on it, each leg's main highway being the one with the most length on that leg (`LegProfile.highway`), by its stretches' `highway` index, the order of its exit among the highway exits; where highways merge into a trunk, the trunk's stretches keep the first one laid's, for the shields and the name alike; the number is `dressing.routeNumbers[highway]`, which the dressing draws 2 to 99, none twice, on its `routes` fork. Two routes on one highway both take its number and are told apart as any two alike are, by the side they come in from, then a letter.

The numbers aren't saved and needn't be: the dressing is a stage like the rest, so a load that makes the map again from its seed and attempts makes them again with it, on the same fork of the same stream, and every map a screen or the run gets is a whole generation with its dressing. So `RouteMap.products` takes the dressing (`dressing?: Pick<Dressing, 'routeNumbers'>`) beside the places, and the area map, the run route screen, and the run's routes (`routeOffers`) read the one map they're handed. Working them out without the dressing would mean replaying its stream's forks from the root, which needs the map attempts and every stage's attempt; the generation already has the answer, so the descriptors read it. A map without a dressing, which is only a test's mesh, numbers a highway by its index plus one, the old rule.

Generation doesn't change, since the descriptors only read what the dressing already made, so the generator version stays where it was and old saves load as they did. A route the run set off on keeps the name it was saved with, so a save made mid-run before this change shows the old number until the run is home.

## Route descriptors in the C++ alpha

`libs/rules/map/RouteDescriptors` (2026-10-31, DDB-571) is the part of a descriptor that generation fixes, before stops or knowledge exist: each of a destination's routes, quickest first, with its legs, name, class and biome, length, hours of driving one way, and fuel, by `describeRoutes({network, routeLegs, destination, biomeAt, tuning})`. The names are as above, from the route's own road, and calls 11 and 12 stand. What differs:

- A highway's route number is the roads' (`RoadNetwork::routeNumbers`), drawn on the roads stream's `numbers` fork, 2 to 99, none twice, one per highway (gameplay call 162's rule), where the TypeScript's dressing drew it on its `routes` fork. A route's name is what the run route screen and the log show, and nothing the dressing makes may reach gameplay (guarantee 9). So the descriptors read the gameplay map alone, need no index-plus-one stand-in for a map without a dressing, and the shields, once the dressing draws them, read the same numbers. Call 18 stands, with the network's number in place of the dressing's. `checkRoadNetwork` checks every highway has one, in range, and no two share one.
- `routes.json` is read strictly, and reshaped to what the descriptors read: `unitsPerFuel`, and `names` with `biomeShare`, `biomeStep`, the biome names, and the class names. `biomeStep` moved in from `stops.json`, since only the leg profiles routes are named by sample with it. `unknownStopHours` and `dawn` moved out to `stops.json`, beside the stop and objective hours a route's estimate sums them with. A biome left out never names a route; every class has a name, and the highway's holds `{number}` once and no other's does.
- The biomes come through `biomeAt`, the ground's or a test's, and each own leg's profile is worked out on read (route-tree-and-pois.md, The route tree in the C++ alpha).

What a descriptor reads from the stops comes with the stops stage: knowledge, stops as far as known, hours out, at the objective, and home, the return against dark, risk, and whether it's estimated, as Route descriptors above has them, and `routeOffers` over all of it.

## The run loop's routes

`routeOffers(map)` gives every route on the map in the run loop's route model (`RunRoute`, with its `RouteDestination`, `RouteLeg`, and `RouteStop`), POI by POI. Ids come from the map's own (`poi-3`, `route-3-1`, `leg-12`, `stop-40`), so a map gives the same routes however often it's asked, which `departRun`'s check that a route is on offer needs. A run carries every stop on its legs, whatever the route card knows. Fights are fights with their skulls, and every other stop is a quiet stretch (call 70) until the run has screens for events, finds, garages, and hazards. Hours are rounded to tenths and lengths to whole units, as the run shows them. Risk is the route card's, with 1 for a route with no fight, since the model's risk runs 1 to 3. A destination yields what its POI's type does (`data/pois.json`), in place of #201's tier ranges; meds aren't among the run's yields yet, so they're left out, and a stronghold yields nothing until it has rules of its own.

The area map screen (DDB-43) picks the POI, and the run loop's `routesOnOffer({ map })` offers every route `routeOffers` gives on the campaign's map but a stronghold's ([area-map-route-pick.md](./area-map-route-pick.md)). `offersForDay`, which stood in for the screen with a day's two or three destinations, went with it.

## Measured

Random meshes at radius 1000, 80 to 90 units apart, 34 POIs and 125 to 130 legs each, shipped tuning, 14 hours of daylight: 131 to 158 stops a map, 4.6 to 5.7 a route on average and 11 at most; the daylight check took 13 to 36 stops off; 0 to 3 tier 3 POIs a map ran past dark with no stops. Placing them took 2 to 5 ms in Jest after a first map of 12 ms. On the road graph's maps (Maps 7 and 8), about 145 stops a map at radius 900 and 185 at 1200.

## Provisional calls

Calls the spec left open, made the simplest way consistent with it, for Kevin to approve or adjust. The tuning numbers are starting values for the Map Lab.

1. A leg's count is rounded up or down by a draw on its fraction, then allocated to the routes' bands as Counts and positions has it; the gap between a leg's stops closes from 40 units to 12 only as far as its count needs.
2. Spacing per stop: highway 150 units, back road 120, trail 100. Clearance 15 units from a leg's ends and 8 from a junction partway along it, a node where three or more roads meet; jitter half a slot.
3. Stop tables as class weights times biome, tier, and territory multipliers; the shipped weights in `data/stopTables.json` (highways lean to ambushes and checkpoints, trails to hazards, mire triples hazards, no warbands in tier 1, no one's ground halves checkpoints).
4. A checkpoint isn't a non-fight for the per-route rules.
5. A fight's skulls are fixed with the map: 1 at tier 1, half a skull more a tier times `dangerCurve`, rounded by a draw; a warband one more; at most 3.
6. Find: driver at no set rate in tiers 1 and 2 beyond the floor, and at least 4% of the stops in tiers 3 to 5; a stop turned into one is an event first, then another find, never a fight; the floor adds stops where it must, under every route's band.
7. Stop hours for the estimate: fight 1, warband 1.5, event, find, and checkpoint 0.5, garage 1, hazard 1 (its contents roll 0.5 to 2); the objective 1.5, a stronghold's 2.
8. The daylight check thins inside the stage, the POI's quickest route only: extras, then calm stops, then a Find: driver, then a fight above the floor; stops whose going keeps every route in band first, then own legs, then the costliest, then the furthest out; it moves a Find: driver it can't spare (call 264).
9. Contents: a hazard is a storm, radiation, a sinkhole, or a flooded underpass; a supplies find is one resource, 2 to 5 food or water, 1 to 3 fuel, 1 to 2 meds, or 5 to 15 scrap.
10. A leg's tier is the lowest tier of the POIs whose routes use it, with POIs on the ring + 1 stand-in (or 4, call 261); every stop is on no one's ground.
11. Route names come from the route's own road; a biome names it at half of that; highways are numbered by their index + 1 (replaced by 18); duplicates take the side they come in from, then a letter.
12. Fuel is a unit per 150 units of road, out and back, at least one; an unknown stop counts three quarters of an hour; a run leaves at 06:00.
13. Risk is the worst known fight; the run's is at least 1.
14. Every stop that isn't a fight or a find runs as a quiet stretch until the event screen resolves wrecks and distress signals; only resolvable types are placed (DDB-524).
15. A day offered a tier 1 destination and up to two from tiers 2 and 3; the area map replaced the day's offer (area-map-route-pick.md, call 89).
16. A POI's name is a town's or village's within a quarter of the radius and its type's label in title case, "Elk Creek Clinic", nearest pairs first, the next place in reach for a second POI of a type, then a number; with no place in reach, its type and its bearing from the compound (DDB-472).
17. A destination yields its POI type's food, water, fuel, and scrap; meds wait for the run to carry them, and a stronghold yields nothing yet.
18. A highway route is numbered by its highway's shields, the dressing's route number for the main highway of its own leg with the most highway; a map with no dressing, only a test's mesh, keeps index + 1 (DDB-499).
19. A leg earns fights at its routes' bands' share of fights, the least of the routes through it, rounded by a draw; the floor goes on a route's own road, and a leg no POI owns keeps a calm stop (calls 262, 263).
20. A route left under its band's minimum after the daylight check takes calm stops back on its own road, or turns on its latest dormant extra (call 265).
21. A route's own last leg keeps room for its dormant extras back from everything but its own-road need; they're spread among its stops, the first on at game stage 2 and the second at 4 (call 266).

## Consequences

- The run loop's `routesOnOffer` reads `routeOffers` over the campaign's map in place of its mock; the state machine doesn't change.
- Stage 8 (DDB-292) replaces two stand-ins: the leg tier, where its tiers in hours become the stops' tiers, and the territory, which the tables already key on.
- Game stage (DDB-339) reads a route's extras at the campaign's stage; nothing reads them today.
- AREA_MAP_GENERATOR_VERSION went to 7 with the allocator, so a campaign saved before it is outdated and won't load.
- The map validator (DDB-296) runs `checkStopLayer`; the Map Lab (DDB-299) can show stops by type and the readout's stops by type from the layer.
- Knowledge (DDB-294) passes its leg states to `describeRoutes`; the descriptors already show rumored and uncharted legs.
- The save (DDB-436) keeps stop ids as they are, and a revealed stop's contents from `rollStop`.
