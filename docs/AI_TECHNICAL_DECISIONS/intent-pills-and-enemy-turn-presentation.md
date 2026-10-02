# Intent pills, the end-turn preview, and the enemy turn on screen

DDB-139, 2026-10-02. Battle Screen Design sections 3, 6, and 8.

## Context

DDB-88 showed each raider's plan as 24 px discs (`IntentMarker`), DDB-112 paced the enemy turn with the dock locked and End Turn reading WAIT, and DDB-132 put planned intents with targets in the model. What was left was the design's look: pills over the token, the end-turn preview, the dock dropping and greying while the raiders act, a banner that crosses the road and never the dock, and a glow on the acting raider.

## Pills

`game/ui/IntentPill.ts` replaces `IntentMarker.ts`. A pill is the mock's `.intent`: 24 tall, its type's icon (crosshair, shield, wrench, chevrons), the value, and the target mark, in its type's colour. Width follows the content, sized from Barlow Condensed's widest digit (0.46 em) rather than measured, the same call the stamp and the status chips make. `IntentRow` shows two then "+N", and when two wide pills and the "+N" would run past the token's 196 px it shows one and "+N", so every pill and its hit target stays inside the token's box. Pills keep their tooltips; "+N" now has one too, listing what it collapses.

Departures from the mock, each small:

- The heavy tier (12 and up) counts every hit: "6x3" is 18 and heavy. The mock's `parseInt` read the per-hit 6. A heavy hit is heavy however it's split.
- Debuff and buff pills print no label (icon and mark only); the label is in the tooltip. Labels like `speed_reduction` don't fit section 8's budget ("6x3" and two digits).
- An elite's or boss's hidden value prints "?", in the plain attack colour, since its tier is unknown. The model already hides it (`Battle.intentOf`).

## End-turn preview

`EndTurnPreview` is a layer over the road (the overlay layer, under the banner) that draws only while End Turn is hovered or has keyboard focus, on the player's turn. End Turn's change is one accessor, `EndTurnColumn.previewing`, so the split dock (DDB-136) can move the column freely. Keyboard focus counts only when it is visible: a mouse click that leaves focus on the button doesn't hold the preview open. This is the keyboard's way to read the plan, since the pills take no focus (DDB-88's note).

Each pill draws a dashed cubic from its centre to the top of every plate its intents land on (red for attacks, purple otherwise), arcing over both ends but kept under the lane header; "+N" draws the lines for what it collapses, so every intent has its line. Your vehicles show the incoming total in a red chip at the top right of the token, in the band a raider's pills use, so it stays inside the token (the mock hangs it 6 px out over the plate's corner). A hidden attack makes the total read "-8+?", or "-?" alone. An area hit counts on every vehicle of yours still in the fight, which is what `effectRecipients` lands it on. Ends are read from the tokens at paint time, so the lines follow a swerve or a rescale; the totals are worked out when the plan changes.

## Dock drop, and the lint

The dock drops 60 and greys out during the enemy turn, on the animator, snapping under reduced motion. The grey is a scrim over the dock (a sibling in the bands, raised by `zIndex`), since the engine's opacity is per draw (R3.26) and a half-transparent dock would show the fanned cards through each other.

A dropped dock is partly off the screen, which the layout lint reports as `outside-viewport` and `child-outside-parent`. The mock's own fit check exempts the same thing by hand (`.card.dropped`). Options:

1. A declared park (chosen). `Component.parkOffset` (R8.30) is a translation outside `transform`, like the drag ghost's offset. The snapshot emits `parked` in viewport space, and the lint takes every park back off its subtree's `screenBounds` (and any clip the subtree introduced) before the rules run, so it checks the dock where it rests. Only the park is forgiven: a card that would escape the dock at rest is still reported. The dock sets the park only while it is off its place and clears it to null on the tick it lands, so nothing stays parked by accident. Spec: R8.30, R13.22, R13.25.2, R13.25.3.
2. Grey without dropping. A departure from the design for the lint's sake.
3. A scroll container for the dock, to borrow the scrolled-away exemption. A lie about what the dock is.

Culling needs nothing new: the park moves `screenMatrix` like any translation, so the cull and the scissor see the dropped part off the viewport. The dock is disabled while dropped, so it takes no input.

## Banner and glow

The banner was already a child of the road band (DDB-88) on the overlay layer with its own `zIndex`, so it crosses the road and never the dock, and the lint reads the overlap as declared. That is DDB-109's answer: an intended overlay, declared rather than exempted. The acting raider's plate draws the mock's `drop-shadow(0 0 10px rgba(255, 110, 90, 0.6))` as a box shadow, and the token's cull ink grows by the shadow's bound (`shadowInk`) while it acts, so the glow is never culled at the road's edge.

## Goldens

- `screen-combatScreen-endTurnPreview` at both gate sizes: the pointer on End Turn, the lines and the incoming total.
- `screen-combatScreen-enemyTurn` at both gate sizes now captures the first raider acting under reduced motion: the dock dropped and greyed, ENEMY TURN across the road, the glow, the hit's number.
- `scene-vehicle-tokens` and `scene-combat-road` draw pills with the heavy tier, a multi-hit, "+N", an elite's hidden values, and one-then-"+N"; `combat-road` is also linted at 1024x600.
