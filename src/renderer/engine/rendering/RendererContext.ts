import { DrawApi } from '../draw';
import { Renderer } from './Renderer';

/**
 * Singleton that provides access to the global renderer instance
 * This allows components to access the renderer without having to pass it around
 */
export class RendererContext {
	private static instance: RendererContext;
	private renderer: Renderer | null = null;
	private drawApi: DrawApi | null = null;

	private constructor() {
		// Private constructor to enforce singleton pattern
	}

	/**
	 * Get the singleton instance of the RendererContext
	 */
	public static getInstance(): RendererContext {
		if (!RendererContext.instance) {
			RendererContext.instance = new RendererContext();
		}
		return RendererContext.instance;
	}

	/**
	 * Set the global renderer instance
	 * @param renderer The renderer to use
	 */
	public setRenderer(renderer: Renderer): void {
		this.renderer = renderer;
	}

	/**
	 * Get the global renderer instance
	 * @returns The renderer instance
	 * @throws Error if the renderer has not been set
	 *
	 * Kept alongside `draw` because two callers still need the device itself:
	 * both bootstraps build a `Shader` from `getContext()`, and `Input` measures
	 * a caret through `getFontAtlas()` until chapter 6's `measureText` exists.
	 * Nothing else outside `LegacyGLBackend` touches it.
	 */
	public getRenderer(): Renderer {
		if (!this.renderer) {
			throw new Error('Renderer not initialized. Call setRenderer first.');
		}
		return this.renderer;
	}

	/** How every component reaches GL: the draw API of chapter 2, never a backend. */
	public get draw(): DrawApi {
		if (!this.drawApi) {
			throw new Error('Draw API not initialized. Set RendererContext.getInstance().draw first.');
		}
		return this.drawApi;
	}

	public set draw(api: DrawApi) {
		this.drawApi = api;
	}
}
