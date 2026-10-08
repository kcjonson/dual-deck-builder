import { Battle } from './Battle';
import { Card, CardEffect, TargetType } from './Card';
import { Deck } from './Deck';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { Rng } from '../core/Rng';
import { createTestDriver, createTestVehicle } from '../ai/__tests__/test-helpers';

/**
 * DDB-399: everything random in a fight draws from the stream the battle is
 * given, so one seed plays a fight out the same way: the same reshuffles, the
 * same picks from both random AIs, and so the same log.
 */

const SEED = 20261007;

const card = (name: string, targetType: TargetType, effects: CardEffect[]): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType,
	effects,
	tags: []
});

/** Eight cards, so every draw pile runs dry and reshuffles on the second turn */
const deckCards = (): Card[] => [
	card('Jab', 'enemy_single', [{ type: 'damage', value: 2 }]),
	card('Jab', 'enemy_single', [{ type: 'damage', value: 2 }]),
	card('Cross', 'enemy_single', [{ type: 'damage', value: 3 }]),
	card('Hook', 'enemy_single', [{ type: 'damage', value: 4 }]),
	card('Brace', 'self', [{ type: 'gain_armor', value: 2, target: 'self' }]),
	card('Brace', 'self', [{ type: 'gain_armor', value: 2, target: 'self' }]),
	card('Scavenge', 'self', [{ type: 'draw', value: 1 }]),
	card('Patch', 'self', [{ type: 'heal', value: 3, target: 'self' }])
];

/** A vehicle whose driver hits (gunnery over the test driver's evade) and lasts a few turns */
const fighter = (name: string): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({
		skills: { ...driver.skills, gunnery: 7 },
		hitpoints: 30,
		maxHitpoints: 30,
		deck: new Deck('test', `${name} Deck`, deckCards())
	});
	const vehicle = createTestVehicle(name, driver);
	vehicle.set({ structure: 30, maxStructure: 30 });
	return vehicle;
};

/** Random AIs on both sides fight it out from `seed`; the battle log, without timestamps */
async function playOut(seed: number): Promise<string[]> {
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [fighter('Rig'), fighter('Bike')] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [fighter('Buggy'), fighter('Hauler')] }),
		maxTurns: 6,
		rng: new Rng({ seed })
	});
	battle.aiController.setPlayerAI('random');
	battle.aiController.setEnemyAI('random');
	battle.start();
	for (let turn = 0; turn < 10 && !battle.isBattleOver(); turn++) {
		await battle.aiController.playPlayerCards();
		battle.endPlayerTurn();
	}
	expect(battle.isBattleOver()).toBe(true);
	return battle.getMessages().map(({ turn, type, message }) => `${turn} ${type}: ${message}`);
}

describe('a seeded fight', () => {
	beforeEach(() => {
		// Drivers log every draw; Jest formatting those can call Math.random
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('plays out the same way twice from one seed', async () => {
		const shuffle = jest.spyOn(Deck.prototype, 'shuffle');
		const pick = jest.spyOn(Rng.prototype, 'pick');

		const first = await playOut(SEED);

		// The fight had something to replay: reshuffles, AI picks, and cards played
		expect(shuffle).toHaveBeenCalled();
		expect(pick).toHaveBeenCalled();
		expect(first.filter(line => line.includes('card_played')).length).toBeGreaterThan(4);
		expect(await playOut(SEED)).toEqual(first);
	});

	it('plays out another way from another seed', async () => {
		expect(await playOut(SEED + 1)).not.toEqual(await playOut(SEED));
	});

	it('never calls Math.random, from building the teams to the last turn', async () => {
		const random = jest.spyOn(Math, 'random');

		await playOut(SEED);

		expect(random).not.toHaveBeenCalled();
	});
});
