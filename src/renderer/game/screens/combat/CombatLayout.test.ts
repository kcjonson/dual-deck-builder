import { COMBAT_REFERENCE_HEIGHT, COMBAT_REFERENCE_WIDTH, computeCombatStage } from './CombatLayout';

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
