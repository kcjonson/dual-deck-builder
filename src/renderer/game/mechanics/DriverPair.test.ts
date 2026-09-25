import { Driver, DriverArchetype, DriverRole, DRIVER_CONFIGS } from './Driver';
import { assertDriverPair, isSameDriver, nextOpenDriverIndex } from './DriverPair';

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

	describe('nextOpenDriverIndex', () => {
		const drivers = [warrior, interceptor, mechanic];

		it('takes the start index when no partner is set', () => {
			expect(nextOpenDriverIndex({ drivers, fromIndex: 0, partner: null })).toBe(0);
		});

		it('skips the partner', () => {
			expect(nextOpenDriverIndex({ drivers, fromIndex: 0, partner: warrior })).toBe(1);
			expect(nextOpenDriverIndex({ drivers, fromIndex: 1, partner: interceptor })).toBe(2);
		});

		it('wraps past the end, skipping the partner on the way', () => {
			expect(nextOpenDriverIndex({ drivers, fromIndex: 3, partner: null })).toBe(0);
			expect(nextOpenDriverIndex({ drivers, fromIndex: 2, partner: mechanic })).toBe(0);
			expect(nextOpenDriverIndex({ drivers, fromIndex: 3, partner: warrior })).toBe(1);
		});

		it('skips a copy of the partner', () => {
			expect(nextOpenDriverIndex({ drivers, fromIndex: 0, partner: warrior.copy() })).toBe(1);
		});

		it('returns -1 when the partner is the only driver', () => {
			expect(nextOpenDriverIndex({ drivers: [warrior], fromIndex: 0, partner: warrior })).toBe(-1);
			expect(nextOpenDriverIndex({ drivers: [], fromIndex: 0, partner: null })).toBe(-1);
		});
	});
});
