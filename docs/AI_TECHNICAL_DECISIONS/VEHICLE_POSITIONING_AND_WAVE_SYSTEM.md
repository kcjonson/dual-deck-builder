# Vehicle Positioning and Wave System Design

## Context

The combat system needs to support tactical positioning of vehicles while handling potentially large numbers of enemies through a wave-based spawning system.

## Design Decisions

### Vehicle Positioning System

**Decision**: Implement a 3-lane positioning system (Flanking, Back, Front) with convoy-wide flanking rather than per-enemy flanking.

**Layout** (Front on right side, Flanking on far left):
```
┌─────────────────────────────────────┐
│  Flanking │   Back    │   Front    │  <- Enemy Lanes
│    [E5]   │ [E3][E4]  │ [E1][E2]  │  
│           │    [E6]   │           │
└─────────────────────────────────────┘
           ↕️ Range 2 ↕️
┌─────────────────────────────────────┐
│  Flanking │   Back    │   Front    │  <- Player Lanes  
│     🚗    │    [P2]   │    [P1]    │
└─────────────────────────────────────┘
```

**Key Rules**:
- Maximum 3 vehicles per position
- Flanking affects entire enemy convoy (simpler UX)
- Range 1: Can only hit adjacent positions
- Range 2: Can hit across battlefield
- Flanking requires higher speed than target

### Wave System

**Decision**: Support up to 6 enemies on screen simultaneously with unlimited waves.

**Implementation**:
1. **On-Screen Limit**: Maximum 6 enemy vehicles visible at once
2. **Wave Queue**: Additional enemies wait in a spawn queue
3. **Auto-Spawning**: When enemy defeated, next wave vehicle takes its position
4. **Wave Indicators**: Show "Wave 2/3" or "Reinforcements: 4" 

### Smart Stacking System

**Decision**: Use overlapping card layout when positions get crowded.

**Stacking Rules**:
1. **1-2 vehicles**: Display side-by-side with full visibility
2. **3 vehicles**: Overlap by 30%, all partially visible
3. **Hover Behavior**: Expand stack to show all vehicles clearly
4. **Selection**: Click specific vehicle when expanded

### Visual Design

**Vehicle Cards in Position**:
- Compact design: 120px wide x 160px tall
- Shows: Health bar, armor value, vehicle icon, speed indicator
- Stacked cards offset by 40px when overlapping

**Position Indicators**:
- Clear lane boundaries with subtle dividers
- Lane labels: "Flanking", "Back", "Front"
- Highlight valid positions during movement card play

**Wave Indicators**:
- Top of enemy area: "Wave 1 of 3" or "Reinforcements Incoming: 4"
- Small preview icons of upcoming enemy types

## Implementation Priority

1. **Phase 1**: Basic positioning (all vehicles in Front)
2. **Phase 2**: Full 3-lane system with movement
3. **Phase 3**: Smart stacking for multiple vehicles
4. **Phase 4**: Wave spawning system

## Impact on Existing Systems

### Combat Rules Compatibility
- ✅ Supports variable enemy counts (already specified)
- ✅ Maintains flanking = 2X damage rule
- ✅ Preserves range-based targeting

### UI Layout Compatibility  
- ✅ Fits within existing 40% battlefield area
- ✅ Enemy display already supports dynamic positioning
- ✅ No conflicts with current implementation

### AI System Compatibility
- ✅ Boss reinforcement mechanics already planned
- ✅ Enemy AI can utilize positioning for tactics

## Trade-offs

**Pros**:
- Supports large enemy encounters
- Adds tactical depth without complexity
- Scales well for different encounter types
- Clear visual communication

**Cons**:
- Stacking may obscure some vehicle details
- More complex than simple line layout
- Requires animation system for smooth transitions

## Future Considerations

1. **Position-based abilities**: Cards that affect entire lanes
2. **Environmental hazards**: Lane-specific effects
3. **Formation bonuses**: Benefits for specific positioning patterns
4. **Dynamic lane widths**: Boss fights might use different layouts