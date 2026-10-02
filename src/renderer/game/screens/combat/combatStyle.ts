import { ColorToken, tokens } from '../../../engine/theme/tokens';
import type { DriverSeat } from './PlayerHandView';

export type Rgba = [number, number, number, number];

/** A theme colour as the mutable tuple a style takes. */
export function rgba(token: ColorToken): Rgba {
	return [...tokens.color[token]] as Rgba;
}

/**
 * Driver identity owns the two strongest hues and nothing else uses them
 * (Battle Screen Design, section 7): driver 1 amber, driver 2 teal. They
 * are game colours, not theme tokens.
 */
export const DRIVER_COLORS: Readonly<Record<DriverSeat, string>> = {
	1: '#f2a33a',
	2: '#3cc3c9',
};

/** A `#rrggbb` colour as RGBA floats, at `alpha`. */
export function hexRgba(hex: string, alpha = 1): Rgba {
	const value = parseInt(hex.slice(1), 16);
	return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha];
}

/** The bands' and tabs' grounds, from the battle screen mock (`.g-top`, `.g-dock`, `.dtab`). */
export const TOP_BAR_BACKGROUND = hexRgba('#0e0f10');
export const DOCK_GRADIENT: readonly [Rgba, Rgba] = [hexRgba('#131416'), hexRgba('#0c0d0e')];
export const DRIVER_TAB_BACKGROUND = hexRgba('#17191b');

/** The mock's `--bone`: End Turn's face, the player's banner type, a miss. */
export const BONE = '#e9e4d6';

/** The mock's `.dmgpop` for a hit; a miss says so in bone. */
export const DAMAGE_NUMBER_COLOR = '#ff8a78';
export const MISS_NUMBER_COLOR = BONE;

/** The player's turn banner: a neutral dark band, since red is the raiders'. */
export const TURN_BANNER_PLAYER_BAND = hexRgba('#202326', 0.92);

/**
 * The road, from the mock's lane styles (`.lane`, `.lane-line`, `.slot`,
 * `.col-head`, `.headstrip`, `.rowlab`). Red tints belong to the raiders,
 * bone to you; yellow is the centre line, where the two inside lanes meet
 * at range 1.
 */
export const ROAD_STYLE = {
	shoulderGround: hexRgba('#1a1b1c'),
	shoulderStripe: hexRgba('#1d1e20'),
	raiderLaneTint: hexRgba('#d4513f', 0.05),
	playerShoulderTint: hexRgba('#e9e4d6', 0.025),
	header: [10 / 255, 11 / 255, 12 / 255, 0.7] as Rgba,
	headerRule: hexRgba('#e9e4d6', 0.1),
	edgeLine: hexRgba('#e9e4d6', 0.22),
	laneDash: hexRgba('#e9e4d6', 0.16),
	centreLine: hexRgba('#efd25a', 0.35),
	slotOutline: hexRgba('#e9e4d6', 0.06),
	raiderSlotOutline: hexRgba('#d4513f', 0.09),
	headerLabel: '#8b8373',
	raiderHeaderLabel: '#b0685c',
} as const;
