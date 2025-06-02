# Game Flow & UI Specification

## 1\. Game Start Flow

### 1.1 Main Menu → New Run

When a player launches the game and wants to start a new run, they'll see the main menu with several options prominently displayed. The "New Run" button should be the largest and most visually prominent, indicating it's the primary action. Below it, if the player has a run in progress, they'll see a "Continue Run" option that shows basic stats from their current run (e.g., "Day 5 - Road Warrior & Interceptor - 3 victories"). At the bottom, a "Run History" option lets players review their past attempts, showing statistics like furthest progression, unlocks earned, and cause of defeat.

### 1.2 Driver Selection Screen

#### User Scenario

When the player clicks "New Run," they're taken to the driver selection screen. This is their first major decision that will shape their entire run. The screen needs to communicate that they're choosing a team of two drivers who will work together throughout the wasteland journey.

#### Layout Description

The screen is divided into two main halves, representing the two driver slots. Initially, both slots show empty states with placeholder silhouettes and text that says "Choose Your First Driver" and "Choose Your Second Driver."

**Left Side - First Driver Selection:** The left half of the screen is dedicated to the first driver choice. At the top is a large portrait area (roughly 40% of the screen height) showing the currently selected driver's artwork - this includes both the driver character and their signature vehicle in an action pose. Below the portrait, the driver's name is displayed in large, bold text (e.g., "THE ROAD WARRIOR"), with their vehicle name in smaller text underneath (e.g., "Vehicle: Apocalypse Rig").

Beneath the name, there's a specialty tag that summarizes their playstyle in 2-3 words (e.g., "DEFENSIVE TANK" or "AGILE STRIKER"). This is followed by a brief flavor text description that gives personality to the character while hinting at their mechanical strengths.

The bottom portion of this half shows the driver's starting deck. Rather than just listing card names, each card is displayed as a mini-card visual showing its cost, name, and a simplified effect description. For example: "Ramming Speed (2 Adrenaline) - Deal 12 damage and gain armor equal to your vehicle's weight." Players can hover over these mini-cards to see full-sized versions with complete artwork and detailed descriptions.

At the very bottom of this section is a dropdown or carousel selector that lets players browse through all available drivers. Locked drivers appear grayed out with a lock icon and a tooltip explaining how to unlock them (e.g., "Unlocked by completing a run with The Mechanic").

**Right Side - Second Driver Selection:** The right half mirrors the left, but remains in an empty state until the first driver is selected. This reinforces the selection order and prevents confusion. Once the first driver is chosen, the right side activates and follows the same layout pattern.

**Center Area - Synergy Preview:** Between the two driver sections, once both are selected, a "Synergy Preview" panel appears. This doesn't show specific card combinations but rather gives players hints about how these two drivers might work together. For example:

- "The Road Warrior's defensive capabilities will protect The Interceptor during setup turns"
- "These drivers share several Ramming-type cards that benefit from armor bonuses"
- "Warning: Both drivers lack healing options - consider finding medical supplies early"

**Bottom Section - Confirmation:** At the bottom center of the screen, the "START RUN" button remains disabled and grayed out until both drivers are selected. Once active, it becomes the prominent call-to-action. Next to it, smaller text shows a summary: "Ready to enter the wasteland with \[Driver 1\] and \[Driver 2\]"

### 1.3 Initial Deck Construction

Each driver brings their own specialized deck of 8-10 cards to the partnership. Unlike traditional deckbuilders where you might customize before starting, Wasteland Wheels embraces the roguelike philosophy - you start with what your drivers bring and adapt as you go. When combat begins, both drivers' decks are shuffled together into a single draw pile, representing the chaotic coordination required in vehicular combat.

## 2\. Combat Screen UI

### 2.1 The Battlefield - User Scenario

When combat begins, the screen transitions to show a post-apocalyptic battlefield. The player needs to quickly assess threats, manage resources, and coordinate attacks between their two vehicles. The layout is designed to give all critical information at a glance while keeping the action focused on the center of the screen.

### 2.2 Screen Layout Description

**Top Section - Enemy Forces (Upper 25% of screen):** The enemy vehicles are displayed across the top of the screen in a horizontal line. Each enemy is represented by a detailed vehicle portrait (smaller than the player vehicles but still clearly visible). Think of these as "combat cards" showing the enemy vehicle from a three-quarter view that emphasizes their most threatening features - spiked bumpers, mounted weapons, armor plating.

For each enemy vehicle, critical information is displayed clearly:

- A health bar that depletes from right to left, with numerical values overlaid (e.g., "25/30 HP")
- An armor indicator shown as a shield icon with a number
- Most importantly, an "intent" indicator that shows what the enemy is planning to do next turn

The intent system is crucial for tactical planning. Above each enemy, an animated icon shows their next action:

- A crosshair with a damage number for attacks (e.g., crosshair with "15" means 15 damage incoming)
- A shield being raised for defensive moves
- A wrench for self-repair actions
- An exclamation mark for special abilities
- Multiple icons if the enemy will perform several actions

**Center Section - The Battlefield (Middle 40% of screen):** The battlefield itself is a atmospheric but not mechanically complex area. While the game doesn't use a grid system, relative positioning matters. Vehicles are shown in a cinematic staging:

Player vehicles are positioned in the lower portion of this battlefield area, shown larger and with more detail than enemies. Each vehicle has a dynamic idle animation - engines revving, dust clouds, occasional weapon adjustments. When cards are played, animations play out here - rams connecting, shots firing across the battlefield, explosions blooming.

Each player vehicle displays:

- A prominent health bar with clear numerical values
- An armor indicator that visually shows as actual armor plating on the vehicle (which can crack and fall off as it's depleted)
- Status effect icons that orbit the vehicle (buffs like Speed+ show as glowing effects, debuffs like Burning show as actual flames)
- The vehicle name and driver portrait in a small inset

**Bottom Section - Player Interface (Lower 35% of screen):** This is where all player interaction happens, designed for quick decision-making.

_The Hand (Bottom 20% of screen):_ Your current hand of cards fans out across the bottom of the screen. Cards are large enough to read clearly, showing:

- The adrenaline cost in the top left corner (in a hexagonal badge)
- The card name in a banner across the top
- Card art that illustrates the action
- Effect text in clear, concise language
- A colored border indicating which driver the card belongs to (helps track synergies)

Cards in your hand respond to mouse hover by lifting slightly and glowing. Playable cards (those you have enough adrenaline for) have a subtle animated glow, while unplayable cards are slightly darkened.

_Resource Bar (Bottom 5% of screen):_ A horizontal bar runs along the very bottom showing critical resources:

- **Adrenaline**: Shown as lightning bolt icons (filled vs empty) with "3/3" text
- **Draw Pile**: A small deck icon with the number of cards remaining
- **Discard Pile**: A separate pile icon with its count
- **Fuel**: A jerrycan icon with current amount (for special abilities)
- **Scrap**: A gear icon with your current currency
- **End Turn Button**: A large, prominent button on the right side

### 2.3 Playing Cards - The User Experience

When a player clicks and holds a card, the battlefield dims slightly to reduce distractions. Valid targets begin glowing:

- Enemy vehicles glow red for attack cards
- Your vehicles glow green for defensive/healing cards
- All vehicles glow yellow for area effects

As you drag the card toward a target, a preview line connects the card to the potential target. The target's portrait enlarges slightly and shows a preview of the effect (e.g., "-12 HP" floating above an enemy when targeting with an attack).

If a card has multiple effects or conditions, these are highlighted as you aim. For example, a card that says "Deal 10 damage, deal 15 instead if target is Burning" would show "-15" in red text if targeting a burning enemy.

When you release the card on a valid target, it flies from your hand to the battlefield, the effect animation plays, and resources update immediately. The card then flies to the discard pile with a satisfying animation.

### 2.4 Turn Flow Experience

**Beginning of Your Turn:** When your turn begins, several things happen in sequence to create a smooth flow:

1. The "Enemy Turn" overlay fades away
2. Your adrenaline refills with a satisfying animation (empty lightning bolts fill with energy)
3. Cards are drawn from your deck with a swooping animation, fanning out into your hand
4. Any start-of-turn effects trigger with appropriate visual feedback
5. A subtle audio cue plays to indicate it's your turn to act

**During Your Turn:** Players can take actions in any order. The interface is designed to encourage experimentation:

- Hovering over cards shows their full effect without committing
- The game displays running totals (e.g., if you play multiple armor cards, you see your armor value increasing)
- Combo indicators appear when cards would synergize (e.g., if one driver plays a "Vulnerable" debuff, attack cards in your hand might pulse to indicate bonus damage)
- You can see a preview of end-turn consequences (which enemies will attack which vehicles)

**Ending Your Turn:** When you click "End Turn," there's a brief pause as your remaining hand cards fly to the discard pile. Then the enemy turn begins with clear visual indicators of their actions playing out in sequence.

## 3\. Map Navigation Screen

### 3.1 The Journey Through the Wasteland

After each combat or event, players return to the map screen to choose their next destination. This screen needs to balance information with atmosphere, showing both the strategic path options and the desolate beauty of the post-apocalyptic landscape.

### 3.2 Map Layout and User Experience

The map is presented as a worn, hand-drawn chart spread across a rusted metal surface. The art style suggests this is a map your drivers are actually consulting, complete with notes scrawled in margins and routes marked in grease pencil.

**Visual Presentation:** The map shows a vertical progression from bottom (your current location) to top (the region boss). The path branches and merges, creating meaningful choices. The background shows the wasteland terrain - destroyed highways, ruined cities, toxic swamps - giving context to your journey.

**Node Representation:** Each location on the map is represented by a detailed icon that immediately communicates what awaits:

- **Combat nodes** show crossed wrenches with a danger level indicator (1-3 skulls)
- **Elite combat nodes** display a larger, more ornate skull with spikes, promising both greater danger and rewards
- **Garages** are marked with a wrench and gear icon, clearly indicating a safe haven
- **Scavenge points** show a partially buried cache or overturned vehicle
- **Mystery events** display a question mark that shifts between different symbols, hinting at the variety of possible encounters
- **The boss node** at the top is impossible to miss - a massive skull wreathed in flames or other dramatic imagery

**Path Visualization:** Available paths from your current location glow with a pulsing light, while paths you can't take are darkened. As you hover over a node, the path to it illuminates more brightly, and a tooltip provides additional information:

- Expected difficulty
- Potential rewards (e.g., "High chance of rare cards")
- Special conditions (e.g., "Fuel station - guaranteed fuel recovery")

**Risk/Reward Indicators:** Each path is subtly coded to show risk vs reward:

- Dangerous paths with better rewards show rough, treacherous terrain
- Safer paths appear as clearer roads but lead to fewer reward nodes
- Some paths might show environmental hazards like radiation symbols or storm clouds

## 4\. Garage (Shop) Screen

### 4.1 Your Makeshift Pit Stop

The garage screen is where players spend their hard-earned scrap to improve their chances of survival. The atmosphere should feel like a gritty, improvised repair shop - oil stains, hanging chains, sparks flying from welding torches in the background.

### 4.2 Screen Organization and Flow

**Header Section - Your Resources:** At the top of the screen, your current scrap amount is prominently displayed with a gear/currency icon. This updates in real-time as you make purchases, with spent scrap flying away and remaining amount clearly visible.

**Left Panel - Deck Management (30% of screen):** This section shows both drivers' current decks side by side. Each deck is displayed as a scrollable list of cards with mini previews. The key feature here is deck curation - players can pay scrap to remove weak starter cards.

For each deck:

- The driver's portrait and name appear at the top
- Cards are listed with their cost and a simplified effect description
- Each card has a "Remove" button that shows the scrap cost (typically 50-75 scrap)
- Hovering over a card shows its full-size version
- Deck statistics are shown at the bottom (average cost, card type distribution)

**Center Panel - New Cards (40% of screen):** The shop typically offers 3-5 new cards for purchase. These are displayed as full-size cards that slowly rotate or have subtle animation to draw attention. Each card shows:

- The full card art and effects
- The scrap cost prominently displayed
- A dropdown or button set to choose which driver should receive the card
- A "SOLD" stamp that appears after purchase

Cards might be grouped by rarity, with common cards on the left and rarer options on the right with more elaborate frames.

**Right Panel - Vehicle Modifications (30% of screen):** This section offers permanent upgrades that affect vehicles rather than decks. Typically 2-3 mods are available, displayed as mechanical components with clear descriptions:

- A visual representation of the mod (e.g., spiked bumper, armor plating)
- Name and description of the effect
- Cost in scrap
- Which vehicle(s) it applies to

**Bottom Section - Leave Button:** A large "Return to the Wasteland" or "Leave Garage" button sits at the bottom center. The game should prevent players from leaving accidentally if they have enough scrap for meaningful purchases, perhaps with a confirmation: "You still have 200 scrap. Are you sure you want to leave?"

## 5\. Event Screen

### 5.1 Narrative Moments in the Wasteland

Events are crucial for both storytelling and strategic decision-making. When players select an event node, they're presented with a full-screen narrative moment that breaks up the combat-focused gameplay.

### 5.2 Event Screen Composition

**Visual Presentation:** The event screen uses a storybook-like layout. The top half (or left side on widescreen) displays a detailed illustration that sets the scene. This isn't just decorative - the art should tell part of the story. For example, an event about desperate survivors might show their broken-down vehicle with raiders circling in the distance like vultures.

**Narrative Text Section:** Below or beside the illustration, the event text is presented in a weathered journal style, as if written by someone chronicling their journey through the wasteland. The text is broken into two parts:

1. **The Setup**: 2-3 sentences describing what you encounter
2. **The Situation**: Additional detail that explains why a decision is needed

For example: "Your convoy crests a sandy ridge to find a disturbing scene below. A family's makeshift vehicle lies on its side, smoke pouring from the engine.

Three raider buggies circle the wreckage like predators, their occupants whooping and firing shots into the air. The family huddles behind their overturned vehicle. You have moments to decide."

**Choice Presentation:** Choices are presented as distinct cards or panels, each with:

- **A clear action title** (e.g., "Charge the Raiders" or "Negotiate Safe Passage")
- **Risk/Reward indicators** shown as icons:
  - Crossed swords for combat risk
  - Skull icons for danger level (1-3 skulls)
  - Resource costs shown with their icons (fuel can, scrap gear, etc.)
  - Potential rewards shown as glowing positive icons
- **Outcome preview** that hints at consequences without spoiling exactly what will happen

**Special Choice Conditions:** Some choices might be locked or enhanced based on your drivers:

- A Mechanic driver might see "(Mechanic Only) Jury-rig their engine"
- Having specific cards might unlock options: "(Requires: EMP Blast) Disable all vehicles"
- Low resources might lock options with strikethrough text: "Share Fuel (Need 5, Have 2)"

## 6\. Victory and Defeat Screens

### 6.1 Run Completion - Victory

When players defeat the final boss, the victory screen celebrates their achievement while setting up future runs.

**Victory Presentation:** The screen opens with a cinematic moment - your battered vehicles driving into the sunset, leaving the defeated boss's fortress burning behind them. The title "WASTELAND CONQUERED" or similar appears in weathered metal letters.

**Run Statistics Display:** Statistics appear in themed panels that look like scavenged road signs:

- **Journey Length**: "Survived 15 Days in the Wasteland"
- **Combat Record**: "Defeated 47 Raiders, 12 Mutants, 3 Warlords"
- **Resources Gathered**: Total scrap collected, fuel consumed
- **Deck Evolution**: Starting cards vs. final deck composition
- **Perfect Battles**: Number of fights won without taking damage
- **Close Calls**: Number of times a vehicle dropped below 10 HP

**Unlock Ceremony:** New unlocks are revealed dramatically:

1. **New Driver Unlock**: A silhouette transforms into a full character reveal with fanfare
2. **New Cards Unlocked**: Cards flip over one by one, showing what's been added to the pool
3. **Meta Progression**: Experience bars fill, showing progress toward long-term goals
4. **Achievements**: Pop up with satisfying sound effects

### 6.2 Run Completion - Defeat

Defeat screens need to be informative without being discouraging, helping players learn for next time.

**Defeat Presentation:** The screen shows your vehicles' final moments - perhaps one burning while the other tries to limp away, or both overwhelmed by enemies. The presentation is dramatic but not gruesome, maintaining the game's action-movie tone.

**Learning Opportunity:** The defeat screen provides clear information about what went wrong:

- **Cause of Defeat**: "Overwhelmed by Warlord Grimjaw's Final Phase"
- **Final Battle Stats**: Damage dealt vs. taken, turns survived
- **Critical Moment**: The game identifies where things went wrong (e.g., "No defensive cards in final deck")

**Partial Progress Recognition:** Even in defeat, progress is acknowledged:

- **Distance Traveled**: How far you made it is celebrated
- **Unlocks Earned**: Some unlocks are available even on failed runs
- **Resources Contributed**: Meta-progression continues
- **New Knowledge**: "Warlord Grimjaw's attack pattern learned"

## 7\. UI/UX Principles in Practice

### 7.1 Information Hierarchy in Action

**Combat Critical Information (Always Visible):**

- Your vehicles' HP and armor are the largest UI elements
- Enemy HP bars are prominent but slightly smaller
- Current adrenaline is shown with large, clear icons
- Playable cards glow or pulse gently

**Important But Not Immediate (Clear But Not Dominating):**

- Enemy intent indicators use recognizable icons
- Status effects are visible but don't obscure vehicles
- Resource counts are present but tucked into corners
- Draw/discard pile counts use small but readable numbers

**On-Demand Information (Tooltips and Hovers):**

- Full card text appears on hover
- Status effect explanations in tooltips
- Enemy ability descriptions when hovering intent
- Synergy explanations when hovering combo indicators

### 7.2 Feedback Systems in Detail

**Visual Feedback Hierarchy:**

- **Major Actions** (playing cards, taking damage): Screen shake, particle effects, sound effects
- **Minor Actions** (hovering, selecting): Subtle glows, small movements, quiet sounds
- **State Changes** (turn transitions, resource updates): Smooth animations, UI element transforms

**Audio Design:**

- Each driver has unique engine sounds that play during their actions
- Card types have signature sounds (metal clashing for attacks, hydraulic hisses for armor)
- The soundtrack dynamically adjusts based on battle intensity
- Victory and defeat have memorable musical stings

### 7.3 Accessibility Implementation

**Visual Accessibility:**

- **Colorblind Modes**:
  - Icons supplement all color coding (shapes for card types, patterns for statuses)
  - UI can switch between different color palettes
  - Enemy intent uses both color and distinct icon shapes

**Motor Accessibility:**

- **Click-and-Confirm Mode**: Instead of drag-and-drop, players can click a card then click a target
- **Keyboard Navigation**: Full keyboard support with visible focus indicators
- **Adjustable Timer**: For any timed events, players can extend or disable timers

**Cognitive Accessibility:**

- **Simplified Card Text Mode**: Shows only key numbers and effects
- **Turn History Log**: Players can review what happened in previous turns
- **Undo Last Action**: Available in easy difficulty for single-player

## 8\. Platform-Specific UI Adaptations

### 8.1 PC (Mouse & Keyboard) Optimizations

**Mouse Interactions:**

- Precise hover states show information instantly
- Right-click shows detailed card/enemy information
- Scroll wheel navigates through long lists (deck contents, shop items)
- Drag-and-drop feels responsive with visual feedback

**Keyboard Shortcuts:**

- Number keys 1-7 select cards in hand
- Tab cycles through valid targets
- Space confirms actions or ends turn
- Escape opens pause/settings menu
- WASD navigates map nodes

### 8.2 Console (Controller) Adaptations

**Controller Layout:**

- Left stick/D-pad navigates between UI elements with clear highlighting
- Right stick provides free cursor for precise selection
- Shoulder buttons cycle between drivers' cards in garage
- Face buttons have consistent meanings across all screens (A/X = confirm, B/Circle = cancel)

**Adapted Interactions:**

- Card selection highlights the chosen card and shows valid targets
- Target selection cycles through enemies with clear visual indicators
- Multi-select uses button holds (hold X to select multiple cards)
- Radial menus for quick actions during combat

### 8.3 Steam Deck Specific Features

**Touch Integration:**

- Cards can be directly touched and dragged
- Pinch to zoom on map screen
- Swipe gestures navigate between deck management screens

**Trackpad Utilization:**

- Left trackpad provides quick access to resources/stats
- Right trackpad offers precise cursor control
- Trackpad clicks can be customized for common actions

**Screen Optimization:**

- UI scales appropriately for the 7-inch screen
- Text remains readable at arm's length
- Critical information positioned away from edges where hands hold device
- Battery-saving options reduce particle effects and animations
