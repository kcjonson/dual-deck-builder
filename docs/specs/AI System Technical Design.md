# AI System Technical Design

## 1\. AI Architecture Overview

### 1.1 Core Components

interface AIController {

personality: AIPersonality;

decisionEngine: DecisionEngine;

boardEvaluator: BoardEvaluator;

moveSelector: MoveSelector;

difficultyModifier: DifficultyModifier;

}

### 1.2 AI Decision Pipeline

1. **Evaluate Board State** → Current threats and opportunities
2. **Generate Possible Moves** → All legal actions
3. **Score Each Move** → Based on personality and game state
4. **Select Best Move** → Modified by difficulty
5. **Execute Action** → With appropriate delays for readability

## 2\. Enemy Types & Personalities

### 2.1 Base Enemy Archetypes

#### Aggressive Raider

{

personality: {

aggressionWeight: 0.8,

defenseWeight: 0.2,

targetPriority: "lowest_hp",

riskTolerance: 0.7

},

movePreferences: {

attack: 0.7,

defend: 0.1,

utility: 0.2

}

}

#### Defensive Convoy

{

personality: {

aggressionWeight: 0.3,

defenseWeight: 0.7,

targetPriority: "highest_threat",

riskTolerance: 0.3

},

movePreferences: {

attack: 0.3,

defend: 0.5,

utility: 0.2

}

}

#### Tactical Warlord

{

personality: {

aggressionWeight: 0.5,

defenseWeight: 0.5,

targetPriority: "optimal",

riskTolerance: 0.5

},

movePreferences: {

attack: 0.4,

defend: 0.3,

utility: 0.3

}

}

## 3\. Board State Evaluation

### 3.1 Threat Assessment

class ThreatCalculator {

calculateThreat(entity: CombatEntity): number {

let threat = 0;

// Base threat from damage potential

threat += entity.averageDamagePerTurn \* 10;

// Modifier for current buffs

threat \*= (1 + entity.buffs.length \* 0.1);

// Modifier for HP ratio

threat \*= (entity.currentHP / entity.maxHP);

// Special ability threats

if (entity.hasStunAbility) threat += 20;

if (entity.hasAOEDamage) threat += 15;

return threat;

}

}

### 3.2 Value Calculation

interface MoveValue {

damageValue: number; // Raw damage dealt

defensiveValue: number; // Armor gained + damage prevented

utilityValue: number; // Card draw, resource gain

tempoValue: number; // Board control impact

synergyValue: number; // Combo potential

}

calculateMoveValue(move: AIMove, gameState: GameState): number {

const values = evaluateMove(move, gameState);

// Weight based on personality

return (

values.damageValue \* this.personality.aggressionWeight +

values.defensiveValue \* this.personality.defenseWeight +

values.utilityValue \* this.personality.utilityWeight +

values.tempoValue \* this.personality.tempoWeight +

values.synergyValue \* this.personality.synergyWeight

);

}

## 4\. Move Generation & Selection

### 4.1 Move Generator

class MoveGenerator {

generateMoves(aiState: AIState): AIMove\[\] {

const moves: AIMove\[\] = \[\];

// Single action moves

for (const action of aiState.availableActions) {

moves.push({

actions: \[action\],

value: 0 // To be calculated

});

}

// Multi-action sequences (if AI has multiple units)

if (aiState.units.length > 1) {

moves.push(...generateCombinations(aiState));

}

return moves;

}

}

### 4.2 Minimax with Alpha-Beta Pruning (Bosses only)

class MinimaxEvaluator {

evaluate(

gameState: GameState,

depth: number,

alpha: number,

beta: number,

maximizing: boolean

): number {

if (depth === 0 || gameState.isTerminal()) {

return this.evaluatePosition(gameState);

}

if (maximizing) {

let maxEval = -Infinity;

for (const move of this.getPossibleMoves(gameState)) {

const newState = this.applyMove(gameState, move);

const eval = this.evaluate(newState, depth - 1, alpha, beta, false);

maxEval = Math.max(maxEval, eval);

alpha = Math.max(alpha, eval);

if (beta <= alpha) break; // Pruning

}

return maxEval;

} else {

// Minimizing logic...

}

}

}

## 5\. Difficulty Scaling

### 5.1 Difficulty Modifiers

enum Difficulty {

EASY = 0,

NORMAL = 1,

HARD = 2,

NIGHTMARE = 3

}

class DifficultyModifier {

modifyMoveSelection(moves: AIMove\[\], difficulty: Difficulty): AIMove {

switch(difficulty) {

case Difficulty.EASY:

// 30% chance to pick suboptimal move

if (Math.random() < 0.3) {

return this.pickRandomMove(moves);

}

break;

case Difficulty.HARD:

// Always pick optimal, with 10% bonus evaluation

moves.forEach(m => m.value \*= 1.1);

break;

case Difficulty.NIGHTMARE:

// Perfect play + knows player's hand

return this.pickWithForesight(moves);

}

return this.pickBestMove(moves);

}

}

### 5.2 Adaptive Difficulty

class AdaptiveDifficulty {

playerStats: PlayerStats;

adjustDifficulty(): void {

const winRate = this.playerStats.getRecentWinRate();

if (winRate > 0.8) {

// Player is doing too well, increase challenge

this.increaseThreatLevel();

} else if (winRate < 0.3) {

// Player is struggling, ease up

this.decreaseThreatLevel();

}

}

}

## 6\. Intent System

### 6.1 Intent Display

enum IntentType {

ATTACK = "attack",

DEFEND = "defend",

BUFF = "buff",

DEBUFF = "debuff",

UNKNOWN = "unknown"

}

interface Intent {

type: IntentType;

value?: number; // Damage amount or armor gain

target?: Target;

description: string;

}

### 6.2 Intent Calculation

class IntentCalculator {

calculateIntent(enemy: Enemy, gameState: GameState): Intent {

const selectedMove = enemy.getSelectedMove();

// Basic enemies show exact intent

if (enemy.tier === EnemyTier.BASIC) {

return {

type: selectedMove.type,

value: selectedMove.value,

description: this.getIntentDescription(selectedMove)

};

}

// Elite enemies show partial intent

if (enemy.tier === EnemyTier.ELITE) {

return {

type: selectedMove.type,

value: this.obscureValue(selectedMove.value),

description: "???"

};

}

// Bosses can have misleading intent

if (enemy.tier === EnemyTier.BOSS) {

return this.generateBossIntent(enemy, selectedMove);

}

}

}

## 7\. Specific AI Behaviors

### 7.1 Raider Gang AI

class RaiderAI extends BaseAI {

selectMove(gameState: GameState): AIMove {

// Raiders focus fire on weakest target

const weakestPlayer = this.findWeakestTarget(gameState.players);

// But switch targets if someone is about to die

const lowHealthTarget = gameState.players.find(p => p.hp < 10);

const target = lowHealthTarget || weakestPlayer;

// Prefer high damage moves

const attacks = this.moves.filter(m => m.type === 'attack');

return this.selectHighestDamage(attacks, target);

}

}

### 7.2 Convoy Defender AI

class ConvoyAI extends BaseAI {

private cargoHP: number = 50;

selectMove(gameState: GameState): AIMove {

// Protect the cargo vehicle at all costs

if (this.cargoHP < 20) {

return this.selectDefensiveMove();

}

// Otherwise, eliminate highest threat

const threat = this.calculateThreats(gameState.players);

return this.selectCounterMove(threat.highest);

}

}

### 7.3 Boss AI - Warlord

class WarlordAI extends BossAI {

private phase: number = 1;

selectMove(gameState: GameState): AIMove {

// Phase transitions

if (this.hp < this.maxHP \* 0.66 && this.phase === 1) {

this.phase = 2;

return this.summonReinforcements();

}

if (this.hp < this.maxHP \* 0.33 && this.phase === 2) {

this.phase = 3;

return this.activateBerserkMode();

}

// Phase-specific behavior

switch(this.phase) {

case 1: return this.tacticalAssault(gameState);

case 2: return this.coordinatedStrike(gameState);

case 3: return this.desperateGambit(gameState);

}

}

}

## 8\. Performance Optimization

### 8.1 Move Caching

class MoveCache {

private cache: Map&lt;string, AIMove&gt; = new Map();

getCachedMove(gameStateHash: string): AIMove | null {

return this.cache.get(gameStateHash) || null;

}

cacheMove(gameStateHash: string, move: AIMove): void {

// Limit cache size

if (this.cache.size > 1000) {

const firstKey = this.cache.keys().next().value;

this.cache.delete(firstKey);

}

this.cache.set(gameStateHash, move);

}

}

### 8.2 Async Decision Making

class AsyncAI {

async selectMove(gameState: GameState): Promise&lt;AIMove&gt; {

// Start thinking immediately when player turn begins

const thinkingTime = this.calculateThinkingTime();

// Run AI calculations

const movePromise = this.calculateBestMove(gameState);

// Ensure minimum thinking time for readability

const \[move\] = await Promise.all(\[

movePromise,

this.delay(thinkingTime)

\]);

return move;

}

private calculateThinkingTime(): number {

// 0.5s - 2s based on complexity

return Math.random() \* 1500 + 500;

}

}

## 9\. Testing & Tuning

### 9.1 AI Test Framework

class AITester {

runScenario(scenario: TestScenario): TestResult {

const results = {

moveChosen: null,

timeToDecide: 0,

optimalityScore: 0

};

// Set up game state

const gameState = scenario.setupGameState();

// Run AI

const start = performance.now();

results.moveChosen = this.ai.selectMove(gameState);

results.timeToDecide = performance.now() - start;

// Compare to optimal move

results.optimalityScore = this.compareToOptimal(

results.moveChosen,

scenario.optimalMove

);

return results;

}

}

### 9.2 Balance Metrics

- **Win Rate by Difficulty**: Track player success rates
- **Average Combat Duration**: Ensure fights aren't too long/short
- **Move Diversity**: AI should use variety of strategies
- **Player Engagement**: Track if players find AI predictable

## 10\. Implementation Priority

### Phase 1: Basic AI (MVP)

1. Simple threat assessment
2. Basic move selection (highest value)
3. Intent system
4. Easy/Normal difficulty only

### Phase 2: Enhanced AI

1. Multi-unit coordination
2. Combo recognition
3. Adaptive difficulty
4. Elite enemy behaviors

### Phase 3: Advanced AI

1. Boss AI with phases
2. Minimax for critical decisions
3. Player pattern recognition
4. Nightmare difficulty
