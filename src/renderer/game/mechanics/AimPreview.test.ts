import { Battle } from './Battle';
import { Card, CardEffect } from './Card';
import { Driver } from './Driver';
import { RoadLane, RoadRow } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { LONGEST_REACH, previewAim, previewDestination } from './AimPreview';
import { createEscort } from './Escort';
import { createTestDriver } from '../ai/__tests__/test-helpers';
import { cutOff, fallIn, juke, shoulderCheck, strafe } from '../screens/combat/__fixtures__/movementCards';

/**
 * DDB-138: what the targeting state shows for a card aimed at a vehicle,
 * read from the same rules play resolves it with.
 */

const createVehicle = (name: string): Vehicle => {
	const driver = createTestDriver(`${name} Driver`);
	driver.set({ hitpoints: 30, maxHitpoints: 30 });
	return new Vehicle({
		name,
		armor: 0,
		maxArmor: 0,
		structure: 20,
		maxStructure: 20,
		baseSpeed: 2,
		slot: null,
		flank: null,
		velocity: 0,
		driver,
		passenger: null,
		statusEffects: []
	});
};

const attack = (name: string, effects: CardEffect[]): Card => new Card({
	type: name.toLowerCase().replace(/ /g, '_'),
	name,
	summary: name,
	description: name,
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects,
	tags: ['attack']
});

const driverOf = (vehicle: Vehicle): Driver => {
	if (!vehicle.driver) throw new Error(`${vehicle.name} has no driver`);
	return vehicle.driver;
};

describe('previewAim', () => {
	// Rig in your inside center, Bike inside behind; Buggy in their inside
	// center, Hauler inside behind
	let rig: Vehicle;
	let bike: Vehicle;
	let buggy: Vehicle;
	let hauler: Vehicle;
	let battle: Battle;

	beforeEach(() => {
		rig = createVehicle('Rig');
		bike = createVehicle('Bike');
		buggy = createVehicle('Buggy');
		hauler = createVehicle('Hauler');
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy, hauler] })
		});
	});

	test('reads the range from the caster\'s slot, lanes apart plus rows apart, beside the card\'s reach', () => {
		const shot = attack('Point Blank', [{ type: 'damage', value: 3, range: 1, always_hits: true }]);
		const near = previewAim({ battle, driver: driverOf(rig), card: shot, target: buggy });
		expect(near.actor).toBe(rig);
		expect(near.range).toBe(1);
		expect(near.reach).toBe(1);

		const far = previewAim({ battle, driver: driverOf(rig), card: shot, target: hauler });
		expect(far.range).toBe(2);
		// Past the card's reach, so nothing would land
		expect(far.losses).toEqual({ structure: 0, driver: 0, passenger: 0 });
	});

	test('splits a vehicle hit past shield and armor half to structure and half to the driver, as play does', () => {
		buggy.set({ shield: 2, armor: 4, maxArmor: 4 });
		const shot = attack('Big Shot', [{ type: 'damage', value: 14, always_hits: true }]);
		const preview = previewAim({ battle, driver: driverOf(rig), card: shot, target: buggy });
		expect(preview.check).toBeNull();
		expect(preview.losses).toEqual({ structure: 4, driver: 4, passenger: 0 });

		const before = { structure: buggy.structure, driver: driverOf(buggy).hitpoints };
		driverOf(rig).set({ hand: [shot], adrenaline: 5 });
		expect(battle.playCard({ driver: driverOf(rig), cardIndex: 0, targetVehicle: buggy })).toBe(true);
		expect(before.structure - buggy.structure).toBe(preview.losses.structure);
		expect(before.driver - driverOf(buggy).hitpoints).toBe(preview.losses.driver);
	});

	test('puts a driver-only hit on the driver\'s bar alone', () => {
		const headshot = attack('Headshot', [{ type: 'damage', value: 10, target: 'driver', always_hits: true }]);
		const preview = previewAim({ battle, driver: driverOf(rig), card: headshot, target: buggy });
		expect(preview.losses).toEqual({ structure: 0, driver: 10, passenger: 0 });
	});

	test('shows the hit check as gunnery against evade plus the card\'s modifier, and a miss takes nothing', () => {
		driverOf(rig).set({ skills: { ...driverOf(rig).skills, gunnery: 7 } });
		driverOf(buggy).set({ skills: { ...driverOf(buggy).skills, evade: 4 } });
		const aimed = attack('Aimed Shot', [{ type: 'damage', value: 6, hit_modifier: 2 }]);
		const hit = previewAim({ battle, driver: driverOf(rig), card: aimed, target: buggy });
		expect(hit.check).toEqual({ skill: 'gunnery', attack: 7, evade: 4, modifier: 2, hits: true });
		expect(hit.losses.structure).toBe(3);

		const harder = attack('Long Shot', [{ type: 'damage', value: 6, hit_modifier: 3 }]);
		const miss = previewAim({ battle, driver: driverOf(rig), card: harder, target: buggy });
		expect(miss.check).toEqual({ skill: 'gunnery', attack: 7, evade: 4, modifier: 3, hits: false });
		expect(miss.losses).toEqual({ structure: 0, driver: 0, passenger: 0 });
	});

	test('checks a ram as ramming against evade', () => {
		driverOf(rig).set({ skills: { ...driverOf(rig).skills, ramming: 4 } });
		driverOf(buggy).set({ skills: { ...driverOf(buggy).skills, evade: 4 } });
		const ram = attack('Ram', [{ type: 'damage', value: 4, attack_type: 'ramming', range: 1 }]);
		const preview = previewAim({ battle, driver: driverOf(rig), card: ram, target: buggy });
		expect(preview.check).toEqual({ skill: 'ramming', attack: 4, evade: 4, modifier: 0, hits: true });
	});

	test('adds the flank bonus when the caster is flanking', () => {
		const shot = attack('Shot', [{ type: 'damage', value: 10, always_hits: true }]);
		const level = previewAim({ battle, driver: driverOf(rig), card: shot, target: buggy });
		rig.set({ slot: { lane: RoadLane.ENEMY_SHOULDER, row: RoadRow.CENTER } });
		expect(rig.isFlanking).toBe(true);
		const flanking = previewAim({ battle, driver: driverOf(rig), card: shot, target: buggy });
		expect(level.losses.structure).toBe(5);
		expect(flanking.losses.structure).toBe(8);
	});

	describe('a card that moves before it reaches (DDB-548)', () => {
		const ahead = { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.AHEAD };
		const outside = { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.CENTER };

		test('reads Strafe\'s range from the slot it picks, and its damage only lands from there', () => {
			buggy.set({ slot: { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.AHEAD } });
			const card = strafe();
			// Two from where the Rig is; one from inside ahead, three from outside center
			const fromAhead = previewAim({ battle, driver: driverOf(rig), card, target: buggy, destination: ahead });
			expect(fromAhead.range).toBe(1);
			expect(fromAhead.losses.structure).toBeGreaterThan(0);
			const fromOutside = previewAim({ battle, driver: driverOf(rig), card, target: buggy, destination: outside });
			expect(fromOutside.range).toBe(3);
			expect(fromOutside.losses).toEqual({ structure: 0, driver: 0, passenger: 0 });
			// Before a slot is picked, the nearest it could pick, as the target rule has it
			expect(previewAim({ battle, driver: driverOf(rig), card, target: buggy }).range).toBe(1);
		});

		test('reads Cut Off\'s range from the row ahead it swerves into', () => {
			buggy.set({ slot: { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.AHEAD } });
			expect(previewAim({ battle, driver: driverOf(rig), card: cutOff(), target: buggy }).range).toBe(1);
		});
	});
});

describe('previewDestination (DDB-548)', () => {
	// Rig inside center, Bike inside behind, an Outrider placed after them;
	// Buggy across from the Rig, Hauler behind it
	let rig: Vehicle;
	let bike: Vehicle;
	let outrider: Vehicle;
	let buggy: Vehicle;
	let hauler: Vehicle;
	let battle: Battle;

	beforeEach(() => {
		rig = createVehicle('Rig');
		bike = createVehicle('Bike');
		outrider = createEscort({ type: 'outrider' });
		buggy = createVehicle('Buggy');
		hauler = createVehicle('Hauler');
		battle = new Battle({
			playerTeam: new Team({ type: TeamType.PLAYER, vehicles: [rig, bike, outrider] }),
			enemyTeam: new Team({ type: TeamType.ENEMY, vehicles: [buggy, hauler] })
		});
	});

	test('reads a swerve of yours from where it lands, against Range 2 for a card with no range', () => {
		const destination = { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.CENTER };
		const preview = previewDestination({ battle, driver: driverOf(rig), card: juke(), destination });
		expect(preview?.from).toEqual(destination);
		expect(preview?.ranges.get(buggy)).toBe(2);
		expect(preview?.ranges.get(hauler)).toBe(3);
		expect(preview?.reach).toBe(LONGEST_REACH);
	});

	test('reads against the card\'s own range when it has one', () => {
		const destination = { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.AHEAD };
		expect(previewDestination({ battle, driver: driverOf(rig), card: strafe(), destination })?.reach).toBe(1);
	});

	test('reads Fall In from the slot its escort lands in', () => {
		const destination = { lane: RoadLane.PLAYER_INSIDE, row: RoadRow.AHEAD };
		const preview = previewDestination({ battle, driver: driverOf(rig), card: fallIn(), target: outrider, destination });
		expect(preview?.from).toEqual(destination);
		expect(preview?.ranges.get(buggy)).toBe(2);
	});

	test('reads a shove from the caster, with the shoved raider at the destination', () => {
		const destination = { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.AHEAD };
		const preview = previewDestination({ battle, driver: driverOf(rig), card: shoulderCheck(), target: buggy, destination });
		expect(preview?.from).toEqual(rig.slot);
		expect(preview?.ranges.get(buggy)).toBe(2);
		expect(preview?.ranges.get(hauler)).toBe(2);
		expect(preview?.reach).toBe(1);
	});

	test('is null for a card that picks no slot, or a shove with no target yet', () => {
		const destination = { lane: RoadLane.PLAYER_OUTSIDE, row: RoadRow.CENTER };
		expect(previewDestination({ battle, driver: driverOf(rig), card: cutOff(), destination })).toBeNull();
		expect(previewDestination({ battle, driver: driverOf(rig), card: shoulderCheck(), destination })).toBeNull();
	});
});
