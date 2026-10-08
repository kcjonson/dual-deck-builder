import { Battle } from '../mechanics/Battle';
import { BoardProjection, cardsKept } from '../mechanics/BoardProjection';
import { Card, CardData } from '../mechanics/Card';
import { Driver } from '../mechanics/Driver';
import { Team, TeamType } from '../mechanics/Team';
import { Vehicle } from '../mechanics/Vehicle';
import { cardsDrawn, cardsKeptFromDraw } from './DrawEstimate';
import { createTestCard, createTestDriver, createTestVehicle } from './__tests__/test-helpers';
import cardsFile from '../data/cards.json';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

const realCard = (type: string): Card => {
	const data = cardData.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data, upgraded: false });
};

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const fillers = (count: number): Card[] => Array.from({ length: count }, (_, index) => createTestCard({
	type: 'filler',
	name: `Filler ${index + 1}`,
	cost: 0,
	targetType: 'enemy_single',
	effects: [{ type: 'damage', value: 1 }]
}));

describe('Draw estimates', () => {
	let battle: Battle;
	let player: Driver;
	let partner: Driver;
	let raider: Driver;

	beforeEach(() => {
		const playerTeam = new Team({
			type: TeamType.PLAYER,
			vehicles: [
				createTestVehicle('Rig', createTestDriver('Player')),
				createTestVehicle('Bike', createTestDriver('Partner'))
			]
		});
		const enemyTeam = new Team({ type: TeamType.ENEMY, vehicles: [createTestVehicle('Buggy', createTestDriver('Raider'))] });
		battle = new Battle({ playerTeam, enemyTeam });
		[player, partner] = playerTeam.vehicles.map(driverOf);
		raider = driverOf(enemyTeam.vehicles[0]);
	});

	const live = (): BoardProjection => new BoardProjection({ battle });

	test('a card draws what its draw effects say, as the battle counts them', () => {
		const twoDraws = createTestCard({
			type: 'double_draw',
			name: 'Double Draw',
			cost: 0,
			targetType: 'self',
			effects: [{ type: 'draw_cards', value: 1 }, { type: 'draw_cards', value: 2 }]
		});

		expect(cardsDrawn(realCard('nitro_boost'))).toBe(2);
		expect(cardsDrawn(twoDraws)).toBe(3);
		expect(cardsDrawn(realCard('armor_plating'))).toBe(0);
	});

	test('a draw fills the hand to the limit and burns the rest', () => {
		expect(cardsKept({ count: 3, handSize: 0, handLimit: 7 })).toBe(3);
		expect(cardsKept({ count: 3, handSize: 5, handLimit: 7 })).toBe(2);
		expect(cardsKept({ count: 3, handSize: 7, handLimit: 7 })).toBe(0);
		// A limit lowered under the hand discards nothing, and every draw burns
		expect(cardsKept({ count: 3, handSize: 9, handLimit: 7 })).toBe(0);
	});

	describe('the cards a play keeps', () => {
		test('are all of them while the hand has room', () => {
			const nitro = realCard('nitro_boost');
			player.set({ hand: [nitro, ...fillers(2)] });

			expect(cardsKeptFromDraw({ board: live(), card: nitro, player })).toBe(2);
		});

		test('count the played card as gone, so a hand at its limit keeps one', () => {
			const nitro = realCard('nitro_boost');
			player.set({ hand: [nitro, ...fillers(6)] });

			expect(player.handLimit).toBe(7);
			expect(cardsKeptFromDraw({ board: live(), card: nitro, player })).toBe(1);
		});

		test('are none once the hand is at its limit without the card, and one a card below it', () => {
			const nitro = realCard('nitro_boost');
			player.set({ hand: [nitro, ...fillers(4)], handLimit: 4 });
			expect(cardsKeptFromDraw({ board: live(), card: nitro, player })).toBe(0);

			player.set({ handLimit: 5 });
			expect(cardsKeptFromDraw({ board: live(), card: nitro, player })).toBe(1);
		});

		test('are none, never fewer, in a hand over a lowered limit', () => {
			const nitro = realCard('nitro_boost');
			player.set({ hand: [nitro, ...fillers(5)], handLimit: 2 });

			expect(cardsKeptFromDraw({ board: live(), card: nitro, player })).toBe(0);
		});

		test('are none for a card that draws nothing', () => {
			const plating = realCard('armor_plating');
			player.set({ hand: [plating] });

			expect(cardsKeptFromDraw({ board: live(), card: plating, player })).toBe(0);
		});

		test('count against whoever draws: another driver\'s hand and limit, where the played card frees no room', () => {
			const nitro = realCard('nitro_boost');
			player.set({ hand: [nitro, ...fillers(6)] });
			partner.set({ hand: fillers(3), handLimit: 3 });
			expect(cardsKeptFromDraw({ board: live(), card: nitro, player, drawer: partner })).toBe(0);

			partner.set({ hand: fillers(2) });
			expect(cardsKeptFromDraw({ board: live(), card: nitro, player, drawer: partner })).toBe(1);

			partner.set({ hand: [] });
			expect(cardsKeptFromDraw({ board: live(), card: nitro, player, drawer: partner })).toBe(2);
		});

		test('count a plan\'s earlier cards: kept draws fill the hand, and plays empty it', () => {
			const [first, second] = [realCard('nitro_boost'), realCard('nitro_boost')];
			const [filler] = fillers(1);
			raider.set({ hand: [first, second, filler, ...fillers(2)], handLimit: 6 });
			const plan = live();

			// 5 cards, 4 once the first leaves: it keeps both, and the hand holds 6
			expect(cardsKeptFromDraw({ board: plan, card: first, player: raider })).toBe(2);
			plan.apply({ card: first, driver: raider, target: null });
			expect(plan.handSizeOf(raider)).toBe(6);
			expect(plan.handOf(raider)).toHaveLength(4);

			// 5 once the second leaves, one under the limit
			expect(cardsKeptFromDraw({ board: plan, card: second, player: raider })).toBe(1);
			expect(cardsKeptFromDraw({ board: live(), card: second, player: raider })).toBe(2);

			plan.apply({ card: filler, driver: raider, target: null });
			expect(plan.handSizeOf(raider)).toBe(5);
			expect(cardsKeptFromDraw({ board: plan, card: second, player: raider })).toBe(2);
		});

		test('count a planned draw\'s burns: the hand never grows past the limit', () => {
			const [first, second] = [realCard('nitro_boost'), realCard('nitro_boost')];
			raider.set({ hand: [first, second, ...fillers(4)], handLimit: 6 });
			const plan = live();

			// 6 cards, 5 once the first leaves: one kept, one burned
			plan.apply({ card: first, driver: raider, target: null });
			expect(plan.handSizeOf(raider)).toBe(6);
			expect(cardsKeptFromDraw({ board: plan, card: second, player: raider })).toBe(1);
			plan.apply({ card: second, driver: raider, target: null });
			expect(plan.handSizeOf(raider)).toBe(6);
		});
	});
});
