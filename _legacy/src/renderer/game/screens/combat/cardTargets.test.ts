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

/**
 * Whether Shoulder Check from the Rig shows a shove on `raider`, the one
 * raider on the road, in reach in your row; it checks first that the hit
 * lands and does some damage, to the driver too when it has one aboard.
 */
function shoulderCheck(raider: Vehicle): boolean {
	const { battle, rig } = board({ raiders: [raider] });
	const driver = driverOf(rig);
	const card = hold(driver, realCard('shoulder_check'));
	const { check, losses } = previewAim({ battle, driver, card, target: raider });
	expect(check?.hits).toBe(true);
	expect(losses.structure).toBeGreaterThan(0);
	expect(losses.driver).toBeGreaterThan(0);
	const targets = cardTargets({ battle, driver, card });
	expect(targets.vehicleIds).toEqual([raider.id]);
	return targets.moves.some(move => move.vehicleId === raider.id);
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

	it('says a card on every raider has nothing to land on when it would take hold on none (call 370)', () => {
		const { battle, rig } = board({ raiders: [vehicle('Steady', { at: slot(ENEMY_INSIDE, CENTER), steady: true })] });
		const driver = driverOf(rig);
		const emp = hold(driver, realCard('emp_blast'));
		expect(battle.canPlayCard({ driver, card: emp })).toBe(true);
		expect(cardHasTargets({ battle, driver, card: emp })).toBe(false);
		expect(hasTargets(cardTargets({ battle, driver, card: emp }))).toBe(false);
	});

	it('says Rally the Convoy has nothing to land on when no ready escort has a raider in range (call 370)', () => {
		const { battle, rig, escorts } = board({ raiders: [vehicle('Far', { at: slot(ENEMY_OUTSIDE, BEHIND) })], escorts: ['outrider'] });
		const driver = driverOf(rig);
		const rally = hold(driver, realCard('rally_the_convoy'));
		escorts[0].slot = slot(RoadLane.PLAYER_OUTSIDE, AHEAD);
		expect(battle.canPlayCard({ driver, card: rally })).toBe(true);
		expect(cardHasTargets({ battle, driver, card: rally })).toBe(false);
		expect(hasTargets(cardTargets({ battle, driver, card: rally }))).toBe(false);
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

	it("draws Rally the Convoy's later escorts past a raider an earlier one takes out, as the battle picks again", () => {
		// Both escorts are nearest the Fragile raider, which the first one's shot wrecks
		const fragile = vehicle('Fragile', { at: slot(ENEMY_INSIDE, AHEAD), structure: 1 });
		const other = vehicle('Other', { at: slot(ENEMY_INSIDE, BEHIND) });
		const { battle, rig, bike, escorts } = board({ raiders: [fragile, other], escorts: ['outrider', 'pilot_car'] });
		const [outrider, pilotCar] = escorts;
		rig.slot = slot(RoadLane.PLAYER_OUTSIDE, CENTER);
		bike.slot = slot(RoadLane.PLAYER_OUTSIDE, BEHIND);
		outrider.slot = slot(PLAYER_INSIDE, AHEAD);
		pilotCar.slot = slot(PLAYER_INSIDE, CENTER);
		const driver = driverOf(rig);
		const rally = hold(driver, realCard('rally_the_convoy'));

		expect(cardTargets({ battle, driver, card: rally }).links).toEqual([
			{ sourceId: outrider.id, targetId: fragile.id },
			{ sourceId: pilotCar.id, targetId: other.id },
		]);
		const shots: string[] = [];
		for (const event of ['hitLanded', 'hitMissed']) battle.on(event, ({ vehicle: struck }: { vehicle: Vehicle }) => shots.push(struck.id));
		expect(battle.playCard({ driver, cardIndex: 0 })).toBe(true);
		expect(shots).toEqual([fragile.id, other.id]);
		expect(fragile.isOutOfFight).toBe(true);
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

	it("shows Shoulder Check's shove only on a raider the hit leaves on the road", () => {
		expect(shoulderCheck(vehicle('Sturdy', { at: slot(ENEMY_INSIDE, CENTER) }))).toBe(true);
		expect(shoulderCheck(vehicle('Fragile', { at: slot(ENEMY_INSIDE, CENTER), structure: 1 }))).toBe(false);
	});

	it('shows the shove on a raider whose driver the hit kills only when someone aboard takes the wheel', () => {
		const lone = vehicle('Lone', { at: slot(ENEMY_INSIDE, CENTER) });
		driverOf(lone).set({ hitpoints: 1 });
		expect(shoulderCheck(lone)).toBe(false);

		const crewed = vehicle('Crewed', { at: slot(ENEMY_INSIDE, CENTER) });
		driverOf(crewed).set({ hitpoints: 1 });
		const rider = createTestDriver('Rider');
		rider.set({ hitpoints: 100, maxHitpoints: 100 });
		rider.role = DriverRole.PASSENGER;
		crewed.passenger = rider;
		expect(shoulderCheck(crewed)).toBe(true);
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
