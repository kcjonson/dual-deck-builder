/**
 * Chapter 7's viewport arithmetic, with no DOM: the logical size is defined
 * from the framebuffer (R7.5), never the other way round, so the projection,
 * the scissor flip and the snapping grid all divide the same device pixels by
 * the same ratio and cannot disagree at a fractional one.
 *
 * `CanvasViewport` measures a canvas and feeds this; tests feed it directly.
 */

export interface ViewportState {
	/** Logical width (R7.1), `framebufferWidth / ratio`. What layout, input and the projection use. */
	readonly width: number;
	readonly height: number;
	/** The canvas backing store in device pixels. */
	readonly framebufferWidth: number;
	readonly framebufferHeight: number;
	/** The platform's device pixel ratio (R7.3). Only the backing store reads it. */
	readonly dpr: number;
	/** R7.5's UI scale. */
	readonly uiScale: number;
	/** `dpr * uiScale` (R7.2): the one number snapping and per-draw device constants use. */
	readonly ratio: number;
}

export interface ResolveViewportOptions {
	framebufferWidth: number;
	framebufferHeight: number;
	dpr: number;
	uiScale?: number;
}

export function resolveViewport({ framebufferWidth, framebufferHeight, dpr, uiScale = 1 }: ResolveViewportOptions): ViewportState {
	if (!(dpr > 0) || !(uiScale > 0)) {
		throw new Error(`resolveViewport: dpr and uiScale must be positive, got ${dpr} and ${uiScale}`);
	}
	const ratio = dpr * uiScale;
	return {
		width: framebufferWidth / ratio,
		height: framebufferHeight / ratio,
		framebufferWidth,
		framebufferHeight,
		dpr,
		uiScale,
		ratio,
	};
}

/**
 * R15.4's fallback when the platform cannot report the device-pixel box
 * (WebKit): round, never truncate. `canvas.width = cssWidth * dpr` truncates,
 * which at 1.25 turns a 1153-pixel-wide window into a 1441-pixel buffer
 * mapped over 1153 logical pixels, a ratio of 1.2498 that nothing else uses.
 * At least one device pixel, so a collapsed canvas never divides by zero.
 */
export function devicePixelsFromCss(cssSize: number, dpr: number): number {
	return Math.max(1, Math.round(cssSize * dpr));
}

export function sameViewport(a: ViewportState, b: ViewportState): boolean {
	return a.framebufferWidth === b.framebufferWidth
		&& a.framebufferHeight === b.framebufferHeight
		&& a.dpr === b.dpr
		&& a.uiScale === b.uiScale;
}
