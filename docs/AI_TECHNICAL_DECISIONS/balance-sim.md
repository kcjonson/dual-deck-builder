# The balance sim's fight and run modes in the C++ alpha

## Date
2026-10-31

## Context

Step 4 of the port plan: `apps/balance-sim`, the command line tool [Balance Simulation](../specs/Balance%20Simulation.md) specs, over the rules and the AI. This first part is its `fights` mode. The TypeScript's is `_legacy/scripts/balance-sim.mjs` over `_legacy/src/renderer/game/sim/`, a crew played through a route's fights by the game's Battle and AI controller, seated and written back by its combat bridge.

What the C++ already had: packs and `Content`, `pickEncounter` and `fieldEncounter`, `startBattle`, the campaign's `startCampaignFight` and `writeBackFight`, `makePolicy` and `OpponentPolicies`, and `ai::playFight`. What this needed decided: where the sim's core lives, how a tuning comes in, how a run's fights are fielded and carried from one to the next, how a fight stops at the stall cap and gets measured, and how runs spread over threads without the numbers moving.

The map's POIs and stops are another session's, so run mode, over real routes, isn't here.

## Options considered

For the tuning:

1. **Patches in the config,** as the TypeScript did: raider profiles merged field by field, encounter templates replaced whole. A second way to change content, with its own merge rule, and a tuning that has to be rewritten as a pack to ship.
2. **Packs over the base pack (chosen),** loaded as the game loads a mod, overriding raiders, encounters, cards, and drivers by id.

For where the core lives:

1. **`libs/sim`.** Ready for a Balance Lab in the game, but a library that links both the rules and the AI before anything else needs it.
2. **A library inside `apps/balance-sim` (chosen),** which the tool and its tests link. The app stays the one new thing linking both; a Balance Lab can move it to `libs/` when it comes.

For a run's fights:

1. **A `BattleSetup` per fight,** as the AI's tests build one, with the sim's own write-back between fights. That's a second combat bridge.
2. **A campaign per run (chosen):** the crew recruited, sent out, each fight started and written back by the bridge, and the run unloaded home.

For the stall cap and the counting:

1. **The sim's own fight loop.** A second `playFight`.
2. **Options on `playFight` (chosen):** a turn cap that stops the fight unfinished, and a callback after every action with its events.

## Decision

**The app.** `apps/balance-sim/` holds `ddb_balance_sim`, the core (`FightsConfig`, `Fights`, `Measures`, `Report`), and `balance-sim`, the tool (`main.cpp`). `ddb_check_layering()` holds the core to `ddb::rules` and `ddb::ai`, the tool to the core, and the rules to linking neither. The base pack is read from the source tree, so a pack edit needs no rebuild, and `--pack` adds packs over it in order.

**The config** is read strictly by `readFightsConfig` on `JsonReader`, every field optional, every failure a `ContentError` naming the file and the path, and written back by `fightsConfigJson` in the same shape with the crews listed out. The format is the spec's (The fights config). A route is a plain list of fights, each a skull count or an encounter's id, standing in for the stops a route on the map would field. Command line options win over the config's fields. The stand-in is a behavior bound by `makePolicy` for the player's side, so `mcts` with its weights is a stand-in like any other.

**A run.** Run n of a cell, counting from 1, is a `Campaign` of its own on the config's seed, its next run number n: each seat recruited (`recruitDriver`) with its deck as the config gives it, sent out at the cell's stage (`startRun`, no escorts, since the start has none), so `nextFightSeed` is the seed's `fork("run", n).fork("fight", f)`, the spec's streams. Each fight is its step's encounter, or `pickEncounter`'s on that seed at the config's tier, started by `startCampaignFight`, played by `playFight` with the stand-in on every seat and each raider on its own policy, and written back by `writeBackFight`, so damage, the limp, and revival (call 198) carry exactly as a campaign's would. A fight lost ends the run lost, one still on at the cap ends it stalled, and a run through every fight is unloaded home (`unloadRun`) for the injury days it brings. A pair sits in its crew's order on odd runs and swapped on even ones.

**`playFight` options.** `mostTurns` stops a fight as the player turn after that many opens, unfinished, which the sim reads as stalled; `onApplied` hands over each action the fight applies with its events. The default plays to the end as before.

**The measures.**

- A fight's turns are the player turns it played. Its HP and structure lost are the crew's drivers' HP and driven vehicles' structure as it opened less as it closed, over their maximums, escorts left out. Raiders killed are raider vehicles out of the fight, wrecked or with nobody at the wheel; raiders that fled a rout don't count. Waves seen is `waveOnRoad` at the end. Plays are read off the events: `CardPlayed` for the crew's and a raider's played steps, `PlannedStepFizzled` for its fizzles.
- A run comes home when every fight is won or broken off. What it lost is off the drivers' records after the last write-back against their archetypes' maximums, so a revived driver counts as 1 HP and a wreck as limping.
- Each place on a route is measured over the runs that reached it, and what a fight cost, its turns, and drivers down are over the fights won, as the per-fight targets read.
- The per-fight rows by skull count take each crew's opening fights, fresh, pairs and lone drivers apart. Two routes opening with the same fight play the same draws, so a crew's are counted once.
- Rates carry their count and a 90% Wilson interval, as the TypeScript's did.

**Determinism and threads.** Every run is a pure function of the config, its cell, and its number, so the runs go over salal's `TaskPool` one an item, the caller's thread among the workers, each into its own slot, and the measures are taken afterwards in cell and run order. The JSON came out byte for byte the same on 1 and 4 workers, and from Debug and RelWithDebInfo builds. The wall time and what a decision cost are printed, never in the JSON.

**Release.** Build and run the sim in RelWithDebInfo (`cmake --build --preset windows-relwithdebinfo --target balance-sim`). In Debug, Monte Carlo tree search took 44 ms a decision on pairs against 1.5 ms in RelWithDebInfo.

**Not in this part:** `--cards`, `--check`, and `--log` (nothing words a fight's events yet); escorts in a crew; the `gen`, `runs`, and `calibrate` modes; the Balance Lab. Run mode came next, below.

## Rationale

The spec's core plays everything through the game's own code, and the campaign bridge is the game's code for a run's fights, so a rule change to the bridge reaches the sim with nothing to update. Packs are already how content changes, and a tuning the sim proves is a pack Kevin can check in. Taking the turn cap and the events off `playFight` keeps one loop that plays a fight with nobody at the controls.

## First numbers in the C++ alpha

Seed 1, tier 1, stage 0, fresh crews on their starting decks against the base pack's encounters, untuned since the TypeScript, the stall cap at 25. The floor and the ceiling played 200 runs a cell over routes 1, 2, 3, and 1+2; Monte Carlo tree search (48 playouts, the default) and random played 100 over 1, 2, and 3. Every run took under a minute on 2 workers. Won is a fight won, so a break-off isn't; the targets are Runs and Encounters' per-fight ones, which every pair should meet with the floor.

Opening fights, the three pairs pooled, and the pair that won least:

| Skulls | Target | Floor | Ceiling | MCTS | Random | Worst pair, floor |
|---|---|---|---|---|---|---|
| 1 | 98% | 95% [93-96] | 95% [93-96] | 94% [92-96] | 69% | Mechanic + Road Warrior, 84% |
| 2 | 93% | 94% [92-95] | 93% [91-95] | 94% [92-96] | 25% | Mechanic + Road Warrior, 83% |
| 3 | 85% | 71% [68-74] | 70% [67-73] | 87% [84-90] | 22% | Interceptor + Mechanic, 50% |

Each pair's opening fights won with the floor, then the ceiling:

| Pair | 1 skull | 2 skulls | 3 skulls |
|---|---|---|---|
| Interceptor + Mechanic | 100 / 100 | 98 / 96 | 50 / 51 |
| Interceptor + Road Warrior | 100 / 100 | 100 / 100 | 91 / 87 |
| Mechanic + Road Warrior | 84 / 84 | 83 / 84 | 73 / 73 |

What's off, against the targets. These are Kevin's calls; nothing was tuned.

- **Break-offs, not losses, are most of the misses.** No pair loses a 1- or 2-skull fight. The Mechanic and Road Warrior break off half their fights against `scav_tail` and `spike_crew`, the two templates that open with a buggy and one bike, in either seating and with every stand-in, Monte Carlo included, which is the flat 17% at 1 and 2 skulls. The Interceptor and Mechanic break off three in four against `scav_warband` and `spike_raid` (73 and 74%), the ones with the Warlord or the Spike Buggy up front, and a driver goes down in about as many runs, which looks like the Mechanic's starter, with no damage in it, left to finish alone.
- **The Interceptor and Road Warrior lose at 3 skulls with the Interceptor in seat 1:** 81% home that way round against 100% the other way with the floor, 75 to 99 with the ceiling, against the 10-point seating rule; by encounter, 79% against the Warlord's warband and 56% against `spike_raid`.
- **One skull costs too little.** Pairs lose 5% of their HP and 1% of their structure in a won 1-skull fight with the floor, 4% with the ceiling, under the 12-20% band. Two skulls cost 14%, three 29%.
- **Turns are in the band pooled and out of it by pair.** Pairs take 4.0, 6.6, and 7.1 turns at 1, 2, and 3 skulls, but the Interceptor and Road Warrior finish a 1-skull fight in 2.9, and the Mechanic and Road Warrior take 10 to 11 at 2 and 3. Nothing stalled.
- **Lone drivers** have no targets and win 63, 41, and 22% of their opening fights with the floor. A lone Mechanic breaks off every fight on turn 3.
- **The ceiling is level with the floor.** The intent-aware stand-in wins what the aggressive flanker wins, to a point, and loses more of the Interceptor and Road Warrior's 3-skull fights (13% to 10%), so it doesn't yet show how much room a good player has. Monte Carlo tree search does: 87% at 3 skulls against the floor's 71%, and alone 67, 59, and 47% against 63, 41, and 22%.
- **A route's two fights,** 1 then 2, bring the Interceptor and Road Warrior home every run with 28% of their HP lost, and the Interceptor and Mechanic with 20%; the Mechanic and Road Warrior, 6%.

Monte Carlo tree search in RelWithDebInfo: 1,800 fights and 62,184 decisions in 48 s on 2 workers, 1.55 ms of a worker's time a decision with the raiders' planning in it, against the aggressive flanker's 0.05. It's the strongest stand-in measured, and beats random everywhere (94, 94, and 87% won against 69, 25, and 22).

## Consequences

- A tuning is a pack, tried with `--pack` and checked in as one.
- `playFight` can stop a fight unfinished and report each action, for anything else that measures fights.
- Each cell's opening fights replay exactly across routes that open the same way, which the per-skull rows rely on and the tests hold.
- What run mode needs from the map, in order: a route corpus from `gen`, each route's stops in order with each stop's type and a fight's skulls, its destination tier, its hours and fuel, and its nearest neighbor's run; each stop's own seed, from the run's stream for that stop; resolvers for the calm stops under the stand-in rule (Find: cards through `rollCardOffers` into `addCardsWon`, Find: supplies with the haul the route rolled, Find: driver through `whoIsFound`, a roadside garage repairing what the scrap buys, and the events); the objective at the POI and its yields; the return ambush by game stage; and the stops a neighbor's run cleared, kept for the day after, so a route can run fresh and again behind it. The per-run targets need all of it, since they're by destination tier over real routes. Run mode, below, reads all of it off maps it makes, the corpus aside, and no map places a roadside garage yet.

## Run mode

The campaign's sixth slice (campaign.md, Events, the objective, and the return) left a run able to go out to its POI and home headless, every stop the map places resolved, so `runs` could be built over real routes. Balance Simulation's `runs`: every crew over generated routes, each stop in order, calm stops by a stand-in rule, damage carried as the bridge writes it back, reported by tier against the per-run targets, each route fresh and the day after a run to its nearest neighbor.

### Options considered

For the routes:

1. **A corpus from `gen`,** as the spec had it. `gen` isn't built, and a corpus is a second copy of the map's stops and rolls to keep in step with the generator.
2. **Maps the sim makes (chosen),** each seed's through `makeCampaignMap` as founding makes it, and its routes read with `offersToday` on a fresh campaign, the way a run gets them. A map takes under half a second in RelWithDebInfo, so there's nothing to save.

For playing a run:

1. **The sim's own walk down a route's stops.** A second run, which a change to a stop's rules wouldn't reach.
2. **The campaign's run code (chosen):** `depart`, then whatever `ahead` names, `startRunFight` and `endRunFight`, `takeFind`, `takeEventChoice`, `takeReward`, `takeObjective`, and `unloadRun`, as a scene will call them.

For the neighbor's run the day before:

1. **Play it.** Its own outcome would decide what's cleared, so the route behind it would meet a different road from run to run, and a failed run clears nothing.
2. **Clear what it meets (chosen):** every stop the neighbor's run meets cleared on day 1 with `clearStop`, then `endDay`, which is what getting home and the night do to them. The route behind meets the road as a neighbor's run home leaves it.

For the stand-in at an event:

1. **Drive on,** the free choice that never fights. It would pass every fight an event can turn into.
2. **The best choice by its outcomes' yield less their danger.** A second reading of the events' content, with weights to tune.
3. **The first choice the party can take (chosen, call 440).**

### Decision

**The mode.** `balance-sim runs`: `RunsConfig.h` reads its config, `Runs.h` makes its maps, cells, and runs and measures them, and `RunReport.h` writes the JSON and the summary. What both configs read alike moved to `ConfigFields.h`, the reports' formatting to `ReportText.h`, and the fight player out of `playRun` into `playCampaignFight`, which fights mode and run mode share, so a fight is played and recorded the same in both; fights mode's JSON didn't move by a byte. The combat bridge's `CampaignFight` carries the encounter it fielded, so a run's fight record names it.

**The config** is the spec's (The runs config), read strictly and written back the same: maps as a count or seeds, runs a cell (20), crews (pairs when left out, since the targets are for pairs), routes (all, or a count a map drawn on the map seed's `fork("routes")`), tiers 1 to 4 (5 is refused, call 410), stages, the turn cap, the stand-in, and `neighbor`. The command line adds `--maps`, `--routes all|n`, `--tier 1,2`, and `--neighbor on|off`.

**Maps** come from `makeRunMaps`: each seed's through `makeCampaignMap` with `debug` off, so a seed whose attempts all fail goes on to the next as a release build's founding does, over the workers, each map its seed's whatever the count. The map content and route tuning are the base pack's, which `--pack` doesn't reach, since the map reads one pack.

**Cells** are a crew over a route at a stage, fresh, then behind its neighbor's run: crew by crew, map by map, each map's routes as `offersToday` lists them, stage by stage. A cell holds the stops the route meets at its stage (`stopsAtStage` over its legs, as `depart` reads them, less any cleared) and its risk, the most skulls among their fights or 1. A POI's nearest neighbor is the other POI whose routes share the most road with its routes by length, the lower among ties, and its run is whichever of that POI's routes meets the most of this route's stops, the quickest among ties, as the spec's `gen` defines them. A route its neighbor's run clears nothing of runs only fresh, since behind it would be the same run.

**A run** of a cell, n from 1, founds a campaign on the cell's map with `foundCampaign`, its seed the map's; behind a neighbor, that run's stops are cleared on day 1 and the day ends. The campaign's next run is n, so every stop draws on `fork("run", n).fork("stop", s)` and every fight on `fork("run", n).fork("fight", f)`, the same draws for every crew, fresh or behind. Each seat is the pool's first ready driver of its archetype, or one recruited, on the deck the config gives it, a pair swapped on even runs, and the run leaves at the cell's stage. When the stores hold less than the route's fuel, they're topped up to it (`departBlocker`'s fuel), and the fuel paid is recorded. After `depart`, the sim checks the run left meeting the cell's stops and throws if not. Then each step `ahead` names: a fight played by `playCampaignFight` and written back by `endRunFight`; each find taken; at an event, the first choice `choiceBlocker` allows (call 440); at a reward, its first card (call 441); the objective; the return ambush if it rolled; and home, `unloadRun`, for the injury days. A step cap of four a stop and eight more throws on a run that never gets home.

**How a run ends:** home; failed, at a fight lost; or abandoned, at a fight still on at the turn cap, which the sim leaves there without writing it back.

**The measures.** Each stop gets a record, the return ambush its own: its type, the event, choice, and outcome there, and its fight. A cell, a group of cells, or the routes behind a neighbor are measured alike:

- over every run: home, failed, abandoned, a fight broken off, and the stops met, fights fought, and fuel paid; the return ambush over the runs that took their objective; for a pair, home by seat;
- over the runs home: HP lost, structure lost, and the two together as the targets read them (call 442), as fights mode takes them off the drivers' records; drivers down, injury days, and turns; the cargo by resource, cards won, and drivers found.

The summary reads them by destination tier against the per-run targets, every pair pooled with the worst pair beside it and then each crew; by route risk; by each kind of stop, a fight stop and the ambush by skulls, each event's choices counted; the fairness spreads by tier; the routes behind a neighbor's run, fresh then behind; and the ten routes pairs came home from least.

**Determinism and threads** are fights mode's: every run a pure function of the config, its map, its cell, and its number, spread over `TaskPool` one an item and measured in cell and run order afterwards. The JSON came out byte for byte the same on 1 and 3 workers over two maps from the command line, and the slow lane holds it on the fixture map.

**What doesn't exist and how it's treated.** No map places a roadside garage or a hazard (`isResolvable`), so no route meets one, and the stand-in's garage rule waits for the garage stop. There's no clock on the road, so no route is measured against dark and the return ambush rolls at its daylight odds, none before stage 2. No run leaves for a stronghold (call 410), so tier 5 isn't run.

### Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (The C++ balance sim's run mode).

- 440: at an event, the stand-in takes the first choice its party can take, in the event's order, because the spec gives it no rule there, the events list their bold choice first and Drive on last, and a rule weighing outcomes would be a second reading of the content.
- 441: at a reward, the stand-in takes its first card, because a card won only rides home, so which one changes nothing but the cards won.
- 442: the per-run targets' "crew HP and structure lost" is the mean of the HP share and the structure share, because the target names both and pooled points would let structure, about twice a pair's HP, outweigh it.

### Consequences

- A rule change to a stop, an event, the bridge, the objective, or the return reaches run mode with nothing to update, since it plays them through the campaign's code.
- A route's numbers fresh and behind its neighbor share their draws, so the gap is the cleared stops, not the luck.
- Cells share their luck across crews and routes, as in fights mode, so a figure pooled across a tier needs more runs than its interval suggests.
- What's left of the balance sim: `gen` (generation invariants by tier, the band and fight-floor audit, own road and neighbors, and the corpus), `calibrate` (raider threat by regression), `--check`, `--cards`, and `--log`, the `campaign` mode, the roadside garage once the map places one, escorts in a crew, and the Balance Lab.

## Run mode's first numbers

Seeds 1, 2, and 3, every route a run can leave on, 145 of them (27 at tier 1, 34 at tier 2, 28 at tier 3, and 56 at tier 4), the three starting pairs fresh on their starting decks, stage 0, the stall cap at 25, the base pack untuned. The floor played 40 runs a cell, fresh and behind each route's neighbor, 33,360 runs in 129 s on 2 workers; the ceiling 10, 8,340 runs in 83 s; Monte Carlo tree search 2, fresh only, 870 runs in 84 s; random 10, fresh only, 4,350 runs in 9 s. The three maps took 0.7 s to make on 2 workers. Nothing stalled, so no run was abandoned. These were salal v0.19.0's maps; pinning v0.30.1 moved every map, these three among them (terrain-fields.md, Noise is the engine's), so the same seeds now give other routes and stops.

Home by destination tier, every pair pooled, and the pair that came home least with the floor:

| Tier | Target | Floor | Ceiling | MCTS | Random | Worst pair, floor |
|---|---|---|---|---|---|---|
| 1 | 95% | 100% [100-100] | 100% | 100% | 90% | all 100% |
| 2 | 88% | 99% [99-100] | 99% | 100% | 77% | Interceptor + Road Warrior, 99% |
| 3 | 75% | 94% [93-95] | 95% | 100% | 48% | Interceptor + Road Warrior, 82% |
| 4 | 60% | 86% [85-87] | 86% | 99% | 44% | Interceptor + Road Warrior, 62% |

What a run home cost with the floor, the crew's HP and structure shares and their mean (call 442) against the band:

| Tier | Band | Lost | HP | Structure | Injury days | Stops met | Fights fought |
|---|---|---|---|---|---|---|---|
| 1 | 20-35% | 6% | 9% | 3% | 0.8 | 3.7 | 1.7 |
| 2 | 30-45% | 10% | 14% | 5% | 1.2 | 4.0 | 1.7 |
| 3 | 40-55% | 23% | 31% | 14% | 2.4 | 4.5 | 2.7 |
| 4 | 45-60% | 29% | 36% | 22% | 2.7 | 5.7 | 2.8 |

Each pair, home with the floor (by seat, the crew's order then swapped) and what it lost:

| Pair | Tier 1 | Tier 2 | Tier 3 | Tier 4 |
|---|---|---|---|---|
| Interceptor + Mechanic | 100%, 6% | 100%, 11% | 100%, 27% | 100%, 34% |
| Interceptor + Road Warrior | 100%, 10% | 99% (97/100), 16% | 82% (68/97), 34% | 62% (43/82), 40% |
| Mechanic + Road Warrior | 100%, 1% | 100%, 3% | 99%, 8% | 96% (92/100), 17% |

The fights on the way, with the floor, over the fresh runs:

| Stop | Met | Won | Lost | Broken off | HP lost when won |
|---|---|---|---|---|---|
| Ambush, 1 skull | 8,040 | 95% | 0% | 5% | 4% |
| Ambush, 2 skulls | 15,303 | 79% | 2% | 19% | 13% |
| Ambush, 3 skulls | 5,133 | 54% | 10% | 36% | 24% |
| Warband, 3 skulls | 2,617 | 58% | 9% | 33% | 27% |
| Wreck, the 17% that turned into a fight | 15,895 | 92% | 0% | 8% | 4% |
| Distress, the 62% that turned into a fight | 10,780 | 88% | 1% | 11% | 11% |

What's off, against the targets. These are Kevin's calls; nothing was tuned.

- **Runs cost too little.** Every tier comes home well over its target and loses 14 to 20 points under the bottom of its band: 6% at tier 1 against 20-35%, 29% at tier 4 against 45-60%. The ceiling loses one to three points less and MCTS about half as much. The 1-skull fight already cost too little in fights mode, and a calm stop costs nothing under the stand-in's rules: finds take nothing, and no event's first choice hurts but through the fight it can turn into.
- **Fairness fails from tier 3.** The best pair less the worst is 0, 1, 18, and 37 points by tier with the floor, against 15, and the Interceptor and Road Warrior's two seatings 30 and 38 points apart at tiers 3 and 4, against 10. It's the fights-mode finding carried down a route: with the Interceptor in seat 1 the pair comes home 68% at tier 3 and 43% at tier 4, against 97% and 82% the other way round, and the ceiling is the same (74/97, 44/80).
- **The Mechanic and Road Warrior barely get hurt:** 3% lost at tier 2 with the floor, 1% with the ceiling, under the spread's 5% floor from tier 2, and 8% at tier 3.
- **Break-offs are a third of the 3-skull fights.** A 3-skull ambush is won 54% and broken off 36%, a warband won 58% and broken off 33%, so a run that comes home has often broken off the hardest fight on its road rather than beaten it.
- **At stage 2 the worst pair misses.** The floor at stage 2 (10 runs a cell, fresh) brings the Interceptor and Road Warrior home 70% at tier 3 and 48% at tier 4, under 75% and 60%; the tier 4 target's 75% for a grown deck at stage 2 doesn't apply to a fresh one. Pooled, stage 2 is 100, 99, 90, and 81% home losing 9, 14, 26, and 32%, and the return ambush came on 2 to 4% of runs.
- **A neighbor's run clears about half a route's stops.** It clears some of 133 of the 145 routes' stops, 45 to 51% of them by tier, and the route behind it meets 2.0 to 3.1 stops and 1.2 to 2.1 fights where it met 3.8 to 5.7 and 1.7 to 2.8 fresh, comes home 0 to 4 points more often, and loses 1 to 3 points less. The spec keeps half a route's band on its own road, which is about what's left.
- **Every tier loses fuel.** A run pays 3.1, 4.7, 5.8, and 7.7 fuel by tier and brings home 1.0 to 1.4, the finds, the events, and the POI's yield in it, so it's 1.8 to 6.3 fuel down, and the starting 10 makes about four runs to tier 1 or one to tier 4 before a scavenging party has to go out.
- **The ceiling is still level with the floor** over whole runs, as over single fights, and Monte Carlo tree search is the stand-in that shows the room: 99% home at tier 4, the Interceptor and Road Warrior 98% there. Random comes home 90, 77, 48, and 44% by tier, so the floor's numbers aren't the routes being harmless.
