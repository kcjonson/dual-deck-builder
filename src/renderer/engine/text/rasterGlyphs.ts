import type { TextureHandle } from '../draw/commands';
import type { FontAtlas } from './FontAtlas';

/**
 * R6.4a's threshold: a run whose screen-space distance range falls below this
 * many device pixels is drawn from a platform-rasterised atlas instead of the
 * distance field. With the committed 48 px per em, range 8 atlases that is
 * text under 9 logical px at ratio 1.
 */
export const RASTER_RANGE_THRESHOLD = 1.5;

/** Blank texels around every cell, so bilinear filtering never reads a neighbour. */
const GUTTER = 1;
/** Widest atlas row, in texels; the height grows to fit. */
const MAX_ROW_WIDTH = 512;

/**
 * Raster atlases are built at device font sizes rounded to this step, so text
 * under a changing scale (a zoom, a resize) reuses a handful of atlases
 * rather than building one per frame. A quarter pixel of font size is under
 * a tenth of a pixel of glyph size at the sizes the fallback serves.
 */
export const RASTER_SIZE_STEP = 0.25;

/**
 * R6.5's screen-space range, in device pixels, for a run at `size` logical px
 * drawn at `scale` device pixels per logical pixel (the ratio, times any
 * uniform scale the run is drawn under).
 */
export function screenRange(atlas: FontAtlas, size: number, scale: number): number {
	return (atlas.distanceRange * size * scale) / atlas.size;
}

/** Whether R6.4a sends a run at this size and scale to the raster fallback. */
export function wantsRasterGlyphs(atlas: FontAtlas, size: number, scale: number): boolean {
	return screenRange(atlas, size, scale) < RASTER_RANGE_THRESHOLD;
}

/** The device font size a raster atlas is built at for a run, on `RASTER_SIZE_STEP`. */
export function rasterPixelSize(size: number, scale: number): number {
	return Math.max(RASTER_SIZE_STEP, Math.round((size * scale) / RASTER_SIZE_STEP) * RASTER_SIZE_STEP);
}

/**
 * Horizontal sub-pixel positions each glyph is rasterised at. A pen goes to
 * the nearest quarter pixel, so glyphs sit within an eighth of a pixel of
 * the layout and spacing is even (a 2.5 px advance stays 2.5 px) instead of
 * alternating whole pixels. Four is what Skia uses for sub-pixel text.
 */
export const RASTER_PHASES = 4;

/** One glyph's cells in a raster atlas: one per phase, side by side. */
export interface RasterGlyphCell {
	readonly codePoint: number;
	/** What the platform draws: the outline's code point, a substitute's source (R6.3). */
	readonly outlineCodePoint: number;
	/** Phase 0's cell in atlas texels; phase `n` is `n * stride` texels to its right. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	readonly stride: number;
	/**
	 * The cell's top-left corner in whole device pixels from the pen on the
	 * baseline, y down, for a pen on a whole pixel; phase `n` is the glyph
	 * drawn `n / RASTER_PHASES` of a pixel to the right inside the same box.
	 */
	readonly left: number;
	readonly top: number;
}

/** Where every glyph of one face at one device font size goes, before anything is drawn. */
export interface RasterGlyphPlan {
	readonly width: number;
	readonly height: number;
	/** The font size the platform rasterises at, in device pixels. */
	readonly pixelSize: number;
	readonly cells: ReadonlyMap<number, RasterGlyphCell>;
}

/**
 * Packs every glyph with an image into rows, `RASTER_PHASES` cells each. A
 * cell spans the glyph's plane bounds (R6.2's quad placement, which already
 * pads the outline by half the distance range) rounded out to whole device
 * pixels, plus one column for the phases to shift into.
 */
export function planRasterGlyphs(atlas: FontAtlas, pixelSize: number): RasterGlyphPlan {
	const cells = new Map<number, RasterGlyphCell>();
	let penX = GUTTER;
	let penY = GUTTER;
	let rowHeight = 0;
	let width = 0;

	const codePoints = [...atlas.codePoints].sort((a, b) => a - b);
	for (const codePoint of codePoints) {
		const glyph = atlas.glyph(codePoint);
		const plane = glyph?.plane;
		if (!glyph || !plane) continue;
		const left = Math.floor(plane.left * pixelSize);
		const top = Math.floor(plane.top * pixelSize);
		const cellWidth = Math.max(1, Math.ceil(plane.right * pixelSize) - left) + 1;
		const cellHeight = Math.max(1, Math.ceil(plane.bottom * pixelSize) - top);
		const stride = cellWidth + GUTTER;
		const span = RASTER_PHASES * stride;
		if (penX + span > MAX_ROW_WIDTH && penX > GUTTER) {
			penX = GUTTER;
			penY += rowHeight + GUTTER;
			rowHeight = 0;
		}
		cells.set(codePoint, {
			codePoint,
			outlineCodePoint: glyph.outlineCodePoint ?? codePoint,
			x: penX,
			y: penY,
			width: cellWidth,
			height: cellHeight,
			stride,
			left,
			top,
		});
		penX += span;
		rowHeight = Math.max(rowHeight, cellHeight);
		width = Math.max(width, penX);
	}
	return { width: Math.max(1, width), height: Math.max(1, penY + rowHeight + GUTTER), pixelSize, cells };
}

/**
 * Where a pen at `pen` device pixels draws: the whole pixel its cell's
 * `left` counts from, and the phase to sample.
 */
export function rasterPen(pen: number, out: { pixel: number; phase: number }): { pixel: number; phase: number } {
	const steps = Math.round(pen * RASTER_PHASES);
	out.pixel = Math.floor(steps / RASTER_PHASES);
	out.phase = steps - out.pixel * RASTER_PHASES;
	return out;
}

/** A plan drawn and uploaded: what the encoder samples a small run from. */
export interface RasterGlyphAtlas {
	readonly texture: TextureHandle;
	readonly width: number;
	readonly height: number;
	readonly cells: ReadonlyMap<number, RasterGlyphCell>;
}

/** Hands the encoder a raster atlas for a run R6.4a sends to the fallback, or null to keep the distance field. */
export interface RasterGlyphSource {
	glyphs(font: string, atlas: FontAtlas, pixelSize: number): RasterGlyphAtlas | null;
}

/** The part of `CanvasRenderingContext2D` the rasteriser uses, so it runs against a fake in tests. */
export interface GlyphCanvasContext {
	font: string;
	fillStyle: string | CanvasGradient | CanvasPattern;
	textBaseline: CanvasTextBaseline;
	textAlign: CanvasTextAlign;
	setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
	clearRect(x: number, y: number, width: number, height: number): void;
	save(): void;
	restore(): void;
	beginPath(): void;
	rect(x: number, y: number, width: number, height: number): void;
	clip(): void;
	fillText(text: string, x: number, y: number): void;
	getImageData(x: number, y: number, width: number, height: number): { readonly data: ArrayLike<number> };
}

/** The canvas `rasterizeGlyphs` draws into for a plan: `RASTER_PHASES` times as wide. */
export function rasterCanvasSize(plan: RasterGlyphPlan): { width: number; height: number } {
	return { width: plan.width * RASTER_PHASES, height: plan.height };
}

/**
 * Draws every planned glyph once, in white, through the platform's 2D text
 * API (R6.1's permitted raster alternative), `RASTER_PHASES` times wider than
 * it lands, and box-filters each into its phases: phase `n` is the glyph
 * moved `n` subsamples right, each output texel the mean of the subsamples it
 * covers. Doing the shift here rather than with a fractional `fillText` x
 * keeps it exact on platforms that snap text to whole pixels, as Chrome does
 * on Linux at ratio 1. Returns the atlas as premultiplied white RGBA8, whose
 * alpha is the coverage. `context` is a canvas of `rasterCanvasSize(plan)`.
 */
export function rasterizeGlyphs(context: GlyphCanvasContext, plan: RasterGlyphPlan, family: string): Uint8Array {
	const phases = RASTER_PHASES;
	const size = rasterCanvasSize(plan);
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, size.width, size.height);
	context.setTransform(phases, 0, 0, 1, 0, 0);
	context.font = `${plan.pixelSize}px "${family}"`;
	context.fillStyle = '#ffffff';
	context.textBaseline = 'alphabetic';
	context.textAlign = 'left';
	for (const cell of plan.cells.values()) {
		context.save();
		context.beginPath();
		context.rect(cell.x, cell.y, cell.width, cell.height);
		context.clip();
		context.fillText(String.fromCodePoint(cell.outlineCodePoint), cell.x - cell.left, cell.y - cell.top);
		context.restore();
	}
	context.setTransform(1, 0, 0, 1, 0, 0);

	const source = context.getImageData(0, 0, size.width, size.height).data;
	const texels = new Uint8Array(plan.width * plan.height * 4);
	for (const cell of plan.cells.values()) {
		const first = cell.x * phases;
		const end = (cell.x + cell.width) * phases;
		for (let row = 0; row < cell.height; row++) {
			const sourceRow = (cell.y + row) * size.width;
			const targetRow = (cell.y + row) * plan.width;
			for (let phase = 0; phase < phases; phase++) {
				const targetX = cell.x + phase * cell.stride;
				for (let column = 0; column < cell.width; column++) {
					let sum = 0;
					const start = (cell.x + column) * phases - phase;
					for (let sub = start; sub < start + phases; sub++) {
						if (sub >= first && sub < end) sum += source[(sourceRow + sub) * 4 + 3];
					}
					const value = Math.round(sum / phases);
					const offset = (targetRow + targetX + column) * 4;
					texels[offset] = value;
					texels[offset + 1] = value;
					texels[offset + 2] = value;
					texels[offset + 3] = value;
				}
			}
		}
	}
	return texels;
}
