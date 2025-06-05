# AI Development Log

This document contains the chronological log of completed development tasks for Wasteland Wheels. Most recent entries are at the top.

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