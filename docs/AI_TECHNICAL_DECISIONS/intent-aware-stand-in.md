# Intent-aware player stand-in

## Context

The balance sim (docs/specs/Balance Simulation.md, Player stand-ins) wants two player AIs: the aggressive AI as the floor, and an intent-aware one as the ceiling that reads the raiders' committed plans and the projected board before each card, and plays to cut next turn's damage or take the kill that removes the biggest intent. One step, no search, no copy of the battle. DDB-528.

## Options considered

- Re-project the enemy turn per candidate card. `Battle.getAllIntents` projects the enemy turn from the board as it stands and Battle offers no way to hand it a hypothetical one, so this means a battle copy or new Battle hooks. Ruled out by the spec, and mechanics/ is another session's.
- Score each card against the intents as they stand, with a small model of what the card changes. Cheap, needs nothing new from Battle.
- Score only intents and drop the aggressive scoring. Loses flanking, which the aggressive AI already values and a one-step harm count can't see.

## Decision

`IntentAwareAI` (_legacy/src/renderer/game/ai/IntentAwareAI.ts), registered as player AI type `intent`. Before each card it reads `getAllIntents` once, matches each intent to its card in the raider's plan (`getPlan`), runs the raider's hit check, and turns every attack that will land into a hit on a player vehicle. Each legal play (`generatePossibleActions`, the same set every AI draws from) is scored by the harm it keeps off the convoy, where harm is what those hits do to structure and occupant hitpoints through Shield and armor (`splitDamage`, the battle's own rule):

- a kill (wreck, or the driver dead) or a stun drops that raider's hits, judged from the vehicle Battle resolves the card from (the caster, an attack order's carrier escort, or each escort Rally the Convoy fires), with the battle's deterministic `checkHit`;
- Shield, armor (uncapped), repair, and driver heals change what the hits find;
- a play that changes the board (a swerve, shove, swap, drop-back, or flank, a speed change, Box In, Evade) is scored against `getAllIntents({ preview })` for that play, Battle's own projection of the enemy turn with the card landed, and each hit's check is rerun with the Evade the preview board has, so a hit that would fizzle, lose its flank bonus (a flanker outpaced so it drops back), or miss is off (DDB-553, [movement-cards.md](./movement-cards.md));
- Vulnerable is the floor's `vulnerableSetup`, half the damage the rest of the turn's hands can still deal its raider, scored through the floor's score below;
- non-lethal damage gets a share of the hurt raider's harm, so the target with the most harm per point of toughness is preferred.

The aggressive strategy's score is added on top, so with no threat at stake it plays as the floor does, except that damage whose hit check fails scores nothing, and a move that does nothing or does harm, or a guard (Weave, a bare Shield) that keeps nothing off, scores under ending the turn.

The attack-type rule (`attack_type`, else ramming scaling, else ranged) is a third copy, after Battle's damage path and the aim preview's; sharing it means an export from mechanics/, left for whoever next owns that code.

## Trade-offs and consequences

On the jest sample (six crews on their starting decks, three skull counts, two seeds, 36 fights a side; `IntentAwareAI.test.ts`), after DDB-553, it wins 27 and stalls 6 and loses 23.5% of the crews' HP, against the floor's 25 won, 5 stalled, and 38.5%, on DDB-552's raider decks. When DDB-528 built it, on the encounters of the day, the two tied at 20 won and 8 stalled, 29.2% HP lost to 28.9%. Most outcomes are still fixed by crew against encounter: solo drivers lose damage races at 2 and 3 skulls that no card order wins, and a Mechanic's EMP stalls fights against raiders nobody can reach. The unit tests pin the choices where it does differ from the floor: the kill on the bigger intent, armor before chip damage, a stun, outpacing a flanker, and no credit for a shot that misses.

It still can't value a flank's boost to the rest of its own turn. DDB-553 moved it onto Battle's preview of a hypothetical board, which replaced a drop-back model that couldn't tell when a dropped flanker fell out of range (call 244, retired with it).

## In the C++ alpha

`ai::IntentAware` (2026-10-30, DDB-572) keeps these rules and numbers, and [battle-state.md](./battle-state.md), The other policies and whole fights, has how. What differs:

- The fight is cheap to copy, so the option the TypeScript ruled out is the one built. Each play goes onto a copy of the board and the enemy turn is played out behind it, the projection the intents are read from, and the harm is read off what that turn does. That covers the kills, stuns, guards, moves, speed, Evade, Draw Fire, and fizzles the TypeScript modelled one by one, and the attack-type rule isn't copied anywhere.
- A raider the play would bring in early counts as 5 harm (call 389), and a turn that would break off has no harm to cut (call 386).
- The TypeScript's score for driver HP restored that no hit was about to take is gone. A heal counts for the harm it keeps off, which is a driver it keeps from going down.
- It's bound by name as intent_aware, for the player's seats only.

## Provisional calls

Logged in docs/gameplay-calls.md as 240 to 243, for Kevin to approve or change.

240. Hidden elite intents are read from the plan, card and damage, which is more than a player sees.
241. Harm is structure plus occupant hitpoints, with a wreck or a dead driver counting 20 more.
242. Non-lethal damage counts for half a turn of the raider's harm per share of its toughness; weighted higher it outbid Flanking Maneuver.
243. Everything the harm count doesn't cover is scored as the aggressive AI scores it.
