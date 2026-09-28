/**
 * The battle screen's bands and stage (Battle Screen Design, section 2).
 * Everything inside the stage is in logical pixels on a 1280x720 reference,
 * scaled by one number; the stacks under `CombatScreen` do the rest.
 */

/** The reference the whole screen is designed at. */
export const COMBAT_REFERENCE_WIDTH = 1280;
export const COMBAT_REFERENCE_HEIGHT = 720;

/** Below this the screen needs its own compact layout (phone landscape), which the design doesn't cover. */
export const MIN_STAGE_SCALE = 0.8;

/** The stage caps at this width and centres; road art may run past it, the UI does not. */
export const STAGE_MAX_WIDTH = 1600;

export const TOP_BAR_HEIGHT = 36;
export const DOCK_HEIGHT = 228;
export const END_TURN_COLUMN_WIDTH = 148;
/** The log drawer, over the right of the road and never over the dock. */
export const LOG_DRAWER_WIDTH = 320;

/** How the road's height splits between the raiders' band and the player's, until the slot grid (DDB-134) replaces both. */
export const ENEMY_ROAD_WEIGHT = 23;
export const PLAYER_ROAD_WEIGHT = 40;

/**
 * The stage for a viewport: the scale, and the logical canvas it scales, so
 * that `width * scale` and `height * scale` are the viewport.
 */
export interface CombatStage {
	scale: number;
	width: number;
	height: number;
}

/**
 * `s = min(W / 1280, H / 720)`, floored at 0.8. The logical canvas is
 * `W / s` by `H / s`: never smaller than the reference while `s` is not
 * floored, with one axis always at the reference and the other growing.
 * A viewport with no area yet (the screen mounted before the canvas was
 * measured) lays the stage out at the reference, unscaled, until it has one.
 */
export function computeCombatStage({ width, height }: { width: number; height: number }): CombatStage {
	if (width <= 0 || height <= 0) return { scale: 1, width: COMBAT_REFERENCE_WIDTH, height: COMBAT_REFERENCE_HEIGHT };
	const scale = Math.max(MIN_STAGE_SCALE, Math.min(width / COMBAT_REFERENCE_WIDTH, height / COMBAT_REFERENCE_HEIGHT));
	return { scale, width: width / scale, height: height / scale };
}
