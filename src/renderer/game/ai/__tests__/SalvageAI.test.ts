import { SalvageAI, SalvageAIStrategy } from '../SalvageAI';
import { AIDecision } from '../types';
import { Battle } from '../../mechanics/Battle';
import { BoardProjection } from '../../mechanics/BoardProjection';
import { Card } from '../../mechanics/Card';
import { Team, TeamType } from '../../mechanics/Team';
import {
	createBlankCard,
	createDrawCard,
	createFillerCards,
	createTestDriver,
	createTestVehicle,
	driverOf,
	play,
	realCard
} from './test-helpers';

/**
 * Reads the strategy's score for one play against the live board
 */
class ScoringSalvageAI extends SalvageAI {
	private readonly scorer = new SalvageAIStrategy(this.team);

	public score(action: AIDecision): number {
		this.board = new BoardProjection({ battle: this.battle });
		return this.scorer.scoreAction(action, this.evaluateGameState());
	}
}

describe('SalvageAI', () => {
	let battle: Battle;
	let playerTeam: Team;
	let enemyTeam: Team;

	beforeEach(() => {
		// Two a side, so neither side is ahead on structure
		const team = (type: TeamType, side: string): Team => new Team({
			type,
			vehicles: [1, 2].map(seat => createTestVehicle(`${side} Vehicle ${seat}`, createTestDriver(`${side} Driver ${seat}`)))
		});
		playerTeam = team(TeamType.PLAYER, 'Player');
		enemyTeam = team(TeamType.ENEMY, 'Enemy');
		battle = new Battle({ playerTeam, enemyTeam });
	});

	describe('values a draw by the cards that fit under the drawer\'s hand limit', () => {
		test('worth nothing at the limit, a draw of one a card under it, and twice that with room', () => {
			const raider = driverOf(enemyTeam.vehicles[0]);
			const [drawTwo, drawOne, blank] = [createDrawCard(2), createDrawCard(1), createBlankCard()];
			// Five cards, four once a draw has left the hand
			raider.set({ hand: [drawTwo, drawOne, blank, ...createFillerCards(2)] });
			const ai = new ScoringSalvageAI(enemyTeam, battle);
			const worth = (card: Card, handLimit: number): number => {
				raider.set({ handLimit });
				return ai.score(play(card, raider)) - ai.score(play(blank, raider));
			};
			const oneCard = worth(drawOne, 7);
			expect(oneCard).toBeGreaterThan(0);

			expect(worth(drawTwo, 4)).toBeCloseTo(0);
			expect(worth(drawTwo, 5)).toBeCloseTo(oneCard);
			expect(worth(drawTwo, 7)).toBeCloseTo(2 * oneCard);
		});

		test('values no more than two cards of a bigger draw', () => {
			const raider = driverOf(enemyTeam.vehicles[0]);
			const [drawThree, drawTwo] = [createDrawCard(3), createDrawCard(2)];
			raider.set({ hand: [drawThree, drawTwo] });
			const ai = new ScoringSalvageAI(enemyTeam, battle);

			expect(ai.score(play(drawThree, raider))).toBeCloseTo(ai.score(play(drawTwo, raider)));
		});

		test('picks the draw that keeps more, not the one that burns less', async () => {
			const raider = driverOf(enemyTeam.vehicles[0]);
			const [drawOne, drawThree] = [createDrawCard(1), createDrawCard(3)];
			// Four cards, three once either draw has left the hand: two under the limit
			raider.set({ hand: [drawOne, drawThree, ...createFillerCards(2)], handLimit: 5 });

			expect((await new SalvageAI(enemyTeam, battle).makeDecision())?.card).toBe(drawThree);
		});

		test('plays something useful over a draw it would burn', async () => {
			const raiderVehicle = enemyTeam.vehicles[0];
			const raider = driverOf(raiderVehicle);
			const draw = createDrawCard(2);
			const plating = realCard('armor_plating');
			raiderVehicle.set({ armor: 0 });
			// Four cards, three once the draw has left the hand
			raider.set({ hand: [draw, plating, ...createFillerCards(2)] });
			const ai = new SalvageAI(enemyTeam, battle);

			expect((await ai.makeDecision())?.card).toBe(draw);

			raider.set({ handLimit: 3 });
			expect((await ai.makeDecision())?.card).toBe(plating);
		});

		test('counts a draw against its player\'s hand, not their partner\'s', () => {
			const [driver, partner] = playerTeam.vehicles.map(driverOf);
			const [draw, blank] = [createDrawCard(2), createBlankCard()];
			driver.set({ hand: [draw, blank, ...createFillerCards(3)] });
			const ai = new ScoringSalvageAI(playerTeam, battle);
			const worth = (): number => ai.score(play(draw, driver)) - ai.score(play(blank, driver));
			const withRoom = worth();
			expect(withRoom).toBeGreaterThan(0);

			partner.set({ hand: createFillerCards(7) });
			expect(worth()).toBeCloseTo(withRoom);

			partner.set({ hand: [] });
			driver.set({ handLimit: 4 });
			expect(worth()).toBeCloseTo(0);
		});
	});
});
