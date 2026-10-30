import { Battle } from '../mechanics/Battle';
import { BoardProjection } from '../mechanics/BoardProjection';
import { Driver } from '../mechanics/Driver';
import { Team, TeamType } from '../mechanics/Team';
import { cardsDrawn, cardsKeptFromDraw } from './DrawEstimate';
import { createDrawCard, createFillerCards, createTestCard, createTestDriver, createTestVehicle, driverOf } from './__tests__/test-helpers';

describe('Draw estimates', () => {
	let battle: Battle;
	let player: Driver;
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
		player = driverOf(playerTeam.vehicles[0]);
		raider = driverOf(enemyTeam.vehicles[0]);
	});

	const live = (): BoardProjection => new BoardProjection({ battle });

	test('a card draws what its draw_cards effects say, and none for an effect with no value', () => {
		const twoDraws = createTestCard({
			type: 'double_draw',
			name: 'Double Draw',
			cost: 0,
			targetType: 'self',
			effects: [{ type: 'draw_cards', value: 1 }, { type: 'draw_cards', value: 2 }]
		});
		const noValue = createDrawCard(2);
		noValue.set({ effects: [{ type: 'draw_cards' }] });

		expect(cardsDrawn(createDrawCard(2))).toBe(2);
		expect(cardsDrawn(twoDraws)).toBe(3);
		expect(cardsDrawn(noValue)).toBe(0);
		expect(cardsDrawn(createFillerCards(1)[0])).toBe(0);
	});

	describe('the cards a play keeps', () => {
		test('are all of them while the hand has room', () => {
			const draw = createDrawCard(2);
			player.set({ hand: [draw, ...createFillerCards(2)] });

			expect(cardsKeptFromDraw({ board: live(), card: draw, player })).toBe(2);
		});

		test('count the played card as gone, so a hand at its limit keeps one', () => {
			const draw = createDrawCard(2);
			player.set({ hand: [draw, ...createFillerCards(6)] });

			expect(player.handLimit).toBe(7);
			expect(cardsKeptFromDraw({ board: live(), card: draw, player })).toBe(1);
		});

		test('are none once the hand is at its limit without the card, and one a card below it', () => {
			const draw = createDrawCard(2);
			player.set({ hand: [draw, ...createFillerCards(4)], handLimit: 4 });
			expect(cardsKeptFromDraw({ board: live(), card: draw, player })).toBe(0);

			player.set({ handLimit: 5 });
			expect(cardsKeptFromDraw({ board: live(), card: draw, player })).toBe(1);
		});

		test('are none, never fewer, in a hand over a lowered limit', () => {
			const draw = createDrawCard(2);
			player.set({ hand: [draw, ...createFillerCards(5)], handLimit: 2 });

			expect(cardsKeptFromDraw({ board: live(), card: draw, player })).toBe(0);
		});

		test('are none for a card that draws nothing', () => {
			const [filler] = createFillerCards(1);
			player.set({ hand: [filler] });

			expect(cardsKeptFromDraw({ board: live(), card: filler, player })).toBe(0);
		});

		test('come from the hand on the board, so a plan\'s earlier plays make room', () => {
			const draw = createDrawCard(2);
			const [earlier, ...rest] = createFillerCards(4);
			// Five cards, four once the draw leaves: one under the limit
			raider.set({ hand: [draw, earlier, ...rest], handLimit: 5 });
			const plan = live();
			expect(cardsKeptFromDraw({ board: plan, card: draw, player: raider })).toBe(1);

			plan.apply({ card: earlier, driver: raider, target: null });
			expect(cardsKeptFromDraw({ board: plan, card: draw, player: raider })).toBe(2);
			expect(cardsKeptFromDraw({ board: live(), card: draw, player: raider })).toBe(1);
		});
	});
});
