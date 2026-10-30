import type { RiverLines } from '../../map/Rivers';
import { RIVER_STYLE } from './areaMapStyle';
import { RiverGeometry } from './riverGeometry';

describe('RiverGeometry', () => {
	// Two rivers: one widening as it runs east and out past the rim of a disc of 100, one short and all inside.
	const lines: RiverLines = {
		points: Float64Array.of(-50, 0, 0, 0, 20, 0, 60, 0, 150, 0, 0, -20, 0, -40),
		widths: Float64Array.of(1.2, 1.3, 4, 4.2, 5, 2, 2),
		offsets: Uint32Array.of(0, 5, 7),
	};
	const geometry = new RiverGeometry({ rivers: lines, radius: 100 });

	it('cuts each river into runs of one rounded width, joined end to end, and at the rim', () => {
		const rounded = (width: number) => RIVER_STYLE.widthStep * Math.round(width / RIVER_STYLE.widthStep);
		// 1.2 and 1.3 round alike; 4, 4.2, and 5 each round apart, and the last point's own width starts nothing.
		expect(geometry.runs.map(({ width, inside }) => [width, inside])).toEqual([
			[rounded(1.2), true],
			[rounded(4), true],
			[rounded(4.2), true],
			[rounded(4.2), false],
			[rounded(2), true],
		]);
		// Map space is world y flipped; a run starts where the one before it ended.
		expect(geometry.runs[0].points).toEqual([{ x: -50, y: -0 }, { x: 0, y: -0 }, { x: 20, y: -0 }]);
		expect(geometry.runs[1].points).toEqual([{ x: 20, y: -0 }, { x: 60, y: -0 }]);
		expect(geometry.runs[2].points[0]).toEqual({ x: 60, y: -0 });
		expect(geometry.runs[2].points[1].x).toBeCloseTo(100, 12);
		expect(geometry.runs[3].points[0]).toEqual(geometry.runs[2].points[1]);
		expect(geometry.runs[4].points).toEqual([{ x: 0, y: 20 }, { x: 0, y: 40 }]);
		expect(geometry.runs[4].bounds).toEqual({ minX: 0, minY: 20, maxX: 0, maxY: 40 });
	});

	it('hands back the whole run at level -1 and a simplified one, kept, at a coarser level', () => {
		const run = 0;
		expect(geometry.polyline(run, -1)).toBe(geometry.runs[run].points);
		const coarse = geometry.polyline(run, 3);
		expect(coarse).toEqual([{ x: -50, y: -0 }, { x: 20, y: -0 }]);
		expect(geometry.polyline(run, 3)).toBe(coarse);
	});
});
