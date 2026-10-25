import { RoadArc } from './RoadArc';
import { ROAD_HEADER_HEIGHT } from './CombatLayout';

describe('RoadArc', () => {
	it('runs from one end to the other, rising over the higher end but never into the lane header', () => {
		const arc = new RoadArc();
		const length = arc.trace({ x: 100, y: 300 }, { x: 400, y: 120 });
		const start = { x: 0, y: 0 };
		const end = { x: 0, y: 0 };
		arc.pointAt(0, 1, start);
		arc.pointAt(length, 1, end);
		expect(start.x).toBeCloseTo(100, 6);
		expect(start.y).toBeCloseTo(300, 6);
		expect(end.x).toBeCloseTo(400, 6);
		expect(end.y).toBeCloseTo(120, 6);

		const top = { x: 0, y: 0 };
		let highest = Infinity;
		for (let distance = 0; distance <= length; distance += 4) {
			arc.pointAt(distance, 1, top);
			highest = Math.min(highest, top.y);
		}
		expect(highest).toBeLessThan(120);
		expect(highest).toBeGreaterThan(ROAD_HEADER_HEIGHT);
	});

	it('holds under the lane header when an end is near it', () => {
		const arc = new RoadArc();
		const length = arc.trace({ x: 0, y: 200 }, { x: 300, y: ROAD_HEADER_HEIGHT + 10 });
		const point = { x: 0, y: 0 };
		for (let distance = 0; distance <= length; distance += 2) {
			arc.pointAt(distance, 1, point);
			expect(point.y).toBeGreaterThanOrEqual(ROAD_HEADER_HEIGHT);
		}
	});

	it('comes down steeply onto its end with a drop, where without one it comes in from the side', () => {
		const arc = new RoadArc();
		const from = { x: 0, y: 200 };
		const to = { x: 300, y: 200 };
		const neck = { x: 0, y: 0 };
		const flat = arc.trace(from, to);
		arc.pointAt(flat - 16, 1, neck);
		expect(Math.abs(to.x - neck.x)).toBeGreaterThan(to.y - neck.y);
		const steep = arc.trace(from, to, 40);
		arc.pointAt(steep - 16, 1, neck);
		expect(to.y - neck.y).toBeGreaterThan(Math.abs(to.x - neck.x));
	});

	it('bows a move left of the way it goes, so two vehicles trading slots draw two arcs', () => {
		const arc = new RoadArc();
		const middle = { x: 0, y: 0 };
		const right = arc.traceMove({ x: 0, y: 100 }, { x: 200, y: 100 });
		arc.pointAt(right / 2, 1, middle);
		expect(middle.y).toBeLessThan(100);
		const left = arc.traceMove({ x: 200, y: 100 }, { x: 0, y: 100 });
		arc.pointAt(left / 2, 1, middle);
		expect(middle.y).toBeGreaterThan(100);
	});

	it('bows a move by its share of its length at the middle, and no more than the cap', () => {
		const arc = new RoadArc();
		const middle = { x: 0, y: 0 };
		const short = arc.traceMove({ x: 0, y: 100 }, { x: 60, y: 100 });
		arc.pointAt(short / 2, 1, middle);
		expect(100 - middle.y).toBeCloseTo(12, 0);
		const long = arc.traceMove({ x: 0, y: 100 }, { x: 600, y: 100 });
		arc.pointAt(long / 2, 1, middle);
		expect(100 - middle.y).toBeCloseTo(28, 0);
	});

	it('says how far along a move comes out from under the box it starts in', () => {
		const arc = new RoadArc();
		const length = arc.traceMove({ x: 0, y: 0 }, { x: 0, y: 300 });
		expect(arc.leaves({ x: -50, y: -50, width: 100, height: 100 })).toBeGreaterThan(50);
		expect(arc.leaves({ x: -50, y: -50, width: 100, height: 100 })).toBeLessThan(length);
		expect(arc.leaves({ x: 100, y: 100, width: 10, height: 10 })).toBe(0);
	});

	it('lines its points up to a distance along it, ending exactly there', () => {
		const arc = new RoadArc();
		const length = arc.trace({ x: 0, y: 200 }, { x: 200, y: 200 });
		const points: { x: number; y: number }[] = [];
		const count = arc.pointsBetween(0, length - 16, points);
		const neck = { x: 0, y: 0 };
		arc.pointAt(length - 16, 1, neck);
		expect(points[0]).toEqual({ x: 0, y: 200 });
		expect(points[count - 1].x).toBeCloseTo(neck.x, 6);
		expect(points[count - 1].y).toBeCloseTo(neck.y, 6);
		// The buffer is reused, and only grows
		expect(arc.pointsBetween(0, length / 2, points)).toBeLessThan(count);
		expect(points.length).toBe(count);
		// Nothing between a start and an end that isn't past it
		expect(arc.pointsBetween(50, 50, points)).toBe(0);
		expect(arc.pointsBetween(60, 50, points)).toBe(0);
	});
});
