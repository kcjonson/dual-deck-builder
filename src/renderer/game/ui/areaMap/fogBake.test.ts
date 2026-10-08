import { FOG } from './areaMapStyle';
import { bakeFog } from './fogBake';
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

	it('never draws a revealed cell fully fogged, a lone one included', () => {
		const fog: LandFogLayer = { cells: 16, isRevealed: (column, row) => column === 8 && row === 8 };
		const { size, texels } = bakeFog({ fog, texelsPerCell: 4 });
		// The cell's centre in texels, rows from the north
		const centre = alphaAt(texels, size, 8 * 4 + 2, (15 - 8) * 4 + 2);
		expect(centre).toBeLessThan(Math.round(255 * FOG.alpha));
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
