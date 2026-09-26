import type { CrewSkills } from './Driver';
import { FormationSlot, RoadRow, laneKind } from './Road';
import { Vehicle } from './Vehicle';

/**
 * Escorts: undriven vehicles in the player's convoy that act only when a
 * driver plays an order card. See docs/specs/Combat Rules.md, "Escorts".
 */

export type EscortType = 'outrider' | 'pilot_car' | 'fuel_hauler' | 'med_truck';

export type EscortRole = 'gun' | 'hauler';

/**
 * What a hauler pays after every fight it survives
 */
export interface EscortDividend {
	resource: 'fuel' | 'scrap';
	amount: number;
}

/**
 * The part of a vehicle that makes it an escort. An escort has no driver,
 * so its crew skills live here. Armor, structure, and base speed stay on the
 * vehicle, as they do for a driven one.
 */
export interface EscortProfile {
	/** Null for a driven vehicle carrying on unmanned: not a hired type */
	type: EscortType | null;
	role: EscortRole;
	gunnery: number;
	evade: number;
	ramming: number;
	/** Where it opens when the encounter doesn't place it */
	preferredSlot: FormationSlot;
	/** Card type of the signature order card it brings into a driver's deck. An unmanned vehicle brings none. */
	signatureCard: string | null;
	dividend: EscortDividend | null;
	/** An encounter's escort (an event ally) rather than one from the convoy; only these may start as ambushers */
	setPiece: boolean;
}

/**
 * Everything needed to build an escort of one type
 */
export interface EscortConfig extends Omit<EscortProfile, 'setPiece' | 'type' | 'signatureCard'> {
	type: EscortType;
	signatureCard: string;
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
		dividend: { resource: 'fuel', amount: 1 }
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
		dividend: null
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

/**
 * Whoever is left keeping a driven vehicle on the road once its driver is
 * dead: a content number, set below every hired gun escort's gunnery and
 * evade and no better than the Outrider's ramming
 */
export const UNMANNED_CREW: Readonly<CrewSkills> = { gunnery: 4, evade: 3, ramming: 2 };

/**
 * A player's driven vehicle whose driver died with nobody to take the wheel
 * carries on as an escort for the rest of the fight: default crew skills,
 * its own base speed (Vehicle.speed without a driver), no signature card, no
 * dividend. It starts spent, since it can only convert mid-turn, and the next
 * player turn readies it with the rest. Its preferred slot is the formation
 * slot it held, or had reserved while flanking.
 */
export function convertToEscort(vehicle: Vehicle): void {
	if (vehicle.isEscort || vehicle.driver || vehicle.passenger) {
		throw new Error(`${vehicle.name} can only become an escort with nobody aboard`);
	}
	const home = vehicle.flank ? vehicle.flank.reservedSlot : vehicle.slot;
	const lane = home && laneKind(home.lane) === 'outside' ? 'outside' : 'inside';
	vehicle.set({
		spent: true,
		escort: {
			type: null,
			role: 'gun',
			...UNMANNED_CREW,
			preferredSlot: { lane, row: home?.row ?? RoadRow.CENTER },
			signatureCard: null,
			dividend: null,
			setPiece: false
		}
	});
}
