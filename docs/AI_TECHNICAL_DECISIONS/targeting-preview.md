# Targeting preview: ranges, outlines, damage ghost, hit check

Status: decided 2026-10-02, DDB-138 (DDB-127). Design source: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) section 6 (Targeting) and the mock's targeting state (`docs/design/battle-screen/index.html`, `.slotchip`, `.valid`, `.targeted`, `i.ghost`, `.hitchip`). Builds on DDB-88's drag-to-target ([combat-hand-and-targeting.md](./combat-hand-and-targeting.md)).

## Context

DDB-88 left drag-to-target, click-then-target, and keyboard targeting working on the road, with every raider offered to an `enemy_single` card whatever its range, and a thin solid outline on each target. Section 6 asks for more while a card is aimed: each raider's range from the slot the card acts from, out-of-reach raiders dimmed, legal ones dashed, the hovered one solid with a damage ghost on the bar it will hit, the hit check riding with the card, and a release on the road or a right-click cancelling. DDB-111 (targeting can't be cancelled by a click) and DDB-114 (an illegal target duplicating the card) were reachable from the old offer.

## Decisions

### One preview rule beside the play rule

`mechanics/AimPreview.ts`'s `previewAim({ battle, driver, card, target })` answers everything the screen shows for one target: who acts (the caster's vehicle, or for an attack order the escort `orderCarrier` picks, else the nearest ready one), the range from that slot, the card's reach, the hit check, and what a landed hit takes off structure, driver HP, and passenger HP. It reads the battle's own pieces rather than restating them: `Battle.hitCheck` is `checkHit`'s numbers (and `checkHit` now returns `hitCheck(...)?.hits`), damage goes through `calculateFormulaDamage` (now public) and `calculateDamage`, and the split past shield and armor is `Vehicle.takeDamage`'s, run on scratch numbers. A test plays the card after previewing it and checks the bars moved by what the preview said. The check has no dice (gunnery against evade plus the modifier is a comparison), so a failing check previews no damage and says MISS.

The screen works out a preview per raider once, when the card is picked, and reads the hovered one from that map; nothing is computed per frame or per pointer move.

### Only legal targets

`CombatScreen.determineTargetableVehicles` picks the card's side of the road by target type, then keeps only the vehicles `Battle.getTargetBlocker` passes, the same rule `playCard` checks. Drag, click, and keyboard all read `targetableVehicleIds`, so none can offer a target play would refuse. DDB-114's engine half was fixed earlier (74b81a3, the target is checked before the card is spent); this closes the screen half.

### Range chips live in the token

A `RangeChip` child at the token's top left (the mock's `.veh.grid .slotchip`), sized from the mono advance, drawing its box and text from options it keeps. `RoadView.showRanges(map)` sets every token's label at once. The chip says `R1`/`R2` within the card's reach and `OUT` past it, red-edged when the card can land there. Being a child component, it is in the tree snapshot and the layout lint, and it dims with its token.

### Dashes as one cached triangle list

The legal outline is the mock's 2 px dashes. Drawing them as rects would add about 40 draws per target on top of the empty-slot outlines DDB-257 flagged (about 900 a frame). `ui/stripes.ts`'s `dashedOutlineTriangles` builds the whole outline as one bare triangle list, rebuilt only when the plate's height changes, and the token replays it as a single `drawPolygon`. The draw API still copies the points into the command each frame, as it copies every command, but it is one call per target and nothing is allocated on the game's side. The shoulder hatch moved into the same module (`hatchTriangles(rect, { period, stripe })`), which the damage ghost reuses at the mock's 4 px stripes.

The hovered target keeps the solid 3 px outline and gains the mock's 22 px glow, a shadowed rect drawn before the plate so the opaque plate covers its middle.

### The ghost goes on every bar the hit takes from

A vehicle hit splits past shield and armor, half to structure and half to each living occupant, so a hovered Point Blank ghosts both structure and driver HP; a Headshot ghosts only the driver's (or an escort passenger's) bar. Section 6 says "the bar it will hit"; showing every bar that moves is the honest reading of the split. The ghost is built when the losses or the bars change.

### The hit check is drawn like the line

`HitCheckChip` in `CombatFxLayer` covers the layer, as `TargetingArrow` does, and reads the aimed card's place from the tree at paint time (`localToAncestorInto`, 146 down the card, centred), so it follows the lifted card with no bookkeeping. Its three runs ("HIT", "Gunnery 7 vs Evade 4+2", " · R1") are set when the target changes. It shows for raiders the card lands on; a flank's target only gets the range chip. In click-then-target play it rides with the selected card.

### Cancelling

Escape and a right-click mid-drag already cancelled (DDB-88). The stage is now a pointer target itself: a click that started while a card waited for its target and landed on no target (empty road, the dock, a dimmed vehicle) puts the card back, and a right-click anywhere does too, through the one `cancelAim`. Clicking the waiting card again puts it back. Release on the road already cancelled.

## Consequences

- The mid-drag state has its own gallery scene, `combat-targeting`, captured and linted at both gate sizes; `SceneScenario.shortViewport` adds the short viewport for scenes standing in for a screen state.
- Range chips sit on raiders only, as the mock puts them; empty enemy slots show nothing. Section 6 now says so, and says the ghost goes on each bar the hit takes from.
- The hit check is clamped inside the stage, so the hand's leftmost card keeps its verdict on screen; the gallery scene has a card at its left edge for the golden. The lint gate can't see it, since like the aim line it is ink on a layer-sized component.
- END TURN puts an aimed card back first, so no chip, outline, or hit check rides into the paced enemy turn.
- `splitDamage` in `mechanics/Vehicle.ts` is the one vehicle-hit split, used by `takeDamage` and the preview; `Battle.getVehicleForDriver` is public for the preview's actor.
- Not yet matched to the mock: the source vehicle lighting up in its driver's colour (`owner-lit`) while a card is aimed, and the desaturation on dimmed tokens (`saturate(0.4)`; the dim here is opacity only). Filed as a follow-up.
- `road-view.md` said a polygon's points are copied per frame where a rect's are not; both are copied. The empty-slot outlines are still rects (DDB-257).
