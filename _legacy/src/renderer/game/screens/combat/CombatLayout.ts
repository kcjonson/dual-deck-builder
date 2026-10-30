import { LANE_ORDER, ROW_ORDER, RoadLane, RoadRow, RoadSlot } from '../../mechanics/Road';
import { TOKEN_HEIGHT, TOKEN_MAX_SCALE, slotScale } from '../../ui/tokenGeometry';

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
/**
 * The most cards a driver's half of the dock is designed for (section 4),
 * and what the fit suite holds each hand to. The rule is each driver's own
 * `handLimit`, which can pass it; a hand that does still fans inside its
 * half, overlapping tighter.
 */
export const DOCK_HAND_CAP = 7;
export const END_TURN_COLUMN_WIDTH = 148;
/** The log drawer, over the right of the road and never over the dock. */
export const LOG_DRAWER_WIDTH = 320;

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

/** The road band's lane names across its top (Battle Screen Design, sections 1 and 2). */
export const ROAD_HEADER_HEIGHT = 26;
/** The row names' column, left of the grid. */
export const ROAD_ROW_GUTTER = 18;
/** The stage's side padding, which the grid sits inside. */
export const ROAD_PADDING_X = 16;
/** Between the header and the first row, and under the last row. */
const ROWS_INSET_TOP = 4;
const ROWS_INSET_BOTTOM = 4;

// The token's size and slot clearance are the token's own (ui/tokenGeometry)
export { TOKEN_HEIGHT, TOKEN_MAX_SCALE, TOKEN_PASSENGER_HEIGHT, TOKEN_SLOT_CLEARANCE_X, TOKEN_SLOT_CLEARANCE_Y, TOKEN_WIDTH } from '../../ui/tokenGeometry';

export interface RoadRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** One lane's column, from the header down. */
export interface RoadLaneColumn {
	readonly lane: RoadLane;
	readonly x: number;
	readonly width: number;
}

/** One row's band across the grid. */
export interface RoadRowBand {
	readonly row: RoadRow;
	readonly y: number;
	readonly height: number;
}

/**
 * The road band laid out: every number the road view draws from, in the
 * band's own space (its top left is 0, 0). Slots are the cells of the 6x3
 * grid; they depend only on the band's size, so nothing a vehicle does
 * moves or resizes one.
 */
export interface RoadLayout {
	readonly width: number;
	readonly height: number;
	/** The header strip, the band's full width. */
	readonly headerHeight: number;
	/** The gutter's left edge; it runs from `rowsTop` for `rowsHeight`. */
	readonly gutterX: number;
	/** The grid's left edge, past the padding and the gutter. */
	readonly gridX: number;
	readonly gridWidth: number;
	readonly rowsTop: number;
	readonly rowsHeight: number;
	readonly slotWidth: number;
	readonly slotHeight: number;
	/** Left to right, in `LANE_ORDER`. */
	readonly lanes: readonly RoadLaneColumn[];
	/** Ahead to behind, in `ROW_ORDER`. */
	readonly rows: readonly RoadRowBand[];
	/**
	 * The scale a token without a passenger takes in every slot: as large as
	 * fits, capped at x1.25. Below 1 is reported as is, never floored; the
	 * screen can't fit a token there, which `tokensFit` says.
	 */
	readonly tokenScale: number;
	readonly tokensFit: boolean;
}

/**
 * The largest scale, up to x1.25, a token of this height fits a slot at,
 * keeping the clearance. Under 1 means it doesn't fit at x1.
 */
export function tokenScaleFor({ slotWidth, slotHeight, tokenHeight = TOKEN_HEIGHT }: { slotWidth: number; slotHeight: number; tokenHeight?: number }): number {
	return Math.min(TOKEN_MAX_SCALE, slotScale({ width: slotWidth, height: slotHeight, tokenHeight }));
}

/**
 * The one road layout function (Battle Screen Design, section 2), pure, on
 * mount and on every resize. The band is the stage's width (capped at 1600)
 * by whatever height the top bar and dock leave. A 16 px pad each side, the
 * 18 px row gutter on the left, then six equal lanes; under the 26 px header,
 * three equal rows. At 1280x720 every slot is 205x141.
 */
export function computeRoadLayout({ width, height }: { width: number; height: number }): RoadLayout {
	const gutterX = ROAD_PADDING_X;
	const gridX = gutterX + ROAD_ROW_GUTTER;
	const gridWidth = Math.max(0, width - ROAD_PADDING_X * 2 - ROAD_ROW_GUTTER);
	const rowsTop = ROAD_HEADER_HEIGHT + ROWS_INSET_TOP;
	const rowsHeight = Math.max(0, height - rowsTop - ROWS_INSET_BOTTOM);
	const slotWidth = gridWidth / LANE_ORDER.length;
	const slotHeight = rowsHeight / ROW_ORDER.length;
	const tokenScale = tokenScaleFor({ slotWidth, slotHeight });
	return {
		width,
		height,
		headerHeight: ROAD_HEADER_HEIGHT,
		gutterX,
		gridX,
		gridWidth,
		rowsTop,
		rowsHeight,
		slotWidth,
		slotHeight,
		lanes: LANE_ORDER.map((lane, index) => ({ lane, x: gridX + index * slotWidth, width: slotWidth })),
		rows: ROW_ORDER.map((row, index) => ({ row, y: rowsTop + index * slotHeight, height: slotHeight })),
		tokenScale,
		tokensFit: tokenScale >= 1,
	};
}

/**
 * A slot's rect in the road band's space: the whole cell. Tokens centre in
 * it (DDB-135 scales them into it), range labels hang off it (DDB-138), and
 * the fit suite measures against it (DDB-141). Writes into `out` when given,
 * so a caller placing every frame allocates nothing.
 */
export function roadSlotRect(layout: RoadLayout, slot: RoadSlot, out: RoadRect = { x: 0, y: 0, width: 0, height: 0 }): RoadRect {
	out.x = layout.gridX + LANE_ORDER.indexOf(slot.lane) * layout.slotWidth;
	out.y = layout.rowsTop + ROW_ORDER.indexOf(slot.row) * layout.slotHeight;
	out.width = layout.slotWidth;
	out.height = layout.slotHeight;
	return out;
}

/** Where the slot rows' middle is, for things centred on the rows rather than the band (the turn banner). */
export function roadRowsCenter(layout: RoadLayout): number {
	return layout.rowsTop + layout.rowsHeight / 2;
}
