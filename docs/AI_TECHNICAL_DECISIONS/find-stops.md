# Find stops: cards, supplies, and a driver (DDB-523)

Date: 2026-10-18. Code: `src/renderer/game/campaign/SupplyRoutes.ts` (the `find` stop kind), `MapRoutes.ts` (`routeStop`), `SupplyRun.ts` (`takeFind`, `leaveFind`, `foundDriver`, recruits in `arriveHome`), `SupplyRunState.ts` (`recruits`, the reward phase at a Find: cards), `SaveUpgrades.ts` (version 10), and `screens/run/RunScreen.ts` and `runText.ts`. Specs: [Runs and Encounters](../specs/Runs%20and%20Encounters.md) (Kevin's rule 2, What a stop can be) and [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (Stops, The driver pool). Builds on [mvp-supply-run.md](./mvp-supply-run.md), [stops-and-routes.md](./stops-and-routes.md), and [cards-won.md](./cards-won.md).

## Context

The stops stage already places every calm type, finds among them, and `routeOffers` turned everything that wasn't a fight into a quiet stretch, a step where nothing happens. Kevin's rule 2 (no empty steps) and the stop bands need the first calm stops to be real. The spec names the cheapest three: Find: cards through the fight reward's picker, Find: supplies from the haul `rollStop` already rolls, and Find: driver, which the map's guarantee 7 puts within tiers 1 and 2. Events, wrecks, garages, hazards, settlers, and vehicles wait on screens of their own (DDB-330).

## The route model

`RouteStop` gains a third kind, `find`, with what it finds: `cards`, `supplies` (carrying its haul, a resource and an amount), or `driver`. `routeStop` makes it from the map's `findCards`, `findSupplies`, and `findDriver`; every other calm type stays a quiet stretch until the run can resolve it. Nothing on the map changes, so today's maps get their finds as they stand.

A haul is rolled when the route is offered, from `rollStop` at roll 0, and the run carries it in its saved route, so a load never rolls it again, as the spec asks of a revealed stop. The cards and the driver are drawn when the run takes them, on the run's own stream for the stop, as a fight's raiders and reward are: cards from `fork('reward', stop)` through `rollRewardCards`, a driver from `fork('find', stop)`.

Options considered for the haul: rolling it when the run reaches the stop, which needs the map at run time, where nothing else on the road does; or rolling it into the route (chosen), which keeps the run self-contained and makes the haul visible the moment the route is offered, which the route card can show once fog decides what's known.

## Taking a find

A find is a choice (call 183): take it, or drive on. On the run screen the find's step says what's there, with its take button as the highway and Drive on as the back road.

- Find: supplies: the haul goes into the cargo, and the run drives on.
- Find: cards: the run stays at the stop in the reward phase, which now opens at a fight or at a Find: cards, and the picker works as after a fight: one card into the cargo, or none, then on. The reader refuses a reward anywhere else.
- Find: driver: `foundDriver` says who's there. The first missing driver in pool order who can be found comes back through `Campaign.findMissingDriver` and rides home in `foundOnRun`, as the spec always meant a missing driver to. With nobody missing, it's someone new, of the unlocked archetype the compound has fewest living drivers of, counting anyone already riding home, drawn among ties on the stop's stream. Someone new rides home in the run's `recruits` and joins the pool through `recruitDriver` when the run gets home (`arriveHome`, which logs it and returns them on the `Arrival`); a failed run loses them with its cargo.

Driving on from a find (`leaveFind`) takes nothing and moves to the next stop.

Options considered for someone new: recruiting them on the spot, which needs nothing saved but leaves a driver at the compound who was never brought there, and safe from a run that fails; or a pending recruit on the run (chosen), the same rule a found missing driver already follows.

## Saving

`SupplyRun.recruits` is new, so the save format goes to version 11. Version 10 saves load: a run out in one never found anyone new, so the upgrade step gives it no recruits. A route saved by an older build has no finds, and reads as before.

## Provisional calls

None of these is in a spec. They're calls 210 to 214 in [gameplay-calls.md](../gameplay-calls.md).

1. Taking a find costs nothing yet. Call 183 makes the stop's hours the price, and the run doesn't keep its clock on the road yet, so until it does a find is a gift, and the spec's open question 4 stays open.
2. A Find: driver turns up the pool's first missing driver who can be found, and only with nobody missing someone new, of the unlocked archetype the compound has fewest living drivers of.
3. Someone new rides home with the run and joins the pool there, lost with the run if it fails, as a found missing driver is.
4. A Find: cards is the fight reward's picker and pool: three cards at the drop rates, the one picked riding home as cargo.
5. A Find: supplies haul is the stop's rolled contents, one resource in the stop tuning's range, meds included, since the cargo carries meds though POI yields don't.

## Consequences

- The run's clock (Racing the dark) turns call 1 into a real price: a take spends the stop's hours.
- Fog decides how much of a find the route card shows ahead of the run; the haul is already known to the route.
- Stop clearing (DDB-336) clears a find whether it was taken or left, and a reroll after the cooldown is a new haul at the next roll.
