import type { RGBA } from '../../../engine/draw';
import type { Biome } from '../../map/Biome';
import type { Obstacle } from '../../map/Terrain';
import type { RoadClass } from '../../map/RoadNetwork';
import { tokens } from '../../../engine/theme/tokens';

/**
 * How the area map is drawn: the baked terrain's palette and the live
 * layers' colours and sizes. The terrain and road colours are
 * `scripts/road-growth.mjs png`'s, so the view and the offline pictures in
 * road-growth.md read alike. Sizes are screen pixels at any zoom.
 */

/** 0 to 255 RGB, baked into the terrain texture. */
export type Rgb8 = readonly [number, number, number];

export const BIOME_COLOURS: { readonly [Name in Biome]: Rgb8 } = {
	scrub: [196, 190, 150],
	desert: [226, 208, 160],
	mire: [128, 150, 112],
	badlands: [182, 140, 110],
	canyons: [204, 160, 120],
	mountains: [150, 140, 130],
};

export const OBSTACLE_COLOURS: { readonly [Name in Obstacle]: Rgb8 } = {
	cliff: [90, 30, 30],
	crater: [40, 40, 40],
	water: [70, 110, 170],
};

/** Hill shading: light from the north-west, `1 + (slopeY - slopeX) * gain`, held to [min, max]. */
export const HILL_SHADE = { gain: 60, min: 0.55, max: 1.25 } as const;

/** Ruins darken the land under them by this much at full ruin. */
export const RUIN_SHADE = 0.15;

/** The view's ground past the disc's rim. */
export const MAP_GROUND: RGBA = tokens.color.bg_inset;

export interface RoadStyle {
	readonly color: RGBA;
	/** Screen pixels. */
	readonly width: number;
}

export const ROAD_STYLES: { readonly [Name in RoadClass]: RoadStyle } = {
	highway: { color: [20 / 255, 20 / 255, 20 / 255, 1], width: 3 },
	backRoad: { color: [70 / 255, 60 / 255, 50 / 255, 1], width: 2 },
	trail: { color: [150 / 255, 70 / 255, 30 / 255, 1], width: 1.25 },
};

/**
 * Roads, junctions, and stubs thicken gently as the map zooms in, so a close
 * view doesn't draw hairlines and the whole map isn't a tangle: by
 * (zoom / reference)^power, held to [min, max].
 */
export const ROAD_ZOOM_WIDTH = { reference: 0.5, power: 0.4, min: 0.8, max: 1.8 } as const;

/** The factor road widths are drawn at, at `zoom` screen pixels per world unit. */
export function roadWidthScale(zoom: number): number {
	const { reference, power, min, max } = ROAD_ZOOM_WIDTH;
	return Math.max(min, Math.min(max, (zoom / reference) ** power));
}

/**
 * A rumored road is solid but paler: its colour mixed this far toward the
 * land's. Opaque rather than translucent, since a translucent polyline is
 * darker where its segments overlap at the joints.
 */
export const RUMORED_FADE = 0.45;
export const RUMORED_TOWARD: RGBA = [196 / 255, 190 / 255, 150 / 255, 1];

/** An uncharted stretch: dashes from where it leaves known road, fading out over `length` world units. */
export const UNCHARTED_STUB = {
	length: 140,
	/** Screen pixels. */
	dash: 7,
	gap: 5,
} as const;

/** Highlight under a selected stretch, wider than any class. */
export const SELECTED_ROAD = { color: tokens.color.accent, width: 7 } as const;

export const JUNCTION = { color: [20 / 255, 20 / 255, 20 / 255, 1] as RGBA, radius: 2.5 } as const;

export const COMPOUND = {
	size: 12,
	fill: [20 / 255, 20 / 255, 20 / 255, 1] as RGBA,
	border: [1, 1, 1, 1] as RGBA,
	label: 'Home',
} as const;

export const MARKER = {
	/** A POI's disc. */
	radius: 7,
	stronghold: 11,
	ring: 2,
	fill: [1, 1, 1, 1] as RGBA,
	ink: [20 / 255, 20 / 255, 20 / 255, 1] as RGBA,
	/** A looted or depleted POI's ring and mark. */
	spent: [0.42, 0.42, 0.4, 1] as RGBA,
	/** Screen pixels around a marker's centre that pick it. */
	pickRadius: 14,
} as const;

export const LABEL = {
	font: 'body',
	size: tokens.fontSize.fs_sm,
	color: [20 / 255, 20 / 255, 20 / 255, 1] as RGBA,
	background: [1, 1, 1, 0.88] as RGBA,
	padX: 4,
	height: 18,
	/** Gap between a marker's edge and its label. */
	gap: 6,
} as const;

/** Screen pixels from a drawn road that pick it. */
export const ROAD_PICK_DISTANCE = 6;

/**
 * Land fog: a pale wash over hidden land, the terrain faint beneath it. Not
 * hatched as the wireframe draws it: hatching baked into the map scales with
 * the zoom, and drawn on screen it would need a mask the uber shader can't
 * take, so a plain wash reads the same at every zoom.
 */
export const FOG = {
	color: [214, 214, 206] as Rgb8,
	alpha: 0.86,
	/** Texels in the fog texture per fog cell. */
	texelsPerCell: 8,
} as const;
