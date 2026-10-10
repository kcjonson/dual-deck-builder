# MVP supply run: pick a route, drive its stops, fight, come home (DDB-454)

Date: 2026-10-10. Code: `src/renderer/game/campaign/SupplyRun.ts` (the run's steps), `SupplyRunState.ts` (the saved state), `SupplyRoutes.ts` (the route model), `Encounters.ts`, `RunRewards.ts`, `Seating.ts` (`getCrewRule`), `Campaign.ts` (`supplyRun`, a one-seat `startRunDecks`), `mechanics/Raiders.ts`, `mechanics/Battle.ts` (`forfeit`), and `screens/run/RunScreen.ts`, `screens/run/runText.ts`, with the end hook and the abandon menu on `screens/combat/CombatScreen.ts` and `next` on `screens/battleResult/BattleResultScreen.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The loop, The drive, Return, A failed run, Stops) and [Area Map Generation](../specs/Area%20Map%20Generation.md) (The route tree, POIs, Stops, Routes). Builds on [combat-bridge.md](./combat-bridge.md), [cards-won.md](./cards-won.md), [run-decks.md](./run-decks.md), [day-clock.md](./day-clock.md), [injuries.md](./injuries.md), [campaign-end.md](./campaign-end.md), [solo-driver-fights.md](./solo-driver-fights.md), and [seeded-prng.md](./seeded-prng.md).

## Context

Every piece under a supply run existed (run decks, the combat bridge, cards won, the day clock, the infirmary, the campaign's end) and nothing strung them together: the compound's Plan a supply run was disabled, the battle result's Continue went to the menu, and no save held a run on the road. The full run controller waits on the realistic map's route tree, POIs, stops, and route descriptors. This is the playable loop in the meantime, built so the map replaces a data source and not the loop: the compound, a route pick, the drive, home or a failed run, and Continue in the middle of it. The compound, load out, and the post-run screens are deliberately thin; the map and the run controller are where the work goes next.

## The route model

Routes take the shape the map will hand over, so swapping the source is a data change:

- `RouteDestination`: the POI a route arrives at, with an id, a name, a tier, and a yield of food, water, fuel, and scrap (Map 10's POI types and yield tables replace the yield).
- `RunRoute`: one of a POI's routes, its descriptor (Map 14): a name from its dominant class, its fuel, its hours (out, at the objective, home), and its risk, the worst fight in skulls, over an ordered list of legs.
- `RouteLeg`: a piece of the route tree between places where routes split or end, driven outward (Map 9), with its road class, length, driving hours, and stops in the order a run meets them.
- `RouteStop`: a kind (`fight` with its skulls, or `quiet`; events, finds, garages, and hazards later) and `at`, its position along the leg from 0 to 1 (Map 12). A fight's raiders are its contents, rolled when the run reaches it (`encounterFor`); its kind and skulls are fixed with the map.

A run counts its place along `routeStops(route)`, every stop on every leg in driving order, so a leg boundary changes nothing in the state machine.

The routes came from a seeded mock (`supplyRoutes`) until the area map's own replaced it: `routesOnOffer({ map })` now offers every route the campaign's map has but a stronghold's, and the area map and run route screens replace the route pick ([area-map-route-pick.md](./area-map-route-pick.md)). A destination yields what its POI type does, and a route's fuel, hours, and risk are its descriptor's ([stops-and-routes.md](./stops-and-routes.md)).

`Encounters.ts` is the stand-in encounter table, one per skull count: one Rust Buggy, two of them, and a Rust Buggy beside the Raider archetype's Spike Buggy. The raiders are profiles in `mechanics/Raiders.ts`, which the combat screen's own skirmish raider shares, so the two can't drift: the Rust Buggy starts a fight at 3 adrenaline and refills to 10 each turn.

## The run's state

The run on the road is the campaign's `supplyRun`, saved with it, so a checkpoint writes the run and the campaign together and a load can't find one without the other. It holds the route as it was rolled (a load never rolls it again, as DDB-402 asks of revealed stops), the stop the run is at, its phase, the escorts still with it, and the cargo and cards won. Two things in the RunParty aren't kept twice: the seats are the run decks' drivers in seat order, and the run's id is `Campaign.currentRun`; `runParty` puts the party back together for the bridge.

The phase is `driving`, toward the stop (or home once every stop is behind it), or `reward`, at a won fight with its card to pick. The stop counts past the last one when the run reaches its destination (`atDestination`), and the step that gets it there loads the destination's yield into the cargo in the same `set`, so the yield is cargo for the drive home and a failed run would lose it. A fight under way isn't saved. Starting one changes nothing in the save, so a reload finds the run driving to that stop, and the fight replays from the same stream, `fork('fight', stop)` off the run's own (`fork('run', n)`), with the same raiders and the same opening hands. The reward's cards come from `fork('reward', stop)` the same way, so a reload offers the same three.

`supplyRun` is null at home and while a load out is under way, and the run's end clears it with the run decks: `unloadRun`, `loseRun`, and `unwindRunDecks` each set it to null in their one `set`. The campaign's reader refuses a run on the road with no run decks, checks the route, the stop against the route, a reward only at a fight, the escorts against the convoy, and the cargo with the stores' own reader. `toSaveText` checks the escorts are still in the convoy, since a fight's write-back lets lost ones go outside the campaign's checks. The save format went to version 7 for it (8 since, with the map's attempts, [campaign-save-and-load.md](./campaign-save-and-load.md)), and the fixture (`campaign-v8.json` since) has its run on the road at its last fight's reward.

Options considered for where the state lives: a second storage key beside the campaign (two writes that could land apart, against one save written whole); the state as opaque JSON on the campaign, read by the run module (a damaged run would load and fail later, on the run screen); and the RunParty saved whole with its seats and run id (two copies of facts the run decks already hold, and one more thing to agree).

## Who goes

`getCrewRule` (Seating.ts) reads who's ready at the compound, after DDB-432 #35: a pair of different archetypes while two such are ready, the no-duplicate pair rule as before; a pair of one archetype when every ready driver shares it; one driver alone when only one is ready; nobody otherwise. `getSeatBlocker` refuses a same-archetype pair only under the first, and `startRunDecks` takes one seat only under the third, so the bridge's one-seat fights (solo-driver-fights.md) are reachable. A pool that only grows on runs can no longer lock itself out.

## The loop

- **Plan.** The compound's Plan a supply run opens the area map, off with its reason (`getPlanBlocker`) once the campaign is over, while a run is out, when nobody at the compound can go, when the map offers no route, or when the stores hold less fuel than its cheapest route.
- **Load out.** Stubbed until its screen exists: `quickLoadOut` seats the crew `seatableCrew` picks by the crew rule, in pool order, on their default decks, with every escort in the convoy (up to four, their cards to Driver 1), through `startRunDecks`. It's the one call a load out screen replaces.
- **Departure.** `departRun` finds the route the campaign's map offers by its id first, so what it checks is what it pays, then pays the fuel and puts the run at its first stop, in one `set`. It refuses (`getDepartBlocker`, a `DepartRuleError`) once the campaign is over, while a run is on the road, and on too little fuel, and throws with no run decks started, for a route the map doesn't offer, and for escorts that aren't the ones whose cards are in the run decks. If it refuses after load out started the run decks, the run route screen unwinds them.
- **Stops.** A quiet stretch passes (`passQuietStop`). A fight starts through the bridge (`startStopFight`) and goes to the combat screen. `PreparedCombat` takes an end hook, `onEnded`, which the combat screen calls as the battle ends and whose result it hands the battle result screen. The run's hook writes the fight back (`finishStopFight`) and checkpoints before the result shows, so quitting on the result screen loses nothing; `BattleResultData.next` then sends Continue back to the run screen, with the checkpoint, so the run screen can say a save failed. A skirmish brings no hook, and its Continue still goes to the menu.
- **Abandoning a fight.** A run's fight brings `abandonWarning`, which turns on the combat screen's menu: "Abandon the run?", behind a confirm whose focus starts on Keep fighting. Confirming calls `Battle.forfeit`, which ends the fight lost; the bridge reads a driver still aboard a lost fight as missing, fled, and the run fails the way any lost fight fails it. The warning names who flees and, when they're the last drivers the compound has, says the campaign ends with them; the battle result's line (`BattleResultData.subtitle`) says the crew abandoned the fight rather than that the vehicles were destroyed. Fights that stall (raiders that never close range, and no turn limit) always have a way out.
- **Reward.** After a win, three cards from the reward pool, each a rarity drawn at Card System Design's drop rates and then a card of it, no card twice, never an escort's signature card, and order cards only while the convoy has an escort. One is picked (`addCardsWon` on the write-back's party, as cards-won.md says) or the reward is skipped, and the run drives on. With the cards failed to load, the reward waits, saved, until they load.
- **The destination.** The step past the last stop reaches it and loads its yield into the cargo.
- **Home.** `arriveHome` logs what the run brought ("Home from Red Mesa Silos with 6 food, ..."), unloads the run (`unloadRun`), injures its drivers hurt (`injureOnArrival`), counts a run for each seat (`runsCompleted`), and ends the day. The run screen's one line says what was unloaded, who came back with the run, who's still injured after the night, and the night (`dayEndReport`).
- **A failed run.** `finishStopFight` logs who died and who went missing by name, loses the run (`loseRun`, which logs the cargo), then ends the day unless that ended the campaign, as campaign-end.md planned. The battle result's Continue brings the failed run's report to the run screen, which goes on to the compound, or to the defeat screen once the end's checkpoint is in the history. Once the campaign is lost, Back to menu and Escape go to the defeat screen too, so nothing skips it.
- **Continue.** The main menu's Continue opens the run screen when the save has a run on the road, at its saved step, and the compound otherwise.

One run a day holds without a counter: a run sets off only with none out, and every run's end, home or failed, ends the day.

## What the full run controller replaces

DDB-322 keeps the state machine, `departRun`, the fights through the bridge, the end hook and the abandon menu, arrival, failure, and Continue mid-run. It replaces:

- `encounterFor` and the encounter table: stops' contents rolled from `stop:<id>` and the map's stop tables;
- `quickLoadOut`: the load out screen;
- the run screen's road list: the run route view's progress (the area map and run route screens took the route pick's place, area-map-route-pick.md);
- the run screen's one-line arrival summary: the debrief;
- the hours, which nothing spends yet: the clock, racing the dark, and the return.

The objective, the POI's own encounter, and the return ambush don't fit the two phases: each is a step after the last stop, so each needs a phase of its own (say `objective` and `returning`), a reader change for it, and a save format bump. The yield then moves from reaching the destination to winning the objective.

## Provisional calls

None of these is in a spec.

- A failed run ends the day too, unless it ends the campaign, so the compound between runs is always at dawn, and one run a day holds without a counter.
- A fight under way isn't saved: quitting mid-fight resumes at the stop before it, and the fight replays from the same seed, raiders, shuffle, and opening hands alike.
- The reward is one card of three, or none: rarities at Card System Design's drop rates, no card offered twice, never a signature card, order cards only while the convoy has an escort, and the same three after a reload.
- Each destination yields food, water, fuel, and scrap from its tier's ranges, loaded into the cargo on reaching it, before the drive home, so a failed run would lose it. Tier 1 covers about a day's upkeep for the founding compound.
- Abandoning a fight fails the run: the crew flees and goes missing, as a driver who crashes out with nobody to pick them up does, and the cargo and the escorts that came along are lost. It's behind a confirm on the combat menu.
- The crew rule reads "at home" in DDB-432 #35 as ready: an injured driver doesn't count toward a pair until fit, so two ready drivers of one archetype go together, and a lone ready driver goes solo, while a third heals.
- The quick load out seats the crew the rule allows, in pool order, on their default decks, and takes every escort, their cards to Driver 1.
- The arrival summary is one line: what was unloaded, who came back with the run, who's still injured after the night, and the night itself. Cards won stay in the locker for the Crew screen, with no per-card offer.
- The log says "Home from X with Y." on arrival, and names who died and who went missing when a run fails.
- A load out left before its run set off is given up on Continue, its run decks unwound and saved, and the compound opens.
- A quiet stretch is a stop where nothing happens, standing in for the stops that aren't fights.
- Every day offers a tier 1 POI.
- The encounters: one Rust Buggy at one skull, two at two, and a Rust Buggy with a Spike Buggy at three.
- Plan a supply run is off when nobody at the compound can go or no route is on offer, as well as on a run out or too little fuel.

## Consequences

- Version 6 saves stop loading, and Campaign History starts over, as every bump does.
- The route model is the map's shape, so Maps 9 to 14 fill it rather than change it; a stop kind or a route field the map adds is a reader change and a format bump.
- `PreparedCombat.onEnded` is the one place a fight hands back to whatever started it, and `abandonWarning` the one way to offer giving it up, so a stronghold's boss fight or an event's fight uses the same two.
- The skirmish's raider and the run's Rust Buggy are one profile, so tuning one tunes both.
- The fixture's run is on the road, so the screen goldens over it show the run screen's reward, and the compound over it shows a run out.
