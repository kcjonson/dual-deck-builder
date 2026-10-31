# Raider waves and how fights end

Context: the Runs and Encounters design (epic DDB-519) makes a fight a group of raiders arriving in waves, with four raider-side rules that keep groups fair against the starting cards: close-up, shake-off, rout, and break-off. The rules are in [Combat Rules](../specs/Combat%20Rules.md) (Reinforcements, Raider formation and stuns, How a fight ends). This records how they're built in `mechanics/Battle.ts` and what was measured.

## Close-up and shake-off (DDB-522)

Close-up runs in `finishEnemyTurn`, after `dropBackFlankers` and `clearWrecks` and before the player's turn starts, so raiders plan from the slots they'll fight from and no plan is made from a slot that then changes. It reads the road as it stands: a raider in formation (no `flank`, so neither a flanker nor an ambusher) that isn't already in a close-up slot moves to the nearest empty one, by `nearestTo`, the same range and tie order attack orders use. A slot someone holds or has reserved is skipped.

Options for shake-off were a hidden counter on the vehicle, a rule in the EMP card, or a status. A status (`steady`, duration 1) won: it ticks with every other status, shows as a chip without new UI, and the preview needs nothing new, since a Steady raider never gets `stunned` and the preview already drops a stunned raider's intents. It's applied in `startPlayerTurn` to each raider whose stun wore off in that tick, and `applyStatus` refuses `stunned` on a Steady vehicle with a log line.

Measured with `_legacy/scripts/raider-sim.mjs` (seed 1, 100 runs, pairs; the balance sim has since replaced it): close-up alone lifts the Road Warrior and Interceptor from 50% to 84% at 3 skulls, where the second Rust Buggy used to sit out of the Rig's reach. Shake-off ends the EMP lock the Mechanic held on the lone Spike Buggy (99% won with 1% HP lost becomes 0%), which is the unfair fight the rule is for; one-raider encounters go with the encounter templates (DDB-328).

## Waves (DDB-46)

Waves ride on the enemy `Team` as `reinforcements` (each a list of raider vehicles with an `arriveAt` and an `afterTurns`), and `Battle` copies them into its own queue when it's built. The other option was a `Battle` constructor argument. The team won because the combat bridge takes its raiders as a function returning a `Team`, and the supply run calls the encounter builder through it; carrying the waves on the team lets an encounter's later waves reach the battle with no change to the run, the bridge's signature, or the gallery's plumbing.

- Due is checked at the start of the player's turn, after the raiders plan (`checkWaveDue`), and when the player empties the road during their turn (`checkBattleStatus`, which no longer calls a fight won while a wave is queued). Either announces the wave in the log.
- Arrival (`landReinforcements`) runs in `finishEnemyTurn` after close-up. Slots come from `openingSlots(ENEMY, lastWreckRow)`, the opening order with each lane started from the row the latest raider to go out left, skipping held and reserved slots. Arrivals join the team, which gives each driver a new seat, and so its own `deck:enemy:<n>` stream through `seatOf`, and their decks shuffle on it before the first draw. The seats already in the fight draw exactly as they would without the wave (tested).
- `Battle.waves` is the top bar's readout. While a wave is due it projects the end of the enemy turn (`projectEnemyTurnStart`, then close-up planned on that projection) to mark the rows arrivals will take. Close-up and arrivals share one planner over a `RoadRead`, so the marks and the arrival can't disagree on the rule, only on kills the player hasn't made yet.
- The combat screen reads `battle.waves` every update instead of the `SINGLE_WAVE` a prepared fight could override; the gallery's fit scenarios now queue real waves to show the readout.

The balance sim (`_legacy/scripts/balance-sim.mjs`, `sim/Fights.ts`) plays fights against templates as a run's stop picks them, at the config's `tier` and `stage`, with waves, rout, and break-off (a broken-off fight carries the run on, as the bridge does), and its `encounters` config takes templates in the shape of data/encounters.json.

## Rout and break-off (DDB-525)

Each raider vehicle carries its profile's nominal `threat` and a `leader` flag (`mechanics/Raiders.ts` sets them). `Battle` totals the threat of the first wave and every queued one when it's built, and `checkBattleStatus`, which runs after every card and enemy action, routs the fight when a leader has gone out or the threat still on the road and queued is at or under `ROUT_SHARE` of that. A road and queue with nobody left is a plain win. A rout ends the fight won with `routed` set; the queue never arrives.

Break-off counts quiet player turns: `damageVehicle` and `damageDriver` note a raider losing armor, structure, or HP during the player's turn, and `endPlayerTurn` checks the count before the enemy turn starts, so a broken-off fight has no enemy turn. It ends with `battleOver`, not `battleWon`, and `brokenOff` set; `battleEnded` says `{ won: false, brokenOff: true }`, and the battle result reads "Broken off" with no defeat stamp.

Break-off is opt-in, through the constructor's `breakOffTurns` (`BREAK_OFF_TURNS` is 3). Battles built as test harnesses and the AI evaluators bound fights with `maxTurns` and read anything not won as lost, so a default break-off would change what they measure. The combat screen's skirmish and the raider sim turn it on. Campaign fights have it on too. The bridge's write-back returns a `broken_off` outcome: every driver goes on as after a win (call 198), escorts and cargo carry, no hauler pays and no fight is counted, and `SupplyRun.finishStopFight` logs it and drives the run on past the stop with no reward. The battle result reads "Broken off" and the run screen says the raiders broke off.

## Encounter templates and raider classes (DDB-328)

Templates are `data/encounters.json`, read strictly by `readEncounterData` in `campaign/Encounters.ts`: per template its skulls, tiers, waves (raiders, `arriveAt`, `afterTurns`), and `grow` raider, plus a road cap per skull count. `encounterForces` picks a template on the fight's stream, forked as `encounter` so the pick moves no other draw, sizes it (`sizedWaves`: one more `grow` raider in the last wave every two stages, and a lone driver's half), builds every raider grown 5% a stage, and returns the first wave as the enemy team with the rest queued on it, each wave carrying the road cap as `maxOnRoad`, which `Battle` honors when it lands a wave.

Raider profiles gain a class (mook, regular, heavy, leader); the leader is an elite and sets `Vehicle.leader`, which a rout reads.

Supply-run stops field the templates through `startStopFight`, which picks on the stop's fight stream (`runStream().fork('fight', stop)`, the stream the fight's shuffles come from, so a reload replays the same fight) at the destination's tier (call 205). Game stage isn't kept yet (DDB-339), so every fight is stage 0's until it is. The combat screen's skirmish fields a one-skull template at tier 1, as a run's first fight would. The stand-in table (`ENCOUNTERS`, `encounterTeam`) and the raiders' `soloAdrenaline` are gone: the templates size a lone driver's fight by its raiders.

The spec says game stage grows a late warband to 20, but with one `grow` raider every two stages and stage capped at 6, the largest warband (10) reaches 13. That's a spec question for Kevin, not changed here; the growth rate is a starting value.

Tuning was raider-side only (calls 199 to 203). On the sim's aggressive stand-in at tier 1, stage 0, the Road Warrior and Interceptor and the Interceptor and Mechanic meet the per-fight home rates (98, 93, and 85% or more at one, two, and three skulls). The Road Warrior and Mechanic don't: every loss comes with the Mechanic in seat 1, where the raiders aim on ties and the Mechanic's starter has no damage, which are DDB-493 and 495's card fixes, and the fairness rule says not to tune raiders over them.

## In the C++ alpha

`libs/rules/battle` (2026-10-30, DDB-572) builds these rules and numbers, and [battle-state.md](./battle-state.md), Waves and how fights end, has how. What differs:

- Each template carries its own `roadCap` in the pack's `encounters` folder, since packs override content by id and the TypeScript's table by skull count had none; the base templates keep their skull count's 3, 4, and 5.
- Queued raiders live in the fight's state, built and grown at setup, and each takes a new seat as it pulls in, with that seat's own deck stream as before.
- The "+N arriving" readout and its marks are the enemy turn played out on a copy, as the intents are, rather than a projection of their own (calls 386 and 387).
- Break-off is on in every fight; nothing bounds a fight by turns there for it to change.

## Provisional calls

Numbers 190 to 209 in [gameplay-calls.md](../gameplay-calls.md).

- 190: across from means the inside slot in a driven vehicle's row, Driver 1's row first.
- 191: Steady's chip is a green check.
- 192: a driven vehicle flanking on the raiders' shoulder isn't across from anything.
- 193: a wave's turn count runs from the first turn the last wave played.
- 194: "+N arriving" is the whole wave; the row marks are the rows with room.
- 195: the top bar shows "+N arriving" only, not the raiders still queued.
- 196: the Rust Buggy's threat is 2 and the Spike Buggy's 6, until calibrate.
- 197: break-off counts damage in the player's turn only, shields aside.
- 198: a break-off revives and picks up drivers as a win does.
- 199: the Scav Bike mook and the Warlord leader.
- 200: one Precision Shot a raider at most, and a lighter Spike Buggy.
- 201: threats 1, 2, 4, and 6, replacing 196.
- 202: one set of templates for tiers 1 to 4.
- 203: when later waves are due, and the road cap.
- 204: a lone driver's cut keeps the first wave.
- 205: a stop's fight draws its template at the destination's tier.
- 206: the leader is its vehicle; it's out when wrecked or driverless.
- 207: "+N arriving" counts only those that will pull in, replacing 194.
