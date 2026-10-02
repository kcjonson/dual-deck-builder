# Enemy turn pacing (DDB-112)

## Problem

`Battle.endPlayerTurn` played the whole enemy turn synchronously, through to the player's next draw, so 16 ms after END TURN the screen was on turn 2: HP had dropped, nothing had shown what hit it, and END TURN was never locked. Battle Screen Design section 6 wants the enemy turn as a state of its own: the dock locked, raiders acting one at a time, each hit landing visibly.

## Options

1. **Make the battle asynchronous** (await a delay between actions). Every headless caller (the simulator, the AI evaluator, the AI controller, hundreds of mechanics tests) would have to await timers, and timers are banned in UI code anyway (R8.28): the delay belongs to the frame clock, which the battle doesn't have.
2. **Replay a finished turn.** Run the turn at once, record events, and play the record back on screen. The model would be on turn 2 while the screen still shows turn 1, so anything reading the battle (intents, hands, `isPlayerTurn`) would be ahead of the picture, and the draw would already have happened.
3. **Step the turn from the model, pace it from the screen.** The battle queues the plan and plays one action per call; the screen calls it on beats of the frame clock.

## Decision

Option 3.

- `Battle.endPlayerTurn({ stepEnemyTurn: true })` ends the player's turn (discard, drop-backs, `turnEnded`) and queues every raider's planned cards in play order, without playing any. `stepEnemyTurn()` plays the next one and returns an `EnemyTurnStep` (`raider`, `card`, `target`, `outcome`: played, fizzled, or dropped). After the last action the next call finishes the enemy turn (logs, drop-backs, wrecks off, `startPlayerTurn` with its draw and `stateChanged`) and returns null. `enemyTurnInProgress` is true in between. A raider that gives up its plan (wrecked, driverless, stunned) is one `dropped` step and its other cards are skipped without one.
- `endPlayerTurn()` with no options runs every step at once (`runEnemyTurn`), so the simulator, the AI, and every test keep the old synchronous behaviour with no change. It is synchronous now; the old `async` signature never awaited anything.
- The player's draw is the last thing a turn does, so it can't run ahead of an action still to be shown, and `stateChanged` (which the screen uses for YOUR TURN) fires once, after it.
- `CombatScreen` drives the steps with `EnemyTurnPacer`, a `FrameTicker` on `context.frame` and `context.clock`. The first action plays `ENEMY_TURN_LEAD_IN` after ENEMY TURN shows (the banner's lifetime less one motion duration, as it starts to leave; END TURN pressed while YOUR TURN is still up adds that banner's exit, `TurnBanner.timeToNext`), each action after `ENEMY_ACTION_BEAT` (700 ms), and the turn ends one beat after the last. Both numbers are in Battle Screen Design section 6. A beat is shorter than a floating number's life (900 ms), so numbers on one vehicle overlap: `CombatFxLayer.popNumber` gives each the lowest stack slot no live number on that vehicle holds, and ids from a counter that only goes up. A `dropped` step takes no beat; a `fizzled` one pops MISS on where it was headed, and hits and misses pop through the existing `hitLanded`/`hitMissed` numbers. Reading time, so reduced motion keeps every beat and only the numbers' rise and fade go.
- While the turn is in progress, and once the battle is over, the dock is disabled (`enabled = false`, so its cards, piles, and End Turn take no input and show their disabled look), End Turn reads WAIT, and a second END TURN does nothing. DDB-139 drops and greys the dock and restyles WAIT.
- The intent rows keep the plan shown at END TURN while it plays.
- `CombatScreen.actingRaider` is the raider whose action is on screen, null outside the enemy turn: the hook for DDB-139's glow.

## Trade-offs

- The plan is consumed when the enemy turn starts, so `getAllIntents` is empty while it plays. The screen keeps the intents it showed at END TURN until the player's draw brings the next plan, so the raiders' plan stays over them while they play it (and an empty intent row never sits at zero size, which the lint gate fails). DDB-139 can tick them off as raiders act.
- A loss on a step navigates away through the screen transition, so the screen stays mounted under the fade: the beat that lost returns no next beat and the dock stays locked. The pacer stops on unmount.
- The golden of the mid-turn state (`screen-combatScreen-enemyTurn`, both gate sizes) gets there by resuming the paused page for the frames END TURN takes and pausing on the first frame End Turn reads WAIT. It depends on the lead-in (900 ms of frame time) outlasting those frames, which advance at most 250 ms each.
