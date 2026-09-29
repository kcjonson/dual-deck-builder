import { describe, expect, it } from '@jest/globals';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { clusterMask, compareClusters, diffMask } from './diffClusters';

function maskFrom(rows: string[]): { width: number; height: number; mask: Uint8Array } {
	const width = rows[0].length;
	const height = rows.length;
	const mask = new Uint8Array(width * height);
	rows.forEach((row, y) => {
		[...row].forEach((cell, x) => {
			if (cell === '#') mask[y * width + x] = 1;
		});
	});
	return { width, height, mask };
}

function solid(width: number, height: number, rgb: [number, number, number]): PNG {
	const png = new PNG({ width, height });
	for (let index = 0; index < width * height; index += 1) {
		png.data[index * 4] = rgb[0];
		png.data[index * 4 + 1] = rgb[1];
		png.data[index * 4 + 2] = rgb[2];
		png.data[index * 4 + 3] = 255;
	}
	return png;
}

function paint(png: PNG, x: number, y: number, rgb: [number, number, number]): void {
	const index = (y * png.width + x) * 4;
	png.data[index] = rgb[0];
	png.data[index + 1] = rgb[1];
	png.data[index + 2] = rgb[2];
}

describe('clusterMask', () => {
	it('reports nothing for an identical capture', () => {
		const report = clusterMask(maskFrom(['.....', '.....']), 2);
		expect(report).toEqual({ width: 5, height: 2, differing: 0, clusters: 0, largest: null });
	});

	it('measures a solid block as one cluster with its bounds', () => {
		const report = clusterMask(maskFrom([
			'........',
			'..###...',
			'..###...',
			'........',
		]), 1);
		expect(report.differing).toBe(6);
		expect(report.clusters).toBe(1);
		expect(report.largest).toEqual({ size: 6, bounds: { x: 2, y: 1, w: 3, h: 2 } });
	});

	it('counts the differing pixels of a cluster, not the area of its bounds', () => {
		const report = clusterMask(maskFrom([
			'#...#',
			'.#.#.',
			'..#..',
		]), 1);
		expect(report.largest?.size).toBe(5);
		expect(report.largest?.bounds).toEqual({ x: 0, y: 0, w: 5, h: 3 });
	});

	it('joins diagonal neighbours at radius 1', () => {
		const report = clusterMask(maskFrom(['#..', '.#.', '..#']), 1);
		expect(report.clusters).toBe(1);
	});

	it('bridges a one-pixel gap at radius 2 and not at radius 1', () => {
		const rows = ['#.#.#'];
		expect(clusterMask(maskFrom(rows), 1).clusters).toBe(3);
		expect(clusterMask(maskFrom(rows), 2).clusters).toBe(1);
		expect(clusterMask(maskFrom(rows), 2).largest?.size).toBe(3);
	});

	it('leaves scattered noise as separate small clusters', () => {
		const report = clusterMask(maskFrom([
			'#.....#.....#',
			'.............',
			'.............',
			'#.....#.....#',
		]), 2);
		expect(report.differing).toBe(6);
		expect(report.clusters).toBe(6);
		expect(report.largest?.size).toBe(1);
	});

	it('merges two regions that only meet further down, as a U does', () => {
		const report = clusterMask(maskFrom([
			'#...#',
			'#...#',
			'#...#',
			'#####',
		]), 1);
		expect(report.clusters).toBe(1);
		expect(report.largest?.size).toBe(11);
	});

	it('picks the largest of several clusters', () => {
		const report = clusterMask(maskFrom([
			'##.......',
			'.........',
			'.........',
			'.....####',
			'.....####',
		]), 1);
		expect(report.clusters).toBe(2);
		expect(report.largest).toEqual({ size: 8, bounds: { x: 5, y: 3, w: 4, h: 2 } });
	});

	it('rejects a radius that is not a positive integer', () => {
		expect(() => clusterMask(maskFrom(['#']), 0)).toThrow('joinRadius');
		expect(() => clusterMask(maskFrom(['#']), 1.5)).toThrow('joinRadius');
	});
});

describe('diffMask and compareClusters', () => {
	const background: [number, number, number] = [42, 42, 74];
	const ink: [number, number, number] = [255, 255, 255];

	it('finds nothing between identical captures', () => {
		const image = PNG.sync.write(solid(12, 12, background));
		expect(compareClusters({ expected: image, actual: image, threshold: 0.01, joinRadius: 2 }).differing).toBe(0);
	});

	it('counts exactly the pixels pixelmatch counts', () => {
		const before = solid(16, 16, background);
		const after = solid(16, 16, background);
		for (let y = 4; y < 9; y += 1) {
			for (let x = 3; x < 7; x += 1) paint(after, x, y, ink);
		}
		paint(after, 13, 13, ink);
		const expectedCount = pixelmatch(before.data, after.data, null, 16, 16, { threshold: 0.01 });

		const report = compareClusters({
			expected: PNG.sync.write(before),
			actual: PNG.sync.write(after),
			threshold: 0.01,
			joinRadius: 2,
		});
		expect(report.differing).toBe(expectedCount);
		expect(report.clusters).toBe(2);
		expect(report.largest?.bounds).toEqual({ x: 3, y: 4, w: 4, h: 5 });
	});

	it('ignores a change under the threshold', () => {
		const before = solid(8, 8, background);
		const after = solid(8, 8, background);
		paint(after, 2, 2, [background[0] + 2, background[1] + 2, background[2] + 2]);
		const { mask } = diffMask({ expected: PNG.sync.write(before), actual: PNG.sync.write(after), threshold: 0.01 });
		expect(mask.every((value) => value === 0)).toBe(true);
	});

	it('refuses to compare captures of different sizes', () => {
		expect(() => diffMask({
			expected: PNG.sync.write(solid(8, 8, background)),
			actual: PNG.sync.write(solid(8, 9, background)),
			threshold: 0.01,
		})).toThrow('Image sizes differ');
	});
});
