import { DrawApi } from '../draw';

/**
 * Singleton that hands components the draw API, so they can draw and measure
 * without having it passed down the tree.
 */
export class RendererContext {
	private static instance: RendererContext;
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

	/** Whether `draw` is set. A component built before the draw API exists (a unit test's tree) checks this rather than catching. */
	public get hasDraw(): boolean {
		return this.drawApi !== null;
	}
}
