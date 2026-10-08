import { Rng } from '../core/Rng';
import { chaikin, pointSegmentDistanceSquared, segmentDistanceSquared, segmentsMeet, unitVector } from './Geometry';

/** The least distance from dense samples of one segment to another: slow, and only as fine as its samples. */
function sampledDistance(a: number[], b: number[], samples = 1000): number {
	let best = Infinity;
	for (let i = 0; i <= samples; i += 1) {
		const ax = a[0] + (a[2] - a[0]) * i / samples;
		const ay = a[1] + (a[3] - a[1]) * i / samples;
		best = Math.min(best, Math.sqrt(pointSegmentDistanceSquared(ax, ay, b[0], b[1], b[2], b[3])));
	}
	return best;
}

describe('unitVector', () => {
	it('matches cos and sin at any angle, through every quarter turn', () => {
		const out = { x: 0, y: 0 };
		// Most of the gap is Math's: degrees * PI / 180 is itself rounded, by up to 2e-15 at two turns.
		for (let degrees = -720; degrees <= 720; degrees += 0.37) {
			unitVector(degrees, out);
			expect(Math.abs(out.x - Math.cos(degrees * Math.PI / 180))).toBeLessThan(4e-15);
			expect(Math.abs(out.y - Math.sin(degrees * Math.PI / 180))).toBeLessThan(4e-15);
		}
	});

	it('is exact on the axes and unit length everywhere', () => {
		const out = { x: 0, y: 0 };
		expect(unitVector(0, out)).toEqual({ x: 1, y: 0 });
		expect(unitVector(90, out).x).toBeCloseTo(0, 15);
		expect(unitVector(90, out).y).toBe(1);
		expect(unitVector(180, out).x).toBe(-1);
		expect(unitVector(270, out).y).toBe(-1);
		for (let degrees = 0; degrees < 360; degrees += 1.3) {
			unitVector(degrees, out);
			expect(Math.abs(out.x * out.x + out.y * out.y - 1)).toBeLessThan(1e-15);
		}
	});
});

describe('pointSegmentDistanceSquared', () => {
	it('measures to the nearest point of the segment, ends included', () => {
		expect(pointSegmentDistanceSquared(5, 3, 0, 0, 10, 0)).toBe(9);
		expect(pointSegmentDistanceSquared(-3, 4, 0, 0, 10, 0)).toBe(25);
		expect(pointSegmentDistanceSquared(13, 4, 0, 0, 10, 0)).toBe(25);
		expect(pointSegmentDistanceSquared(3, 4, 0, 0, 0, 0)).toBe(25);
	});
});

describe('segmentDistanceSquared', () => {
	it('agrees with dense sampling for random segments, crossing, parallel, and degenerate ones', () => {
		const rng = new Rng({ seed: 290 });
		const random = () => (rng.float() * 2 - 1) * 50;
		const cases: number[][][] = [
			[[0, 0, 10, 0], [5, -5, 5, 5]],
			[[0, 0, 10, 0], [0, 3, 10, 3]],
			[[0, 0, 10, 0], [4, 0, 14, 0]],
			[[0, 0, 10, 0], [12, 0, 20, 0]],
			[[0, 0, 0, 0], [3, 4, 3, 4]],
			[[0, 0, 0, 0], [-5, 2, 5, 2]],
			[[1, 1, 1, 1], [0, 0, 10, 10]],
		];
		for (let index = 0; index < 300; index += 1) cases.push([[random(), random(), random(), random()], [random(), random(), random(), random()]]);
		cases.forEach(([a, b]) => {
			const exact = Math.sqrt(segmentDistanceSquared(a[0], a[1], a[2], a[3], b[0], b[1], b[2], b[3]));
			const sampled = Math.min(sampledDistance(a, b), sampledDistance(b, a));
			// Sampling can only overshoot, by at most half a sample's length.
			expect(exact).toBeLessThanOrEqual(sampled + 1e-9);
			expect(sampled - exact).toBeLessThan(0.15);
			expect(Math.sqrt(segmentDistanceSquared(b[0], b[1], b[2], b[3], a[0], a[1], a[2], a[3]))).toBeCloseTo(exact, 9);
		});
	});

	it('is zero for crossing and touching segments, and exact for segments sharing an end', () => {
		expect(segmentDistanceSquared(0, 0, 10, 10, 0, 10, 10, 0)).toBeCloseTo(0, 20);
		expect(segmentDistanceSquared(0, 0, 10, 0, 10, 0, 20, 5)).toBe(0);
		expect(segmentDistanceSquared(0, 0, 10, 0, 0, 0, -5, 7)).toBe(0);
	});
});

describe('segmentsMeet', () => {
	it('finds crossings and touches, and nothing in near misses', () => {
		expect(segmentsMeet(0, 0, 10, 10, 0, 10, 10, 0)).toBe(true);
		expect(segmentsMeet(64.28, 376.6, -50, 460, 0, 400, 0, 500)).toBe(true);
		expect(segmentsMeet(0, 0, 10, 0, 10, 0, 20, 5)).toBe(true);
		expect(segmentsMeet(0, 0, 10, 0, 5, 0, 5, 7)).toBe(true);
		expect(segmentsMeet(0, 0, 10, 0, 4, 0, 14, 0)).toBe(true);
		expect(segmentsMeet(0, 0, 10, 0, 11, 0, 14, 0)).toBe(false);
		expect(segmentsMeet(0, 0, 10, 0, 5, 1e-9, 5, 7)).toBe(false);
		expect(segmentsMeet(0, 0, 10, 10, 0, 1, 9, 10.001)).toBe(false);
	});

	it('agrees with the distance where the segments are clearly apart or clearly crossing', () => {
		const rng = new Rng({ seed: 291 });
		const random = () => (rng.float() * 2 - 1) * 50;
		for (let index = 0; index < 500; index += 1) {
			const [ax, ay, bx, by, cx, cy, dx, dy] = Array.from({ length: 8 }, random);
			const distance = Math.sqrt(segmentDistanceSquared(ax, ay, bx, by, cx, cy, dx, dy));
			if (distance > 1e-6) expect(segmentsMeet(ax, ay, bx, by, cx, cy, dx, dy)).toBe(false);
			else expect(segmentsMeet(ax, ay, bx, by, cx, cy, dx, dy)).toBe(true);
		}
	});
});

describe('chaikin', () => {
	const polyline = [0, 0, 20, 0, 30, 17, 30, 37, 45, 50];

	it('cuts each corner at its segments\' quarter points and keeps both ends', () => {
		const smoothed = chaikin(polyline);
		expect(smoothed).toHaveLength(2 * (2 * 5 - 2));
		expect(smoothed.slice(0, 4)).toEqual([0, 0, 15, 0]);
		expect(smoothed.slice(4, 6)).toEqual([22.5, 4.25]);
		expect(smoothed.slice(-2)).toEqual([45, 50]);
	});

	it('keeps the first and last segments\' directions through two passes', () => {
		const smoothed = chaikin(chaikin(polyline));
		const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
		expect(cross(smoothed[2] - smoothed[0], smoothed[3] - smoothed[1], 20, 0)).toBeCloseTo(0, 12);
		const n = smoothed.length;
		expect(cross(smoothed[n - 2] - smoothed[n - 4], smoothed[n - 1] - smoothed[n - 3], 15, 13)).toBeCloseTo(0, 12);
		expect(smoothed[2] - smoothed[0]).toBeGreaterThan(0);
	});

	it('leaves a single segment alone and returns a new array', () => {
		const segment = [1, 2, 3, 4];
		expect(chaikin(segment)).toEqual(segment);
		expect(chaikin(segment)).not.toBe(segment);
	});
});
