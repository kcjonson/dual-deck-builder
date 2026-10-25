import cardsFile from '../../data/cards.json';
import { previewAim } from '../../mechanics/AimPreview';
import { Battle } from '../../mechanics/Battle';
import { Card, CardData } from '../../mechanics/Card';
import { Driver, DriverRole } from '../../mechanics/Driver';
import { EscortType, createEscort } from '../../mechanics/Escort';
import { RoadLane, RoadRow, RoadSlot } from '../../mechanics/Road';
import { Team, TeamType } from '../../mechanics/Team';
import { STEADY, Vehicle } from '../../mechanics/Vehicle';
import { createTestDriver } from '../../ai/__tests__/test-helpers';
import { cardHasTargets, cardTargets, hasTargets } from './cardTargets';

/**
 * DDB-554: what a hand card would offer, worked out from the battle's own
 * rules. The hand asks `cardHasTargets` of every card on every deal and
 * `cardTargets` of the one being previewed, so the two have to agree.
 */

const slot = (lane: RoadLane, row: RoadRow): RoadSlot => ({ lane, row });
const { PLAYER_INSIDE, ENEMY_INSIDE, ENEMY_OUTSIDE } = RoadLane;
const { AHEAD, CENTER, BEHIND } = RoadRow;

const ALL_CARDS = (cardsFile as unknown as { cards: CardData[] }).cards;
const realCard = (type: string): Card => {
	const data = ALL_CARDS.find(card => card.type === type);
	if (!data) throw new Error(`No card ${type} in cards.json`);
	return new Card({ ...data });
};

function vehicle(name: string, { at = null, speed = 3, structure = 20, steady = false }: { at?: RoadSlot | null; speed?: number; structure?: number; steady?: boolean } = {}): Vehicle {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 100, maxHitpoints: 100 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure,
		maxStructure: structure,
		baseSpeed: speed,
		slot: at,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: steady ? [{ name: STEADY, duration: 1 }] : [],
	});
}

function driverOf(of: Vehicle): Driver {
	if (!of.driver) throw new Error(`${of.name} has no driver`);
	return of.driver;
}

interface Board {
	battle: Battle;
	rig: Vehicle;
	bike: Vehicle;
	escorts: Vehicle[];
	raiders: Vehicle[];
}

/** The Rig in your inside center and the Bike behind it, escorts after them, against raiders where each is told to start. */
function board({ raiders, escorts = [] }: { raiders: Vehicle[]; escorts?: EscortType[] }): Board {
	const rig = vehicle('Rig');
	const bike = vehicle('Bike');
	const convoy = escorts.map(type => createEscort({ type }));
	const battle = new Battle({
		playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike, ...convoy] }),
		enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: raiders }),
	});
	battle.start();
	return { battle, rig, bike, escorts: convoy, raiders };
}

/** `card` in `driver`'s hand alone, with adrenaline to play it, as the hand deals it. */
function hold(driver: Driver, card: Card): Card {
	driver.set({ hand: [card], adrenaline: 9 });
	return card;
}

describe('cardHasTargets', () => {
	it('agrees with cardTargets for every card in cards.json, for both drivers, on boards near and far', () => {
		const boards = [
			board({ raiders: [vehicle('Near', { at: slot(ENEMY_INSIDE, CENTER), speed: 1 }), vehicle('Far', { at: slot(ENEMY_OUTSIDE, BEHIND) })], escorts: ['outrider', 'pilot_car'] }),
			board({ raiders: [vehicle('Far', { at: slot(ENEMY_OUTSIDE, AHEAD) })] }),
		];
		let checked = 0;
		for (const { battle, rig, bike } of boards) {
			for (const driver of [driverOf(rig), driverOf(bike)]) {
				for (const data of ALL_CARDS) {
					const card = hold(driver, new Card({ ...data }));
					if (!battle.canPlayCard({ driver, card })) continue;
					expect([data.type, cardHasTargets({ battle, driver, card })]).toEqual([data.type, hasTargets(cardTargets({ battle, driver, card }))]);
					checked++;
				}
			}
		}
		expect(checked).toBeGreaterThan(50);
	});

	it('says a Strafe that can swerve, but from no slot that puts a raider in reach, has nothing to land on', () => {
		const { battle, rig } = board({ raiders: [vehicle('Far', { at: slot(ENEMY_OUTSIDE, BEHIND) })] });
		const driver = driverOf(rig);
		const strafe = hold(driver, realCard('strafe'));
		expect(battle.canPlayCard({ driver, card: strafe })).toBe(true);
		expect(battle.moveDestinations({ driver, card: strafe }).length).toBeGreaterThan(0);
		expect(cardHasTargets({ battle, driver, card: strafe })).toBe(false);
		expect(cardTargets({ battle, driver, card: strafe }).slots).toEqual([]);
	});
});

describe('cardTargets links', () => {
	it('draws Rally the Convoy from each ready escort to the raider it would fire on, as the battle picks them', () => {
		const near = vehicle('Near', { at: slot(ENEMY_INSIDE, AHEAD) });
		const far = vehicle('Far', { at: slot(ENEMY_OUTSIDE, BEHIND) });
		const { battle, rig, escorts } = board({ raiders: [near, far], escorts: ['outrider', 'pilot_car'] });
		const driver = driverOf(rig);
		const rally = hold(driver, realCard('rally_the_convoy'));

		const targets = cardTargets({ battle, driver, card: rally });
		expect(targets.links.length).toBeGreaterThan(0);
		expect(targets.picks).toBe(false);
		expect(targets.links.some(link => link.sourceId === rig.id)).toBe(false);
		for (const link of targets.links) expect(escorts.map(escort => escort.id)).toContain(link.sourceId);

		// The battle fires on exactly the raiders the links point at
		const hit = new Set<string>();
		battle.on('hitLanded', ({ vehicle: struck }: { vehicle: Vehicle }) => hit.add(struck.id));
		battle.on('hitMissed', ({ vehicle: struck }: { vehicle: Vehicle }) => hit.add(struck.id));
		expect(battle.playCard({ driver, cardIndex: 0 })).toBe(true);
		expect([...hit].sort()).toEqual([...new Set(targets.links.map(link => link.targetId))].sort());
	});

	it('draws an attack order from the escort that would carry it out', () => {
		const near = vehicle('Near', { at: slot(ENEMY_INSIDE, CENTER) });
		const { battle, rig, escorts } = board({ raiders: [near], escorts: ['outrider'] });
		const driver = driverOf(rig);
		const order = hold(driver, realCard('covering_fire'));

		const carrier = battle.orderCarrier({ card: order, target: near });
		expect(carrier).not.toBeNull();
		expect(cardTargets({ battle, driver, card: order }).links).toEqual([{ sourceId: carrier?.id, targetId: near.id }]);
		expect(escorts.map(escort => escort.id)).toContain(carrier?.id);
	});

	it('draws from the vehicle the playing driver is in: the Bike for its driver, an escort for a passenger', () => {
		const near = vehicle('Near', { at: slot(ENEMY_INSIDE, BEHIND) });
		const { battle, bike, escorts } = board({ raiders: [near], escorts: ['outrider', 'pilot_car'] });
		const bikeDriver = driverOf(bike);
		const shot = hold(bikeDriver, realCard('headshot'));
		expect(cardTargets({ battle, driver: bikeDriver, card: shot }).links.map(link => link.sourceId)).toEqual([bike.id]);

		// The Bike's driver rides on in the Outrider, and orders the Pilot Car from there
		const [outrider, pilotCar] = escorts;
		bike.driver = null;
		outrider.passenger = bikeDriver;
		bikeDriver.role = DriverRole.PASSENGER;
		const closeRanks = hold(bikeDriver, realCard('close_ranks'));
		expect(cardTargets({ battle, driver: bikeDriver, card: closeRanks }).links).toEqual([{ sourceId: outrider.id, targetId: pilotCar.id }]);
	});

	it('draws no arrow from a vehicle to itself, for a card on the driver\'s own vehicle', () => {
		const { battle, rig } = board({ raiders: [vehicle('Near', { at: slot(ENEMY_INSIDE, CENTER) })] });
		const driver = driverOf(rig);
		const targets = cardTargets({ battle, driver, card: hold(driver, realCard('armor_plating')) });
		expect(targets.vehicleIds).toEqual([rig.id]);
		expect(targets.links).toEqual([]);
	});

	it('leaves out a Steady raider for a card that only stuns', () => {
		const steady = vehicle('Steady', { at: slot(ENEMY_INSIDE, CENTER), steady: true });
		const plain = vehicle('Plain', { at: slot(ENEMY_OUTSIDE, CENTER) });
		const { battle, rig } = board({ raiders: [steady, plain] });
		const driver = driverOf(rig);
		const targets = cardTargets({ battle, driver, card: hold(driver, realCard('emp_blast')) });
		expect(targets.vehicleIds).toEqual([plain.id]);
	});
});

describe('cardTargets moves', () => {
	it('fans Fall In out over each escort and each slot it could go to, every one a choice', () => {
		const { battle, rig, escorts } = board({ raiders: [vehicle('Near', { at: slot(ENEMY_INSIDE, CENTER) })], escorts: ['outrider', 'pilot_car'] });
		const driver = driverOf(rig);
		const fallIn = hold(driver, realCard('fall_in'));
		const targets = cardTargets({ battle, driver, card: fallIn });

		const expected = escorts.reduce((total, escort) => total + battle.moveDestinations({ driver, card: fallIn, target: escort }).length, 0);
		expect(expected).toBeGreaterThan(escorts.length);
		expect(targets.moves.length).toBe(expected);
		expect(targets.moves.every(move => move.choice)).toBe(true);
		expect(new Set(targets.moves.map(move => move.vehicleId))).toEqual(new Set(escorts.map(escort => escort.id)));
	});

	it('shows Shoulder Check\'s shove only on a raider the hit leaves on the road', () => {
		const sturdy = vehicle('Sturdy', { at: slot(ENEMY_INSIDE, CENTER) });
		const fragile = vehicle('Fragile', { at: slot(ENEMY_INSIDE, BEHIND), structure: 1 });
		const { battle, rig } = board({ raiders: [sturdy, fragile] });
		const driver = driverOf(rig);
		const check = hold(driver, realCard('shoulder_check'));
		for (const raider of [sturdy, fragile]) {
			expect(previewAim({ battle, driver, card: check, target: raider }).check?.hits).toBe(true);
		}

		const moves = cardTargets({ battle, driver, card: check }).moves;
		expect(moves.some(move => move.vehicleId === sturdy.id)).toBe(true);
		expect(moves.some(move => move.vehicleId === fragile.id)).toBe(false);
	});

	it('draws a flank solid when every raider it could outrun puts it on the same shoulder slot', () => {
		const inside = vehicle('Inside', { at: slot(ENEMY_INSIDE, CENTER), speed: 1 });
		const outside = vehicle('Outside', { at: slot(ENEMY_OUTSIDE, CENTER), speed: 1 });
		const { battle, rig } = board({ raiders: [inside, outside] });
		const driver = driverOf(rig);
		const targets = cardTargets({ battle, driver, card: hold(driver, realCard('flanking_maneuver')) });

		expect(targets.vehicleIds).toHaveLength(2);
		expect(targets.moves).toHaveLength(1);
		expect(targets.moves[0]).toMatchObject({ vehicleId: rig.id, choice: false });
	});

	it('moves a whole formation on a Formation Shift, and nobody for a card without a move', () => {
		const { battle, rig, bike } = board({ raiders: [vehicle('Near', { at: slot(ENEMY_INSIDE, CENTER) })] });
		const driver = driverOf(rig);
		const shift = cardTargets({ battle, driver, card: hold(driver, realCard('formation_shift')) });
		expect(shift.moves.map(move => move.vehicleId).sort()).toEqual([rig.id, bike.id].sort());
		expect(shift.moves.every(move => !move.choice && move.to.lane !== PLAYER_INSIDE)).toBe(true);
		expect(cardTargets({ battle, driver, card: hold(driver, realCard('armor_plating')) }).moves).toEqual([]);
	});
});
