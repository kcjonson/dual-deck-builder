# Intent-aware player stand-in

## Context

The balance sim (docs/specs/Balance Simulation.md, Player stand-ins) wants two player AIs: the aggressive AI as the floor, and an intent-aware one as the ceiling that reads the raiders' committed plans and the projected board before each card, and plays to cut next turn's damage or take the kill that removes the biggest intent. One step, no search, no copy of the battle. DDB-528.

## Options considered

- Re-project the enemy turn per candidate card. `Battle.getAllIntents` projects the enemy turn from the board as it stands and Battle offers no way to hand it a hypothetical one, so this means a battle copy or new Battle hooks. Ruled out by the spec, and mechanics/ is another session's.
- Score each card against the intents as they stand, with a small model of what the card changes. Cheap, needs nothing new from Battle.
- Score only intents and drop the aggressive scoring. Loses flanking, which the aggressive AI already values and a one-step harm count can't see.

## Decision

`IntentAwareAI` (src/renderer/game/ai/IntentAwareAI.ts), registered as player AI type `intent`. Before each card it reads `getAllIntents` once, matches each intent to its card in the raider's plan (`getPlan`), runs the raider's hit check, and turns every attack that will land into a hit on a player vehicle. Each legal play (`generatePossibleActions`, the same set every AI draws from) is scored by the harm it keeps off the convoy, where harm is what those hits do to structure and occupant hitpoints through Shield and armor (`splitDamage`, the battle's own rule):

- a kill (wreck, or the driver dead) or a stun drops that raider's hits, judged from the vehicle Battle resolves the card from (the caster, an attack order's carrier escort, or each escort Rally the Convoy fires), with the battle's deterministic `checkHit`;
- Shield, armor (uncapped), repair, and driver heals change what the hits find;
- a speed change that leaves a flanker no faster than the vehicle it outran, checked on a `BoardProjection` with the card applied, takes the flank bonus off its hits;
- non-lethal damage gets a share of the hurt raider's harm, so the target with the most harm per point of toughness is preferred.

The aggressive strategy's score is added on top, so with no threat at stake it plays as the floor does, except that an attack whose hit check fails scores nothing.

The attack-type rule (`attack_type`, else ramming scaling, else ranged) is a third copy, after Battle's damage path and the aim preview's; sharing it means an export from mechanics/, left for whoever next owns that code.

## Trade-offs and consequences

On today's encounters (six crews, three skull counts, two seeds, 36 fights a side) it ties the aggressive AI on outcomes, 20 won and 8 stalled each, and loses 29.2% of the crews' HP to the floor's 28.9%: on a few fights it plays armor before damage that would have ended the fight sooner, which one step can't weigh. The outcomes are fixed by crew against encounter: solo Road Warrior and Interceptor lose damage races at 2 and 3 skulls that no card order wins, and every Mechanic loss is a stall where EMP keeps a raider stunned that nobody can reach. The unit tests pin the choices where it does differ from the floor: the kill on the bigger intent, armor before chip damage, a stun, outpacing a flanker, and no credit for a shot that misses.

Until Battle can preview a hypothetical board, the drop-back model can't tell when the dropped flanker falls out of range, and the stand-in can't value a flank's boost to the rest of its own turn.

## Provisional calls

Logged in docs/gameplay-calls.md as 240 to 244, for Kevin to approve or change.

240. Hidden elite intents are read from the plan, card and damage, which is more than a player sees.
241. Harm is structure plus occupant hitpoints, with a wreck or a dead driver counting 20 more.
242. Non-lethal damage counts for half a turn of the raider's harm per share of its toughness; weighted higher it outbid Flanking Maneuver.
243. Everything the harm count doesn't cover is scored as the aggressive AI scores it.
244. An outpaced flanker loses its whole flank bonus (hits divided by 1.5, rounded up) and stays in range.
