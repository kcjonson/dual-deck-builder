import { Rng } from '../core/Rng';
import { pointSegmentDistanceSquared } from './Geometry';
import { SegmentIndex } from './SegmentIndex';

interface Filed {
	readonly id: number;
	readonly x0: number;
	readonly y0: number;
	readonly x1: number;
	readonly y1: number;
	readonly owner: number;
}

/** 600 short segments over a 1000-unit square, filed under five owners: past every starting capacity. */
function filled(): { index: SegmentIndex; segments: Filed[] } {
	const rng = new Rng({ seed: 41 });
	const index = new SegmentIndex({ extent: 500, cellSize: 24 });
	const segments: Filed[] = [];
	for (let count = 0; count < 600; count += 1) {
		const x0 = (rng.float() * 2 - 1) * 480;
		const y0 = (rng.float() * 2 - 1) * 480;
		const x1 = x0 + (rng.float() * 2 - 1) * 40;
		const y1 = y0 + (rng.float() * 2 - 1) * 40;
		const owner = count % 5;
		segments.push({ id: index.add(x0, y0, x1, y1, owner), x0, y0, x1, y1, owner });
	}
	return { index, segments };
}

describe('SegmentIndex', () => {
	it('returns every segment whose box meets the query box, each once', () => {
		const { index, segments } = filled();
		expect(index.size).toBe(600);
		[[-100, -100, 50, 20], [300, 300, 520, 520], [-500, -500, 500, 500], [10, 10, 10, 10]].forEach(([minX, minY, maxX, maxY]) => {
			const count = index.query(minX, minY, maxX, maxY);
			const found = Array.from(index.results.slice(0, count));
			expect(new Set(found).size).toBe(count);
			const meeting = segments.filter((s) => Math.max(s.x0, s.x1) >= minX && Math.min(s.x0, s.x1) <= maxX && Math.max(s.y0, s.y1) >= minY && Math.min(s.y0, s.y1) <= maxY);
			meeting.forEach((s) => expect(found).toContain(s.id));
		});
	});

	it('finds the distance to the nearest segment of another owner, up to a limit', () => {
		const { index, segments } = filled();
		const rng = new Rng({ seed: 43 });
		for (let probe = 0; probe < 200; probe += 1) {
			const x = (rng.float() * 2 - 1) * 500;
			const y = (rng.float() * 2 - 1) * 500;
			const skip = probe % 5;
			const brute = Math.min(60, ...segments.filter((s) => s.owner !== skip).map((s) => Math.sqrt(pointSegmentDistanceSquared(x, y, s.x0, s.y0, s.x1, s.y1))));
			expect(index.nearest(x, y, 60, skip)).toBeCloseTo(brute, 9);
		}
	});

	it('files segments outside its square in the edge cells rather than losing them', () => {
		const index = new SegmentIndex({ extent: 100, cellSize: 20 });
		const id = index.add(150, 150, 170, 160, 0);
		const count = index.query(90, 90, 200, 200);
		expect(Array.from(index.results.slice(0, count))).toEqual([id]);
	});
});
