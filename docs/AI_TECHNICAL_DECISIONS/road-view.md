# Road view

## Date
2026-10-02

## Context

DDB-134 draws the road from Battle Screen Design sections 1 and 2: six lanes under a 26 px header, an 18 px row gutter, shoulder tints, the centre line, faint dashed empty slots, and 205x141 slots at 1280x720 from one layout function, fixed for the whole fight, with a move shown as a swerve. Until now the road held two stand-ins, one layer per team, each drawing its team in three columns by lane kind. A flanker sits on the other team's side of the road, so per-team layers were the wrong cut.

Three tasks build on the slots at once: DDB-135 scales the vehicle token x1 to x1.25 into a slot, DDB-138 hangs a range label off each raider's slot, and DDB-141's fit suite measures against them.

## Options considered

1. **Keep two layers, one per side of the centre line.** Each owns three lanes.
   - Cons: a flanker belongs to one team and draws on the other's layer, so every lookup (plate by vehicle, focus order, drop targets) has to ask both; the old screen already did that in three places.
2. **One road component, a pure layout function beside it (chosen).** The function takes the road band's size and returns every number (lanes, rows, slot size, the token scale) and any slot's rect; the road component draws the ground and owns every token. In the TypeScript build these are `computeRoadLayout` and `roadSlotRect` in `_legacy/src/renderer/game/screens/combat/CombatLayout.ts`, and `RoadView.ts` beside it.
   - Pros: the function is testable without a tree and is what the other three tasks use; the component has one map from vehicle to token.
3. **Slots as components** (18 boxes the tokens sit in).
   - Cons: 18 extra nodes that do nothing a rect from the layout function doesn't; a swerve would reparent a token mid-motion.

## Decision

Option 2.

- The layout takes the road band's size, the stage's width capped at 1600 by what the top bar and dock leave: a 16 px pad each side, the 18 px gutter, six equal lanes; under the header and a 4 px inset, three equal rows. A slot is the whole cell. It depends only on the band's size, so nothing a vehicle does resizes one; a window resize recomputes everything and lands every token.
- The token scale is the mock's `k` for a 196x117 token: as large as fits a slot less 6x4 of clearance, capped at x1.25, and reported below 1 (with a flag saying the tokens don't fit) rather than floored. A passenger token's height gets its own scale.
- The one road component replaces both layers and takes both teams. Raider tokens come first in the tree so focus meets them first.
- The ground is the road's own draws: shoulder grounds, the 135 degree hatch clipped to each shoulder, lane tints (red on the raiders' lanes and the raider flank, bone on your flank), edge lines, 26-on-26-off lane dashes, the 4 px yellow centre line, dashed slot outlines in the dash a legal target's outline uses ([targeting-preview.md](./targeting-preview.md)), and the header strip.
- The slot outlines follow where tokens have landed, not where they're headed: a swerving token keeps its old slot's outline hidden and its destination's showing until it lands. A token that arrives or leaves changes them at once.
- The art runs a bleed past each side, set by the screen from the stage's spare width, so on 21:9 the shoulders and header reach the screen's edges while the UI stays in the 1600 column.
- A swerve tweens progress 0 to 1 over `dur_slow` on the animator; the lane offset follows `ease_standard` and the row offset `ease_emphasized`, so a move that changes row leads with the speed change and curves across. The token is raised while it moves, a `zIndex` of 1 in the road's stacking context, over the vehicles it passes. Under reduced motion the animator completes it on its first tick.
- The turn banner is centred on the rows, not the band: a centred banner with a header-high top margin, since the rows' middle is always half the header below the band's.

## Consequences

- The shoulder headers are spaced 0.12em like the lanes'. The mock's stylesheet has a `.col-head.sh` rule at 0.06em, but nothing applies that class, so the rendered mock is 0.12em throughout.
