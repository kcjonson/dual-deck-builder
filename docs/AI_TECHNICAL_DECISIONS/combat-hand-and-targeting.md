# Combat hand fan, previews, drag targeting, and damage numbers

Status: decided 2026-09-28 (fan, previews), 2026-10-01 (targeting, damage numbers), DDB-88 (DDB-55 phase 6). Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) sections 4 to 6 and the mock at `docs/design/battle-screen/index.html`.

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

The mock keeps the dragged card in the hand, lifted, with a dotted line to the pointer. The drag service moves a ghost, the source by default, so the card passes an `AimReticle` in `CombatFxLayer` as the ghost instead, placed under the press when the candidate drag starts. `TargetingArrow` covers the stage and, at paint time, reads the source card's top edge and the reticle's centre from the tree and draws a quadratic curve of dots between them with a head at the pointer. Its colour is the drag service's `canDrop`. Nothing updates it per move.

Considered: the card as the ghost. It covers the vehicle it's dropped on, which hides the target highlight the drop depends on, and the design says the card stays put.

Considered: redrawing the line from the card's captured `pointermove`s. It works, but reading positions at paint time needs no bookkeeping and can't fall a frame behind the reticle.

`CombatFxLayer` is an absolute child of the stage, the stage's size, on the `overlay` layer with `pointerEvents: none`. It sits inside the stage's scale, so the line's widths are logical pixels like everything else.

### Who accepts what

- A vehicle accepts in `dragenter` when targeting is on and it's a target, sets the model's focused vehicle, and plays the card on `drop` through the same `chooseAsTarget` a click uses. `dropActive` lights the plate too.
- The road accepts a card that needs no target, and plays it on `drop`. A targeted card over the road, or over a vehicle that isn't its target, is accepted by nothing.
- The card's `dragend` with `dropped: false` puts the card back: selection cleared, the hand re-enabled. That covers a release off target, Escape (the screen's hotkey calls `drag.cancel()` while dragging), and another mouse button, which arrives on the captured card as a chorded `pointermove` with `button` set (R9.30), or as a `pointerdown` when it wasn't held.

A drag that goes active chooses its card through the same checks a click does (`chooseCard(card, 'drag')`), except that a card with no target waits for its drop instead of playing, and focus doesn't jump to the first target.

### Damage numbers come from the battle, anchored when they fire

Nothing in `Battle` said where a hit landed: the log names vehicles, and names aren't unique. `Battle` now emits `hitLanded` with the vehicle and the damage the attack dealt (before shield and armor take their share, which is what the mock's `-6` reads as) from `damageVehicle` and `damageDriver`, and `hitMissed` from the two miss checks. Every hit in the game goes through those two helpers, the enemy turn's included.

The screen looks up the plate by vehicle id and reads its `screenBounds` in the handler. A wreck is taken off the road after the hit resolves, so reading later would find no plate. `CombatFxLayer.popNumber` converts the plate's top centre into its own space and adds a `Text` (the mock's `.dmgpop`: display type, 30 px, `#ff8a78`, a hard black shadow) that rises 40 px with an ease-out and fades over the back half of 900 ms. That's longer than any motion token because the number has to be read; the mock never animates it. A second number on the same plate in the same burst (an enemy turn's volley) starts 28 px under the first, so they read as a column rather than one smudge. Each number is its own tween's owner, so unmounting the screen cancels them all. Under reduced motion the animator finishes a tween on its first tick, so the number shows for a frame; holding it still for a beat instead is left for the reduced-motion pass.

Considered: diffing structure and armor on the team's `change` events. It can't tell a hit from a repair or an armor card, and it can't see a miss.

## Consequences

- Click-then-target is unchanged: a press that never passes the 4 px threshold is a click. The keyboard path is unchanged. Hand cards keep the default threshold, per the DDB-77 note about candidate drags wandering onto a neighbour.
- A played card's element unmounts with the hand rebuild inside `drop`, so the drag service fires no `dragend` for it; the line goes on `onDraggingChange(false)`.
- The design's out-of-reach dimming, per-slot range chips, damage ghost, and hit chip are DDB-138. Legal targets here are the old `targetableVehicleIds`, with the old plate colours.
- Numbers anchor to today's vehicle plates; when the slot grid's tokens (DDB-134/135) replace them, `popHitNumber` looks up the token instead.
