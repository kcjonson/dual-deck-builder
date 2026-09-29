import type { TextureHandle } from '../draw/commands';
import type { TextureOptions, TextureRegion } from '../gpu/TextureStore';
import type { FontAtlas } from '../text/FontAtlas';
import type { TextLayout } from '../text/TextLayout';
import {
	GlyphCanvasContext,
	GlyphToRasterize,
	RASTER_GUTTER,
	RasterGlyphCell,
	RasterGlyphRun,
	RasterGlyphSource,
	rasterBlockWidth,
	rasterGlyphBox,
	rasterizeGlyphs,
} from '../text/rasterGlyphs';

export interface RasterGlyphPageOptions {
	textures: {
		create(options: TextureOptions): TextureHandle;
		writeRegion(handle: TextureHandle, region: TextureRegion, texels: Uint8Array): void;
	};
	/** The platform family for a font role once its face is ready, else null (`PlatformFaces.familyOf`). */
	familyOf: (font: string) => string | null;
	/** The scratch canvas's 2D context, made once on first use; null where there is none. */
	createCanvas: () => GlyphCanvasContext | null;
	/** Milliseconds, for the per-frame budget. */
	now: () => number;
	/** Rasterising a frame may spend before later runs wait a frame on the distance field. */
	budgetMs?: number;
	/** The page in texels. */
	width?: number;
	height?: number;
}

interface SizeEntry {
	/** The distance-field atlas the glyphs were measured from; a reloaded role starts over. */
	readonly atlas: FontAtlas;
	readonly cells: Map<number, RasterGlyphCell>;
	/** Handed to the encoder as is, so a run costs no allocation once its glyphs are in. */
	readonly run: RasterGlyphRun;
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
/** 4 MB, four phase cells a glyph. When it fills it starts over, so this is also the cap. */
const DEFAULT_SIZE = 1024;

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
 * The page is the cap on memory: when it fills, the run that did not fit
 * draws from the field and the page starts over at the next frame, the
 * glyphs that frame asks for rasterised again. The texels live in the page's
 * kept source too, so a restored context uploads the page as it stands.
 */
export class RasterGlyphPage implements RasterGlyphSource {
	private readonly textures: RasterGlyphPageOptions['textures'];
	private readonly familyOf: (font: string) => string | null;
	private readonly createCanvas: () => GlyphCanvasContext | null;
	private readonly now: () => number;
	private readonly budgetMs: number;
	private readonly width: number;
	private readonly height: number;

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
	/** Scratch for a run's missing glyphs, reused. */
	private readonly missing: { codePoint: number; toRasterize: GlyphToRasterize }[] = [];
	private readonly missingCodePoints = new Set<number>();

	constructor({
		textures,
		familyOf,
		createCanvas,
		now,
		budgetMs = DEFAULT_BUDGET_MS,
		width = DEFAULT_SIZE,
		height = DEFAULT_SIZE,
	}: RasterGlyphPageOptions) {
		this.textures = textures;
		this.familyOf = familyOf;
		this.createCanvas = createCanvas;
		this.now = now;
		this.budgetMs = budgetMs;
		this.width = width;
		this.height = height;
	}

	/** Glyphs on the page now. */
	get glyphsOnPage(): number {
		return this.glyphCount;
	}

	/** Times the page filled and started over. */
	get resets(): number {
		return this.resetCount;
	}

	/** Lifts the time budget for the next frame: a screen or scene just mounted. */
	prewarm(): void {
		this.prewarmRequested = true;
	}

	/** Between frames: starts a full page over, and renews the budget. */
	beginFrame(): void {
		if (this.full) {
			this.sizes.clear();
			this.shelves = [];
			this.nextShelfY = RASTER_GUTTER;
			this.glyphCount = 0;
			this.full = false;
			this.resetCount += 1;
		}
		this.spentMs = 0;
		this.unbudgeted = this.prewarmRequested;
		this.prewarmRequested = false;
	}

	glyphs(font: string, layout: TextLayout, pixelSize: number): RasterGlyphRun | null {
		const family = this.familyOf(font);
		if (!family) return null;
		const entry = this.entry(font, layout.atlas, pixelSize);
		if (!entry) return null;

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
		const blocks = rasterizeGlyphs(canvas, missing.map((glyph) => glyph.toRasterize), pixelSize, family);
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

	private entry(font: string, atlas: FontAtlas, pixelSize: number): SizeEntry | null {
		const key = `${font}\u0000${pixelSize}`;
		const existing = this.sizes.get(key);
		if (existing && existing.atlas === atlas) return existing;
		// A role loaded again measures with new metrics; its old cells stay on
		// the page, unreferenced, until the page next starts over.
		const texture = this.ensureTexture();
		const cells = new Map<number, RasterGlyphCell>();
		const entry: SizeEntry = { atlas, cells, run: { texture, width: this.width, height: this.height, cells } };
		this.sizes.set(key, entry);
		return entry;
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
