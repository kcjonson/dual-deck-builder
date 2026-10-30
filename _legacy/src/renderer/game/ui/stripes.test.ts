import { hatchPolygonTriangles, hatchTriangles, roundedRectPolygon } from './stripes';

const RECT = { x: 2, y: 2, width: 76, height: 10 };
const HATCH = { period: 10, stripe: 5 };

/** Twice a triangle list's area, summed. */
function area(triangles: readonly { x: number; y: number }[]): number {
	let total = 0;
	for (let index = 0; index + 2 < triangles.length; index += 3) {
		const [a, b, c] = [triangles[index], triangles[index + 1], triangles[index + 2]];
		total += Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
	}
	return total / 2;
}

describe('hatchPolygonTriangles', () => {
	it('hatches a rect\'s corners exactly as the rect hatch does', () => {
		const corners = [{ x: 2, y: 2 }, { x: 78, y: 2 }, { x: 78, y: 12 }, { x: 2, y: 12 }];
		expect(hatchPolygonTriangles(corners, HATCH)).toEqual(hatchTriangles(RECT, HATCH));
	});

	it('covers half a band\'s area at a stripe of half the period, give or take its ends', () => {
		const covered = area(hatchTriangles(RECT, HATCH));
		expect(covered).toBeGreaterThan(RECT.width * RECT.height * 0.4);
		expect(covered).toBeLessThan(RECT.width * RECT.height * 0.6);
	});

	it('keeps every stripe inside a rounded polygon, a little less of it than the square rect', () => {
		const rounded = roundedRectPolygon(RECT, [3, 3, 0, 0]);
		const triangles = hatchPolygonTriangles(rounded, HATCH);
		for (const { x, y } of triangles) {
			const corner = x < 5 ? 5 : x > 75 ? 75 : null;
			if (corner !== null && y < 5) expect(Math.hypot(x - corner, y - 5)).toBeLessThanOrEqual(3 + 1e-9);
		}
		expect(area(triangles)).toBeLessThanOrEqual(area(hatchTriangles(RECT, HATCH)));
	});
});

describe('roundedRectPolygon', () => {
	it('runs clockwise round a rect\'s corners, a square corner one point and a rounded one a quarter circle', () => {
		const square = roundedRectPolygon(RECT, [0, 0, 0, 0]);
		expect(square).toEqual([{ x: 2, y: 2 }, { x: 78, y: 2 }, { x: 78, y: 12 }, { x: 2, y: 12 }]);
		const rounded = roundedRectPolygon(RECT, [3, 3, 0, 0]);
		expect(rounded[0].x).toBeCloseTo(2);
		expect(rounded[0].y).toBeCloseTo(5);
		expect(rounded[4].x).toBeCloseTo(5);
		expect(rounded[4].y).toBeCloseTo(2);
		for (const point of rounded.slice(0, 5)) expect(Math.hypot(point.x - 5, point.y - 5)).toBeCloseTo(3);
		expect(rounded.slice(-2)).toEqual([{ x: 78, y: 12 }, { x: 2, y: 12 }]);
	});
});
