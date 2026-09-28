import { TextureStore } from '../gpu/TextureStore';
import { CanvasViewport } from './CanvasViewport';
import { DeviceInfo, detectDevice } from './deviceInfo';
import { FontAtlas } from './FontAtlas';
import { WebGL2TextureDevice } from './WebGL2TextureDevice';

/**
 * R15.2's context attributes.
 *
 * `antialias` is off (R5.29): the uber shader's coverage is analytic (R5.6),
 * so every edge is anti-aliased in the fragment stage and multisampling would
 * only cost memory and bandwidth. Polygons, which have no SDF, get R5.17's
 * CPU feather ring instead.
 *
 * `alpha` and `premultipliedAlpha` are the defaults, spelled out because the
 * shader's output is premultiplied (R5.22) and the page composites the canvas
 * as such.
 * `powerPreference: 'high-performance'` selects the discrete GPU on a
 * dual-GPU Mac, whose output differs from the integrated one; CI's SwiftShader
 * has one device, so the goldens cannot see it, but a local byte comparison
 * against a build without it has to account for it.
 */
export const CONTEXT_ATTRIBUTES: Readonly<WebGLContextAttributes> = {
	alpha: true,
	premultipliedAlpha: true,
	antialias: false,
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
 * The device: a canvas, its WebGL2 context, the viewport that sizes it, the
 * texture store, context loss, and the font atlas.
 *
 * It draws nothing and owns no pipeline state; `WebGL2Backend` does, and
 * listens here for a restored context so it can rebuild. The order on restore
 * is fixed: the drawing-buffer viewport and every texture first (they are this
 * class's, and the immediate ones, the atlas among them, are back before the
 * restore returns), then the listeners in the order they registered, so a
 * backend constructed before the frame loop has its resources back before the
 * loop resumes.
 */
export class Renderer {
	readonly canvas: HTMLCanvasElement;
	/** R7.11's single viewport owner; the pages commit it at the top of each frame. */
	readonly viewport: CanvasViewport;
	/** R5.30's resource layer. The backend creates through it; components hold its handles. */
	readonly textures: TextureStore<WebGLTexture>;
	/** R15.3, detected once. */
	readonly device: DeviceInfo;
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

		this.device = detectDevice(gl);

		this.viewport = new CanvasViewport({ canvas });
		this.applyDrawingBufferViewport();
		// First listener, so the GL viewport matches the new backing store
		// before anything else hears about it.
		this.viewport.onChange(this.applyDrawingBufferViewport);
		canvas.addEventListener('webglcontextlost', this.handleContextLost);
		canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

		this.textures = new TextureStore({
			device: new WebGL2TextureDevice({ gl }),
			onDiagnostic: (message) => console.error(`TextureStore: ${message}`),
		});
		this.fontAtlas = new FontAtlas({
			textures: this.textures,
			fontFamily: 'Arial',
			fontSize: 32,
			ratio: this.viewport.state.ratio,
		});
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

	/** The GL viewport covers the whole backing store `CanvasViewport` sized. */
	private applyDrawingBufferViewport = (): void => {
		const { framebufferWidth, framebufferHeight } = this.viewport.state;
		this.gl.viewport(0, 0, framebufferWidth, framebufferHeight);
	};

	private handleContextLost = (event: Event): void => {
		// Without preventDefault the browser never offers a restore.
		event.preventDefault();
		this.lost = true;
		this.textures.lose();
		showGpuStatus('The graphics device was lost. Waiting for it to come back.');
		for (const listener of [...this.listeners]) listener.lost?.();
	};

	private handleContextRestored = (): void => {
		this.lost = false;
		this.gl.drawingBufferColorSpace = 'srgb';
		this.applyDrawingBufferViewport();
		// The status line stays up until every rebuild has succeeded: a rebuild
		// that throws (a compile failure on the new device, or the context lost
		// again mid-restore) leaves the loop stopped, and the page has to say so.
		try {
			this.textures.restore();
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
