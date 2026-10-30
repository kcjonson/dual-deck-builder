# Card System Architecture

## Decision
Implement a JSON-based card configuration system with runtime Card instances

## Date
Planning phase (not yet implemented)

## Context
The game requires a flexible card system that supports:
- Easy content creation and balancing
- Driver-specific and common card pools
- Card upgrades and modifications
- Synergy effects between dual drivers

## Rationale
- JSON configuration enables non-programmer content creation
- Separation of data and logic improves maintainability
- Type-safe interfaces ensure consistency
- Upgrade system built into data structure

## Architecture

### Data Structure
```typescript
// Card data loaded from JSON
interface CardData {
  id: string;
  name: string;
  description: string;
  driverRestriction: string | null;
  rarity: CardRarity;
  cost: number;
  targetType: TargetType;
  effects: CardEffect[];
  upgrades?: UpgradeData;
  tags: string[];
  image: string;
}

// Runtime card instance
class Card extends GameObject {
  private data: CardData;
  private upgraded: boolean = false;
  // ... implementation
}
```

### System Components

1. **CardLoader Class**
   - Parses cards.json into Card objects
   - Validates card data structure
   - Caches loaded cards for performance

2. **Card Effects System**
   - Modular effect implementation
   - Composable for complex cards
   - Supports conditional effects

3. **Targeting System**
   - Different target types (self, enemy, all)
   - Range and positioning constraints
   - Visual targeting indicators

## Implementation Plan
1. Create `src/renderer/game/data/cards.json` with initial card set
2. Implement `CardLoader` class for JSON parsing
3. Create effect system with common effects
4. Build targeting and validation systems

## Benefits
- Content can be modified without code changes
- Easy to test and balance cards
- Supports modding potential
- Clear separation of concerns

## Trade-offs
- Runtime parsing overhead (mitigated by caching)
- Need for validation layer
- Effect scripting limitations

## Status
Planned but not yet implemented