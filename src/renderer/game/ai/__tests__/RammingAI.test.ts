import { RammingAI, RammingStrategy } from '../RammingAI';
import { AIDecision } from '../types';
import {
	createDrawCard,
	createFillerCards,
	createTestCard,
	createTestDriver,
	createTestVehicle,
	driverOf,
	play,
	realCard,
	withEffects
} from './test-helpers';
import { Card } from '../../mechanics/Card';
import { Battle } from '../../mechanics/Battle';
import { BoardProjection } from '../../mechanics/BoardProjection';
import { Team, TeamType } from '../../mechanics/Team';

// Nitro Boost with its speed but not its draw, which passes RammingAI's no-effect check
const nitroWithoutDraw = (nitro: Card): Card =>
	withEffects('nitro_boost', nitro.effects.filter(effect => effect.type !== 'draw_cards'));

/**
 * Reads the strategy's score for one play against the live board
 */
class ScoringRammingAI extends RammingAI {
	private readonly scorer = new RammingStrategy();

	public score(action: AIDecision): number {
		this.board = new BoardProjection({ battle: this.battle });
		return this.scorer.scoreAction(action, this.evaluateGameState());
	}
}

describe('RammingAI', () => {
	let battle: Battle;
	let playerTeam: Team;
	let enemyTeam: Team;
	let ai: RammingAI;

	beforeEach(() => {
		// Create drivers
		const playerDriver1 = createTestDriver('Player Driver 1');
		const playerDriver2 = createTestDriver('Player Driver 2');
		const enemyDriver1 = createTestDriver('Enemy Driver 1');
		const enemyDriver2 = createTestDriver('Enemy Driver 2');

		// Create vehicles with drivers
		const playerVehicle1 = createTestVehicle('Player Vehicle 1', playerDriver1);
		const playerVehicle2 = createTestVehicle('Player Vehicle 2', playerDriver2);
		const enemyVehicle1 = createTestVehicle('Enemy Vehicle 1', enemyDriver1);
		const enemyVehicle2 = createTestVehicle('Enemy Vehicle 2', enemyDriver2);

		// Battle places both teams in their opening formation

		// Create teams
		playerTeam = new Team({ 
			type: TeamType.PLAYER, 
			vehicles: [playerVehicle1, playerVehicle2] 
		});
		enemyTeam = new Team({ 
			type: TeamType.ENEMY, 
			vehicles: [enemyVehicle1, enemyVehicle2] 
		});

		// Create battle
		battle = new Battle({ playerTeam, enemyTeam });
		ai = new RammingAI(enemyTeam, battle);
	});

	describe('makeDecision', () => {
		it('should prioritize ramming cards over other damage cards', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// A fast rammer: 5 + the test driver's 2 = 7, faster than the player's 5s.
			// Ram damage grows with the speed difference, so the ram's bonus needs
			// that edge over its target.
			enemyVehicle.baseSpeed = 5;

			// Create test cards
			const rammingCard = new Card({
				type: 'ramming_speed',
				name: 'Ramming Speed',
				summary: 'Ram an enemy for damage',
				description: 'Ram an enemy for damage',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', formula: 'armor/10 + speed_diff', scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			const gunCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				summary: 'Shoot an enemy',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 15 }
				],
				tags: ['ranged', 'attack']
			});

			// Give the AI both cards
			enemyDriver.hand = [gunCard, rammingCard];
			enemyDriver.adrenaline = 5;

			// Make decision
			const decision = await ai.makeDecision();

			expect(decision).not.toBeNull();
			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(rammingCard);
		});

		it('should prioritize speed boosts when below speed threshold', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// 1 + the test driver's 2 = 3, slower than both player vehicles (5)
			enemyVehicle.baseSpeed = 1;

			const speedCard = realCard('nitro_boost');

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				summary: 'Shoot an enemy',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [attackCard, speedCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(speedCard);
		});

		it('should prioritize armor cards to protect during rams', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// Set low armor
			enemyVehicle.armor = 0;

			const armorCard = new Card({
				type: 'reinforced_plating',
				name: 'Reinforced Plating',
				summary: 'Add armor',
				description: 'Add armor',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'gain_armor', value: 20 }
				],
				tags: ['defense']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				summary: 'Shoot an enemy',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [attackCard, armorCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(armorCard);
		});

		it('should prioritize healing when at critical health', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// Set critical health
			enemyVehicle.structure = 10;
			enemyVehicle.maxStructure = 100;

			const healCard = new Card({
				type: 'emergency_repair',
				name: 'Emergency Repair',
				summary: 'Heal vehicle',
				description: 'Heal vehicle',
				cost: 2,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'heal', value: 30 }
				],
				tags: ['heal']
			});

			const rammingCard = new Card({
				type: 'ramming_speed',
				name: 'Ramming Speed',
				summary: 'Ram an enemy',
				description: 'Ram an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', formula: 'armor/10 + speed_diff', scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			enemyDriver.hand = [rammingCard, healCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(healCard);
		});

		it('should value a flank while not flanking', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			expect(enemyVehicle.isFlanking).toBe(false);
			// 5 + the test driver's 2 = 7 outruns the player's 5s, so the Flank is legal
			enemyVehicle.baseSpeed = 5;

			const positionCard = realCard('flank');

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				summary: 'Shoot an enemy',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [attackCard, positionCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(positionCard);
		});

		it('should target low health enemies with rams for kill bonus', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// Set enemy vehicles with different health
			const playerVehicle1 = battle.playerTeam.vehicles[0];
			const playerVehicle2 = battle.playerTeam.vehicles[1];
			
			playerVehicle1.structure = 100;
			playerVehicle1.maxStructure = 100;
			playerVehicle2.structure = 15; // Low health
			playerVehicle2.maxStructure = 100;

			const rammingCard = new Card({
				type: 'ramming_speed',
				name: 'Ramming Speed',
				summary: 'Ram an enemy',
				description: 'Ram an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 30, scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			enemyDriver.hand = [rammingCard];
			enemyDriver.adrenaline = 5;

			// Set up good ramming conditions
			enemyVehicle.baseSpeed = 5; // 5 + the test driver's 2 = 7, faster than the player's 5s
			enemyVehicle.armor = 50;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(rammingCard);
			expect(decision?.target).toBe(playerVehicle2); // Should target low health vehicle
		});

		it('should end turn when no good plays available', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// Give expensive card with no adrenaline
			const expensiveCard = new Card({
				type: 'mega_ram',
				name: 'Mega Ram',
				summary: 'Expensive ram',
				description: 'Expensive ram',
				cost: 10,
				rarity: 'rare',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 50, scaling: 'ramming' }
				],
				tags: ['ramming', 'attack']
			});

			enemyDriver.hand = [expensiveCard];
			enemyDriver.adrenaline = 2; // Not enough

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('endTurn');
		});

		it('should not play healing cards when at full health', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// Ensure vehicle is at full health
			enemyVehicle.structure = enemyVehicle.maxStructure;
			enemyVehicle.armor = enemyVehicle.maxArmor;

			const healCard = new Card({
				type: 'repair_kit',
				name: 'Repair Kit',
				summary: 'Heal vehicle',
				description: 'Heal vehicle',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'heal', value: 10 }
				],
				tags: ['heal']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				summary: 'Shoot an enemy',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [healCard, attackCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(attackCard); // Should prefer attack over useless heal
		});

		it('should not play armor cards when at full armor', async () => {
			const enemyVehicle = battle.enemyTeam.vehicles[0];
			const enemyDriver = driverOf(enemyVehicle);

			// Ensure vehicle is at full armor
			enemyVehicle.armor = enemyVehicle.maxArmor;

			const armorCard = new Card({
				type: 'armor_plating',
				name: 'Armor Plating',
				summary: 'Add armor',
				description: 'Add armor',
				cost: 1,
				rarity: 'common',
				targetType: 'self',
				effects: [
					{ type: 'gain_armor', value: 10 }
				],
				tags: ['defense']
			});

			const attackCard = new Card({
				type: 'gun_attack',
				name: 'Gun Attack',
				summary: 'Shoot an enemy',
				description: 'Shoot an enemy',
				cost: 2,
				rarity: 'common',
				targetType: 'enemy_single',
				effects: [
					{ type: 'damage', value: 10 }
				],
				tags: ['ranged', 'attack']
			});

			enemyDriver.hand = [armorCard, attackCard];
			enemyDriver.adrenaline = 5;

			const decision = await ai.makeDecision();

			expect(decision?.type).toBe('playCard');
			expect(decision?.card).toBe(attackCard); // Should prefer attack over useless armor
		});
	});

	describe('values a draw by the cards that fit under the drawer\'s hand limit', () => {
		test('worth nothing at the limit, one card a card under it, and both with room', () => {
			const raider = driverOf(enemyTeam.vehicles[0]);
			const nitro = realCard('nitro_boost');
			const control = nitroWithoutDraw(nitro);
			// Five cards, four once Nitro Boost has left the hand
			raider.set({ hand: [nitro, control, ...createFillerCards(3)], adrenaline: 5 });
			const scorer = new ScoringRammingAI(enemyTeam, battle);
			const drawWorth = (handLimit: number): number => {
				raider.set({ handLimit });
				return scorer.score(play(nitro, raider)) - scorer.score(play(control, raider));
			};

			const bothCards = drawWorth(7);
			expect(bothCards).toBeGreaterThan(0);
			expect(drawWorth(5)).toBeCloseTo(bothCards / 2);
			expect(drawWorth(4)).toBe(0);
		});

		test('plays something useful over a draw it would burn', async () => {
			const raider = driverOf(enemyTeam.vehicles[0]);
			const draw = createDrawCard(2);
			const shot = createTestCard({
				type: 'gun_attack',
				name: 'Gun Attack',
				cost: 1,
				targetType: 'enemy_single',
				effects: [{ type: 'damage', value: 3 }]
			});
			// Four cards, three once the draw has left the hand
			raider.set({ hand: [draw, shot, ...createFillerCards(2)], adrenaline: 5 });

			expect((await ai.makeDecision())?.card).toBe(draw);

			raider.set({ handLimit: 3 });
			expect((await ai.makeDecision())?.card).toBe(shot);
		});

		test('counts a draw against its player\'s hand, not their partner\'s', () => {
			const [driver, partner] = playerTeam.vehicles.map(driverOf);
			const nitro = realCard('nitro_boost');
			const control = nitroWithoutDraw(nitro);
			driver.set({ hand: [nitro, control, ...createFillerCards(3)], adrenaline: 5 });
			const scorer = new ScoringRammingAI(playerTeam, battle);
			const drawWorth = (): number => scorer.score(play(nitro, driver)) - scorer.score(play(control, driver));
			const bothCards = drawWorth();
			expect(bothCards).toBeGreaterThan(0);

			partner.set({ hand: createFillerCards(7) });
			expect(drawWorth()).toBeCloseTo(bothCards);

			partner.set({ hand: [] });
			driver.set({ handLimit: 4 });
			expect(drawWorth()).toBe(0);
		});
	});
});