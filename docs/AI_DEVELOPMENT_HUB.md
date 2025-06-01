# Wasteland Wheels Development Hub

This document is a place for multiple AI workers (such as Claude and Claude Code) to store status, open questions, technical decisions and more. This should be formatted for the workers to read, and isn't particularly for a human audience.

=========================================

## Project Overview

Wasteland Wheels is a roguelike deckbuilder game with vehicular combat in a post-apocalyptic setting. Core mechanic: "Symbiotic Driver System" where players control two drivers/vehicles simultaneously.

**Tech Stack**: TypeScript, WebGL, Electron, Jest
**Current State**: Basic menu system and rendering engine implemented
**Target Audience**: Fans of Slay the Spire, Monster Train, and roguelike deckbuilders

## Key Game Features

- **Genre**: Deckbuilder roguelike with vehicular combat
- **Setting**: Post-apocalyptic wasteland (Mad Max/Carmageddon inspired)
- **Core Mechanic**: Symbiotic Driver System - control two drivers/vehicles with synergistic abilities
- **Features**: Turn-based card combat, vehicle customization, couch co-op support

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

## Key Design Decisions

### UI Component API Design (CSS-in-JS Style)
**Decision**: Adopt a React/CSS-in-JS inspired API for UI components
**Rationale**: 
- Developer has 15 years of web development experience with React and CSS
- Familiar CSS nomenclature reduces cognitive load
- Style objects separate concerns cleanly
- Optional IDs eliminate unnecessary verbosity when direct references exist

**Implementation**:
```typescript
// New API Design (Implemented)
const text = new Text('Hello World', {
  style: {
    fontSize: 20,      // Number or string with 'px'
    color: '#ffffff',  // Hex colors only
    textAlign: 'center',
    left: 150,         // Always absolute positioning
    top: 25
  }
});

const rect = new Rectangle({
  style: {
    width: 100,
    height: 100,
    backgroundColor: '#ff3333',
    borderRadius: 8,
    border: '2px solid #ffffff'
  }
});

const button = new Button('Click Me', {
  style: {
    width: 200,
    height: 50,
    fontSize: 16
  }
});

// Components no longer require IDs
const layer = new Layer();  // No ID needed
const panel = new Panel({   // Style is optional
  style: {
    backgroundColor: '#333333cc'  // Hex with alpha
  }
});
```

**Benefits**:
- Familiar syntax for web developers
- Single object for all styling concerns
- No IDs required - components are just object references
- CSS property names match web standards (camelCase)
- Hex colors only for consistency
- Always absolute positioning (no layout engine complexity)
- Optional style objects with sensible defaults

**Key Differences from Web CSS**:
- No relative positioning or layout engine
- Colors must be hex strings (e.g., '#ffffff', '#333333cc')
- No units required for numeric values (assumed pixels)
- Limited CSS properties (only what's implemented)

### Symbiotic Driver System
- Two drivers with separate but synergistic decks
- Cards have enhanced effects based on partner actions
- Shared resource pool (Adrenaline) for playing cards
- Both drivers must survive for optimal gameplay

### Combat System
- Turn-based card combat
- Positioning matters (flanking, range, cover)
- Target specific vehicles or components
- Environmental hazards and interactions

### Visual Style
- Gritty post-apocalyptic aesthetic
- Vehicle customization visible in combat
- Clear UI inspired by successful deckbuilders
- Performance over visual complexity

## Implementation Priority Order

### Phase 1: Core Systems (Current)

1. **Combat System Foundation**
   - Implement the dual-driver turn system
   - Create synergy mechanics between drivers
   - Build enemy AI system

2. **Card System**
   - Create `src/renderer/game/data/cards.json` with card definitions
   - Implement `CardLoader` class to parse JSON into Card objects
   - Create interfaces matching the card structure in design doc
   - Implement card effects system
   - Create starter decks for different driver archetypes
   - Build card reward and upgrade systems

3. **Driver Selection Screen**
   - Follow section 1.2 of Game Flow & UI Spec
   - Create `DriverSelectionScreen` extending `Screen` class
   - Implement driver data structure and loading
   - Two-panel layout with synergy preview

4. **Basic Combat Screen**
   - Follow section 2 of Game Flow & UI Spec
   - Create `CombatScreen` with enemy display, battlefield, hand, resources
   - Implement card dragging and targeting system
   - Basic turn flow (draw, play, end turn)

### Phase 2: Content & Polish

1. **Map Navigation**
   - Implement node-based map generation
   - Create different encounter types
   - Build event system

2. **Vehicle Customization**
   - Implement vehicle stats and modifications
   - Create visual representation system
   - Build upgrade mechanics
   - Build garage/shop screen

3. **Content Implementation**
   - Implement all 4 starting driver decks
   - Add 20-30 common pool cards
   - Create multiple enemy types

### Phase 3: AI & Balance

- Advanced AI that can play cards strategically
- Intent system
- Difficulty scaling
- Balance testing and adjustments

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

## Development Progress

### Recently Completed (2025-06-01)

#### Coordinate System Implementation and Initial Scrolling
- **Implemented comprehensive coordinate transformation system**:
  - Added RenderContext interface for passing coordinate transforms through render hierarchy
  - Updated all render methods (Layer, Component, Rectangle, Text, Button, Panel) to use RenderContext
  - Implemented parent tracking in Layer for proper coordinate calculations
  - Added globalToLocal and localToGlobal methods for coordinate conversion
  
- **Added wheel event support and scrolling**:
  - Extended InputSystem to handle wheel events for scrolling
  - Updated Panel class to register for wheel events when scrollable
  - Implemented setContentSize method for proper scroll bounds
  - Basic scrolling now working but needs refinement
  
- **Component architecture improvements**:
  - Refactored Input to extend Component instead of Rectangle (proper composition)
  - Added Circle and Triangle primitive components
  - Fixed Button and Input to use local coordinates for child positioning
  - Updated DeveloperScreen with comprehensive scrollable examples container

- **Current state**: Coordinate system implemented, basic scrolling works, but content bounds calculation needs improvement

### Recently Completed (2025-05-31)

#### Major Architecture Refactoring: Component Hierarchy
- **Implemented proper class hierarchy**: Layer → Component → UI elements
  - Layer is now the base class with positioning, sizing, and child management
  - Component extends Layer and adds Interactive behavior
  - Panel extends Layer directly (non-interactive container)
  - Removed all parent references (no circular dependencies)
  
- **Refactored positioning and sizing system**:
  - Removed position/size from Style interface (not CSS-like properties)
  - Added x, y, width, height as direct properties on LayerOptions
  - Individual setters: setX(), setY(), setWidth(), setHeight()
  - Convenience methods: setPosition(x, y), setSize(width, height)
  - All components now use direct properties for positioning
  
- **Fixed absolute positioning throughout codebase**:
  - DeveloperScreen: Fixed all panel positioning to use absolute coordinates
  - Panel: Now extends Layer with a Rectangle child for background
  - Window resize properly cascades layout() calls
  
#### Developer Tools Enhancement
- ✅ Created comprehensive test/demo environment
- ✅ Added FPS counter for performance monitoring
- ✅ Interactive controls panel with live color/size manipulation
- ✅ Visual style guide with Wasteland Wheels color palette
- ✅ Input component showcase with various states
- ✅ Fixed window resize handling with proper layout cascade
- ✅ Implemented array-based component positioning to avoid direct children access
- ✅ Added proper text centering with setAlign() for consistent positioning

#### Recent Architecture Improvements (2025-05-31 - Latest)
- **Completed proper layout() cascade system**:
  - Text components now calculate dimensions in layout() method
  - Panel backgrounds update through layout() during window resize
  - Improved resize order: layout() first, then positioning
  - Fixed font example spacing to use consistent font-size calculations
  
- **Enhanced positioning robustness**:
  - Array-based approach for example panel components
  - Proper text alignment with setAlign('center') for titles
  - Separate positioning logic for text vs non-text elements
  - Improved panel sizing on window resize

#### Known Issues
- **Text layout positioning**: Still needs refinement during window resize
  - Some text components may not center properly in all scenarios
  - Text dimensions and positioning interaction needs improvement
  - Consider implementing precise text measurement system

## Current Development Todos

### High Priority (Foundation - UI System & Demo Environment)
- [x] **Task 1**: Create test/demo environment for drawing API ✅ COMPLETED
  - [x] Build developer/demo screen to showcase all UI components
  - [x] Add interactive examples and real-time component testing
  - [x] Include visual style guide and color palette testing
  - [x] Implement proper component hierarchy and positioning system
  - [x] Add array-based layout approach for better encapsulation
- [ ] **Task 1.1**: Polish text layout and visual effects (DEFERRED)
  - [ ] Implement precise text measurement system using canvas.measureText()
  - [ ] Fix text centering and positioning during window resize
  - [ ] Ensure consistent text alignment across all components
  - [ ] Add text baseline and alignment debugging tools
  - [ ] Implement visual effects: Gradients, patterns, shadows via shaders
- [ ] **Task 2**: Expand drawing/rendering API with comprehensive UI primitives ⚠️ IN PROGRESS
  - [x] Add primitive shapes: Circle, Triangle ✅ COMPLETED
  - [ ] Add remaining shapes: Polygon
  - [ ] Create higher-level UI components: Card, ProgressBar, Slider
  - [ ] Build geometric icon system for common UI symbols
- [ ] **Task 2.1**: Fix coordinate system and scrolling issues ⚠️ URGENT
  - [x] Implement RenderContext for coordinate transformation ✅ COMPLETED
  - [x] Add wheel event support to InputSystem ✅ COMPLETED
  - [x] Update Panel to support scrolling with setContentSize ✅ COMPLETED
  - [ ] Fix content bounds calculation - not all content scrolls together properly
  - [ ] Implement keyboard input support for text fields
  - [ ] Remove workaround containsPoint overrides and implement proper hit testing
  - [ ] Improve coordinate transformation performance and accuracy
- [ ] **Task 3**: Implement core UI primitives for game interface
  - [ ] Dialog/Popup component for game modals and menus
  - [ ] ScrollContainer for lists (cards, inventory, settings)
  - [ ] Enhanced Layer management system for z-ordering
  - [ ] Window/Panel system for complex interfaces

### Medium Priority (Game Foundation)
- [ ] **Task 4**: Create Card system foundation - JSON config and CardLoader class
- [ ] **Task 5**: Implement Driver data structures and archetypes
- [ ] **Task 6**: Create Driver Selection Screen with two-panel layout
- [ ] **Task 7**: Build basic Combat Screen layout and UI components
- [ ] **Task 8**: Implement turn-based combat system foundation

### Medium Priority (Core Mechanics)
- [ ] **Task 6**: Create Vehicle and Driver entity classes with stats
- [ ] **Task 7**: Implement card dragging and targeting system
- [ ] **Task 8**: Build initiative/velocity system for turn order
- [ ] **Task 9**: Create positioning system (Front/Back/Flanking)
- [ ] **Task 10**: Implement shared Adrenaline resource pool
- [ ] **Task 11**: Add hit calculation system with gunnery vs evade
- [ ] **Task 12**: Create damage flow system (armor then structure)

### Low Priority (Advanced Features)
- [ ] **Task 13**: Implement basic enemy AI
- [ ] **Task 14**: Build Map/Node navigation screen
- [ ] **Task 15**: Create Shop/Garage screen for upgrades
- [ ] **Task 16**: Add synergy mechanics between drivers
- [ ] **Task 17**: Implement card upgrade system
- [ ] **Task 18**: Create save/load functionality

## Legacy Implementation Status (Archived)

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
