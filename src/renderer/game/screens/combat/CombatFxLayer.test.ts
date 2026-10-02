import { arrowHead, dotsAlong, pointOnCurve, targetingCurve } from './CombatFxLayer';

describe('the targeting line', () => {
	it('leaves the card going straight up and ends at the pointer', () => {
		const curve = targetingCurve({ x: 100, y: 500 }, { x: 400, y: 100 });
		expect(pointOnCurve(curve, 0)).toEqual({ x: 100, y: 500 });
		expect(pointOnCurve(curve, 1)).toEqual({ x: 400, y: 100 });
		const early = pointOnCurve(curve, 0.01);
		expect(Math.abs(early.x - 100)).toBeLessThan(Math.abs(early.y - 500));
	});

	it('spaces its dots 12 apart and stops short of the head', () => {
		const dots = dotsAlong(targetingCurve({ x: 0, y: 200 }, { x: 0, y: 0 }), 16);
		expect(dots[0].y).toBeCloseTo(194, 6);
		for (let index = 1; index < dots.length; index++) {
			expect(dots[index - 1].y - dots[index].y).toBeCloseTo(12, 6);
		}
		expect(dots[dots.length - 1].y).toBeGreaterThanOrEqual(16);
	});

	it('points its head along the curve at the pointer, and up when the curve has no length', () => {
		const [base] = arrowHead(targetingCurve({ x: 0, y: 200 }, { x: 0, y: 0 }));
		expect(base.x).toBeCloseTo(0, 6);
		expect(base.y).toBeCloseTo(16, 6);
		const [still] = arrowHead(targetingCurve({ x: 50, y: 50 }, { x: 50, y: 50 }));
		expect(still).toEqual({ x: 50, y: 66 });
	});
});
