# Targeting preview: ranges, outlines, damage ghost, hit check

Status: decided 2026-10-02, DDB-138 (DDB-127). Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) section 6 (Targeting) and the mock's targeting state (`docs/design/battle-screen/index.html`, `.slotchip`, `.valid`, `.targeted`, `i.ghost`, `.hitchip`). Builds on DDB-88's drag-to-target ([combat-hand-and-targeting.md](../../_legacy/docs/AI_TECHNICAL_DECISIONS/combat-hand-and-targeting.md)).

## Context

DDB-88 left drag-to-target, click-then-target, and keyboard targeting working on the road, with every raider offered to an `enemy_single` card whatever its range, and a thin solid outline on each target. Section 6 asks for more while a card is aimed: each raider's range from the slot the card acts from, out-of-reach raiders dimmed, legal ones dashed, the hovered one solid with a damage ghost on the bar it will hit, the hit check riding with the card, and a release on the road or a right-click cancelling. DDB-111 (targeting can't be cancelled by a click) and DDB-114 (an illegal target duplicating the card) were reachable from the old offer.

## Decisions

### One preview rule beside the play rule

`previewAim({ battle, driver, card, target })` (`_legacy/src/renderer/game/mechanics/AimPreview.ts`) answers everything the screen shows for one target: who acts (the caster's vehicle, or for an attack order the escort `orderCarrier` picks, else the nearest ready one), the range from that slot, the card's reach, the hit check, and what a landed hit takes off structure, driver HP, and passenger HP. It reads the battle's own pieces rather than restating them: `Battle.hitCheck` is `checkHit`'s numbers (and `checkHit` now returns `hitCheck(...)?.hits`), damage goes through `calculateFormulaDamage` (now public) and `calculateDamage`, and the split past shield and armor is `Vehicle.takeDamage`'s, run on scratch numbers. A test plays the card after previewing it and checks the bars moved by what the preview said. The check has no dice (gunnery against evade plus the modifier is a comparison), so a failing check previews no damage and says MISS.

The screen works out a preview per raider once, when the card is picked, and reads the hovered one from that map; nothing is computed per frame or per pointer move.

### Only legal targets

The screen offers the card's side of the road by target type, then keeps only the vehicles `Battle.getTargetBlocker` passes, the same rule `playCard` checks (`targetableVehicleIds`, `_legacy/src/renderer/game/screens/combat/cardTargets.ts`). Drag, click, and keyboard all read that one list, so none can offer a target play would refuse. DDB-114's engine half was fixed earlier (74b81a3, the target is checked before the card is spent); this closes the screen half.

### Range chips live in the token

A range chip sits at the token's top left (the mock's `.veh.grid .slotchip`), sized from the mono advance. It says `R1`/`R2` within the card's reach and `OUT` past it, red-edged when the card can land there. It's a child of the token, so it dims with it.

### The outlines

The legal outline is the mock's 2 px dashes. The hovered target keeps the solid 3 px outline and gains the mock's 22 px glow, drawn under the plate so the opaque plate covers its middle. The damage ghost uses the road shoulder's hatch, at the mock's 4 px stripes.

### The ghost goes on every bar the hit takes from

A vehicle hit splits past shield and armor, half to structure and half to each living occupant, so a hovered Point Blank ghosts both structure and driver HP; a Headshot ghosts only the driver's (or an escort passenger's) bar. Section 6 says "the bar it will hit"; showing every bar that moves is the honest reading of the split. The ghost is built when the losses or the bars change.

### The hit check rides with the card

The hit check is drawn as the aim line is, over the road, placed from the aimed card (146 down it, centred), so it follows the lifted card. Its three runs ("HIT", "Gunnery 7 vs Evade 4+2", " · R1") change with the target. It shows for raiders the card lands on; a flank's target only gets the range chip. In click-then-target play it rides with the selected card.

### Cancelling

The cancel action (Escape) and a right-click mid-drag cancel (DDB-88). A click that started while a card waited for its target and landed on no target (empty road, the dock, a dimmed vehicle) puts the card back, and a right-click anywhere does too. Clicking the waiting card again puts it back. A release on the road cancels too.

## Consequences

- Range chips sit on raiders only, as the mock puts them; empty enemy slots show nothing. Section 6 now says so, and says the ghost goes on each bar the hit takes from.
- The hit check is clamped inside the stage, so the hand's leftmost card keeps its verdict on screen.
- END TURN puts an aimed card back first, so no chip, outline, or hit check rides into the paced enemy turn.
- `splitDamage` in `_legacy/src/renderer/game/mechanics/Vehicle.ts` is the one vehicle-hit split, used by `takeDamage` and the preview; `Battle.getVehicleForDriver` is public for the preview's actor.
- Not yet matched to the mock: the source vehicle lighting up in its driver's colour (`owner-lit`) while a card is aimed, and the desaturation on dimmed tokens (`saturate(0.4)`; the dim here is opacity only). Filed as a follow-up.
