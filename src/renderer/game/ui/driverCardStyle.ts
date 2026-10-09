import type { DrawApi } from '../../engine/draw/DrawApi';
import type { Border, BoxShadow, DrawCircleOptions, DrawRectOptions } from '../../engine/draw/commands';
import type { Rect, Vec2 } from '../../engine/draw/geometry';
import { CLEAR } from '../../engine/ui/surfaces';
import { DRIVER_HP_COLOR, hexRgba } from '../screens/combat/combatStyle';
import { CARD_DIM_FILLS, CARD_GROUND_FILLS, CARD_MUTED_FILLS, CARD_NAME, DIM_BRIGHTNESS, ToneFills, artGradient, dimHex, toneFills } from './cardStyle';
import { barFraction } from './statBar';

/**
 * The edge no play card has (Game Flow 7.0): a riveted double frame. A
 * heavier outer line, a gap of the card's ground, a thin inner line, and a
 * rivet in each corner inside it, on corners squarer than a play card's.
 * Both lines are a play card's dim line, and the rivets its muted one, a
 * step brighter, like studs. The driver card and its detail view both
 * wear it.
 */
export const RIVETED_FRAME = {
	outer: 2,
	gap: 2,
	inner: 1,
	radius: 2,
	/** Each rivet's centre, this far in from both edges of its corner. */
	rivet: { inset: 8, radius: 1.5 },
} as const;

/** The HP bar's hue (`statBar`), the road's driver HP. */
export const DRIVER_HP_FILLS: ToneFills = toneFills(DRIVER_HP_COLOR);

/**
 * A placeholder picture's ground, a play card's unowned art strip, and the
 * figure on it in the art glyph's bone, fainter since it's solid: the
 * driver card's head and shoulders, the escort card's vehicle.
 */
export const PLACEHOLDER_GROUND = { full: artGradient(null), dimmed: artGradient(null, DIM_BRIGHTNESS) } as const;
const SILHOUETTE_ALPHA = 0.2;
export const SILHOUETTE_FILLS: ToneFills = { full: hexRgba(CARD_NAME, SILHOUETTE_ALPHA), dimmed: hexRgba(dimHex(CARD_NAME), SILHOUETTE_ALPHA) };

type Tone = keyof ToneFills;

/** The frame's draws, built once and moved or recoloured in place. */
export interface RivetedFrameDraws {
	/** The card's ground and its outer line, which the owner recolours for hover, focus, and selection. */
	readonly frame: DrawRectOptions & { rect: Rect; border: Border };
	readonly inner: DrawRectOptions & { rect: Rect; border: Border };
	readonly rivets: readonly (DrawCircleOptions & { center: Vec2 })[];
}

export function rivetedFrameDraws({ id, width, height, shadow }: { id?: string; width: number; height: number; shadow?: BoxShadow }): RivetedFrameDraws {
	const draws: RivetedFrameDraws = {
		frame: {
			id,
			rect: { x: 0, y: 0, width: 0, height: 0 },
			radius: RIVETED_FRAME.radius,
			fill: CARD_GROUND_FILLS.full,
			border: { color: CARD_DIM_FILLS.full, width: RIVETED_FRAME.outer },
			shadow,
		},
		inner: {
			rect: { x: 0, y: 0, width: 0, height: 0 },
			// A rect with no fill is white (R2.8's default); the inner line is border only
			fill: CLEAR,
			border: { color: CARD_DIM_FILLS.full, width: RIVETED_FRAME.inner },
		},
		rivets: [0, 1, 2, 3].map(() => ({ center: { x: 0, y: 0 }, radius: RIVETED_FRAME.rivet.radius, fill: CARD_MUTED_FILLS.full })),
	};
	resizeRivetedFrame(draws, { width, height });
	return draws;
}

/** Moves the frame to a `width` by `height` box in place. */
export function resizeRivetedFrame(draws: RivetedFrameDraws, { width, height }: { width: number; height: number }): void {
	const { rect } = draws.frame;
	rect.width = width;
	rect.height = height;
	const offset = RIVETED_FRAME.outer + RIVETED_FRAME.gap;
	const inner = draws.inner.rect;
	inner.x = offset;
	inner.y = offset;
	inner.width = width - offset * 2;
	inner.height = height - offset * 2;
	const inset = RIVETED_FRAME.rivet.inset;
	const corners: readonly [number, number][] = [[inset, inset], [width - inset, inset], [width - inset, height - inset], [inset, height - inset]];
	draws.rivets.forEach((rivet, index) => {
		rivet.center.x = corners[index][0];
		rivet.center.y = corners[index][1];
	});
}

/** The ground, the inner line, and the rivets in a card's tone; the outer line is its owner's to colour. */
export function toneRivetedFrame(draws: RivetedFrameDraws, tone: Tone): void {
	draws.frame.fill = CARD_GROUND_FILLS[tone];
	draws.inner.border.color = CARD_DIM_FILLS[tone];
	for (const rivet of draws.rivets) rivet.fill = CARD_MUTED_FILLS[tone];
}

/** The frame and its rivets, under everything else its owner draws. */
export function drawRivetedFrame(draw: DrawApi, draws: RivetedFrameDraws): void {
	draw.drawRect(draws.frame);
	draw.drawRect(draws.inner);
	for (const rivet of draws.rivets) draw.drawCircle(rivet);
}

/**
 * A portrait's placeholder until drivers have art, in the card art
 * placeholder's style: the unowned art strip's gradient, with a head and
 * shoulders where the art glyph would be.
 */
export interface PortraitDraws {
	readonly ground: DrawRectOptions;
	readonly head: DrawCircleOptions;
	readonly shoulders: DrawRectOptions;
}

/** A portrait in the `width` by `height` box at `x`, `y`; the head and shoulders scale with its height. */
export function portraitDraws({ x, y, width, height }: Rect): PortraitDraws {
	const centre = x + width / 2;
	const shouldersWidth = height * 0.73;
	const shouldersTop = y + height * 0.6;
	const shouldersRadius = height * 0.27;
	return {
		ground: { rect: { x, y, width, height }, radius: RIVETED_FRAME.radius, gradient: PLACEHOLDER_GROUND.full },
		head: { center: { x: centre, y: y + height * 0.4 }, radius: height / 6, fill: SILHOUETTE_FILLS.full },
		shoulders: {
			rect: { x: centre - shouldersWidth / 2, y: shouldersTop, width: shouldersWidth, height: y + height - shouldersTop },
			radius: [shouldersRadius, shouldersRadius, 0, 0],
			fill: SILHOUETTE_FILLS.full,
		},
	};
}

export function tonePortrait(draws: PortraitDraws, tone: Tone): void {
	draws.ground.gradient = PLACEHOLDER_GROUND[tone];
	draws.head.fill = SILHOUETTE_FILLS[tone];
	draws.shoulders.fill = SILHOUETTE_FILLS[tone];
}

export function drawPortrait(draw: DrawApi, draws: PortraitDraws): void {
	draw.drawRect(draws.ground);
	draw.drawCircle(draws.head);
	draw.drawRect(draws.shoulders);
}

/** How full an HP bar is: 0 to 1, and 0 for a driver with no maximum. */
export function hpFraction({ hitpoints, maxHitpoints }: { hitpoints: number; maxHitpoints: number }): number {
	return barFraction(hitpoints, maxHitpoints);
}
