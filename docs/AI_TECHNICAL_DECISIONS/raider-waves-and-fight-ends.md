# Raider waves and how fights end

Context: the Runs and Encounters design (epic DDB-519) makes a fight a group of raiders arriving in waves, with four raider-side rules that keep groups fair against the starting cards: close-up, shake-off, rout, and break-off. The rules are in [Combat Rules](../specs/Combat%20Rules.md) (Reinforcements, Raider formation and stuns, How a fight ends). This records how they're built in `mechanics/Battle.ts` and what was measured.

## Close-up and shake-off (DDB-522)

Close-up runs in `finishEnemyTurn`, after `dropBackFlankers` and `clearWrecks` and before the player's turn starts, so raiders plan from the slots they'll fight from and no plan is made from a slot that then changes. It reads the road as it stands: a raider in formation (no `flank`, so neither a flanker nor an ambusher) that isn't already in a close-up slot moves to the nearest empty one, by `nearestTo`, the same range and tie order attack orders use. A slot someone holds or has reserved is skipped.

Options for shake-off were a hidden counter on the vehicle, a rule in the EMP card, or a status. A status (`steady`, duration 1) won: it ticks with every other status, shows as a chip without new UI, and the preview needs nothing new, since a Steady raider never gets `stunned` and the preview already drops a stunned raider's intents. It's applied in `startPlayerTurn` to each raider whose stun wore off in that tick, and `applyStatus` refuses `stunned` on a Steady vehicle with a log line.

Measured with `scripts/raider-sim.mjs` (seed 1, 100 runs, pairs): close-up alone lifts the Road Warrior and Interceptor from 50% to 84% at 3 skulls, where the second Rust Buggy used to sit out of the Rig's reach. Shake-off ends the EMP lock the Mechanic held on the lone Spike Buggy (99% won with 1% HP lost becomes 0%), which is the unfair fight the rule is for; one-raider encounters go with the encounter templates (DDB-328).

## Provisional calls

Numbers 190 to 209 in [gameplay-calls.md](../gameplay-calls.md).

- 190: across from means the inside slot in a driven vehicle's row, Driver 1's row first.
- 191: Steady's chip is a green check.
