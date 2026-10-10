import factionsFile from '../data/factions.json';
import poisFile from '../data/pois.json';
import { ReaderRangeError, freezeJson, readArray, readFields, readInteger, readNumber, readObject, readOneOf, readText } from '../core/JsonReader';
import { BIOMES, Biome } from './Biome';
import { MAP_PARAMETERS } from './MapParams';

/**
 * The POIs stage's tuning, kept in `data/pois.json` and `data/factions.json`
 * so it tunes without a code change (Area Map Generation, 7. POIs and
 * strongholds): where strongholds go and which faction each seats, the
 * rings' targets and spacing, how meeting points are scored, which type of
 * POI a place makes and what each type yields. Every value is a starting
 * value for the Map Lab. The readers are strict: an unknown field, a missing
 * one, or a value out of range throws, naming its path.
 */

/** What a POI can yield: the compound's stores, people aside, who come from finds and events. */
export const POI_RESOURCES = ['food', 'water', 'fuel', 'meds', 'scrap'] as const;
export type PoiResource = (typeof POI_RESOURCES)[number];

export interface ShareRange {
	/** Shares of the map's radius. */
	readonly inner: number;
	readonly outer: number;
}

export interface StrongholdTuning {
	/** The outer band strongholds stand in. */
	readonly band: ShareRange;
	/** The least distance between two strongholds, as a share of the radius. */
	readonly spacing: number;
	/** Steps of the sectors' rotation tried, each a step's share of a sector on from the drawn rotation, before the stage fails. */
	readonly rotationSteps: number;
	/** World units around a site its faction fit also samples, at six points. */
	readonly fitRadius: number;
	/** Up to this much is added to each faction's fit, drawn once a map, so close calls between factions vary. */
	readonly fitJitter: number;
}

export interface RingTuning {
	/** Where the last ring ends, as a share of the radius; rings split the way out from the metro's edge evenly. */
	readonly outer: number;
	/** POIs to aim for in each ring, inner to outer, at poiDensity 1. */
	readonly targets: readonly number[];
}

export interface SiteTuning {
	/** The least distance between any two POIs or strongholds, as a share of the radius. */
	readonly spacing: number;
	/** World units along a meeting stretch between the sites tried on it. */
	readonly step: number;
	/** World units a site keeps from either end of its stretch... */
	readonly margin: number;
	/** ...or this share of the stretch's length, if that's less. */
	readonly marginShare: number;
}

/** How a meeting point scores by geography: the better first. */
export interface ScoreTuning {
	/** Weight of a draw in [0, 1) per site. */
	readonly noise: number;
	/** Weight of ruin there, 0 to 1. */
	readonly ruin: number;
	/** Added within `highwayWithin` world units of a highway. */
	readonly highway: number;
	readonly highwayWithin: number;
	/** Added for a three-way point, since a third route is a soft goal. */
	readonly threeWay: number;
}

/**
 * Where a placement rule holds: every field given has to, and `{}` holds
 * everywhere. A rule holds where any of its conditions does.
 */
export interface SiteCondition {
	readonly ruinAtLeast?: number;
	readonly elevationBelow?: number;
	readonly moistureAtLeast?: number;
	/** World units from the nearest highway. */
	readonly highwayWithin?: number;
	readonly biomes?: readonly Biome[];
}

export interface PlacementRule {
	/** The types a site here can be, picked evenly. */
	readonly types: readonly string[];
	readonly where: readonly SiteCondition[];
}

export interface PoiTypeSpec {
	readonly label: string;
	/** What a successful run brings home, by resource. */
	readonly yields: Readonly<Partial<Record<PoiResource, number>>>;
}

export interface PoiTuning {
	readonly strongholds: StrongholdTuning;
	readonly rings: RingTuning;
	readonly sites: SiteTuning;
	readonly score: ScoreTuning;
	/** Resources the first ring's POIs are typed to yield before location types them (guarantee 7). */
	readonly cover: readonly PoiResource[];
	/** First match wins, so a POI's type comes from where it lands. The last rule holds everywhere. */
	readonly placement: readonly PlacementRule[];
	/** By type name. */
	readonly types: Readonly<Record<string, PoiTypeSpec>>;
}

export interface FactionSpec {
	readonly label: string;
	/** How well land suits the faction's stronghold: a weight per biome (0 when left out), and one for ruins. */
	readonly terrain: {
		readonly biomes: Readonly<Partial<Record<Biome, number>>>;
		readonly ruin: number;
	};
}

/** By faction name, in the order the file lists them. */
export type Factions = Readonly<Record<string, FactionSpec>>;

/** The type a stronghold's POI has: not one of the tuning's types, since a stronghold yields by its own rules. */
export const STRONGHOLD_TYPE = 'stronghold';

const CONDITION_FIELDS = ['ruinAtLeast', 'elevationBelow', 'moistureAtLeast', 'highwayWithin', 'biomes'] as const;

export function readPoiTuning(value: unknown, path: string): PoiTuning {
	const fields = readFields(value, path, ['strongholds', 'rings', 'sites', 'score', 'cover', 'placement', 'types']);
	const types = readTypes(fields.types, `${path}.types`);
	const cover = readArray(fields.cover, `${path}.cover`).map((resource, index) => readOneOf(resource, `${path}.cover[${index}]`, POI_RESOURCES));
	for (const resource of cover) {
		if (!Object.values(types).some(({ yields }) => (yields[resource] ?? 0) > 0)) throw new ReaderRangeError(`${path}.cover lists ${resource}, which no type yields`);
	}
	const tuning: PoiTuning = {
		strongholds: readStrongholds(fields.strongholds, `${path}.strongholds`),
		rings: readRings(fields.rings, `${path}.rings`),
		sites: readSites(fields.sites, `${path}.sites`),
		score: readScore(fields.score, `${path}.score`),
		cover,
		placement: readPlacement(fields.placement, `${path}.placement`, types),
		types,
	};
	return frozen(tuning, path);
}

/** Factions, enough for the most strongholds a map can have, each a different faction. */
export function readFactions(value: unknown, path: string): Factions {
	const object = readObject(value, path);
	const factions: Record<string, FactionSpec> = {};
	for (const [name, spec] of Object.entries(object)) {
		const fields = readFields(spec, `${path}.${name}`, ['label', 'terrain']);
		const terrain = readFields(fields.terrain, `${path}.${name}.terrain`, ['biomes', 'ruin']);
		factions[name] = {
			label: readText(fields.label, `${path}.${name}.label`),
			terrain: {
				biomes: readWeights(terrain.biomes, `${path}.${name}.terrain.biomes`, BIOMES),
				ruin: readAtLeast(terrain.ruin, `${path}.${name}.terrain.ruin`, 0),
			},
		};
	}
	const most = MAP_PARAMETERS.strongholds.tuning.max;
	const count = Object.keys(factions).length;
	if (count < most) throw new ReaderRangeError(`${path} must list at least ${most} factions, one for each of the most strongholds a map can have, got ${count}`);
	return frozen(factions, path);
}

function readStrongholds(value: unknown, path: string): StrongholdTuning {
	const fields = readFields(value, path, ['band', 'spacing', 'rotationSteps', 'fitRadius', 'fitJitter']);
	return {
		band: readShareRange(fields.band, `${path}.band`),
		spacing: readShare(fields.spacing, `${path}.spacing`),
		rotationSteps: readInteger(fields.rotationSteps, `${path}.rotationSteps`, { min: 1 }),
		fitRadius: readAtLeast(fields.fitRadius, `${path}.fitRadius`, 0),
		fitJitter: readAtLeast(fields.fitJitter, `${path}.fitJitter`, 0),
	};
}

function readRings(value: unknown, path: string): RingTuning {
	const fields = readFields(value, path, ['outer', 'targets']);
	const targets = readArray(fields.targets, `${path}.targets`);
	if (targets.length === 0) throw new ReaderRangeError(`${path}.targets must list at least one ring`);
	return {
		outer: readShare(fields.outer, `${path}.outer`, { above: 0 }),
		targets: targets.map((target, index) => readInteger(target, `${path}.targets[${index}]`, { min: 0 })),
	};
}

function readSites(value: unknown, path: string): SiteTuning {
	const fields = readFields(value, path, ['spacing', 'step', 'margin', 'marginShare']);
	const marginShare = readShare(fields.marginShare, `${path}.marginShare`);
	if (marginShare >= 0.5) throw new ReaderRangeError(`${path}.marginShare must be under 0.5, so a stretch keeps room between its margins, got ${marginShare}`);
	return {
		spacing: readShare(fields.spacing, `${path}.spacing`),
		step: readAtLeast(fields.step, `${path}.step`, 1),
		margin: readAtLeast(fields.margin, `${path}.margin`, 0),
		marginShare,
	};
}

function readScore(value: unknown, path: string): ScoreTuning {
	const fields = readFields(value, path, ['noise', 'ruin', 'highway', 'highwayWithin', 'threeWay']);
	return {
		noise: readAtLeast(fields.noise, `${path}.noise`, 0),
		ruin: readAtLeast(fields.ruin, `${path}.ruin`, 0),
		highway: readAtLeast(fields.highway, `${path}.highway`, 0),
		highwayWithin: readAtLeast(fields.highwayWithin, `${path}.highwayWithin`, 0),
		threeWay: readAtLeast(fields.threeWay, `${path}.threeWay`, 0),
	};
}

function readPlacement(value: unknown, path: string, types: Readonly<Record<string, PoiTypeSpec>>): PlacementRule[] {
	const typeNames = Object.keys(types);
	const rules = readArray(value, path).map((rule, index): PlacementRule => {
		const at = `${path}[${index}]`;
		const fields = readFields(rule, at, ['types', 'where']);
		const ruleTypes = readArray(fields.types, `${at}.types`);
		const where = readArray(fields.where, `${at}.where`);
		if (ruleTypes.length === 0) throw new ReaderRangeError(`${at}.types must name at least one type`);
		if (where.length === 0) throw new ReaderRangeError(`${at}.where must list at least one condition`);
		return {
			types: ruleTypes.map((type, place) => readOneOf(type, `${at}.types[${place}]`, typeNames)),
			where: where.map((condition, place) => readCondition(condition, `${at}.where[${place}]`)),
		};
	});
	if (rules.length === 0 || !rules[rules.length - 1].where.some((condition) => Object.keys(condition).length === 0)) {
		throw new ReaderRangeError(`${path} must end with a rule that holds everywhere (a condition of {}), so every POI gets a type`);
	}
	for (const name of typeNames) {
		if (!rules.some((rule) => rule.types.includes(name))) throw new ReaderRangeError(`${path} never places type "${name}"`);
	}
	return rules;
}

function readCondition(value: unknown, path: string): SiteCondition {
	const fields = readFields(value, path, [], CONDITION_FIELDS);
	const condition: { -readonly [Field in keyof SiteCondition]: SiteCondition[Field] } = {};
	if (fields.ruinAtLeast !== undefined) condition.ruinAtLeast = readShare(fields.ruinAtLeast, `${path}.ruinAtLeast`);
	if (fields.elevationBelow !== undefined) condition.elevationBelow = readShare(fields.elevationBelow, `${path}.elevationBelow`);
	if (fields.moistureAtLeast !== undefined) condition.moistureAtLeast = readShare(fields.moistureAtLeast, `${path}.moistureAtLeast`);
	if (fields.highwayWithin !== undefined) condition.highwayWithin = readAtLeast(fields.highwayWithin, `${path}.highwayWithin`, 0);
	if (fields.biomes !== undefined) {
		const biomes = readArray(fields.biomes, `${path}.biomes`);
		if (biomes.length === 0) throw new ReaderRangeError(`${path}.biomes must name at least one biome`);
		condition.biomes = biomes.map((biome, index) => readOneOf(biome, `${path}.biomes[${index}]`, BIOMES));
	}
	return condition;
}

function readTypes(value: unknown, path: string): Record<string, PoiTypeSpec> {
	const object = readObject(value, path);
	const types: Record<string, PoiTypeSpec> = {};
	for (const [name, spec] of Object.entries(object)) {
		if (name === STRONGHOLD_TYPE) throw new ReaderRangeError(`${path}.${name} is the strongholds' own type, which no POI is typed as`);
		const fields = readFields(spec, `${path}.${name}`, ['label', 'yields']);
		const yields = readObject(fields.yields, `${path}.${name}.yields`);
		const amounts: Partial<Record<PoiResource, number>> = {};
		for (const [resource, amount] of Object.entries(yields)) {
			const at = `${path}.${name}.yields.${resource}`;
			amounts[readOneOf(resource, at, POI_RESOURCES)] = readInteger(amount, at, { min: 1 });
		}
		if (Object.keys(amounts).length === 0) throw new ReaderRangeError(`${path}.${name}.yields must yield something`);
		types[name] = { label: readText(fields.label, `${path}.${name}.label`), yields: amounts };
	}
	if (Object.keys(types).length === 0) throw new ReaderRangeError(`${path} must list at least one type`);
	return types;
}

function readWeights<Key extends string>(value: unknown, path: string, keys: readonly Key[]): Partial<Record<Key, number>> {
	const object = readObject(value, path);
	const weights: Partial<Record<Key, number>> = {};
	for (const [key, weight] of Object.entries(object)) weights[readOneOf(key, `${path}.${key}`, keys)] = readAtLeast(weight, `${path}.${key}`, 0);
	return weights;
}

function readShareRange(value: unknown, path: string): ShareRange {
	const fields = readFields(value, path, ['inner', 'outer']);
	const inner = readShare(fields.inner, `${path}.inner`);
	const outer = readShare(fields.outer, `${path}.outer`);
	if (!(inner < outer)) throw new ReaderRangeError(`${path}.inner must be less than ${path}.outer, got ${inner} and ${outer}`);
	return { inner, outer };
}

/** A number from 0 to 1, or above `above` when given. */
function readShare(value: unknown, path: string, { above }: { above?: number } = {}): number {
	const share = readNumber(value, path);
	if (share > 1 || (above === undefined ? share < 0 : share <= above)) {
		throw new ReaderRangeError(`${path} must be a share ${above === undefined ? 'from 0' : `above ${above}`} to 1, got ${share}`);
	}
	return share;
}

function readAtLeast(value: unknown, path: string, min: number): number {
	const number = readNumber(value, path);
	if (number < min) throw new ReaderRangeError(`${path} must be at least ${min}, got ${number}`);
	return number;
}

/** A deep frozen copy of what a reader built, which is JSON all the way down. */
function frozen<Value>(value: Value, path: string): Value {
	return freezeJson(value, path) as unknown as Value;
}

/** The shipped tuning, read as this module loads, so a bad edit to the file fails straight away. */
export const POI_TUNING: PoiTuning = readPoiTuning(poisFile, 'PoiTuning');
export const FACTIONS: Factions = readFactions(factionsFile, 'Factions');
