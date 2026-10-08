import { SalvageAI, SalvageAIStrategy } from '../SalvageAI';
import { AIDecision } from '../types';
import { Battle } from '../../mechanics/Battle';
import { BoardProjection } from '../../mechanics/BoardProjection';
import { Card, CardData } from '../../mechanics/Card';
import { Driver } from '../../mechanics/Driver';
import { Team, TeamType } from '../../mechanics/Team';
import { Vehicle } from '../../mechanics/Vehicle';
import { createDrawCard, createFillerCards, createTestDriver, createTestVehicle, withoutDraws } from './test-helpers';
import cardsFile from '../../data/cards.json';

const realCard = (type: string): Card => {
	const data = (cardsFile as unknown as { cards: CardData[] }).cards.find(candidate => candidate.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data, upgraded: false });
};

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

const play = (card: Card, driver: Driver): AIDecision => ({ type: 'playCard', card, driver });

/**
 * Reads the strategy's score for one play against the live board
 */
class ScoringSalvageAI extends SalvageAI {
	private readonly scorer: SalvageAIStrategy;

	constructor(team: Team, battle: Battle) {
		super(team, battle);
		this.scorer = new SalvageAIStrategy(team);
	}

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

	describe('values a draw by the share of its cards that fit under the drawer\'s hand limit', () => {
		// The flat value of a draw for a side holding more cards than the other
		const WHOLE_DRAW = 80;

		test('none of it at the limit, half a card under it, and all of it with room', () => {
			const raider = driverOf(enemyTeam.vehicles[0]);
			const nitro = realCard('nitro_boost');
			const control = withoutDraws(nitro);
			// Five cards, four once Nitro Boost has left the hand
			raider.set({ hand: [nitro, control, ...createFillerCards({ count: 3 })] });
			const ai = new ScoringSalvageAI(enemyTeam, battle);
			const drawWorth = (handLimit: number): number => {
				raider.set({ handLimit });
				return ai.score(play(nitro, raider)) - ai.score(play(control, raider));
			};

			expect(drawWorth(7)).toBeCloseTo(WHOLE_DRAW);
			expect(drawWorth(5)).toBeCloseTo(WHOLE_DRAW / 2);
			expect(drawWorth(4)).toBeCloseTo(0);
		});

		test('plays something useful over a draw it would burn', async () => {
			const raiderVehicle = enemyTeam.vehicles[0];
			const raider = driverOf(raiderVehicle);
			const draw = createDrawCard(2);
			const plating = realCard('armor_plating');
			raiderVehicle.set({ armor: 0 });
			// Four cards, three once the draw has left the hand
			raider.set({ hand: [draw, plating, ...createFillerCards({ count: 2 })] });
			const ai = new SalvageAI(enemyTeam, battle);

			expect((await ai.makeDecision())?.card).toBe(draw);

			raider.set({ handLimit: 3 });
			expect((await ai.makeDecision())?.card).toBe(plating);
		});

		test('counts a draw against its player\'s hand, not their partner\'s', () => {
			const [driver, partner] = playerTeam.vehicles.map(driverOf);
			const nitro = realCard('nitro_boost');
			const control = withoutDraws(nitro);
			driver.set({ hand: [nitro, control, ...createFillerCards({ count: 3 })] });
			const ai = new ScoringSalvageAI(playerTeam, battle);
			const drawWorth = (): number => ai.score(play(nitro, driver)) - ai.score(play(control, driver));

			partner.set({ hand: createFillerCards({ count: 7 }) });
			expect(drawWorth()).toBeCloseTo(WHOLE_DRAW);

			partner.set({ hand: [] });
			driver.set({ handLimit: 4 });
			expect(drawWorth()).toBeCloseTo(0);
		});
	});
});
