import type { TextureHandle } from '../draw/commands';
import type { TextureOptions, TextureRegion } from '../gpu/TextureStore';
import type { FontAtlas } from '../text/FontAtlas';
import type { TextLayout } from '../text/TextLayout';
import {
	GlyphCanvasContext,
	GlyphToRasterize,
	INK_REFERENCE_TEXT,
	RASTER_GUTTER,
	RasterGlyphCell,
	RasterGlyphRun,
	RasterGlyphSource,
	rasterBlockWidth,
	rasterGlyphBox,
	drawInkSample,
	inkCurve,
	inkHistogram,
	rasterizeGlyphs,
} from '../text/rasterGlyphs';

export interface RasterGlyphPageOptions {
	textures: {
		create(options: TextureOptions): TextureHandle;
		writeRegion(handle: TextureHandle, region: TextureRegion, texels: Uint8Array): void;
	};
	/** The platform family for a font role once its face is ready, else null (`PlatformFaces.familyOf`). */
	familyOf: (font: string) => string | null;
	/**
	 * The distance field's ink of `INK_REFERENCE_TEXT` per square pixel of
	 * font size for a font role (`FontFaceAsset.fieldInk`), which each size's
	 * raster glyphs are matched to in weight; null leaves the platform's
	 * coverage as drawn. Defaults to null.
	 */
	fieldInkOf?: (font: string) => number | null;
	/** The scratch canvas's 2D context, made once on first use; null where there is none. */
	createCanvas: () => GlyphCanvasContext | null;
	/** Milliseconds, for the per-frame budget. */
	now: () => number;
	/** Rasterising a frame may spend before later runs wait a frame on the distance field. */
	budgetMs?: number;
	/** The page in texels. */
	width?: number;
	height?: number;
	/** Receives the one warning when the page fills with glyphs all in use. Defaults to console.warn. */
	warn?: (message: string) => void;
}

interface SizeEntry {
	/** The distance-field atlas the glyphs were measured from; a reloaded role starts over. */
	readonly atlas: FontAtlas;
	readonly cells: Map<number, RasterGlyphCell>;
	/** Handed to the encoder as is, so a run costs no allocation once its glyphs are in. */
	readonly run: RasterGlyphRun;
	/** The frame a run last asked for this size. */
	lastUsed: number;
	/** The coverage curve this size's glyphs are drawn through (`inkCurve`); undefined until measured. */
	curve: Uint8Array | null | undefined;
}

interface Shelf {
	readonly y: number;
	readonly height: number;
	x: number;
}

/**
 * A window drag across the combat screen, new sizes every frame, peaks at
 * about 4.7 ms render plus flush with this against 2 ms on the distance field
 * alone (small-text-raster-fallback.md).
 */
const DEFAULT_BUDGET_MS = 3;
/** 4 MB, four phase cells a glyph. Nothing grows past it, so this is also the cap. */
const DEFAULT_SIZE = 1024;
/** A size no run has asked for in this many frames is dead space a full page can win back. */
const STALE_FRAMES = 2;

/**
 * R6.4a's raster glyphs, all fonts and sizes on one shared page texture, so a
 * frame's small text samples one texture however many sizes it uses and
 * never spends more than one of R5.20's dynamic units.
 *
 * Glyphs are rasterised on demand, a run's missing ones in one canvas pass
 * (`rasterizeGlyphs`), and written into the page with `writeRegion`. Each is
 * shelf-packed: its four phase cells side by side with a gutter. A frame may
 * spend `budgetMs` rasterising; a run whose glyphs are not all in by then
 * draws from the distance field for that frame and gets its glyphs the next.
 * `prewarm` lifts the budget for one frame, which a screen or scene mount
 * asks for, so the first frame of a screen draws its small text from the
 * raster already and never pops from soft to sharp. A resize stays on the
 * budget, so a window drag does not stutter; its new sizes can take a frame.
 *
 * The page is the cap on memory. When it fills, the run that did not fit
 * draws from the field, and at the next frame the page starts over only if
 * it holds dead space: a size no run asked for in `STALE_FRAMES` frames, or
 * cells a reloaded role left behind. The glyphs that frame asks for are
 * rasterised again. A page full of glyphs still in use is kept as it is, and
 * the runs that did not fit stay on the field, steadily, until the set in use
 * changes; starting over would evict glyphs the next frame needs and never
 * settle. That case warns once. The texels live in the page's kept source
 * too, so a restored context uploads the page as it stands.
 */
export class RasterGlyphPage implements RasterGlyphSource {
	private readonly textures: RasterGlyphPageOptions['textures'];
	private readonly familyOf: (font: string) => string | null;
	private readonly fieldInkOf: (font: string) => number | null;
	private readonly createCanvas: () => GlyphCanvasContext | null;
	private readonly now: () => number;
	private readonly budgetMs: number;
	private readonly width: number;
	private readonly height: number;
	private readonly warn: (message: string) => void;

	private texture: TextureHandle | null = null;
	private canvas: GlyphCanvasContext | null | undefined = undefined;
	private readonly sizes = new Map<string, SizeEntry>();
	private shelves: Shelf[] = [];
	private nextShelfY = RASTER_GUTTER;
	private full = false;
	private spentMs = 0;
	private unbudgeted = false;
	private prewarmRequested = false;
	private resetCount = 0;
	private glyphCount = 0;
	private frame = 0;
	/** Cells on the page that no size references, left by a reloaded role. */
	private orphanedCells = 0;
	private warned = false;
	/** Scratch for a run's missing glyphs, reused. */
	private readonly missing: { codePoint: number; toRasterize: GlyphToRasterize }[] = [];
	private readonly missingCodePoints = new Set<number>();

	constructor({
		textures,
		familyOf,
		fieldInkOf = () => null,
		createCanvas,
		now,
		budgetMs = DEFAULT_BUDGET_MS,
		width = DEFAULT_SIZE,
		height = DEFAULT_SIZE,
		warn = (message) => console.warn(message),
	}: RasterGlyphPageOptions) {
		this.textures = textures;
		this.familyOf = familyOf;
		this.fieldInkOf = fieldInkOf;
		this.createCanvas = createCanvas;
		this.now = now;
		this.budgetMs = budgetMs;
		this.width = width;
		this.height = height;
		this.warn = warn;
	}

	/** Glyphs on the page now. */
	get glyphsOnPage(): number {
		return this.glyphCount;
	}

	/** Whether the page is full: runs with glyphs not on it draw from the field. */
	get isFull(): boolean {
		return this.full;
	}

	/** Times the page filled and started over. */
	get resets(): number {
		return this.resetCount;
	}

	/** Lifts the time budget for the next frame: a screen or scene just mounted. */
	prewarm(): void {
		this.prewarmRequested = true;
	}

	/** Between frames: starts a full page with dead space over, and renews the budget. */
	beginFrame(): void {
		this.frame += 1;
		if (this.full) {
			if (this.hasDeadSpace()) {
				this.sizes.clear();
				this.shelves = [];
				this.nextShelfY = RASTER_GUTTER;
				this.glyphCount = 0;
				this.orphanedCells = 0;
				this.full = false;
				this.resetCount += 1;
			} else if (!this.warned) {
				this.warned = true;
				this.warn(`RasterGlyphPage: the ${this.width}x${this.height} page is full of glyphs in use; small text that does not fit draws from the distance field`);
			}
		}
		this.spentMs = 0;
		this.unbudgeted = this.prewarmRequested;
		this.prewarmRequested = false;
	}

	glyphs(font: string, layout: TextLayout, pixelSize: number): RasterGlyphRun | null {
		const family = this.familyOf(font);
		if (!family) return null;
		const entry = this.entry(font, layout.atlas, pixelSize);
		entry.lastUsed = this.frame;

		const missing = this.missing;
		const seen = this.missingCodePoints;
		missing.length = 0;
		seen.clear();
		for (let line = 0; line < layout.lines.length; line++) {
			const glyphs = layout.lines[line].glyphs;
			for (let index = 0; index < glyphs.length; index++) {
				const glyph = glyphs[index].glyph;
				if (!glyph.plane || entry.cells.has(glyph.codePoint) || seen.has(glyph.codePoint)) continue;
				const box = rasterGlyphBox(glyph, pixelSize);
				if (!box) continue;
				seen.add(glyph.codePoint);
				missing.push({ codePoint: glyph.codePoint, toRasterize: { outlineCodePoint: glyph.outlineCodePoint ?? glyph.codePoint, box } });
			}
		}
		if (missing.length === 0) return entry.run;
		if (this.full || (!this.unbudgeted && this.spentMs >= this.budgetMs)) return null;

		const texture = this.ensureTexture();
		const canvas = this.ensureCanvas();
		if (!canvas) return null;
		const started = this.now();
		if (entry.curve === undefined) entry.curve = this.measureCurve(canvas, font, family, layout.atlas, pixelSize);
		const blocks = rasterizeGlyphs(canvas, missing.map((glyph) => glyph.toRasterize), pixelSize, family, entry.curve);
		let complete = true;
		for (let index = 0; index < missing.length; index++) {
			const { codePoint, toRasterize: { box } } = missing[index];
			const blockWidth = rasterBlockWidth(box);
			const blockHeight = box.height + RASTER_GUTTER;
			const place = this.allocate(blockWidth, blockHeight);
			if (!place) {
				this.full = true;
				complete = false;
				break;
			}
			this.textures.writeRegion(texture, { x: place.x, y: place.y, width: blockWidth, height: blockHeight }, blocks[index]);
			entry.cells.set(codePoint, { ...box, x: place.x, y: place.y, stride: box.width + RASTER_GUTTER });
			this.glyphCount += 1;
		}
		this.spentMs += this.now() - started;
		return complete ? entry.run : null;
	}

	private entry(font: string, atlas: FontAtlas, pixelSize: number): SizeEntry {
		const key = `${font}\u0000${pixelSize}`;
		const existing = this.sizes.get(key);
		if (existing && existing.atlas === atlas) return existing;
		// A role loaded again measures with new metrics; its old cells stay on
		// the page, unreferenced, until the page next starts over.
		if (existing) this.orphanedCells += existing.cells.size;
		const texture = this.ensureTexture();
		const cells = new Map<number, RasterGlyphCell>();
		const entry: SizeEntry = { atlas, cells, run: { texture, width: this.width, height: this.height, cells }, lastUsed: this.frame, curve: undefined };
		this.sizes.set(key, entry);
		return entry;
	}

	/**
	 * The curve that matches a size's raster glyphs to the distance field in
	 * weight: the reference word drawn at the size, its ink against the
	 * field's (DDB-217). Once per size, before its first glyphs.
	 */
	private measureCurve(canvas: GlyphCanvasContext, font: string, family: string, atlas: FontAtlas, pixelSize: number): Uint8Array | null {
		const fieldInk = this.fieldInkOf(font);
		if (fieldInk === null) return null;
		let widthEm = 0;
		for (const character of INK_REFERENCE_TEXT) widthEm += atlas.glyph(character.codePointAt(0) ?? 0)?.advance ?? 1;
		const sample = drawInkSample(canvas, family, pixelSize, widthEm);
		return inkCurve(inkHistogram(sample), fieldInk * pixelSize * pixelSize);
	}

	/** Whether starting over would win anything back: orphaned cells, or a size with cells no run has asked for lately. */
	private hasDeadSpace(): boolean {
		if (this.orphanedCells > 0) return true;
		const staleBefore = this.frame - STALE_FRAMES;
		for (const entry of this.sizes.values()) {
			if (entry.lastUsed < staleBefore && entry.cells.size > 0) return true;
		}
		return false;
	}

	private ensureTexture(): TextureHandle {
		if (!this.texture) {
			this.texture = this.textures.create({
				width: this.width,
				height: this.height,
				label: 'small text glyph page',
				source: new Uint8Array(this.width * this.height * 4),
				content: 'color',
				// The page's texels, kept current by `writeRegion`, are what a
				// restored context uploads (R5.33).
				keepSource: true,
				immediate: true,
			});
		}
		return this.texture;
	}

	private ensureCanvas(): GlyphCanvasContext | null {
		if (this.canvas === undefined) this.canvas = this.createCanvas();
		return this.canvas;
	}

	/**
	 * Shelf packing: the first shelf as tall as the block and no more than a
	 * few texels taller, with room left in it, else a new shelf under the
	 * last. Null when the page has no room.
	 */
	private allocate(width: number, height: number): { x: number; y: number } | null {
		if (width + RASTER_GUTTER > this.width) return null;
		for (const shelf of this.shelves) {
			if (shelf.height >= height && shelf.height <= height + 4 && shelf.x + width <= this.width) {
				const x = shelf.x;
				shelf.x += width;
				return { x, y: shelf.y };
			}
		}
		if (this.nextShelfY + height > this.height) return null;
		const shelf: Shelf = { y: this.nextShelfY, height, x: RASTER_GUTTER + width };
		this.shelves.push(shelf);
		this.nextShelfY += height;
		return { x: RASTER_GUTTER, y: shelf.y };
	}
}

/** One DOM canvas for the WebGL2 backend's rasterising, read back once per run. */
export function createDocumentGlyphCanvas(): GlyphCanvasContext | null {
	const canvas = document.createElement('canvas');
	return canvas.getContext('2d', { willReadFrequently: true });
}
