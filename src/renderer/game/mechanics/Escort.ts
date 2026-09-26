import { FormationSlot, RoadRow } from './Road';
import { Vehicle } from './Vehicle';

/**
 * Escorts: undriven vehicles in the player's convoy that act only when a
 * driver plays an order card. See docs/specs/Combat Rules.md, "Escorts".
 */

export type EscortType = 'outrider' | 'pilot_car' | 'fuel_hauler' | 'med_truck';

export type EscortRole = 'gun' | 'hauler';

/**
 * What a hauler pays after every fight it survives: fuel or scrap for the
 * run, or HP for every living driver in the run, up to their starting HP
 */
export interface EscortDividend {
	kind: 'fuel' | 'scrap' | 'heal';
	amount: number;
}

/**
 * The part of a vehicle that makes it an escort. An escort has no driver,
 * so its crew skills live here. Armor, structure, and base speed stay on the
 * vehicle, as they do for a driven one.
 */
export interface EscortProfile {
	type: EscortType;
	role: EscortRole;
	gunnery: number;
	evade: number;
	ramming: number;
	/** Where it opens when the encounter doesn't place it */
	preferredSlot: FormationSlot;
	/** Card type of the signature order card it brings into a driver's deck */
	signatureCard: string;
	dividend: EscortDividend | null;
	/** An encounter's escort (an event ally) rather than one from the convoy; only these may start as ambushers */
	setPiece: boolean;
}

/**
 * Everything needed to build an escort of one type
 */
export interface EscortConfig extends Omit<EscortProfile, 'setPiece'> {
	name: string;
	armor: number;
	structure: number;
	baseSpeed: number;
}

// Speeds for the Outrider and Pilot Car and the preferred slots are the
// escorts record's; the other numbers are first-pass content values.
export const ESCORT_CONFIGS: Record<EscortType, EscortConfig> = {
	outrider: {
		type: 'outrider',
		name: 'Outrider',
		role: 'gun',
		gunnery: 6,
		evade: 6,
		ramming: 2,
		armor: 0,
		structure: 25,
		baseSpeed: 5,
		preferredSlot: { lane: 'inside', row: RoadRow.AHEAD },
		signatureCard: 'run_ahead',
		dividend: null
	},
	pilot_car: {
		type: 'pilot_car',
		name: 'Pilot Car',
		role: 'gun',
		gunnery: 5,
		evade: 4,
		ramming: 4,
		armor: 3,
		structure: 30,
		baseSpeed: 4,
		preferredSlot: { lane: 'outside', row: RoadRow.AHEAD },
		signatureCard: 'flag_down',
		dividend: null
	},
	fuel_hauler: {
		type: 'fuel_hauler',
		name: 'Fuel Hauler',
		role: 'hauler',
		gunnery: 1,
		evade: 1,
		ramming: 3,
		armor: 5,
		structure: 40,
		baseSpeed: 2,
		preferredSlot: { lane: 'outside', row: RoadRow.CENTER },
		signatureCard: 'top_off',
		dividend: { kind: 'fuel', amount: 1 }
	},
	med_truck: {
		type: 'med_truck',
		name: 'Med Truck',
		role: 'hauler',
		gunnery: 1,
		evade: 2,
		ramming: 1,
		armor: 4,
		structure: 35,
		baseSpeed: 2,
		preferredSlot: { lane: 'outside', row: RoadRow.BEHIND },
		signatureCard: 'triage',
		dividend: { kind: 'heal', amount: 3 }
	}
};

/**
 * A fresh escort of a type at full armor and structure, not yet on the road
 */
export function createEscort({ type, setPiece = false }: { type: EscortType; setPiece?: boolean }): Vehicle {
	const { name, armor, structure, baseSpeed, preferredSlot, dividend, ...crew } = ESCORT_CONFIGS[type];
	return new Vehicle({
		name,
		armor,
		maxArmor: armor,
		structure,
		maxStructure: structure,
		baseSpeed,
		slot: null,
		flank: null,
		velocity: 0,
		driver: null,
		passenger: null,
		statusEffects: [],
		spent: false,
		escort: {
			...crew,
			preferredSlot: { ...preferredSlot },
			dividend: dividend ? { ...dividend } : null,
			setPiece
		}
	});
}
