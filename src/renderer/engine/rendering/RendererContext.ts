import { Renderer } from './Renderer';

/**
 * Singleton that provides access to the global renderer instance
 * This allows components to access the renderer without having to pass it around
 */
export class RendererContext {
  private static instance: RendererContext;
  private renderer: Renderer | null = null;

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
   */
  public getRenderer(): Renderer {
    if (!this.renderer) {
      throw new Error('Renderer not initialized. Call setRenderer first.');
    }
    return this.renderer;
  }
}
