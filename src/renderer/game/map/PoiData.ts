import factionsFile from '../data/factions.json';
import poisFile from '../data/pois.json';
import { readArray, readFields, readInteger, readNumber, readObject, readOneOf, readText } from '../campaign/JsonReader';
import { BIOMES, Biome } from './Biome';
import { MAP_PARAMETERS } from './MapParams';

/**
 * Stage 5's tuning, kept in `data/pois.json` and `data/factions.json` so it
 * tunes without a code change (Area Map Generation, 5. POIs and their
 * approaches): where strongholds and POIs go, how approaches grow, which
 * type of POI a place makes and what each type yields, and the land each
 * faction's stronghold wants. Every value is a starting value for the Map
 * Lab, and the readers here are strict: an unknown field, a missing one, or
 * a value out of range throws, naming its path.
 */

/** What a POI can yield: the compound's stores, people aside, who come from finds and events. */
export const POI_RESOURCES = ['food', 'water', 'fuel', 'meds', 'scrap'] as const;
export type PoiResource = (typeof POI_RESOURCES)[number];

/**
 * A length that scales with the map but never shrinks below a number of
 * road clearances: the larger of `share` of the radius and `clearances`
 * times `roadClearance`, so wide clearances on small maps still leave room.
 */
export interface MapLength {
	readonly share: number;
	readonly clearances: number;
}

/** A `MapLength` in world units. */
export function lengthOf({ share, clearances }: MapLength, radius: number, clearance: number): number {
	const scaled = share * radius;
	const floor = clearances * clearance;
	return scaled > floor ? scaled : floor;
}

export interface ShareRange {
	/** Shares of the map's radius. */
	readonly inner: number;
	readonly outer: number;
}

export interface StrongholdTuning {
	/** The outer band strongholds stand in. */
	readonly band: ShareRange;
	/** How far from a road a stronghold's approach can start: further than a POI's, since the outer band's roads are sparse. */
	readonly reach: MapLength;
	/** Sites drawn in each sector. */
	readonly candidates: number;
	/** World units around a site its terrain fit also samples, at six points. */
	readonly fitRadius: number;
	/** Up to this much is added to each faction's fit, drawn once a map, so close calls between factions vary. */
	readonly fitJitter: number;
}

export interface RingTuning {
	/** Where the last ring ends, as a share of the radius; rings split the way out from the metro's edge evenly. */
	readonly outer: number;
	/** POIs to place in each ring, inner to outer, at poiDensity 1. */
	readonly targets: readonly number[];
}

export interface SiteTuning {
	/** The least distance between any two POIs or strongholds: the Poisson-disc spacing. */
	readonly spacing: MapLength;
	/** A dart away from ruins is kept this share of the time, one in ruins always, so ruins hold more POIs. */
	readonly ruinFloor: number;
	/** Darts thrown in a ring per POI it targets, before the ring gives up. */
	readonly darts: number;
}

export interface SteerTuning {
	/** Weight of the travel cost at a step's end... */
	readonly cost: number;
	/** ...and of the cost this many steps further on. */
	readonly lookahead: number;
	readonly lookaheadSteps: number;
	/** Weight of straying from the way to the POI. */
	readonly homing: number;
	/** Weight of a draw in [0, 1) per candidate. */
	readonly noise: number;
}

export interface ApproachTuning {
	/** How far from a road an approach can start. */
	readonly reach: MapLength;
	/**
	 * The home area, as a share of the radius beyond the metro's edge: road
	 * within the metro's radius plus this, measured along the roads from the
	 * compound. Two routes to a POI may share road only inside it.
	 */
	readonly home: number;
	/** World units an approach keeps from either end of the stretch it leaves, so no stretch is left a stub. */
	readonly nodeMargin: number;
	/** World units along a stretch between the points an approach can leave it from. */
	readonly attachSpacing: number;
	/** Attach points in each group whose straight line to a site is checked for other roads in the way, cheapest first... */
	readonly sightChecks: number;
	/** ...and of those with a clear line, how many are grown from before the group is passed over. */
	readonly triesPerGroup: number;
	/** An approach gives up past this many times the straight distance to its POI. */
	readonly detour: number;
	/** Within this many steps of the POI, an approach runs straight in if its turn limit lets it. */
	readonly arrival: number;
	readonly steer: SteerTuning;
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
	readonly approaches: ApproachTuning;
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

const CONDITION_FIELDS = ['ruinAtLeast', 'elevationBelow', 'moistureAtLeast', 'highwayWithin', 'biomes'] as const;

export function readPoiTuning(value: unknown, path: string): PoiTuning {
	const fields = readFields(value, path, ['strongholds', 'rings', 'sites', 'approaches', 'placement', 'types']);
	const types = readTypes(fields.types, `${path}.types`);
	const tuning: PoiTuning = {
		strongholds: readStrongholds(fields.strongholds, `${path}.strongholds`),
		rings: readRings(fields.rings, `${path}.rings`),
		sites: readSites(fields.sites, `${path}.sites`),
		approaches: readApproaches(fields.approaches, `${path}.approaches`),
		placement: readPlacement(fields.placement, `${path}.placement`, types),
		types,
	};
	return freezeDeep(tuning);
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
	if (count < most) throw new RangeError(`${path} must list at least ${most} factions, one for each of the most strongholds a map can have, got ${count}`);
	return freezeDeep(factions);
}

function readStrongholds(value: unknown, path: string): StrongholdTuning {
	const fields = readFields(value, path, ['band', 'reach', 'candidates', 'fitRadius', 'fitJitter']);
	return {
		band: readShareRange(fields.band, `${path}.band`),
		reach: readLength(fields.reach, `${path}.reach`),
		candidates: readInteger(fields.candidates, `${path}.candidates`, { min: 1 }),
		fitRadius: readAtLeast(fields.fitRadius, `${path}.fitRadius`, 0),
		fitJitter: readAtLeast(fields.fitJitter, `${path}.fitJitter`, 0),
	};
}

function readRings(value: unknown, path: string): RingTuning {
	const fields = readFields(value, path, ['outer', 'targets']);
	const targets = readArray(fields.targets, `${path}.targets`);
	if (targets.length === 0) throw new RangeError(`${path}.targets must list at least one ring`);
	return {
		outer: readShare(fields.outer, `${path}.outer`, { above: 0 }),
		targets: targets.map((target, index) => readInteger(target, `${path}.targets[${index}]`, { min: 0 })),
	};
}

function readSites(value: unknown, path: string): SiteTuning {
	const fields = readFields(value, path, ['spacing', 'ruinFloor', 'darts']);
	return {
		spacing: readLength(fields.spacing, `${path}.spacing`),
		ruinFloor: readShare(fields.ruinFloor, `${path}.ruinFloor`),
		darts: readInteger(fields.darts, `${path}.darts`, { min: 1 }),
	};
}

function readApproaches(value: unknown, path: string): ApproachTuning {
	const fields = readFields(value, path, ['reach', 'home', 'nodeMargin', 'attachSpacing', 'sightChecks', 'triesPerGroup', 'detour', 'arrival', 'steer']);
	const steer = readFields(fields.steer, `${path}.steer`, ['cost', 'lookahead', 'lookaheadSteps', 'homing', 'noise']);
	return {
		reach: readLength(fields.reach, `${path}.reach`),
		home: readShare(fields.home, `${path}.home`),
		nodeMargin: readAtLeast(fields.nodeMargin, `${path}.nodeMargin`, 0),
		attachSpacing: readAtLeast(fields.attachSpacing, `${path}.attachSpacing`, 0),
		sightChecks: readInteger(fields.sightChecks, `${path}.sightChecks`, { min: 1 }),
		triesPerGroup: readInteger(fields.triesPerGroup, `${path}.triesPerGroup`, { min: 1 }),
		detour: readAtLeast(fields.detour, `${path}.detour`, 1),
		arrival: readAtLeast(fields.arrival, `${path}.arrival`, 1),
		steer: {
			cost: readAtLeast(steer.cost, `${path}.steer.cost`, 0),
			lookahead: readAtLeast(steer.lookahead, `${path}.steer.lookahead`, 0),
			lookaheadSteps: readAtLeast(steer.lookaheadSteps, `${path}.steer.lookaheadSteps`, 0),
			homing: readAtLeast(steer.homing, `${path}.steer.homing`, 0),
			noise: readAtLeast(steer.noise, `${path}.steer.noise`, 0),
		},
	};
}

function readPlacement(value: unknown, path: string, types: Readonly<Record<string, PoiTypeSpec>>): PlacementRule[] {
	const typeNames = Object.keys(types);
	const rules = readArray(value, path).map((rule, index): PlacementRule => {
		const at = `${path}[${index}]`;
		const fields = readFields(rule, at, ['types', 'where']);
		const ruleTypes = readArray(fields.types, `${at}.types`);
		const where = readArray(fields.where, `${at}.where`);
		if (ruleTypes.length === 0) throw new RangeError(`${at}.types must name at least one type`);
		if (where.length === 0) throw new RangeError(`${at}.where must list at least one condition`);
		return {
			types: ruleTypes.map((type, place) => readOneOf(type, `${at}.types[${place}]`, typeNames)),
			where: where.map((condition, place) => readCondition(condition, `${at}.where[${place}]`)),
		};
	});
	if (rules.length === 0 || !rules[rules.length - 1].where.some((condition) => Object.keys(condition).length === 0)) {
		throw new RangeError(`${path} must end with a rule that holds everywhere (a condition of {}), so every POI gets a type`);
	}
	for (const name of typeNames) {
		if (!rules.some((rule) => rule.types.includes(name))) throw new RangeError(`${path} never places type "${name}"`);
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
		if (biomes.length === 0) throw new RangeError(`${path}.biomes must name at least one biome`);
		condition.biomes = biomes.map((biome, index) => readOneOf(biome, `${path}.biomes[${index}]`, BIOMES));
	}
	return condition;
}

function readTypes(value: unknown, path: string): Record<string, PoiTypeSpec> {
	const object = readObject(value, path);
	const types: Record<string, PoiTypeSpec> = {};
	for (const [name, spec] of Object.entries(object)) {
		const fields = readFields(spec, `${path}.${name}`, ['label', 'yields']);
		const yields = readObject(fields.yields, `${path}.${name}.yields`);
		const amounts: Partial<Record<PoiResource, number>> = {};
		for (const [resource, amount] of Object.entries(yields)) {
			const at = `${path}.${name}.yields.${resource}`;
			amounts[readOneOf(resource, at, POI_RESOURCES)] = readInteger(amount, at, { min: 1 });
		}
		if (Object.keys(amounts).length === 0) throw new RangeError(`${path}.${name}.yields must yield something`);
		types[name] = { label: readText(fields.label, `${path}.${name}.label`), yields: amounts };
	}
	if (Object.keys(types).length === 0) throw new RangeError(`${path} must list at least one type`);
	return types;
}

function readWeights<Key extends string>(value: unknown, path: string, keys: readonly Key[]): Partial<Record<Key, number>> {
	const object = readObject(value, path);
	const weights: Partial<Record<Key, number>> = {};
	for (const [key, weight] of Object.entries(object)) weights[readOneOf(key, `${path}.${key}`, keys)] = readAtLeast(weight, `${path}.${key}`, 0);
	return weights;
}

function readLength(value: unknown, path: string): MapLength {
	const fields = readFields(value, path, ['share', 'clearances']);
	return {
		share: readShare(fields.share, `${path}.share`, { above: 0 }),
		clearances: readAtLeast(fields.clearances, `${path}.clearances`, 0),
	};
}

function readShareRange(value: unknown, path: string): ShareRange {
	const fields = readFields(value, path, ['inner', 'outer']);
	const inner = readShare(fields.inner, `${path}.inner`);
	const outer = readShare(fields.outer, `${path}.outer`);
	if (!(inner < outer)) throw new RangeError(`${path}.inner must be less than ${path}.outer, got ${inner} and ${outer}`);
	return { inner, outer };
}

/** A number from 0 to 1, or above `above` when given. */
function readShare(value: unknown, path: string, { above }: { above?: number } = {}): number {
	const share = readNumber(value, path);
	if (share > 1 || (above === undefined ? share < 0 : share <= above)) {
		throw new RangeError(`${path} must be a share ${above === undefined ? 'from 0' : `above ${above}`} to 1, got ${share}`);
	}
	return share;
}

function readAtLeast(value: unknown, path: string, min: number): number {
	const number = readNumber(value, path);
	if (number < min) throw new RangeError(`${path} must be at least ${min}, got ${number}`);
	return number;
}

function freezeDeep<Value>(value: Value): Value {
	if (typeof value === 'object' && value !== null) {
		for (const item of Object.values(value)) freezeDeep(item);
		Object.freeze(value);
	}
	return value;
}

/** The shipped tuning, read as this module loads, so a bad edit to the file fails straight away. */
export const POI_TUNING: PoiTuning = readPoiTuning(poisFile, 'PoiTuning');
export const FACTIONS: Factions = readFactions(factionsFile, 'Factions');
