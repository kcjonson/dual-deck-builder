import { CardCounts, startingDeckCounts } from '../campaign/CardCounts';
import { DRIVER_CONFIGS, DriverArchetype, DriverSkills } from '../mechanics/Driver';

/**
 * What a driver card shows (Game Flow 7.0), as plain data. Each screen maps
 * its own model onto it: the Crew screen a campaign driver record, load out
 * a seat's run deck, the debrief who came home. The card depends on none of
 * them.
 */
export interface DriverCardData {
	/** As the campaign names them ("Road Warrior 2"); the card wraps a long one to a second line. */
	readonly name: string;
	/** The archetype's role ("DEFENSIVE TANK"). */
	readonly specialty: string;
	readonly hitpoints: number;
	readonly maxHitpoints: number;
	readonly handLimit: number;
	/**
	 * Copies of each card by type, the campaign's own counts, so a record's
	 * deck passes straight through. The card counts it for its DECK figure;
	 * the detail view lays it out as minis.
	 */
	readonly deck: CardCounts;
	/** What they drive; the detail view's. */
	readonly vehicle?: string;
	/** The skills a hit check reads, and speed; the detail view's. */
	readonly skills?: Readonly<DriverSkills>;
	/**
	 * How a lost driver went ("KILLED DAY 9"): in the specialty's place on
	 * the card, and in the detail view's foot. Empty is the same as none.
	 */
	readonly note?: string;
}

export interface DriverCardDataOptions extends Partial<DriverCardData> {
	archetype: DriverArchetype;
}

/**
 * A driver card's data from an archetype's config, overridden by whatever
 * the caller's own model says: a campaign record keeps its own name, HP,
 * hand limit, and deck, and takes the rest from its archetype. A fresh
 * driver of the archetype when nothing is overridden, as the gallery and
 * the tests use it. An empty note is no note.
 */
export function driverCardData({ archetype, name, specialty, hitpoints, maxHitpoints, handLimit, deck, vehicle, skills, note }: DriverCardDataOptions): DriverCardData {
	const config = DRIVER_CONFIGS[archetype];
	const max = maxHitpoints ?? config.maxHitpoints;
	return {
		name: name ?? config.metadata.name,
		specialty: specialty ?? config.metadata.specialty,
		hitpoints: hitpoints ?? max,
		maxHitpoints: max,
		handLimit: handLimit ?? config.handLimit,
		deck: deck ?? startingDeckCounts(archetype),
		vehicle: vehicle ?? config.metadata.vehicleName,
		skills: skills ?? { ...config.skills },
		...(note ? { note } : {}),
	};
}

/**
 * Whether two drivers' data show the same on the card and in its detail
 * view, so a screen that maps its model afresh each time can hand a card
 * equal data in a new object without the card doing anything about it.
 */
export function sameDriverCardData(a: DriverCardData, b: DriverCardData): boolean {
	if (a === b) return true;
	return a.name === b.name
		&& a.specialty === b.specialty
		&& a.hitpoints === b.hitpoints
		&& a.maxHitpoints === b.maxHitpoints
		&& a.handLimit === b.handLimit
		&& a.vehicle === b.vehicle
		&& (a.note || '') === (b.note || '')
		&& sameNumbers(a.skills ?? {}, b.skills ?? {})
		&& sameNumbers(a.deck, b.deck);
}

function sameNumbers(a: Readonly<Record<string, number>>, b: Readonly<Record<string, number>>): boolean {
	const keys = Object.keys(a);
	return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
