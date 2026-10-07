import { Model } from '../core/Model';
import { Convoy } from '../mechanics/Convoy';
import { DriverArchetype } from '../mechanics/Driver';
import { CardCounts, NO_CARDS, addCards, cardCount, readCardCounts, readCardType, removeCards } from './CardCounts';
import { EscortJson, convoyToJson, readConvoy } from './ConvoyJson';
import { DriverRecord, DriverRecordJson, placeholderName, readDriverRecord } from './DriverRecord';
import { copyJson, describeValue, readArray, readFields, readInteger, readObject, readText } from './JsonReader';
import { EMPTY_MAP, MapParams, MapState, readMapParams, readMapState } from './MapStubs';
import { CAMPAIGN_SCHEMA_VERSION, migrateSave } from './SaveMigrations';

/** What the compound holds (Compound and Supply Runs, Resources): whole numbers, never below 0. */
export interface Resources {
	food: number;
	water: number;
	fuel: number;
	meds: number;
	scrap: number;
	people: number;
}

export const NO_RESOURCES: Readonly<Resources> = Object.freeze({ food: 0, water: 0, fuel: 0, meds: 0, scrap: 0, people: 0 });

/** A line of the campaign's history, dated with the day it happened. */
export interface CampaignLogEntry {
	day: number;
	message: string;
}

/** Where a card copy sits between runs: the compound's locker or a driver's default deck. */
export type CardPlace = 'locker' | DriverRecord;

export interface CampaignData {
	/** uint32. The map's seed, and the root every campaign stream forks from. */
	seed: number;
	/** The area map generator that made the map, which a save keeps rather than regenerating. */
	generatorVersion: number;
	/** The map's parameters as resolved at founding. */
	mapParams: MapParams;
	/** The gameplay map and what's changed on it since. */
	map: MapState;
	/** Founding day is day 1. */
	day: number;
	resources: Readonly<Resources>;
	unrest: number;
	/** Every driver the compound has had, in the order they joined, the dead and missing included. */
	drivers: readonly DriverRecord[];
	/** The number in the next driver's id, `driver-<n>`. Saved, so no id is handed out twice. */
	nextDriverNumber: number;
	/** The compound's spare cards. */
	locker: CardCounts;
	convoy: Convoy;
	/** Ids of the strongholds taken, in the order they fell. */
	strongholdsTaken: readonly string[];
	log: readonly Readonly<CampaignLogEntry>[];
}

/** The seed, generator version, and map params it's founded on; anything else left out is a new campaign's. */
export type CampaignOptions = Pick<CampaignData, 'seed' | 'generatorVersion' | 'mapParams'> & Partial<CampaignData>;

/** A campaign as a save holds it: plain JSON, which `Campaign.fromJSON` reads back. */
export interface CampaignJson {
	schemaVersion: number;
	seed: number;
	generatorVersion: number;
	day: number;
	resources: Resources;
	unrest: number;
	nextDriverNumber: number;
	drivers: DriverRecordJson[];
	locker: Record<string, number>;
	convoy: EscortJson[];
	strongholdsTaken: string[];
	log: CampaignLogEntry[];
	mapParams: MapParams;
	map: MapState;
}

const FIELDS: readonly (keyof CampaignData)[] = [
	'seed',
	'generatorVersion',
	'mapParams',
	'map',
	'day',
	'resources',
	'unrest',
	'drivers',
	'nextDriverNumber',
	'locker',
	'convoy',
	'strongholdsTaken',
	'log'
];

const JSON_FIELDS: readonly (keyof CampaignJson)[] = [
	'schemaVersion',
	'seed',
	'generatorVersion',
	'day',
	'resources',
	'unrest',
	'nextDriverNumber',
	'drivers',
	'locker',
	'convoy',
	'strongholdsTaken',
	'log',
	'mapParams',
	'map'
];

const RESOURCE_NAMES: readonly (keyof Resources)[] = ['food', 'water', 'fuel', 'meds', 'scrap', 'people'];

/** What the map was made from, set at founding. */
const FIXED_FIELDS = ['seed', 'generatorVersion', 'mapParams'] as const;

const DRIVER_ID = /^driver-([1-9][0-9]*)$/;
const UINT32_MAX = 0xffffffff;

// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface Campaign extends Readonly<CampaignData> {}

/**
 * One campaign, from founding the compound to its fall (Compound and Supply
 * Runs): the seed and map it was founded on, the day, the compound's stores
 * and unrest, the driver pool, the locker, the convoy, the strongholds
 * taken, and a log of what happened.
 *
 * Properties are read-only. A change goes through `set`, which checks the
 * whole campaign and throws, changing nothing, if the result would be
 * invalid, so whatever `toJSON` writes, `fromJSON` reads back. The seed,
 * generator version, and map params never change after founding.
 *
 * Nothing here draws randomness, and the seed comes from whoever founds the
 * campaign. Anything that needs a random draw later forks a fresh stream for
 * that one event from the seed and a saved counter, as in
 * `new Rng({ seed }).fork('recruit', n)`; a stream carried across a save
 * would replay from its start after loading.
 */
export class Campaign extends Model<CampaignData> {
	static properties = new Set<keyof CampaignData>(FIELDS);

	constructor({
		seed,
		generatorVersion,
		mapParams,
		map = EMPTY_MAP,
		day = 1,
		resources = NO_RESOURCES,
		unrest = 0,
		drivers = [],
		nextDriverNumber,
		locker = NO_CARDS,
		convoy = new Convoy(),
		strongholdsTaken = [],
		log = []
	}: CampaignOptions) {
		super({
			seed,
			generatorVersion,
			mapParams,
			map,
			day,
			resources,
			unrest,
			drivers,
			nextDriverNumber: nextDriverNumber ?? firstFreeDriverNumber(drivers),
			locker,
			convoy,
			strongholdsTaken,
			log
		});
	}

	/**
	 * Reads a save, upgrading it from an older schema version first. Throws
	 * on anything malformed, naming where: a damaged save never loads as a
	 * different campaign.
	 */
	public static fromJSON(json: unknown): Campaign {
		const path = 'Campaign';
		const save = readFields(migrateSave({ save: readObject(json, path), path }), path, JSON_FIELDS);
		return new Campaign(readCampaignData({
			seed: save.seed,
			generatorVersion: save.generatorVersion,
			mapParams: save.mapParams,
			map: save.map,
			day: save.day,
			resources: save.resources,
			unrest: save.unrest,
			drivers: readArray(save.drivers, `${path}.drivers`).map((driver, index) => readDriverRecord(driver, `${path}.drivers[${index}]`)),
			nextDriverNumber: save.nextDriverNumber,
			locker: save.locker,
			convoy: readConvoy(save.convoy, `${path}.convoy`),
			strongholdsTaken: save.strongholdsTaken,
			log: save.log
		}, path));
	}

	/**
	 * Changes fields together, checked as a whole. Throws without changing
	 * anything if the campaign would be invalid, a field is unknown, or the
	 * seed, generator version, or map params would change.
	 */
	public override set(changes: Partial<CampaignData>): void {
		const current = this.getState();
		for (const field of FIXED_FIELDS) {
			if (current[field] !== undefined && field in changes && changes[field] !== current[field]) {
				throw new RangeError(`Campaign.${field} is fixed at founding`);
			}
		}
		const valid = readCampaignData({ ...current, ...changes }, 'Campaign');
		super.set(Object.fromEntries(Object.keys(changes).map(key => [key, valid[key as keyof CampaignData]])));
	}

	/**
	 * A driver joins the pool: the next id, their archetype's starting HP,
	 * hand limit, and deck, and a name numbered after every driver of that
	 * archetype the compound has had. Founding (DDB-284) and Find: driver
	 * stops call this.
	 */
	public recruitDriver({ archetype }: { archetype: DriverArchetype }): DriverRecord {
		const ordinal = this.drivers.filter(driver => driver.archetype === archetype).length + 1;
		const driver = new DriverRecord({
			id: `driver-${this.nextDriverNumber}`,
			archetype,
			name: placeholderName({ archetype, ordinal })
		});
		this.set({ drivers: [...this.drivers, driver], nextDriverNumber: this.nextDriverNumber + 1 });
		return driver;
	}

	/**
	 * Moves copies of a card between the locker and drivers' default decks,
	 * all in this campaign. A move never makes or loses a copy, so each copy
	 * stays in exactly one place. Throws, moving nothing, when `from` holds
	 * fewer than `count`. Deck rules (size limits, who can take what) are the
	 * Crew screen's (DDB-310), not checked here.
	 */
	public moveCards({ cardType, from, to, count = 1 }: { cardType: string; from: CardPlace; to: CardPlace; count?: number }): void {
		readCardType(cardType, 'cardType');
		readInteger(count, 'count', { min: 1 });
		if (from === to) throw new RangeError(`Can't move ${cardType} from ${placeName(from)} to itself`);
		const source = this.countsAt(from);
		const target = this.countsAt(to);
		const held = cardCount(source, cardType);
		if (held < count) throw new RangeError(`Can't move ${count} ${cardType} from ${placeName(from)}, which holds ${held}`);
		this.store(from, removeCards(source, cardType, count));
		this.store(to, addCards(target, cardType, count));
	}

	/** Adds a line to the log, dated today. */
	public addLogEntry({ message }: { message: string }): void {
		this.set({ log: [...this.log, { day: this.day, message }] });
	}

	public toJSON(): CampaignJson {
		return {
			schemaVersion: CAMPAIGN_SCHEMA_VERSION,
			seed: this.seed,
			generatorVersion: this.generatorVersion,
			day: this.day,
			resources: { ...this.resources },
			unrest: this.unrest,
			nextDriverNumber: this.nextDriverNumber,
			drivers: this.drivers.map(driver => driver.toJSON()),
			locker: { ...this.locker },
			convoy: convoyToJson(this.convoy),
			strongholdsTaken: [...this.strongholdsTaken],
			log: this.log.map(entry => ({ ...entry })),
			mapParams: copyJson(this.mapParams),
			map: copyJson(this.map)
		};
	}

	private countsAt(place: CardPlace): CardCounts {
		if (place === 'locker') return this.locker;
		if (!this.drivers.includes(place)) throw new RangeError(`${place.name} (${place.id}) isn't in this campaign's pool`);
		return place.defaultDeck;
	}

	private store(place: CardPlace, counts: CardCounts): void {
		if (place === 'locker') this.set({ locker: counts });
		else place.set({ defaultDeck: counts });
	}
}

function placeName(place: CardPlace): string {
	return place === 'locker' ? 'the locker' : `${place.name}'s deck`;
}

/**
 * The campaign's fields checked together. Drivers and the convoy are
 * models here; `fromJSON` reads a save's into models first.
 */
function readCampaignData(value: unknown, path: string): CampaignData {
	const fields = readFields(value, path, FIELDS);
	const seed = readInteger(fields.seed, `${path}.seed`, { min: 0, max: UINT32_MAX });
	const mapParams = readMapParams(fields.mapParams, `${path}.mapParams`);
	if (mapParams.seed !== seed) {
		throw new RangeError(`${path}.mapParams.seed must be the campaign's seed, ${seed}, got ${describeValue(mapParams.seed)}`);
	}
	const day = readInteger(fields.day, `${path}.day`, { min: 1 });
	const nextDriverNumber = readInteger(fields.nextDriverNumber, `${path}.nextDriverNumber`, { min: 1 });
	if (!(fields.convoy instanceof Convoy)) throw new TypeError(`${path}.convoy must be a Convoy, got ${describeValue(fields.convoy)}`);
	return {
		seed,
		generatorVersion: readInteger(fields.generatorVersion, `${path}.generatorVersion`, { min: 1 }),
		mapParams,
		map: readMapState(fields.map, `${path}.map`),
		day,
		resources: readResources(fields.resources, `${path}.resources`),
		unrest: readInteger(fields.unrest, `${path}.unrest`, { min: 0 }),
		drivers: readDrivers(fields.drivers, `${path}.drivers`, nextDriverNumber),
		nextDriverNumber,
		locker: readCardCounts(fields.locker, `${path}.locker`),
		convoy: fields.convoy,
		strongholdsTaken: readStrongholds(fields.strongholdsTaken, `${path}.strongholdsTaken`),
		log: readLog(fields.log, `${path}.log`, day)
	};
}

/** The pool: driver records with distinct `driver-<n>` ids, each below the next one to hand out. */
function readDrivers(value: unknown, path: string, nextDriverNumber: number): readonly DriverRecord[] {
	const drivers = readArray(value, path);
	const ids = new Set<string>();
	drivers.forEach((driver, index) => {
		if (!(driver instanceof DriverRecord)) throw new TypeError(`${path}[${index}] must be a DriverRecord, got ${describeValue(driver)}`);
		const number = driverNumber(driver.id);
		if (number === null) throw new RangeError(`${path}[${index}].id must look like driver-1, got ${describeValue(driver.id)}`);
		if (number >= nextDriverNumber) {
			throw new RangeError(`${path}[${index}].id must come before driver-${nextDriverNumber}, the next id to hand out, got ${driver.id}`);
		}
		if (ids.has(driver.id)) throw new RangeError(`${path}[${index}].id ${driver.id} belongs to an earlier driver`);
		ids.add(driver.id);
	});
	return Object.freeze([...drivers] as DriverRecord[]);
}

function readResources(value: unknown, path: string): Readonly<Resources> {
	const fields = readFields(value, path, RESOURCE_NAMES);
	const amount = (name: keyof Resources): number => readInteger(fields[name], `${path}.${name}`, { min: 0 });
	return Object.freeze({
		food: amount('food'),
		water: amount('water'),
		fuel: amount('fuel'),
		meds: amount('meds'),
		scrap: amount('scrap'),
		people: amount('people')
	});
}

function readStrongholds(value: unknown, path: string): readonly string[] {
	const ids = readArray(value, path).map((id, index) => readText(id, `${path}[${index}]`));
	ids.forEach((id, index) => {
		if (ids.indexOf(id) !== index) throw new RangeError(`${path}[${index}] ${describeValue(id)} is already in the list`);
	});
	return Object.freeze(ids);
}

/** Log entries dated from day 1 to today, in order. */
function readLog(value: unknown, path: string, today: number): readonly Readonly<CampaignLogEntry>[] {
	let previousDay = 1;
	return Object.freeze(readArray(value, path).map((entry, index) => {
		const fields = readFields(entry, `${path}[${index}]`, ['day', 'message']);
		const day = readInteger(fields.day, `${path}[${index}].day`, { min: 1, max: today, maxLabel: `today (${today})` });
		if (day < previousDay) throw new RangeError(`${path}[${index}].day must not come before the entry above it (day ${previousDay}), got ${day}`);
		previousDay = day;
		return Object.freeze({ day, message: readText(fields.message, `${path}[${index}].message`) });
	}));
}

function driverNumber(id: string): number | null {
	const match = DRIVER_ID.exec(id);
	return match ? Number(match[1]) : null;
}

/** One past the highest `driver-<n>` among these, for a campaign built without a counter. */
function firstFreeDriverNumber(drivers: readonly DriverRecord[]): number {
	return drivers.reduce((highest, driver) => Math.max(highest, driverNumber(driver.id) ?? 0), 0) + 1;
}
