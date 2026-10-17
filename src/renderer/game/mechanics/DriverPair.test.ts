import { Driver, DriverArchetype, DriverRole, DRIVER_CONFIGS } from './Driver';
import { assertDriverPair, assertDriverSeats, isSameDriver } from './DriverPair';

function driverFor(archetype: DriverArchetype): Driver {
	const config = DRIVER_CONFIGS[archetype];
	return new Driver({
		archetype: config.id,
		metadata: config.metadata,
		skills: config.skills,
		vehicleStats: config.vehicleStats,
		startingDeck: config.startingDeck,
		hitpoints: config.maxHitpoints,
		maxHitpoints: config.maxHitpoints,
		adrenaline: 3,
		maxAdrenaline: config.maxAdrenaline,
		role: DriverRole.ACTIVE,
		hand: [],
		discard: [],
		deck: null,
	});
}

describe('DriverPair (Combat Rules: one driver per slot)', () => {
	const warrior = driverFor('road_warrior');
	const interceptor = driverFor('interceptor');
	const mechanic = driverFor('mechanic');

	describe('isSameDriver', () => {
		it('is true for one instance against itself', () => {
			expect(isSameDriver(warrior, warrior)).toBe(true);
		});

		it('is true for a copy, since identity is the archetype', () => {
			expect(isSameDriver(warrior, warrior.copy())).toBe(true);
		});

		it('is false for two archetypes', () => {
			expect(isSameDriver(warrior, interceptor)).toBe(false);
		});
	});

	describe('assertDriverPair', () => {
		it('accepts two different drivers', () => {
			expect(() => assertDriverPair([warrior, interceptor])).not.toThrow();
		});

		it('rejects one instance in both slots', () => {
			expect(() => assertDriverPair([warrior, warrior])).toThrow(/same driver/);
		});

		it('rejects a copy of the first driver in the second slot', () => {
			expect(() => assertDriverPair([warrior, warrior.copy()])).toThrow(/same driver/);
		});

		it('rejects anything but two drivers', () => {
			expect(() => assertDriverPair([warrior])).toThrow(/exactly 2/);
			expect(() => assertDriverPair([warrior, interceptor, mechanic])).toThrow(/exactly 2/);
		});
	});

	describe('assertDriverSeats', () => {
		it('accepts one driver, a run down to its last (DDB-166), or two different ones', () => {
			expect(() => assertDriverSeats([interceptor])).not.toThrow();
			expect(() => assertDriverSeats([warrior, interceptor])).not.toThrow();
		});

		it('holds two seats to the pair rule', () => {
			expect(() => assertDriverSeats([warrior, warrior.copy()])).toThrow(/same driver/);
		});

		it('rejects no driver, or more than two', () => {
			expect(() => assertDriverSeats([])).toThrow('Combat seats one or two drivers, not 0');
			expect(() => assertDriverSeats([warrior, interceptor, mechanic])).toThrow('Combat seats one or two drivers, not 3');
		});
	});
});
