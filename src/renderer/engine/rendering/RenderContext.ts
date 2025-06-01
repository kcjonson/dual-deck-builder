/**
 * Context passed down through the render hierarchy for coordinate transformation
 */
export interface RenderContext {
	/**
	 * Accumulated X offset from all parent containers
	 */
	offsetX: number;

	/**
	 * Accumulated Y offset from all parent containers
	 */
	offsetY: number;

	// Future: scale, rotation, clipping bounds
}

/**
 * Default render context for root-level rendering
 */
export const DEFAULT_RENDER_CONTEXT: RenderContext = {
	offsetX: 0,
	offsetY: 0,
};
