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

/** The mock's `.dmgpop` for a hit; a miss says so in bone. */
export const DAMAGE_NUMBER_COLOR = '#ff8a78';
export const MISS_NUMBER_COLOR = '#e9e4d6';
