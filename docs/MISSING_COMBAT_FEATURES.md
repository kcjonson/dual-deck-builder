# Missing Combat Features vs Combat Rules

This document lists all combat features specified in the Combat Rules that are NOT currently implemented in the codebase.

## Summary

The current Battle system implements basic turn-based combat with damage/healing but is missing most of the tactical combat mechanics specified in the rules.

## Missing Core Systems

### 1. Range System
**Rule**: Attacks have range 1-2 based on vehicle positions
**Missing**:
- No range calculation based on positions
- No range validation for attacks
- No position-based targeting restrictions

### 2. Hit Calculation System  
**Rule**: Attacks hit if attacker's gunnery > defender's evade
**Missing**:
- No skill-based hit calculations
- No miss mechanics
- No hit modifiers (e.g., Headshot +2 evade)
- No "always hits" implementation

### 3. Position System
**Rule**: Vehicles can be Front, Back, or Flanking
**Missing**:
- Vehicle position changes
- Speed-based flanking restrictions
- Position-based damage modifiers
- Post-combat flanking checks

### 4. Speed System
**Rule**: Vehicle speed = driver speed + base speed
**Missing**:
- Combined speed calculation
- Speed-based mechanics (flanking)
- Speed modifications from status effects

## Missing Combat Mechanics

### Damage System
- ❌ Half damage to occupants after armor depletion
- ❌ Flanking damage bonus (2x or 50%)
- ❌ Formula-based damage (Ram: armor/10 + speed difference)
- ✅ Basic damage application (implemented)
- ✅ Armor absorption (implemented)

### Targeting System
- ❌ Range-based restrictions
- ❌ Position-based restrictions (Oil Slick/Caltrops on flanking only)
- ❌ Same-vehicle restrictions (Medical Kit)
- ❌ Driver-only targeting (Headshot)
- ✅ Basic targeting (implemented)

### Status Effects
- ❌ Vulnerable status
- ❌ Speed modifications
- ❌ Duration tracking
- ✅ Basic status effect structure (implemented)

### Driver/Vehicle Interaction
- ❌ Driver death → passenger promotion
- ❌ Vehicle destruction → driver escape
- ❌ Unmanned vehicle handling
- ✅ Basic driver/vehicle association (implemented)

## Missing Methods in Key Classes

### Battle Class Missing:
```typescript
calculateRange(attacker: Vehicle, target: Vehicle): number
checkHit(attacker: Driver, defender: Driver, modifier?: number): boolean
calculateDamage(base: number, attacker: Vehicle, target: Vehicle): number
validateTarget(card: Card, target: Vehicle): boolean
endCombat(): void
processPostCombatEffects(): void
```

### Vehicle Class Missing:
```typescript
getTotalSpeed(): number
changePosition(position: VehiclePosition): void
canFlank(target: Vehicle): boolean
shouldLoseFlanking(): boolean
hasStatusEffect(name: string): boolean
handleDriverDeath(): void
isUnmanned(): boolean
canAddPassenger(): boolean
addPassenger(driver: Driver): boolean
```

### Team Class Missing:
```typescript
handleDriverEscape(driver: Driver): boolean
```

## Test Coverage Status

### Existing Tests (Battle.test.ts)
✅ Basic battle flow
✅ Turn management  
✅ Card playing
✅ Team defeat conditions
✅ Individual resources

### Created But Failing Tests
❌ Vehicle.test.ts - Tests for missing vehicle mechanics
❌ CombatMechanics.test.ts - Tests for missing combat systems

## Recommendation

The current implementation is a solid foundation but needs significant expansion to match the Combat Rules. The test files I created serve as a specification for what needs to be implemented. Priority should be given to:

1. Position system (fundamental to many mechanics)
2. Hit calculation (core combat mechanic)
3. Range system (affects all attacks)
4. Speed calculations (affects flanking and other mechanics)