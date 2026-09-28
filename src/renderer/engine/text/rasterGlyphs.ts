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

/** R6.5's screen-space range, in device pixels, for a run at `size` logical px. */
export function screenRange(atlas: FontAtlas, size: number, ratio: number): number {
	return (atlas.distanceRange * size * ratio) / atlas.size;
}

/** Whether R6.4a sends a run at this size and ratio to the raster fallback. */
export function wantsRasterGlyphs(atlas: FontAtlas, size: number, ratio: number): boolean {
	return screenRange(atlas, size, ratio) < RASTER_RANGE_THRESHOLD;
}

/** One glyph's cell in a raster atlas. */
export interface RasterGlyphCell {
	readonly codePoint: number;
	/** What the platform draws: the outline's code point, a substitute's source (R6.3). */
	readonly outlineCodePoint: number;
	/** The cell in atlas texels. */
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
	/**
	 * The cell's top-left corner in whole device pixels from the pen on the
	 * baseline, y down. A pen on a device pixel draws the cell one texel to
	 * one pixel, which is what keeps the platform's rasterisation sharp.
	 */
	readonly left: number;
	readonly top: number;
}

/** Where every glyph of one (face, size, ratio) goes, before anything is drawn. */
export interface RasterGlyphPlan {
	readonly width: number;
	readonly height: number;
	/** `size * ratio`: the font size the platform rasterises at, in device pixels. */
	readonly pixelSize: number;
	readonly cells: ReadonlyMap<number, RasterGlyphCell>;
}

/**
 * Packs a cell for every glyph with an image into rows. A cell spans the
 * glyph's plane bounds (R6.2's quad placement, which already pads the outline
 * by half the distance range) rounded out to whole device pixels, so the
 * platform's ink for the same outline lands inside it.
 */
export function planRasterGlyphs(atlas: FontAtlas, size: number, ratio: number): RasterGlyphPlan {
	const pixelSize = size * ratio;
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
		const cellWidth = Math.max(1, Math.ceil(plane.right * pixelSize) - left);
		const cellHeight = Math.max(1, Math.ceil(plane.bottom * pixelSize) - top);
		if (penX + cellWidth + GUTTER > MAX_ROW_WIDTH && penX > GUTTER) {
			penX = GUTTER;
			penY += rowHeight + GUTTER;
			rowHeight = 0;
		}
		cells.set(codePoint, { codePoint, outlineCodePoint: glyph.outlineCodePoint ?? codePoint, x: penX, y: penY, width: cellWidth, height: cellHeight, left, top });
		penX += cellWidth + GUTTER;
		rowHeight = Math.max(rowHeight, cellHeight);
		width = Math.max(width, penX);
	}
	return { width: Math.max(1, width), height: Math.max(1, penY + rowHeight + GUTTER), pixelSize, cells };
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
	glyphs(font: string, atlas: FontAtlas, size: number, ratio: number): RasterGlyphAtlas | null;
}

/** The part of `CanvasRenderingContext2D` the rasteriser uses, so it runs against a fake in tests. */
export interface GlyphCanvasContext {
	font: string;
	fillStyle: string | CanvasGradient | CanvasPattern;
	textBaseline: CanvasTextBaseline;
	textAlign: CanvasTextAlign;
	clearRect(x: number, y: number, width: number, height: number): void;
	save(): void;
	restore(): void;
	beginPath(): void;
	rect(x: number, y: number, width: number, height: number): void;
	clip(): void;
	fillText(text: string, x: number, y: number): void;
}

/**
 * Draws every planned glyph in white through the platform's 2D text API
 * (R6.1's permitted raster alternative), each clipped to its own cell and
 * with its pen on a whole texel, so the canvas holds coverage in alpha. The
 * canvas must be `plan.width` by `plan.height`.
 */
export function rasterizeGlyphs(context: GlyphCanvasContext, plan: RasterGlyphPlan, family: string): void {
	context.clearRect(0, 0, plan.width, plan.height);
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
}
