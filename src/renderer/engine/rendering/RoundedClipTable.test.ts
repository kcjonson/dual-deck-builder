import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RoundedClip } from '../draw';
import { ROUNDED_CLIP_CAPACITY, ROUNDED_CLIP_FLOATS, RoundedClipTable } from './RoundedClipTable';

function rounded(minX: number, minY: number, maxX: number, maxY: number, radius: number): RoundedClip {
	return { rect: { minX, minY, maxX, maxY }, radius };
}

describe('RoundedClipTable (R4.14, R5.4)', () => {
	it('stores centre, half size and radius, and hands out indices from 1', () => {
		const table = new RoundedClipTable();
		expect(table.indexOf(rounded(10, 20, 70, 60, 8))).toBe(1);
		expect(table.indexOf(rounded(0, 0, 10, 10, 2))).toBe(2);
		expect(table.count).toBe(2);
		expect(Array.from(table.floats.subarray(0, ROUNDED_CLIP_FLOATS))).toEqual([40, 40, 30, 20, 8, 0, 0, 0]);
	});

	it('reuses an entry for the same clip, and for an equal clip pushed again', () => {
		const table = new RoundedClipTable();
		const clip = rounded(0, 0, 40, 40, 6);
		expect(table.indexOf(clip)).toBe(1);
		expect(table.indexOf(clip)).toBe(1);
		expect(table.indexOf(rounded(0, 0, 40, 40, 6))).toBe(1);
		expect(table.indexOf(rounded(0, 0, 40, 40, 5))).toBe(2);
		expect(table.count).toBe(2);
	});

	it('clamps the radius to the half extent and gives no entry for a radius that rounds nothing', () => {
		const table = new RoundedClipTable();
		expect(table.indexOf(rounded(0, 0, 40, 10, 30))).toBe(1);
		expect(table.floats[4]).toBe(5);
		expect(table.indexOf(rounded(0, 0, 40, 10, 0))).toBe(0);
		expect(table.count).toBe(1);
	});

	it('answers 0 once full and starts over after a reset', () => {
		const table = new RoundedClipTable({ capacity: 2 });
		expect(table.indexOf(rounded(0, 0, 10, 10, 2))).toBe(1);
		expect(table.indexOf(rounded(0, 0, 20, 20, 2))).toBe(2);
		expect(table.indexOf(rounded(0, 0, 30, 30, 2))).toBe(0);
		expect(table.indexOf(rounded(0, 0, 40, 40, 2))).toBe(0);
		table.reset();
		expect(table.count).toBe(0);
		expect(table.indexOf(rounded(0, 0, 30, 30, 2))).toBe(1);
	});

	it('reports overflow once per run of overflowing frames, and again after a frame that fits', () => {
		const onOverflow = jest.fn();
		const table = new RoundedClipTable({ capacity: 1, onOverflow });
		const overflowingFrame = () => {
			table.reset();
			table.indexOf(rounded(0, 0, 10, 10, 2));
			table.indexOf(rounded(0, 0, 20, 20, 2));
			table.indexOf(rounded(0, 0, 30, 30, 2));
		};
		overflowingFrame();
		overflowingFrame();
		overflowingFrame();
		expect(onOverflow).toHaveBeenCalledTimes(1);
		table.reset();
		table.indexOf(rounded(0, 0, 10, 10, 2));
		overflowingFrame();
		expect(onOverflow).toHaveBeenCalledTimes(2);
	});

	it('holds as many entries as uber.vert declares vectors for, two each', () => {
		const source = readFileSync(join(__dirname, '../../../assets/shaders/uber.vert'), 'utf8');
		const declared = /const int ROUNDED_CLIP_VECTORS = (\d+);/.exec(source);
		expect(declared).not.toBeNull();
		expect(Number(declared?.[1])).toBe(ROUNDED_CLIP_CAPACITY * 2);
		expect(ROUNDED_CLIP_FLOATS).toBe(8);
		expect(source).toContain('vec4 uRoundedClips[ROUNDED_CLIP_VECTORS];');
	});
});
