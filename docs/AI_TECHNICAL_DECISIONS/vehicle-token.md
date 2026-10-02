# Vehicle token

DDB-135 under DDB-127. Spec: [Battle Screen Design](../specs/Battle%20Screen%20Design.md) section 3. Geometry from the mock's `tokenHTML` in [docs/design/battle-screen/index.html](../design/battle-screen/index.html).

## Context

The old plate was a portrait panel sized by whatever the battlefield layer gave it, with the driver's HP as 8 px grey text, the intents beside it as a sibling, and no wreck state (DDB-119). The design replaces it with a fixed-size token that scales as a whole, and DDB-134 is building the slot grid that hosts it at the same time, so the token had to be usable by either layout.

## Decisions

**Fixed geometry, one scale.** The token lays itself out once at x1 (196x117, 135 with a passenger) and every part is placed from constants when the data changes. The host never sizes it; `fitToSlot(rect, scale?)` sets a transform scale between 1 and 1.25 and centres it, which is the mock's `min((w - 6) / 196, (h - 4) / H)`. It copies the rect and reuses its transform object, so DDB-134 can call it every frame of a swerve. The token remembers its slot and refits when a passenger changes its height. The road picks one scale for every token, as the mock does, and passes it in; it acts as a cap, so a passenger's taller token that it would push out of its slot takes less. The size constants and `slotScale` (raw, neither capped nor floored) live in `ui/tokenGeometry.ts`, and `CombatLayout` re-exports them, so there is one copy.

Options considered: laying parts out from the token's size (what the old plate did) would have meant a second set of proportions to keep in step with the mock and text that shrinks with the slot; scaling keeps text at its design size times one number.

**Intents live in the token.** The old plate was a `unit` target, so the intent discs had to be siblings to get hovered. The token is `auto` instead: its own box takes clicks and drops, its text is `pointerEvents: 'none'`, and only intents and status chips, which have tooltips, are hit inside it. Their drag events bubble to the token, so the explicit drop forwarding the enemy layer did is gone. The row keeps today's discs (DDB-139 draws the pills) at 24 px, right-aligned in a 24 px strip over the full width.

**Target marks are shapes.** `targetMarks.ts` holds the triangle, diamond, both, and square as polygons and a rect, moved in place, shared with the driver tab. Intent discs draw one in the lower right on a dark backing; player plates draw their driver's mark and stripe, escorts the square. Seats come from a `seatOf(driver)` the host passes (the combat screen's driver order), since the model has no seat on a driver.

**The armor shield is a polygon (DDB-165).** DDB-165 was fixed on main before this by the icon atlas (DDB-72 drew the shield from Material Icons). The token draws the mock's `i-armor` outline itself, with the armor value on it, so nothing about it depends on an atlas. Shield (temporary armor) moves to a status chip with its value rather than "SH12" in the badge.

**Status chips.** SPENT leads an escort's row, then Shield, then statuses in the order they landed. The row is 132 wide: five 20 px chips fit, but five and a "+N" don't, so past five it shows four and "+N" as the mock does. Each chip's tooltip names the status and its turns left.

**Wrecks.** A vehicle out of the fight (structure 0, or a raider with nobody alive aboard) greys out: bars, sprite, mark, and text swap to greys and the stamp reads WRECKED, or NO DRIVER for an unmanned raider. The stamp has the plate's ground under it so the text below doesn't show through.

**Icons.** The heart, speed chevrons, and status icons are Material glyphs added to the icon atlas; the atlas build is deterministic, so the existing icons are unchanged.

## Departures from the spec

- Past five statuses the row shows four and "+N", since five and "+N" don't fit 132 px (the mock does the same).
- An unmanned raider's stamp reads NO DRIVER; the spec only names WRECKED.
- An escort carrying a passenger puts the passenger row where the driver HP row would be, so its token stays 117 tall.

## Consequences

- `ArmorBadge` is deleted; `IntentRow` is owned by the token, and `RoadView.intentRowOf` reads it from there.
- Hit numbers pop from `plateScreenBounds`, not the whole token.
- The combat goldens move (the plate is new); the `icons` scene moves (eight icons, status chips instead of the armor badge); `vehicle-tokens` is new.
