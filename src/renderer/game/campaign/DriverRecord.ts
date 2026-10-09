import { describeValue } from '../core/Json';
import { ReaderRangeError, readFields, readInteger, readOneOf, readText } from '../core/JsonReader';
import { Model } from '../core/Model';
import { DRIVER_CONFIGS, DriverArchetype } from '../mechanics/Driver';
import { CardCounts, readCardCounts, startingDeckCounts, totalCards } from './CardCounts';

export const DRIVER_STATUSES = ['ready', 'injured', 'dead', 'missing'] as const;

/**
 * Ready for a run; injured, and fit again in `injuredDays`; dead; or
 * missing, crashed out alive on a failed run until a Find: driver turns them
 * up. The dead and the missing stay in the pool, for the record.
 */
export type DriverStatus = (typeof DRIVER_STATUSES)[number];

export const DRIVER_ARCHETYPES = Object.keys(DRIVER_CONFIGS) as readonly DriverArchetype[];

/**
 * The damage a driver's signature vehicle carries from one fight to the
 * next. Structure is at least 1, since a wreck limps into the next fight
 * rather than staying wrecked. The maximums are the archetype's
 * (`DRIVER_CONFIGS[archetype].vehicleStats`), applied when a fight builds
 * the vehicle, so a record saved before a retune still loads.
 */
export interface VehicleCondition {
	structure: number;
	armor: number;
}

export interface DriverRecordData {
	/** Stable for the whole campaign. The campaign hands them out in order: `driver-1`, `driver-2`. */
	id: string;
	archetype: DriverArchetype;
	/** What the game calls them: archetype and an ordinal until drivers get names (DDB-318). */
	name: string;
	hitpoints: number;
	maxHitpoints: number;
	/** Their signature vehicle's structure and armor, carried between fights until it's repaired. */
	vehicle: Readonly<VehicleCondition>;
	/** Days until an injured driver is fit; 0 at every other status. */
	injuredDays: number;
	/** How far a fight's draws fill their hand. */
	handLimit: number;
	/** The cards they own between runs. Empty once they're dead: a driver killed on a run takes their cards with them. */
	defaultDeck: CardCounts;
	status: DriverStatus;
	runsCompleted: number;
}

/** A driver record as a save holds it. */
export interface DriverRecordJson extends Omit<DriverRecordData, 'vehicle' | 'defaultDeck'> {
	vehicle: VehicleCondition;
	defaultDeck: Record<string, number>;
}

/** Who the driver is; anything else left out is their archetype's fresh start. */
export type DriverRecordOptions = Pick<DriverRecordData, 'id' | 'archetype' | 'name'> & Partial<DriverRecordData>;

const FIELDS: readonly (keyof DriverRecordData)[] = [
	'id',
	'archetype',
	'name',
	'hitpoints',
	'maxHitpoints',
	'vehicle',
	'injuredDays',
	'handLimit',
	'defaultDeck',
	'status',
	'runsCompleted'
];

const FIXED_FIELDS = ['id', 'archetype'] as const;

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DriverRecord extends Readonly<DriverRecordData> {}

/**
 * A driver in the compound's pool, as the campaign keeps them between runs
 * (Compound and Supply Runs, The driver pool). A fight builds its combat
 * `Driver` from one (DDB-286).
 *
 * `id` shadows Model's per-instance id, a runtime count that depends on what
 * the session built first, so it's never saved or used to find a driver.
 * Properties are read-only: a change goes through `set`, which checks the
 * whole record and throws, changing nothing, if the result would be invalid,
 * so every record saves and loads back. The id and the archetype never
 * change.
 */
export class DriverRecord extends Model<DriverRecordData> {
	static properties = new Set<keyof DriverRecordData>(FIELDS);

	constructor(options: DriverRecordOptions) {
		super(withFreshStart(options));
	}

	/** Reads a record from a save, throwing on anything malformed. */
	public static fromJSON(json: unknown): DriverRecord {
		return readDriverRecord(json, 'DriverRecord');
	}

	/** Cards in the default deck, which the deck size limits count. */
	public get deckSize(): number {
		return totalCards(this.defaultDeck);
	}

	/**
	 * Changes fields together, checked as a whole: dying sets status, 0
	 * hitpoints, and an empty deck in one call. Throws without changing
	 * anything if the record would be invalid, a field is unknown, or the id
	 * or archetype would change.
	 */
	public override set(changes: Partial<DriverRecordData>): void {
		const current = this.getState();
		for (const field of FIXED_FIELDS) {
			if (current[field] !== undefined && field in changes && changes[field] !== current[field]) {
				throw new RangeError(`DriverRecord.${field} can't change, from ${describeValue(current[field])} to ${describeValue(changes[field])}`);
			}
		}
		const valid = readDriverRecordData({ ...current, ...changes }, 'DriverRecord');
		super.set(Object.fromEntries(Object.keys(changes).map(key => [key, valid[key as keyof DriverRecordData]])));
	}

	public toJSON(): DriverRecordJson {
		return {
			id: this.id,
			archetype: this.archetype,
			name: this.name,
			hitpoints: this.hitpoints,
			maxHitpoints: this.maxHitpoints,
			vehicle: { ...this.vehicle },
			injuredDays: this.injuredDays,
			handLimit: this.handLimit,
			defaultDeck: { ...this.defaultDeck },
			status: this.status,
			runsCompleted: this.runsCompleted
		};
	}
}

/**
 * Whatever the options leave out is a new driver's, from their archetype's
 * config: max HP, all of it, an undamaged vehicle, the hand limit, and the
 * starting deck; ready, with no runs.
 */
function withFreshStart({ id, archetype, name, ...rest }: DriverRecordOptions): DriverRecordData {
	readOneOf(archetype, 'DriverRecord.archetype', DRIVER_ARCHETYPES);
	const config = DRIVER_CONFIGS[archetype];
	const maxHitpoints = rest.maxHitpoints ?? config.maxHitpoints;
	return {
		id,
		archetype,
		name,
		hitpoints: rest.hitpoints ?? maxHitpoints,
		maxHitpoints,
		vehicle: rest.vehicle ?? { structure: config.vehicleStats.maxStructure, armor: config.vehicleStats.armor },
		injuredDays: rest.injuredDays ?? 0,
		handLimit: rest.handLimit ?? config.handLimit,
		defaultDeck: rest.defaultDeck ?? startingDeckCounts(archetype),
		status: rest.status ?? 'ready',
		runsCompleted: rest.runsCompleted ?? 0
	};
}

/**
 * A record's fields checked: exactly these fields, each in range, a dead
 * driver at 0 HP with no cards and nobody else at 0, injured days only
 * while injured, and a vehicle that isn't a wreck.
 */
export function readDriverRecordData(value: unknown, path: string): DriverRecordData {
	const fields = readFields(value, path, FIELDS);
	const data: DriverRecordData = {
		id: readText(fields.id, `${path}.id`),
		archetype: readOneOf(fields.archetype, `${path}.archetype`, DRIVER_ARCHETYPES),
		name: readText(fields.name, `${path}.name`),
		hitpoints: readInteger(fields.hitpoints, `${path}.hitpoints`, { min: 0 }),
		maxHitpoints: readInteger(fields.maxHitpoints, `${path}.maxHitpoints`, { min: 1 }),
		vehicle: readVehicleCondition(fields.vehicle, `${path}.vehicle`),
		injuredDays: readInteger(fields.injuredDays, `${path}.injuredDays`, { min: 0 }),
		handLimit: readInteger(fields.handLimit, `${path}.handLimit`, { min: 0 }),
		defaultDeck: readCardCounts(fields.defaultDeck, `${path}.defaultDeck`),
		status: readOneOf(fields.status, `${path}.status`, DRIVER_STATUSES),
		runsCompleted: readInteger(fields.runsCompleted, `${path}.runsCompleted`, { min: 0 })
	};
	readInteger(data.hitpoints, `${path}.hitpoints`, { min: 0, max: data.maxHitpoints, maxLabel: `maxHitpoints (${data.maxHitpoints})` });
	if ((data.status === 'dead') !== (data.hitpoints === 0)) {
		throw new ReaderRangeError(data.status === 'dead'
			? `${path}.hitpoints must be 0 for a dead driver, got ${data.hitpoints}`
			: `${path}.status must be dead at 0 hitpoints, got ${describeValue(data.status)}`);
	}
	if (data.status === 'dead' && totalCards(data.defaultDeck) > 0) {
		throw new ReaderRangeError(`${path}.defaultDeck must be empty for a dead driver, whose cards went with them, got ${describeValue(data.defaultDeck)}`);
	}
	if ((data.status === 'injured') !== (data.injuredDays > 0)) {
		throw new ReaderRangeError(data.status === 'injured'
			? `${path}.injuredDays must be 1 or more for an injured driver, got 0`
			: `${path}.injuredDays must be 0 for a driver who is ${data.status}, got ${data.injuredDays}`);
	}
	return data;
}

/** A record read from a save, with errors naming where in the save it was. */
export function readDriverRecord(value: unknown, path: string): DriverRecord {
	return new DriverRecord(readDriverRecordData(value, path));
}

/**
 * Structure from 1 and armor from 0, frozen. No maximum: the archetype's can
 * be retuned lower after a save, and a fight clamps to the current ones
 * (CombatBridge), so an old save still loads.
 */
function readVehicleCondition(value: unknown, path: string): Readonly<VehicleCondition> {
	const fields = readFields(value, path, ['structure', 'armor']);
	return Object.freeze({
		structure: readInteger(fields.structure, `${path}.structure`, { min: 1 }),
		armor: readInteger(fields.armor, `${path}.armor`, { min: 0 })
	});
}

/** "Road Warrior 2": the archetype's title and an ordinal, until drivers get names (DDB-318). */
export function placeholderName({ archetype, ordinal }: { archetype: DriverArchetype; ordinal: number }): string {
	const title = DRIVER_CONFIGS[archetype].metadata.name
		.replace(/^THE\s+/i, '')
		.toLowerCase()
		.replace(/\b[a-z]/g, letter => letter.toUpperCase());
	return `${title} ${ordinal}`;
}
