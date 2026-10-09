import { Convoy } from '../mechanics/Convoy';
import { ESCORT_CONFIGS, EscortDividend, EscortProfile, EscortRole, EscortType } from '../mechanics/Escort';
import { ROW_ORDER } from '../mechanics/Road';
import { MAX_CONVOY_ESCORTS } from '../mechanics/Team';
import { Vehicle, VehicleMod } from '../mechanics/Vehicle';
import { readCardType } from './CardCounts';
import { readArray, readFields, readInteger, readNullable, readOneOf, readText } from './JsonReader';

/**
 * The convoy in a save: each escort's own stat block and crew, damage
 * carried, in roster order. Everything that belongs to a fight (slot,
 * flank, statuses, shield, spent, seats) is left out, since the campaign
 * saves between runs; a loaded escort is off the road and ready.
 *
 * Every escort in the convoy is a hired type, up to four of them. Escorts
 * keep their whole stat block as well as the type, unlike drivers, so the
 * stats an escort was hired with stay its own when its type is retuned.
 */
export interface EscortJson {
	name: string;
	armor: number;
	maxArmor: number;
	structure: number;
	maxStructure: number;
	baseSpeed: number;
	mods: VehicleMod[];
	escort: EscortProfileJson;
}

/** A convoy escort's profile. `setPiece` is always false in the convoy, so it isn't saved. */
export type EscortProfileJson = Omit<EscortProfile, 'setPiece'>;

const ESCORT_FIELDS: readonly (keyof EscortJson)[] = ['name', 'armor', 'maxArmor', 'structure', 'maxStructure', 'baseSpeed', 'mods', 'escort'];
const PROFILE_FIELDS: readonly (keyof EscortProfileJson)[] = ['type', 'role', 'gunnery', 'evade', 'ramming', 'preferredSlot', 'signatureCard', 'dividend'];

const ESCORT_TYPES = Object.keys(ESCORT_CONFIGS) as readonly EscortType[];
const ESCORT_ROLES = Object.keys({ gun: true, hauler: true } satisfies Record<EscortRole, true>) as readonly EscortRole[];
const DIVIDEND_KINDS = Object.keys({ fuel: true, scrap: true, heal: true } satisfies Record<EscortDividend['kind'], true>) as readonly EscortDividend['kind'][];
const MOD_KINDS = Object.keys({ offense: true, defense: true, utility: true } satisfies Record<VehicleMod['kind'], true>) as readonly VehicleMod['kind'][];
const FORMATION_LANES = ['inside', 'outside'] as const;

export function convoyToJson(convoy: Convoy): EscortJson[] {
	return convoy.escorts.map(escortToJson);
}

export function escortToJson(vehicle: Vehicle): EscortJson {
	const profile = vehicle.escort;
	if (!profile) throw new Error(`${vehicle.name} is not an escort`);
	return {
		name: vehicle.name,
		armor: vehicle.armor,
		maxArmor: vehicle.maxArmor,
		structure: vehicle.structure,
		maxStructure: vehicle.maxStructure,
		baseSpeed: vehicle.baseSpeed,
		mods: (vehicle.mods ?? []).map(mod => ({ ...mod })),
		escort: {
			type: profile.type,
			role: profile.role,
			gunnery: profile.gunnery,
			evade: profile.evade,
			ramming: profile.ramming,
			preferredSlot: { ...profile.preferredSlot },
			signatureCard: profile.signatureCard,
			dividend: profile.dividend ? { ...profile.dividend } : null
		}
	};
}

export function readConvoy(value: unknown, path: string): Convoy {
	const escorts = readArray(value, path);
	if (escorts.length > MAX_CONVOY_ESCORTS) throw new RangeError(`${path} holds ${escorts.length} escorts, and a convoy holds ${MAX_CONVOY_ESCORTS} at most`);
	return new Convoy({ escorts: escorts.map((escort, index) => readEscort(escort, `${path}[${index}]`)) });
}

/**
 * An escort off the road: armor and structure as saved, nobody aboard, no
 * statuses, ready to act. Structure is at least 1, since a wreck leaves the
 * convoy after the fight that wrecked it (Convoy.afterFight).
 */
export function readEscort(value: unknown, path: string): Vehicle {
	const fields = readFields(value, path, ESCORT_FIELDS);
	const maxArmor = readInteger(fields.maxArmor, `${path}.maxArmor`, { min: 0 });
	const maxStructure = readInteger(fields.maxStructure, `${path}.maxStructure`, { min: 1 });
	return new Vehicle({
		name: readText(fields.name, `${path}.name`),
		armor: readInteger(fields.armor, `${path}.armor`, { min: 0, max: maxArmor, maxLabel: `maxArmor (${maxArmor})` }),
		maxArmor,
		structure: readInteger(fields.structure, `${path}.structure`, { min: 1, max: maxStructure, maxLabel: `maxStructure (${maxStructure})` }),
		maxStructure,
		baseSpeed: readInteger(fields.baseSpeed, `${path}.baseSpeed`, { min: 0 }),
		slot: null,
		flank: null,
		velocity: 0,
		driver: null,
		passenger: null,
		statusEffects: [],
		spent: false,
		mods: readArray(fields.mods, `${path}.mods`).map((mod, index) => readMod(mod, `${path}.mods[${index}]`)),
		escort: { ...readProfile(fields.escort, `${path}.escort`), setPiece: false }
	});
}

function readProfile(value: unknown, path: string): EscortProfileJson {
	const fields = readFields(value, path, PROFILE_FIELDS);
	const slot = readFields(fields.preferredSlot, `${path}.preferredSlot`, ['lane', 'row']);
	return {
		type: readOneOf(fields.type, `${path}.type`, ESCORT_TYPES),
		role: readOneOf(fields.role, `${path}.role`, ESCORT_ROLES),
		gunnery: readInteger(fields.gunnery, `${path}.gunnery`, { min: 0 }),
		evade: readInteger(fields.evade, `${path}.evade`, { min: 0 }),
		ramming: readInteger(fields.ramming, `${path}.ramming`, { min: 0 }),
		preferredSlot: {
			lane: readOneOf(slot.lane, `${path}.preferredSlot.lane`, FORMATION_LANES),
			row: readOneOf(slot.row, `${path}.preferredSlot.row`, ROW_ORDER)
		},
		signatureCard: readNullable(fields.signatureCard, `${path}.signatureCard`, readCardType),
		dividend: readNullable(fields.dividend, `${path}.dividend`, readDividend)
	};
}

function readDividend(value: unknown, path: string): EscortDividend {
	const fields = readFields(value, path, ['kind', 'amount']);
	return {
		kind: readOneOf(fields.kind, `${path}.kind`, DIVIDEND_KINDS),
		amount: readInteger(fields.amount, `${path}.amount`, { min: 0 })
	};
}

function readMod(value: unknown, path: string): VehicleMod {
	const fields = readFields(value, path, ['name', 'kind']);
	return {
		name: readText(fields.name, `${path}.name`),
		kind: readOneOf(fields.kind, `${path}.kind`, MOD_KINDS)
	};
}
