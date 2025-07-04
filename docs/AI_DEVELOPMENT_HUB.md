# Wasteland Wheels Development Hub

This document is a place for multiple AI workers (such as Claude and Claude Code) to store status, open questions, technical decisions and more. This should be formatted for the workers to read, and isn't particularly for a human audience.

=========================================

## Recent Updates

### Combat UI Enhancement - Driver Information Display (January 3, 2025)
- **Completed**: Major UI redesign to show all driver information in combat
- Implemented changes:
  - ✅ Moved resource bar to top of screen (7% height) with per-driver adrenaline display
  - ✅ Adjusted all layer heights: Resource 7%, Enemy 23%, Battlefield 40%, Hand 18%
  - ✅ Enhanced Vehicle UI to show driver name, HP, and portrait on each vehicle card
  - ✅ Reduced font sizes globally for space efficiency (cards, vehicle info, resources)
  - ✅ Reduced card dimensions from 160×224 to 150×210 for better layout
  - ✅ Added visual driver grouping in hand layer with divider and labels
  - ✅ Repositioned turn phase display and combat log below resource bar
- All missing driver information from HTML AI test UI is now displayed
- Combat screen now clearly shows the dual-driver system in action

### Combat Interface Bug Fixes (January 3, 2025)
- **Completed**: Fixed all high-priority bugs in main game combat interface
- Fixed issues:
  - ✅ Card targeting system - removed arrow visualization, fixed click targeting
  - ✅ Cards properly removed from hand after playing
  - ✅ End turn now correctly draws new cards
  - ✅ Resource displays update with per-driver adrenaline tracking
  - ✅ Victory/defeat screen implemented with data passing
  - ✅ Fixed CombatLogLayer to handle Model change events correctly
  - ✅ Fixed targeting by emitting proper events from CombatModel
- Modified screen system to support data passing between screens
- Ready for AI integration once remaining polish items are complete
  
### AI Integration Complete (January 3, 2025)
- Fixed all critical combat interface bugs first
- Enabled AI controller in CombatScreen - enemy team now uses AggressiveFlankerAI
- Removed placeholder enemy turn logic (now handled by Battle system)
- AI integration is working! The same AI from battle simulator now controls enemies in main game
- Enhanced combat logging to match battle simulator's comprehensive output:
  - Added 6 new log types: MISS, ARMOR, RESOURCE, POSITION, BATTLE_START, BATTLE_END
  - Combat log now displays turn numbers for all messages
  - Improved color coding for different message types
  - CombatScreen passes battle messages directly to CombatLog for processing
  - Players now see detailed combat information including damage breakdowns, healing amounts, status effects, and more
- Fixed card click routing bug:
  - Cards were not being unregistered from InputSystem when screens unmounted
  - Added proper unmount calls to CardShowcaseScreen and CombatScreen
  - Leveraged existing Layer/Component unmount() architecture

### UI Component Lifecycle Standardization (January 3, 2025)
- **Completed**: Standardized all component lifecycle terminology to use mount/unmount
- Fixed ghost click bug where main menu buttons remained active after screen transition:
  - Screen base class now calls unmount() on root layer when unmounting
  - This recursively unmounts all child components, properly cleaning up event handlers
- Renamed all lifecycle methods for consistency:
  - `cleanup()` → `unmount()` in Component, Layer, Panel, Input classes
  - `destroy()` → `unmount()` in Vehicle UI component  
  - `dispose()` → `unmount()` in FontAtlas class
- All UI components now follow consistent lifecycle pattern:
  - `mount()` for initialization (where applicable)
  - `unmount()` for cleanup and resource disposal
- Updated all references throughout codebase and documentation

### Adrenaline System Configuration (January 2, 2025)
- Changed default max adrenaline from 10 to 5 for all drivers
- Added `maxAdrenaline` to `DriverConfig` interface
- Now configurable per driver archetype (currently all set to 5)
- Makes gameplay more tactical with limited energy pool

### Battle Log Display for Human Player (January 2, 2025)
- Added real-time battle log pane to human player interface
- Displays on right side, expanding to fill available space
- Color-coded messages by type (damage, healing, turns, etc.)
- Auto-scrolls to show newest entries
- Clears when starting a new battle
- Driver names include team prefixes (Player1/2, Enemy1/2)

### Layer Stacking and Overflow Fixes (January 3, 2025)
- Fixed issue where card text was visible through the bottom resource bar
- Added `overflow: 'hidden'` to all combat screen layers:
  - PlayerHandLayer - prevents cards from extending beyond layer bounds
  - ResourceBarLayer - ensures clean boundaries
  - BattlefieldLayer (base class) - consistent clipping for all battlefield content
- Improved card positioning in hand layer with vertical padding to ensure cards stay within bounds
- Cards now properly clip at layer boundaries on all screen sizes

### Screen Manager Implementation and Combat Initialization Fix (January 3, 2025)
- Implemented ScreenManager with lazy screen creation to fix input handling bugs
- Fixed combat screen initialization issues:
  - Added proper async handling for onMount in Screen base class
  - Combat screen now properly initializes when receiving driver data
  - Added fallback for development - creates default drivers if none provided
  - Fixed UI update timing - ensures UI refreshes after async combat initialization
- All screens now properly unmount when navigating away

## Active Issues

### ~~Screen Management Architecture Refactor~~ COMPLETED
- **Problem**: All screens created at startup causing input handler conflicts
- **Symptoms**: Clicking cards can navigate to unexpected screens (DevScreen, CardShowcase)
- **Root Cause**: Screens create interactive components in constructors that register global input handlers
- **Solution**: Implemented ScreenManager with lazy screen creation and proper unmount
- **Technical Decision**: [Screen Manager Architecture](./AI_TECHNICAL_DECISIONS/screen-manager-architecture.md)
- **Status**: COMPLETED - ScreenManager implemented, all screens refactored

### ~~Critical Performance Problems~~ RESOLVED
- ~~**500+ draw calls per frame** on simple UI screens~~
- ~~**Text rendering**: Each character is a separate draw call (200+ characters = 200+ draw calls)~~
- ~~**No performance monitoring**: Can't measure optimization impact~~
- **RESOLVED**: Text batching implemented, reducing draw calls from 500+ to ~30
- **RESOLVED**: Performance monitoring with dev overlay (F5 to toggle)
- See [Performance Optimization Plan](./AI_TECHNICAL_DECISIONS/PERFORMANCE_OPTIMIZATION_PLAN.md) for implementation details

### AI Player System - IMPLEMENTED WITH NEW STRATEGIES
- **Status**: Complete with advanced AI strategies including MCTS
- Created computer-run player system with swappable AI implementations
- Can control both player and enemy teams
- Implemented AI strategies:
  - RandomAI: Baseline strategy that randomly selects from valid actions
  - AggressiveFlankerAI: Prioritizes flanking position for 50% damage bonus, focuses on high-damage attacks
  - **MCTSAI**: Monte Carlo Tree Search algorithm that simulates games to find effective moves
    - Uses UCB1 for balancing exploration vs exploitation
    - Configurable iterations (default 1000) and exploration constant
    - Evaluates actions based on damage potential, healing efficiency, and resource management
    - Simplified implementation using action evaluation rather than full game state cloning
  - **SalvageAI**: (NEW - December 30, 2024) Smart AI that wins while minimizing vehicle damage
    - Balances between winning the game and preserving enemy vehicles for salvage
    - Game state aware: switches strategies based on health ratios and card advantage
    - Prioritizes flanking position for 50% damage bonus when safe
    - Values card draw to find headshot cards faster
    - Uses adaptive strategy: aggressive when losing, selective when winning
    - Still prefers headshots but will use regular damage when necessary
  - **RammingAI**: (NEW - December 30, 2024) Aggressive close-combat AI focused on ramming attacks
    - Prioritizes ramming attacks above all other damage types
    - Builds up speed and armor to maximize ramming effectiveness
    - Prefers front position for optimal ramming positioning
    - Estimates ram damage based on armor, speed difference, and driver skills
    - Still prioritizes healing when at critical health (<30%)
    - Targets low-health enemies for kill bonuses with rams
- Full test coverage with AI vs AI battles
- **NEW: AI Evaluation System** (December 30, 2024)
  - Created `/evalai.html` endpoint for comprehensive AI evaluation
  - Runs round-robin tournaments between all AI types
  - Tests different driver combinations to assess AI adaptability
  - Provides detailed metrics: win rates, head-to-head matchups, average turns
  - Results show MCTS AI as the strongest, followed by Aggressive Flanker, then Random
- **Human Player Support** (January 2, 2025)
  - Added human player option to battle simulator
  - Created interactive UI for card selection and target choosing
  - Players can see both teams' vehicle status and positions
  - Each driver's hand shows cards with costs and effects
  - Cards that can't be played (insufficient adrenaline) are grayed out
  - Target selection highlights valid targets when needed
  - End turn button allows passing control to enemy AI
  - Maintains ability to run AI vs AI battles
- Additional planned strategies:
  - Synergy Optimizer AI: Focuses on driver synergy and combo effects
  - Resource Control AI: Emphasizes card advantage and adrenaline efficiency
  - Tactical Positioning AI: Dynamic position changes based on game state
  - Focus Fire AI: Concentrates attacks to eliminate vehicles quickly
  - Adaptive Strategy AI: Analyzes opponent patterns and counters them


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

### Performance Optimization (HIGHEST PRIORITY)
- [x] **Performance Task 1**: Add PerformanceMonitor with real-time metrics ✅ COMPLETED
  - [x] Track draw calls, vertices, text characters per frame
  - [x] Calculate and display FPS and frame times
  - [x] Add developer overlay (F5 to toggle)
  - [x] Hook into Renderer to count actual GL calls
- [x] **Performance Task 2**: Implement TextBatchRenderer for single-draw-call text rendering ✅ COMPLETED
  - [x] Create TextRenderer class with pre-allocated vertex buffer
  - [x] Implement both immediate and batched rendering modes
  - [x] Integrate with existing Renderer class
  - [x] Fix text orientation (was upside down)
  - [x] Fix scissor test compatibility with batching
  - [x] Test on DeveloperScreen (highest text density)

### Phase One (Foundation - UI System & Demo Environment)

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

### Phase Two (Game Foundation)

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
- [x] **Task 5**: Implement Driver data structures and archetypes ✅ COMPLETED
  - [x] Created Driver class with complete metadata and vehicle stats
  - [x] Implemented DriverLoader for managing driver instances
  - [x] Built DriverSynergy system for dynamic driver analysis
  - [x] Configured 4 driver archetypes with proper starting decks
- [x] **Task 6**: Create Driver Selection Screen with two-panel layout ✅ COMPLETED
  - [x] Built DriverPanel component extending Layer for driver display
  - [x] Created SynergyPreviewPanel for dynamic synergy analysis
  - [x] Implemented sequential driver selection (left panel activates first)
  - [x] Added starting deck preview with mini-cards
  - [x] Connected to main menu navigation
  - [x] ROUGH LAYOUT - functional but needs major visual overhaul later
- [x] **Task 7**: Build basic Combat Screen layout and UI components ✅ COMPLETED
  - [x] Created EnemyLayer for top 25% with enemy health, armor, intent indicators
  - [x] Built BattlefieldLayer for middle 40% with player vehicle display
  - [x] Implemented PlayerHandLayer for bottom 20% with card hand
  - [x] Added ResourceBarLayer for bottom 5% with adrenaline, resources, End Turn button
  - [x] Connected CombatScreen to driver selection flow
  - [x] Implemented click-to-play card system (not drag-and-drop)
  - [x] Added proper hover effects and visual feedback
  - [x] Fixed screen navigation and event handler unmount issues
  - [x] Reorganized screens folder structure (each screen has own subfolder)
  - [x] Refactored screen lifecycle (activate/deactivate → mount/unmount)
  - [x] Added proper state reset for screens on unmount
- [x] **Task 8**: Implement dual driver/vehicle system foundation ✅ COMPLETED
  - [x] Created Vehicle class with combat stats (armor, structure, speed)
  - [x] Updated Driver class with individual adrenaline pools and hands
  - [x] Implemented Team-based architecture (Player team: 2 vehicles, Enemy team: variable)
  - [x] Redesigned Battle system to use Teams instead of single BattleEntity
  - [x] Added driver role system (Active vs Passenger with card restrictions)
  - [x] Updated Combat Rules documentation to reflect new system
  - [x] Simplified initiative system (players always go first)
  - [x] Update CombatScreen to use new Team/Driver architecture ✅ COMPLETED
- [x] **Task 9**: Implement proper card sizing system ✅ COMPLETED
  - [x] Created CardSize enum (MINI, NORMAL, LARGE) for consistent card dimensions
  - [x] Fixed vehicle card stretching - all cards now use fixed dimensions
  - [x] Updated PlayerHandLayer to use proper card sizing
  - [x] Updated DriverPanel to use Card components with MINI size
  - [x] Fixed card interactivity issues in combat screen

### Phase Three (Combat Functionality)

#### Screen Manager Architecture Refactor ✅ COMPLETED
- [x] **Task 21**: Implement ScreenManager system ✅ COMPLETED
  - [x] Create ScreenManager class in core/ ✅
  - [x] Define ScreenName type with all screen identifiers ✅
  - [x] Implement navigate() method with proper unmount ✅
  - [x] Add createScreen() factory method ✅
  - [x] See [Screen Manager Architecture](./AI_TECHNICAL_DECISIONS/screen-manager-architecture.md)
- [x] **Task 22**: Update Screen base class ✅ COMPLETED
  - [x] ~~Add screenManager reference~~ Not needed with static class approach ✅
  - [x] ~~Add protected navigate() helper~~ Using static ScreenManager.navigate() instead ✅
  - [x] Document that screens should not create UI in constructors ✅
  - [x] Ensure all screens have proper unmount in unmount() ✅
- [x] **Task 23**: Refactor screens to lazy-load UI ✅ COMPLETED
  - [x] CardShowcaseScreen: Move loadCards() from constructor to onMount() ✅
  - [x] DeveloperScreen: Already loads UI properly ✅
  - [x] Audit all other screens for constructor UI creation ✅
  - [x] Ensure all components are destroyed in onUnmount() ✅
- [x] **Task 24**: Update navigation pattern ✅ COMPLETED
  - [x] Remove all setOnX() callback methods from screens ✅
  - [x] Replace with direct navigate() calls ✅
  - [x] Update all screen transitions to use new pattern ✅
- [x] **Task 25**: Simplify Game class ✅ COMPLETED
  - [x] Remove screen creation and storage ✅
  - [x] Remove showScreen() method ✅
  - [x] Create and delegate to ScreenManager ✅
  - [x] Focus Game class on high-level game state ✅

#### Vehicle Positioning System (IN PROGRESS)
- [ ] **Task 15**: Implement vehicle positioning mechanics
  - [x] Create visual lanes for Flanking/Back/Front positions (left to right) ✅ COMPLETED
  - [x] Support up to 3 vehicles per position with smart stacking ✅ COMPLETED
  - [ ] Implement position-based targeting restrictions
  - [ ] Add movement cards and mechanics
  - [ ] Calculate range for attacks based on positions
  - [x] Show position clearly in UI ✅ COMPLETED
  - [ ] Add wave system for spawning enemies (max 6 on screen)
  - See [Vehicle Positioning and Wave System Design](./AI_TECHNICAL_DECISIONS/VEHICLE_POSITIONING_AND_WAVE_SYSTEM.md)
  - **CURRENT WORK**: Refactored vehicle display with event-driven architecture

#### Critical Gameplay Clarity (HIGH PRIORITY)
- [x] **Task 10**: Split resource display for dual drivers ✅ COMPLETED
  - [x] Show both drivers' adrenaline pools separately in resource bar
  - [x] Add driver names next to their resources
  - [x] Display current/max adrenaline for each driver
  - [x] Created reusable DriverStatsDisplay component
  - [x] Show draw pile, discard pile, and fuel per driver
- [x] **Task 11**: Add card ownership indicators ✅ COMPLETED
  - [x] Add driver identifier (D1/D2) overlay on cards in hand
  - [x] Use different background tint per driver (blue/green)
  - [x] Make it clear which driver owns which card
- [x] **Task 12**: Implement turn/phase display ✅ COMPLETED
  - [x] Add clear "Player Turn" / "Enemy Turn" indicator
  - [x] Show turn counter
  - [x] Display current phase with color coding
  - [x] Created TurnPhaseDisplay component

#### Combat Feedback (HIGH PRIORITY)
- [x] **Task 13**: Add damage/health number displays ✅ COMPLETED
  - [x] Show current/max values on all health bars (already implemented)
  - [x] Display armor values clearly (already showing numeric values)
  - [x] Numbers update in real-time via Model system
- [x] **Task 14**: Implement combat log ✅ COMPLETED
  - [x] Created CombatLog model with event-driven updates
  - [x] Built CombatLogLayer with efficient rendering
  - [x] Logs card plays, turn changes, and battle events
  - [x] Driver-specific formatting with [D1]/[D2] prefixes
  - [x] Color-coded by entry type
- [ ] **Task 16**: Add enemy intent display
  - [ ] Show what enemy will do next turn (e.g. "Attack: 8 damage")
  - [ ] Display which vehicle enemy is targeting
  - [ ] Simple text-based display

#### Missing Mechanics (MEDIUM PRIORITY)
- [ ] **Task 16**: Implement status effects display
  - [ ] Show active effects on vehicles (e.g. "Burning (2)")
  - [ ] List effects under health bars
  - [ ] Track duration/stacks properly
- [ ] **Task 17**: Add card effect previews
  - [ ] Show expected damage/effect on hover
  - [ ] Account for modifiers and status effects
  - [ ] Help players make informed decisions
- [ ] **Task 18**: Fix end turn functionality
  - [ ] Ensure End Turn button works properly
  - [ ] Draw cards for next turn
  - [ ] Reset adrenaline pools

#### Game Flow (MEDIUM PRIORITY)
- [ ] **Task 19**: Handle victory/defeat properly
  - [ ] Clear message when battle ends
  - [ ] Add "Continue" button to exit combat
  - [ ] Return to appropriate screen
- [ ] **Task 20**: Improve enemy AI
  - [ ] Make enemies use variety of cards
  - [ ] Target damaged vehicles strategically
  - [ ] Use defensive cards when appropriate

### Phase Four (Future Polish - DEFERRED)
- [ ] Card dragging and smooth animations
- [ ] Initiative/velocity system for turn order
- [ ] Positioning system (Front/Back/Flanking)
- [ ] Hit calculation with gunnery vs evade
- [ ] Visual effects and juice

### Phase Four (Game Flow Spec Implementation)

- [ ] **Task 5**: Driver Selection Screen (Game Flow Spec 1.2)

  - [ ] Create two-panel layout with driver portraits and vehicle artwork
  - [ ] Add starting deck preview with mini-card visuals
  - [ ] Implement synergy preview panel between drivers
  - [ ] Add driver browsing carousel/dropdown system

- [ ] **Task 6**: Combat Screen Layout (Game Flow Spec 2)

  - [ ] Enemy area (top 25%) with vehicle portraits and intent indicators
  - [ ] Battlefield center (40%) with player vehicle displays
  - [ ] Player interface (35%) with hand and resource management
  - [ ] Resource bar with adrenaline, fuel, scrap indicators

- [ ] **Task 7**: Card Targeting System (Game Flow Spec 2.3)

  - [ ] Drag-and-drop card targeting with visual feedback
  - [ ] Target highlighting (red enemies, green allies)
  - [ ] Damage preview on hover
  - [ ] Card animation to discard pile

- [ ] **Task 8**: Turn Flow Experience (Game Flow Spec 2.4)
  - [ ] Adrenaline refill animation at turn start
  - [ ] Card draw with swooping animations
  - [ ] End turn confirmation and enemy turn display

### Phase Five (Core Systems)

- [ ] **Task 9**: Enemy Intent System (Game Flow Spec 2.1)

  - [ ] Intent indicators above enemies (crosshair, shield, wrench icons)
  - [ ] Animated next-action previews
  - [ ] Multi-action intent display

- [ ] **Task 10**: Vehicle Health & Armor Display (Game Flow Spec 2.2)

  - [ ] Health bars with numerical values
  - [ ] Visual armor plating that depletes
  - [ ] Status effect orbital indicators
  - [ ] Damage animations

- [ ] **Task 11**: Map Navigation Screen (Game Flow Spec 3)

  - [ ] Vertical progression map with branching paths
  - [ ] Node type indicators (combat, elite, garage, scavenge, events)
  - [ ] Path highlighting and risk/reward visualization

- [ ] **Task 12**: Garage/Shop Screen (Game Flow Spec 4)
  - [ ] Three-panel layout (deck management, new cards, vehicle mods)
  - [ ] Scrap currency system
  - [ ] Card removal and purchasing mechanics

### Phase Six (Advanced Features)

- [ ] **Task 13**: Event Screen System (Game Flow Spec 5)

  - [ ] Narrative presentation with choice cards
  - [ ] Risk/reward indicators for choices
  - [ ] Event artwork and atmospheric presentation

- [ ] **Task 14**: Victory & Defeat Screens (Game Flow Spec 6)

  - [ ] Statistics display and unlock ceremonies
  - [ ] Learning opportunities on defeat
  - [ ] Run progress recognition

- [ ] **Task 15**: Accessibility Features (Game Flow Spec 7.3)

  - [ ] Colorblind support with icon supplements
  - [ ] Keyboard navigation system
  - [ ] Simplified card text mode
  - [ ] Turn history log

- [ ] **Task 16**: Platform Adaptations (Game Flow Spec 8)

  - [ ] Controller support for console/Steam Deck
  - [ ] Touch controls and trackpad utilization
  - [ ] Platform-specific UI scaling

- [ ] **Task 17**: Implement basic enemy AI
- [ ] **Task 18**: Add synergy mechanics between drivers
- [ ] **Task 19**: Implement card upgrade system
- [ ] **Task 20**: Create save/load functionality

## Code Style Guidelines

- Follow existing TypeScript patterns in codebase
- Use existing component hierarchy where possible
- Maintain separation between data (JSON) and logic (TypeScript classes)
- Include JSDoc comments for public methods
- Write tests for critical systems (card loading, combat logic)
