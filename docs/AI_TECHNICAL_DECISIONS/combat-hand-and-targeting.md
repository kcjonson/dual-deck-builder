# Combat hand, targeting, and turn feedback

Status: decided 2026-09-28 (fan, previews), 2026-10-01 (targeting, damage numbers), 2026-10-02 (banner, intents, discard flights), DDB-88 (DDB-55 phase 6). Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) sections 4 to 6 and the mock at `docs/design/battle-screen/index.html`.

## Context

Phase 6's combat line asks for the hand as a stack with a negative gap and `transform` for the fan, `zIndex` and `raised` for hover lift through the animator, drag targeting through the drag service with `dragenter` highlights and a preview line in `overlay`, and card previews through the tooltip factory. #103 (DDB-82) put the dock on stacks with a negative-gap row per driver; everything else was click-then-target with a 5 px snap lift. DDB-127's tasks own the design-exact dock (DDB-136), the card face and pinnable detail view (DDB-137), and per-slot range chips and the hit check (DDB-138), so this work builds the mechanisms on today's screen and leaves those to land on top.

## Decisions

### The fan is each card's transform

`fanPoses(count)` is the mock's `fanHand`: 0.9 degrees per step from the middle (0.5 past seven cards) about the card's bottom centre, and a drop of `min(5, 0.6 * step^2)` logical pixels. `Card.fanPose` holds it and `Card` composes it with its lift into one transform, since a component has one transform and the lift has to straighten the card out of its pose. The row's negative gap subtracts the edge cards' lean (`180 * sin(turn)` in card units per side), which is what keeps a rotated edge card's corner inside its half.

Considered: rotating a wrapper per card. It would split the pose and the lift between two components for no gain and double the hand's node count.

### The lift is a tween, the layer follows it

`Card` tweens one number from 0 to 1 on the animator (`dur_fast`, retargeted, so a sweep over the hand reverses mid-flight instead of snapping) and derives the transform, `layer: 'raised'` and `zIndex: 1` from it on every update. While the value is above 0 the card paints and hit-tests over its neighbours and the driver tab. Keyboard focus lifts a card as hover does, so its focus ring clears its neighbours (the DDB-76 note).

A lifted card keeps the strip it rose out of in `containsPoint`. Without it, a pointer resting on a card's bottom 14 px lifts it off the pointer, drops it back under, and lifts it again every frame.

### Previews are a tooltip factory, anchored to the card

The preview is `Card` at `LARGE` with its full rules text (`fullText`), scaled by the stage's scale inside a frame so the card's own transform stays free for its lift. The tooltip service placed every tooltip below-right of the pointer, which put a 336-tall card over the neighbouring cards. R12.22 says placement is "default below-right of the pointer", so `TooltipSpec.placement` adds the rest: `anchor` (`pointer` or `owner`), `side`, `align`, still through the placement service's flip and clamp. Hand cards ask for `owner`, `top`, `center`.

This is a stand-in for section 5's detail view (DDB-137), which is anchored to the screen's bottom, pinnable, and has keyword boxes.

### The drag's ghost is a reticle; the line is read at paint time

The mock keeps the dragged card in the hand, lifted, with a dotted line to the pointer. The drag service moves a ghost, the source by default, so the card passes an `AimReticle` in `CombatFxLayer` as the ghost instead, placed under the press when the candidate drag starts. `TargetingArrow` covers the stage and, at paint time, reads the source card's top edge and the reticle's centre from the tree (carried up a level at a time with `Component.localToAncestorInto`, which builds no matrices, so a frame of aiming allocates nothing on the game's side; the draw API's own command copies are the engine's) and draws a quadratic curve of dots between them with a head at the pointer. Its colour is the drag service's `canDrop`. Nothing updates it per move.

Considered: the card as the ghost. It covers the vehicle it's dropped on, which hides the target highlight the drop depends on, and the design says the card stays put.

Considered: redrawing the line from the card's captured `pointermove`s. It works, but reading positions at paint time needs no bookkeeping and can't fall a frame behind the reticle.

`CombatFxLayer` is an absolute child of the stage, the stage's size, on the `overlay` layer with `pointerEvents: none`. It sits inside the stage's scale, so the line's widths are logical pixels like everything else.

### Who accepts what

- A vehicle accepts in `dragenter` when targeting is on and it's a target, sets the model's focused vehicle, and plays the card on `drop` through the same `chooseAsTarget` a click uses. `dropActive` lights the plate too.
- A card that needs no target is accepted by the vehicles it acts on, the way section 4 has a buff order dropped on its escort: the playing driver's vehicle for a card on themselves, the raiders for one on all of them, your convoy for one on both drivers. It plays untargeted on `drop`. The road accepts nothing, so a release there cancels any card, as section 6 says. A targeted card over a vehicle that isn't its target is accepted by nothing either.

Considered: the road as the drop zone for a no-target card. It's the simplest gesture (fling it up out of the hand), but it turns section 6's cancel into a play that spends adrenaline for exactly the cards whose cancel matters least to notice.
- The card's `dragend` with `dropped: false` puts the card back: selection cleared, the hand re-enabled. That covers a release off target, Escape (the screen's hotkey calls `drag.cancel()` while dragging), and another mouse button, which arrives on the captured card as a chorded `pointermove` with `button` set (R9.30), or as a `pointerdown` when it wasn't held.

A drag that goes active chooses its card through the same checks a click does (`chooseCard(card, 'drag')`), except that a card with no target waits for its drop instead of playing, and focus doesn't jump to the first target.

### Damage numbers come from the battle, anchored when they fire

Nothing in `Battle` said where a hit landed: the log names vehicles, and names aren't unique. `Battle` now emits `hitLanded` with the vehicle and the damage the attack dealt (before shield and armor take their share, which is what the mock's `-6` reads as) from `damageVehicle` and `damageDriver`, and `hitMissed` from the two miss checks. Every hit in the game goes through those two helpers, the enemy turn's included.

The screen looks up the plate by vehicle id and reads its `screenBounds` in the handler. A wreck is taken off the road after the hit resolves, so reading later would find no plate. `CombatFxLayer.popNumber` converts the plate's top centre into its own space and adds a `FloatingNumber`, a `Text` in the mock's `.dmgpop` (display type, 30 px, `#ff8a78`, a hard black shadow). A second number on the same plate in the same burst (an enemy turn's volley) starts 28 px under the first, so they read as a column rather than one smudge.

How long a number stays is reading time, not motion: 900 ms, longer than any motion token. So it counts down on the frame clock in its own `update(dt)`, as `Toast`'s auto-dismiss does, and only the movement goes through the animator: a 40 px ease-out rise over its life, and a fade over the back 45%. Under reduced motion (R11.13) neither starts, and the number holds still at full opacity for its 900 ms, then goes. The first version ran the whole life as one tween, which reduced motion completed in the update phase of the frame the hit landed in, before render, so the number was never painted at all. Each number owns its tweens and its update request, so unmounting the screen cancels them.

The gallery's `combat-fx` scene holds a line and three numbers still (`FloatingNumber`'s `held`) for a golden.

Considered: diffing structure and armor on the team's `change` events. It can't tell a hit from a repair or an armor card, and it can't see a miss.

### One rule for time: reading on the clock, motion on the animator

Everything in this record that stays on screen to be read keeps its own countdown in `update(dt)` through `requestUpdate`, as `Toast` does, and puts only its movement on the animator. Under reduced motion (R11.13) the animator finishes a tween on its first tick, before render, so anything whose life was a tween would never be seen. Damage numbers learned this in review; the banner was built to it.

### The turn banner crosses the road, and only when the turn changes

`TurnBanner` replaces the old phase box (DDB-30), which sat over the left of the road for the whole fight, said COMBAT START until the first card, and covered the raiders' FRONT label at 1280 and 1024. It's the mock's `.banner`: 56 tall across the full road, a band solid between a quarter and three quarters of the width and fading to clear at the ends, 32 px display type spaced 0.28 em. It's a child of the road, absolute and centred, on `overlay` so it covers the vehicles and the log drawer and never the dock (section 6). It shows for 1100 ms when the turn changes. The band stays across the road and fades; only the words slide in from the left and out to the right, so nothing reaches past the road where the stage is narrower than the screen. Changes coalesce: a new enemy turn sends the banner that's up out at once and drops whatever was waiting, and the player's turn that follows waits behind it, so at most one pair is ever pending and the last banner always names whose turn it is now. The enemy turn still resolves in one frame (DDB-112), so END TURN shows ENEMY TURN, then YOUR TURN, and pressing it again mid-banner doesn't stack more. Between banners nothing is drawn: the top bar's turn and END TURN's caption say whose move it is.

The mock only has the enemy's banner. The player's uses the same band in the dock's ground with bone type, so red stays the raiders' colour (section 7).

### Intents: the whole plan, two then "+N"

The plate showed a raider's first planned intent as one disc, with buffs and debuffs both drawn as "!". `IntentRow` shows every planned intent: the first two as discs, then "+N" (section 8's rule), beside the plate's top right corner so a long plan never covers the driver's name or the lane label. The rows are children of the raiders' battlefield layer, siblings of the plates, placed after the plates are: a plate is one hit target (`pointerEvents: 'unit'`), so a disc inside one could never be hovered for its tooltip. A disc that leaves steps out of the row's flow where it stood, so the row doesn't widen while it shrinks. Keyboard focus doesn't reach the discs: a Tab stop for them would come before the hand in tree order, and the end-turn preview from END TURN's focus (DDB-139) is where a keyboard player should read the plan. Debuff and buff get their own colours and the up and down chevrons from the icon font, since it has no better glyphs yet. Each disc's tooltip is the card's name and what it does to whom ("15 damage on Apocalypse Rig"). The row reconciles its markers keyed by place, type, and value (R8.27), so a plan that changes (the start of a turn, or the projection moving as you play) grows its new discs in and shrinks the old ones out on the animator, and a plan that holds isn't touched. Under reduced motion they just change.

The pills, tier colour, target marks, and end-turn preview lines are DDB-139's; this is the current plate's stand-in for them.

### Discards fly to the pile

The hand deals every element again on each update, so a card that leaves has no element to animate by the time anyone knows. `PlayerHandLayer.setHand` now reports the cards the new deal drops, with their elements, before it deals. The screen sends each one that went to its driver's discard pile, or that the next draw already shuffled from there back into the deck (not one that exhausted, or was taken out of the deck), to `CombatFxLayer.flyToDiscard`, which reads the element's centre, turn, and scale into its own space through `localToAncestorInto`, and adds a `DiscardFlight`: a copy of the card that moves to the right end of the driver's DISCARD count over `dur_slow`, straightening, shrinking to 18%, and fading over the back 45%. That covers a played card. The whole hand at the end of the turn comes from `Driver.discardHand`'s `handDiscarded` event instead, sent while the cards are still in the hand: by the time the hand deals again the draw may have reshuffled the pile and dealt some of the same cards straight back, which the deal can't tell from cards that never left (DDB-37). A card played by a drop leaves from the drop point, upright, rather than from its slot: the card stayed lifted in the hand while the reticle went to the target, and the reticle remembers where the drag service last moved it, since the service puts the ghost back before it delivers the drop. It's motion and nothing else, so under reduced motion no flight is made and the count going up is the feedback.

Considered: moving the hand onto `reconcileChildren` so a card's own element could exit to the pile. That's the better end state, and DDB-136's dock rebuild is where it belongs; doing it here would rework the focus group, the drag source, and the preview anchors the last two PRs settled.

## Consequences

- Click-then-target is unchanged: a press that never passes the 4 px threshold is a click. The keyboard path is unchanged. Hand cards keep the default threshold, per the DDB-77 note about candidate drags wandering onto a neighbour.
- A played card's element unmounts with the hand rebuild inside `drop`, so the drag service fires no `dragend` for it; the line goes on `onDraggingChange(false)`.
- The design's out-of-reach dimming, per-slot range chips, damage ghost, and hit chip are DDB-138. Legal targets here are the old `targetableVehicleIds`, with the old plate colours.
- Numbers anchor to today's vehicle plates; when the slot grid's tokens (DDB-134/135) replace them, `popHitNumber` looks up the token instead.
- The hand still deals every element again on each update; the discard flight works around that, and DDB-136 should put the hand on `reconcileChildren`.
