# The result screens: a fight's result, the debrief, and the campaign's end

## Date
2026-11-06

## Context

Three scenes report what just happened: a fight's result, the run debrief (Game Flow 6.1), and the campaign's end (6.3). The alpha had the debrief and the end as placeholder rows on ui's default tokens, and no fight result: the battle scene's footer said "Won" and the run's notice said "The fight is won." The TypeScript had a battle result screen between the fight and the run, a debrief inside the run screen, and a defeat screen ([`_legacy/src/renderer/game/screens/battleResult`](https://github.com/kcjonson/dual-deck-builder/blob/0a912c7457093b893b47656277b0894e8f50a48b/_legacy/src/renderer/game/screens/battleResult), `defeat`, and `run`).

UI Art Direction puts results where W3 earns its place: a defeat is a burnt sheet, and what was lost or cleared gets its stamp. The first launch also turned up two wording slips here: the cargo line read "6 food, 4 water, and 5 fuel, 1 card won", and the debrief said a driver was in the infirmary "for 2 days" while the compound right after said "fit in 1 day".

## Options considered

Where a fight's result goes:

1. **Inside the battle scene,** at its end. The battle screen gets its own port and keeps the dark theme, and the fight doesn't know what writing it back does to the run (the down revived, the haulers' pay, the escorts that leave).
2. **A scene the run pushes after the write-back (chosen),** for a fight won or broken off. A lost fight ends the run, so its result is the debrief, stamped LOST, rather than two screens in a row.

Where the debrief gets what it names:

1. **The run scene passing more,** the destination and the escorts it had. The run scene is being rewritten in parallel.
2. **What the rules already return for the debrief carrying it (chosen):** `Unloaded` names the POI cleared and the seats, `RunLost` the POI and the escorts lost with it, which the convoy no longer holds by the time the debrief opens.

## Decision

The three share `scenes/result/ResultPage`: one sheet, the heading at the top left (a mono kicker, the title in the screen title's face, a line of story, and the stamp beside them), a body of legend boxes side by side that wraps and scrolls when the window is short, and the foot with the one highway at the right and a line, if any, at the left. The heading and the boxes keep to the left, so a burn at the sheet's top-right corner never sits on what's read.

- **A fight's result** (`battle_result`): "Fight won · 1 skull · 6 turns", "The road is clear" or "The raiders broke off", then After the fight: who went down and was revived or crashed out and was picked up, with their HP, who the haulers patched up, what they paid into the cargo, and the escorts wrecked, or "Everyone drove on as they were." Back on the road pops it. W2, no stamp: nothing was lost.
- **The debrief**: "Home from Millbrook" stamped LOOTED, its story the cargo in one line, then Unloaded (the stores as a strip of what came in, the cards to the locker, who was found or joined), The crew as each stands after the night, and The night. A failed run is "Lost on the road to Millbrook" in Stronghold red, stamped LOST, its story who's dead and missing, then Lost with the run (the dead and missing, the cargo, the escorts, who it found, the cards that went with the dead) and The night. An abandoned one is "Abandoned on the road to Millbrook", stamped LOST too, its story opening "The crew abandoned the fight." ([abandoning-a-run.md](./abandoning-a-run.md)). The sheet stays W2: the stamp is the run's hero mark.
- **The campaign's end**: the sheet burnt at its top-right corner (the paper hook's W3 burn), "Fell on day 12", the fall as the title in red with FALLEN struck beside it, the cause and how it fell as the story, then The last day (the log's latest four lines dated the day it fell, the fall's with a diamond) beside the Campaign record (days held, runs, fights, drivers lost, strongholds taken, what the compound held at the end, and the seed).

The cargo is worded once, by the rules: `cargoText` gives "6 food, 4 water, 5 fuel, and Headshot", resources then cards by name, and the log, the debrief's story, and a lost run's cargo row all use it.

The infirmary: the rules were right. The night home is the first day in the infirmary ([injuries.md](./injuries.md)), so a driver home 15 HP down is out 2 days at arrival and 1 after the night. The debrief shows the night, so it now reads each driver's record after it, in the compound's words (`driverStanding`): "fit in 1 day".

The log: a run home writes "A run came home with 6 food, 4 water, 5 fuel, and Headshot." (or "A run came home empty."), and a lost run "A run was lost: Road Warrior 1 is dead and Interceptor 1 is missing." before its cargo line, or "A run was abandoned:" for one the crew gave up. The compound already shows the five newest.

## Trade-offs and consequences

- The run scene's fight hook is one push after the write-back; whoever rewrites the run keeps it.
- The log names no destination: `unloadRun` and the write-back don't take the map, and the POI's name is the map's (`poiNames`). The debrief names it from the session.
- A quiet night writes "A quiet night." to the log, decided (call 113), only when the day logged nothing else (no haul, shortfall, run home, recruit or loss) and no driver healed.
- The stamps and the burn are the art's first pass: the intent, not the mock's pixels.

Provisional UI calls, each a line to change:

- A won or broken-off fight gets its own result screen; a lost one goes straight to the debrief.
- The debrief stamps LOOTED on every run home on a route, since it clears its POI, and no injured driver's tag is torn: one hero mark a screen.
- The campaign's end is both burnt and stamped FALLEN.
- The highway takes focus on each result screen, so Enter goes on. Escape does nothing yet.
