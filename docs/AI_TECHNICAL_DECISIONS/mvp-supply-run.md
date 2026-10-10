# MVP supply run: pick a route, drive its stops, fight, come home (DDB-454)

Date: 2026-10-10. Code: `src/renderer/game/campaign/SupplyRun.ts` (the run's steps), `SupplyRunState.ts` (the saved state), `SupplyRoutes.ts` (the route model and the mock routes), `Encounters.ts`, `RunRewards.ts`, `Campaign.ts` (`supplyRun`), and `screens/route-pick/RoutePickScreen.ts`, `screens/run/RunScreen.ts`, `screens/run/runText.ts`, with the end hook on `screens/combat/CombatScreen.ts` and `next` on `screens/battleResult/BattleResultScreen.ts`. Specs: [Compound and Supply Runs](../specs/Compound%20and%20Supply%20Runs.md) (The loop, The drive, Return, A failed run, Stops) and [Area Map Generation](../specs/Area%20Map%20Generation.md) (The route tree, POIs, Stops, Routes). Builds on [combat-bridge.md](./combat-bridge.md), [cards-won.md](./cards-won.md), [run-decks.md](./run-decks.md), [day-clock.md](./day-clock.md), [injuries.md](./injuries.md), [campaign-end.md](./campaign-end.md), and [seeded-prng.md](./seeded-prng.md).

## Context

Every piece under a supply run existed (run decks, the combat bridge, cards won, the day clock, the infirmary, the campaign's end) and nothing strung them together: the compound's Plan a supply run was disabled, the battle result's Continue went to the menu, and no save held a run on the road. The full run controller waits on the realistic map's route tree, POIs, stops, and route descriptors. This is the playable loop in the meantime, built so the map replaces a data source and not the loop: the compound, a route pick, the drive, home or a failed run, and Continue in the middle of it. The compound, load out, and the post-run screens are deliberately thin; the map and the run controller are where the work goes next.

## The route model

Routes take the shape the map will hand over, so swapping the source is a data change:

- `RouteDestination`: the POI a route arrives at, with an id, a name, and a tier (Map 10).
- `RunRoute`: one of a POI's routes, its descriptor (Map 14): a name from its dominant class, its fuel, its hours (out, at the objective, home), and its risk, the worst fight in skulls, over an ordered list of legs.
- `RouteLeg`: a piece of the route tree between places where routes split or end, driven outward (Map 9), with its road class, length, driving hours, and stops in the order a run meets them.
- `RouteStop`: a kind (`fight` with its skulls, or `quiet`; events, finds, garages, and hazards later) and `at`, its position along the leg from 0 to 1 (Map 12). A fight's raiders are its contents, rolled when the run reaches it (`encounterFor`); its kind and skulls are fixed with the map.

A run counts its place along `routeStops(route)`, every stop on every leg in driving order, so a leg boundary changes nothing in the state machine.

`supplyRoutes({ seed, day })` is the mock behind it, and `routesOnOffer({ campaign })` the one call the area map replaces. It draws from `fork('routes', day)` off the campaign's seed, so a day offers the same routes however often it's asked. Each day has two or three POIs, a tier 1 one always among them, each with two routes that share a first highway leg out of the compound and then a leg or two of their own, as the route tree's routes share road until they split. A POI's tier sets its routes' fights: one or two, the last at the tier's skulls and none worse. A route holds at most three stops, and three hold a quiet one, after the Stops section's per-route rules. Fuel comes from the route's length, and its hours from realistic-map.md's provisional class speeds and the spec's stop hours; nothing spends the hours yet.

`Encounters.ts` is the stand-in encounter table, one per skull count: the combat screen's own Rust Buggy raider, two of them, and a Rust Buggy beside the Raider archetype's Spike Buggy.

## The run's state

The run on the road is the campaign's `supplyRun`, saved with it, so a checkpoint writes the run and the campaign together and a load can't find one without the other. It holds the route as it was rolled (a load never rolls it again, as DDB-402 asks of revealed stops), the stop the run is at, its phase, the escorts still with it, and the cargo and cards won. Two things in the RunParty aren't kept twice: the seats are the run decks' drivers in seat order, and the run's id is `Campaign.currentRun`; `runParty` puts the party back together for the bridge.

The phase is `driving`, toward the stop (or home once every stop is behind it), or `reward`, at a won fight with its card to pick. A fight under way isn't saved. Starting one changes nothing in the save, so a reload finds the run driving to that stop, and the fight replays from the same stream, `fork('fight', stop)` off the run's own (`fork('run', n)`), with the same raiders and the same opening hands. The reward's cards come from `fork('reward', stop)` the same way, so a reload offers the same three.

`supplyRun` is null at home and while a load out is under way, and the run's end clears it with the run decks: `unloadRun`, `loseRun`, and `unwindRunDecks` each set it to null in their one `set`. The campaign's reader refuses a run on the road with no run decks, checks the route, the stop against the route, a reward only at a fight, the escorts against the convoy, and the cargo with the stores' own reader. `toSaveText` checks the escorts are still in the convoy, since a fight's write-back lets lost ones go outside the campaign's checks. The save format is version 7, and the fixture (`campaign-v7.json`) has its run on the road at its last fight's reward.

Options considered for where the state lives: a second storage key beside the campaign (two writes that could land apart, against one save written whole); the state as opaque JSON on the campaign, read by the run module (a damaged run would load and fail later, on the run screen); and the RunParty saved whole with its seats and run id (two copies of facts the run decks already hold, and one more thing to agree).

## The loop

- **Plan.** The compound's Plan a supply run opens the route pick, off with its reason (`getPlanBlocker`) once the campaign is over, while a run is out, when no two drivers at the compound can go together, or when the stores hold less fuel than today's cheapest route.
- **Load out.** Stubbed until its screen exists: `quickLoadOut` seats the first pair that can go, in pool order, on their default decks, with every escort in the convoy (up to four, their cards to Driver 1), through `startRunDecks`. It's the one call a load out screen replaces.
- **Departure.** `departRun` takes a route on offer today and the escorts load out sent, pays the fuel, and puts the run at its first stop, in one `set`. It refuses (`getDepartBlocker`, a `DepartRuleError`) once the campaign is over, while a run is on the road, and on too little fuel, and throws with no run decks started, for a route not on offer today, and for escorts that aren't the ones whose cards are in the run decks. If it refuses after load out started the run decks, the route pick unwinds them.
- **Stops.** A quiet stretch passes (`passQuietStop`). A fight starts through the bridge (`startStopFight`) and goes to the combat screen. `PreparedCombat` takes an end hook, `onEnded`, which the combat screen calls as the battle ends and whose result it hands the battle result screen. The run's hook writes the fight back (`finishStopFight`) and checkpoints before the result shows, so quitting on the result screen loses nothing; `BattleResultData.next` then sends Continue back to the run screen. A skirmish brings no hook, and its Continue still goes to the menu.
- **Reward.** After a win, three cards from the reward pool, each a rarity drawn at Card System Design's drop rates and then a card of it, no card twice, never an escort's signature card, and order cards only while the convoy has an escort. One is picked (`addCardsWon` on the write-back's party, as cards-won.md says) or the reward is skipped, and the run drives on.
- **Home.** With every stop behind it, `arriveHome` unloads the run (`unloadRun`), injures its drivers hurt (`injureOnArrival`), counts a run for each seat (`runsCompleted`), and ends the day, and the run screen says so in one line.
- **A failed run.** `finishStopFight` loses it (`loseRun`), then ends the day unless that ended the campaign, as campaign-end.md planned. The battle result's Continue brings the failed run's report to the run screen, which goes on to the compound, or to the defeat screen once the end's checkpoint is in the history.
- **Continue.** The main menu's Continue opens the run screen when the save has a run on the road, at its saved step, and the compound otherwise.

One run a day holds without a counter: a run sets off only with none out, and every run's end, home or failed, ends the day.

## What the full run controller replaces

DDB-322 keeps the state machine, `departRun`, the fights through the bridge, the end hook, arrival, failure, and Continue mid-run. It replaces:

- `routesOnOffer`'s source: the area map's POIs and route descriptors in place of `supplyRoutes`;
- `encounterFor` and the encounter table: stops' contents rolled from `stop:<id>` and the map's stop tables;
- `quickLoadOut`: the load out screen;
- the route pick and the run screen's road list: the area map and the run route view;
- the run screen's one-line arrival summary: the debrief;
- the hours, which nothing spends yet: the clock, racing the dark, and the return.

## Provisional calls

None of these is in a spec.

- A failed run ends the day too, unless it ends the campaign, so the compound between runs is always at dawn, and one run a day holds without a counter.
- A fight under way isn't saved: quitting mid-fight resumes at the stop before it, and the fight replays from the same seed, raiders, shuffle, and opening hands alike.
- The reward is one card of three, or none: rarities at Card System Design's drop rates, no card offered twice, never a signature card, order cards only while the convoy has an escort, and the same three after a reload.
- The quick load out seats the first pair that can go, in pool order, on their default decks, and takes every escort, their cards to Driver 1.
- The arrival summary is one line: what was unloaded, who's hurt, and the day that ended. Cards won stay in the locker for the Crew screen, with no per-card offer.
- A load out left before its run set off is given up on Continue, its run decks unwound and saved, and the compound opens.
- A quiet stretch is a stop where nothing happens, standing in for the stops that aren't fights.
- Every day offers a tier 1 POI.
- The encounters: one Rust Buggy at one skull, two at two, and a Rust Buggy with a Spike Buggy at three.
- Plan a supply run is off when no two drivers at the compound can go together, as well as on a run out or too little fuel.

## Consequences

- Version 6 saves stop loading, and Campaign History starts over, as every bump does.
- The route model is the map's shape, so Maps 9 to 14 fill it rather than change it; a stop kind or a route field the map adds is a reader change and a format bump.
- `PreparedCombat.onEnded` is the one place a fight hands back to whatever started it, so a stronghold's boss fight or an event's fight uses the same hook.
- The fixture's run is on the road, so the screen goldens over it show the run screen's reward, and the compound over it shows a run out.
