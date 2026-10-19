# Clearing: stop cooldowns and cleared POIs (DDB-336)

Date: 2026-10-18. Code: `src/renderer/game/campaign/MapClearing.ts` (the state and its rules), `MapState.ts` (its reader), `SupplyRun.ts` (`routesOnOffer`, `arrivedAt`), `SupplyRoutes.ts` (a stop's `cleared`, `routeStops`, `everyStop`), `MapRoutes.ts` (`stopOf`, `routeStop`), `DayClock.ts` (`DAY_END_HOOKS.stopCooldowns`), `SaveUpgrades.ts` (version 11), and the screens: `screens/area-map/` (`planningMap.ts`, `areaMapText.ts`, `AreaMapScreen.ts`), `screens/run-route/RunRouteScreen.ts`, and `screens/run/RunScreen.ts` with `runText.ts`. Specs: [Runs and Encounters](../specs/Runs%20and%20Encounters.md) (Kevin's rule 5, Clearing), [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (POIs, Fog of war), and [Area Map Generation](../specs/Area%20Map%20Generation.md) (What changes after generation, Saving). Replaces poi-depletion.md (DDB-483), whose shares and refills are gone; builds on [find-stops.md](./find-stops.md), [day-clock.md](./day-clock.md), and [campaign-save-and-load.md](./campaign-save-and-load.md).

## Context

Kevin's rule of 2026-10-17: a run clears its POI, so there's no reason to go back, and a cleared POI is disabled for the rest of the campaign, since nothing refills a looted building. Cleared ground doesn't come back right away: a stop a run resolves stays cleared for a cooldown (5 days), then comes back with its contents rerolled. Until now every stop was there for every run, and POIs held three shares that refilled over 20 nights.

## The state

Both halves live in the campaign's map state (`Campaign.map`), which a load never regenerates:

- `stops`: one entry for each stop cleared now or rolled again since, in stop order, `{ stop, roll, cleared }`, where `stop` is the map's stop index, `roll` how many times it has come back, and `cleared` the day a run cleared it, or null once it's back. A stop with no entry was never cleared and rolls at 0, so a fresh map state is still `{}`.
- `clearedPois`: the POIs runs have reached, in order.

The reader refuses an entry out of order or twice, one that's neither cleared nor rolled again (that's no entry), and an empty list (that's the field left out), so each state has one way to be written. The campaign's reader also refuses a stop cleared after its day, which no run could have done, and the map state refuses the retired `pois`. Rolled contents aren't saved beside the roll: `rollStop` gives the same contents for the same stop and roll, and a run carries what it rolled in its saved route (find-stops.md), so the save already keeps a revealed stop's contents where they're used.

## Clearing

A run clears a stop when it moves past it, in the same `set` that moves it on (`arrivedAt` with the stop passed): a quiet stretch driven, a find taken or left, a fight's reward picked or skipped, which is the end of a won fight. It's cleared on the campaign's day, the day the run is out. A fight the run loses isn't cleared, since its raiders are still there.

Reaching the POI loads its type's whole yield into the cargo and clears the POI in the same step, as call 105 had the share, so a run that fails on the way home has still cleared it (calls 187, 188).

A stop or POI whose id isn't the map's (a run saved before the real map, as the fixture's is) clears nothing.

## Coming back

The day end's `stopCooldowns` hook (`DAY_END_HOOKS`) brings back every stop whose cooldown is up by the next dawn: one cleared on day 3 is back at the dawn of day 8, `STOP_COOLDOWN_DAYS` (5) later, its roll up one. The `poiRefills` hook is gone: a cleared POI never comes back (call 186), so the hooks are stops only.

## The offer

`routesOnOffer` drops every cleared POI's routes, so it can't be planned or departed for. On the rest it marks a stop still cleared `cleared: true` and gives a stop that's come back its contents at its roll (`routeStop`; only a Find: supplies haul has any yet). `routeStops`, the run's steps, leaves the cleared ones out, so a run drives past them without a step, and `everyStop` keeps them for the screens. A route with a stop cleared takes its risk from the fights it still meets. As before, the offer is worked out once a map and once a map state, and a route with nothing changed is the same object as in the full offer.

Options considered for driving past a cleared stop: taking it off the route altogether, which loses it from the route card and the run's road list, where the spec wants it shown cleared; a skip step the run takes (`passClearedStop`), which is the empty step rule 2 forbids; or a flag the step list filters (chosen), which keeps the run's state machine counting steps as it always has.

## The screens

- Area map: a cleared POI draws with the view's depleted marker, grey and struck through, its row dimmed, its details "General store, tier 1, cleared" and "Picked clean, and nothing fills a looted building again.", and Plan a run here is off with the reason. The shares line is gone.
- Run route screen: a stop the run would drive past reads "Raider ambush, 2 skulls: cleared, back in 3 days", dimmed, and the card's line counts them apart ("2 stops, 1 cleared") with the risk of what's left. With no POI handed over it opens on the nearest one not cleared, and a cleared one says why it can't be planned.
- Run screen: the road lists a stop cleared before the run as Cleared, numbered in place. The debrief's stamp is LOOTED for the POI the run cleared, unless a driver came home hurt, whose tear takes the one hero mark; DEPLETED is no longer struck.

## Version 11 saves load

The map state changed shape, so the save format goes to version 12. Version 11 saves load (`SaveUpgrades.ts`): a POI with an entry in the old `pois` stock had a run reach it, which clears it now, so its index goes into `clearedPois` and the stock goes; no stop is cleared, since nothing kept stop state. A POI that had refilled had dropped its entry, so it reads as never reached; nothing in the save tells it apart. The old stock is held to version 11's own reader first, so a damaged one is damage, not a guess. A run out keeps its route as saved; its POI clears when it gets there.

## Provisional calls

None of these is in a spec. They're calls 215 to 219, 221, 222, and 260 in [gameplay-calls.md](../gameplay-calls.md); 186 to 188 are the clearing rule itself.

1. A run clears a stop when it moves past it, a find left by the road and a fight won included, on the day of the run; a fight it loses isn't cleared.
2. A cleared stop is back at the dawn five days after the day it was cleared, its roll up one, and only a haul rerolls yet, since a fight's raiders and a find's cards and driver come from the run's own stream.
3. A route with stops cleared keeps the map's fuel and hours, which then overestimate a little, and takes its risk from the fights it still meets.
4. A cleared POI draws with the map's depleted marker and dimmed row, its details say cleared, and its Plan is off.
5. Version 11 saves load with every POI that still had stock taken cleared, a refilled one reading as never reached, and no stop cleared.
6. The save keeps a stop's roll and cleared day, not its rolled contents, which `rollStop` gives again from the roll (call 221).
7. The debrief stamps the POI the run cleared LOOTED, after an injured driver's tear (call 222).
8. A failed run clears nothing, neither its stops nor its POI, so a retry within the cooldown meets the same fight stops (call 260, replacing 188's failed run clearing its POI). The raiders still hold the road, and the failed run lost its cargo, so the POI's yield is still there; the yield and the clearing stay together.

## Consequences

- The POI stage's spacing (DDB-529) is what keeps a neighbor's cleared road from emptying a route; until it lands, a route that shares most of its road with a run from the day before can be short.
- The run's clock (Racing the dark) should take hours off a route for the stops it drives past, which call 3 leaves for then.
- The objective (Compound and Supply Runs, The loop, step 6) moves the yield and the clearing from reaching the POI to winning it, together.
