/**
 * The area map's biomes (Area Map Generation, Pipeline, 3. Biomes, hazards,
 * and cost): the regions the lore names, read off the land's and the
 * water's fields by thresholds, as categories the game reads (stop tables,
 * POI types, faction fit). The map never paints them: its colour is a blend
 * of the fields. Ruins aren't a biome; they overlay whatever land they stand
 * on.
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
	/** Low ground: 1 barely above the river or lake the ground drains to, 0.5 a few world units up, 0 well above it. */
	readonly lowland: number;
	readonly moisture: number;
	readonly contamination: number;
	/** Mountain ranges: 1 in range country, its ridges and valleys alike. */
	readonly mountains: number;
	/** Canyons: 1 deep in a river valley cut into dry country, 0 out of one. */
	readonly canyons: number;
	/** Badlands: 1 on the most broken ground outside the ranges, the toxic above all. */
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
