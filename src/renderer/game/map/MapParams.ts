/**
 * The area map's parameters (Area Map Generation, Map parameters): the seed,
 * the environment, and the tunable characteristics every generation stage
 * reads. `MAP_PARAMETERS` is the one table of them, which the parameter
 * validator, `rollParams`, and the Map Lab's controls are all built from.
 */

import type { JsonValue } from '../core/Json';

/**
 * Stop type weights per road class, biome, tier, and territory, in place of
 * the shipped tables. Absent means the shipped tables. The stops stage owns
 * the shape; here it only has to be JSON, since params are saved.
 */
export type StopTables = { [key: string]: JsonValue };

export const ENVIRONMENTS = ['highDesert', 'rustBelt', 'floodlands', 'badlands', 'mixed'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export type ParamGroup = 'world' | 'network' | 'gameplay' | 'scenery';

/** The groups in the Map Lab's order, with their headings. */
export const PARAM_GROUPS: readonly { readonly group: ParamGroup; readonly label: string }[] = [
	{ group: 'world', label: 'World' },
	{ group: 'network', label: 'Drivable network' },
	{ group: 'gameplay', label: 'Gameplay' },
	{ group: 'scenery', label: 'Scenery' },
];

/**
 * Everything generation reads. Plain JSON, so a campaign save and a preset
 * can hold it; a type rather than an interface so it fits `JsonObject`.
 */
export type MapParams = {
	/** uint32; every random stream derives from it. */
	seed: number;
	environment: Environment;

	/** World units: the disc's radius. */
	radius: number;
	aridity: number;
	mountainCoverage: number;
	ruggedness: number;
	rivers: number;
	riverMeander: number;
	lakes: number;
	contamination: number;
	hotspots: number;
	/** The metro ruins' radius as a share of `radius`. */
	metroSize: number;
	towns: number;

	highways: number;
	/** Degrees between neighbouring departures. */
	highwaySeparation: number;
	curviness: number;
	branchiness: number;
	trailShare: number;
	/** World units. */
	roadClearance: number;

	strongholds: number;
	poiDensity: number;
	routesTarget: number;
	/** Tiers. */
	startingReveal: number;
	stopDensity: number;
	dangerCurve: number;
	driverFinds: number;
	daylightHours: number;
	travelPace: number;
	stopTables?: StopTables;

	sceneryDensity: number;
	streetGrids: number;
	countyRoads: number;
	brokenHighways: number;
	railLines: number;
	farmTracks: number;
};

/** The parameters with a row in the table: everything but the seed and stop tables. */
export type ParamName = Exclude<keyof MapParams, 'seed' | 'stopTables'>;
/** The number parameters: every row but the environment, and the ones an environment can set. */
export type NumberParam = Exclude<ParamName, 'environment'>;

export interface ParamRange {
	readonly min: number;
	readonly max: number;
}

export interface NumberParamSpec {
	readonly group: ParamGroup;
	readonly kind: 'int' | 'float';
	readonly label: string;
	/** What the Map Lab allows and the guarantees must survive. */
	readonly tuning: ParamRange;
	/** The Map Lab control's increment, and the grid rolled values land on. */
	readonly step: number;
	/** The value when the environment doesn't set one. Mixed sets none, so these are Mixed's. */
	readonly default: number;
	/** What `rollParams` draws from: inside the tuning range, and around every environment's value. */
	readonly campaign: ParamRange;
}

export interface EnumOption<Value extends string> {
	readonly value: Value;
	readonly label: string;
}

export interface EnumParamSpec<Value extends string> {
	readonly group: ParamGroup;
	readonly kind: 'enum';
	readonly label: string;
	/** The tuning range: every value, in the Map Lab's order. */
	readonly options: readonly EnumOption<Value>[];
	readonly default: Value;
	/** The values `rollParams` picks from, evenly. */
	readonly campaign: readonly Value[];
}

export type ParamSpec = NumberParamSpec | EnumParamSpec<Environment>;

/**
 * Every parameter, in the Map Lab's order. Tuning ranges and defaults are
 * the spec's starting values, and campaign ranges are starting values too.
 * A roll centres on the environment's value and reaches at most half the
 * campaign range either side, so each campaign range holds every
 * environment's value and has each end within that reach of one of them: a
 * range no environment moves sits evenly round its default.
 */
export const MAP_PARAMETERS: { readonly environment: EnumParamSpec<Environment> } & { readonly [Name in NumberParam]: NumberParamSpec } = {
	environment: {
		group: 'world', kind: 'enum', label: 'Environment',
		options: [
			{ value: 'highDesert', label: 'High Desert' },
			{ value: 'rustBelt', label: 'Rust Belt' },
			{ value: 'floodlands', label: 'Floodlands' },
			{ value: 'badlands', label: 'Badlands' },
			{ value: 'mixed', label: 'Mixed' },
		],
		default: 'mixed',
		campaign: ENVIRONMENTS,
	},
	radius: {
		group: 'world', kind: 'int', label: 'Radius',
		tuning: { min: 600, max: 1600 }, step: 50, default: 1000, campaign: { min: 800, max: 1200 },
	},
	aridity: {
		group: 'world', kind: 'float', label: 'Aridity',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.5, campaign: { min: 0.1, max: 0.9 },
	},
	mountainCoverage: {
		group: 'world', kind: 'float', label: 'Mountains',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.25, campaign: { min: 0.05, max: 0.45 },
	},
	ruggedness: {
		group: 'world', kind: 'float', label: 'Ruggedness',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.5, campaign: { min: 0.15, max: 0.85 },
	},
	rivers: {
		group: 'world', kind: 'int', label: 'Rivers',
		tuning: { min: 0, max: 6 }, step: 1, default: 2, campaign: { min: 0, max: 5 },
	},
	riverMeander: {
		group: 'world', kind: 'float', label: 'River meander',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.5, campaign: { min: 0.2, max: 0.8 },
	},
	lakes: {
		group: 'world', kind: 'int', label: 'Lakes',
		tuning: { min: 0, max: 8 }, step: 1, default: 2, campaign: { min: 0, max: 6 },
	},
	contamination: {
		group: 'world', kind: 'float', label: 'Contamination',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.3, campaign: { min: 0.1, max: 0.7 },
	},
	hotspots: {
		group: 'world', kind: 'int', label: 'Hotspots',
		tuning: { min: 0, max: 6 }, step: 1, default: 3, campaign: { min: 1, max: 5 },
	},
	metroSize: {
		group: 'world', kind: 'float', label: 'Metro size',
		tuning: { min: 0.08, max: 0.25 }, step: 0.01, default: 0.15, campaign: { min: 0.12, max: 0.2 },
	},
	towns: {
		group: 'world', kind: 'int', label: 'Towns',
		tuning: { min: 0, max: 12 }, step: 1, default: 5, campaign: { min: 2, max: 9 },
	},
	highways: {
		group: 'network', kind: 'int', label: 'Highways',
		tuning: { min: 3, max: 9 }, step: 1, default: 6, campaign: { min: 5, max: 7 },
	},
	highwaySeparation: {
		group: 'network', kind: 'int', label: 'Highway separation',
		tuning: { min: 20, max: 60 }, step: 1, default: 35, campaign: { min: 25, max: 45 },
	},
	curviness: {
		group: 'network', kind: 'float', label: 'Curviness',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.5, campaign: { min: 0.25, max: 0.75 },
	},
	branchiness: {
		group: 'network', kind: 'float', label: 'Branchiness',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.5, campaign: { min: 0.3, max: 0.7 },
	},
	trailShare: {
		group: 'network', kind: 'float', label: 'Trail share',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.5, campaign: { min: 0.25, max: 0.75 },
	},
	roadClearance: {
		group: 'network', kind: 'int', label: 'Road clearance',
		tuning: { min: 10, max: 60 }, step: 1, default: 24, campaign: { min: 20, max: 28 },
	},
	strongholds: {
		group: 'gameplay', kind: 'int', label: 'Strongholds',
		tuning: { min: 2, max: 8 }, step: 1, default: 4, campaign: { min: 3, max: 5 },
	},
	poiDensity: {
		group: 'gameplay', kind: 'float', label: 'POI density',
		tuning: { min: 0.5, max: 2 }, step: 0.1, default: 1, campaign: { min: 0.8, max: 1.2 },
	},
	routesTarget: {
		group: 'gameplay', kind: 'int', label: 'Routes per POI',
		tuning: { min: 2, max: 3 }, step: 1, default: 3, campaign: { min: 3, max: 3 },
	},
	startingReveal: {
		group: 'gameplay', kind: 'int', label: 'Starting reveal',
		tuning: { min: 1, max: 2 }, step: 1, default: 1, campaign: { min: 1, max: 1 },
	},
	stopDensity: {
		group: 'gameplay', kind: 'float', label: 'Stop density',
		tuning: { min: 0.5, max: 2 }, step: 0.1, default: 1, campaign: { min: 0.8, max: 1.2 },
	},
	dangerCurve: {
		group: 'gameplay', kind: 'float', label: 'Danger curve',
		tuning: { min: 0.5, max: 2 }, step: 0.1, default: 1, campaign: { min: 0.9, max: 1.1 },
	},
	driverFinds: {
		group: 'gameplay', kind: 'int', label: 'Driver finds',
		tuning: { min: 1, max: 4 }, step: 1, default: 2, campaign: { min: 2, max: 2 },
	},
	daylightHours: {
		group: 'gameplay', kind: 'float', label: 'Daylight hours',
		tuning: { min: 10, max: 16 }, step: 0.5, default: 14, campaign: { min: 13, max: 15 },
	},
	travelPace: {
		group: 'gameplay', kind: 'float', label: 'Travel pace',
		tuning: { min: 0.5, max: 2 }, step: 0.1, default: 1, campaign: { min: 0.9, max: 1.1 },
	},
	sceneryDensity: {
		group: 'scenery', kind: 'float', label: 'Density',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.6, campaign: { min: 0.4, max: 0.8 },
	},
	streetGrids: {
		group: 'scenery', kind: 'float', label: 'Street grids',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.7, campaign: { min: 0.5, max: 0.9 },
	},
	countyRoads: {
		group: 'scenery', kind: 'float', label: 'County roads',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.5, campaign: { min: 0.2, max: 0.7 },
	},
	brokenHighways: {
		group: 'scenery', kind: 'int', label: 'Broken highways',
		tuning: { min: 0, max: 4 }, step: 1, default: 2, campaign: { min: 1, max: 3 },
	},
	railLines: {
		group: 'scenery', kind: 'int', label: 'Rail lines',
		tuning: { min: 0, max: 4 }, step: 1, default: 1, campaign: { min: 0, max: 3 },
	},
	farmTracks: {
		group: 'scenery', kind: 'float', label: 'Farm tracks',
		tuning: { min: 0, max: 1 }, step: 0.05, default: 0.4, campaign: { min: 0.1, max: 0.6 },
	},
};

/** Every parameter with a row, in table order. */
export const PARAM_NAMES = Object.keys(MAP_PARAMETERS) as readonly ParamName[];
export const NUMBER_PARAMS: readonly NumberParam[] = PARAM_NAMES.filter((name): name is NumberParam => name !== 'environment');

/**
 * What each environment sets over the table's defaults: world, drivable
 * network, and scenery parameters, never gameplay ones, so the land changes
 * and the rules don't. Mixed sets nothing. Starting values for the Map Lab
 * to tune, read from the spec's descriptions: aridity runs from dry desert
 * (0) to wet ground and mire (1), the Floodlands are wet with rivers and
 * lakes, the Badlands rough and contaminated.
 */
export const ENVIRONMENT_PRESETS: { readonly [Name in Environment]: Readonly<Partial<Record<NumberParam, number>>> } = {
	// Dry tableland cut by canyons: long straight roads, few towns or farms.
	highDesert: {
		aridity: 0.15, mountainCoverage: 0.35, ruggedness: 0.65, rivers: 1, riverMeander: 0.3, lakes: 0,
		contamination: 0.2, hotspots: 2, towns: 3, curviness: 0.4, branchiness: 0.4, countyRoads: 0.3, farmTracks: 0.15,
	},
	// Old industry in rolling river country: dense ruins, spills, rail, and paved roads.
	rustBelt: {
		aridity: 0.55, mountainCoverage: 0.15, ruggedness: 0.35, rivers: 3, contamination: 0.45, hotspots: 4,
		metroSize: 0.18, towns: 8, branchiness: 0.6, trailShare: 0.35, streetGrids: 0.85, countyRoads: 0.65,
		brokenHighways: 3, railLines: 3,
	},
	// Low, wet, and flat: looping rivers, standing water, mire, and roads that wind around it.
	floodlands: {
		aridity: 0.85, mountainCoverage: 0.05, ruggedness: 0.25, rivers: 5, riverMeander: 0.75, lakes: 6,
		contamination: 0.4, curviness: 0.6, farmTracks: 0.5,
	},
	// Broken, toxic ground: sharp relief, blast sites, and roads that give out to trails.
	badlands: {
		aridity: 0.3, mountainCoverage: 0.35, ruggedness: 0.8, rivers: 1, lakes: 1, contamination: 0.6, hotspots: 5,
		towns: 3, curviness: 0.65, trailShare: 0.7, countyRoads: 0.25, farmTracks: 0.1,
	},
	mixed: {},
};

/** Every number parameter's default under an environment. */
export function environmentDefaults(environment: Environment): Record<NumberParam, number> {
	// An unknown name falls back to the table, for the validator to report.
	const preset: Partial<Record<NumberParam, number>> = ENVIRONMENT_PRESETS[environment] ?? {};
	const values = {} as Record<NumberParam, number>;
	for (const name of NUMBER_PARAMS) values[name] = preset[name] ?? MAP_PARAMETERS[name].default;
	return values;
}

/**
 * What a person sets: a seed, an environment (Mixed when absent), and the
 * values that override the environment's. A preset file is one, and so is
 * a complete `MapParams`, with every value an override.
 */
export type MapParamSet = Pick<MapParams, 'seed'> & Partial<Omit<MapParams, 'seed'>>;

/** Where a value came from: the table's default, the environment, or an override. */
export type ParamSource = 'default' | 'environment' | 'override';

export interface ResolvedMapParams {
	readonly params: MapParams;
	/** Per number parameter, so the Map Lab can draw overrides apart from the environment's values. */
	readonly sources: Readonly<Record<NumberParam, ParamSource>>;
}

/**
 * A parameter set filled out: the environment's defaults with the set's
 * overrides over them. Validation is separate (`validateMapParams`), so a
 * value outside its range comes back as it was set.
 */
export function resolveMapParams(set: MapParamSet): ResolvedMapParams {
	const environment = set.environment ?? MAP_PARAMETERS.environment.default;
	const preset: Partial<Record<NumberParam, number>> = ENVIRONMENT_PRESETS[environment] ?? {};
	const values = {} as Record<NumberParam, number>;
	const sources = {} as Record<NumberParam, ParamSource>;
	for (const name of NUMBER_PARAMS) {
		const override = set[name];
		const fromPreset = preset[name];
		if (override !== undefined) {
			values[name] = override;
			sources[name] = 'override';
		} else if (fromPreset !== undefined) {
			values[name] = fromPreset;
			sources[name] = 'environment';
		} else {
			values[name] = MAP_PARAMETERS[name].default;
			sources[name] = 'default';
		}
	}
	const params: MapParams = { seed: set.seed, environment, ...values };
	if (set.stopTables !== undefined) params.stopTables = set.stopTables;
	return { params, sources };
}
