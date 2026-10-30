import { Battle, TURN_DRAW } from './Battle';
import { Card, CardEffect, TargetType } from './Card';
import { Deck } from './Deck';
import { Driver } from './Driver';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { Rng } from '../core/Rng';
import { createTestDriver, createTestVehicle } from '../ai/__tests__/test-helpers';

/**
 * DDB-399: everything random in a fight draws from the stream the battle is
 * given, so one seed plays a fight out the same way: the same shuffles, the
 * same picks from both random AIs, and so the same log. DDB-411: that
 * includes the shuffle every deck gets before the opening deal.
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

		// The fight had something to replay: reshuffles past the four opening
		// shuffles, AI picks, and cards played
		expect(shuffle.mock.calls.length).toBeGreaterThan(4);
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

	it('draws each team\'s AI picks and each seat\'s shuffles from their own streams', async () => {
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

		// Every shuffle, a deck's opening one and each reshuffle after it, draws
		// from its own seat's stream, the same one all fight
		const deckStreams = new Map<Deck, Rng[]>();
		shuffle.mock.calls.forEach(([rng], call) => {
			const deck = shuffle.mock.contexts[call] as Deck;
			expect(rng.seed).toBe(seatStreams.get(deck));
			deckStreams.set(deck, [...(deckStreams.get(deck) ?? []), rng]);
		});
		expect(deckStreams.size).toBe(4);
		deckStreams.forEach(streams => {
			expect(streams.length).toBeGreaterThan(1);
			expect(new Set(streams).size).toBe(1);
		});
	});

	describe('its opening deal', () => {
		/** Every driver in the fight in seating order, the player's first */
		const seatedDrivers = (battle: Battle): Driver[] => [...battle.playerTeam.getAllDrivers(), ...battle.enemyTeam.getAllDrivers()];

		/** Each seat's hand by card name, in seating order */
		const handsOf = (battle: Battle): string[][] => seatedDrivers(battle).map(driver => driver.hand.map(({ name }) => name));

		const idsOf = (cards: readonly Card[]): string[] => cards.map(({ id }) => id);

		/** A fight on `seed`, started: dealt and planned, nothing played */
		function openingDeal(seed: number): Battle {
			const battle = newFight(new Rng({ seed }));
			battle.start();
			return battle;
		}

		it('shuffles each deck on the first draws of its seat\'s stream, then deals its top five', () => {
			const fight = new Rng({ seed: SEED });
			const battle = newFight(fight);
			const built = new Map(seatedDrivers(battle).map(driver => [driver, [...(driver.deck?.cards ?? [])]]));

			battle.start();

			for (const team of [battle.playerTeam, battle.enemyTeam]) {
				team.getAllDrivers().forEach((driver, index) => {
					const shuffled = fight.fork(`deck:${team.type}:${index}`).shuffle([...(built.get(driver) ?? [])]);
					// A draw takes the deck's last card, so the hand is the last five, last first
					expect(idsOf(driver.hand)).toEqual(idsOf(shuffled.slice(-TURN_DRAW).reverse()));
					expect(idsOf(driver.deck?.cards ?? [])).toEqual(idsOf(shuffled.slice(0, -TURN_DRAW)));
				});
			}
		});

		it('deals the same opening hands from one seed', () => {
			const hands = handsOf(openingDeal(SEED));

			expect(hands).toHaveLength(4);
			hands.forEach(hand => expect(hand).toHaveLength(TURN_DRAW));
			expect(handsOf(openingDeal(SEED))).toEqual(hands);
		});

		it('deals other opening hands from other seeds', () => {
			// Unshuffled, every seed dealt each deck's top five in the order it was built
			const deals = Array.from({ length: 20 }, (_, offset) => handsOf(openingDeal(SEED + offset)));

			expect(new Set(deals.map(hands => JSON.stringify(hands))).size).toBe(deals.length);
			// Not one seat carrying the rest: every seat's own hand moves with the seed
			for (let seat = 0; seat < 4; seat++) {
				expect(new Set(deals.map(hands => hands[seat].join())).size).toBeGreaterThan(1);
			}
		});

		it('leaves every reshuffle after it replaying from the seed', async () => {
			const shuffle = jest.spyOn(Deck.prototype, 'shuffle');
			/** Every order each seat's deck passes through, from the opening shuffle to the fight's last draw */
			const deckHistories = async (seed: number): Promise<string[][][]> => {
				const battle = newFight(new Rng({ seed }));
				const histories = seatedDrivers(battle).map(driver => {
					const history: string[][] = [];
					driver.deck?.on('cards', (cards: Card[]) => history.push(cards.map(({ name }) => name)));
					return history;
				});
				await playThrough(battle);
				return histories;
			};

			const first = await deckHistories(SEED);

			// Reshuffles past the four opening shuffles, so there were some to replay
			expect(shuffle.mock.calls.length).toBeGreaterThan(4);
			expect(await deckHistories(SEED)).toEqual(first);
		});

		it('deals from one seat\'s stream without moving another seat\'s hand', () => {
			const dealt = handsOf(openingDeal(SEED));
			const battle = newFight(new Rng({ seed: SEED }));
			// A ninth card takes the first seat's shuffle another draw
			battle.playerTeam.getAllDrivers()[0].deck?.addCard(card('Feint', 'self', []));

			battle.start();

			expect(handsOf(battle).slice(1)).toEqual(dealt.slice(1));
		});

		it('never calls Math.random when the fight is given a stream', () => {
			const random = jest.spyOn(Math, 'random');
			const shuffle = jest.spyOn(Deck.prototype, 'shuffle');

			openingDeal(SEED);

			expect(shuffle).toHaveBeenCalledTimes(4);
			expect(random).not.toHaveBeenCalled();
		});
	});
});
