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
 * Throws unless `drivers` is one driver, or two different drivers: a fight's
 * seats, which can be down to one when a run has lost a driver
 * (solo-driver-fights.md). Two seats keep the pairing rule.
 */
export function assertDriverSeats(drivers: readonly Driver[]): asserts drivers is readonly [Driver] | readonly [Driver, Driver] {
	if (drivers.length === 1) return;
	if (drivers.length !== 2) {
		throw new Error(`Combat seats one or two drivers, not ${drivers.length}`);
	}
	assertDriverPair([...drivers]);
}

/**
 * Index of the first driver at or after `fromIndex`, wrapping around, that
 * isn't `partner`. Returns -1 when every driver is the partner.
 */
export function nextOpenDriverIndex({ drivers, fromIndex, partner }: {
	drivers: Driver[];
	fromIndex: number;
	partner: Driver | null;
}): number {
	for (let offset = 0; offset < drivers.length; offset++) {
		const index = (fromIndex + offset) % drivers.length;
		if (!partner || !isSameDriver(drivers[index], partner)) {
			return index;
		}
	}
	return -1;
}
