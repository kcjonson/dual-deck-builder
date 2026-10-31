# The balance sim's fight mode in the C++ alpha

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

**Not in this part:** `--cards`, `--check`, and `--log` (nothing words a fight's events yet); escorts in a crew; the `gen`, `runs`, and `calibrate` modes; the Balance Lab.

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
- What run mode needs from the map, in order: a route corpus from `gen`, each route's stops in order with each stop's type and a fight's skulls, its destination tier, its hours and fuel, and its nearest neighbor's run; each stop's own seed, from the run's stream for that stop; resolvers for the calm stops under the stand-in rule (Find: cards through `rollCardOffers` into `addCardsWon`, Find: supplies with the haul the route rolled, Find: driver through `whoIsFound`, a roadside garage repairing what the scrap buys, and the events); the objective at the POI and its yields; the return ambush by game stage; and the stops a neighbor's run cleared, kept for the day after, so a route can run fresh and again behind it. The per-run targets need all of it, since they're by destination tier over real routes.
