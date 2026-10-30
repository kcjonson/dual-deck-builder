/**
 * The vehicle token's size and how it scales into a slot (Battle Screen
 * Design, sections 2 and 3, and the mock's `TW`, `TH`, `TH_PAS`). One copy:
 * the token lays itself out from these and the road's layout sizes its
 * slots against them.
 */
export const TOKEN_WIDTH = 196;
export const TOKEN_HEIGHT = 117;
/** With a passenger's row, 18 more. */
export const TOKEN_PASSENGER_HEIGHT = 135;
/** Tokens grow to fill their slot up to this, and never shrink below 1. */
export const TOKEN_MAX_SCALE = 1.25;
/** The room a slot keeps around its token, across and down (the mock's `cellW - 6`, `cellH - 4`). */
export const TOKEN_SLOT_CLEARANCE_X = 6;
export const TOKEN_SLOT_CLEARANCE_Y = 4;

/**
 * How far a token scales to fill a slot: the mock's
 * `min((w - 6) / 196, (h - 4) / H)`, neither capped nor floored, so a caller
 * can tell a slot that is too small (under 1) from one the token fills.
 */
export function slotScale({ width, height, tokenHeight = TOKEN_HEIGHT }: { width: number; height: number; tokenHeight?: number }): number {
	return Math.min((width - TOKEN_SLOT_CLEARANCE_X) / TOKEN_WIDTH, (height - TOKEN_SLOT_CLEARANCE_Y) / tokenHeight);
}
