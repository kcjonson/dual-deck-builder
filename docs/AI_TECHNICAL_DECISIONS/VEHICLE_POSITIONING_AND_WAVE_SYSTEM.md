# Vehicle Positioning and Wave System Design

## Positioning

Superseded on 2026-09-25. The three-lane Flanking / Back / Front layout, smart stacking, and the 120x160 vehicle cards this document used to describe are replaced by the road grid: both convoys driving the same direction, two formation lanes by three rows per side, and a shoulder per side for the other team's flankers, one vehicle per slot. See [battle-screen-road-model.md](./battle-screen-road-model.md) for the decision and [Battle Screen Design](../specs/Battle%20Screen%20Design.md) for the layout.

## Wave System

**Decision**: Unlimited waves, with the enemy's on-road count bounded by the grid rather than by a separate limit.

**Implementation**:
1. **On-road limit**: an enemy team can hold its six formation slots plus three flank slots on the player's shoulder, nine vehicles at most. There is no stacking; a slot holds one vehicle.
2. **Wave queue**: additional enemies wait in a spawn queue.
3. **Auto-spawning**: when an enemy is destroyed, the next queued vehicle pulls into an empty formation slot, preferring the row it was destroyed in.
4. **Wave indicators**: the top bar shows "Wave 2 of 3" and "+4 incoming".

## Implementation Priority

1. Road grid positions and the range formula (replaces the old phases 1 to 3).
2. Wave spawning.

## Future Considerations

1. **Position-based abilities**: cards that affect a whole lane or row.
2. **Environmental hazards**: lane- or row-specific effects (debris ahead, an oil slick left behind).
3. **Formation bonuses**: benefits for specific arrangements of your convoy.
