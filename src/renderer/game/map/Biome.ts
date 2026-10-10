/**
 * The area map's biomes (Area Map Generation, Pipeline, 1. Terrain): the
 * regions the lore names, read off the terrain fields by thresholds. Ruins
 * aren't a biome; they overlay whatever land they stand on.
 */

/** In the Map Lab's order. */
export const BIOMES = ['scrub', 'desert', 'mire', 'badlands', 'canyons', 'mountains'] as const;
export type Biome = (typeof BIOMES)[number];

export const BIOME_LABELS: { readonly [Name in Biome]: string } = {
	scrub: 'Scrub',
	desert: 'Barren desert',
	mire: 'Toxic mire',
	badlands: 'Badlands',
	canyons: 'Canyons',
	mountains: 'Mountains',
};

/** The fields a biome is read from, each 0 to 1 (see `Terrain`). */
export interface BiomeFields {
	/**
	 * Low ground: 1 well below the map's lowland level, 0.5 at it, 0 well above,
	 * measured for each map's own land, so how much of it is low doesn't follow
	 * how tall the land stands. A stand-in until the water stage (DDB-289)
	 * decides mire from its rivers and lakes.
	 */
	readonly lowland: number;
	readonly moisture: number;
	readonly contamination: number;
	/** Mountain ranges: 1 in range country, its ridges and valleys alike. */
	readonly mountains: number;
	/** Canyons: 1 deep in a valley cut into the land, 0 out of one. */
	readonly canyons: number;
	/** Badlands: 1 on broken, gullied ground. */
	readonly badlands: number;
}

/**
 * Where each biome starts. Starting values for the Map Lab to tune; the
 * parameters move the fields, not these.
 */
export const BIOME_THRESHOLDS = {
	/** Mountains at or above this is mountains. */
	mountains: 0.5,
	/** Canyons at or above this is canyons. */
	canyons: 0.5,
	/** Mire is wet ground, moisture plus a share of contamination at or above this... */
	mireWetness: 0.75,
	/** ...counting contamination at this weight... */
	mireContamination: 0.25,
	/** ...on ground at least this low: below the map's lowland level. */
	mireLowland: 0.5,
	/** Badlands at or above this is badlands... */
	badlands: 0.5,
	/** ...unless it's wetter than this. */
	badlandsMoisture: 0.6,
	/** Drier than this is desert. */
	desertMoisture: 0.3,
} as const;

/**
 * The biome for a set of field values, first match wins: mountains, canyons,
 * mire, badlands, desert, and scrub for the middling rest.
 */
export function classifyBiome(fields: BiomeFields): Biome {
	const thresholds = BIOME_THRESHOLDS;
	if (fields.mountains >= thresholds.mountains) return 'mountains';
	if (fields.canyons >= thresholds.canyons) return 'canyons';
	if (fields.lowland >= thresholds.mireLowland
		&& fields.moisture + thresholds.mireContamination * fields.contamination >= thresholds.mireWetness) return 'mire';
	if (fields.badlands >= thresholds.badlands && fields.moisture < thresholds.badlandsMoisture) return 'badlands';
	if (fields.moisture < thresholds.desertMoisture) return 'desert';
	return 'scrub';
}

/**
 * Travel cost per world unit on flat ground of each biome, scrub 1; the
 * terrain's slope term goes on top. Starting values for growth to tune.
 */
export const BIOME_COSTS: { readonly [Name in Biome]: number } = {
	scrub: 1,
	desert: 1.25,
	canyons: 1.5,
	badlands: 1.8,
	mire: 2.2,
	mountains: 2.5,
};
