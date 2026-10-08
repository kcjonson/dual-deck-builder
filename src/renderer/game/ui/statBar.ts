import type { DrawApi } from '../../engine/draw/DrawApi';
import type { Border, DrawRectOptions } from '../../engine/draw/commands';
import type { Rect } from '../../engine/draw/geometry';
import { CARD_LINE, ToneFills, toneFills } from './cardStyle';

/**
 * A card's bar for a stat that runs down, a driver's HP or an escort's
 * structure: the stat's hue on a track sunk below the card's ground,
 * outlined in the card line so an empty bar (a lost driver's) still shows
 * its length.
 */
const TRACK_FILLS: ToneFills = toneFills('#0e0f10');
const TRACK_LINE_FILLS: ToneFills = toneFills(CARD_LINE);

/** A bar's draws: the track, and the fill over it from the left, in its stat's hue. */
export interface StatBarDraws {
	readonly track: DrawRectOptions & { rect: Rect; border: Border };
	readonly fill: DrawRectOptions & { rect: Rect };
	/** The stat's hue at full strength and faded. */
	readonly fills: ToneFills;
}

/** A bar in `fills`, resolved once by its owner's module so a card's draws allocate no colours. */
export function statBarDraws(fills: ToneFills): StatBarDraws {
	return {
		track: { rect: { x: 0, y: 0, width: 0, height: 0 }, radius: 1, fill: TRACK_FILLS.full, border: { color: TRACK_LINE_FILLS.full, width: 1 } },
		fill: { rect: { x: 0, y: 0, width: 0, height: 0 }, radius: 1, fill: fills.full },
		fills,
	};
}

/** How full a bar is: 0 to 1, and 0 with no maximum. */
export function barFraction(value: number, max: number): number {
	return max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
}

/** Puts the bar in the `rect` box, `fraction` of it filled, in place. */
export function placeStatBar(draws: StatBarDraws, { x, y, width, height }: Rect, fraction: number): void {
	const { track, fill } = draws;
	track.rect.x = x;
	track.rect.y = y;
	track.rect.width = width;
	track.rect.height = height;
	fill.rect.x = x;
	fill.rect.y = y;
	fill.rect.width = width * fraction;
	fill.rect.height = height;
}

export function toneStatBar(draws: StatBarDraws, tone: keyof ToneFills): void {
	draws.track.fill = TRACK_FILLS[tone];
	draws.track.border.color = TRACK_LINE_FILLS[tone];
	draws.fill.fill = draws.fills[tone];
}

/** The track, and the fill over it unless the bar is empty. */
export function drawStatBar(draw: DrawApi, draws: StatBarDraws): void {
	draw.drawRect(draws.track);
	if (draws.fill.rect.width > 0) draw.drawRect(draws.fill);
}
