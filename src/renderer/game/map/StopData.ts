import routesFile from '../data/routes.json';
import stopTablesFile from '../data/stopTables.json';
import stopsFile from '../data/stops.json';
import { ReaderRangeError, freezeJson, readArray, readFields, readInteger, readNumber, readObject, readOneOf, readText } from '../core/JsonReader';
import { BIOMES, Biome } from './Biome';
import { POI_RESOURCES, PoiResource } from './PoiData';
import { ROAD_CLASSES, RoadClass } from './RoadNetwork';

/**
 * The stops stage's and the route descriptors' tuning, kept in
 * `data/stops.json`, `data/stopTables.json`, and `data/routes.json` so it
 * tunes without a code change (Area Map Generation, 9. Stops, and Routes).
 * Every value is a starting value for the Map Lab. The readers are strict:
 * an unknown field, a missing one, or a value out of range throws, naming
 * its path. Stop tables are read and compiled whole, every class, biome,
 * tier, and territory, so a row with nothing to draw fails when the tables
 * are read, never partway through a map.
 */

/** Every stop type, fixed in code since the run reads them: the spec's stop table, with Find split by what it finds. */
export const STOP_TYPES = [
	'ambush',
	'warband',
	'checkpoint',
	'wreck',
	'distress',
	'garage',
	'hazard',
	'findDriver',
	'findSettlers',
	'findVehicle',
	'findCards',
	'findSupplies',
] as const;
export type StopType = (typeof STOP_TYPES)[number];

/** Stops that are fights. */
export const FIGHT_TYPES: readonly StopType[] = ['ambush', 'warband'];
/** Stops that aren't non-fights for the per-route rules: the fights, and a checkpoint, which can turn into one. */
const UNCALM_TYPES: readonly StopType[] = [...FIGHT_TYPES, 'checkpoint'];

/** Whether a stop counts as a non-fight for the per-route rules: neither a fight nor a checkpoint. */
export function isCalm(type: StopType): boolean {
	return !UNCALM_TYPES.includes(type);
}

export function isFight(type: StopType): boolean {
	return FIGHT_TYPES.includes(type);
}

/** Tiers the tables key on, 1 to 5. */
export const STOP_TIERS = 5;

/** Territory before any stronghold claims ground (DDB-292): every stop is on no one's ground. */
export const NO_TERRITORY = 'none';

export interface StopTypeSpec {
	readonly label: string;
	/** What the run's daylight estimate counts for a stop of the type. */
	readonly hours: number;
}

export interface IntRange {
	readonly min: number;
	readonly max: number;
}

export interface StopTuning {
	/** World units of road per stop by class, at stopDensity 1. */
	readonly spacing: { readonly [Name in RoadClass]: number };
	readonly clearance: {
		/** World units a stop keeps from either end of its leg... */
		readonly ends: number;
		/** ...and from a place partway along it where roads meet. */
		readonly junctions: number;
	};
	/**
	 * Least world units between the stops a leg is dealt, which also caps how
	 * many it holds. A Find: driver added for the floor keeps it where the
	 * legs have room, and may sit closer where they don't.
	 */
	readonly minGap: number;
	/** Share of its slot a stop moves at most, either way about the slot's middle. */
	readonly jitter: number;
	/** World units between the points a leg's biomes are sampled at. */
	readonly biomeStep: number;
	readonly types: { readonly [Type in StopType]: StopTypeSpec };
	/** Hours at the objective, for the daylight estimate. */
	readonly objectiveHours: { readonly poi: number; readonly stronghold: number };
	readonly skulls: {
		/** A fight's skulls rise this much a tier, times dangerCurve, from 1 at tier 1. */
		readonly step: number;
		/** Added for a warband, up to 3. */
		readonly warband: number;
	};
	readonly driverFinds: {
		/** The floor, driverFinds, holds over legs of this tier and under. */
		readonly floorTiers: number;
		/** Per tier from 1, the least share of a tier's stops that are Find: driver, rounded down; a soft rate, never a failure. */
		readonly rates: readonly number[];
	};
	/** What a stop's contents roll from. */
	readonly contents: {
		readonly hazards: readonly string[];
		readonly hazardHours: { readonly min: number; readonly max: number; readonly step: number };
		readonly supplies: { readonly [Resource in PoiResource]: IntRange };
	};
}

export interface RouteTuning {
	/** Road a unit of fuel covers, out and back. */
	readonly unitsPerFuel: number;
	/** Hours counted for a stop whose type isn't known. */
	readonly unknownStopHours: number;
	/** Hour of the day a run leaves at. */
	readonly dawn: number;
	readonly names: {
		/** Share of a route's own road a biome needs to name it. */
		readonly biomeShare: number;
		/** Names by biome; a biome left out never names a route. */
		readonly biomes: Readonly<Partial<Record<Biome, string>>>;
		/** Names by class; `{road}` is the highway's number. */
		readonly classes: { readonly [Name in RoadClass]: string };
	};
}

/**
 * The stop tables as the spec has them, by road class, biome, tier, and
 * territory, kept compactly: a weight per type for each class, and a
 * multiplier per type for each biome, tier, and territory, 1 when left out.
 * A stop's weights are its class's times its biome's, tier's, and
 * territory's.
 */
export interface StopWeights {
	readonly classes: { readonly [Name in RoadClass]: Readonly<Partial<Record<StopType, number>>> };
	readonly biomes: Readonly<Partial<Record<Biome, Readonly<Partial<Record<StopType, number>>>>>>;
	/** By tier, "1" to "5". */
	readonly tiers: Readonly<Record<string, Readonly<Partial<Record<StopType, number>>>>>;
	/** By territory name; `none` is required. */
	readonly territories: Readonly<Record<string, Readonly<Partial<Record<StopType, number>>>>>;
}

/**
 * Stop tables ready to draw from: per class, biome, tier, and territory, the
 * cumulative weights over every type and over the calm ones alone, built
 * once, in type order, so a draw is a search.
 */
export class CompiledStopTables {
	public readonly territories: readonly string[];
	private readonly all: Float64Array;
	private readonly calm: Float64Array;

	constructor({ tables, path }: { tables: StopWeights; path: string }) {
		this.territories = Object.keys(tables.territories);
		const rows = ROAD_CLASSES.length * BIOMES.length * STOP_TIERS * this.territories.length;
		this.all = new Float64Array(rows * STOP_TYPES.length);
		this.calm = new Float64Array(rows * STOP_TYPES.length);
		ROAD_CLASSES.forEach((roadClass) => {
			BIOMES.forEach((biome) => {
				for (let tier = 1; tier <= STOP_TIERS; tier += 1) {
					this.territories.forEach((territory) => {
						const row = this.rowOf({ roadClass, biome, tier, territory });
						let all = 0;
						let calm = 0;
						STOP_TYPES.forEach((type, index) => {
							const weight = (tables.classes[roadClass][type] ?? 0)
								* (tables.biomes[biome]?.[type] ?? 1)
								* (tables.tiers[String(tier)]?.[type] ?? 1)
								* (tables.territories[territory][type] ?? 1);
							all += weight;
							if (isCalm(type)) calm += weight;
							this.all[row + index] = all;
							this.calm[row + index] = calm;
						});
						const where = `${path}: ${roadClass} in ${biome} at tier ${tier} in territory ${territory}`;
						if (!(all > 0 && all < Infinity)) throw new ReaderRangeError(`${where} weighs nothing, so no stop type can be drawn there`);
						if (!(calm > 0)) throw new ReaderRangeError(`${where} weighs no non-fight, which the per-route rules need after two fights`);
					});
				}
			});
		});
	}

	/** The row's offset for a class, biome, tier 1 to 5, and territory. Throws on a tier out of range or a territory the tables don't have. */
	public rowOf({ roadClass, biome, tier, territory }: { roadClass: RoadClass; biome: Biome; tier: number; territory: string }): number {
		const place = this.territories.indexOf(territory);
		if (place < 0) throw new RangeError(`stop tables: no territory "${territory}"; they have ${this.territories.join(', ')}`);
		if (!(Number.isInteger(tier) && tier >= 1 && tier <= STOP_TIERS)) throw new RangeError(`stop tables: tier must be an integer from 1 to ${STOP_TIERS}, got ${tier}`);
		const row = ((ROAD_CLASSES.indexOf(roadClass) * BIOMES.length + BIOMES.indexOf(biome)) * STOP_TIERS + tier - 1) * this.territories.length + place;
		return row * STOP_TYPES.length;
	}

	/** The type a draw in [0, 1) picks from a row (`rowOf`), from every type or the calm ones alone. */
	public draw({ row, draw, calmOnly }: { row: number; draw: number; calmOnly: boolean }): StopType {
		const sums = calmOnly ? this.calm : this.all;
		const total = sums[row + STOP_TYPES.length - 1];
		const target = draw * total;
		let last = -1;
		for (let index = 0; index < STOP_TYPES.length; index += 1) {
			const before = index === 0 ? 0 : sums[row + index - 1];
			if (sums[row + index] > before) last = index;
			if (sums[row + index] > target && sums[row + index] > before) return STOP_TYPES[index];
		}
		// draw * total can round up to total; the last type with weight takes it.
		return STOP_TYPES[last];
	}
}

export function readStopTuning(value: unknown, path: string): StopTuning {
	const fields = readFields(value, path, ['spacing', 'clearance', 'minGap', 'jitter', 'biomeStep', 'types', 'objectiveHours', 'skulls', 'driverFinds', 'contents']);
	const spacing = readFields(fields.spacing, `${path}.spacing`, ROAD_CLASSES);
	const clearance = readFields(fields.clearance, `${path}.clearance`, ['ends', 'junctions']);
	const typeFields = readFields(fields.types, `${path}.types`, STOP_TYPES);
	const objective = readFields(fields.objectiveHours, `${path}.objectiveHours`, ['poi', 'stronghold']);
	const skulls = readFields(fields.skulls, `${path}.skulls`, ['step', 'warband']);
	const finds = readFields(fields.driverFinds, `${path}.driverFinds`, ['floorTiers', 'rates']);
	const rates = readArray(finds.rates, `${path}.driverFinds.rates`);
	if (rates.length !== STOP_TIERS) throw new ReaderRangeError(`${path}.driverFinds.rates must give a rate for each of the ${STOP_TIERS} tiers, got ${rates.length}`);
	const contents = readFields(fields.contents, `${path}.contents`, ['hazards', 'hazardHours', 'supplies']);
	const hazards = readArray(contents.hazards, `${path}.contents.hazards`);
	if (hazards.length === 0) throw new ReaderRangeError(`${path}.contents.hazards must name at least one hazard`);
	const hazardHours = readFields(contents.hazardHours, `${path}.contents.hazardHours`, ['min', 'max', 'step']);
	const supplies = readFields(contents.supplies, `${path}.contents.supplies`, POI_RESOURCES);
	const tuning: StopTuning = {
		spacing: mapKeys(ROAD_CLASSES, (roadClass) => readAtLeast(spacing[roadClass], `${path}.spacing.${roadClass}`, 1)),
		clearance: {
			ends: readAtLeast(clearance.ends, `${path}.clearance.ends`, 0),
			junctions: readAtLeast(clearance.junctions, `${path}.clearance.junctions`, 0),
		},
		minGap: readAtLeast(fields.minGap, `${path}.minGap`, 1),
		jitter: readShare(fields.jitter, `${path}.jitter`),
		biomeStep: readAtLeast(fields.biomeStep, `${path}.biomeStep`, 1),
		types: mapKeys(STOP_TYPES, (type) => {
			const spec = readFields(typeFields[type], `${path}.types.${type}`, ['label', 'hours']);
			return { label: readText(spec.label, `${path}.types.${type}.label`), hours: readAtLeast(spec.hours, `${path}.types.${type}.hours`, 0) };
		}),
		objectiveHours: {
			poi: readAtLeast(objective.poi, `${path}.objectiveHours.poi`, 0),
			stronghold: readAtLeast(objective.stronghold, `${path}.objectiveHours.stronghold`, 0),
		},
		skulls: {
			step: readAtLeast(skulls.step, `${path}.skulls.step`, 0),
			warband: readInteger(skulls.warband, `${path}.skulls.warband`, { min: 0, max: 2 }),
		},
		driverFinds: {
			floorTiers: readInteger(finds.floorTiers, `${path}.driverFinds.floorTiers`, { min: 1, max: STOP_TIERS }),
			rates: rates.map((rate, index) => readShare(rate, `${path}.driverFinds.rates[${index}]`)),
		},
		contents: {
			hazards: hazards.map((hazard, index) => readText(hazard, `${path}.contents.hazards[${index}]`)),
			hazardHours: readHourSteps(hazardHours, `${path}.contents.hazardHours`),
			supplies: mapKeys(POI_RESOURCES, (resource) => readIntRange(supplies[resource], `${path}.contents.supplies.${resource}`)),
		},
	};
	return freezeJson(tuning, path) as unknown as StopTuning;
}

export function readRouteTuning(value: unknown, path: string): RouteTuning {
	const fields = readFields(value, path, ['unitsPerFuel', 'unknownStopHours', 'dawn', 'names']);
	const names = readFields(fields.names, `${path}.names`, ['biomeShare', 'biomes', 'classes']);
	const biomeNames = readObject(names.biomes, `${path}.names.biomes`);
	const classNames = readFields(names.classes, `${path}.names.classes`, ROAD_CLASSES);
	const biomes: Partial<Record<Biome, string>> = {};
	for (const [biome, name] of Object.entries(biomeNames)) biomes[readOneOf(biome, `${path}.names.biomes.${biome}`, BIOMES)] = readText(name, `${path}.names.biomes.${biome}`);
	const tuning: RouteTuning = {
		unitsPerFuel: readAtLeast(fields.unitsPerFuel, `${path}.unitsPerFuel`, 1),
		unknownStopHours: readAtLeast(fields.unknownStopHours, `${path}.unknownStopHours`, 0),
		dawn: readAtLeast(fields.dawn, `${path}.dawn`, 0),
		names: {
			biomeShare: readShare(names.biomeShare, `${path}.names.biomeShare`),
			biomes,
			classes: mapKeys(ROAD_CLASSES, (roadClass) => readText(classNames[roadClass], `${path}.names.classes.${roadClass}`)),
		},
	};
	return freezeJson(tuning, path) as unknown as RouteTuning;
}

/** Stop tables from JSON (the shipped file, or a map's `stopTables` param), checked and compiled. */
export function compileStopTables(value: unknown, path: string): CompiledStopTables {
	const fields = readFields(value, path, ['classes', 'biomes', 'tiers', 'territories']);
	const classes = readFields(fields.classes, `${path}.classes`, ROAD_CLASSES);
	const biomes = readObject(fields.biomes, `${path}.biomes`);
	const tiers = readObject(fields.tiers, `${path}.tiers`);
	const territories = readObject(fields.territories, `${path}.territories`);
	const tables: StopWeights = {
		classes: mapKeys(ROAD_CLASSES, (roadClass) => readWeights(classes[roadClass], `${path}.classes.${roadClass}`)),
		biomes: Object.fromEntries(Object.entries(biomes).map(([biome, row]) => [readOneOf(biome, `${path}.biomes.${biome}`, BIOMES), readWeights(row, `${path}.biomes.${biome}`)])),
		tiers: Object.fromEntries(Object.entries(tiers).map(([tier, row]) => {
			readOneOf(tier, `${path}.tiers.${tier}`, ['1', '2', '3', '4', '5']);
			return [tier, readWeights(row, `${path}.tiers.${tier}`)];
		})),
		territories: Object.fromEntries(Object.entries(territories).map(([name, row]) => [name, readWeights(row, `${path}.territories.${name}`)])),
	};
	if (!Object.prototype.hasOwnProperty.call(tables.territories, NO_TERRITORY)) throw new ReaderRangeError(`${path}.territories must have "${NO_TERRITORY}", the ground no stronghold claims`);
	return new CompiledStopTables({ tables, path });
}

/** Compiled tables by the JSON they were read from, so a stage's retries don't compile a map's tables again. */
const compiled = new WeakMap<object, CompiledStopTables>();

/** A map's stop tables: its `stopTables` param, compiled once per object, or the shipped tables when it has none. */
export function stopTablesFor(stopTables: object | undefined): CompiledStopTables {
	if (stopTables === undefined) return STOP_TABLES;
	let tables = compiled.get(stopTables);
	if (!tables) {
		tables = compileStopTables(stopTables, 'stopTables');
		compiled.set(stopTables, tables);
	}
	return tables;
}

function readWeights(value: unknown, path: string): Partial<Record<StopType, number>> {
	const object = readObject(value, path);
	const weights: Partial<Record<StopType, number>> = {};
	for (const [type, weight] of Object.entries(object)) weights[readOneOf(type, `${path}.${type}`, STOP_TYPES)] = readAtLeast(weight, `${path}.${type}`, 0);
	return weights;
}

function readHourSteps(fields: Record<'min' | 'max' | 'step', unknown>, path: string): { min: number; max: number; step: number } {
	const min = readAtLeast(fields.min, `${path}.min`, 0);
	const max = readAtLeast(fields.max, `${path}.max`, min);
	const step = readAtLeast(fields.step, `${path}.step`, 0.01);
	return { min, max, step };
}

function readIntRange(value: unknown, path: string): IntRange {
	const fields = readFields(value, path, ['min', 'max']);
	const min = readInteger(fields.min, `${path}.min`, { min: 0 });
	return { min, max: readInteger(fields.max, `${path}.max`, { min }) };
}

function readShare(value: unknown, path: string): number {
	const share = readNumber(value, path);
	if (share < 0 || share > 1) throw new ReaderRangeError(`${path} must be a share from 0 to 1, got ${share}`);
	return share;
}

function readAtLeast(value: unknown, path: string, min: number): number {
	const number = readNumber(value, path);
	if (number < min) throw new ReaderRangeError(`${path} must be at least ${min}, got ${number}`);
	return number;
}

function mapKeys<Key extends string, Value>(keys: readonly Key[], read: (key: Key) => Value): { [Name in Key]: Value } {
	const out = {} as { [Name in Key]: Value };
	for (const key of keys) out[key] = read(key);
	return out;
}

/** The shipped tuning and tables, read as this module loads, so a bad edit to a file fails straight away. */
export const STOP_TUNING: StopTuning = readStopTuning(stopsFile, 'StopTuning');
export const ROUTE_TUNING: RouteTuning = readRouteTuning(routesFile, 'RouteTuning');
export const STOP_TABLES: CompiledStopTables = compileStopTables(stopTablesFile, 'stopTables');
