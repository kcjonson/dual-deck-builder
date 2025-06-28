# AI Development Log

This document contains the chronological log of completed development tasks for Wasteland Wheels. Most recent entries are at the top.

=========================================

## Cards.json Update to Match Combat Rules (2025-06-28)

### Updated Card Implementations to Follow Current Combat Rules

**What Changed:**
- Updated cards.json to include all cards specified in Combat Rules document
- Added new cards: Point Blank, Far Shoot, Headshot, Ram, Flank, Oil Slick, Caltrops, Medical Kit, Berserker
- Updated existing cards to match rule specifications:
  - Coordinated Strike → Coordinated Attack (3 damage, doubles if partner attacked)
  - Repair Kit (8 healing with overflow to armor)
  - Nitro Boost (3 speed for 2 turns, draw 2 cards)
  - EMP Blast (upgraded cost reduction)
- Updated starting decks to use cards from the Combat Rules
- Created comprehensive unit tests for Battle system

**How:**
- Reviewed Combat Rules document and compared against existing cards.json
- Maintained backward compatibility by keeping existing cards not in rules
- Used consistent effect structures for all card types
- Added proper upgrade effects where specified in rules
- Created Battle.test.ts with full test coverage for battle mechanics

**Key Implementation Details:**
- Range system implemented with `range` property on damage effects
- Hit modifiers for Headshot implemented with `hit_modifier` property
- Formula-based damage for Ram card using `formula` property
- Status effect duration of -1 indicates permanent effects
- Conditional effects use nested `effect` objects
- Target types include: enemy_single, enemy_all, self, ally, same_vehicle, self_driver

=========================================

## Vehicle UI Architecture Refactor and Combat Log Toggle (2025-01-08)

### Completed Major Vehicle Display System Refactor

**What Changed:**
- Refactored vehicle display and targeting system with event-driven architecture
- Created `/game/ui/Vehicle.ts` component that handles its own click/hover events
- Implemented `CombatModel` to manage UI state (selected cards, targeting, focused vehicles)
- Refactored `BattlefieldLayer` hierarchy to pass full Vehicle models instead of just IDs
- Renamed `EnemyLayer` → `EnemyBattlefieldLayer` for consistency
- Moved `/engine/ui/Card.ts` → `/game/ui/Card.ts` for better organization
- Added F6 key to toggle combat log visibility (hidden by default)
- Enhanced InputSystem with global keyboard handler support

**How:**
- Vehicle components now handle their own input events instead of parent layers checking coordinates
- CombatModel uses our Model base class with automatic getters/setters for state management
- Vehicles listen to CombatModel for state changes and update their visual appearance
- Implemented ES6-style property accessors (get/set) throughout
- Used dimmed colors instead of transparency for non-targetable vehicles
- Added global keyboard handlers to InputSystem that work regardless of focus
- Combat log toggle uses new `InputSystem.registerGlobalKeyDown('F6', handler)`

**Key Architecture Decisions:**
- Event-driven UI where components manage their own interactions
- Clear separation between game state (Battle, Vehicle models) and UI state (CombatModel)
- Components receive full model objects, not just IDs, even if they don't use all properties
- Input abstraction using "focused" instead of "hovered" for future controller support
- Global keyboard handlers checked before component-specific handlers

**Technical Details:**
- `combatModel.targetedVehicle` property automatically emits change events when set
- Vehicle onClick handlers simply set `combatData.targetedVehicle = vehicle`
- CombatScreen listens for 'targetedVehicle' changes to handle card plays
- InputSystem stores global handlers in separate Maps from component handlers
- Proper cleanup of global handlers on screen unmount

=========================================

## FPS Limiting Investigation and Fix (2025-06-08)

### Fixed Frame Rate Measurement and Removed Broken Frame Limiting

**What Changed:**
- Fixed FPS measurement to show actual frame rate (was showing ~8500 FPS due to timing bug)
- Removed broken frame limiting code that wasn't actually limiting frames
- Now correctly shows 120 FPS on 120Hz displays (browser's natural vsync)
- Simplified game loop to use browser's built-in frame synchronization

**How:**
- Fixed `lastFrameTime` initialization - was comparing against 0 causing huge initial delta
- Removed artificial frame limiting attempts (setTimeout/setImmediate)
- Let browser handle frame timing naturally through requestAnimationFrame
- Now respects display refresh rate automatically

=========================================

## Combat Log System Implementation (2025-01-07)

### Added Combat Event Logging with Scrollable Display

**What Changed:**
- Created CombatLog model class to track all combat events
- Implemented CombatLogLayer UI component with auto-scrolling
- Added comprehensive event logging throughout Battle system
- Color-coded entries by type (damage, heal, turn changes, etc.)
- Driver-specific formatting with [D1]/[D2] prefixes

**How:**
- CombatLog extends Model base class for automatic property management
- Efficient rendering with view window calculation (only renders visible entries)
- Automatic scrolling to bottom when new entries added
- Integrated with Battle system to log all major events
- Each entry typed as CombatLogEntry with timestamp and formatting

=========================================

## Framerate Display Enhancement (2025-01-07)

### Improved FPS Counter Visibility and Stability

**What Changed:**
- Moved FPS display to top-right corner with dark background
- Added 100ms update interval to prevent flickering
- Improved contrast with yellow text on dark background
- Made performance metrics more readable

**How:**
- Added semi-transparent black background panel
- Positioned in top-right to avoid overlapping game content
- Implemented update throttling in PerformanceMonitor
- Only updates display when 100ms have passed since last update

=========================================

## Combat UI Clarity Improvements (2025-01-06)

### Phase 1: Resource Display and Card Ownership

**What Changed:**
- Split resource display to show both drivers' stats separately
- Added card ownership indicators (D1/D2 overlays with color coding)
- Created reusable DriverStatsDisplay component
- Implemented turn/phase display with clear indicators
- Added draw pile and discard pile counts per driver

**How:**
- Extended ResourceBarLayer to show two DriverStatsDisplay components
- Modified Card UI component to show driver badges and tinted backgrounds
- Created TurnPhaseDisplay component with color-coded phase indicators
- Used Model's state management for reactive UI updates

### Phase 2: Vehicle Positioning System

**What Changed:**
- Implemented 3-lane positioning system (Flanking, Back, Front)
- Added visual lanes with proper labels
- Support for multiple vehicles per position (up to 3)
- Smart stacking and spacing within lanes

**How:**
- Created lane-based layout in battlefield layers
- Calculated vehicle positions based on lane and stack index
- Added translucent background rectangles for lane visualization
- Maintained 30px spacing between stacked vehicles

**Technical Decision:**
- See [Vehicle Positioning and Wave System Design](./AI_TECHNICAL_DECISIONS/VEHICLE_POSITIONING_AND_WAVE_SYSTEM.md)

=========================================

## Performance Optimization Implementation (2024-12-30)

### Major Performance Improvements Through Text Batching

**What Changed:**
- Reduced draw calls from 500+ to ~30 per frame (94% reduction)
- Implemented efficient text batching system
- Added real-time performance monitoring (F5 to toggle)
- Fixed upside-down text rendering issue
- Resolved scissor test compatibility with batching

**How:**
- Created TextBatchRenderer with pre-allocated vertex buffers
- Batch all text rendering into single draw call per frame
- Integrated seamlessly with existing immediate-mode rendering
- Added PerformanceMonitor to track metrics in real-time

**Results:**
- Text-heavy screens now performant (DeveloperScreen: 500+ → 30 draw calls)
- Maintains 60 FPS on all screens
- No visual differences - exact same output with better performance

=========================================

## Basic Combat System Implementation (2024-12-29)

### Dual Driver Combat with Individual Resources

**What Changed:**
- Implemented Team-based battle system (Player: 2 vehicles, Enemy: variable)
- Each driver has individual hand, deck, and adrenaline pool
- Created visual combat screen with all major components
- Added turn-based flow with enemy AI
- Implemented card playing mechanics and battle resolution

**How:**
- Refactored from single BattleEntity to Team/Vehicle/Driver architecture
- Created combat UI layers: Enemy, Battlefield, PlayerHand, Resources
- Connected driver selection to combat with proper data flow
- Added Model base class for reactive state management

**Key Features:**
- Players always have initiative (enemy AI simplified)
- Passengers can't play attack cards (role restrictions)
- Click-to-play cards (drag-and-drop deferred)
- Visual feedback for playable/unplayable cards

=========================================

## Driver Selection Screen (2024-12-28)

### Created Two-Panel Driver Selection Interface

**What Changed:**
- Built complete driver selection screen with synergy preview
- Added 4 driver archetypes with full metadata and starting decks
- Implemented dynamic synergy detection between selected drivers
- Created mini-card previews for starting decks

**How:**
- Extended Layer class for DriverPanel components
- Created SynergyPreviewPanel with real-time analysis
- Used singleton DriverLoader for driver instance management
- Connected to main menu and combat screen flow

=========================================

## Card System Foundation (2024-12-27)

### Implemented Complete Card Loading and Display System

**What Changed:**
- Created flexible JSON-based card configuration system
- Built CardLoader singleton for parsing and validation
- Implemented visual Card UI component with full styling
- Added card showcase screen to preview all cards

**How:**
- Designed extensible card effect system with variables
- Added CSS-like text formatting (wrap, ellipsis, shadows)
- Created scrollable grid layout organized by rarity
- Fixed JSON loading from public directory

=========================================

## Driver System Architecture (2024-12-26)

### Built Complete Driver Data Management

**What Changed:**
- Created Driver class with skills, vehicle stats, and metadata
- Implemented DriverLoader for managing driver instances
- Built DriverSynergy system for analyzing driver combinations
- Added driver archetypes: road_warrior, interceptor, mechanic, raider

**How:**
- Structured driver data to match game design specs
- Created flexible synergy detection based on cards and skills
- Integrated with deck building system

=========================================

## Scrollable Panel System (2024-12-23)

### Complete Overhaul of Coordinate System

**What Changed:**
- Implemented RenderContext for proper coordinate transformations
- Added mouse wheel scrolling support
- Fixed hit testing in scrollable containers
- Added keyboard input with focus management

**How:**
- Coordinate transform stack for nested scrolling contexts
- Scissor test integration for proper clipping
- Component-aware coordinate transformation for input events

**Technical Decision:**
- See [Scrollable Panel Architecture](./AI_TECHNICAL_DECISIONS/scrollable-panel-architecture.md)

=========================================

## UI Primitive Expansion (2024-12-20)

### Added Geometric Shapes and Modular Architecture

**What Changed:**
- Added Circle, Triangle, Polygon, Arrow components
- Refactored DeveloperScreen into modular sections
- Added gradient rendering capabilities
- Improved Panel styling with borders and shadows

**How:**
- Extended Component base class for all shapes
- Created section-based architecture for demo screen
- Used efficient triangulation for complex shapes

=========================================

## Developer Screen Creation (2024-12-15)

### Built Comprehensive Component Showcase

**What Changed:**
- Created interactive developer/demo environment
- Added examples of all UI components
- Implemented visual style guide
- Built modular section system

**How:**
- Organized into panels: primitives, text, buttons, inputs, etc.
- Real-time interactive testing capabilities
- Visual demonstration of theming system

=========================================