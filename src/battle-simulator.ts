import { Battle, BattleMessage } from './renderer/game/mechanics/Battle';
import { Team, TeamType } from './renderer/game/mechanics/Team';
import { Vehicle, VehiclePosition } from './renderer/game/mechanics/Vehicle';
import { DriverArchetype } from './renderer/game/mechanics/Driver';
import { DriverLoader } from './renderer/game/core/DriverLoader';
import { CardLoader } from './renderer/game/core/CardLoader';
import { AIType } from './renderer/game/ai/AIController';
import { HumanPlayerInterface } from './human-player-interface';

// Types for the battle simulator
interface BattleSetup {
	playerAI: string;
	enemyAI: string;
	playerDrivers: string[];
	enemyDrivers: string[];
}

interface BattleResult {
	winner: 'player' | 'enemy' | 'tie';
	finalTurn: number;
	playerTeamStats: {
		vehicles: Array<{
			name: string;
			structure: number;
			maxStructure: number;
			armor: number;
			maxArmor: number;
			driver: {
				name: string;
				hitpoints: number;
				maxHitpoints: number;
			} | null;
		}>;
	};
	enemyTeamStats: {
		vehicles: Array<{
			name: string;
			structure: number;
			maxStructure: number;
			armor: number;
			maxArmor: number;
			driver: {
				name: string;
				hitpoints: number;
				maxHitpoints: number;
			} | null;
		}>;
	};
	messages: Array<{
		type: string;
		message: string;
		timestamp: number;
		turn: number;
	}>;
}

class BattleSimulator {
	private driverLoader: DriverLoader;
	private cardLoader: CardLoader;
	private isInitialized = false;
	private humanInterface: HumanPlayerInterface | null = null;
	private currentBattle: Battle | null = null;

	constructor() {
		this.driverLoader = DriverLoader.getInstance();
		this.cardLoader = CardLoader.getInstance();
	}

	async initialize(): Promise<void> {
		if (this.isInitialized) return;
		
		// Initialize card loader
		await this.cardLoader.loadCards();
		
		// Initialize driver data
		await this.driverLoader.loadDrivers();
		
		this.isInitialized = true;
	}

	async runBattle(setup: BattleSetup): Promise<BattleResult> {
		// Ensure we're initialized
		await this.initialize();

		// Create player team
		const playerVehicles: Vehicle[] = [];
		for (let i = 0; i < setup.playerDrivers.length; i++) {
			const driver = await this.driverLoader.createDriverWithStartingDeck(setup.playerDrivers[i] as DriverArchetype);
			if (!driver) throw new Error(`Unknown driver: ${setup.playerDrivers[i]}`);
			
			const vehicle = new Vehicle({
				name: `Player Vehicle ${i + 1}`,
				structure: driver.vehicleStats.maxStructure,
				maxStructure: driver.vehicleStats.maxStructure,
				armor: 10, // Start with full armor
				maxArmor: 10,
				speed: driver.vehicleStats.speed,
				baseSpeed: driver.vehicleStats.speed,
				position: i === 0 ? VehiclePosition.FRONT : VehiclePosition.BACK,
				velocity: 0,
				driver: driver,
				passenger: null,
				statusEffects: []
			});
			
			playerVehicles.push(vehicle);
		}
		
		const playerTeam = new Team({
			type: TeamType.PLAYER,
			vehicles: playerVehicles
		});

		// Create enemy team
		const enemyVehicles: Vehicle[] = [];
		for (let i = 0; i < setup.enemyDrivers.length; i++) {
			const driver = await this.driverLoader.createDriverWithStartingDeck(setup.enemyDrivers[i] as DriverArchetype);
			if (!driver) throw new Error(`Unknown driver: ${setup.enemyDrivers[i]}`);
			
			const vehicle = new Vehicle({
				name: `Enemy Vehicle ${i + 1}`,
				structure: driver.vehicleStats.maxStructure,
				maxStructure: driver.vehicleStats.maxStructure,
				armor: 10, // Start with full armor
				maxArmor: 10,
				speed: driver.vehicleStats.speed,
				baseSpeed: driver.vehicleStats.speed,
				position: i === 0 ? VehiclePosition.FRONT : VehiclePosition.BACK,
				velocity: 0,
				driver: driver,
				passenger: null,
				statusEffects: []
			});
			
			enemyVehicles.push(vehicle);
		}
		
		const enemyTeam = new Team({
			type: TeamType.ENEMY,
			vehicles: enemyVehicles
		});

		// Create battle with max turns to prevent infinite loops
		const battle = new Battle({
			playerTeam,
			enemyTeam,
			maxTurns: 50
		});
		
		// Store current battle
		this.currentBattle = battle;
		
		// Create human interface if player is not AI-controlled
		if (!setup.playerAI || setup.playerAI === 'human') {
			this.humanInterface = new HumanPlayerInterface(battle);
		}

		// Configure AI for both teams
		const aiController = battle.aiController;
		
		if (setup.playerAI) {
			aiController.setPlayerAI(setup.playerAI as AIType);
		}
		
		if (setup.enemyAI) {
			aiController.setEnemyAI(setup.enemyAI as AIType);
		}

		// If human player, set up battle message forwarding
		if (this.humanInterface) {
			// Forward battle messages to window events
			battle.on('battleMessage', (message: BattleMessage) => {
				const event = new CustomEvent('battleMessage', {
					detail: message
				});
				window.dispatchEvent(event);
			});
		}
		
		// Start the battle
		battle.start();
		
		// If human player, trigger initial UI update
		if (this.humanInterface) {
			// Give the UI a moment to initialize
			setTimeout(() => {
				const event = new CustomEvent('playerTurnStart', {
					detail: {
						playerTeam: battle.playerTeam,
						enemyTeam: battle.enemyTeam
					}
				});
				window.dispatchEvent(event);
			}, 50);
		}

		// Run the battle to completion
		while (!battle.isBattleOver()) {
			if (battle.isPlayerTurn) {
				// Player turn
				if (this.humanInterface) {
					// Human player - wait for decisions
					let continuePlayingCards = true;
					while (continuePlayingCards && !battle.isBattleOver()) {
						const decision = await this.humanInterface.requestDecision();
						
						if (!decision || decision.type === 'endTurn') {
							continuePlayingCards = false;
						} else if (decision.type === 'playCard' && decision.card && decision.driver) {
							const cardIndex = decision.driver.hand.indexOf(decision.card);
							if (cardIndex !== -1) {
								battle.playCard({
									driver: decision.driver,
									cardIndex,
									targetVehicle: decision.target
								});
							}
						}
					}
				} else if (aiController.isPlayerControlledByAI()) {
					// AI player - automatic decisions
					let continuePlayingCards = true;
					while (continuePlayingCards && !battle.isBattleOver()) {
						const decision = await aiController.getPlayerDecision();
						
						if (!decision || decision.type === 'endTurn') {
							continuePlayingCards = false;
						} else if (decision.type === 'playCard' && decision.card && decision.driver) {
							const cardIndex = decision.driver.hand.indexOf(decision.card);
							if (cardIndex !== -1) {
								let targetVehicle: Vehicle | undefined = undefined;
								if (decision.target && 'structure' in decision.target) {
									targetVehicle = decision.target as Vehicle;
								}
								battle.playCard({
									driver: decision.driver,
									cardIndex,
									targetVehicle
								});
							}
						}
					}
				}
				
				// End player turn
				if (!battle.isBattleOver()) {
					await battle.endPlayerTurn();
				}
			}
			// Enemy turns are handled automatically by endPlayerTurn
		}

		// Determine winner
		let winner: 'player' | 'enemy' | 'tie';
		if (battle.isBattleTied()) {
			winner = 'tie';
		} else if (battle.isBattleWon()) {
			winner = 'player';
		} else {
			winner = 'enemy';
		}

		// Collect final stats
		const result: BattleResult = {
			winner,
			finalTurn: battle.turn,
			playerTeamStats: {
				vehicles: playerTeam.vehicles.map(v => ({
					name: v.name,
					structure: v.structure,
					maxStructure: v.maxStructure,
					armor: v.armor,
					maxArmor: v.maxArmor,
					driver: v.driver ? {
						name: v.driver.metadata.name,
						hitpoints: v.driver.hitpoints,
						maxHitpoints: v.driver.maxHitpoints
					} : null
				}))
			},
			enemyTeamStats: {
				vehicles: enemyTeam.vehicles.map(v => ({
					name: v.name,
					structure: v.structure,
					maxStructure: v.maxStructure,
					armor: v.armor,
					maxArmor: v.maxArmor,
					driver: v.driver ? {
						name: v.driver.metadata.name,
						hitpoints: v.driver.hitpoints,
						maxHitpoints: v.driver.maxHitpoints
					} : null
				}))
			},
			messages: battle.getMessages().map(m => ({
				type: m.type,
				message: m.message,
				timestamp: m.timestamp,
				turn: m.turn
			}))
		};

		return result;
	}
	
	/**
	 * Get the human interface for the current battle
	 */
	public getHumanInterface(): HumanPlayerInterface | null {
		return this.humanInterface;
	}
	
	/**
	 * Get the current battle instance
	 */
	public getCurrentBattle(): Battle | null {
		return this.currentBattle;
	}
}

// Export for browser usage
declare global {
	interface Window {
		BattleSimulator: typeof BattleSimulator;
	}
}

window.BattleSimulator = BattleSimulator;