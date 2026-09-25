# Enemy intent planning

## Date
2026-09-25

## Context

Raiders showed a hardcoded "attack 5" intent and chose their cards fresh during the enemy turn, so what the player saw had nothing to do with what happened. DDB-132 moves the choice to the start of the player's turn: each raider commits its whole turn, with a type, value, and target per card, and the enemy turn plays that plan. Battle Screen Design (sections 3, 6, and 8) and AI System Technical Design section 6 cover what an intent shows and how elites and bosses hide it. Neither says what a raider plans against or what happens to a plan once the player's turn has changed the board. Both questions went to Kevin, and he made both calls.

## Q1: a plan the board has outgrown

Between planning and the raider's turn, the player can flank out of range, speed past a raider's planned flank, or slow a raider off the shoulder so it drops back at the end of the turn. An earlier raider can also wreck the planned target during the enemy turn.

### Options considered

1. **Fizzle.** The card is spent and does nothing.
   - Pros: dodging is real counterplay, and an intent is an exact promise.
   - Cons: a raider also loses its card when another raider wrecked its target, which the player did nothing to earn.
2. **Retarget.** The same card picks another legal target and fizzles only if there's none.
   - Pros: raiders keep up the pressure.
   - Cons: dodging mostly pushes the damage onto the partner.
3. **Replan.** The raider chooses fresh from its remaining hand.
   - Pros: the strongest AI.
   - Cons: intents become soft, and the end-turn preview can lie.

### Decision (Kevin, 2026-09-25)

Split by cause.

- When the player caused it (moved out of range, outpaced a planned flank, or slowed a flanker so it dropped back), the card fizzles: it's spent, does nothing, and the combat log says why in plain words.
- When the target was wrecked during the enemy turn, the card follows the wrecked driver to the vehicle they now ride in as a passenger, and fizzles if there's no such vehicle.
- A raider that is itself wrecked, or has lost its driver, drops the rest of its plan.

## Q2: what a raider plans against

The AIs pick one card at a time against the board as it stands. The aggressive AI, the combat screen's default, flanks first and then attacks, and a flank moves the raider from range 1 of your inside lane to range 2 on your shoulder.

### Options considered

1. **Whole turn, current board.** Cheap, but anything planned after a flank is judged from the old slot and often fizzles.
2. **Whole turn, projected board.** Each planned card is applied to a scratch projection, so a later pick sees the board after a flank or a Nitro Boost.
3. **One action per raider.** Intents are always accurate, but it cuts raider output, which is a balance change.

### Decision (Kevin, 2026-09-25)

Option 2. The projection tracks only slot, flank state, and speed, and it doesn't clone the Battle.

## Implementation

- `mechanics/BoardProjection.ts` holds the projection: slots, flank state, and speed, plus each driver's hand and adrenaline as bookkeeping (spent on each pick, topped up by adrenaline cards). Planning never touches the Battle. A fresh projection is the live board, so `Battle.getFlankBlocker` runs through the same code, and the flank rules exist in one place.
- `AIPlayer.makeDecision(board)` decides against whatever board it's given, the live board by default. Each strategy reads slots, flanks, speed, hand, and adrenaline through it. `AIController.planEnemyTurn()` loops the enemy AI over each raider in team order, which is the order they act, against one shared projection. With no enemy AI set, `FirstPlayableAI` plays the first playable card, which is what the old fallback did.
- `Battle.planEnemyTurn()` runs after the draw in `start()` and in `startPlayerTurn()`. `Battle.getPlan(raider)` returns the committed cards. `Battle.getIntents(raider)` turns them into `{ type, amount, hits, label, target, description }`.
- The attack value is computed when it's read. It uses the raider's projected flank state and speed at that step, plus the target as it is now, so a Vulnerable the player picks up after planning shows in the number.

## Smaller calls

These are the four minor calls from the original report. Kevin accepted all of them.

- The intent types are AI System 6.1's five, buff included. The board item leaves buff out, but self-buffs (Flank, Nitro Boost, Berserker, Witness Me) need a type other than unknown.
- `enemy_all` cards target `'both'`, per Battle Screen Design section 3.
- Multi-hit is damage per hit times a hit count. The count is 1 until card data needs more.
- `Vehicle.intentTier` defaults to basic. Elites hide the value, the buff or debuff label, and the card name (shown as "???"). Type and target stay visible. Bosses behave like elites until bosses are designed.

These calls were mine and are listed in the PR:

- Cards a raider draws mid-turn, such as with Nitro Boost's draw, go unplayed.
- A planned self-targeted card now lands on the raider's own vehicle. The old enemy path passed no target, so Repair Kit and Armor Plating did nothing for raiders.

## Consequences

- An intent is a promise the player can break, and the log names how it broke.
- The enemy turn is synchronous. It no longer awaits AI decisions, since the decisions were all made at planning time. DDB-112's pacing will add awaits between raiders, not inside the AI.
- `AIController.getEnemyDecision` is gone. Tests that rig a raider's hand after `start()` call `battle.planEnemyTurn()` again.
- Nothing about the projection is specific to raiders, so a player-side preview could use it later.
