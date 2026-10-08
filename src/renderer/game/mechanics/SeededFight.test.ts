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

/** Random AIs on both teams, two vehicles a side, on `rng`, or a stream of its own when left out */
function newFight(rng?: Rng): Battle {
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [fighter('Rig'), fighter('Bike')] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [fighter('Buggy'), fighter('Hauler')] }),
		maxTurns: 6,
		rng
	});
	battle.aiController.setPlayerAI('random');
	battle.aiController.setEnemyAI('random');
	return battle;
}

async function playThrough(battle: Battle): Promise<void> {
	battle.start();
	for (let turn = 0; turn < 10 && !battle.isBattleOver(); turn++) {
		await battle.aiController.playPlayerCards();
		battle.endPlayerTurn();
	}
	expect(battle.isBattleOver()).toBe(true);
}

/** The battle log without timestamps, or the seed line, which differs between seeds by definition */
const logOf = (battle: Battle): string[] => battle.getMessages()
	.filter(({ message }) => message !== `Fight seed ${battle.seed}`)
	.map(({ turn, type, message }) => `${turn} ${type}: ${message}`);

async function playOut(seed: number): Promise<string[]> {
	const battle = newFight(new Rng({ seed }));
	await playThrough(battle);
	return logOf(battle);
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

	it('logs the seed of a stream it minted, and the seed replays it', async () => {
		const minted = newFight();
		await playThrough(minted);

		expect(minted.getMessages().filter(({ message }) => message.startsWith('Fight seed ')))
			.toEqual([expect.objectContaining({ type: 'debug', message: `Fight seed ${minted.seed}` })]);
		expect(await playOut(minted.seed)).toEqual(logOf(minted));
	});

	it('draws each team\'s AI picks and each seat\'s reshuffles from their own streams', async () => {
		const pick = jest.spyOn(Rng.prototype, 'pick');
		const shuffle = jest.spyOn(Deck.prototype, 'shuffle');
		const fight = new Rng({ seed: SEED });
		const battle = newFight(fight);
		// Seats by team and place in its seating order, as Battle names the streams
		const seatStreams = new Map<Deck, number>();
		for (const team of [battle.playerTeam, battle.enemyTeam]) {
			team.getAllDrivers().forEach((driver, index) => {
				if (driver.deck) seatStreams.set(driver.deck, fight.fork(`deck:${team.type}:${index}`).seed);
			});
		}

		await playThrough(battle);

		// Two streams, one a team, each its team's fork of the fight's AI stream
		const aiStreams = new Set(pick.mock.contexts as Rng[]);
		expect(aiStreams.size).toBe(2);
		expect(new Set([...aiStreams].map(rng => rng.seed)))
			.toEqual(new Set([fight.fork('ai').fork('player').seed, fight.fork('ai').fork('enemy').seed]));

		// Every reshuffle draws from its own seat's stream, the same one all fight
		const deckStreams = new Map<Deck, Set<Rng>>();
		shuffle.mock.calls.forEach(([rng], call) => {
			const deck = shuffle.mock.contexts[call] as Deck;
			expect(rng.seed).toBe(seatStreams.get(deck));
			deckStreams.set(deck, (deckStreams.get(deck) ?? new Set<Rng>()).add(rng));
		});
		expect(deckStreams.size).toBe(4);
		deckStreams.forEach(streams => expect(streams.size).toBe(1));
	});
});
