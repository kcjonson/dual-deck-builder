import { ESCORT_CONFIGS, EscortDividend, EscortRole, EscortType } from '../mechanics/Escort';
import type { Vehicle } from '../mechanics/Vehicle';

/**
 * What an escort card shows (Game Flow 7.0), as plain data. Each screen
 * maps its own model onto it: load out and the garage's convoy strip an
 * escort in the convoy (`escortCardDataOf`), an event's offer a type it
 * would hire (`escortCardData`). The card depends on neither. Every escort
 * in the convoy is a hired type with its signature card, as the convoy's
 * reader holds it to.
 */
export interface EscortCardData {
	/** As the convoy names it ("Fuel Hauler"). */
	readonly name: string;
	readonly type: EscortType;
	/** A gun escort, or a hauler, which looters go for. */
	readonly role: EscortRole;
	/** What's left of it: damage carries over between fights, and the garage repairs it. */
	readonly structure: number;
	readonly maxStructure: number;
	/** The armor it starts a fight with; armor refills between fights, so this is its maximum. */
	readonly armor: number;
	/** Its own base speed; nobody at the wheel adds to it. */
	readonly speed: number;
	/** The crew skills a hit check reads; the detail view's. */
	readonly gunnery: number;
	readonly evade: number;
	readonly ramming: number;
	/** The type of the signature card it brings into a driver's deck. */
	readonly signatureCard: string;
	/** What it pays after each won fight it survives; null for none. */
	readonly dividend: EscortDividend | null;
}

export interface EscortCardDataOptions extends Partial<Omit<EscortCardData, 'type'>> {
	type: EscortType;
}

/**
 * An escort card's data from a type's config, overridden by whatever the
 * caller's own model says: a damaged escort keeps its structure. A fresh
 * escort of the type when nothing is overridden, as an offer to hire one,
 * the gallery, and the tests use it.
 */
export function escortCardData({ type, ...overrides }: EscortCardDataOptions): EscortCardData {
	const config = ESCORT_CONFIGS[type];
	const maxStructure = overrides.maxStructure ?? config.structure;
	const dividend = overrides.dividend !== undefined ? overrides.dividend : config.dividend;
	return {
		name: overrides.name ?? config.name,
		type,
		role: overrides.role ?? config.role,
		structure: overrides.structure ?? maxStructure,
		maxStructure,
		armor: overrides.armor ?? config.armor,
		speed: overrides.speed ?? config.baseSpeed,
		gunnery: overrides.gunnery ?? config.gunnery,
		evade: overrides.evade ?? config.evade,
		ramming: overrides.ramming ?? config.ramming,
		signatureCard: overrides.signatureCard ?? config.signatureCard,
		dividend: dividend ? { ...dividend } : null,
	};
}

/**
 * An escort card's data from an escort in the convoy (`Convoy.escorts`),
 * as it stands between fights: its structure, its full armor, and its own
 * speed. Only a hired escort has a card, as only a hired type is read into
 * the convoy (`readConvoy`): a vehicle with no type, or no signature card,
 * is refused.
 */
export function escortCardDataOf(vehicle: Vehicle): EscortCardData {
	const profile = vehicle.escort;
	if (!profile) throw new Error(`${vehicle.name} isn't an escort`);
	const { type, signatureCard } = profile;
	if (type === null || signatureCard === null) throw new Error(`${vehicle.name} isn't a hired escort with a signature card`);
	return {
		name: vehicle.name,
		type,
		role: profile.role,
		structure: vehicle.structure,
		maxStructure: vehicle.maxStructure,
		armor: vehicle.maxArmor,
		speed: vehicle.baseSpeed,
		gunnery: profile.gunnery,
		evade: profile.evade,
		ramming: profile.ramming,
		signatureCard,
		dividend: profile.dividend ? { ...profile.dividend } : null,
	};
}

/**
 * Whether two escorts' data show the same on the card and in its detail
 * view, so a screen that maps its model afresh each time can hand a card
 * equal data in a new object without the card doing anything about it.
 */
export function sameEscortCardData(a: EscortCardData, b: EscortCardData): boolean {
	if (a === b) return true;
	return a.name === b.name
		&& a.type === b.type
		&& a.role === b.role
		&& a.structure === b.structure
		&& a.maxStructure === b.maxStructure
		&& a.armor === b.armor
		&& a.speed === b.speed
		&& a.gunnery === b.gunnery
		&& a.evade === b.evade
		&& a.ramming === b.ramming
		&& a.signatureCard === b.signatureCard
		&& a.dividend?.kind === b.dividend?.kind
		&& a.dividend?.amount === b.dividend?.amount;
}
