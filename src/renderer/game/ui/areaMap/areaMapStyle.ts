import type { RGBA } from '../../../engine/draw';
import type { RoadClass } from '../../map/RoadNetwork';
import { tokens } from '../../../engine/theme/tokens';

/**
 * How the area map is drawn: the baked terrain's palette and the live
 * layers' colours and sizes. Sizes are screen pixels at any zoom.
 */

/** 0 to 255 RGB, baked into the terrain texture. */
export type Rgb8 = readonly [number, number, number];

/**
 * The atlas's paper: the view's ground past the disc, what the land fades
 * to at the rim, and the halo round every label on the map.
 */
export const PAPER: Rgb8 = [244, 241, 233];

/**
 * The land's colour, a continuous blend rather than biome patches (Area Map
 * Generation, Rendering: the road atlas): dry ground buff, middling ground
 * pale khaki, wet ground sage, by moisture; warming to grey-brown in high
 * country, from elevation `high.from` to `high.to`; and tinted rust by
 * contamination, up to `toxic.weight` of the way. Light and muted, a printed
 * page's tints, so the roads and labels carry the map.
 */
export const LAND_COLOURS = {
	dry: [235, 229, 207] as Rgb8,
	middling: [229, 228, 209] as Rgb8,
	wet: [214, 221, 199] as Rgb8,
	high: { colour: [212, 204, 188] as Rgb8, from: 0.15, to: 0.6 },
	toxic: { colour: [226, 202, 172] as Rgb8, weight: 0.35 },
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

/**
 * What makes ground impassable, baked. Cliffs are a soft scarp shade, at
 * most `cliffWeight` of the way to their colour, since the hill shade
 * already draws the slope and a solid band reads as a wall of paint. Lakes
 * are filled with a darker shore.
 */
export const OBSTACLE_COLOURS = {
	cliff: [128, 116, 102] as Rgb8,
	cliffWeight: 0.32,
	lake: [176, 205, 226] as Rgb8,
	shore: [112, 152, 192] as Rgb8,
} as const;

/**
 * Craters drawn as craters: a dark rim `rim` of the radius wide, a lighter
 * floor, and a dark core `core` of the radius across. Each hotspot's plume
 * edge is a dashed rust ring, `dash` world units of dash and gap.
 */
export const CRATER_STYLE = {
	rimColour: [112, 106, 98] as Rgb8,
	floor: [168, 162, 150] as Rgb8,
	coreColour: [118, 110, 100] as Rgb8,
	rim: 0.16,
	core: 0.32,
	ring: { colour: [186, 120, 96] as Rgb8, weight: 0.7, dash: 9 },
} as const;

/**
 * Contamination hatched: diagonal rust lines `spacing` world units apart,
 * `width` wide, from none at `from` contamination to `weight` at `to`.
 * Light, since a third or more of a wasteland map is contaminated.
 */
export const TOXIC_HATCH = { colour: [186, 122, 78] as Rgb8, spacing: 12, width: 1.4, from: 0.4, to: 0.95, weight: 0.28 } as const;

/**
 * Towns and villages as built-up patches (until the dressing's street grids):
 * a pale brick tint inside a ragged edge round each ruin, `ragged` of its
 * radius in and out, with a street grid every `street` world units on the
 * metro and towns, turned by each place's own angle. Villages are plain patches.
 */
export const BUILT_UP = {
	fill: [229, 212, 204] as Rgb8,
	street: { colour: [204, 178, 168] as Rgb8, spacing: 11, width: 2.2 },
	ragged: 0.18,
} as const;

/**
 * The rim: the land fades toward paper over its last `fade` of the radius,
 * up to `fadeWeight` of the way, and a dashed grey line, `dash` world units
 * of dash and gap, marks the edge.
 */
export const RIM = { fade: 0.025, fadeWeight: 0.45, line: [150, 146, 136] as Rgb8, lineWeight: 0.85, dash: 12 } as const;

/** Rivers, drawn live under the roads: their world width, never under `minPixels` on screen, and faint past the rim. */
export const RIVER_STYLE = {
	color: [122 / 255, 166 / 255, 203 / 255, 1] as RGBA,
	outside: [122 / 255, 166 / 255, 203 / 255, 0.45] as RGBA,
	minPixels: 1,
	/** World units widths are rounded to, so a river draws as a few runs of one width each. */
	widthStep: 0.75,
} as const;

/**
 * A reservoir's dam: a dark bar square across the river where it leaves the
 * lake, `length` screen pixels long and `width` wide.
 */
export const DAM_STYLE = { color: [62 / 255, 66 / 255, 74 / 255, 1] as RGBA, length: 9, width: 2.5 } as const;

/**
 * Hill shading, lit from the north-west: the slope toward the light squashed
 * through `tanh(slope * gain)`, so it's never harsh, then scaled by `low` on
 * flat country rising to `high` in the ranges (elevation `from` to `to`),
 * and by `light` more on the lit side, so slopes facing the light brighten
 * a little where those facing away darken. The land's colour is multiplied
 * by one plus that.
 */
export const HILL_SHADE = { gain: 140, low: 0.16, high: 0.4, from: 0.08, to: 0.45, light: 0.4 } as const;

/** The view's ground past the disc's rim. */
export const MAP_GROUND: RGBA = [PAPER[0] / 255, PAPER[1] / 255, PAPER[2] / 255, 1];

/** The atlas's dark ink: Home's star, POI rings and glyphs, the names. */
const INK: RGBA = [44 / 255, 41 / 255, 37 / 255, 1];
const PAPER_RGBA: RGBA = [PAPER[0] / 255, PAPER[1] / 255, PAPER[2] / 255, 1];

/** A road class as the atlas draws it: a fill over an optional casing, solid or dashed. Screen pixels. */
export interface RoadStyle {
	readonly color: RGBA;
	readonly width: number;
	/** Drawn under the fill, wider: a highway's dark edge, a back road's pale one. */
	readonly casing: { readonly color: RGBA; readonly width: number } | null;
	readonly dash: { readonly dash: number; readonly gap: number } | null;
}

/**
 * Roads by class (Rendering: the road atlas): highways bold, an orange-red
 * fill in a dark casing; back roads thin grey with a pale edge; trails thin
 * and dashed.
 */
export const ROAD_STYLES: { readonly [Name in RoadClass]: RoadStyle } = {
	highway: { color: [216 / 255, 96 / 255, 54 / 255, 1], width: 2.4, casing: { color: [104 / 255, 44 / 255, 30 / 255, 1], width: 4.2 }, dash: null },
	backRoad: { color: [118 / 255, 114 / 255, 106 / 255, 1], width: 1.1, casing: { color: [251 / 255, 249 / 255, 242 / 255, 1], width: 2.7 }, dash: null },
	trail: { color: [128 / 255, 116 / 255, 100 / 255, 1], width: 1.1, casing: null, dash: { dash: 4, gap: 3 } },
};

/** A class's widest line: its casing, or its fill without one. Screen pixels. */
export function roadReach(style: RoadStyle): number {
	return style.casing ? style.casing.width : style.width;
}

/**
 * Roads and stubs thicken gently as the map zooms in, so a close view
 * doesn't draw hairlines and the whole map isn't a tangle: by
 * (zoom / reference)^power, held to [min, max].
 */
export const ROAD_ZOOM_WIDTH = { reference: 0.5, power: 0.4, min: 0.8, max: 1.8 } as const;

/** The factor road widths are drawn at, at `zoom` screen pixels per world unit. */
export function roadWidthScale(zoom: number): number {
	const { reference, power, min, max } = ROAD_ZOOM_WIDTH;
	return Math.max(min, Math.min(max, (zoom / reference) ** power));
}

/**
 * A rumored road is solid but paler: its fill and casing mixed this far
 * toward the paper. Opaque rather than translucent, since a translucent
 * polyline is darker where its segments overlap at the joints.
 */
export const RUMORED_FADE = 0.5;
export const RUMORED_TOWARD: RGBA = PAPER_RGBA;

/** An uncharted stretch: dashes in its class's fill from where it leaves known road, fading out over `length` world units. */
export const UNCHARTED_STUB = {
	length: 140,
	/** Screen pixels. */
	dash: 7,
	gap: 5,
} as const;

/** Highlight under a selected stretch, wider than any class. */
export const SELECTED_ROAD = { color: tokens.color.accent, width: 8 } as const;

/**
 * Bridges and passes are drawn from this zoom in, screen pixels a world
 * unit: on a large map fitted whole, every river crossing's ticks would
 * crowd out the roads.
 */
export const ROAD_DETAIL_ZOOM = 0.3;

/**
 * A bridge's parapets: a line each side of the deck, `gap` outside the
 * road's widest line, flared outward `flare` at each end. Screen pixels.
 */
export const BRIDGE = { color: [70 / 255, 64 / 255, 56 / 255, 1] as RGBA, width: 1, gap: 1, flare: 2.5 } as const;

/**
 * A collapsed highway span: drawn as a highway with a `gap` in its middle
 * and a red cross over the gap, `half` each way. Screen pixels.
 */
export const BROKEN_SPAN = { gap: 9, cross: { color: [186 / 255, 38 / 255, 28 / 255, 1] as RGBA, half: 4, width: 2 } } as const;

/** A pass, the top of a road over a range: a dark chevron, `half` wide each side and `rise` tall. Screen pixels. */
export const PASS_MARK = { color: INK, half: 4, rise: 3.5, width: 1.5 } as const;

/** Home: a five-pointed star in ink on a paper halo. Screen pixels. */
export const COMPOUND = {
	outer: 8,
	inner: 3.3,
	fill: INK,
	halo: PAPER_RGBA,
	haloWidth: 1.5,
	label: 'Home',
} as const;

/**
 * POIs as circled glyphs by type, strongholds as diamonds (Rendering: the
 * road atlas). Screen pixels.
 */
export const MARKER = {
	/** A POI's disc. */
	radius: 7,
	ring: 1.5,
	fill: [1, 1, 1, 1] as RGBA,
	ink: INK,
	/** A looted or depleted POI's ring and glyph; a depleted one's disc too. */
	spent: [0.6, 0.58, 0.54, 1] as RGBA,
	/** A stronghold's diamond, by its half diagonal, in its faction's colour on a paper edge. */
	stronghold: { half: 7.5, fill: [150 / 255, 36 / 255, 30 / 255, 1] as RGBA, border: PAPER_RGBA, borderWidth: 1.5 },
	/** Screen pixels around a marker's centre that pick it. */
	pickRadius: 14,
} as const;

/** A POI's glyph, centred in its disc. */
export const POI_GLYPH = { font: 'display', size: 10.5 } as const;

/**
 * Each POI type's glyph: a letter a map reader can guess, unique on the
 * map. A type missing here draws its disc bare.
 */
export const POI_GLYPHS: Readonly<Record<string, string>> = {
	hospital: 'H',
	clinic: 'C',
	school: 'S',
	store: 'G',
	mall: 'M',
	waterPlant: 'W',
	fuelDepot: 'F',
	truckStop: 'T',
	quarry: 'Q',
	mine: 'X',
	farm: 'B',
	silo: 'O',
	salvageYard: 'J',
};

/** A POI with no route home by dark: a ring outside its disc, the colour of the night. Screen pixels. */
export const NIGHT_RING = {
	color: [38 / 255, 46 / 255, 92 / 255, 1] as RGBA,
	width: 2.5,
	/** Between the disc's edge and the ring's inner edge. */
	gap: 1.5,
} as const;

/**
 * A POI's routes on the run route screen, as bands under the roads (Area
 * Map Generation, Rendering): the picked one wide in a strong colour
 * nothing else on the map uses, the others a little narrower in a pale tint
 * of it. Opaque, as a translucent polyline darkens where its segments
 * overlap at the joints. Screen pixels, scaled with the roads
 * (`roadWidthScale`).
 */
export const ROUTE_BAND = {
	picked: { color: [214 / 255, 58 / 255, 134 / 255, 1] as RGBA, width: 12 },
	other: { color: [244 / 255, 196 / 255, 222 / 255, 1] as RGBA, width: 10 },
} as const;

/** A stop on the picked route: a fight as a diamond in ink, anything else as a square on paper. Screen pixels. */
export const ROUTE_STOP = {
	/** Half a side, or the diamond's half diagonal. */
	half: 4.5,
	ink: INK,
	paper: [1, 1, 1, 1] as RGBA,
	border: 1.5,
} as const;

/** How a kind of label is set: its face, size, ink, and spacing; `capitals` sets it upper case. */
export interface LabelStyle {
	readonly font: string;
	readonly size: number;
	readonly color: RGBA;
	readonly letterSpacing?: number;
	readonly capitals?: boolean;
}

/**
 * The map's names (Rendering: the road atlas): dark type on a paper halo,
 * no boxes. The metro's name in spaced capitals, towns' and the gameplay's
 * in the condensed bold face, villages' smaller in the regular one, and
 * strongholds' in their diamonds' red.
 */
export const LABELS = {
	metro: { font: 'display', size: 17, color: INK, letterSpacing: 0.16, capitals: true },
	town: { font: 'display', size: 14, color: INK },
	village: { font: 'body', size: 10.5, color: [82 / 255, 77 / 255, 70 / 255, 1] },
	poi: { font: 'display', size: 13, color: INK },
	stronghold: { font: 'display', size: 13, color: [140 / 255, 32 / 255, 26 / 255, 1] },
	home: { font: 'display', size: 13, color: INK },
} as const satisfies Record<string, LabelStyle>;

/**
 * Label layout: the halo, a paper shadow `blur` pixels round the glyphs;
 * `gap` between a symbol's edge and its label; `pad` round each label's box
 * that no other may enter; `lineHeight` of the size a box is tall.
 */
export const LABEL_LAYOUT = { halo: { color: PAPER_RGBA, blur: 2.2 }, gap: 4, pad: 1.5, lineHeight: 1.25 } as const;

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
