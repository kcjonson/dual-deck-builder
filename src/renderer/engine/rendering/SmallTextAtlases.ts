import type { TextureHandle } from '../draw/commands';
import type { TextureOptions } from '../gpu/TextureStore';
import type { FontAtlas } from '../text/FontAtlas';
import {
	GlyphCanvasContext,
	RasterGlyphAtlas,
	RasterGlyphSource,
	planRasterGlyphs,
	rasterCanvasSize,
	rasterizeGlyphs,
} from '../text/rasterGlyphs';

export interface SmallTextAtlasesOptions {
	textures: {
		create(options: TextureOptions): TextureHandle;
		release(handle: TextureHandle): void;
	};
	/** The platform family for a font role once its face is ready, else null (`PlatformFaces.familyOf`). */
	familyOf: (font: string) => string | null;
	/** A 2D context on a canvas of the given size, or null where there is none. */
	createCanvas: (width: number, height: number) => GlyphCanvasContext | null;
	/** Frames an atlas may go unused before it is freed. */
	idleFrames?: number;
	/** Atlases built in one frame at most; a run past it keeps the distance field until the next. */
	buildsPerFrame?: number;
}

interface Entry {
	readonly atlas: RasterGlyphAtlas;
	/** The distance-field atlas the cells were planned from; a reloaded role replans. */
	readonly source: FontAtlas;
	lastUsed: number;
}

/** About five seconds at 60 Hz: a screen that comes back soon finds its atlas. */
const DEFAULT_IDLE_FRAMES = 300;
/** A few milliseconds of rasterising at most, so a zoom through many sizes never stalls a frame. */
const DEFAULT_BUILDS_PER_FRAME = 4;

/**
 * R6.4a's per-(face, size, ratio) raster atlases, built by the platform's 2D
 * text API the first time a run needs one and kept while runs keep using it.
 * They are keyed on the device font size (`size * scale * ratio`, on
 * `RASTER_SIZE_STEP`), which is the (size, ratio) pair the spec names with any
 * uniform scale the run is drawn under folded in.
 *
 * The spec builds them at load time; the sizes a UI uses are not known then,
 * so each is built on first use instead, synchronously and uploaded at once,
 * inside the frame that first draws the size. That frame already draws from
 * it, so small text never shows its distance-field version first and a
 * capture does not depend on how many frames ran. One atlas is a few hundred
 * glyphs of 8 px text, about a 512 by 60 texture and a millisecond or two.
 *
 * A ratio or scale change leaves the old sizes idle, and they are freed after
 * `idleFrames`; at most `buildsPerFrame` new ones are built a frame, so an
 * animated zoom cannot stall one, and a run past the budget draws from the
 * distance field for that frame. Uploads bind the
 * texture device's upload unit, which no draw samples, so building one
 * between two flushes disturbs nothing the backend has bound.
 */
export class SmallTextAtlases implements RasterGlyphSource {
	private readonly textures: SmallTextAtlasesOptions['textures'];
	private readonly familyOf: (font: string) => string | null;
	private readonly createCanvas: (width: number, height: number) => GlyphCanvasContext | null;
	private readonly idleFrames: number;
	private readonly buildsPerFrame: number;
	private readonly entries = new Map<string, Entry>();
	private frame = 0;
	private builtThisFrame = 0;

	constructor({
		textures,
		familyOf,
		createCanvas,
		idleFrames = DEFAULT_IDLE_FRAMES,
		buildsPerFrame = DEFAULT_BUILDS_PER_FRAME,
	}: SmallTextAtlasesOptions) {
		this.textures = textures;
		this.familyOf = familyOf;
		this.createCanvas = createCanvas;
		this.idleFrames = idleFrames;
		this.buildsPerFrame = buildsPerFrame;
	}

	/** Atlases held, for tests and the counters. */
	get size(): number {
		return this.entries.size;
	}

	/** Between frames: frees atlases idle past `idleFrames`, and renews the build budget. */
	beginFrame(): void {
		this.frame += 1;
		this.builtThisFrame = 0;
		for (const [key, entry] of this.entries) {
			if (this.frame - entry.lastUsed > this.idleFrames) this.drop(key, entry);
		}
	}

	glyphs(font: string, atlas: FontAtlas, pixelSize: number): RasterGlyphAtlas | null {
		const key = `${font}\u0000${pixelSize}`;
		const cached = this.entries.get(key);
		if (cached && cached.source === atlas) {
			cached.lastUsed = this.frame;
			return cached.atlas;
		}
		if (cached) this.drop(key, cached);

		const family = this.familyOf(font);
		if (!family || this.builtThisFrame >= this.buildsPerFrame) return null;
		const plan = planRasterGlyphs(atlas, pixelSize);
		const canvasSize = rasterCanvasSize(plan);
		const context = this.createCanvas(canvasSize.width, canvasSize.height);
		if (!context) return null;
		const texels = rasterizeGlyphs(context, plan, family);
		const texture = this.textures.create({
			width: plan.width,
			height: plan.height,
			label: `small text ${font} at ${pixelSize} device px`,
			source: texels,
			content: 'color',
			// The texels are the source a restored context uploads again (R5.33).
			keepSource: true,
			immediate: true,
		});
		this.builtThisFrame += 1;		const built: RasterGlyphAtlas = { texture, width: plan.width, height: plan.height, cells: plan.cells };
		this.entries.set(key, { atlas: built, source: atlas, lastUsed: this.frame });
		return built;
	}

	/** Frees every atlas. */
	clear(): void {
		for (const [key, entry] of this.entries) this.drop(key, entry);
	}

	private drop(key: string, entry: Entry): void {
		this.entries.delete(key);
		this.textures.release(entry.atlas.texture);
	}
}

/** The DOM's canvas, for the WebGL2 backend; read back once per atlas. */
export function createDocumentGlyphCanvas(width: number, height: number): GlyphCanvasContext | null {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	return canvas.getContext('2d', { willReadFrequently: true });
}
