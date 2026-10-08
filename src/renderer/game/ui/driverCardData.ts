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
	 * Said in the specialty's place on the card, which the detail view still
	 * shows: how a lost driver went ("KILLED DAY 9").
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
 * the tests use it.
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
		...(note !== undefined ? { note } : {}),
	};
}
