import { IntentAwareAI } from './IntentAwareAI';
import { AggressiveFlankerAI } from './AggressiveFlankerAI';
import { MCTSAI } from './MCTSAI';
import { AIDecision } from './types';
import { createTestDriver, driverOf, realCard } from './__tests__/test-helpers';
import { Battle } from '../mechanics/Battle';
import { BoardProjection } from '../mechanics/BoardProjection';
import { Card, CardEffect, TargetType } from '../mechanics/Card';
import { RoadLane, RoadRow, RoadSlot } from '../mechanics/Road';
import { Team } from '../mechanics/Team';
import { TeamType } from '../mechanics/TeamType';
import { Vehicle } from '../mechanics/Vehicle';
import cardsFile from '../data/cards.json';

/**
 * DDB-553: the player stand-ins score a slot by what it puts in range and
 * takes out of range, planned raider intents that would fizzle included,
 * and read row bonuses, landing conditions, and Evade the way play does.
 */

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });
const { PLAYER_SHOULDER, PLAYER_OUTSIDE, PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE } = RoadLane;
const { AHEAD, CENTER, BEHIND } = RoadRow;

// Total speed is baseSpeed plus the test driver's speed skill of 2; every
// skill is 5, so a raider's shot needs gunnery 6 to hit the Rig unless it
// always hits
const vehicle = ({ name, baseSpeed = 1, structure = 20, at = null, evade = 5, gunnery = 5 }: {
	name: string;
	baseSpeed?: number;
	structure?: number;
	at?: RoadSlot | null;
	evade?: number;
	gunnery?: number;
}): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100, skills: { ramming: 5, gunnery, evade, speed: 2 } });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure,
		maxStructure: 20,
		baseSpeed,
		slot: at,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
};

const card = (name: string, targetType: TargetType, effects: CardEffect[], cost = 1): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost,
	targetType,
	effects,
	tags: []
});

/** A raider's planned shot */
const shot = ({ range, damage = 12, rolls = false }: { range: number; damage?: number; rolls?: boolean }): Card =>
	card(`Range ${range} Shot`, 'enemy_single', [{ type: 'damage', value: damage, range, ...(rolls ? {} : { always_hits: true }) }]);
const pointBlank = (): Card => card('Point Blank', 'enemy_single', [{ type: 'damage', value: 3, range: 1, always_hits: true }]);
const jab = (): Card => card('Jab', 'enemy_single', [{ type: 'damage', value: 2, range: 2, always_hits: true }]);
const armorUp = (): Card => card('Armor Up', 'self', [{ type: 'gain_armor', value: 8, target: 'self' }]);
// Juke and Strafe are in movement-cards.md's table and land with DDB-551; these stand-ins have their shapes
const juke = (): Card => card('Juke', 'self', [
	{ type: 'change_position', position: 'swerve', to: 'pick', target: 'self' },
	{ type: 'draw_cards', value: 1, target: 'self' }
]);
const strafe = (): Card => card('Strafe', 'enemy_single', [
	{ type: 'change_position', position: 'swerve', to: 'pick', target: 'self' },
	{ type: 'damage', value: 4, range: 1, target: 'target' }
], 2);

const giveHand = (of: Vehicle, cards: Card[]): void => {
	driverOf(of).set({ hand: cards, adrenaline: 5 });
};

const named = (decision: AIDecision | null): [string | undefined, string | undefined] =>
	[decision?.card?.name, decision?.target instanceof Vehicle ? decision.target.name : undefined];

describe('movement scoring', () => {
	let rig: Vehicle;
	let battle: Battle;

	const fight = (raiders: Vehicle[], players: Vehicle[] = [rig]): Battle => {
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: players }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders })
		});
		return battle;
	};
	/** Each raider plans its hand: the first card it can play, each time */
	const plan = (hands: [Vehicle, Card[]][]): void => {
		for (const [raider, hand] of hands) giveHand(raider, hand);
		battle.planEnemyTurn();
	};
	const intent = (): AIDecision | null => new IntentAwareAI(battle.playerTeam, battle).makeDecision();
	const aggressive = (): AIDecision | null => new AggressiveFlankerAI(battle.playerTeam, battle).makeDecision();

	beforeEach(() => {
		// Drivers log every draw, and the AIs think aloud
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		rig = vehicle({ name: 'Rig' });
	});

	afterEach(() => {
		jest.restoreAllMocks();
	});

	describe('a slot is worth what it takes out of range', () => {
		// The Buggy is ahead in the raiders' inside lane with a Range 2 shot
		// at the Rig, inside center: Floor It keeps the Rig in its range, and
		// Lane Change takes it out, so the shot fizzles
		let buggy: Vehicle;
		beforeEach(() => {
			buggy = vehicle({ name: 'Buggy', baseSpeed: 10, at: slot(ENEMY_INSIDE, AHEAD) });
			fight([buggy]);
			plan([[buggy, [shot({ range: 2 })]]]);
			expect(battle.getIntents(buggy)).toHaveLength(1);
		});

		test('a swerve that makes a planned hit fizzle beats one that doesn\'t, where the floor can\'t tell', () => {
			giveHand(rig, [realCard('floor_it'), realCard('lane_change')]);

			expect(named(intent())).toEqual(['Lane Change', undefined]);
			// The aggressive AI never reads intents: Lane Change opens nothing for it, and Floor It has its speed
			expect(named(aggressive())).toEqual(['Floor It', undefined]);
		});

		test('a picked swerve goes to a slot the shot can\'t reach', () => {
			giveHand(rig, [juke()]);

			const decision = intent();
			expect(decision?.card?.name).toBe('Juke');
			expect([slot(PLAYER_OUTSIDE, CENTER), slot(PLAYER_INSIDE, BEHIND)]).toContainEqual(decision?.destination);
		});

		test('Cut Off\'s swerve counts for the shot it leaves behind', () => {
			// Cut Off swerves the Rig ahead, out of a Range 1 shot from inside
			// center, and slows the raider ahead it then reaches
			const shooter = vehicle({ name: 'Shooter', baseSpeed: 10, at: slot(ENEMY_INSIDE, CENTER) });
			fight([shooter, buggy]);
			plan([[shooter, [shot({ range: 1 })]], [buggy, []]]);
			giveHand(rig, [realCard('cut_off'), armorUp()]);

			expect(named(intent())).toEqual(['Cut Off', 'Buggy']);
		});
	});

	describe('a slot is worth what it puts in range', () => {
		test('a swerve into range of the only target beats staying out of it', () => {
			// From the outside lane the Buggy, inside center, is 2 away; Lane
			// Change brings Point Blank's Range 1 to it, and Hard Brake doesn't
			const buggy = vehicle({ name: 'Buggy', baseSpeed: 10, at: slot(ENEMY_INSIDE, CENTER) });
			fight([buggy]);
			rig.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			plan([[buggy, []]]);
			giveHand(rig, [realCard('hard_brake'), realCard('lane_change'), pointBlank()]);

			expect(named(intent())).toEqual(['Lane Change', undefined]);
			expect(named(aggressive())).toEqual(['Lane Change', undefined]);
		});

		test('Point Man counts its bonus from the ahead row, and kills where a bigger plain shot wouldn\'t', () => {
			// 2 structure with a driver aboard wrecks at 3: Point Man's 4 from
			// the ahead row does it, the Jab's 2 doesn't
			const buggy = vehicle({ name: 'Buggy', baseSpeed: 10, structure: 2, evade: 3, at: slot(ENEMY_INSIDE, AHEAD) });
			fight([buggy]);
			rig.set({ slot: slot(PLAYER_INSIDE, AHEAD) });
			plan([[buggy, [shot({ range: 2 })]]]);
			giveHand(rig, [jab(), realCard('point_man')]);

			expect(named(intent())).toEqual(['Point Man', 'Buggy']);
			expect(named(aggressive())).toEqual(['Point Man', 'Buggy']);
		});
	});

	describe('a move that does nothing scores under passing', () => {
		let buggy: Vehicle;
		beforeEach(() => {
			buggy = vehicle({ name: 'Buggy', baseSpeed: 10, at: slot(ENEMY_INSIDE, CENTER) });
			fight([buggy]);
		});

		test('a swerve that opens nothing and dodges nothing is never played', () => {
			plan([[buggy, []]]);
			giveHand(rig, [realCard('lane_change')]);

			expect(intent()).toEqual({ type: 'endTurn' });
			expect(aggressive()).toEqual({ type: 'endTurn' });
		});

		test('a shove with nothing to make fizzle waits, and one that blanks a planned hit is played by the stand-in that reads intents', () => {
			plan([[buggy, []]]);
			giveHand(rig, [realCard('lay_on_the_horn')]);
			expect(intent()).toEqual({ type: 'endTurn' });
			expect(aggressive()).toEqual({ type: 'endTurn' });

			// Shoved to its outside lane, the Buggy is 2 from the Rig and its Range 1 shot fizzles
			plan([[buggy, [shot({ range: 1 })]]]);
			giveHand(rig, [realCard('lay_on_the_horn')]);
			expect(named(intent())).toEqual(['Lay on the Horn', 'Buggy']);
			expect(aggressive()).toEqual({ type: 'endTurn' });
		});

		test('won\'t swerve back into a planned hit for a smaller shot of its own', () => {
			// The shot was planned at the Rig inside center; out in its outside
			// lane it fizzles, and Lane Change would bring it back for Point Blank's 3
			plan([[buggy, [shot({ range: 1 })]]]);
			rig.set({ slot: slot(PLAYER_OUTSIDE, CENTER) });
			expect(battle.getIntents(buggy)).toEqual([]);
			giveHand(rig, [realCard('lane_change'), pointBlank()]);

			expect(intent()).toEqual({ type: 'endTurn' });
			expect(named(aggressive())).toEqual(['Lane Change', undefined]);
		});
	});

	describe('Evade is protection', () => {
		test('Weave that makes a planned shot miss beats armor that only soaks it', () => {
			// Gunnery 6 beats the Rig's evade 5, and Weave's +1 makes it 6
			const buggy = vehicle({ name: 'Buggy', baseSpeed: 10, gunnery: 6, at: slot(ENEMY_INSIDE, CENTER) });
			fight([buggy]);
			plan([[buggy, [shot({ range: 1, rolls: true })]]]);
			giveHand(rig, [armorUp(), realCard('weave')]);

			expect(named(intent())).toEqual(['Weave', undefined]);
			expect(named(aggressive())).toEqual(['Armor Up', undefined]);
		});

		test('Weave counts its +2 after a swerve', () => {
			// Gunnery 7 needs evade 7 to miss: Weave's +1 isn't enough, its +2 after Lane Change is
			const buggy = vehicle({ name: 'Buggy', baseSpeed: 10, gunnery: 7, at: slot(ENEMY_INSIDE, CENTER) });
			fight([buggy]);
			plan([[buggy, [shot({ range: 2, rolls: true })]]]);
			giveHand(rig, [armorUp(), realCard('weave')]);
			expect(named(intent())).toEqual(['Armor Up', undefined]);

			giveHand(rig, [realCard('lane_change'), armorUp(), realCard('weave')]);
			expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0 })).toBe(true);
			expect(named(intent())).toEqual(['Weave', undefined]);
		});
	});

	describe('landing conditions', () => {
		const brakeCheckOn = (flank: { reservedSlot: RoadSlot | null; outran: Vehicle | null }): Vehicle => {
			// Faster than the Rig, so it holds the shoulder; a planned Range 2
			// shot from there, 2 from the Rig, is 18 with the flank bonus
			const buggy = vehicle({ name: 'Buggy', baseSpeed: 5, structure: 2, at: slot(PLAYER_SHOULDER, CENTER) });
			fight([buggy]);
			buggy.set({ flank: { reservedSlot: flank.reservedSlot, outran: flank.outran ?? null } });
			plan([[buggy, [shot({ range: 2 })]]]);
			expect(battle.getIntents(buggy)[0]).toMatchObject({ amount: 18 });
			giveHand(rig, [armorUp(), realCard('brake_check')]);
			return buggy;
		};

		test('Brake Check\'s 4 lands only on an ambusher, so it kills one and only drops a flanker with a slot back', () => {
			brakeCheckOn({ reservedSlot: null, outran: null });
			expect(named(intent())).toEqual(['Brake Check', 'Buggy']);

			// Dropped back to the raiders' inside lane, its shot still reaches
			// the Rig without the flank bonus, 12: the 6 that saves is less
			// than the armor's 8
			brakeCheckOn({ reservedSlot: slot(ENEMY_INSIDE, CENTER), outran: rig });
			expect(named(intent())).toEqual(['Armor Up', undefined]);
		});

		test('MCTS scores Brake Check\'s damage only on an ambusher, and Box In\'s Vulnerable only with both driven vehicles in reach', () => {
			const score = (effect: CardEffect, of: Card, target: Vehicle): number => {
				const mcts = new MCTSAI({ team: battle.playerTeam, battle, iterations: 1 });
				mcts['board'] = new BoardProjection({ battle });
				return mcts['evaluateEffectWithContext']({ effect, card: of, target, ourVehicle: rig, actor: rig, destination: null });
			};
			const brakeCheck = realCard('brake_check');
			const damage = brakeCheck.effects[1];
			const buggy = brakeCheckOn({ reservedSlot: slot(ENEMY_INSIDE, CENTER), outran: rig });
			expect(score(damage, brakeCheck, buggy)).toBe(0);
			buggy.set({ flank: { reservedSlot: null, outran: null } });
			expect(score(damage, brakeCheck, buggy)).toBeGreaterThan(0);

			// Rig inside center and Bike inside behind are 1 and 2 from the Buggy, inside center
			const boxIn = realCard('box_in');
			const vulnerable = boxIn.effects[1];
			const bike = vehicle({ name: 'Bike', baseSpeed: 6 });
			const boxed = vehicle({ name: 'Buggy', baseSpeed: 10, at: slot(ENEMY_INSIDE, CENTER) });
			fight([boxed], [rig, bike]);
			expect(score(vulnerable, boxIn, boxed)).toBeGreaterThan(0);
			bike.set({ slot: slot(PLAYER_OUTSIDE, AHEAD) });
			expect(score(vulnerable, boxIn, boxed)).toBe(0);
		});
	});

	describe('slot-pick cards', () => {
		const CARDS = (cardsFile as { cards: { type: string; effects: { type: string }[] }[] }).cards
			.filter(data => data.effects.some(effect => effect.type === 'change_position') || ['weave', 'point_man', 'tail_gunner', 'box_in'].includes(data.type))
			.map(data => data.type);

		test.each(['intent', 'aggressive'] as const)('the %s stand-in plays every movement card it picks with the slot it needs, and the battle takes each one', async (playerAI) => {
			const error = jest.spyOn(console, 'error');
			const playCard = jest.spyOn(Battle.prototype, 'playCard');
			for (const hand of [...CARDS.map(type => [realCard(type)]), [juke()], [strafe()], [juke(), strafe(), pointBlank()]]) {
				rig = vehicle({ name: 'Rig' });
				const bike = vehicle({ name: 'Bike', baseSpeed: 6, at: slot(PLAYER_OUTSIDE, CENTER) });
				const buggy = vehicle({ name: 'Buggy', baseSpeed: 3, at: slot(ENEMY_OUTSIDE, CENTER) });
				const flanker = vehicle({ name: 'Flanker', baseSpeed: 10, at: slot(PLAYER_SHOULDER, CENTER) });
				fight([buggy, flanker], [rig, bike]);
				flanker.set({ flank: { reservedSlot: slot(ENEMY_INSIDE, AHEAD), outran: rig } });
				plan([[buggy, [shot({ range: 2 })]], [flanker, [shot({ range: 2 })]]]);
				giveHand(rig, hand);
				battle.aiController.setPlayerAI(playerAI);
				await battle.aiController.playPlayerCards();
			}
			expect(error).not.toHaveBeenCalled();
			expect(playCard.mock.results.filter(({ value }) => value === false)).toHaveLength(0);
			// Juke and Strafe were played, each with its slot
			const picked = playCard.mock.calls.map(([play]) => play).filter(play => play.destination !== undefined);
			expect(picked.length).toBeGreaterThan(0);
		});
	});
});
