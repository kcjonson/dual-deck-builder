# AI Development Log

This document contains the chronological log of completed development tasks for Wasteland Wheels. Most recent entries are at the top.

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
- Fixed PerformanceMonitor to measure actual frame-to-frame time instead of just render time
- Removed broken frame limiting logic that was causing 25 FPS instead of 60 FPS
- Enhanced developer overlay with more detailed timing information

**How:**
- Modified PerformanceMonitor to track time between consecutive frame starts
- Removed manual frame rate limiting as requestAnimationFrame naturally syncs with display refresh rate
- Added min/max frame time display to developer overlay for better performance debugging

**Technical Details:**
- Previous FPS counter was measuring only render execution time, showing thousands of FPS
- Frame limiting logic had a bug where it would skip multiple frames incorrectly
- requestAnimationFrame already provides efficient frame scheduling aligned with display refresh
- Manual frame limiting is only needed when targeting lower than display refresh rate

=========================================

## Combat Log System Implementation (2025-06-08)

### Implemented Combat Log with Event-Driven Updates

**What Changed:**
- Created CombatLog model with efficient event system
- Built CombatLogLayer UI component for displaying entries
- Integrated combat log into CombatScreen layout
- Added logging for all major combat events

**How:**
- Implemented CombatLog as a Model subclass with rolling buffer of entries
- Single `change` event with arrays of added/removed entries for batch updates
- Structured entry format supporting both simple strings and driver-specific messages
- CombatLogLayer efficiently reuses Text components instead of recreating
- Combat log positioned in top-right corner (300x250px)
- Turn phase display positioned in top-left corner
- Added event subscriptions for:
  - Card plays (with driver identification)
  - Turn changes (start/end)
  - Battle end (victory/defeat)
  - Combat initialization

**Technical Details:**
- Model stores `nextId` in data structure to respect immutability
- Automatic `[D1]`/`[D2]` prefixes for driver-specific actions
- Color-coded entries by type (action, damage, heal, status, turn, info)
- Driver-specific colors (blue for D1, green for D2) for action entries
- Non-scrollable implementation for performance
- Efficient rendering with component reuse

## Combat UI Functionality Improvements (2025-01-07)

### Enhanced Combat Screen for Dual-Driver Gameplay

**What Changed:**
- Implemented split resource display showing both drivers' individual resources
- Added card ownership indicators to show which driver owns each card
- Created turn/phase display system for combat flow clarity
- Verified health/armor number displays were already implemented

**How:**
- Created reusable `DriverStatsDisplay` component that shows all stats for a single driver
- Refactored `ResourceBarLayer` to use two `DriverStatsDisplay` instances side by side
- Modified `Card` UI component to accept driver number and display "D1"/"D2" badges
- Created `TurnPhaseDisplay` component with ES6 property accessors for clean API
- Each driver display shows: name, adrenaline pool (with visual icons), deck count, discard count, and fuel
- Used color coding throughout: blue for Driver 1, green for Driver 2
- Turn display shows current turn number, phase, and changes color based on game state

**Technical Details:**
- Used composition pattern with `DriverStatsDisplay` extending Layer for reusability
- Implemented helper method `createStatDisplay` in DriverStatsDisplay for consistent stat rendering
- Card-driver mapping tracked via Map<cardId, driverNumber> for efficient ownership lookup
- Turn phase display integrated with Battle state changes for real-time updates

## Scissor Clipping Fix and UI Cleanup (2025-01-07)

### Fixed Scissor Rectangle Calculation for Scrollable Panels

**What Changed:**
- Fixed scissor test clipping issue where text was showing outside scrollable containers
- Corrected canvas height calculation in Panel.ts for proper WebGL coordinate conversion
- Removed FPS counter from DeveloperScreen as it's now in the developer overlay
- Cleaned up all debug console.log statements related to scissor testing

**How:**
- Fixed the calculation in Panel.ts by extracting `canvasHeight = canvas.height / dpr` before using it
- The issue was that `canvas.height` is already in device pixels, so the math was incorrect
- Removed redundant FPS display from DeveloperScreen.ts since overlay provides better monitoring

**Impact:**
- Scrollable panels now properly clip their content
- No more text rendering outside of panel boundaries
- Cleaner console output without debug statements
- Single source of truth for performance metrics (developer overlay)

=========================================

## Text Batching and Performance Optimization (2025-01-06)

### Implemented Text Batching System

**What Changed:**
- Created TextRenderer class with both immediate and batched rendering modes
- Integrated text batching into the game render loop to reduce draw calls
- Fixed text rendering orientation (was upside down) by correcting texture coordinates
- Fixed scissor test compatibility with text batching for Panel and Layer overflow:hidden
- Added performance monitoring integration for text rendering metrics

**How:**
- TextRenderer groups text by color and renders each color group in a single draw call
- Modified Game.render() to enable text batching for the entire frame
- Fixed texture coordinate mapping (v1/v2 flipped) to correct upside-down text
- Added renderer.flushTextBatch() calls before scissor state changes in Panel and Layer
- Integrated with existing PerformanceMonitor to track text character counts

**Impact:**
- Dramatically reduced draw calls from one-per-character to one-per-color-group (95%+ reduction)
- Text rendering now respects scissor rectangles for proper clipping in scrollable panels
- Performance monitoring now shows accurate text rendering statistics
- Foundation laid for further rendering optimizations

=========================================

## Performance Monitoring System Implementation (2025-01-06)

### Added Developer Performance Overlay

**What Changed:**
- Created PerformanceMonitor class to track rendering metrics
- Added DeveloperOverlay UI component (toggle with F5) showing real-time stats
- Integrated draw call tracking into all Renderer drawing operations
- Fixed frame timing to properly display metrics from completed frames

**How:**
- PerformanceMonitor tracks draw calls, vertices, text characters per frame
- Renderer passes monitor through constructor and records metrics on every GL draw
- DeveloperOverlay renders performance stats in top-right corner
- Fixed timing issue where metrics were reset before being displayed

**Impact:**
- Can now see exact draw call counts (500+ on text-heavy screens!)
- Visibility into performance bottlenecks for optimization
- Text rendering clearly shown as the biggest issue (1 draw call per character)

=========================================

## Performance Analysis and Optimization Planning (2025-01-06)

### Analyzed Critical Performance Issues

**What Changed:**
- Identified 500+ draw calls per frame on simple UI screens
- Found text rendering making one draw call per character (massive bottleneck)
- Discovered no batching, excessive state changes, and missing culling systems
- Created focused performance optimization plan

**How:**
- Profiled rendering pipeline and game loop
- Analyzed shader usage and state management
- Examined text rendering path finding character-by-character drawing
- Created [Performance Optimization Plan](./AI_TECHNICAL_DECISIONS/PERFORMANCE_OPTIMIZATION_PLAN.md) focusing on:
  - Text batching system to reduce text draw calls by 95%+
  - Performance monitor for real-time metrics visibility

=========================================

## Window Resize Scaling Fixes (2025-01-06)

### Fixed Window Resize Scaling Issues

**What Changed:**
- Fixed UI elements not scaling correctly when window resizes
- Updated Renderer to properly update shader projection matrix on resize
- Added onResized support to Layer base class that triggers when setSize is called
- Updated MainMenuScreen to resize background on window resize
- Added onResized handlers to all combat screen layers (EnemyLayer, BattlefieldLayer, PlayerHandLayer, ResourceBarLayer)
- Fixed scrollable panel behavior in DeveloperScreen by storing reference and updating on resize

**How:**
- Root cause: Projection matrix was only sent to shader on initial load, not on resize
- Components were storing fixed dimensions from initialization time
- Scrollable panels weren't being resized when window resized
- Solution: Update shader projection matrix in resize handler, add onResized callbacks to update child component dimensions, and properly resize scrollable containers

## Combat Screen Integration & Card Sizing System (2025-01-06)

### Tasks Completed
- **Task 8 (continued)**: Integrated CombatScreen with new Team/Driver architecture
- **Task 9**: Implemented proper card sizing system

### Key Changes Made
1. **CombatScreen Integration**
   - Updated to use new Team-based battle system
   - Shows combined hand from both drivers in single player mode
   - Fixed compilation errors with CardLoader method names
   - Properly maps UI interactions to Vehicle objects

2. **Card Sizing System**
   - Created CardSize enum with three variants:
     - MINI (50x70) - For deck previews
     - NORMAL (160x224) - Standard gameplay size
     - LARGE (240x336) - For detailed inspection
   - Fixed card stretching issue - all cards now use fixed dimensions
   - Updated all card usage throughout the game

3. **Fixed Card Interactivity**
   - Added adrenaline tracking to PlayerHandLayer
   - Cards properly enable/disable based on available adrenaline
   - Combined both drivers' adrenaline pools for single player mode

### Technical Implementation
- Enemy vehicles: Fixed 160px width
- Player vehicles: Fixed 200px width  
- Cards maintain aspect ratio and consistent sizing across all screens
- Mini cards scale text and UI elements appropriately

=========================================

## Dual Driver/Vehicle System Architecture Implementation (2025-01-06)

### Tasks Completed
- **Major System Redesign**: Implemented proper Symbiotic Driver System architecture

### Key Changes Made
1. **Created Vehicle Class** (`src/renderer/game/mechanics/Vehicle.ts`)
   - Separate entity with armor, structure, speed, and status effects
   - Handles damage flow (armor → structure + occupants)
   - Supports driver + optional passenger

2. **Enhanced Driver Class** (`src/renderer/game/mechanics/Driver.ts`)
   - Individual adrenaline pools (essential for co-op gameplay)
   - Personal hands of cards drawn from individual decks
   - Combat skills (ramming, gunnery, evade)
   - Role system: Active drivers vs Passengers with card restrictions

3. **Created Team System** (`src/renderer/game/mechanics/Team.ts`)
   - Player teams: exactly 2 vehicles
   - Enemy teams: variable number of vehicles
   - Manages vehicle destruction and driver reassignment

4. **Redesigned Battle System** (`src/renderer/game/mechanics/Battle.ts`)
   - Team-based combat instead of single BattleEntity approach
   - Supports individual driver hands and adrenaline management
   - Handles passenger restrictions (no attack cards)

5. **Updated Documentation**
   - Combat Rules spec updated to reflect new architecture
   - Gameplay Mechanics spec clarified individual adrenaline pools
   - Simplified initiative system (players always go first)

### Technical Decisions
- **Individual Driver Hands**: Each driver manages their own deck/hand/discard
- **Co-op Support**: Separate adrenaline pools keep both players engaged
- **Passenger System**: Maintains gameplay after vehicle destruction
- **Team Architecture**: Clean separation between player/enemy sides

### Next Steps
- Update CombatScreen to use new Team/Driver architecture
- Implement vehicle creation from driver configurations
- Add proper UI for dual driver resource management

=========================================

## Combat Screen Implementation & Project Reorganization (2025-01-06)

### Tasks Completed
- **Task 7**: Built basic Combat Screen layout and UI components
- **Project Structure**: Reorganized screens folder structure
- **UI System**: Refactored interaction system and screen lifecycle

### What Changed
- **Combat Screen Architecture**: Implemented layered UI following Game Flow spec
  - EnemyLayer (25%): Enemy vehicles with health bars, armor, and intent indicators
  - BattlefieldLayer (40%): Player vehicles with status effect positions
  - PlayerHandLayer (20%): Card hand with hover effects
  - ResourceBarLayer (5%): Adrenaline, piles, resources, End Turn button
- **Click-to-Play Cards**: Changed from drag-and-drop to click-to-play with target selection
- **Screens Organization**: Each screen now has own subfolder with related components
  - /combat, /driver-selection, /developer, /card-showcase, /main-menu, /splash
- **Screen Lifecycle**: Replaced activate/deactivate with mount/unmount terminology
- **State Management**: Added proper state reset on unmount for all screens
- **Component Base Class**: Added standardized hover/focus/enabled states
- **Event Cleanup**: Fixed interaction issues when switching between screens

### Technical Details
- Fixed TypeScript compilation errors with Rectangle setter methods
- Updated all import paths after folder reorganization
- Added proper cleanup() method to Component base class
- Implemented onMount/onUnmount hooks for screen state management

=========================================

## Driver Selection Screen Implementation (2025-01-02)

### Tasks Completed
- **Task 5**: Implemented Driver data structures and archetypes
- **Task 6**: Created Driver Selection Screen with two-panel layout

### What Changed
- **Driver System Architecture**: Created complete driver data structures with `Driver.ts`, `DriverLoader.ts`, and `DriverSynergy.ts`
- **Dynamic Synergy Analysis**: Built flexible synergy system that analyzes driver compatibility based on actual stats rather than hardcoded rules
- **Modular UI Components**: Created `DriverPanel.ts` and `SynergyPreviewPanel.ts` extending Layer for clean component separation
- **Driver Selection Screen**: Implemented `DriverSelectionScreen.ts` following Game Flow specification section 1.2
- **Sequential Selection Flow**: Left panel activates first, right panel activates after first driver selected
- **Starting Deck Previews**: Added mini-card displays showing each driver's starting deck with quantity indicators
- **Navigation Integration**: Connected to main menu "Start Game" button and added back navigation
- **TypeScript Fixes**: Resolved compilation issues with Button methods, Card constructor, and text wrapping

### Technical Implementation
- **Driver Archetypes**: 4 configured drivers (Road Warrior, Interceptor, Mechanic, Raider) with unique stats and starting decks
- **Synergy System**: Analyzes offensive/defensive/speed/utility balance and generates dynamic descriptions with warnings
- **Component Architecture**: Proper separation of concerns with DriverPanel handling individual driver display and SynergyPreviewPanel handling team analysis
- **Layout System**: Rough but functional layout with text wrapping fixes and proper component sizing

### Notes
- Layout is functional but rough - marked for major visual overhaul in future phases
- All starting deck cards reference existing entries in cards.json
- Component architecture designed for easy future enhancement and styling improvements

=========================================

## Card System Implementation (2025-06-02)

### Complete Card System with Visual Showcase
- **Flexible Card Data Architecture**: Updated Card.ts to match specifications with configurable effects system, variable substitution (e.g., `{damage}`, `{adrenaline}`), and JSON-driven configuration
- **CardLoader Singleton**: Implemented CardLoader class for loading and managing cards from JSON configuration with validation and caching
- **CSS-like Text Wrapping**: Enhanced Text component with `whiteSpace`, `textOverflow`, `lineHeight` properties for proper multi-line rendering
- **Visual Card Component**: Created Card UI component extending Component with clean naming conventions and proper data encapsulation
- **CardShowcaseScreen**: Complete screen showing all cards organized by rarity with scrollable interface and grid layout
- **Integration**: Added "Card Showcase" button to main menu and registered screen in Game.ts
- **Sample Card Data**: Created diverse card examples demonstrating system flexibility including conditional effects, targeting, and status effects
- **TypeScript Fixes**: Resolved all compilation errors related to optional properties and abstract method implementation
- **Public Asset Loading**: Fixed JSON loading by moving cards.json to public directory for proper web serving
- **Scrollable UI Pattern**: Implemented same scrollable container pattern as DeveloperScreen for consistent UX

**Files Modified/Created**:
- `src/renderer/game/mechanics/Card.ts` - Enhanced with flexible effects system
- `src/renderer/game/core/CardLoader.ts` - New singleton for card management  
- `public/cards.json` - Sample card configurations (moved from src)
- `src/renderer/engine/ui/Card.ts` - Visual card component
- `src/renderer/game/screens/CardShowcaseScreen.ts` - New showcase screen with scrolling
- `src/renderer/engine/components/Text.ts` - Enhanced with wrapping support
- `src/renderer/engine/types/Style.ts` - Added text layout properties
- Updated Game.ts and MainMenuScreen.ts for integration
- Fixed Battle.ts null safety for optional card effect properties

## Previously Completed (2025-06-02)

### Interactive Elements and Input System Improvements
- **Fixed interactive elements not working inside scrollable panels**:
  - Created ScrollableContentLayer that properly transforms coordinates for hit testing
  - Buttons and inputs inside scrollable panels now receive mouse events correctly
  - Resolved coordinate transformation issues that prevented interaction with scrolled content
  
- **Enhanced InputSystem to support all interactive components**:
  - Updated InputSystem to check ALL components with mouse handlers, not just those with mouseOver
  - Components with only mouseDown handlers (like inputs) now properly receive events
  - Improved hit testing logic to work with transformed coordinates
  
- **Implemented full keyboard input support**:
  - Added keyboard event handling to InputSystem with keydown, keyup, and keypress events
  - Implemented focus management system for keyboard input routing
  - Added focus() and blur() methods to Component base class
  - Keyboard events now properly route to focused components
  
- **Made text inputs fully functional**:
  - Added cursor display and positioning to Input components
  - Implemented proper focus/blur behavior with visual feedback
  - Text inputs now support typing, backspace, and cursor positioning
  - Added blue outline for focused inputs matching design system
  - Cursor blinks when input is focused and disappears when blurred

## Recently Completed (2025-06-01)

### Coordinate System Implementation and Initial Scrolling
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

- **Current state**: Coordinate system fully implemented with proper hit testing, scrolling works with interactive elements, keyboard input system complete

## Recently Completed (2025-05-31)

### Major Architecture Refactoring: Component Hierarchy
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
  
### Developer Tools Enhancement
- ✅ Created comprehensive test/demo environment
- ✅ Added FPS counter for performance monitoring
- ✅ Interactive controls panel with live color/size manipulation
- ✅ Visual style guide with Wasteland Wheels color palette
- ✅ Input component showcase with various states
- ✅ Fixed window resize handling with proper layout cascade
- ✅ Implemented array-based component positioning to avoid direct children access
- ✅ Added proper text centering with setAlign() for consistent positioning

### Recent Architecture Improvements (2025-05-31 - Latest)
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

### Known Issues
- **Text layout positioning**: Still needs refinement during window resize
  - Some text components may not center properly in all scenarios
  - Text dimensions and positioning interaction needs improvement
  - Consider implementing precise text measurement system