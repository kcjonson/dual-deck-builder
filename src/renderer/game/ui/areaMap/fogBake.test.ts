import { FOG } from './areaMapStyle';
import { MAX_FOG_SIZE, bakeFog } from './fogBake';
import type { LandFogLayer } from './layers';
import { revealedBounds } from './layers';

function alphaAt(texels: Uint8Array, size: number, column: number, row: number): number {
	return texels[(row * size + column) * 4 + 3];
}

/** Revealed in a disc of `cells` around cell (centre, centre). */
function revealedDisc(cells: number, centre: number, reach: number): LandFogLayer {
	return { cells, isRevealed: (column, row) => Math.hypot(column + 0.5 - centre, row + 0.5 - centre) <= reach };
}

describe('bakeFog', () => {
	it('is clear over revealed land, a full wash over hidden land, and clear past the rim', () => {
		const fog = revealedDisc(32, 16, 6);
		const { size, texels } = bakeFog({ fog, texelsPerCell: 4 });
		expect(size).toBe(128);
		expect(alphaAt(texels, size, 64, 64)).toBe(0);
		// Hidden, well inside the disc: the wash
		expect(alphaAt(texels, size, 64, 10)).toBe(Math.round(255 * FOG.alpha));
		// The square's corner is past the rim
		expect(alphaAt(texels, size, 1, 1)).toBe(0);
		// Premultiplied
		const at = (10 * size + 64) * 4;
		expect(texels[at]).toBe(Math.round(FOG.color[0] * FOG.alpha));
	});

	it('puts world north at the top: the fog\'s row 0 is the south edge', () => {
		// Only the southernmost band revealed
		const fog: LandFogLayer = { cells: 16, isRevealed: (_column, row) => row < 6 };
		const { size, texels } = bakeFog({ fog, texelsPerCell: 4 });
		expect(alphaAt(texels, size, 32, size - 12)).toBe(0);
		expect(alphaAt(texels, size, 32, 12)).toBeGreaterThan(0);
	});

	it('clears revealed ground two cells across, and leaves a lone revealed cell mostly fogged', () => {
		const wash = Math.round(255 * FOG.alpha);
		// Cell (column, row)'s centre in texels at 4 a cell, rows from the north
		const centreOf = (texels: Uint8Array, size: number, column: number, row: number): number => alphaAt(texels, size, column * 4 + 2, (15 - row) * 4 + 2);

		const lone = bakeFog({ fog: { cells: 16, isRevealed: (column, row) => column === 8 && row === 8 }, texelsPerCell: 4 });
		const loneAlpha = centreOf(lone.texels, lone.size, 8, 8);
		expect(loneAlpha).toBeLessThan(wash);
		expect(loneAlpha).toBeGreaterThan(wash / 2);

		const pair = bakeFog({ fog: { cells: 16, isRevealed: (column, row) => (column === 8 || column === 9) && row >= 4 && row <= 11 }, texelsPerCell: 4 });
		for (let row = 5; row <= 10; row++) {
			expect(centreOf(pair.texels, pair.size, 8, row)).toBe(0);
			expect(centreOf(pair.texels, pair.size, 9, row)).toBe(0);
		}
	});

	it('holds the texture to MAX_FOG_SIZE whatever the grid', () => {
		expect(bakeFog({ fog: { cells: 64, isRevealed: () => false } }).size).toBe(64 * FOG.texelsPerCell);
		expect(bakeFog({ fog: { cells: 300, isRevealed: () => false } }).size).toBeLessThanOrEqual(MAX_FOG_SIZE);
		expect(bakeFog({ fog: { cells: 300, isRevealed: () => false } }).size).toBe(300 * 3);
	});

	it('rejects a fog with no cells', () => {
		expect(() => bakeFog({ fog: { cells: 0, isRevealed: () => true } })).toThrow(/cells/);
	});
});

describe('revealedBounds', () => {
	it('frames the revealed cells in world space, or nothing', () => {
		const fog: LandFogLayer = { cells: 10, isRevealed: (column, row) => column >= 4 && column <= 5 && row === 7 };
		expect(revealedBounds(fog, 500)).toEqual({ x: -100, y: 200, width: 200, height: 100 });
		expect(revealedBounds({ cells: 10, isRevealed: () => false }, 500)).toBeNull();
	});
});
