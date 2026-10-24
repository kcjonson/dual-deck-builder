# Slot targeting: picking a slot, and two-step plays

## Date
2026-10-24, DDB-548 (epic DDB-547). Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) section 6 and [Combat Rules](../specs/Combat%20Rules.md), Swerving. Builds on DDB-138's targeting ([targeting-preview.md](./targeting-preview.md)) and DDB-545's swerve model ([movement-cards.md](./movement-cards.md)).

## Context

Targeting picked vehicles and nothing else. Six movement cards move a vehicle to a slot the player picks (Juke, Bootlegger Turn, Strafe, Fall In, Shoulder Check; Leapfrog's swap picks a vehicle), and DDB-545 left the model ready for them: `Battle.moveDestinations`, `getDestinationBlocker`, `needsDestination`, `playCard({ destination })`, and `getAllIntents({ preview })` with a `PlayPreview` carrying the slot. Three of the cards take a vehicle and a slot, in different orders: Strafe swerves and then shoots from the new slot, Fall In picks the escort before where it goes, and Shoulder Check rams a raider before it's shoved. The cards themselves are DDB-551's, so this was built and tested against test-only stand-ins (`screens/combat/__fixtures__/movementCards.ts`) shaped as movement-cards.md's table has them.

## Decisions

### The steps come from the card's effects

`aimStepsOf(card)` (CombatModel.ts) returns the picks a card waits for, in order, from `pickedMoveOf` and its target type, never its name:

| Card shape | Steps |
|---|---|
| no picked move | `vehicle`, or none for a card that takes no target |
| picked move of the caster, no target (Juke, Bootlegger Turn) | `slot` |
| picked move of the caster, then a target (Strafe) | `slot`, `vehicle` |
| picked move of the target (Fall In, Shoulder Check) | `vehicle`, `slot` |

The caster's move goes first because its other effects reach from where it lands; the target's move can't be asked about until the target is known. A slot step asks `Battle.needsDestination` with the target chosen so far, and is skipped when it says no (Shoulder Check on a raider boxed in ahead and behind plays at once, call 293). `CombatModel.selectCard` sets `isTargeting` when there's any step, so a self card that picks a slot waits instead of playing on click.

The screen keeps one `AimState` (steps, the step waiting, the vehicle and slot chosen so far). `enterAimStep` shows a step: a vehicle step sets `targetableVehicleIds` from the battle's target rule, judged from the slot an earlier step chose; a slot step sets `targetableSlots` from `Battle.moveDestinations` and no vehicles. When a vehicle step follows (Strafe), only the slots from which some vehicle would then pass the target rule are offered: a slot that leaves nothing in reach is too far for the card, which the item says shows nothing, and offering it would strand the card in a vehicle step with no targets. A Strafe with no such slot goes back to the hand when picked. A pick (`targetedVehicle` or `targetedSlot` on the model) moves to the next step, and when there are none left the card plays with both. Leapfrog has no slot step: its swap target goes through the existing vehicle targeting, where the battle's `swapBlocker` already offers only your partner's vehicle and the escorts next to you.

Considered: a handler per card (if Strafe, then...). The batch is data, raiders get some of the same cards, and upgrades replace effects, so a name check would break the moment DDB-551's data changes a target type.

### A slot target is a component over the slot

`ui/SlotTarget.ts` is one component per legal slot, made by `RoadView.showSlotTargets` over the slot's empty-slot outline, and gone when the step ends. It takes clicks, drops, and keyboard focus exactly as a target vehicle does: hover, focus, or a dragged card previews it through `CombatModel.focusSlot`, and a click, Enter, or a drop chooses it through `targetSlot`. It accepts a drag in `dragenter`, so the drag service's `canDrop` colours the line, and it's focusable, so Tab and the arrows reach it through the focus manager's tree walk with nothing registered. Illegal slots (taken, reserved, too far for the card) get no component, so they show nothing and a click or release there falls through to the stage, which cancels, as it does for a non-target vehicle.

The look is the vehicle's targeting look: 2 px dashes for legal, 3 px solid with the 22 px target glow for the one under the pointer or focus. A slot in your formation lights in the interaction yellow your vehicles light in, a raider's slot (a shove) in the raiders' red: the colour the vehicle moving there takes as a target. A slot chosen at an earlier step (Strafe's, while it waits for its raider) stays drawn solid and takes no input. The dashes are one triangle list rebuilt only when the box changes size, so a waiting slot costs one draw.

While a slot step waits, vehicles neither dim nor take focus (`CombatModel.isPickingSlot`): the readouts on the raiders are what the player is reading. The vehicle an earlier step chose (`pickedVehicleId`, Fall In's escort, Shoulder Check's raider) holds the solid outline the way an attack order's carrier does, and Shoulder Check's raider keeps its damage ghost and hit check, since the shove only follows a hit.

Considered: hit-testing slots by geometry inside `RoadView`. It would need its own hover, drop, and focus plumbing beside the dispatcher's, and the focus manager can't visit what isn't a component.

### Hovering a destination previews the board from there

`focusedSlot` drives two things.

- Range readouts, from `previewDestination` (AimPreview.ts): every raider's range from where the vehicle you're moving will stand, or for a shove from your vehicle with the raider at the hovered slot (call 300). R1 and R2 count against the card's own range, or Range 2 for a card with none (call 301). A readout is red-edged when the card's vehicle step still to come could land there from that slot (Strafe). With nothing hovered a slot step shows no readouts; they're a preview of a destination, not of where you stand.
- The raiders' plan: `CombatScreen.showIntents` passes `aimPlayPreview()` (the card, the vehicle chosen so far, and the hovered slot, else the chosen one) to `Battle.getAllIntents({ preview })`, so an intent the move takes out of reach drops off its pills, and the end-turn preview, which reads the pills, drops its line. Leaving the slot puts the plan back. Once Strafe's slot is chosen the preview holds while it waits for its raider, except while END TURN has the pointer or keyboard focus: ending the turn puts an aimed card back, so the end-turn preview shows the plan without it, and `EndTurnColumn.onPreviewingChange` refreshes the pills as END TURN's preview comes and goes. The preview is only worked out when the hovered slot, the step, or END TURN's preview changes, never per frame; going back to the plain plan is skipped unless a preview was showing.

`previewAim` now takes `destination` and reads range from `BoardProjection.landingSlots`, the same slots the target rule measures from, so Strafe's chips and hit check read from its chosen slot and Cut Off's from the row ahead, before and after a slot is chosen. It also takes an optional `board`, so the screen's readouts build one projection for every raider rather than one each.

### Drag, click, and keyboard take the same steps

- Drag: the first pick is the drop, on a slot or a vehicle. The drag ends there, and the card stays lifted and selected for its second pick, which is a click, as click-then-target is today. Pressing the card again starts a drag that carries on from the step it's at.
- Click: each pick is a click. A pick's click would bubble on to the stage, which cancels a waiting card on any click that started while it waited, so the screen counts picks (`aimPicks`) and the stage only cancels when the click made none.
- Keyboard and controller: Enter on a card focuses the first step's first target, a slot or a vehicle; the arrows move between them by directional focus (nothing else on the road is focusable then); Enter picks, and focus goes to the next step's first target. There's no gamepad adapter yet; a controller's D-pad and buttons will arrive as the same directional focus, `activate`, and `cancel` events.
- Cancel: Escape, a right-click, a click on nothing, or a second click on the card puts the card back at either step, and nothing moves (call 302). END TURN does too.

## Consequences

- A slot pick reaches `playCard({ destination })`, and the battle checks it again, so nothing the screen offers can play illegally; the screen tests play each stand-in through the real battle.
- `CombatModel` gains `targetableSlots`, `focusedSlot`, `targetedSlot`, `pickedSlot`, `pickedVehicleId`, `isPickingSlot`, `isSlotTargetable`, `focusSlot`, and `targetSlot`; `selectCard` now clears every pick from the card before it.
- DDB-551 only adds card data: a card shaped as movement-cards.md's table gets the right steps, slots, readouts, and preview with no screen change. A card with a picked move and an unusual target type would take the table above; one that picks two slots is refused by `pickedMoveOf`.
- Shoulder Check still asks which way to shove when its hit check shows a miss (call 303).
- Gallery scenes `slot-targeting` (Strafe waiting for its slot, hovered) and `slot-targeting-shove` (Shoulder Check's second step) hold both steps still; the developer screen shows them, so the boot smoke opens them.

## Provisional calls

Pending Kevin's approval in [gameplay-calls.md](../gameplay-calls.md) (Movement cards).

- 300: a hovered slot's range readouts read from where the vehicle you're moving will stand (Juke, Strafe, Bootlegger Turn, Fall In's escort), and for a shove from your vehicle with the raider at the hovered slot, because the readout is there to show who can reach whom once the move lands.
- 301: a card with no range of its own (Juke, Bootlegger Turn, Fall In) counts its slot readouts against Range 2, the longest any card reaches today, so OUT reads as out of every card's reach.
- 302: cancelling at either step of a two-step play puts the card back in the hand rather than stepping back to the first pick, because one cancel meaning one thing is what targeting already teaches, and the first pick is one click to make again.
- 303: Shoulder Check asks which way to shove even when its hit check shows a miss, and the shove then doesn't happen, because the battle requires the slot whenever the raider has somewhere to go, and the check rides with the card through the second step, so the player sees the miss before picking.
