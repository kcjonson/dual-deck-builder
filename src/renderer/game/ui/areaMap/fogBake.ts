import { FOG } from './areaMapStyle';
import type { LandFogLayer } from './layers';

/**
 * The land fog's picture: a wash over hidden land, as
 * premultiplied RGBA8 texels over the disc's bounding square, row 0 at the
 * north edge like the terrain's. Rebaked when the fog changes, which is after
 * a run, never per frame.
 *
 * The fog is a coarse grid of cells, so the edge between revealed and hidden
 * land is smoothed rather than drawn cell by cell: the grid is blurred once
 * ([1 2 1] each way), so the edge rounds the cells' corners instead of
 * following their sides, then each texel reads the four cell centres around
 * it, bilinear. The edge leans toward the hidden side: land is clear at half
 * revealed and fogged only well below it, so no revealed cell is drawn
 * fogged. Past the disc's rim there's no land to hide and the texels are
 * clear.
 */

export interface FogBakeOptions {
	fog: LandFogLayer;
	/** Texels per cell; the texture is `cells * texelsPerCell` square. */
	texelsPerCell?: number;
}

export interface FogBake {
	readonly size: number;
	readonly texels: Uint8Array;
}

export function bakeFog({ fog, texelsPerCell = FOG.texelsPerCell }: FogBakeOptions): FogBake {
	const cells = fog.cells;
	if (!Number.isInteger(cells) || cells < 1) throw new Error(`bakeFog: cells must be a positive integer, got ${cells}`);
	const size = cells * texelsPerCell;
	const grid = new Float32Array(cells * cells);
	// Rows from the north, as the texture runs; the fog's row 0 is south.
	for (let row = 0; row < cells; row++) {
		for (let column = 0; column < cells; column++) {
			grid[row * cells + column] = fog.isRevealed(column, cells - 1 - row) ? 1 : 0;
		}
	}
	const revealed = blurred(grid, cells);

	const texels = new Uint8Array(size * size * 4);
	const half = size / 2;
	const outerSquared = (half + 1) * (half + 1);
	const innerSquared = (half - 1) * (half - 1);
	const [red, green, blue] = FOG.color;
	for (let row = 0; row < size; row++) {
		const cellY = (row + 0.5) / texelsPerCell - 0.5;
		const top = clampIndex(Math.floor(cellY), cells);
		const bottom = clampIndex(Math.floor(cellY) + 1, cells);
		const fy = clamp01(cellY - Math.floor(cellY));
		const dy = row + 0.5 - half;
		for (let column = 0; column < size; column++) {
			const dx = column + 0.5 - half;
			const distanceSquared = dx * dx + dy * dy;
			if (distanceSquared >= outerSquared) continue;
			const disc = distanceSquared <= innerSquared ? 1 : clamp01(half - Math.sqrt(distanceSquared) + 0.5);
			if (disc <= 0) continue;

			const cellX = (column + 0.5) / texelsPerCell - 0.5;
			const left = clampIndex(Math.floor(cellX), cells);
			const right = clampIndex(Math.floor(cellX) + 1, cells);
			const fx = clamp01(cellX - Math.floor(cellX));
			const upper = revealed[top * cells + left] + (revealed[top * cells + right] - revealed[top * cells + left]) * fx;
			const lower = revealed[bottom * cells + left] + (revealed[bottom * cells + right] - revealed[bottom * cells + left]) * fx;
			const shown = upper + (lower - upper) * fy;
			const hidden = 1 - smoothstep(FOGGED_BELOW, CLEAR_ABOVE, shown);
			if (hidden <= 0) continue;

			const alpha = hidden * disc * FOG.alpha;
			const out = (row * size + column) * 4;
			texels[out] = red * alpha + 0.5;
			texels[out + 1] = green * alpha + 0.5;
			texels[out + 2] = blue * alpha + 0.5;
			texels[out + 3] = 255 * alpha + 0.5;
		}
	}
	return { size, texels };
}

/** Blurred revealed share at or below which land is fully fogged... */
const FOGGED_BELOW = 0.12;
/** ...and at or above which it's clear: a lone revealed cell blurs to a quarter, an edge cell to three quarters. */
const CLEAR_ABOVE = 0.5;

/** The grid blurred by [1 2 1] / 4 along rows, then columns, its edges clamped. */
function blurred(grid: Float32Array, cells: number): Float32Array {
	const across = new Float32Array(grid.length);
	for (let row = 0; row < cells; row++) {
		for (let column = 0; column < cells; column++) {
			const at = row * cells;
			across[at + column] = (grid[at + clampIndex(column - 1, cells)] + 2 * grid[at + column] + grid[at + clampIndex(column + 1, cells)]) / 4;
		}
	}
	const out = new Float32Array(grid.length);
	for (let row = 0; row < cells; row++) {
		for (let column = 0; column < cells; column++) {
			out[row * cells + column] = (across[clampIndex(row - 1, cells) * cells + column] + 2 * across[row * cells + column] + across[clampIndex(row + 1, cells) * cells + column]) / 4;
		}
	}
	return out;
}

function clampIndex(index: number, cells: number): number {
	return index < 0 ? 0 : index >= cells ? cells - 1 : index;
}

function clamp01(value: number): number {
	return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

function smoothstep(edge0: number, edge1: number, value: number): number {
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}
