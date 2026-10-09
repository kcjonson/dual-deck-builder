import { describeValue } from '../core/Json';
import { ReaderRangeError, readArray, readFields, readInteger, readNullable, readOneOf, readText } from '../core/JsonReader';
import { Convoy, escortNumber } from '../mechanics/Convoy';
import { ESCORT_CONFIGS, EscortDividend, EscortProfile, EscortRole, EscortType } from '../mechanics/Escort';
import { ROW_ORDER } from '../mechanics/Road';
import { MAX_CONVOY_ESCORTS } from '../mechanics/Team';
import { Vehicle, VehicleMod } from '../mechanics/Vehicle';
import { readCardType } from './CardCounts';

/**
 * The convoy in a save: the counter its escort ids come from, and each
 * escort's id, own stat block, and crew, damage carried, in roster order.
 * Everything that belongs to a fight (slot, flank, statuses, shield, spent,
 * seats) is left out, since the campaign saves between fights; a loaded
 * escort is off the road and ready.
 *
 * Every escort in the convoy is a hired type, up to four of them. Escorts
 * keep their whole stat block as well as the type, unlike drivers, so the
 * stats an escort was hired with stay its own when its type is retuned.
 */
export interface ConvoyJson {
	nextEscortNumber: number;
	escorts: EscortJson[];
}

export interface EscortJson {
	/** `escort-<n>`, what `Card.broughtBy` and a run's save name it by */
	id: string;
	name: string;
	armor: number;
	maxArmor: number;
	structure: number;
	maxStructure: number;
	baseSpeed: number;
	mods: VehicleMod[];
	escort: EscortProfileJson;
}

/** A convoy escort's profile. Its id is the escort's own field, and `setPiece` is always false in the convoy, so neither is saved here. */
export type EscortProfileJson = Omit<EscortProfile, 'id' | 'setPiece'>;

const CONVOY_FIELDS: readonly (keyof ConvoyJson)[] = ['nextEscortNumber', 'escorts'];
const ESCORT_FIELDS: readonly (keyof EscortJson)[] = ['id', 'name', 'armor', 'maxArmor', 'structure', 'maxStructure', 'baseSpeed', 'mods', 'escort'];
const PROFILE_FIELDS: readonly (keyof EscortProfileJson)[] = ['type', 'role', 'gunnery', 'evade', 'ramming', 'preferredSlot', 'signatureCard', 'dividend'];

const ESCORT_TYPES = Object.keys(ESCORT_CONFIGS) as readonly EscortType[];
const ESCORT_ROLES = Object.keys({ gun: true, hauler: true } satisfies Record<EscortRole, true>) as readonly EscortRole[];
const DIVIDEND_KINDS = Object.keys({ fuel: true, scrap: true, heal: true } satisfies Record<EscortDividend['kind'], true>) as readonly EscortDividend['kind'][];
const MOD_KINDS = Object.keys({ offense: true, defense: true, utility: true } satisfies Record<VehicleMod['kind'], true>) as readonly VehicleMod['kind'][];
const FORMATION_LANES = ['inside', 'outside'] as const;

export function convoyToJson(convoy: Convoy): ConvoyJson {
	return { nextEscortNumber: convoy.nextEscortNumber, escorts: convoy.escorts.map(escortToJson) };
}

/** An escort that has joined a convoy, so it has an id. */
export function escortToJson(vehicle: Vehicle): EscortJson {
	const profile = vehicle.escort;
	if (!profile) throw new Error(`${vehicle.name} is not an escort`);
	if (profile.id === null) throw new Error(`${vehicle.name} has no id, so it hasn't joined a convoy`);
	return {
		id: profile.id,
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

/**
 * A saved convoy: up to four escorts with distinct ids, each below the next
 * one to hand out, so a loaded convoy never gives an id out twice.
 */
export function readConvoy(value: unknown, path: string): Convoy {
	const fields = readFields(value, path, CONVOY_FIELDS);
	const nextEscortNumber = readInteger(fields.nextEscortNumber, `${path}.nextEscortNumber`, { min: 1 });
	const listed = readArray(fields.escorts, `${path}.escorts`);
	if (listed.length > MAX_CONVOY_ESCORTS) {
		throw new ReaderRangeError(`${path}.escorts holds ${listed.length} escorts, and a convoy holds ${MAX_CONVOY_ESCORTS} at most`);
	}
	const ids = new Set<string>();
	const escorts = Array.from(listed, (json, index) => {
		const at = `${path}.escorts[${index}]`;
		const { escort, id, number } = readEscortWithId(json, at);
		if (number >= nextEscortNumber) {
			throw new ReaderRangeError(`${at}.id must come before escort-${nextEscortNumber}, the next id to hand out, got ${id}`);
		}
		if (ids.has(id)) throw new ReaderRangeError(`${at}.id ${id} belongs to an earlier escort`);
		ids.add(id);
		return escort;
	});
	return new Convoy({ escorts, nextEscortNumber });
}

/**
 * An escort off the road: its id, armor and structure as saved, nobody
 * aboard, no statuses, ready to act. Structure is at least 1, since a wreck
 * leaves the convoy after the fight that wrecked it (Convoy.afterFight).
 */
function readEscortWithId(value: unknown, path: string): { escort: Vehicle; id: string; number: number } {
	const fields = readFields(value, path, ESCORT_FIELDS);
	const id = readText(fields.id, `${path}.id`);
	const number = escortNumber(id);
	if (number === null) throw new ReaderRangeError(`${path}.id must look like escort-1, got ${describeValue(id)}`);
	const maxArmor = readInteger(fields.maxArmor, `${path}.maxArmor`, { min: 0 });
	const maxStructure = readInteger(fields.maxStructure, `${path}.maxStructure`, { min: 1 });
	const escort = new Vehicle({
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
		mods: Array.from(readArray(fields.mods, `${path}.mods`), (mod, index) => readMod(mod, `${path}.mods[${index}]`)),
		escort: { id, ...readProfile(fields.escort, `${path}.escort`), setPiece: false }
	});
	return { escort, id, number };
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
