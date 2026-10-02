import { Battle } from './Battle';
import { Card, CardEffect } from './Card';
import { Driver } from './Driver';
import { RoadLane, RoadRow } from './Road';
import { Team, TeamType } from './Team';
import { Vehicle } from './Vehicle';
import { previewAim } from './AimPreview';
import { createTestDriver } from '../ai/__tests__/test-helpers';

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
});
