import { Driver } from './Driver';

/**
 * The pairing rule from Combat Rules (Cards): one driver can't fill both slots.
 * A driver's identity is its archetype, so two copies of one driver are the
 * same driver even when they're different instances.
 */
export function isSameDriver(a: Driver, b: Driver): boolean {
	return a.archetype === b.archetype;
}

/**
 * Throws unless `drivers` is exactly two different drivers. Run start calls
 * this so no path can build a player side that shares one driver's cards.
 */
export function assertDriverPair(drivers: Driver[]): asserts drivers is [Driver, Driver] {
	if (drivers.length !== 2) {
		throw new Error('Combat requires exactly 2 drivers');
	}
	if (isSameDriver(drivers[0], drivers[1])) {
		throw new Error(`The same driver can't fill both slots (${drivers[0].archetype})`);
	}
}

/**
 * Throws unless `drivers` is a fight's seats: one driver, when a run has
 * lost one (solo-driver-fights.md), or two that aren't the one instance. A
 * campaign's drivers are people, so two of one archetype are two drivers,
 * and whether they may go together is load out's crew rule (Seating.ts,
 * gameplay call 35), which the combat bridge already held them to.
 */
export function assertDriverSeats(drivers: readonly Driver[]): asserts drivers is readonly [Driver] | readonly [Driver, Driver] {
	if (drivers.length === 1) return;
	if (drivers.length !== 2) {
		throw new Error(`Combat seats one or two drivers, not ${drivers.length}`);
	}
	if (drivers[0] === drivers[1]) {
		throw new Error(`One driver can't fill both seats (${drivers[0].metadata.name})`);
	}
}
