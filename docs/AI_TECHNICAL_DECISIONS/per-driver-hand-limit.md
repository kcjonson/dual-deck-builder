# Hand limit as a per-driver stat

## Date
2026-10-06

## Context

DDB-285 (epic DDB-274). The hand cap was `HAND_CAP = 7`, a module constant in `mechanics/Driver.ts`. `Driver.drawCards` burned every card drawn past it, and the dock tests and the battle fit suite (DDB-141) read the same constant as the most cards a half of the dock holds. So one seven was doing two jobs: a rule (how far a draw fills a driver's hand) and a layout bound (how many cards a half of the dock is designed and checked for).

Compound and Supply Runs (Decks and the locker) makes the hand limit a driver stat: it starts at 7 for every archetype, and archetypes, mods, or upgrades can change it. The campaign's persistent driver, `DriverRecord`, doesn't exist yet; DDB-282 adds it and DDB-286 passes its limit into the combat `Driver`. This change gives the combat `Driver` its own limit so that bridge has somewhere to put it.

## Options considered

1. **Keep one constant for the rule and the dock.** Can't differ per driver, which is the point.
2. **A per-driver limit, clamped to the dock's 7** (in the model, or when the screen seats a driver).
   - Pros: the dock never holds more than it was designed for.
   - Cons: a rule capped by a layout constant, either mechanics importing a screen constant or a screen rewriting a rule. A mod granting +2 cards would do nothing in combat, with nothing to say why.
3. **A per-driver limit and a separate dock constant, no clamp (chosen).**

## Decision

- `handLimit` is a `Driver` model property, so setting it emits `handLimit` and `change` like `maxAdrenaline`. `DriverConfig.handLimit` is 7 for every archetype. The constructor takes `handLimit` as an optional named option and, without one, uses `DRIVER_CONFIGS[archetype].handLimit`. `DriverLoader` passes the config's value, and `copy()` carries the driver's own.
- `drawCards` fills the hand to `this.handLimit` and burns the rest to discard, with the `cardsBurned` event and the battle log line as before. The limit only acts on draws, which are the only way a card reaches a hand in play: a limit lowered under the current hand discards nothing, and every draw burns until the hand is back under it; a raised limit counts from the next draw.
- `DOCK_HAND_CAP = 7` in `screens/combat/CombatLayout.ts` is the dock's design bound per half (Battle Screen Design, section 4). The fit suite's hand-cap check and the dock tests read it, and `HandFan` turns its fan more gently past it, the same seven the mock's `fanHand` uses.
- Past the dock's cap, nothing clamps. `HandFan` already overlaps any number of cards to fit its half (DDB-183), so every card stays inside the half, on screen, and clickable, with less of each showing: about 43 logical px at ten cards, against about 68 at seven. That's undesigned and unchecked, so the fit suite still fails a half over seven, and Battle Screen Design section 9 says a limit past 7 means revisiting section 4. `CombatScreenDock.test` raises a driver's limit to ten before the screen seats them, draws to it, and holds the fan inside its half at lint zero at both gate sizes.
- Whether archetypes start at different limits is an open question (Compound and Supply Runs, open question 3; DDB-317). Every config says 7 until it's decided.

## Consequences

- DDB-282 puts `handLimit` on `DriverRecord`, and DDB-286 passes it through as `new Driver({ ..., handLimit })`. A combat driver built without one (the gallery's player drivers, most tests) keeps their archetype's. Raiders borrow a player archetype (the live fight's is a Mechanic, the gallery's are the Raider), so they set 7 themselves and a per-archetype value can't change their draws.
- The first archetype, mod, or upgrade that takes a limit past 7 needs a dock design pass before it ships. The fit suite fails any half over `DOCK_HAND_CAP`, and Game Flow 8.1's keyboard shortcuts ("Number keys 1-7 select cards in hand") assume seven too.
- The AIs value a draw by the cards it keeps under the drawer's limit, and nothing for a card it burns ([ai-draw-value.md](./ai-draw-value.md)).
- The combat tab doesn't show the limit. The Crew screen and the driver card (Game Flow 3.2 and 7.0) will.
