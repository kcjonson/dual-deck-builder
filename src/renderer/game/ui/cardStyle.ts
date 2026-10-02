import type { DrawApi } from '../../engine/draw/DrawApi';
import type { RGBA, Vec2 } from '../../engine/draw/geometry';
import { triangulatePolygon } from '../../engine/draw';
import type { IconName } from '../../engine/text/icons';
import type { Card as GameCard, CardRarity } from '../mechanics/Card';
import { DRIVER_COLORS, hexRgba } from '../screens/combat/combatStyle';

/**
 * The card face's and detail view's palette, from the battle screen mock
 * (`.card`, `.cdetail`, `.rar`). Driver colour is the frame; rarity is
 * only ever the gem (section 7).
 */
export const CARD_GROUND = '#1d2023';
export const CARD_LINE = 'rgba(233, 228, 214, 0.2)';
export const CARD_LINE_FAINT = 'rgba(233, 228, 214, 0.1)';
export const CARD_NAME = '#e9e4d6';
export const CARD_RULES = '#dcd7ca';
export const CARD_DETAIL_RULES = '#e2ddd0';
export const CARD_MUTED = '#a39e92';
export const CARD_DIM = '#6f6b63';
export const CARD_KEYWORD = '#efd25a';
/** The cost hex: bone, outlined in the ground, its numeral dark. */
export const COST_HEX = '#e9e4d6';
export const COST_HEX_EDGE = '#0e0f10';
export const COST_DIGITS = '#111214';
/** "Unaffordable cards dim and their cost turns dark red" (section 6). */
export const COST_DIGITS_UNPAYABLE = '#8d1d12';

export const RARITY_GEMS: Readonly<Record<CardRarity, string>> = {
	starter: '#6f6b63',
	common: '#9b978c',
	uncommon: '#6fb3e0',
	rare: '#e0c14f',
	legendary: '#d06ad8',
	signature: '#c98a5a',
};

/** The art strip's ground: warm for driver 1, cool for driver 2, neutral otherwise. */
const ART_GRADIENTS: Readonly<Record<'1' | '2' | 'none', readonly [string, string]>> = {
	1: ['#4a3b27', '#26241f'],
	2: ['#243e41', '#1e2426'],
	none: ['#3b3a35', '#24262a'],
};

/** The frame: the driver's colour, or the neutral line for an unowned card. */
export function frameColor(driver: 1 | 2 | null): string {
	return driver ? DRIVER_COLORS[driver] : CARD_LINE;
}

/**
 * The mock's 160 degree art gradient as four corner colours (top-left,
 * top-right, bottom-right, bottom-left): light at the top left, dark at
 * the bottom right.
 */
export function artGradient(driver: 1 | 2 | null, dim = 1): readonly [RGBA, RGBA, RGBA, RGBA] {
	const [from, to] = ART_GRADIENTS[driver ?? 'none'];
	const a = scale(hexRgba(from), dim);
	const b = scale(hexRgba(to), dim);
	const mid: RGBA = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, (a[3] + b[3]) / 2];
	return [a, mid, b, mid];
}

/** What kind of card it is, as the face's corner says it. */
export function cardTypeLabel(card: GameCard): string {
	if (card.tags.includes('synergy')) return 'SYN';
	switch (card.tags[0]) {
		case 'attack': return 'ATK';
		case 'defense': return 'DEF';
		case 'power': return 'PWR';
		case 'order': return 'ORD';
		default: return 'UTL';
	}
}

/** Placeholder art until cards have their own: the nearest glyph the icon atlas has. */
export function cardArtIcon(card: GameCard): IconName {
	const tags = card.tags;
	if (tags.includes('shield') || tags.includes('defense') || tags.includes('armor')) return 'shield';
	if (tags.includes('resource')) return 'local_gas_station';
	if (tags.includes('heal')) return 'build';
	if (tags.includes('positioning')) return 'chevron_right';
	if (tags[0] === 'attack' || tags[0] === 'power') return 'warning';
	return 'info';
}

/** A pointy-top hexagon's outline in a `size` box at `x`, `y`, like the mock's `#i-hex`. */
export function hexPoints(x: number, y: number, size: number): Vec2[] {
	const unit = size / 30;
	return [
		[15, 1.5], [27.5, 8.5], [27.5, 21.5], [15, 28.5], [2.5, 21.5], [2.5, 8.5],
	].map(([px, py]) => ({ x: x + px * unit, y: y + py * unit }));
}

const HEX_INDICES = triangulatePolygon(hexPoints(0, 0, 30));

/**
 * The cost hex: the outline as a slightly larger hex in the ground colour,
 * the bone hex inside it. Points are rewritten each call; the draw API
 * copies them.
 */
export function drawCostHex(draw: DrawApi, x: number, y: number, size: number, dim = 1): void {
	const edge = size / 15;
	draw.drawPolygon({ points: hexPoints(x - edge, y - edge, size + edge * 2), indices: HEX_INDICES, fill: scale(hexRgba(COST_HEX_EDGE), 1) });
	draw.drawPolygon({ points: hexPoints(x, y, size), indices: HEX_INDICES, fill: scale(hexRgba(COST_HEX), dim) });
}

/** The rarity gem, a square turned 45 degrees, centred on `cx`, `cy`, `side` along each edge. */
export function drawRarityGem(draw: DrawApi, rarity: CardRarity, cx: number, cy: number, side: number, dim = 1): void {
	const half = (side * Math.SQRT2) / 2;
	draw.drawPolygon({
		points: [{ x: cx, y: cy - half }, { x: cx + half, y: cy }, { x: cx, y: cy + half }, { x: cx - half, y: cy }],
		indices: [0, 1, 2, 0, 2, 3],
		fill: scale(hexRgba(RARITY_GEMS[rarity]), dim),
	});
}

/** A colour darkened toward black by `factor` (1 leaves it), keeping alpha. */
export function scale(color: RGBA, factor: number): RGBA {
	return [color[0] * factor, color[1] * factor, color[2] * factor, color[3]];
}

/**
 * The mock's `.cant` (`saturate(0.3) brightness(0.62)`) on a `#rrggbb`
 * colour, for a card its driver can't play.
 */
export function dimHex(hex: string): string {
	const [r, g, b] = hexRgba(hex);
	const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
	const channel = (value: number) => Math.round(Math.min(1, (grey + (value - grey) * 0.3) * 0.62) * 255).toString(16).padStart(2, '0');
	return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/** The brightness a dimmed card's own draws take. */
export const DIM_BRIGHTNESS = 0.62;

