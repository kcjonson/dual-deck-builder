import { Battle } from './Battle';
import { AIType } from '../ai/AIController';
import { Driver } from './Driver';
import { Team, TeamType } from './Team';
import { Vehicle, VehiclePosition } from './Vehicle';
import { DriverLoader } from '../core/DriverLoader';
import { CardLoader } from '../core/CardLoader';

export interface AIMatchResult {
	player1AI: AIType;
	player2AI: AIType;
	winner: 'player1' | 'player2' | 'draw';
	player1Score: number;
	player2Score: number;
	turnsPlayed: number;
	player1Drivers: string[];
	player2Drivers: string[];
	battleLog: string[];
	structureLooted: number; // Structure remaining in losing team's vehicles
}

export interface AIEvaluationResult {
	aiType: AIType;
	wins: number;
	losses: number;
	draws: number;
	totalGames: number;
	winRate: number;
	avgTurnsPerGame: number;
	avgScorePerGame: number;
	totalStructureLooted: number; // Total structure salvaged from defeated enemies
	matchResults: AIMatchResult[];
}

export interface EvaluationConfig {
	aiTypes: AIType[];
	gamesPerMatchup: number;
	driverSets?: string[][];  // Optional specific driver sets to test
	randomizeDrivers?: boolean;
	verbose?: boolean;
	onProgress?: (current: number, total: number, message: string) => void;
}

export class AIEvaluator {
	private allDrivers: Driver[] = [];
	
	constructor() {
		// Drivers will be loaded externally via DriverLoader
	}
	
	/**
	 * Yield control back to the browser to allow UI updates
	 */
	private async yieldToUI(): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, 10));
	}
	
	/**
	 * Evaluate all AI types against each other
	 */
	async evaluateAllAI(config: EvaluationConfig): Promise<Map<AIType, AIEvaluationResult>> {
		// Suppress console logging during evaluation by default
		const originalSuppressLog = Battle.suppressConsoleLog;
		Battle.suppressConsoleLog = true;
		
		const results = new Map<AIType, AIEvaluationResult>();
		
		// Initialize results for each AI type
		for (const aiType of config.aiTypes) {
			results.set(aiType, {
				aiType,
				wins: 0,
				losses: 0,
				draws: 0,
				totalGames: 0,
				winRate: 0,
				avgTurnsPerGame: 0,
				avgScorePerGame: 0,
				totalStructureLooted: 0,
				matchResults: []
			});
		}
		
		// Calculate total number of games for progress tracking
		const totalMatchups = (config.aiTypes.length * (config.aiTypes.length - 1)) / 2;
		const totalGames = totalMatchups * config.gamesPerMatchup * 2; // *2 for both permutations
		let gamesCompleted = 0;
		
		// Report initial progress
		if (config.onProgress) {
			config.onProgress(0, totalGames, 'Starting evaluation...');
			await this.yieldToUI();
		}
		
		// Run matches between each pair of AI types
		for (let i = 0; i < config.aiTypes.length; i++) {
			for (let j = i + 1; j < config.aiTypes.length; j++) {
				const ai1 = config.aiTypes[i];
				const ai2 = config.aiTypes[j];
				
				if (config.verbose) {
					console.log(`\nEvaluating ${ai1} vs ${ai2}...`);
				}
				
				// Run multiple games per matchup
				for (let game = 0; game < config.gamesPerMatchup; game++) {
					// Get driver sets for this game
					const driverSets = this.getDriverSetsForGame(config, game);
					
					// Run both permutations (AI1 as player, AI2 as enemy and vice versa)
					const result1 = await this.runSingleMatch(ai1, ai2, driverSets[0], driverSets[1]);
					this.updateResults(results, ai1, ai2, result1);
					gamesCompleted++;
					
					// Report progress and yield to UI
					if (config.onProgress) {
						config.onProgress(gamesCompleted, totalGames, 
							`Completed ${ai1} vs ${ai2} (game ${game + 1}/${config.gamesPerMatchup}, round 1)`);
						await this.yieldToUI();
					}
					
					const result2 = await this.runSingleMatch(ai2, ai1, driverSets[0], driverSets[1]);
					this.updateResults(results, ai2, ai1, result2);
					gamesCompleted++;
					
					// Report progress and yield to UI
					if (config.onProgress) {
						config.onProgress(gamesCompleted, totalGames, 
							`Completed ${ai2} vs ${ai1} (game ${game + 1}/${config.gamesPerMatchup}, round 2)`);
						await this.yieldToUI();
					}
				}
			}
		}
		
		// Calculate final statistics
		for (const result of results.values()) {
			result.winRate = result.totalGames > 0 ? result.wins / result.totalGames : 0;
			result.avgTurnsPerGame = result.matchResults.length > 0 
				? result.matchResults.reduce((sum, m) => sum + m.turnsPlayed, 0) / result.matchResults.length 
				: 0;
			result.avgScorePerGame = result.matchResults.length > 0
				? result.matchResults.reduce((sum, m) => sum + (m.player1AI === result.aiType ? m.player1Score : m.player2Score), 0) / result.matchResults.length
				: 0;
		}
		
		// Restore original console log setting
		Battle.suppressConsoleLog = originalSuppressLog;
		
		return results;
	}
	
	/**
	 * Run a single match between two AI players
	 */
	private async runSingleMatch(
		player1AI: AIType, 
		player2AI: AIType,
		player1Drivers: Driver[],
		player2Drivers: Driver[]
	): Promise<AIMatchResult> {
		// Get available cards
		const availableCards = CardLoader.getInstance().getAllCardsAsMap();
		
		// Create vehicles for player team
		const playerVehicles = player1Drivers.map((driver, index) => {
			const driverCopy = driver.copy();
			// Create starting deck for the driver
			driverCopy.createStartingDeck(availableCards);
			
			return new Vehicle({
				name: driver.metadata.vehicleName,
				armor: driver.vehicleStats.armor,
				maxArmor: driver.vehicleStats.armor,
				structure: driver.vehicleStats.maxStructure,
				maxStructure: driver.vehicleStats.maxStructure,
				speed: driver.vehicleStats.speed,
				baseSpeed: driver.vehicleStats.speed,
				position: index === 0 ? VehiclePosition.FRONT : VehiclePosition.BACK,
				velocity: 0,
				driver: driverCopy,
				passenger: null,
				statusEffects: []
			});
		});
		
		// Create vehicles for enemy team
		const enemyVehicles = player2Drivers.map((driver, index) => {
			const driverCopy = driver.copy();
			// Create starting deck for the driver
			driverCopy.createStartingDeck(availableCards);
			
			return new Vehicle({
				name: driver.metadata.vehicleName,
				armor: driver.vehicleStats.armor,
				maxArmor: driver.vehicleStats.armor,
				structure: driver.vehicleStats.maxStructure,
				maxStructure: driver.vehicleStats.maxStructure,
				speed: driver.vehicleStats.speed,
				baseSpeed: driver.vehicleStats.speed,
				position: index === 0 ? VehiclePosition.FRONT : VehiclePosition.BACK,
				velocity: 0,
				driver: driverCopy,
				passenger: null,
				statusEffects: []
			});
		});
		
		// Create teams with vehicles
		const playerTeam = new Team({
			type: TeamType.PLAYER,
			vehicles: playerVehicles
		});
		const enemyTeam = new Team({
			type: TeamType.ENEMY,
			vehicles: enemyVehicles
		});
		
		// Create battle
		const battle = new Battle({
			playerTeam,
			enemyTeam
		});
		
		// Set AI for both teams
		battle.aiController.setPlayerAI(player1AI);
		battle.aiController.setEnemyAI(player2AI);
		
		// Initialize battle (draw initial hands, etc)
		battle.start();
		
		// Run the battle
		let turnsPlayed = 0;
		const maxTurns = 100; // Prevent infinite loops
		
		// Run the battle to completion
		while (!battle.isBattleOver() && turnsPlayed < maxTurns) {
			if (battle.isPlayerTurn) {
				// Player turn - AI makes decisions
				let continuePlayingCards = true;
				while (continuePlayingCards && !battle.isBattleOver()) {
					const decision = await battle.aiController.getPlayerDecision();
					
					if (!decision || decision.type === 'endTurn') {
						continuePlayingCards = false;
					} else if (decision.type === 'playCard' && decision.card && decision.driver) {
						await battle.aiController.executeAIDecision(decision, true);
					}
				}
				
				// End player turn
				if (!battle.isBattleOver()) {
					await battle.endPlayerTurn();
				}
			}
			// Enemy turns are handled automatically by endPlayerTurn
			
			turnsPlayed++;
		}
		
		// Get battle messages from the battle system
		const battleMessages = battle.getMessages();
		
		// Add header to show which AI had first-turn advantage
		const battleHeader = [`=== ${player1AI.toUpperCase()} (Player/First) vs ${player2AI.toUpperCase()} (Enemy/Second) ===`];
		
		const formattedBattleLog = battleHeader.concat(
			battleMessages.map(msg => {
				const turnPrefix = `Turn ${msg.turn}:`;
				let formattedMessage = msg.message;
				
				// Add metadata if available
				if (msg.metadata) {
					if (msg.metadata.driver) {
						formattedMessage = `[${msg.metadata.driver}] ${formattedMessage}`;
					}
				}
				
				return `${turnPrefix} ${formattedMessage}`;
			})
		);
		
		// Determine winner and scores
		const player1Alive = playerTeam.getAliveVehicles().length;
		const player2Alive = enemyTeam.getAliveVehicles().length;
		
		// Debug logging (reduced)
		// Note: verbose logging is controlled by Battle.suppressConsoleLog
		
		let winner: 'player1' | 'player2' | 'draw';
		if (battle.isBattleWon()) {
			winner = 'player1';  // Player team won
		} else if (battle.isBattleTied()) {
			winner = 'draw';
		} else if (player1Alive === 0 && player2Alive > 0) {
			winner = 'player2';  // Enemy team won
		} else if (player1Alive > player2Alive) {
			winner = 'player1';
		} else if (player2Alive > player1Alive) {
			winner = 'player2';
		} else {
			winner = 'draw';
		}
		
		// Calculate scores based on remaining health and drivers
		const player1Score = this.calculateTeamScore(playerTeam);
		const player2Score = this.calculateTeamScore(enemyTeam);
		
		// Calculate structure looted (structure remaining in losing team)
		let structureLooted = 0;
		if (winner === 'player1') {
			// Player 1 won, so they loot enemy team's remaining structure
			structureLooted = this.calculateRemainingStructure(enemyTeam);
		} else if (winner === 'player2') {
			// Player 2 won, so they loot player team's remaining structure
			structureLooted = this.calculateRemainingStructure(playerTeam);
		}
		// No looting on draws
		
		return {
			player1AI,
			player2AI,
			winner,
			player1Score,
			player2Score,
			turnsPlayed,
			player1Drivers: player1Drivers.map(d => d.metadata.name),
			player2Drivers: player2Drivers.map(d => d.metadata.name),
			battleLog: formattedBattleLog,
			structureLooted
		};
	}
	
	/**
	 * Get driver sets for a specific game
	 */
	private getDriverSetsForGame(config: EvaluationConfig, gameIndex: number): [Driver[], Driver[]] {
		// Get all available drivers
		this.allDrivers = DriverLoader.getAllDriverArchetypes();
		
		if (config.driverSets && gameIndex < config.driverSets.length) {
			// Use predefined driver sets
			const driverNames = config.driverSets[gameIndex];
			const drivers = driverNames
				.map(name => this.allDrivers.find(d => d.metadata.name === name))
				.filter((d): d is Driver => d !== undefined);
			return [drivers.slice(0, 2), drivers.slice(0, 2)]; // Both teams use same drivers
		} else if (config.randomizeDrivers) {
			// Random selection
			const shuffled = [...this.allDrivers].sort(() => Math.random() - 0.5);
			const selectedDrivers = shuffled.slice(0, 2);
			return [selectedDrivers, selectedDrivers]; // Both teams use same drivers
		} else {
			// Default drivers
			const defaultDrivers = this.allDrivers.slice(0, 2);
			return [defaultDrivers, defaultDrivers];
		}
	}
	
	/**
	 * Update results based on match outcome
	 */
	private updateResults(
		results: Map<AIType, AIEvaluationResult>,
		ai1: AIType,
		ai2: AIType,
		match: AIMatchResult
	): void {
		const result1 = results.get(ai1);
		const result2 = results.get(ai2);
		if (!result1 || !result2) return;
		
		result1.matchResults.push(match);
		result1.totalGames++;
		
		result2.totalGames++;
		
		if (match.winner === 'player1') {
			result1.wins++;
			result2.losses++;
			// AI1 won, so they get the looted structure
			result1.totalStructureLooted += match.structureLooted;
		} else if (match.winner === 'player2') {
			result1.losses++;
			result2.wins++;
			// AI2 won, so they get the looted structure
			result2.totalStructureLooted += match.structureLooted;
		} else {
			result1.draws++;
			result2.draws++;
			// No looting on draws
		}
	}
	
	/**
	 * Calculate score for a team based on remaining health and vehicles
	 */
	private calculateTeamScore(team: Team): number {
		let score = 0;
		for (const vehicle of team.vehicles) {
			if (vehicle.isAlive()) {
				score += 100; // Base score for operational vehicle
				score += Math.floor((vehicle.structure / vehicle.maxStructure) * 50); // Structure bonus
				
				// Add driver health bonus if driver exists
				const driver = vehicle.driver;
				if (driver) {
					score += Math.floor((driver.hitpoints / driver.maxHitpoints) * 30);
				}
			}
		}
		return score;
	}
	
	/**
	 * Calculate remaining structure in a team's vehicles (for salvage)
	 */
	private calculateRemainingStructure(team: Team): number {
		let totalStructure = 0;
		for (const vehicle of team.vehicles) {
			// Count structure from all vehicles, even destroyed ones
			totalStructure += vehicle.structure;
		}
		return totalStructure;
	}
	
	/**
	 * Format AI decision for logging
	 */
	private formatDecision(decision: { type: string }): string {
		if (decision.type === 'playCard') {
			return `Play card`; // Simplified for now
		} else if (decision.type === 'switchVehicle') {
			return `Switch vehicle`;
		} else if (decision.type === 'endTurn') {
			return 'End turn';
		}
		return 'Unknown decision';
	}
	
	/**
	 * Get a summary of evaluation results
	 */
	static generateSummary(results: Map<AIType, AIEvaluationResult>): string {
		const sortedResults = Array.from(results.values()).sort((a, b) => b.winRate - a.winRate);
		
		let summary = '# AI Evaluation Summary\n\n';
		summary += '## Rankings\n\n';
		
		sortedResults.forEach((result, index) => {
			summary += `${index + 1}. **${result.aiType}** - Win Rate: ${(result.winRate * 100).toFixed(1)}%\n`;
			summary += `   - Wins: ${result.wins}, Losses: ${result.losses}, Draws: ${result.draws}\n`;
			summary += `   - Avg Turns: ${result.avgTurnsPerGame.toFixed(1)}, Avg Score: ${result.avgScorePerGame.toFixed(0)}\n\n`;
		});
		
		summary += '## Head-to-Head Results\n\n';
		
		for (const result of results.values()) {
			const matchupStats = new Map<AIType, { wins: number, losses: number, draws: number }>();
			
			for (const match of result.matchResults) {
				const opponent = match.player1AI === result.aiType ? match.player2AI : match.player1AI;
				if (!matchupStats.has(opponent)) {
					matchupStats.set(opponent, { wins: 0, losses: 0, draws: 0 });
				}
				
				const stats = matchupStats.get(opponent);
				if (!stats) continue;
				if (match.player1AI === result.aiType) {
					if (match.winner === 'player1') stats.wins++;
					else if (match.winner === 'player2') stats.losses++;
					else stats.draws++;
				} else {
					if (match.winner === 'player2') stats.wins++;
					else if (match.winner === 'player1') stats.losses++;
					else stats.draws++;
				}
			}
			
			summary += `### ${result.aiType}\n`;
			for (const [opponent, stats] of matchupStats) {
				const total = stats.wins + stats.losses + stats.draws;
				const winRate = total > 0 ? (stats.wins / total * 100).toFixed(1) : '0.0';
				summary += `- vs ${opponent}: ${stats.wins}W-${stats.losses}L-${stats.draws}D (${winRate}% win rate)\n`;
			}
			summary += '\n';
		}
		
		return summary;
	}
}