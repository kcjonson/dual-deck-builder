import type { NineSlice, SourceSpace, TextureHandle } from './commands';
import type { Rect } from './geometry';

/**
 * R5.19's grid: the four column edges and four row edges of a nine-sliced
 * image, in destination logical pixels and in texture coordinates. Cell
 * `(column, row)` spans `x[column] .. x[column + 1]` and `u[column] ..
 * u[column + 1]`, and likewise down.
 *
 * `columns` and `rows` list the cells worth drawing, the ones with a
 * destination extent: a zero inset has no corner or edge to draw, and a
 * destination exactly the width of its two corners has no centre column.
 */
export interface NineSliceGrid {
	readonly x: Float64Array;
	readonly y: Float64Array;
	readonly u: Float64Array;
	readonly v: Float64Array;
	/** Indices (0 to 2) of the columns with a destination width, in order. */
	readonly columns: Int8Array;
	readonly rows: Int8Array;
	columnCount: number;
	rowCount: number;
}

export function createNineSliceGrid(): NineSliceGrid {
	return {
		x: new Float64Array(4),
		y: new Float64Array(4),
		u: new Float64Array(4),
		v: new Float64Array(4),
		columns: new Int8Array(3),
		rows: new Int8Array(3),
		columnCount: 0,
		rowCount: 0,
	};
}

/** The parts of an image command the grid reads. */
export interface NineSliceImage {
	readonly rect: Rect;
	readonly texture: TextureHandle;
	readonly sourceRect: Rect | null;
	readonly sourceSpace: SourceSpace;
}

/**
 * Fills `out` for one sliced image. The insets are texture pixels measured in
 * from the source rect's edges (the whole texture without one), and a corner
 * draws at one logical pixel per texture pixel: corners keep their size and
 * aspect, the edges stretch along their one axis, the centre along both.
 *
 * Two clamps, both uniform so a corner is never squashed out of aspect. Insets
 * that meet or cross inside the source are scaled down per axis to fit it.
 * A destination smaller than two opposite corners scales every corner by one
 * factor, the smaller of the two axes' (CSS border-image's rule, R12.5's
 * reference), so a short button keeps round corners rather than oval ones.
 */
export function nineSliceGrid(source: NineSliceImage, slice: NineSlice, out: NineSliceGrid): NineSliceGrid {
	const { rect, texture } = source;
	const textureWidth = Math.max(1, texture.width);
	const textureHeight = Math.max(1, texture.height);

	// The source rect in texture pixels.
	let sourceX = 0;
	let sourceY = 0;
	let sourceWidth = textureWidth;
	let sourceHeight = textureHeight;
	if (source.sourceRect) {
		const scaleX = source.sourceSpace === 'uv' ? textureWidth : 1;
		const scaleY = source.sourceSpace === 'uv' ? textureHeight : 1;
		sourceX = source.sourceRect.x * scaleX;
		sourceY = source.sourceRect.y * scaleY;
		sourceWidth = source.sourceRect.width * scaleX;
		sourceHeight = source.sourceRect.height * scaleY;
	}

	let left = Math.max(0, slice.left);
	let right = Math.max(0, slice.right);
	let top = Math.max(0, slice.top);
	let bottom = Math.max(0, slice.bottom);
	const fitX = fitFactor(left + right, Math.abs(sourceWidth));
	left *= fitX;
	right *= fitX;
	const fitY = fitFactor(top + bottom, Math.abs(sourceHeight));
	top *= fitY;
	bottom *= fitY;

	const cornerScale = Math.min(
		fitFactor(left + right, Math.max(0, rect.width)),
		fitFactor(top + bottom, Math.max(0, rect.height)),
	);

	const signX = sourceWidth < 0 ? -1 : 1;
	const signY = sourceHeight < 0 ? -1 : 1;
	edges(out.x, rect.x, rect.width, left * cornerScale, right * cornerScale);
	edges(out.u, sourceX / textureWidth, sourceWidth / textureWidth, (signX * left) / textureWidth, (signX * right) / textureWidth);
	edges(out.y, rect.y, rect.height, top * cornerScale, bottom * cornerScale);
	edges(out.v, sourceY / textureHeight, sourceHeight / textureHeight, (signY * top) / textureHeight, (signY * bottom) / textureHeight);

	out.columnCount = spans(out.x, out.columns);
	out.rowCount = spans(out.y, out.rows);
	return out;
}

/** The instances a sliced image draws: one per cell with a destination area. */
export function nineSliceCellCount(grid: NineSliceGrid): number {
	return grid.columnCount * grid.rowCount;
}

/** The factor that fits `total` into `available`, never above 1. */
function fitFactor(total: number, available: number): number {
	return total > available && total > 0 ? available / total : 1;
}

function edges(out: Float64Array, start: number, extent: number, near: number, far: number): void {
	out[0] = start;
	out[1] = start + near;
	out[2] = start + extent - far;
	out[3] = start + extent;
}

function spans(edges: Float64Array, out: Int8Array): number {
	let count = 0;
	for (let index = 0; index < 3; index++) {
		if (edges[index + 1] - edges[index] > 0) out[count++] = index;
	}
	return count;
}
