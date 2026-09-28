import type { Vec2 } from './geometry';
import { isSingleOutline, triangulatePolygon } from './triangulate';

function star(tips: number, innerRadius: number): Vec2[] {
	const points: Vec2[] = [];
	const step = Math.PI / tips;
	for (let index = 0; index < tips * 2; index++) {
		const angle = index * step - Math.PI / 2;
		const radius = index % 2 === 0 ? 1 : innerRadius;
		points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
	}
	return points;
}

function doubleArea(a: Vec2, b: Vec2, c: Vec2): number {
	return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function outlineDoubleArea(points: readonly Vec2[]): number {
	let sum = 0;
	for (let index = 0; index < points.length; index++) {
		const from = points[index];
		const to = points[(index + 1) % points.length];
		sum += from.x * to.y - to.x * from.y;
	}
	return sum;
}

/** Even-odd ray cast; fine for the simple outlines these tests use. */
function insideOutline(points: readonly Vec2[], x: number, y: number): boolean {
	let inside = false;
	for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
		const a = points[index];
		const b = points[previous];
		if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
	}
	return inside;
}

function insideTriangle(a: Vec2, b: Vec2, c: Vec2, x: number, y: number): boolean {
	const point = { x, y };
	const d1 = doubleArea(a, b, point);
	const d2 = doubleArea(b, c, point);
	const d3 = doubleArea(c, a, point);
	return (d1 > 0 && d2 > 0 && d3 > 0) || (d1 < 0 && d2 < 0 && d3 < 0);
}

/**
 * What "correct" means for a fill: every triangle is real and wound like the
 * outline, their areas add up to the outline's, and sampled points inside the
 * outline are covered exactly once while points outside are not covered at
 * all. The sample grid is offset by irrational-ish steps so no sample lands on
 * an edge.
 */
function expectExactCover(points: readonly Vec2[], indices: readonly number[]): void {
	expect(indices.length % 3).toBe(0);
	const outlineArea = outlineDoubleArea(points);
	let coveredArea = 0;
	for (let index = 0; index < indices.length; index += 3) {
		const area = doubleArea(points[indices[index]], points[indices[index + 1]], points[indices[index + 2]]);
		expect(Math.sign(area)).toBe(Math.sign(outlineArea));
		expect(Math.abs(area)).toBeGreaterThan(1e-9);
		coveredArea += area;
	}
	expect(coveredArea).toBeCloseTo(outlineArea, 9);

	const xs = points.map((point) => point.x);
	const ys = points.map((point) => point.y);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const width = Math.max(...xs) - minX;
	const height = Math.max(...ys) - minY;
	for (let column = 0; column < 40; column++) {
		for (let row = 0; row < 40; row++) {
			const x = minX + width * ((column + 0.3183) / 40);
			const y = minY + height * ((row + 0.2718) / 40);
			let covers = 0;
			for (let index = 0; index < indices.length; index += 3) {
				const a = points[indices[index]];
				const b = points[indices[index + 1]];
				const c = points[indices[index + 2]];
				if (insideTriangle(a, b, c, x, y)) covers++;
			}
			expect(covers).toBe(insideOutline(points, x, y) ? 1 : 0);
		}
	}
}

describe('triangulatePolygon', () => {
	it('splits a convex quad into two triangles', () => {
		const square = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 1, y: 1 },
			{ x: 0, y: 1 },
		];
		const indices = triangulatePolygon(square);
		expect(indices).toHaveLength(6);
		expectExactCover(square, indices);
	});

	it('gives a regular hexagon four triangles', () => {
		const hexagon = Array.from({ length: 6 }, (_, index) => ({
			x: Math.cos((index * Math.PI) / 3),
			y: Math.sin((index * Math.PI) / 3),
		}));
		const indices = triangulatePolygon(hexagon);
		expect(indices).toHaveLength(12);
		expectExactCover(hexagon, indices);
	});

	it('fills the gallery star inside its outline, which a fan from the top tip does not', () => {
		const outline = star(5, 0.5);
		const indices = triangulatePolygon(outline);
		expect(indices).toHaveLength((outline.length - 2) * 3);
		expectExactCover(outline, indices);

		const fan: number[] = [];
		for (let corner = 1; corner < outline.length - 1; corner++) fan.push(0, corner, corner + 1);
		expect(() => expectExactCover(outline, fan)).toThrow();
	});

	it('handles a concave outline whose first vertex is the reflex one', () => {
		const ell = [
			{ x: 1, y: 1 },
			{ x: 1, y: 2 },
			{ x: 0, y: 2 },
			{ x: 0, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
		];
		const indices = triangulatePolygon(ell);
		expect(indices).toHaveLength(12);
		expectExactCover(ell, indices);
	});

	it('handles a comb with several reflex vertices', () => {
		const comb = [
			{ x: 0, y: 0 },
			{ x: 5, y: 0 },
			{ x: 5, y: 3 },
			{ x: 4, y: 3 },
			{ x: 4, y: 1 },
			{ x: 3, y: 1 },
			{ x: 3, y: 3 },
			{ x: 2, y: 3 },
			{ x: 2, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 3 },
			{ x: 0, y: 3 },
		];
		expectExactCover(comb, triangulatePolygon(comb));
	});

	it('produces the same cover for either winding, each wound like its outline', () => {
		const counterClockwise = star(5, 0.4);
		const clockwise = [...counterClockwise].reverse();
		expect(Math.sign(outlineDoubleArea(clockwise))).toBe(-Math.sign(outlineDoubleArea(counterClockwise)));
		expectExactCover(counterClockwise, triangulatePolygon(counterClockwise));
		expectExactCover(clockwise, triangulatePolygon(clockwise));
	});

	it('drops collinear vertices instead of emitting zero-area triangles', () => {
		const squareWithMidpoints = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
			{ x: 2, y: 2 },
			{ x: 1, y: 2 },
			{ x: 0, y: 2 },
			{ x: 0, y: 1 },
		];
		const indices = triangulatePolygon(squareWithMidpoints);
		expect(indices.length).toBeLessThanOrEqual((squareWithMidpoints.length - 2) * 3);
		expectExactCover(squareWithMidpoints, indices);
	});

	it('keeps a concave outline whose reflex corner has a collinear neighbour', () => {
		const ell = [
			{ x: 0, y: 0 },
			{ x: 1, y: 0 },
			{ x: 2, y: 0 },
			{ x: 2, y: 1 },
			{ x: 1, y: 1 },
			{ x: 1, y: 2 },
			{ x: 0, y: 2 },
			{ x: 0, y: 1 },
		];
		expectExactCover(ell, triangulatePolygon(ell));
	});

	it('works at pixel scale as well as unit scale', () => {
		const outline = star(7, 0.35).map((point) => ({ x: 400 + point.x * 300, y: 300 + point.y * 300 }));
		expectExactCover(outline, triangulatePolygon(outline));
	});

	it('returns nothing for fewer than three points or an outline with no area', () => {
		expect(triangulatePolygon([])).toEqual([]);
		expect(
			triangulatePolygon([
				{ x: 0, y: 0 },
				{ x: 1, y: 1 },
			]),
		).toEqual([]);
		expect(
			triangulatePolygon([
				{ x: 0, y: 0 },
				{ x: 1, y: 0 },
				{ x: 2, y: 0 },
				{ x: 3, y: 0 },
			]),
		).toEqual([]);
	});

	it('still terminates on a self-crossing outline', () => {
		const bowtie = [
			{ x: 0, y: 0 },
			{ x: 2, y: 2 },
			{ x: 2, y: 0 },
			{ x: 0, y: 2 },
			{ x: 1, y: 3 },
		];
		const indices = triangulatePolygon(bowtie);
		expect(indices.length % 3).toBe(0);
		for (const index of indices) expect(index).toBeLessThan(bowtie.length);
	});
});

describe('isSingleOutline (R5.17)', () => {
	const square: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
	const star: Vec2[] = Array.from({ length: 10 }, (_, i) => {
		const angle = (i * Math.PI) / 5 - Math.PI / 2;
		const radius = i % 2 === 0 ? 1 : 0.4;
		return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
	});

	it('accepts what triangulatePolygon returns, in either winding', () => {
		expect(isSingleOutline(square, triangulatePolygon(square))).toBe(true);
		expect(isSingleOutline(star, triangulatePolygon(star))).toBe(true);
		const reversed = [...star].reverse();
		expect(isSingleOutline(reversed, triangulatePolygon(reversed))).toBe(true);
	});

	it('accepts an outline with collinear points that the triangulation skipped', () => {
		const withMidpoints: Vec2[] = [
			{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 0, y: 10 },
		];
		expect(isSingleOutline(withMidpoints, triangulatePolygon(withMidpoints))).toBe(true);
		const everyMidpoint: Vec2[] = [
			{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 },
			{ x: 2, y: 2 }, { x: 1, y: 2 }, { x: 0, y: 2 }, { x: 0, y: 1 },
		];
		expect(isSingleOutline(everyMidpoint, triangulatePolygon(everyMidpoint))).toBe(true);
	});

	it('rejects several shapes in one list', () => {
		const two: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }, { x: 20, y: 0 }, { x: 30, y: 0 }, { x: 20, y: 10 }];
		expect(isSingleOutline(two, [0, 1, 2, 3, 4, 5])).toBe(false);
	});

	it('rejects indices that cover the outline twice, or only in part', () => {
		expect(isSingleOutline(square, [0, 1, 2, 0, 2, 3, 0, 1, 2])).toBe(false);
		expect(isSingleOutline(square, [0, 1, 2])).toBe(false);
	});

	it('rejects a self-crossing outline and one with no area', () => {
		const bowtie: Vec2[] = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
		expect(isSingleOutline(bowtie, [0, 1, 2, 0, 2, 3])).toBe(false);
		const line: Vec2[] = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
		expect(isSingleOutline(line, [0, 1, 2])).toBe(false);
	});
});
