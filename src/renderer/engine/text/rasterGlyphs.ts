import type { TextureHandle } from '../draw/commands';
import type { FontAtlas, FontGlyph } from './FontAtlas';
import type { TextLayout } from './TextLayout';

/**
 * R6.4a's threshold: a run whose screen-space distance range falls below this
 * many device pixels is drawn from platform-rasterised glyphs instead of the
 * distance field. With the committed 48 px per em, range 8 atlases that is
 * text under 9 device px.
 */
export const RASTER_RANGE_THRESHOLD = 1.5;

/**
 * How far past the threshold a run already on the raster path has to go to
 * leave it. The paths match in weight (`inkCurve`) but not in sharpness, so a
 * zoom that hovers at the threshold would flicker between them without it.
 */
export const RASTER_RANGE_HYSTERESIS = 0.1;

/**
 * Raster glyphs are built at device font sizes rounded to this step, so text
 * under a changing scale (a zoom, a resize) reuses a handful of sizes rather
 * than building new glyphs every frame. A quarter pixel of font size is under
 * a tenth of a pixel of glyph size at the sizes the fallback serves.
 */
export const RASTER_SIZE_STEP = 0.25;

/**
 * Horizontal sub-pixel positions each glyph is rasterised at. A pen goes to
 * the nearest quarter pixel, so glyphs sit within an eighth of a pixel of
 * the layout and spacing is even (a 2.5 px advance stays 2.5 px) instead of
 * alternating whole pixels. Four is what Skia uses for sub-pixel text.
 */
export const RASTER_PHASES = 4;

/** Blank texels between phase cells, so bilinear filtering never reads a neighbour. */
export const RASTER_GUTTER = 1;

/**
 * Blank device pixels between glyphs on the scratch canvas. Rounded-out plane
 * bounds contain a glyph's ink, but a hinting rasteriser can move an edge by
 * a pixel; the gap keeps that from landing in the next glyph's box, which is
 * what makes a clip per glyph unnecessary.
 */
const CANVAS_GAP = 2;

/**
 * The word the raster path's weight is measured over, against the distance
 * field's ink of the same word (`FontFaceAsset.fieldInk`).
 */
export const INK_REFERENCE_TEXT = 'Hamburgefonstiv';

/**
 * How far the raster path's ink may sit from the distance field's, as a
 * fraction, before its coverage is reshaped toward it. FreeType on the Linux
 * runner is within a few percent of the field and is kept as the platform
 * draws it; CoreText at ratio 1 is 25 to 30 percent heavier.
 */
export const INK_TOLERANCE = 0.1;

/**
 * R6.5's screen-space range, in device pixels, for a run at `size` logical px
 * drawn at `scale` device pixels per logical pixel (the ratio, times any
 * uniform scale the run is drawn under).
 */
export function screenRange(atlas: FontAtlas, size: number, scale: number): number {
	return (atlas.distanceRange * size * scale) / atlas.size;
}

/**
 * Whether R6.4a sends a run at this size and scale to the raster fallback:
 * under the threshold, or under it plus the hysteresis for a run that was
 * already there.
 */
export function wantsRasterGlyphs(atlas: FontAtlas, size: number, scale: number, alreadyRaster = false): boolean {
	const limit = alreadyRaster ? RASTER_RANGE_THRESHOLD + RASTER_RANGE_HYSTERESIS : RASTER_RANGE_THRESHOLD;
	return screenRange(atlas, size, scale) < limit;
}

/** The device font size a run's glyphs are rasterised at, on `RASTER_SIZE_STEP`. */
export function rasterPixelSize(size: number, scale: number): number {
	return Math.max(RASTER_SIZE_STEP, Math.round((size * scale) / RASTER_SIZE_STEP) * RASTER_SIZE_STEP);
}

/**
 * A glyph's box at one device font size: its plane bounds (R6.2's quad
 * placement, which already pads the outline by half the distance range)
 * rounded out to whole device pixels from a pen on a whole pixel, plus one
 * column for the phases to shift into. `left` and `top` are from the pen on
 * the baseline, y down.
 */
export interface RasterGlyphBox {
	readonly left: number;
	readonly top: number;
	readonly width: number;
	readonly height: number;
}

export function rasterGlyphBox(glyph: FontGlyph, pixelSize: number): RasterGlyphBox | null {
	const plane = glyph.plane;
	if (!plane) return null;
	const left = Math.floor(plane.left * pixelSize);
	const top = Math.floor(plane.top * pixelSize);
	return {
		left,
		top,
		width: Math.max(1, Math.ceil(plane.right * pixelSize) - left) + 1,
		height: Math.max(1, Math.ceil(plane.bottom * pixelSize) - top),
	};
}

/**
 * The texels a glyph's phases occupy, side by side with a gutter after each:
 * `RASTER_PHASES * (box.width + RASTER_GUTTER)` wide, and `box.height` tall
 * plus a gutter row.
 */
export function rasterBlockWidth(box: RasterGlyphBox): number {
	return RASTER_PHASES * (box.width + RASTER_GUTTER);
}

/** One glyph's cells in a raster page: one per phase, side by side. */
export interface RasterGlyphCell extends RasterGlyphBox {
	/** Phase 0's cell in page texels; phase `n` is `n * stride` texels to its right. */
	readonly x: number;
	readonly y: number;
	readonly stride: number;
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

/** The raster glyphs of one run: the page texture they sit in, and a cell per code point with an image. */
export interface RasterGlyphRun {
	readonly texture: TextureHandle;
	/** The page's size in texels, for texture coordinates. */
	readonly width: number;
	readonly height: number;
	readonly cells: ReadonlyMap<number, RasterGlyphCell>;
}

/**
 * Hands the encoder raster glyphs for a run R6.4a sends to the fallback,
 * every glyph with an image in `layout` at `pixelSize`, or null to keep the
 * distance field for this frame.
 */
export interface RasterGlyphSource {
	glyphs(font: string, layout: TextLayout, pixelSize: number): RasterGlyphRun | null;
}

/** The part of `CanvasRenderingContext2D` the rasteriser uses, so it runs against a fake in tests. */
export interface GlyphCanvasContext {
	readonly canvas: { width: number; height: number };
	font: string;
	fillStyle: string | CanvasGradient | CanvasPattern;
	textBaseline: CanvasTextBaseline;
	textAlign: CanvasTextAlign;
	setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
	clearRect(x: number, y: number, width: number, height: number): void;
	fillText(text: string, x: number, y: number): void;
	getImageData(x: number, y: number, width: number, height: number): { readonly data: ArrayLike<number> };
}

export interface GlyphToRasterize {
	/** What the platform draws: the outline's code point, a substitute's source (R6.3). */
	readonly outlineCodePoint: number;
	readonly box: RasterGlyphBox;
}

/**
 * Draws `glyphs` in white through the platform's 2D text API (R6.1's
 * permitted raster alternative), side by side on one scratch canvas at
 * `RASTER_PHASES` times the horizontal resolution, reads the canvas back
 * once, and box-filters each glyph into its phases: phase `n` is the glyph
 * moved `n` subsamples right, each output texel the mean of the subsamples it
 * covers. Doing the shift here rather than with a fractional `fillText` x
 * keeps it exact on platforms that snap text to whole pixels, as Chrome does
 * on Linux at ratio 1.
 *
 * Returns one block per glyph, `rasterBlockWidth(box)` by
 * `box.height + RASTER_GUTTER` premultiplied white RGBA8 texels whose alpha is
 * the coverage; the gutter column after each phase and the row under them
 * are blank, so a block written over an old one leaves no stale texel beside
 * its cells. The canvas is grown when too small and never shrunk. `curve`,
 * from `inkCurve`, reshapes each subsample's coverage before the filter, so
 * the glyphs match the distance field's weight.
 */
export function rasterizeGlyphs(
	context: GlyphCanvasContext,
	glyphs: readonly GlyphToRasterize[],
	pixelSize: number,
	family: string,
	curve: Uint8Array | null = null,
): Uint8Array[] {
	const phases = RASTER_PHASES;
	let width = 0;
	let height = 1;
	for (const { box } of glyphs) {
		width += box.width + CANVAS_GAP;
		height = Math.max(height, box.height);
	}
	const canvasWidth = Math.max(1, width * phases);
	const canvas = context.canvas;
	if (canvas.width < canvasWidth || canvas.height < height) {
		// Resizing resets the context's state, so everything is set after it.
		canvas.width = Math.max(canvas.width, canvasWidth);
		canvas.height = Math.max(canvas.height, height);
	}
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, canvasWidth, height);
	context.setTransform(phases, 0, 0, 1, 0, 0);
	context.font = `${pixelSize}px "${family}"`;
	context.fillStyle = '#ffffff';
	context.textBaseline = 'alphabetic';
	context.textAlign = 'left';
	let pen = 0;
	for (const { outlineCodePoint, box } of glyphs) {
		context.fillText(String.fromCodePoint(outlineCodePoint), pen - box.left, -box.top);
		pen += box.width + CANVAS_GAP;
	}
	context.setTransform(1, 0, 0, 1, 0, 0);

	const source = context.getImageData(0, 0, canvasWidth, height).data;
	const blocks: Uint8Array[] = [];
	let offset = 0;
	for (const { box } of glyphs) {
		const blockWidth = rasterBlockWidth(box);
		const block = new Uint8Array(blockWidth * (box.height + RASTER_GUTTER) * 4);
		const first = offset * phases;
		const end = (offset + box.width) * phases;
		for (let row = 0; row < box.height; row++) {
			const sourceRow = row * canvasWidth;
			for (let phase = 0; phase < phases; phase++) {
				const cellX = phase * (box.width + RASTER_GUTTER);
				for (let column = 0; column < box.width; column++) {
					let sum = 0;
					const start = (offset + column) * phases - phase;
					for (let sub = start; sub < start + phases; sub++) {
						if (sub < first || sub >= end) continue;
						const coverage = source[(sourceRow + sub) * 4 + 3];
						sum += curve ? curve[coverage] : coverage;
					}
					const value = Math.round(sum / phases);
					const texel = (row * blockWidth + cellX + column) * 4;
					block[texel] = value;
					block[texel + 1] = value;
					block[texel + 2] = value;
					block[texel + 3] = value;
				}
			}
		}
		blocks.push(block);
		offset += box.width + CANVAS_GAP;
	}
	return blocks;
}

/**
 * Draws `INK_REFERENCE_TEXT` in white the way `rasterizeGlyphs` draws a
 * glyph (`RASTER_PHASES` times as wide, the face at `pixelSize`) and reads it
 * back: the subsample RGBA, row by row. `widthEm` is the word's advance in
 * ems, from the atlas, which sizes the canvas.
 */
export function drawInkSample(context: GlyphCanvasContext, family: string, pixelSize: number, widthEm: number): ArrayLike<number> {
	const phases = RASTER_PHASES;
	const width = Math.ceil((widthEm + 1) * pixelSize * phases);
	const height = Math.ceil(pixelSize * 2) + CANVAS_GAP * 2;
	const canvas = context.canvas;
	if (canvas.width < width || canvas.height < height) {
		canvas.width = Math.max(canvas.width, width);
		canvas.height = Math.max(canvas.height, height);
	}
	context.setTransform(1, 0, 0, 1, 0, 0);
	context.clearRect(0, 0, width, height);
	context.setTransform(phases, 0, 0, 1, 0, 0);
	context.font = `${pixelSize}px "${family}"`;
	context.fillStyle = '#ffffff';
	context.textBaseline = 'alphabetic';
	context.textAlign = 'left';
	context.fillText(INK_REFERENCE_TEXT, pixelSize / 2, CANVAS_GAP + Math.ceil(pixelSize * 1.5));
	context.setTransform(1, 0, 0, 1, 0, 0);
	return context.getImageData(0, 0, width, height).data;
}

/** How many subsamples of RGBA `data` have each alpha, 0 to 255. */
export function inkHistogram(data: ArrayLike<number>): Uint32Array {
	const histogram = new Uint32Array(256);
	for (let index = 3; index < data.length; index += 4) histogram[data[index]] += 1;
	return histogram;
}

/** The ink, in device pixels after the box filter, of a sample whose coverage goes through `c^exponent`. */
export function histogramInk(histogram: Uint32Array, exponent = 1): number {
	let ink = 0;
	for (let value = 1; value < 256; value++) {
		if (histogram[value] > 0) ink += histogram[value] * Math.pow(value / 255, exponent);
	}
	return ink / RASTER_PHASES;
}

/**
 * The coverage curve that brings a raster sample's ink to `target`, the
 * distance field's ink of the same word at the same size, as a table from
 * the platform's coverage byte to the one written; null when the sample is
 * within `INK_TOLERANCE` of the target already, or empty.
 *
 * The curve is a power, `c^exponent`, so pixels the outline covers stay
 * fully covered and the platform's darkening, which spreads partial
 * coverage past the outline's edge, is what gets thinned (or, for a platform
 * lighter than the field, thickened).
 */
export function inkCurve(histogram: Uint32Array, target: number): Uint8Array | null {
	const ink = histogramInk(histogram);
	if (ink <= 0 || target <= 0 || Math.abs(ink / target - 1) <= INK_TOLERANCE) return null;
	let low = 0.25;
	let high = 4;
	for (let step = 0; step < 32; step++) {
		const exponent = (low + high) / 2;
		if (histogramInk(histogram, exponent) > target) low = exponent;
		else high = exponent;
	}
	const exponent = (low + high) / 2;
	const curve = new Uint8Array(256);
	for (let value = 0; value < 256; value++) curve[value] = Math.round(255 * Math.pow(value / 255, exponent));
	return curve;
}
