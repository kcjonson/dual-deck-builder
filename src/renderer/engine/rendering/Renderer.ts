import { FontAtlas } from './FontAtlas';

/**
 * R15.2's context attributes, with one measured departure.
 *
 * `antialias` stays true. R15.2 and R5.29 want the context without MSAA
 * because anti-aliasing is analytic under the uber shader, but the legacy
 * program has no analytic edges and leans on the drawing buffer's
 * multisampling. Measured: with it off, 12 of the 13 committed chromium goldens
 * and the unbaselined primitive-shapes scene change (only `scene-rectangles`,
 * all axis-aligned whole pixels, holds). It turns off with DDB-64, in the
 * commit that makes coverage analytic and re-mints the goldens for that
 * reason.
 *
 * Everything else is R15.2 as written. `alpha` and `premultipliedAlpha` are
 * the defaults, spelled out so the next reader does not have to know that.
 * `powerPreference: 'high-performance'` selects the discrete GPU on a
 * dual-GPU Mac, whose output differs from the integrated one; CI's SwiftShader
 * has one device, so the goldens cannot see it, but a local byte comparison
 * against a build without it has to account for it.
 */
export const CONTEXT_ATTRIBUTES: Readonly<WebGLContextAttributes> = {
	alpha: true,
	premultipliedAlpha: true,
	antialias: true,
	depth: false,
	stencil: false,
	preserveDrawingBuffer: false,
	powerPreference: 'high-performance',
};

export interface ContextListener {
	/** The context is gone: stop the frame loop, issue nothing (R15.5). */
	lost?(): void;
	/** A new context: recreate every GPU resource from its CPU-side description, then resume. */
	restored?(): void;
}

/**
 * The device: a canvas, its WebGL2 context, the resize handler that keeps the
 * drawing buffer and the viewport in step, context loss, and the font atlas.
 *
 * It draws nothing and owns no pipeline state; `WebGL2Backend` does, and
 * listens here for a restored context so it can rebuild. The order on restore
 * is fixed: the viewport and the atlas texture first (they are this class's),
 * then the listeners in the order they registered, so a backend constructed
 * before the frame loop has its resources back before the loop resumes.
 */
export class Renderer {
	readonly canvas: HTMLCanvasElement;
	private readonly gl: WebGL2RenderingContext;
	private readonly fontAtlas: FontAtlas;
	private readonly listeners: ContextListener[] = [];
	private lost = false;

	constructor(canvasId: string) {
		const canvas = document.getElementById(canvasId) as HTMLCanvasElement | null;
		if (!canvas) {
			throw new Error(`Canvas element with id ${canvasId} not found`);
		}
		this.canvas = canvas;

		const gl = canvas.getContext('webgl2', CONTEXT_ATTRIBUTES);
		if (!gl) {
			// R15.1: there is no WebGL1 path. R15.5: an Electron build whose GPU
			// process crashed repeatedly has 3D APIs blocked for the origin, and
			// the page says so rather than showing a black canvas.
			const message = 'This game needs WebGL2, and the browser did not provide it. '
				+ 'Hardware acceleration may be off, or blocked after a graphics driver crash.';
			showGpuStatus(message);
			throw new Error(message);
		}
		this.gl = gl;
		// R15.2: token colours are sRGB and never reinterpreted as Display P3.
		gl.drawingBufferColorSpace = 'srgb';

		this.resize();
		window.addEventListener('resize', this.resize);
		canvas.addEventListener('webglcontextlost', this.handleContextLost);
		canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

		this.fontAtlas = new FontAtlas(this.gl, 'Arial', 32);
	}

	/** True between `webglcontextlost` and `webglcontextrestored`. */
	get contextLost(): boolean {
		return this.lost;
	}

	/** Returns the function that removes the listener. */
	addContextListener(listener: ContextListener): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index >= 0) this.listeners.splice(index, 1);
		};
	}

	public getContext(): WebGL2RenderingContext {
		return this.gl;
	}

	/** Text measurement for `Input`'s caret, until chapter 6's `measureText`. */
	public getFontAtlas(): FontAtlas {
		return this.fontAtlas;
	}

	/**
	 * The drawing buffer follows the window at the device pixel ratio; the
	 * logical viewport (and so the projection) is the frame's, set by
	 * `DrawApi.beginFrame`. R15.4's `ResizeObserver` sizing is not here yet:
	 * it changes how the backing store rounds at fractional ratios, which is a
	 * pixel change of its own.
	 */
	private resize = (): void => {
		const dpr = window.devicePixelRatio || 1;
		const displayWidth = window.innerWidth;
		const displayHeight = window.innerHeight;

		this.canvas.width = displayWidth * dpr;
		this.canvas.height = displayHeight * dpr;
		this.canvas.style.width = displayWidth + 'px';
		this.canvas.style.height = displayHeight + 'px';

		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
	};

	private handleContextLost = (event: Event): void => {
		// Without preventDefault the browser never offers a restore.
		event.preventDefault();
		this.lost = true;
		showGpuStatus('The graphics device was lost. Waiting for it to come back.');
		for (const listener of [...this.listeners]) listener.lost?.();
	};

	private handleContextRestored = (): void => {
		this.lost = false;
		this.gl.drawingBufferColorSpace = 'srgb';
		this.resize();
		// The status line stays up until every rebuild has succeeded: a rebuild
		// that throws (a compile failure on the new device, or the context lost
		// again mid-restore) leaves the loop stopped, and the page has to say so.
		try {
			this.fontAtlas.upload();
			for (const listener of [...this.listeners]) listener.restored?.();
		} catch (error) {
			showGpuStatus('The graphics device came back, but the game could not rebuild on it. Reload the page to try again.');
			throw error;
		}
		showGpuStatus(null);
	};
}

const GPU_STATUS_ID = 'gpu-status';

/**
 * A DOM line over the canvas saying why nothing is drawing, or null to remove
 * it. Both pages share it through `Renderer`, so neither bootstrap has to
 * remember to.
 */
function showGpuStatus(message: string | null): void {
	let element = document.getElementById(GPU_STATUS_ID);
	if (message === null) {
		element?.remove();
		return;
	}
	if (!element) {
		element = document.createElement('div');
		element.id = GPU_STATUS_ID;
		element.setAttribute('role', 'alert');
		Object.assign(element.style, {
			position: 'fixed',
			inset: '0',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			padding: '32px',
			textAlign: 'center',
			background: '#000',
			color: '#fff',
			font: '20px Arial, sans-serif',
			zIndex: '200',
		});
		document.body.appendChild(element);
	}
	element.textContent = message;
}
