import { LANE_ORDER, ROW_ORDER, RoadLane, RoadRow } from '../../mechanics/Road';
import {
	COMBAT_REFERENCE_HEIGHT,
	COMBAT_REFERENCE_WIDTH,
	DOCK_HEIGHT,
	STAGE_MAX_WIDTH,
	TOKEN_HEIGHT,
	TOKEN_MAX_SCALE,
	TOKEN_PASSENGER_HEIGHT,
	TOKEN_WIDTH,
	TOP_BAR_HEIGHT,
	computeCombatStage,
	computeRoadLayout,
	roadRowsCenter,
	roadSlotRect,
	tokenScaleFor,
} from './CombatLayout';

describe('computeCombatStage (Battle Screen Design, section 2)', () => {
	it.each([
		// [viewport, scale, logical canvas]
		[1280, 720, 1, 1280, 720],
		[1920, 1080, 1.5, 1280, 720],
		[1440, 882, 1.125, 1280, 784],
		[2560, 1080, 1.5, 2560 / 1.5, 720],
		[1280, 800, 1, 1280, 800],
		[1024, 768, 0.8, 1280, 960],
		[1024, 600, 0.8, 1280, 750],
	])('%ix%i scales by %f over a %fx%f canvas', (width, height, scale, logicalWidth, logicalHeight) => {
		const stage = computeCombatStage({ width, height });
		expect(stage.scale).toBeCloseTo(scale);
		expect(stage.width).toBeCloseTo(logicalWidth);
		expect(stage.height).toBeCloseTo(logicalHeight);
	});

	it('scales the canvas back to exactly the viewport', () => {
		for (const [width, height] of [[1366, 768], [1600, 900], [3440, 1440], [1133, 744]]) {
			const stage = computeCombatStage({ width, height });
			expect(stage.width * stage.scale).toBeCloseTo(width);
			expect(stage.height * stage.scale).toBeCloseTo(height);
		}
	});

	it('never scales below 0.8, so a phone-sized viewport gets a canvas smaller than the reference', () => {
		const stage = computeCombatStage({ width: 800, height: 450 });
		expect(stage.scale).toBe(0.8);
		expect(stage.width).toBeCloseTo(1000);
		expect(stage.height).toBeCloseTo(562.5);
	});

	it('lays an unmeasured viewport out at the reference, unscaled', () => {
		expect(computeCombatStage({ width: 0, height: 0 })).toEqual({
			scale: 1,
			width: COMBAT_REFERENCE_WIDTH,
			height: COMBAT_REFERENCE_HEIGHT,
		});
	});
});

describe('computeRoadLayout (Battle Screen Design, sections 1 and 2)', () => {
	/** The road band for a viewport: the stage's width, capped at 1600, by what the top bar and dock leave. */
	function roadBand(viewportWidth: number, viewportHeight: number): { width: number; height: number } {
		const stage = computeCombatStage({ width: viewportWidth, height: viewportHeight });
		return { width: Math.min(stage.width, STAGE_MAX_WIDTH), height: stage.height - TOP_BAR_HEIGHT - DOCK_HEIGHT };
	}

	it('makes every slot 205x141 at 1280x720, under a 26 px header and beside an 18 px gutter', () => {
		const layout = computeRoadLayout(roadBand(1280, 720));
		expect(layout.height).toBe(456);
		expect(layout.headerHeight).toBe(26);
		expect(layout.gridX - layout.gutterX).toBe(18);
		expect(layout.slotWidth).toBeCloseTo(205);
		expect(Math.round(layout.slotHeight)).toBe(141);
		expect(layout.tokensFit).toBe(true);
	});

	it('lays the lanes out left to right and the rows ahead to behind, edge to edge', () => {
		const layout = computeRoadLayout(roadBand(1280, 720));
		expect(layout.lanes.map(({ lane }) => lane)).toEqual(LANE_ORDER);
		expect(layout.rows.map(({ row }) => row)).toEqual(ROW_ORDER);
		layout.lanes.forEach((lane, index) => expect(lane.x).toBeCloseTo(layout.gridX + index * layout.slotWidth));
		expect(layout.lanes[5].x + layout.slotWidth).toBeCloseTo(layout.width - 16);
		expect(layout.rows[2].y + layout.slotHeight).toBeCloseTo(layout.height - 4);
	});

	it.each([
		[1440, 882],
		[1024, 600],
		[1280, 800],
		[1920, 1080],
		[2560, 1080],
		[1024, 768],
	])('fits a token at x1 or more, and never past x1.25, at %ix%i', (width, height) => {
		const layout = computeRoadLayout(roadBand(width, height));
		expect(layout.tokensFit).toBe(true);
		expect(layout.tokenScale).toBeGreaterThanOrEqual(1);
		expect(layout.tokenScale).toBeLessThanOrEqual(TOKEN_MAX_SCALE);
		expect(TOKEN_WIDTH * layout.tokenScale).toBeLessThanOrEqual(layout.slotWidth);
		expect(TOKEN_HEIGHT * layout.tokenScale).toBeLessThanOrEqual(layout.slotHeight);
	});

	it('gives spare width to the slots on a wide stage, up to the 1600 cap', () => {
		const layout = computeRoadLayout(roadBand(2560, 1080));
		expect(layout.width).toBe(STAGE_MAX_WIDTH);
		expect(layout.slotWidth).toBeCloseTo((1600 - 16 * 2 - 18) / 6);
	});

	it('reports a road too small for a token at x1 rather than flooring the scale', () => {
		const layout = computeRoadLayout(roadBand(800, 450));
		expect(layout.tokensFit).toBe(false);
		expect(layout.tokenScale).toBeLessThan(1);
	});

	it('scales a passenger token by its own height', () => {
		const layout = computeRoadLayout(roadBand(1280, 720));
		const withPassenger = tokenScaleFor({ slotWidth: layout.slotWidth, slotHeight: layout.slotHeight, tokenHeight: TOKEN_PASSENGER_HEIGHT });
		expect(withPassenger).toBeLessThanOrEqual(layout.tokenScale);
		expect(withPassenger).toBeGreaterThanOrEqual(1);
	});

	it('writes a slot\'s rect into the one it is given', () => {
		const layout = computeRoadLayout(roadBand(1280, 720));
		const out = { x: 0, y: 0, width: 0, height: 0 };
		const rect = roadSlotRect(layout, { lane: RoadLane.ENEMY_INSIDE, row: RoadRow.BEHIND }, out);
		expect(rect).toBe(out);
		expect(rect.x).toBeCloseTo(layout.gridX + 3 * layout.slotWidth);
		expect(rect.y).toBeCloseTo(layout.rowsTop + 2 * layout.slotHeight);
		expect(rect.width).toBeCloseTo(layout.slotWidth);
	});

	it('centres the rows half a header below the band\'s middle', () => {
		const layout = computeRoadLayout(roadBand(1280, 720));
		expect(roadRowsCenter(layout)).toBeCloseTo(layout.height / 2 + 13);
	});
});
