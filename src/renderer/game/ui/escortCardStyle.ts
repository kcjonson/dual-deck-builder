import type { DrawApi } from '../../engine/draw/DrawApi';
import type { Border, BoxShadow, DrawPolygonOptions, DrawRectOptions } from '../../engine/draw/commands';
import type { RGBA, Rect, Vec2 } from '../../engine/draw/geometry';
import { CLEAR } from '../../engine/ui/surfaces';
import { STRUCTURE_COLOR } from '../screens/combat/combatStyle';
import { CARD_DIM_FILLS, CARD_GROUND_FILLS, CARD_MUTED_FILLS, ToneFills, toneFills } from './cardStyle';
import { PLACEHOLDER_GROUND, SILHOUETTE_FILLS } from './driverCardStyle';
import { TRACK_FILLS } from './statBar';
import { hatchPolygonTriangles, roundedRectPolygon } from './stripes';
import { SpriteKind, VehicleSprite } from './vehicleSprites';

type Tone = keyof ToneFills;

/**
 * The escort card's frame: a mini card's corners and line width, in the
 * dim line a driver card's frame takes rather than a play card's driver
 * colour, since nobody owns an escort's card the way a driver owns theirs.
 */
export const ESCORT_FRAME = { radius: 5, border: 2 } as const;

/**
 * The edge no play card has (Game Flow 7.0): a hazard-stripe header across
 * the top, inside the frame's line, so a glance tells an escort from a play
 * card of the same size. The stripes are the road shoulder's 135 degree
 * hatch, in the card's muted bone on the stat bar's sunk black: the board
 * draws them black and white, and every stronger hue is taken (driver
 * amber and teal, the interaction yellow, the keyword yellow).
 */
export const HAZARD_HEADER = { height: 10, period: 10, stripe: 5 } as const;
const HAZARD_GROUND_FILLS: ToneFills = TRACK_FILLS;
const HAZARD_STRIPE_FILLS: ToneFills = CARD_MUTED_FILLS;

/** The header's stripes by frame width, built the first time a frame that wide is and shared by every one after. */
const stripesByWidth = new Map<number, Vec2[]>();

function headerStripes(band: Rect, inner: number): Vec2[] {
	let stripes = stripesByWidth.get(band.width);
	if (!stripes) {
		stripes = hatchPolygonTriangles(roundedRectPolygon(band, [inner, inner, 0, 0]), HAZARD_HEADER);
		stripesByWidth.set(band.width, stripes);
	}
	return stripes;
}

/** An escort's structure, the road's structure green (`statBar`). */
export const STRUCTURE_FILLS: ToneFills = toneFills(STRUCTURE_COLOR);

/** The frame's draws: the ground, drawn first, and the outline over the header so the header never covers the line. */
export interface EscortFrameDraws {
	readonly ground: DrawRectOptions & { rect: Rect };
	/** The line, which the owner recolours and thickens for hover, focus, and selection. */
	readonly outline: DrawRectOptions & { rect: Rect; border: Border };
	readonly band: DrawRectOptions & { rect: Rect };
	readonly stripes: DrawPolygonOptions & { fill: RGBA };
}

/**
 * The frame and its header for a `width` by `height` box, built once; the
 * header's stripes follow the rounded corners inside the line.
 */
export function escortFrameDraws({ id, width, height, shadow }: { id?: string; width: number; height: number; shadow?: BoxShadow }): EscortFrameDraws {
	const { radius, border } = ESCORT_FRAME;
	const band: Rect = { x: border, y: border, width: width - border * 2, height: HAZARD_HEADER.height };
	const inner = radius - border;
	return {
		ground: { id, rect: { x: 0, y: 0, width, height }, radius, fill: CARD_GROUND_FILLS.full, shadow },
		// A rect with no fill is white (R2.8's default); the outline is border only
		outline: { rect: { x: 0, y: 0, width, height }, radius, fill: CLEAR, border: { color: CARD_DIM_FILLS.full, width: border } },
		band: { rect: band, radius: [inner, inner, 0, 0], fill: HAZARD_GROUND_FILLS.full },
		stripes: { points: headerStripes(band, inner), fill: HAZARD_STRIPE_FILLS.full },
	};
}

/** Moves the frame to a new height in place, for a view that sizes itself in layout; the header keeps its place. */
export function resizeEscortFrame(draws: EscortFrameDraws, height: number): void {
	draws.ground.rect.height = height;
	draws.outline.rect.height = height;
}

/** The ground and the header in a card's tone; the outline is its owner's to colour. */
export function toneEscortFrame(draws: EscortFrameDraws, tone: Tone): void {
	draws.ground.fill = CARD_GROUND_FILLS[tone];
	draws.band.fill = HAZARD_GROUND_FILLS[tone];
	draws.stripes.fill = HAZARD_STRIPE_FILLS[tone];
}

/** The ground, the header, and the line over them, under everything else its owner draws. */
export function drawEscortFrame(draw: DrawApi, draws: EscortFrameDraws): void {
	draw.drawRect(draws.ground);
	draw.drawRect(draws.band);
	draw.drawPolygon(draws.stripes);
	draw.drawRect(draws.outline);
}

/**
 * An escort's picture until escorts have art, in the driver portrait's
 * style: the unowned art strip's gradient, with the rear view the road
 * draws for the vehicle in the portrait's faint bone.
 */
export interface VehicleArtDraws {
	readonly ground: DrawRectOptions;
	readonly sprite: VehicleSprite;
}

/** The art in the `width` by `height` box at `x`, `y`, the vehicle fitted inside `inset` of it. */
export function vehicleArtDraws({ x, y, width, height, inset, radius }: Rect & { inset: { x: number; y: number }; radius: number }): VehicleArtDraws {
	const sprite = new VehicleSprite({ box: { x: x + inset.x, y: y + inset.y, width: width - inset.x * 2, height: height - inset.y * 2 } });
	const draws = { ground: { rect: { x, y, width, height }, radius, gradient: PLACEHOLDER_GROUND.full }, sprite };
	toneVehicleArt(draws, 'full');
	return draws;
}

/** Which vehicle it shows; rebuilt only when the kind changes. */
export function shapeVehicleArt(draws: VehicleArtDraws, kind: SpriteKind): void {
	draws.sprite.kind = kind;
}

/** The body and its lights in one faint bone, so the vehicle reads as a silhouette with dark glass and tyres. */
export function toneVehicleArt(draws: VehicleArtDraws, tone: Tone): void {
	draws.ground.gradient = PLACEHOLDER_GROUND[tone];
	draws.sprite.setColors(SILHOUETTE_FILLS[tone], SILHOUETTE_FILLS[tone]);
}

export function drawVehicleArt(draw: DrawApi, draws: VehicleArtDraws): void {
	draw.drawRect(draws.ground);
	draws.sprite.draw(draw);
}
