# Battle screen road model

## Date
2026-09-25

## Context

The combat screen was a proof of concept that didn't fit on screen and didn't read as the game. Captured at seven viewports and played through with a script, it showed: the hand needing 1600px for ten cards and running off both edges, cards clipped vertically with 12% of the screen empty underneath, the enemy and player bands facing each other with reversed labels, fronts on a diagonal so range meant nothing, driver HP (the loss condition) in 8px grey, a hardcoded "attack 5" intent, and rarity borders in the other driver's colour. The bugs are filed under DDB-5 (DDB-111 to DDB-126).

The design docs also disagreed with each other and with the code on things the screen has to show: one adrenaline pool or two, one deck or two, flanking at 2x or +50%, and whether losing a vehicle takes a driver out of the fight.

Constraints: 16:9 first, down to 1280x720, with the Steam Deck (1280x800), 21:9, and 4:3 all working; a text floor of 18px at 1080p for card rules; two drivers each with their own hand; room for the friendly convoy to grow past two vehicles later; and an engine being rebuilt under DDB-55, so the design has to be expressible as that engine's stacks and anchors.

## Options considered

1. **Mirrored bands (the existing screen).** Enemy band on top, player band below, each split Flanking / Back / Front.
   - Pros: already built.
   - Cons: the two fronts sit on a diagonal and range can't be read off the screen; the labels were already wrong once; vertical space is split three ways before anything is drawn.

2. **Face-off road (rev 1 of this design).** One road read left to right, your convoy facing theirs, distance across the screen as range, a full-width flank lane above.
   - Pros: range is visible; conventional (Slay the Spire's left-versus-right).
   - Cons: vehicles face each other, which isn't the fiction: a raid on a moving convoy has everyone driving the same way. The flank lane took 42% of the road's height permanently to hold zero or one vehicle most turns.

3. **Lateral lanes with occupancy-sized widths (rev 2).** Same-direction freeway, positions as lanes across the road, lane widths solved from how many vehicles each lane holds, flank positions as narrow shoulders.
   - Pros: the fiction is right; empty flanks cost 48px instead of a band.
   - Cons: lanes change width whenever someone moves, so the board doesn't hold still between turns; the player side is sized for two vehicles and can't grow.

4. **Fixed grid: two formation lanes by three rows per side, plus a shoulder for the other side's flankers (chosen).** Kevin's direction: inside lane, outside lane, and shoulder on each side of the road, each with ahead, center, and behind; the shoulder only for flankers from the far side.
   - Pros: slots never move, so a plan made last turn still matches the board; both sides get equal space, so a friendly convoy of nine reads as well as a raider pack of nine; the worst case is simply "every slot full", which is easy to test; ahead and behind give positioning a second axis.
   - Cons: vertical tokens don't fit three rows, so the vehicle token had to be redesigned with the sprite beside the plate; empty slots are visible space most of the time.

## Decision

Option 4, specified in [docs/specs/Battle Screen Design.md](../specs/Battle%20Screen%20Design.md). Along with it, these rules calls, which Kevin delegated with "pick an answer based on what you think will be the best for enjoyable gameplay", except the first, which was his:

- A flanker takes the row of the vehicle it outran (Kevin's call).
- The flanker's old formation slot stays empty; the convoy doesn't close up.
- Range is lanes apart plus rows apart.
- Hand cap 7 per driver, extra draws burn to discard.
- Two driven vehicles at most; the convoy grows through escorts ordered by cards.
- Two adrenaline pools and two decks.
- A wrecked vehicle's driver becomes a passenger who keeps their hand and can't attack.
- Flanking is +50%; the same driver can't fill both slots.
- Every card has a short text (card face, three lines) and a full text (detail view, 330 characters) (Kevin's ask).

## Rationale

- **Nothing moves that you didn't move.** That's why slots are fixed and why the convoy doesn't close up behind a flanker: a board that rearranges itself between turns breaks the plan you made, which is the core pleasure of a deckbuilder turn. The gap a flanker leaves is also the cost of flanking, which turns it from a free damage bonus into a trade.
- **Straight grid distance over diagonal distance.** With only range 1 and 2 cards, counting a diagonal as 1 would make rows almost irrelevant. Lanes plus rows keeps Combat Rules' own numbers (inside to inside 1, flanker to their inside 2) and gives ahead and behind a job: pull ahead of a rammer, drop behind to line up a shot.
- **Seven cards, two hands.** Three hands would be 15 cards a turn, the load Across the Obelisk players complain about with four heroes, and would squeeze each card to about 39px. Ten cards per hand (reachable today with Nitro Boost, since nothing caps it) fits but shows 46px per card; seven keeps 68px, enough to read most names. Two hands is the Symbiotic Driver System; escorts let the convoy grow without growing the hand.
- **Passenger, not spectator.** Sitting out the rest of the fight (Gameplay's "Lone Wolf") is dull in single player and awful in co-op. Combat Rules and the code already had the passenger model; Gameplay was the outlier.
- **+50% flanking.** The cards and the code say +50%; 2x on top of the range advantage flanking already buys would make it the only play.
- **Short and full card text.** Hands have to be scannable at 12px, but a three-line limit shouldn't cap what a card can do. Splitting the fields lets the face stay short and keyword-driven while the full text carries conditions and edge cases.
- **Check it, don't assert it.** The mock renders every scenario at every viewport and measures overflow, collisions, scaling, and slot rules. Two rounds of review found worst cases the author had missed (both vehicles sharing a lane at the start of every fight, passengers, flank rows), so the check exists to catch the next one.

## Consequences

- Combat Rules changes shape: positions become slots, range becomes a formula, and `VehiclePosition` in `mechanics/Vehicle.ts` becomes a lane and a row. Everything that reads positions moves with it: `Battle.ts`, `AIEvaluator.ts`, `AggressiveFlankerAI.ts`, `MCTSAI.ts`, `src/battle-simulator.ts`, and the three battlefield layers.
- `cards.json` gains a required short-text field, and every existing card needs one written. Eleven of today's eighteen descriptions don't fit three lines; the mock has rewrites for all of them.
- Enemy intents need to be planned in the model with a target before the player's turn, not hardcoded (DDB-33).
- The enemy turn needs pacing (DDB-112) before the enemy-turn state means anything.
- DDB-82 (phase 4, combat screen as the first stack consumer) changes from 25/40/20/5 bands to top bar, road, and dock. DDB-88 (phase 6) builds the dock, detail view, and targeting described here.
- Escorts, and whatever cards order them, are a new system with no design yet beyond "slots and plates, no hand".

## Implementation notes

- The mock is `docs/design/battle-screen/index.html`: plain HTML and JavaScript, its layout function is the one described in the spec, and its `lint` function is a sketch of the checks the real screen's Playwright suite should make. It is a design artifact, not engine code.
- The six worst-case scenarios in the spec's section 10 are the ones to port as gallery scenes.
- Code shape (DDB-128/129): `mechanics/Road.ts` is pure road geometry and lane rules; `Vehicle.slot` is absolute (six named lanes) rather than team-relative, so range is a function of two slots and needs no team lookup; `Battle` is the only thing that moves a vehicle, which is where slot uniqueness and the shoulder rules are enforced. Flank drop-back runs at the end of every turn: `endCombat` only runs when the fight is over, where a positional rule does nothing.
