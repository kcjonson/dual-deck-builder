# AI System Technical Design

## 1. AI Architecture Overview

### 1.1 Core Components

An AI controller has five parts: a personality, a decision engine, a board evaluator, a move selector, and a difficulty modifier.

### 1.2 AI Decision Pipeline

1. **Evaluate Board State** → Current threats and opportunities
2. **Generate Possible Moves** → All legal actions
3. **Score Each Move** → Based on personality and game state
4. **Select Best Move** → Modified by difficulty
5. **Execute Action** → With appropriate delays for readability

Raiders run the pipeline when they plan, at the start of the player's turn: each commits its whole coming turn, one card at a time, against a projection of the road, and the enemy turn plays the plan without choosing again ([Combat Rules](./Combat%20Rules.md), Enemy intents).

## 2. Enemy Types & Personalities

### 2.1 Base Enemy Archetypes

`targetPriority` below predates escorts. Target preferences are a separate axis: a raider's archetype (`Vehicle.raiderArchetype`: looter, killer, or none) is independent of the AI personality or strategy that plans for it. A looter goes for haulers and a killer for driven vehicles, whenever the preferred target is legal for the card; otherwise the raider plans as it would with none, and the strategy's own scoring picks among several preferred targets. The rule is in [Combat Rules](./Combat%20Rules.md), Enemy intents, and the assignments and build notes in [escorts.md](../AI_TECHNICAL_DECISIONS/escorts.md), Raider preferences (decisions 29 and 30). The Rust Buggy is a looter.

#### Aggressive Raider

- Personality: `aggressionWeight` 0.8, `defenseWeight` 0.2, `targetPriority` lowest_hp, `riskTolerance` 0.7
- Move preferences: attack 0.7, defend 0.1, utility 0.2

#### Defensive Convoy

- Personality: `aggressionWeight` 0.3, `defenseWeight` 0.7, `targetPriority` highest_threat, `riskTolerance` 0.3
- Move preferences: attack 0.3, defend 0.5, utility 0.2

#### Tactical Warlord

- Personality: `aggressionWeight` 0.5, `defenseWeight` 0.5, `targetPriority` optimal, `riskTolerance` 0.5
- Move preferences: attack 0.4, defend 0.3, utility 0.3

### 2.2 Strategies

Each opponent plans with its own behavior, named in its folder in a pack: one of these strategies with its personality's weights, or a script for an opponent they can't express ([rules-ai-and-packs.md](../AI_TECHNICAL_DECISIONS/rules-ai-and-packs.md)). Nothing plans for a whole team. The base pack's raiders start on the aggressive flanker. The balance sim's player stand-ins are behaviors too, one per seat.

- Aggressive flanker: takes the flank for its damage bonus and favours its highest-damage plays. It never reads intents, so it never gives up a flank it would hold, and a move that does nothing else scores under ending the turn. The player stand-ins' floor ([Balance Simulation](./Balance%20Simulation.md), Player stand-ins).
- Intent-aware: a player stand-in, the ceiling. Before each card it reads the raiders' committed plans and plays whatever most cuts the harm coming next enemy turn, one step and no search (Balance Simulation, Player stand-ins).
- Ramming: builds speed and armor and closes in for ramming hits.
- Salvage: tries to win while sparing the vehicles it fights, going for their drivers with headshots, so the vehicles are left to salvage.
- Monte Carlo tree search: plays candidates out on copies of the fight, picked by UCB1, and keeps the one whose playouts score best.
- Random: picks evenly among every play on offer, ending the turn included, drawing from its seat's stream.
- First playable: the first affordable card in hand order at its first legal target. Raiders plan with it when a fight sets no strategy.

## 3. Board State Evaluation

### 3.1 Threat Assessment

An entity's threat is its damage potential, scaled up by its buffs and down by its wounds, plus a flat amount for each special ability:

`threat = averageDamagePerTurn * 10 * (1 + 0.1 * buffCount) * (currentHP / maxHP) + (20 if it can stun) + (15 if it deals area damage)`

### 3.2 Value Calculation

A move's value has five parts:

- damage value: raw damage dealt
- defensive value: armor gained plus damage prevented
- utility value: card draw, resource gain
- tempo value: board control impact
- synergy value: combo potential

The personality weights them, and the move's value is the sum: damage by `aggressionWeight`, defensive by `defenseWeight`, utility by `utilityWeight`, tempo by `tempoWeight`, and synergy by `synergyWeight`.

Card draw is worth only the cards that stay in hand. A draw fills the drawer's hand up to their hand limit and burns the rest ([Combat Rules](./Combat%20Rules.md), Driver), and a burned card is worth nothing, so a draw at the limit adds no utility value. The hand counts as the draw will find it: without the card being played, which leaves its player's hand first, and after a plan's earlier plays. The strategies that value draws read it from one shared estimate; see [ai-draw-value.md](../AI_TECHNICAL_DECISIONS/ai-draw-value.md).

## 4. Move Generation & Selection

### 4.1 Move Generator

Every legal action is a move of its own. When the AI has more than one unit, combinations of actions across them are moves too. A move's value is worked out after generation, by section 3.

### 4.2 Minimax with Alpha-Beta Pruning (Bosses only)

Bosses search: minimax with alpha-beta pruning over the moves above, to a fixed depth or the end of the fight, scoring each leaf with the board evaluation (section 3). A boss searches when it plans its turn, at the start of the player's turn, against the projected road. Bosses aren't designed yet, and until they are they plan and show their intents like elites ([Combat Rules](./Combat%20Rules.md), Enemy intents).

## 5. Difficulty Scaling

### 5.1 Difficulty Modifiers

Four difficulties, which change how the AI picks among its scored moves:

- Easy: 30% of the time it picks a random move instead of the best, drawing from the AI's own stream.
- Normal: the best move.
- Hard: always the best move, with a 10% bonus to every move's value.
- Nightmare: perfect play, and it knows the player's hand.

### 5.2 Adaptive Difficulty

The game tracks the player's recent win rate. Above 80% the player is doing too well and the threat level goes up; below 30% they're struggling and it eases.

## 6. Intent System

### 6.1 Intent Display

An intent has a type (attack, defend, buff, debuff, or unknown), a value where it has one (the damage amount, or the armor gained), a target where it has one, and a description.

### 6.2 Intent Calculation

How much of its plan a raider shows depends on its tier ([Combat Rules](./Combat%20Rules.md), Enemy intents). Basic enemies show their intent exactly. Elites show the type and target but hide the value and the card. Bosses can show misleading intents; until bosses are designed they show their intents as elites do.

## 7. Specific AI Behaviors

### 7.1 Raider Gang AI

Raiders focus fire on the weakest target, but switch to anyone about to die (under 10 HP). Among their attacks, they pick the highest damage against that target.

### 7.2 Convoy Defender AI

The convoy protects its cargo vehicle at all costs. The cargo has 50 HP; under 20 the convoy picks a defensive move. Otherwise it works out the players' threats and counters the highest.

### 7.3 Boss AI - Warlord

The warlord fights in three phases. In phase 1, dropping under 66% of its maximum HP moves it to phase 2, and that turn it summons reinforcements. In phase 2, dropping under 33% moves it to phase 3, and that turn it goes berserk. Otherwise each phase has its own behaviour: a tactical assault in phase 1, a coordinated strike in phase 2, and a desperate gambit in phase 3.

## 8. Thinking Time

The AI takes 0.5 to 2 seconds to think, for readability, drawn from its own stream, `fork('thinking')` off the AI's stream. The delay is cosmetic, so a headless run that skips it picks the same moves from the same seed.

## 9. Testing & Tuning

### 9.1 Measuring the AI

The balance sim plays fights headlessly with player stand-ins, the aggressive flanker as the floor and the intent-aware AI as the ceiling, and that's where AI changes are measured ([Balance Simulation](./Balance%20Simulation.md), Player stand-ins).

### 9.2 Balance Metrics

- **Win Rate by Difficulty**: Track player success rates
- **Average Combat Duration**: Ensure fights aren't too long/short
- **Move Diversity**: AI should use variety of strategies
- **Player Engagement**: Track if players find AI predictable
