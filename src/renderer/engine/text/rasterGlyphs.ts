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
 * Whole-device-pixel pens for one word of a raster run, so its glyphs sit one
 * texel to one pixel with even gaps. `pens[0 .. count)` are the layout's pens
 * in device pixels; `out` gets the whole-pixel ones.
 *
 * Rounding each pen alone makes a glyph's gap depend on the sub-pixel phase
 * its pen lands on, so equal letters get unequal gaps ("attack" reads
 * "atta ck"). Here each gap is its layout advance rounded down or up, chosen
 * for the whole word at once to stay closest to the advances (the spare
 * pixels go to the advances with the largest fractional parts, as hinted
 * platform text rounds its advances), under two constraints: the first and
 * last pens round to the nearest pixel, so a word starts and ends within half
 * a pixel of where the layout and `measureText` put it (R6.8), and no pen
 * strays a whole pixel from the layout, so a long word is never squeezed at
 * one end and stretched at the other. Rounding each pen is always one such
 * choice, so there is always a solution.
 *
 * A two-state dynamic program over the pens: each is its layout pen rounded
 * down or up. `back` is scratch of at least `2 * count` entries.
 */
export function evenWordPens(pens: Float64Array, count: number, out: Float64Array, back: Uint8Array): void {
	if (count <= 0) return;
	const first = Math.round(pens[0]);
	out[0] = first;
	if (count === 1) return;
	const last = Math.round(pens[count - 1]);

	let cost0 = first === Math.floor(pens[0]) ? 0 : Infinity;
	let cost1 = first === Math.floor(pens[0]) ? Infinity : 0;
	for (let index = 1; index < count; index++) {
		const pen = pens[index];
		const previous = pens[index - 1];
		const advance = pen - previous;
		const floor = Math.floor(pen);
		const previousFloor = Math.floor(previous);
		let next0 = Infinity;
		let next1 = Infinity;
		for (let state = 0; state < 2; state++) {
			const whole = floor + state;
			if (Math.abs(whole - pen) >= 1) continue;
			if (index === count - 1 && whole !== last) continue;
			let best = Infinity;
			let from = 0;
			for (let before = 0; before < 2; before++) {
				const prior = before === 0 ? cost0 : cost1;
				if (prior === Infinity) continue;
				const gap = whole - (previousFloor + before);
				const error = gap - advance;
				if (Math.abs(error) >= 1) continue;
				const drift = whole - pen;
				const total = prior + error * error + DRIFT_WEIGHT * drift * drift;
				if (total < best) {
					best = total;
					from = before;
				}
			}
			back[index * 2 + state] = from;
			if (state === 0) next0 = best;
			else next1 = best;
		}
		cost0 = next0;
		cost1 = next1;
	}

	let state = last - Math.floor(pens[count - 1]);
	for (let index = count - 1; index > 0; index--) {
		out[index] = Math.floor(pens[index]) + state;
		state = back[index * 2 + state];
	}
}

/** How much a pen's distance from the layout counts against the gaps' distance from their advances. */
const DRIFT_WEIGHT = 0.1;

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

/** Where every glyph of one face at one device font size goes, before anything is drawn. */
export interface RasterGlyphPlan {
	readonly width: number;
	readonly height: number;
	/** The font size the platform rasterises at, in device pixels. */
	readonly pixelSize: number;
	readonly cells: ReadonlyMap<number, RasterGlyphCell>;
}

/**
 * Packs a cell for every glyph with an image into rows. A cell spans the
 * glyph's plane bounds (R6.2's quad placement, which already pads the outline
 * by half the distance range) rounded out to whole device pixels, so the
 * platform's ink for the same outline lands inside it.
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
	glyphs(font: string, atlas: FontAtlas, pixelSize: number): RasterGlyphAtlas | null;
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
