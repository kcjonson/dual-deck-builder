# Road view

## Date
2026-10-02

## Context

DDB-134 draws the road from Battle Screen Design sections 1 and 2: six lanes under a 26 px header, an 18 px row gutter, shoulder tints, the centre line, faint dashed empty slots, and 205x141 slots at 1280x720 from one layout function, fixed for the whole fight, with a move shown as a swerve. Until now the road held two stand-ins, `EnemyBattlefieldLayer` over `PlayerBattlefieldLayer` (both on `BattlefieldLayer`), each drawing its team in three columns by lane kind. A flanker sits on the other team's side of the road, so per-team layers were the wrong cut.

Three tasks build on the slots at once: DDB-135 scales the vehicle token x1 to x1.25 into a slot, DDB-138 hangs a range label off each raider's slot, and DDB-141's fit suite measures against them.

## Options considered

1. **Keep two layers, one per side of the centre line.** Each owns three lanes.
   - Cons: a flanker belongs to one team and draws on the other's layer, so every lookup (plate by vehicle, focus order, drop targets) has to ask both; the old screen already did that in three places.
2. **One road component, a pure layout function beside it (chosen).** `computeRoadLayout({ width, height })` in `CombatLayout.ts` returns every number (lanes, rows, slot size, the token scale); `roadSlotRect(layout, slot, out?)` turns a slot into a rect; `RoadView` draws the ground and owns every token.
   - Pros: the function is testable without a tree and is what the other three tasks import; the view has one map from vehicle to token.
3. **Slots as components** (18 boxes the tokens sit in).
   - Cons: 18 extra nodes that lint, snapshot, and hit-test for nothing; a swerve would reparent a token mid-motion.

## Decision

Option 2.

- `computeRoadLayout` takes the road band's size, the stage's width capped at 1600 by what the top bar and dock leave: a 16 px pad each side, the 18 px gutter, six equal lanes; under the header and a 4 px inset, three equal rows. A slot is the whole cell. It depends only on the band's size, so nothing a vehicle does resizes one; a window resize recomputes everything and lands every token.
- `tokenScale` is the mock's `k` for a 196x117 token: as large as fits a slot less 6x4 of clearance, capped at x1.25, and reported below 1 (with `tokensFit: false`) rather than floored. `tokenScaleFor` takes a token height for the passenger case.
- `RoadView` replaces all three layers. It keeps the old surface CombatScreen used (`vehicleView`, `intentRowOf`, `setVehicleIntents`), takes both teams in one `showVehicles({ player, enemy })`, and exposes `roadLayout`, `slotRect`, `slotOf`, `isSwerving`. Raider tokens come first in the tree so focus meets them first, as `focusFirst(enemyLayer)` did.
- The ground is the view's own draws, built on resize (and the slot outlines when occupancy changes) and replayed each frame: shoulder grounds, the 135 degree hatch as one bare triangle list per shoulder (bands of `x + y`, clipped to the shoulder), lane tints (red on the raiders' lanes and the raider flank, bone on your flank), edge lines, 26-on-26-off lane dashes, the 4 px yellow centre line, dashed slot outlines, and the header strip. Dashes are rects: the draw API has no dash. Every command copies its geometry per frame, rects included (DDB-257); a target's dashed outline is one triangle list instead ([targeting-preview.md](./targeting-preview.md)).
- The art runs `bleed` past each side, set by the screen from the stage's spare width, so on 21:9 the shoulders and header reach the screen's edges while the UI stays in the 1600 column. `cullInk` covers the bleed.
- A swerve tweens progress 0 to 1 over `dur_slow` on the animator; the lane offset follows `ease_standard` and the row offset `ease_emphasized`, so a move that changes row leads with the speed change and curves across. The token is raised to zIndex 1 while it moves, over the vehicles it passes. Under reduced motion the animator completes it on its first tick.
- The turn banner is centred on the rows, not the band: a centred banner with a header-high top margin, since the rows' middle is always half the header below the band's.

## Interim token placement

The plate is still the old `Vehicle` component. Until DDB-135's token lands, the road places it as the token's parts would sit: centred at 196k x 117k, the plate under a 24k intent strip and the raider's `IntentRow` right-aligned in the strip at 24 px markers. `RoadView.placeToken` is the one method that changes when the token arrives (`vehicle.fitToSlot(rect)`), along with the intent rows, which move inside the token.

## Consequences

- `ENEMY_ROAD_WEIGHT` and `PLAYER_ROAD_WEIGHT` are gone, and `LANE_ORDER` is exported from `mechanics/Road.ts`.
- New gallery scene `combat-road`: the road at the reference size with a flanker on each shoulder, empty slots, and intents. On the developer screen's narrower column it scales down whole.
- The empty-slot outlines are about 50 rects a slot; an opening fight draws around 800. If that shows up in a profile, the outlines can become one nine-slice image per colour.
