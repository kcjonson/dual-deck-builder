# Raider waves and how fights end

Context: the Runs and Encounters design (epic DDB-519) makes a fight a group of raiders arriving in waves, with four raider-side rules that keep groups fair against the starting cards: close-up, shake-off, rout, and break-off. The rules are in [Combat Rules](../specs/Combat%20Rules.md) (Reinforcements, Raider formation and stuns, How a fight ends). This records how they're built in `mechanics/Battle.ts` and what was measured.

## Close-up and shake-off (DDB-522)

Close-up runs in `finishEnemyTurn`, after `dropBackFlankers` and `clearWrecks` and before the player's turn starts, so raiders plan from the slots they'll fight from and no plan is made from a slot that then changes. It reads the road as it stands: a raider in formation (no `flank`, so neither a flanker nor an ambusher) that isn't already in a close-up slot moves to the nearest empty one, by `nearestTo`, the same range and tie order attack orders use. A slot someone holds or has reserved is skipped.

Options for shake-off were a hidden counter on the vehicle, a rule in the EMP card, or a status. A status (`steady`, duration 1) won: it ticks with every other status, shows as a chip without new UI, and the preview needs nothing new, since a Steady raider never gets `stunned` and the preview already drops a stunned raider's intents. It's applied in `startPlayerTurn` to each raider whose stun wore off in that tick, and `applyStatus` refuses `stunned` on a Steady vehicle with a log line.

Measured with `scripts/raider-sim.mjs` (seed 1, 100 runs, pairs): close-up alone lifts the Road Warrior and Interceptor from 50% to 84% at 3 skulls, where the second Rust Buggy used to sit out of the Rig's reach. Shake-off ends the EMP lock the Mechanic held on the lone Spike Buggy (99% won with 1% HP lost becomes 0%), which is the unfair fight the rule is for; one-raider encounters go with the encounter templates (DDB-328).

## Waves (DDB-46)

Waves ride on the enemy `Team` as `reinforcements` (each a list of raider vehicles with an `arriveAt` and an `afterTurns`), and `Battle` copies them into its own queue when it's built. The other option was a `Battle` constructor argument. The team won because the combat bridge takes its raiders as a function returning a `Team`, and the supply run (which this work doesn't own) calls `encounterTeam` through it; carrying the waves on the team lets an encounter's later waves reach the battle with no change to the run, the bridge's signature, or the gallery's plumbing.

- Due is checked at the start of the player's turn, after the raiders plan (`checkWaveDue`), and when the player empties the road during their turn (`checkBattleStatus`, which no longer calls a fight won while a wave is queued). Either announces the wave in the log.
- Arrival (`landReinforcements`) runs in `finishEnemyTurn` after close-up. Slots come from `openingSlots(ENEMY, lastWreckRow)`, the opening order with each lane started from the row the latest raider to go out left, skipping held and reserved slots. Arrivals join the team, which gives each driver a new seat, and so its own `deck:enemy:<n>` stream through `seatOf`, and their decks shuffle on it before the first draw. The seats already in the fight draw exactly as they would without the wave (tested).
- `Battle.waves` is the top bar's readout. While a wave is due it projects the end of the enemy turn (`projectEnemyTurnStart`, then close-up planned on that projection) to mark the rows arrivals will take. Close-up and arrivals share one planner over a `RoadRead`, so the marks and the arrival can't disagree on the rule, only on kills the player hasn't made yet.
- The combat screen reads `battle.waves` every update instead of the `SINGLE_WAVE` a prepared fight could override; the gallery's fit scenarios now queue real waves to show the readout.

The encounter table keeps one wave per encounter until the templates (DDB-328), so play is unchanged except for the readout. raider-sim's `--set` takes waves (`road_gang=rust_buggy|rust_buggy@1`) to measure them.

## Rout and break-off (DDB-525)

Each raider vehicle carries its profile's nominal `threat` and a `leader` flag (`mechanics/Raiders.ts` sets them). `Battle` totals the threat of the first wave and every queued one when it's built, and `checkBattleStatus`, which runs after every card and enemy action, routs the fight when a leader has gone out or the threat still on the road and queued is at or under `ROUT_SHARE` of that. A road and queue with nobody left is a plain win. A rout ends the fight won with `routed` set; the queue never arrives.

Break-off counts quiet player turns: `damageVehicle` and `damageDriver` note a raider losing armor, structure, or HP during the player's turn, and `endPlayerTurn` checks the count before the enemy turn starts, so a broken-off fight has no enemy turn. It ends with `battleOver`, not `battleWon`, and `brokenOff` set; `battleEnded` says `{ won: false, brokenOff: true }`, and the battle result reads "Broken off" with no defeat stamp.

Break-off is opt-in, through the constructor's `breakOffTurns` (`BREAK_OFF_TURNS` is 3). Battles built as test harnesses and the AI evaluators bound fights with `maxTurns` and read anything not won as lost, so a default break-off would change what they measure. The combat screen's skirmish and the raider sim turn it on. Campaign fights turn it on with the run's half of this item: until `SupplyRun.finishStopFight` and the bridge's write-back know a broken-off fight, it would read as a loss and fail the run.

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
