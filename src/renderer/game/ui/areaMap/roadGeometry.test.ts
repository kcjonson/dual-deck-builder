import {
	DETAIL_LEVELS,
	DETAIL_PIXELS,
	FIRST_DETAIL_TOLERANCE,
	RoadGeometry,
	dashesAlong,
	detailLevel,
	distanceToPolyline,
	lengthOf,
	simplifyPolyline,
	toMapSpace,
	truncatePolyline,
} from './roadGeometry';
import { SMALL_NETWORK } from './testing';

describe('road geometry', () => {
	it('keeps each stretch in map space, world y flipped, with its bounds and length', () => {
		const geometry = new RoadGeometry(SMALL_NETWORK);
		expect(geometry.stretches[1].points).toEqual([{ x: 0, y: -100 }, { x: 0, y: -200 }, { x: 0, y: -300 }]);
		expect(geometry.stretches[3].bounds).toEqual({ minX: 0, minY: -400, maxX: 200, maxY: -300 });
		expect(geometry.stretches[2].length).toBe(200);
	});

	it('finds the junctions and the stretch leading into each', () => {
		const geometry = new RoadGeometry(SMALL_NETWORK);
		expect(geometry.junctions).toEqual([{ node: 2, at: { x: 0, y: -300 }, inbound: 1 }]);
	});

	it('picks the coarsest detail level that stays under the pixel tolerance', () => {
		expect(detailLevel(4)).toBe(-1);
		expect(detailLevel(DETAIL_PIXELS / FIRST_DETAIL_TOLERANCE)).toBe(0);
		expect(detailLevel(0.2)).toBe(Math.floor(Math.log2(DETAIL_PIXELS / 0.2 / FIRST_DETAIL_TOLERANCE)));
		expect(detailLevel(1e-6)).toBe(DETAIL_LEVELS - 1);
		for (const zoom of [0.1, 0.25, 0.5, 1, 1.6, 3]) {
			const level = detailLevel(zoom);
			if (level >= 0) expect(FIRST_DETAIL_TOLERANCE * 2 ** level * zoom).toBeLessThanOrEqual(DETAIL_PIXELS + 1e-12);
		}
	});

	it('simplifies within the tolerance and keeps both ends', () => {
		// A gentle arc of 100 points
		const arc = Array.from({ length: 100 }, (_unused, index) => ({ x: index * 2, y: Math.sin(index / 20) * 30 }));
		for (const tolerance of [0.25, 1, 4]) {
			const simplified = simplifyPolyline(arc, tolerance);
			expect(simplified[0]).toBe(arc[0]);
			expect(simplified[simplified.length - 1]).toBe(arc[arc.length - 1]);
			expect(simplified.length).toBeLessThan(arc.length);
			for (const point of arc) expect(distanceToPolyline(simplified, point.x, point.y)).toBeLessThanOrEqual(tolerance + 1e-9);
		}
		expect(simplifyPolyline(arc, 4).length).toBeLessThan(simplifyPolyline(arc, 0.25).length);
	});

	it('caches each detail level once per stretch', () => {
		const geometry = new RoadGeometry(SMALL_NETWORK);
		expect(geometry.polyline(1, -1)).toBe(geometry.stretches[1].points);
		const coarse = geometry.polyline(1, 2);
		expect(coarse).toEqual([{ x: 0, y: -100 }, { x: 0, y: -300 }]);
		expect(geometry.polyline(1, 2)).toBe(coarse);
	});

	it('cuts dashes along a stub, turning corners, and stops at its length', () => {
		const points = toMapSpace([0, 0, 10, 0, 10, 10]);
		const dashes = dashesAlong(points, 18, 4, 2);
		// Dashes at 0-4, 6-10, 12-16 (round the corner at 10 the second ends exactly there)
		expect(dashes.map((dash) => dash.along)).toEqual([0, 6 / 18, 12 / 18]);
		expect(dashes[0].points).toEqual([{ x: 0, y: 0 }, { x: 4, y: 0 }]);
		expect(dashes[2].points).toEqual([{ x: 10, y: -2 }, { x: 10, y: -6 }]);
		const corner = dashesAlong(points, 20, 6, 1);
		// The second dash starts at 7 and turns the corner at 10, to 13
		expect(corner[1].points).toEqual([{ x: 7, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -3 }]);
		expect(dashesAlong(points, 0, 4, 2)).toEqual([]);
		expect(dashesAlong(points, 10, 0, 2)).toEqual([]);
	});

	it('measures the distance to a polyline, within a length along it', () => {
		const points = toMapSpace([0, 0, 100, 0]);
		expect(distanceToPolyline(points, 50, -3)).toBeCloseTo(3, 12);
		expect(distanceToPolyline(points, 90, 0)).toBe(0);
		expect(distanceToPolyline(points, 90, 0, 40)).toBeCloseTo(50, 12);
		expect(distanceToPolyline(points, -4, 3)).toBeCloseTo(5, 12);
	});

	it('truncates a polyline mid-segment', () => {
		const points = toMapSpace([0, 0, 10, 0, 10, 10]);
		expect(truncatePolyline(points, 15)).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: -5 }]);
		expect(truncatePolyline(points, 100)).toEqual(points);
		expect(lengthOf(truncatePolyline(points, 7))).toBeCloseTo(7, 12);
	});
});
