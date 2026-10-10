import type { RGBA } from '../../../engine/draw';
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

/**
 * The land's colour, a continuous blend rather than biome patches (Area Map
 * Generation, Rendering): dry ground buff, middling ground khaki, wet ground
 * sage, by moisture; warming to grey-brown in high country, from elevation
 * `high.from` to `high.to`; and tinted rust by contamination, up to
 * `toxic.weight` of the way. A functional first pass; the atlas styling
 * (Map 19) tunes it.
 */
export const LAND_COLOURS = {
	dry: [226, 208, 160] as Rgb8,
	middling: [200, 194, 152] as Rgb8,
	wet: [150, 172, 128] as Rgb8,
	high: { colour: [160, 146, 128] as Rgb8, from: 0.2, to: 0.6 },
	toxic: { colour: [176, 112, 80] as Rgb8, weight: 0.2 },
} as const;

/** The land's colour for its fields, 0 to 255 each, into `out`. Returns `out`. */
export function landColour(elevation: number, moisture: number, contamination: number, out: number[]): number[] {
	const { dry, middling, wet, high, toxic } = LAND_COLOURS;
	const wetness = moisture < 0 ? 0 : moisture > 1 ? 1 : moisture;
	const from = wetness < 0.5 ? dry : middling;
	const to = wetness < 0.5 ? middling : wet;
	const along = wetness < 0.5 ? wetness * 2 : wetness * 2 - 1;
	const height = Math.max(0, Math.min(1, (elevation - high.from) / (high.to - high.from)));
	const tint = Math.max(0, Math.min(1, contamination)) * toxic.weight;
	for (let channel = 0; channel < 3; channel++) {
		let value = from[channel] + (to[channel] - from[channel]) * along;
		value += (high.colour[channel] - value) * height;
		out[channel] = value + (toxic.colour[channel] - value) * tint;
	}
	return out;
}

/** What makes ground impassable, baked: cliffs and craters, and lakes, filled with a darker shore. Rivers draw live. */
export const OBSTACLE_COLOURS = {
	cliff: [90, 30, 30] as Rgb8,
	crater: [40, 40, 40] as Rgb8,
	lake: [96, 138, 186] as Rgb8,
	shore: [52, 86, 140] as Rgb8,
} as const;

/** Rivers, drawn live under the roads: their world width, never under `minPixels` on screen, and fainter past the rim. */
export const RIVER_STYLE = {
	color: [96 / 255, 138 / 255, 186 / 255, 1] as RGBA,
	outside: [96 / 255, 138 / 255, 186 / 255, 0.35] as RGBA,
	minPixels: 1,
	/** World units widths are rounded to, so a river draws as a few runs of one width each. */
	widthStep: 0.75,
} as const;

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
