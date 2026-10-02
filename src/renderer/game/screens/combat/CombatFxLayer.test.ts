import { arrowHead, dotsAlong, hitCheckText, pointOnCurve, targetingCurve } from './CombatFxLayer';
import type { AimPreview } from '../../mechanics/AimPreview';

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

describe('the hit check', () => {
	const preview = (check: AimPreview['check'], range: number | null = 1): AimPreview => ({
		actor: null,
		range,
		reach: 2,
		lands: true,
		check,
		losses: { structure: 0, driver: 0, passenger: 0 },
	});

	it('reads gunnery against evade with the card\'s modifier, then the range', () => {
		expect(hitCheckText(preview({ skill: 'gunnery', attack: 7, evade: 4, modifier: 2, hits: true }))).toEqual({
			verdict: 'HIT', detail: 'Gunnery 7 vs Evade 4+2', range: ' · R1', hits: true,
		});
		expect(hitCheckText(preview({ skill: 'gunnery', attack: 4, evade: 4, modifier: -1, hits: true }, 2)).detail).toBe('Gunnery 4 vs Evade 4-1');
	});

	it('says MISS when the check fails, ramming for a ram, and Sure-hit when nothing rolls', () => {
		expect(hitCheckText(preview({ skill: 'gunnery', attack: 3, evade: 4, modifier: 0, hits: false })).verdict).toBe('MISS');
		expect(hitCheckText(preview({ skill: 'ramming', attack: 5, evade: 4, modifier: 0, hits: true })).detail).toBe('Ramming 5 vs Evade 4');
		expect(hitCheckText(preview(null, null))).toEqual({ verdict: 'HIT', detail: 'Sure-hit', range: '', hits: true });
	});
});
