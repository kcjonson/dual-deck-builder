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

/** The dock and top bar grounds, from the battle screen mock. */
export const TOP_BAR_BACKGROUND: Rgba = [0.0549, 0.0588, 0.0627, 1];
export const DOCK_BACKGROUND: Rgba = [0.0627, 0.0667, 0.0706, 1];
export const DRIVER_TAB_BACKGROUND: Rgba = [0.0902, 0.098, 0.1059, 1];
