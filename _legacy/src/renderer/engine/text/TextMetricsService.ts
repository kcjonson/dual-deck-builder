import type { MeasureTextOptions, TextMetrics, TextOverflow, TextTransform, TextWrap } from '../draw/commands';
import type { Rect } from '../draw/geometry';
import type { FontAtlas } from './FontAtlas';
import { TextLayout, TextLayoutRequest, layoutText } from './TextLayout';

/**
 * Chapter 6's metrics service: the loaded atlases by font role, and the one
 * way to lay text out against them. The backend that draws text owns one and
 * answers `measureText`, `textInk` and its glyph quads from it, so every one
 * of those reads the same `TextLayout` (R6.8).
 *
 * Layouts are cached (R6.12) in a bounded LRU keyed on everything a layout
 * depends on: role, text, size, letter spacing, transform, wrap, overflow and
 * the box the wrap and ellipsis fit. A UI redraws the same labels every frame,
 * so steady state is all hits. Loading an atlas empties the cache.
 *
 * DOM-free (R14.1): the atlases are parsed metrics, the image is the backend's.
 */

/** The parts of a draw or measure call a layout depends on; `DrawTextOptions`, a `TextCommand` and `MeasureTextOptions` fit. */
export interface TextRunOptions {
	readonly text: string;
	readonly font: string;
	readonly size: number;
	readonly letterSpacing?: number;
	readonly textTransform?: TextTransform;
	readonly wrap?: TextWrap;
	readonly overflow?: TextOverflow;
	readonly maxWidth?: number | null;
	readonly box?: Rect | null;
	readonly lineHeight?: number | null;
}

export interface TextMetricsServiceOptions {
	/** Layouts kept. A screen of labels is a few hundred; the default leaves room for two. */
	capacity?: number;
}

const DEFAULT_CAPACITY = 1024;

export class TextMetricsService {
	private readonly atlases = new Map<string, FontAtlas>();
	private readonly cache = new Map<string, TextLayout>();
	private readonly capacity: number;
	private hitCount = 0;
	private missCount = 0;

	constructor({ capacity = DEFAULT_CAPACITY }: TextMetricsServiceOptions = {}) {
		this.capacity = capacity;
	}

	/** Roles with an atlas, in the order they were added. */
	get names(): readonly string[] {
		return [...this.atlases.keys()];
	}

	get cacheSize(): number {
		return this.cache.size;
	}

	get hits(): number {
		return this.hitCount;
	}

	get misses(): number {
		return this.missCount;
	}

	/** Adds or replaces a role's atlas; every cached layout is dropped, since any may have used it (R6.12). */
	addAtlas({ name, atlas }: { name: string; atlas: FontAtlas }): void {
		this.atlases.set(name, atlas);
		this.cache.clear();
	}

	atlas(name: string): FontAtlas | undefined {
		return this.atlases.get(name);
	}

	/** The layout for a run, or null when its font has no atlas. */
	layout(options: TextRunOptions): TextLayout | null {
		const atlas = this.atlases.get(options.font);
		if (!atlas) return null;
		const request = layoutRequest(options);
		const key = cacheKey(request);
		const cached = this.cache.get(key);
		if (cached) {
			// Re-inserted so the map's insertion order is recency order.
			this.cache.delete(key);
			this.cache.set(key, cached);
			this.hitCount += 1;
			return cached;
		}
		this.missCount += 1;
		const layout = layoutText(atlas, request);
		this.cache.set(key, layout);
		if (this.cache.size > this.capacity) {
			const oldest = this.cache.keys().next().value as string;
			this.cache.delete(oldest);
		}
		return layout;
	}

	/**
	 * R2.14 over the same layout `drawText` draws. Throws for a font with no
	 * atlas: an estimate would be the silent disagreement R6.8 exists to stop.
	 */
	measure(options: MeasureTextOptions): TextMetrics {
		const layout = this.layout(options);
		if (!layout) {
			throw new Error(`measureText: no atlas is loaded for font '${options.font}'; loaded: [${this.names.join(', ')}]`);
		}
		return metricsOf(layout);
	}
}

/** R2.14's summary of a layout. */
export function metricsOf(layout: TextLayout): TextMetrics {
	return {
		width: layout.width,
		height: layout.height,
		lines: layout.lines.length,
		lineWidths: layout.lines.map((line) => line.width),
		advances: layout.advances,
		baseline: (layout.lineHeight - layout.ascent - layout.descent) / 2 + layout.ascent,
	};
}

/**
 * The layout request a run implies, normalised so that runs laid out the same
 * way share a cache entry: the wrap width is `maxWidth`, else the box width;
 * it is dropped when neither wrap nor ellipsis reads it, and the box height is
 * dropped unless a wrapped ellipsis does.
 */
export function layoutRequest(options: TextRunOptions): TextLayoutRequest {
	const wrap = options.wrap ?? 'none';
	const overflow = options.overflow ?? 'visible';
	const ellipsis = overflow === 'ellipsis';
	const width = options.maxWidth ?? options.box?.width ?? null;
	return {
		text: options.text,
		font: options.font,
		size: options.size,
		letterSpacing: options.letterSpacing ?? 0,
		textTransform: options.textTransform ?? 'none',
		wrap,
		overflow: ellipsis ? 'ellipsis' : 'visible',
		maxWidth: wrap === 'word' || ellipsis ? width : null,
		maxHeight: wrap === 'word' && ellipsis ? options.box?.height ?? null : null,
		lineHeight: options.lineHeight ?? null,
	};
}

function cacheKey(request: TextLayoutRequest): string {
	return `${request.font}\u0000${request.size}\u0000${request.letterSpacing}\u0000${request.textTransform}\u0000${request.wrap}\u0000${request.overflow}\u0000${request.maxWidth}\u0000${request.maxHeight}\u0000${request.lineHeight}\u0000${request.text}`;
}
