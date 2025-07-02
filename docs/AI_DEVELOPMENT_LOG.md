# AI Development Log

This document contains the chronological log of completed development tasks for Wasteland Wheels. Most recent entries are at the top.

=========================================

## Battle Log Display for Human Player Interface (2025-01-02)

### Added Real-time Battle Log to Human Player UI

**What Changed:**
- Added a scrollable battle log pane on the right side of the human player interface
- Battle messages are displayed in real-time as the game progresses
- Each message type has its own color coding for better readability
- Log automatically scrolls to show the newest entries
- **Driver names now include team prefixes** (Player1/Player2 or Enemy1/Enemy2) for clarity

**Technical Details:**
- Modified HTML structure to use a flex layout with game board on left and log on right
- Battle log pane is 400px wide with scrollable content area
- Forwarded battle message events from Battle instance to window events
- Added event listener to capture and display battle messages
- Color-coded message types:
  - Damage dealt: Red
  - Healing: Green
  - Turn start/end: Blue
  - Card played: Purple
  - Miss: Gray (italic)
  - Battle start/end: Yellow
- Messages include turn numbers for context
- Log clears when starting a new battle
- Added `getDriverDisplayName()` helper method to Battle class that prefixes driver names with:
  - Player1/Player2 for player team drivers
  - Enemy1/Enemy2 for enemy team drivers
- Updated all battle log messages to use the new display names

=========================================

## Adrenaline System Configuration Update (2025-01-02)

### Changed Default Max Adrenaline from 10 to 5

**What Changed:**
- Added `maxAdrenaline` property to the `DriverConfig` interface
- Updated all driver configurations to include `maxAdrenaline: 5`
- Modified `DriverLoader` to use the configured max adrenaline value instead of hardcoded 10
- Fixed `getConfig()` method to include maxAdrenaline in returned configuration

**Technical Details:**
- `maxAdrenaline` is now exposed alongside `maxHitpoints` in driver configurations
- All four driver archetypes (road_warrior, interceptor, mechanic, raider) now have 5 max adrenaline
- Starting adrenaline remains at 3
- This change makes the game more tactical by limiting the energy pool for playing cards
- Players must be more strategic about card usage with the reduced adrenaline capacity

=========================================

## Human Player Interface for Battle Simulator (2025-01-02)

### Added Human Player Support to Battle System

**What Changed:**
- Implemented human player option in battle.html, allowing manual card play instead of AI-only battles
- Created HumanPlayerInterface class to manage player decisions and UI interactions
- Modified BattleSimulator to support human input through promise-based decision system
- Added comprehensive interactive UI overlay for human players

**Technical Details:**
- Created event-driven architecture using custom events for UI updates
- UI Components:
  - Team displays showing vehicle status (structure, armor, position, drivers)
  - Driver sections with hand display showing cards with costs and effects
  - Visual feedback for playable vs unplayable cards (based on adrenaline)
  - Target selection interface that highlights valid targets
  - End turn button for passing control to enemy AI
- Card selection flow:
  1. Player clicks card → Card is highlighted
  2. If card needs target → Valid targets are highlighted
  3. Player clicks target → Card is played
  4. UI updates to show new game state
- Maintained full compatibility with existing AI vs AI battles
- Fixed TypeScript issues with TargetType enum values and Team method names

=========================================

## Ramming AI Implementation (2024-12-30)

### Created Ramming-Focused AI Strategy

**What Changed:**
- Implemented RammingAI strategy that prioritizes vehicle collision attacks
- Added 'ramming' as a new AI type in AIController
- Created comprehensive test suite for RammingAI behavior
- Updated AI Development Hub documentation with new strategy details

**Technical Details:**
- Strategy prioritizes ramming attacks with highest score (+300)
- Speed boosts are high priority (+250) to enable effective ramming
- Armor is valued (+200) for protection during collisions
- Detects ramming cards by:
  - Card type/description containing 'ram'
  - Effects with scaling: 'ramming'
  - Formula-based damage (e.g., 'armor/10 + speed_diff')
- Estimates ram damage based on armor, speed difference, and driver skills
- Prefers front position for optimal ramming range
- Targets low-health enemies for kill bonuses
- Still maintains survival instincts (healing at <30% health)
- Full test coverage validates all strategic priorities

## Salvage AI Implementation (2024-12-30)

### Created AI Strategy for Vehicle Salvage

**What Changed:**
- Implemented SalvageAI strategy that minimizes vehicle damage for salvage opportunities
- Added 'salvage' as a new AI type in AIController
- Updated AI Development Hub documentation with new strategy
- **Major revision**: Redesigned AI to be competitive while maintaining salvage focus

**Technical Details:**
- Initial implementation was too passive and lost to RandomAI
- Redesigned with game state awareness:
  - Evaluates health ratios to determine if in danger or winning
  - Switches strategies based on game state (survival mode when losing)
  - Prioritizes flanking position for 50% damage bonus (+150 score)
  - Values card draw to find headshots faster (+80 score)
  - Focuses fire on damaged vehicles for efficiency
- Headshot priority reduced from +1000 to +500 for better balance
- Structure damage penalty reduced from -10 to -5 per damage
- Added team detection to properly evaluate game state
- Demonstrates strategic depth while maintaining salvage theme

## AI Evaluation System (2024-12-30)

### Created Comprehensive AI Evaluation System

**What Changed:**
- Created AIEvaluator class to run automated AI vs AI tournaments
- Built `/evalai.html` endpoint for running and visualizing AI evaluations
- Implemented round-robin tournament system with configurable parameters
- Added detailed metrics tracking and reporting

**Technical Details:**
- AIEvaluator runs matches between all AI type combinations
- Tests with different driver configurations to assess adaptability
- Tracks win rates, head-to-head records, average turns per game
- Provides both summary rankings and detailed match results
- Web interface allows configuration of:
  - Which AI types to test
  - Number of games per matchup
  - Driver randomization settings
- Results consistently show:
  - MCTS AI performs best (highest win rate)
  - Aggressive Flanker AI second
  - Random AI baseline performance

## Monte Carlo Tree Search AI Implementation (2025-06-30)

### Implemented MCTS AI Player

**What Changed:**
- Created MCTSNode class for tree structure with UCB1 selection
- Implemented MCTSAI player using Monte Carlo Tree Search algorithm
- Added MCTS to AIController as a selectable AI type
- Created comprehensive test suite for MCTS functionality
- Updated battle simulator to support MCTS AI selection
- **Improved MCTS to be competitive**: Fixed evaluation issues that made it lose to Random AI

**Technical Details:**
- Uses UCB1 (Upper Confidence Bound) for balancing exploration vs exploitation
- Simplified implementation using action evaluation rather than full game state cloning
- Improved parameters: iterations (2000), exploration constant (1.4)
- Enhanced evaluation with strategic weights:
  - ELIMINATION_SCORE = 10.0 (huge bonus for finishing enemies)
  - FLANKING_BONUS = 1.5 (50% damage bonus consideration)
  - Position changes and speed boosts for flanking strategy
  - Better resource management (penalizes ending turn with good plays available)
- Context-aware evaluation:
  - Considers target health, armor, and position
  - Evaluates card synergies with driver skills
  - Prioritizes low-health target elimination
  - Values self-preservation when critical

**Performance Improvements:**
- No longer loses to Random AI consistently
- Makes strategic decisions similar to Aggressive Flanker AI
- Better adrenaline usage (doesn't waste turns)
- Smarter target prioritization

## AI Battle Simulator Web Page (2025-06-29)

### Created Web-Based Battle Simulator

**What Changed:**
- Created `/battle` webpage for running AI vs AI battles
- Built interactive UI for selecting AI strategies and drivers for both teams
- Implemented BattleSimulator class that runs battles headlessly
- Added battle result display with team stats and complete battle log
- Modified webpack config to support multiple entry points
- Integrated with existing AI system (Random AI, Aggressive Flanker AI)

**Technical Details:**
- Created `public/battle.html` with team setup forms and result display
- Implemented `src/battle-simulator.ts` as separate webpack entry point
- Modified webpack configs to build both main game and battle simulator
- Battle simulator runs complete battles using AI decisions
- Displays color-coded battle log with all events
- Shows final team stats (vehicle health, driver HP)
- Max 50 turns to prevent infinite loops

**Features:**
- Select AI strategy for player team (Random, Aggressive Flanker)
- Select AI strategy for enemy team (Simple default, Random, Aggressive Flanker)
- Choose drivers for each vehicle (Road Warrior, Interceptor, Mechanic, Raider)
- Run battles and see winner/loser/tie
- View complete battle log with turn-by-turn events
- See final vehicle and driver health stats

**Usage:**
- Navigate to http://localhost:9000/battle.html when dev server is running
- Select AI and drivers for both teams
- Click "Run Battle" to simulate
- Results and battle log display immediately

**Fixes Applied:**
- Fixed cards.json to use `type` instead of `id` for card identifiers
- Updated battle simulator to use `createDriverWithStartingDeck` instead of `getDriver`
- Fixed mismatched card references (coordinated_strike → coordinated_attack)
- Ensured all drivers have properly initialized decks with valid card types

=========================================

## Battle Event Logging System (2025-06-29)

### Implemented Battle Message Logging

**What Changed:**
- Added comprehensive battle event logging system to Battle.ts
- Created `BattleMessage` interface with type, message, timestamp, turn, and metadata
- Added `BattleMessageType` enum for categorizing messages (damage_dealt, heal_applied, etc.)
- Replaced all 30 console.log and 9 console.warn calls with internal log() method
- Implemented public methods for message retrieval:
  - `getMessages()`: Get all battle messages
  - `getMessagesByType(type)`: Get messages of specific type
  - `clearMessages()`: Clear all messages
- Messages stored in WeakMap to work with frozen Model instances
- Each log entry emits 'battleMessage' event for real-time updates

**Technical Details:**
- Messages include metadata for structured data (driver names, card names, damage values)
- Maintains console.log output in non-test environments for debugging
- Updated all Battle.test.ts tests to check battle messages instead of mocking console
- All 39 Battle tests now pass with the new logging system

**Purpose:**
- Provides structured logging for combat UI to display battle events
- Enables filtering and searching through battle history
- Supports future features like combat replay and analytics
- Removes direct console dependencies from production code

=========================================

## Aggressive Flanker AI Strategy (2025-06-29)

### Implemented Advanced AI Strategy

**What Changed:**
- Created `AggressiveFlankerAI` - first advanced AI strategy
- Strategy focuses on maximizing damage through flanking position (50% bonus)
- Implemented intelligent decision scoring system:
  - Prioritizes movement to flanking position when not already there
  - Values speed-boosting cards when below flanking threshold (60 total speed)
  - Scores damage cards higher when in flanking position
  - Targets low-health enemies for elimination
  - Considers vulnerable status effects for additional damage
- Added card effect analysis to understand:
  - Damage potential
  - Position change capabilities
  - Speed modifications
  - Healing and armor effects
- Implemented resource management:
  - Cost efficiency calculations
  - Avoids spending all adrenaline early
- **Critical health healing**: Prioritizes healing when below 30% health

**Technical Details:**
- Extended `AIPlayer` base class with `AggressiveFlankerStrategy`
- Score-based decision making (evaluates all possible actions)
- Factors in position bonuses, target health, and kill potential
- Modular design allows easy creation of additional AI strategies
- Integrated into AIController as the 'aggressive' AI type
- Full test coverage (6/6 tests passing) with edge case handling

## AI Player System Implementation (2025-06-29)

### Created Computer-Run Player System

**What Changed:**
- Created AI player system architecture with swappable implementations
- Implemented core AI components:
  - `AIPlayer` abstract base class for all AI implementations
  - `AIController` for managing AI players for both teams
  - `AIDecision` interface for representing AI actions
  - `GameStateEvaluation` for analyzing current battle state
- Implemented `RandomAI` as baseline strategy
- Integrated AI system with Battle class using WeakMap pattern (to work with frozen Model instances)
- Modified battle system to support async AI decisions
- Created comprehensive unit tests covering all AI functionality

**Technical Details:**
- Used strategy pattern for different AI personalities
- Support for AI controlling either player or enemy teams
- Fallback to simple AI when no AI configured
- Clean integration without UI changes
- Test coverage includes AI vs AI battles

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