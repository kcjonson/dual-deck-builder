import { Rng } from '../core/Rng';
import { startRadii } from './Land';
import { GridSampler, LandGrid, cellCentre, landGridFor } from './LandGrid';
import { UpliftField, buildUplift } from './Uplift';

const RADIUS = 600;
const GRID = landGridFor(RADIUS);
const RADII = startRadii({ radius: RADIUS, metroSize: 0.15 });

function upliftFor({ seed, mountainCoverage = 0.25, ruggedness = 0.5 }: { seed: number; mountainCoverage?: number; ruggedness?: number }): UpliftField {
	return buildUplift({
		grid: GRID,
		radius: RADIUS,
		metroRadius: RADII.metroRadius,
		reliefRadius: RADII.reliefRadius,
		mountainCoverage,
		ruggedness,
		rng: new Rng({ seed }).fork('map', 0).fork('terrain', 0),
	});
}

/** Each cell whose centre lies from `inner` to `outer` of the compound, measured as the uplift measures it. */
function cellsBetween(grid: LandGrid, inner: number, outer: number): number[] {
	const cells: number[] = [];
	for (let row = 0; row < grid.size; row += 1) {
		for (let column = 0; column < grid.size; column += 1) {
			const x = cellCentre(grid, column);
			const y = cellCentre(grid, row);
			const distanceSquared = x * x + y * y;
			if (distanceSquared >= inner * inner && distanceSquared <= outer * outer) cells.push(row * grid.size + column);
		}
	}
	return cells;
}

describe('buildUplift', () => {
	const calibrated = cellsBetween(GRID, RADII.reliefRadius, RADIUS);

	it('gives ranges the share of the land past the relief radius that mountainCoverage asks for, on every seed', () => {
		[0.1, 0.25, 0.45, 0.8].forEach((mountainCoverage) => {
			for (let seed = 1; seed <= 6; seed += 1) {
				const { mountains } = upliftFor({ seed, mountainCoverage });
				const share = calibrated.filter((cell) => mountains[cell] >= 0.5).length / calibrated.length;
				expect(Math.abs(share - mountainCoverage)).toBeLessThan(1 / calibrated.length + 1e-9);
			}
		});
	});

	it('makes no ranges at a coverage of 0, and ranges everywhere past the relief radius at 1', () => {
		expect(upliftFor({ seed: 3, mountainCoverage: 0 }).mountains.every((value) => value === 0)).toBe(true);
		const { mountains } = upliftFor({ seed: 3, mountainCoverage: 1 });
		calibrated.forEach((cell) => expect(mountains[cell]).toBe(1));
	});

	it('lifts no range in the metro, only the hills, and those gently', () => {
		const { uplift, mountains } = upliftFor({ seed: 4, mountainCoverage: 1 });
		const level = upliftFor({ seed: 4, mountainCoverage: 0 });
		cellsBetween(GRID, 0, RADII.metroRadius).forEach((cell) => {
			expect(mountains[cell]).toBe(0);
			expect(uplift[cell]).toBe(level.uplift[cell]);
			expect(uplift[cell]).toBeGreaterThan(0);
			expect(uplift[cell]).toBeLessThan(0.1);
		});
	});

	it('lifts ranges harder as ruggedness rises', () => {
		const meanRangeLift = (ruggedness: number) => {
			const { uplift, mountains } = upliftFor({ seed: 5, ruggedness });
			const ranges = calibrated.filter((cell) => mountains[cell] === 1);
			return ranges.reduce((sum, cell) => sum + uplift[cell], 0) / ranges.length;
		};
		const gentle = meanRangeLift(0);
		const rugged = meanRangeLift(1);
		expect(rugged).toBeGreaterThan(2 * gentle);
	});

	// The warp bends belts and the breaks layer is the same every way, so a
	// map's ranges run with its grain loosely, not ruler-straight: over seeds
	// 11 to 24 the ratio ran 0.50 to 0.96, a mean of 0.76.
	it('runs ranges along the map\'s grain: the mask changes less along it than across it', () => {
		const ratios: number[] = [];
		for (let seed = 11; seed <= 18; seed += 1) {
			const { mountains, grain } = upliftFor({ seed, mountainCoverage: 0.3 });
			expect(Math.hypot(grain.x, grain.y)).toBeCloseTo(1, 12);
			const sampler = new GridSampler({ grid: GRID, values: mountains });
			const reach = 150;
			let along = 0;
			let across = 0;
			calibrated.forEach((cell) => {
				const x = cellCentre(GRID, cell % GRID.size);
				const y = cellCentre(GRID, Math.floor(cell / GRID.size));
				const here = mountains[cell];
				along += Math.abs(sampler.bilinear(x + reach * grain.x, y + reach * grain.y) - here);
				across += Math.abs(sampler.bilinear(x - reach * grain.y, y + reach * grain.x) - here);
			});
			ratios.push(along / across);
		}
		ratios.forEach((ratio) => expect(ratio).toBeLessThan(1));
		expect(ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length).toBeLessThan(0.85);
	});

	it('builds the same field from the same stream, and another from another seed', () => {
		const first = upliftFor({ seed: 21 });
		const again = upliftFor({ seed: 21 });
		const other = upliftFor({ seed: 22 });
		expect(Array.from(again.uplift)).toEqual(Array.from(first.uplift));
		expect(again.grain).toEqual(first.grain);
		expect(Array.from(other.uplift)).not.toEqual(Array.from(first.uplift));
	});
});
