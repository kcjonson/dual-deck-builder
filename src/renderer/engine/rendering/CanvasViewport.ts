import type { BeginFrameOptions } from '../draw';
import { ViewportState, devicePixelsFromCss, resolveViewport, sameViewport } from '../coords/viewport';

/** What the viewport needs of a canvas: its CSS size, and its backing store to set. */
export interface ViewportCanvas {
	width: number;
	height: number;
	readonly clientWidth: number;
	readonly clientHeight: number;
}

interface ResolutionQuery {
	addEventListener(type: 'change', listener: () => void): void;
	removeEventListener(type: 'change', listener: () => void): void;
}

/** The slice of `window` this reads, injectable so a test can drive both R15.4 paths. */
export interface ViewportPlatform {
	readonly devicePixelRatio: number;
	matchMedia(query: string): ResolutionQuery;
	readonly ResizeObserver?: typeof ResizeObserver;
}

export type ViewportListener = (viewport: ViewportState) => void;

export interface CanvasViewportOptions {
	canvas: ViewportCanvas;
	platform?: ViewportPlatform;
	/** R7.5. Fixed at 1 until the settings screen offers it; the arithmetic already honours it. */
	uiScale?: number;
}

/**
 * The one viewport owner of R7.11 and the sizing of R15.4.
 *
 * The canvas's CSS box is the page's to size (both HTML pages fill the window
 * with it); this class only reads it. A `ResizeObserver` watching
 * `device-pixel-content-box` reports the exact device pixels the browser
 * rasterises the box at, which is the backing store with no rounding at all.
 * Where that box is not implemented (WebKit) the observer watches the content
 * box and the backing store is `Math.round(cssSize * devicePixelRatio)`. A
 * `devicePixelRatio` change with no change in device pixels (browser zoom
 * scales the CSS box the other way) fires no observer, so a `matchMedia`
 * query on the current resolution catches it, and is re-registered each time
 * it fires because it only matches the ratio it was made for.
 *
 * Measurements land as pending. `commit` applies them at the top of a frame
 * (R7.3: a change takes effect at the next `beginFrame`): the backing store
 * is resized there, which clears it, so it happens just before it is drawn
 * rather than between a frame and its presentation; then every listener
 * hears the new viewport, which is where screens resize their roots. The
 * pages run that frame straight from the observer (`onPending`), so a resize
 * never presents a stretched frame.
 *
 * The device-pixel box is checked against the CSS box times the ratio before
 * it is used, since an emulated ratio makes the two disagree; see `propose`.
 *
 * The logical viewport is `framebuffer / (dpr * uiScale)` (R7.5), not the CSS
 * size. The two differ by under a device pixel at a fractional ratio, and the
 * one derived from the framebuffer is the one the projection agrees with.
 */
export class CanvasViewport {
	private readonly canvas: ViewportCanvas;
	private readonly platform: ViewportPlatform;
	private readonly uiScale: number;
	private readonly listeners: ViewportListener[] = [];
	private readonly observer: ResizeObserver | null;
	/** Whether the observer reports device pixels; otherwise they are rounded from CSS pixels. */
	private exactDevicePixels = false;
	/**
	 * Called when a measurement lands that differs from the committed
	 * viewport. The pages run a frame from it (`FrameLoop.runNow`), so the
	 * resized frame presents in the same rendering update as the resize.
	 */
	onPending: (() => void) | null = null;

	private committed: ViewportState;
	private pending: ViewportState | null = null;
	private resolution: ResolutionQuery | null = null;

	constructor({ canvas, platform = window, uiScale = 1 }: CanvasViewportOptions) {
		this.canvas = canvas;
		this.platform = platform;
		this.uiScale = uiScale;

		// Measured once now so the first frame, and every screen constructed
		// before it, sees the real size; the observer's first report follows.
		this.committed = this.fromCss(canvas.clientWidth, canvas.clientHeight, this.dpr);
		this.applyBackingStore(this.committed);

		this.observer = this.observe();
		this.watchResolution();
	}

	/** The viewport of the current frame. */
	get state(): ViewportState {
		return this.committed;
	}

	/** Logical size (R7.1), for the tree snapshot and the status hooks. */
	get logical(): { width: number; height: number } {
		return { width: this.committed.width, height: this.committed.height };
	}

	/** What `DrawApi.beginFrame` takes, from the committed viewport. */
	get frame(): BeginFrameOptions {
		return { viewport: this.logical, ratio: this.committed.ratio };
	}

	/** Returns the function that removes the listener. */
	onChange(listener: ViewportListener): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) this.listeners.splice(index, 1);
		};
	}

	/**
	 * Applies a pending measurement: backing store first, then listeners.
	 * Called at the top of each frame; true when the viewport changed.
	 */
	commit(): boolean {
		const next = this.pending;
		this.pending = null;
		if (!next || sameViewport(next, this.committed)) return false;
		this.committed = next;
		this.applyBackingStore(next);
		for (const listener of [...this.listeners]) listener(next);
		return true;
	}

	dispose(): void {
		this.observer?.disconnect();
		this.resolution?.removeEventListener('change', this.handleResolutionChange);
		this.resolution = null;
		this.listeners.length = 0;
	}

	// -- measurement --------------------------------------------------------

	private get dpr(): number {
		return this.platform.devicePixelRatio || 1;
	}

	private fromCss(cssWidth: number, cssHeight: number, dpr: number): ViewportState {
		return resolveViewport({
			framebufferWidth: devicePixelsFromCss(cssWidth, dpr),
			framebufferHeight: devicePixelsFromCss(cssHeight, dpr),
			dpr,
			uiScale: this.uiScale,
		});
	}

	private applyBackingStore(viewport: ViewportState): void {
		if (this.canvas.width !== viewport.framebufferWidth) this.canvas.width = viewport.framebufferWidth;
		if (this.canvas.height !== viewport.framebufferHeight) this.canvas.height = viewport.framebufferHeight;
	}

	private observe(): ResizeObserver | null {
		const Observer = this.platform.ResizeObserver;
		if (!Observer) return null;
		const observer = new Observer(this.handleResize);
		const target = this.canvas as unknown as Element;
		try {
			observer.observe(target, { box: 'device-pixel-content-box' });
			this.exactDevicePixels = true;
		} catch {
			// WebKit rejects the box it does not implement.
			observer.observe(target, { box: 'content-box' });
		}
		return observer;
	}

	private handleResize = (entries: ResizeObserverEntry[]): void => {
		const entry = entries[entries.length - 1];
		if (!entry) return;
		const css = entry.contentBoxSize?.[0];
		const cssWidth = css ? css.inlineSize : entry.contentRect.width;
		const cssHeight = css ? css.blockSize : entry.contentRect.height;
		const device = this.exactDevicePixels ? entry.devicePixelContentBoxSize?.[0] : undefined;
		this.propose(cssWidth, cssHeight, device ? { width: device.inlineSize, height: device.blockSize } : null);
	};

	/**
	 * The device-pixel box is trusted only when it agrees with the CSS box at
	 * the current `devicePixelRatio`, to within a pixel of rounding. Chromium
	 * reports it from the compositor's real scale factor, and emulation
	 * (Playwright's `deviceScaleFactor`, DevTools device mode) changes
	 * `devicePixelRatio` without changing that: headless at a forced ratio of
	 * 2 reports a device box equal to the CSS box, and a headed Retina window
	 * forced to 1 reports twice it. Either way `fb / dpr` would stop being the
	 * CSS size the screens still lay out in, so the CSS size times the ratio,
	 * rounded, wins.
	 */
	private propose(cssWidth: number, cssHeight: number, device: { width: number; height: number } | null): void {
		const dpr = this.dpr;
		if (
			device !== null
			&& Math.abs(device.width - cssWidth * dpr) <= 1
			&& Math.abs(device.height - cssHeight * dpr) <= 1
		) {
			this.pending = resolveViewport({
				framebufferWidth: Math.max(1, device.width),
				framebufferHeight: Math.max(1, device.height),
				dpr,
				uiScale: this.uiScale,
			});
		} else {
			this.pending = this.fromCss(cssWidth, cssHeight, dpr);
		}
		this.announcePending();
	}

	/**
	 * R7.3 lets a change wait for the next frame, but the observer runs after
	 * this frame's rAF callbacks, so waiting for the loop would present one
	 * frame of the old backing store stretched over the new box on every
	 * resize step. `onPending` lets the page run that next frame now, before
	 * paint.
	 */
	private announcePending(): void {
		if (this.pending && !sameViewport(this.pending, this.committed)) this.onPending?.();
	}

	private watchResolution(): void {
		this.resolution?.removeEventListener('change', this.handleResolutionChange);
		this.resolution = this.platform.matchMedia(`(resolution: ${this.dpr}dppx)`);
		this.resolution.addEventListener('change', this.handleResolutionChange);
	}

	/**
	 * The ratio changed. Browser zoom changes it without changing the device
	 * pixels, which the device-pixel box does not report, so the last known
	 * device pixels are offered again and checked against the CSS box at the
	 * new ratio the same way an observer entry is.
	 */
	private handleResolutionChange = (): void => {
		const base = this.pending ?? this.committed;
		const device = this.exactDevicePixels
			? { width: base.framebufferWidth, height: base.framebufferHeight }
			: null;
		this.watchResolution();
		this.propose(this.canvas.clientWidth, this.canvas.clientHeight, device);
	};
}
