import { mat4 } from 'gl-matrix';
import { Shader } from './Shader';
import { FontAtlas } from './FontAtlas';

/**
 * The device: a canvas, a GL context, the resize handler that keeps the
 * drawing buffer and the projection in step, and the font atlas.
 *
 * It draws nothing. Every drawing method it used to have moved into
 * `LegacyGLBackend`, behind the `DrawBackend` seam, so a component reaches GL
 * through `DrawApi` and there is no second spelling of a rectangle for a screen
 * to find by autocomplete. The three accessors below exist for the backend,
 * which needs the shader it is drawing with and the matrices the text flush
 * uploads.
 */
export class Renderer {
	private canvas: HTMLCanvasElement;
	private gl: WebGLRenderingContext;
	private currentShader: Shader | null = null;
	private projectionMatrix: mat4;
	private viewMatrix: mat4;
	private fontAtlas: FontAtlas | null = null;
	private handleResize: () => void;

	constructor(canvasId: string) {
		this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
		if (!this.canvas) {
			throw new Error(`Canvas element with id ${canvasId} not found`);
		}

		this.gl = this.canvas.getContext('webgl') as WebGLRenderingContext;
		if (!this.gl) {
			throw new Error('WebGL not supported by this browser');
		}

		// Initialize matrices
		this.projectionMatrix = mat4.create();
		this.viewMatrix = mat4.create();
		mat4.identity(this.viewMatrix);

		// Now that matrices are initialized, we can resize
		this.resize();

		// Bind resize handler - use bind to ensure consistent context
		this.handleResize = this.resize.bind(this);
		window.addEventListener('resize', this.handleResize);

		// Set default WebGL state
		this.gl.enable(this.gl.BLEND);
		this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
		this.gl.clearColor(0.0, 0.0, 0.0, 1.0);

		// Initialize font atlas with larger default size
		this.fontAtlas = new FontAtlas(this.gl, 'Arial', 32);
	}

	/**
	 * Resize canvas and viewport when window size changes
	 */
	private resize(): void {
		// Get the device pixel ratio (typically 1 on standard displays, 2 on retina)
		const dpr = window.devicePixelRatio || 1;

		// Get the display size (CSS pixels)
		const displayWidth = window.innerWidth;
		const displayHeight = window.innerHeight;

		// Set the internal size to include the device pixel ratio
		this.canvas.width = displayWidth * dpr;
		this.canvas.height = displayHeight * dpr;

		// Set the display size (CSS pixels)
		this.canvas.style.width = displayWidth + 'px';
		this.canvas.style.height = displayHeight + 'px';

		// Set the viewport to match the internal size
		this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);

		// Update projection matrix - use display size for coordinate system
		// This ensures our coordinate system matches CSS pixels, not physical pixels
		mat4.ortho(
			this.projectionMatrix,
			0, // left
			displayWidth, // right (use display size, not canvas size)
			displayHeight, // bottom (flipped for screen coordinates)
			0, // top
			-1.0, // near
			1.0, // far
		);

		// Update the projection matrix in the current shader if one is active
		// This ensures the shader uses the new dimensions after resize
		if (this.currentShader) {
			this.currentShader.setMatrix4('uProjectionMatrix', this.projectionMatrix);
		}

	}

	/**
	 * Clear the canvas with the current clear color
	 */
	public clear(): void {
		this.gl.clear(this.gl.COLOR_BUFFER_BIT);
	}

	/**
	 * Use a shader program for subsequent draw calls
	 */
	public useShader(shader: Shader): void {
		if (this.currentShader !== shader) {
			shader.use();
			this.currentShader = shader;

			// Set current projection and view matrices in shader
			shader.setMatrix4('uProjectionMatrix', this.projectionMatrix);
			shader.setMatrix4('uViewMatrix', this.viewMatrix);
		}
	}

	/** The shader `useShader` bound, for the backend that draws with it. */
	public get shader(): Shader | null {
		return this.currentShader;
	}

	/** Logical pixels to clip space, rebuilt on every resize. */
	public get projection(): mat4 {
		return this.projectionMatrix;
	}

	public get view(): mat4 {
		return this.viewMatrix;
	}

	/**
	 * Get the WebGL rendering context
	 */
	public getContext(): WebGLRenderingContext {
		return this.gl;
	}

	/**
	 * Get the font atlas for text measurement
	 */
	public getFontAtlas(): FontAtlas | null {
		return this.fontAtlas;
	}
}
