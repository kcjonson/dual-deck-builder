# Wasteland Wheels Development Hub

This document is a place for multiple AI workers (such as Claude and Claude Code) to store status, open questions, technical decisions and more. This should be formatted for the workers to read, and isn't particularly for a human audience.

=========================================

## Project Overview

Wasteland Wheels is a roguelike deckbuilder game with vehicular combat in a post-apocalyptic setting. Core mechanic: "Symbiotic Driver System" where players control two drivers/vehicles simultaneously.

Tech Stack: TypeScript, WebGL, Electron, Jest
Current State: Basic menu system and rendering engine implemented

## Design Documents

1. **Game Flow & UI Specification**: https://docs.google.com/document/d/1_upnszasO-9eSIFPNWSSRZaVI2S1Twrncfmia8nd0_o/edit

   - Complete UI/UX flows for all screens
   - Detailed user interaction patterns
   - Platform-specific adaptations

2. **Card System Design**: https://docs.google.com/document/d/1sxDkXcnRwJJIlJuhzfcxGPifUZILoEGBRVjLpMQJg2s/edit

   - Card data structure (JSON format)
   - Starting decks for 4 drivers
   - Complete card pool design
   - Status effects and vehicle mods

3. **AI System Technical Design**: https://docs.google.com/document/d/14WuPue2Gqol9Sgk5yZ8XwOQRP2C6Df15y9lPkSPBJUo/edit?tab=t.0

4. **Gameplay Mechanics and Style Document**: https://docs.google.com/document/d/1_upnszasO-9eSIFPNWSSRZaVI2S1Twrncfmia8nd0_o/edit

   - Core gameplay loop for "Wasteland Wheels" - a post-apocalyptic vehicular combat deckbuilder
   - Symbiotic Driver System with dual character/vehicle control
   - Detailed combat mechanics, deckbuilding systems, and vehicle customization
   - Art style direction and couch co-op mode specifications

5. **Unique Game Mechanic Proposal: The Symbiotic Twin System**: https://docs.google.com/document/d/1sxDkXcnRwJJIlJuhzfcxGPifUZILoEGBRVjLpMQJg2s/edit

   - Core innovation of controlling two distinct but interconnected characters simultaneously
   - Addresses common genre weaknesses (run similarity, RNG frustration)
   - Detailed synergy mechanics and dual-deck management system
   - Example character interactions and card effects

6. **Combat System Rules**: https://docs.google.com/document/d/1hgqkxYuYSTBc9UwzbVRdG_Zax52XE2wm4f3d4ITCF5E/edit

   - Entity types (Vehicle, Driver) with detailed properties
   - Combat sequence and initiative system
   - Card types and effects (ranged attacks, physical attacks, status effects)
   - Positioning mechanics (Front, Back, Flanking)

7. **Faction Concepts**: https://docs.google.com/document/d/19BvQVuFcwBvIAIsBMRwizA6N2XNISriVatACgtXG0I4/edit

   - 10 unique faction concepts with backstories
   - Factions include: Ironclad Nomads, Sun Chasers, Rust Vultures, Gear-Priests of the Cog, etc.
   - Each faction aligned with game themes of "Chrome Comrades" and "Gear & Grit"

8. **Unique Mechanics in Deckbuilder Roguelikes Research**: https://docs.google.com/document/d/1E3Qp0LmnvUZnojtIPwYEEani7meb5YlMZLStoiG_vJU/edit

   - Analysis of innovative mechanics from existing games
   - Features from Slay the Spire, Across The Obelisk, Marvel's Midnight Suns, etc.
   - Key innovations: party-based gameplay, dual deck systems, positional combat
   - Meta-progression systems and narrative integration

9. **Software Specification: Wasteland Wheels**: https://docs.google.com/document/d/1cJBy1w2YWI0fzmmo7qyMRgg9Xm6t5RO9zpij4y3XwXM/edit
   - Technical implementation details for the core gameplay loop
   - Driver & vehicle selection system specifications
   - Combat system implementation details
   - Run culmination and defeat scenarios

## Implementation Priority Order

### Phase 1: Core Systems (Current)

1. **Card Configuration Loader**

   - Create `src/renderer/game/data/cards.json` with card definitions
   - Implement `CardLoader` class to parse JSON into Card objects
   - Create interfaces matching the card structure in design doc

2. **Driver Selection Screen**

   - Follow section 1.2 of Game Flow & UI Spec
   - Create `DriverSelectionScreen` extending `Screen` class
   - Implement driver data structure and loading
   - Two-panel layout with synergy preview

3. **Basic Combat Screen**
   - Follow section 2 of Game Flow & UI Spec
   - Create `CombatScreen` with enemy display, battlefield, hand, resources
   - Implement card dragging and targeting system
   - Basic turn flow (draw, play, end turn)

### Phase 2: Content & Polish

- Implement all 4 starting driver decks
- Add 20-30 common pool cards
- Build garage/shop screen
- Implement map navigation

### Phase 3: AI & Balance

- Basic AI that can play cards
- Intent system
- Multiple enemy types
- Difficulty scaling

## Technical Decisions

### Card System Architecture

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

### Screen Management

- Use existing Screen base class from `src/renderer/game/core/Screen.ts`
- Each major game screen extends Screen
- Game class manages screen transitions

### Component Usage

- Leverage existing components: Rectangle, Text, Button, Layer
- Create new UI components as needed (e.g., CardComponent, VehicleDisplay)
- Use InputSystem for mouse/touch interactions

## Open Questions for Implementation

1. **Card Rendering**: Should cards be rendered as composite components (Rectangle + Text + Image) or custom WebGL shapes?

   - Recommendation: Start with composite components for faster iteration

2. **Animation System**: Current codebase lacks animation support. How to handle card movement, damage numbers?

   - Recommendation: Create simple Animation class using requestAnimationFrame

3. **Save System**: When to implement save/load functionality?

   - Recommendation: Defer to Phase 2, focus on core gameplay first

4. **Resource Loading**: How to handle card images and other assets?
   - Recommendation: Extend existing AssetLoader to support card images

## Current Codebase Notes

### Existing Systems to Leverage

- `Screen` base class for game screens
- `Component` system for UI elements
- `InputSystem` for mouse interactions
- `AssetLoader` for resource management
- `State` class for game state management

### Systems Needing Creation

- Card system (data, deck, hand management)
- Combat system (turn management, targeting)
- Driver/Vehicle system
- Map/node system for progression
- Shop/upgrade system

## Next Steps for Claude Code

1. Read all three design documents linked above
2. Review current codebase structure, particularly:
   - `src/renderer/game/screens/` for screen examples
   - `src/renderer/engine/components/` for UI components
   - `src/renderer/game/mechanics/` for existing Card/Deck classes
3. Create implementation plan for Phase 1 items
4. Begin with Card Configuration Loader as it's foundational
5. Update this document with progress and any blockers

## Implementation Status

- [ ] Card Configuration Loader
  - [ ] Create cards.json with initial card set
  - [ ] Implement CardLoader class
  - [ ] Add card loading to game initialization
- [ ] Driver Selection Screen
  - [ ] Create DriverSelectionScreen class
  - [ ] Implement two-panel layout
  - [ ] Add driver data and loading
  - [ ] Implement synergy preview
- [ ] Basic Combat Screen
  - [ ] Create CombatScreen class
  - [ ] Implement battlefield layout
  - [ ] Add card hand display
  - [ ] Implement card dragging
  - [ ] Basic turn management
- [ ] Integration
  - [ ] Connect screens with proper transitions
  - [ ] Implement basic game flow

## Code Style Guidelines

- Follow existing TypeScript patterns in codebase
- Use existing component hierarchy where possible
- Maintain separation between data (JSON) and logic (TypeScript classes)
- Include JSDoc comments for public methods
- Write tests for critical systems (card loading, combat logic)
