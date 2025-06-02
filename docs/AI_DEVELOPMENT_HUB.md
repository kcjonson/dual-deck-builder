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

## Development Progress

For a complete log of recently completed tasks, see: [AI Development Log](./AI_DEVELOPMENT_LOG.md)

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
- [x] **Task 2**: Expand drawing/rendering API with comprehensive UI primitives ✅ COMPLETED
  - [x] Add primitive shapes: Circle, Triangle ✅ COMPLETED
  - [x] Add remaining shapes: Polygon ✅ COMPLETED
  - [x] Refactor DeveloperScreen into modular section panels ✅ COMPLETED
  - [x] Add "transparent" keyword support to color parser ✅ COMPLETED
  - [ ] Create higher-level UI components: Card, ProgressBar, Slider
  - [ ] Build geometric icon system for common UI symbols
- [x] **Task 2.1**: Fix coordinate system and scrolling issues ✅ COMPLETED
  - [x] Implement RenderContext for coordinate transformation ✅ COMPLETED
  - [x] Add wheel event support to InputSystem ✅ COMPLETED
  - [x] Update Panel to support scrolling with setContentSize ✅ COMPLETED
  - [x] Fix interactive elements in scrollable panels ✅ COMPLETED
  - [x] Implement keyboard input support for text fields ✅ COMPLETED
  - [x] Implement proper hit testing with coordinate transforms ✅ COMPLETED
  - [x] Add focus management for keyboard input ✅ COMPLETED
- [ ] **Task 3**: Implement core UI primitives for game interface (DEFERRED)
  - [ ] Dialog/Popup component for game modals and menus
  - [ ] ScrollContainer for lists (cards, inventory, settings)
  - [ ] Enhanced Layer management system for z-ordering
  - [ ] Window/Panel system for complex interfaces

### Medium Priority (Game Foundation)

- [x] **Task 4**: Create a new screen to showcase all the cards that are configured/loaded ✅ COMPLETED
  - [x] Implemented CardShowcaseScreen with scrollable grid layout
  - [x] Added "Card Showcase" button to main menu
  - [x] Organized cards by rarity with proper navigation
- [x] **Task 4**: Create Card system foundation - JSON config and CardLoader class ✅ COMPLETED
  - [x] Built flexible Card data architecture with variable substitution
  - [x] Implemented CardLoader singleton with validation
  - [x] Created Visual Card UI component extending Component
  - [x] Added CSS-like text wrapping with whiteSpace and textOverflow
  - [x] Fixed JSON loading from public directory
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

## Code Style Guidelines

- Follow existing TypeScript patterns in codebase
- Use existing component hierarchy where possible
- Maintain separation between data (JSON) and logic (TypeScript classes)
- Include JSDoc comments for public methods
- Write tests for critical systems (card loading, combat logic)
