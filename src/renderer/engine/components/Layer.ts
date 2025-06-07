import { RendererContext } from '../rendering/RendererContext';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { Style } from '../types/Style';

/**
 * Layer creation options
 */
export interface LayerOptions {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	visible?: boolean;
	style?: Style;
	overflow?: 'visible' | 'hidden'; // Only valid when width and height are set
}

/**
 * Layer component for grouping and organizing other components
 * This is the base class for all visual elements
 */
export class Layer {
	public x = 0;
	public y = 0;
	public width = 0;
	public height = 0;
	protected visible = true;
	protected children: Layer[] = [];
	protected componentType = 'Layer';
	protected parent: Layer | null = null;
	private backgroundColor: [number, number, number, number] | null = null;
	private overflow: 'visible' | 'hidden' = 'visible';

	/**
	 * Create a new layer
	 * @param options Optional configuration including position, size, and style
	 */
	constructor(options?: LayerOptions) {
		// Apply direct properties
		if (options) {
			if (options.x !== undefined) this.x = options.x;
			if (options.y !== undefined) this.y = options.y;
			if (options.width !== undefined) this.width = options.width;
			if (options.height !== undefined) this.height = options.height;
			if (options.visible !== undefined) this.visible = options.visible;
			
			// Handle overflow property with validation
			if (options.overflow !== undefined) {
				if (this.width <= 0 || this.height <= 0) {
					console.warn('Layer: overflow property requires both width and height to be set');
				} else {
					this.overflow = options.overflow;
				}
			}
		}

		// Apply style properties
		if (options?.style) {
			this.applyStyle(options.style);
		}
	}

	/**
	 * Apply style properties to the layer
	 */
	protected applyStyle(style: Style): void {
		// Visibility
		if (style.visibility !== undefined) {
			this.visible = style.visibility === 'visible';
		}
		if (style.display !== undefined) {
			this.visible = style.display !== 'none';
		}
	}

	/**
	 * Helper to parse size values
	 */
	protected parseSize(size: string | number): number {
		if (typeof size === 'number') return size;
		if (typeof size === 'string' && size.endsWith('px')) {
			return parseFloat(size.slice(0, -2));
		}
		return parseFloat(size as string) || 0;
	}

	/**
	 * Get the component type (for filtering/identification)
	 */
	public getComponentType(): string {
		return this.componentType;
	}

	/**
	 * Set the layer's x position
	 */
	public setX(x: number): this {
		this.x = x;
		return this;
	}

	/**
	 * Set the layer's y position
	 */
	public setY(y: number): this {
		this.y = y;
		return this;
	}

	/**
	 * Set both x and y position (convenience method)
	 */
	public setPosition(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	/**
	 * Set the layer's width
	 */
	public setWidth(width: number): this {
		this.width = width;
		return this;
	}

	/**
	 * Set the layer's height
	 */
	public setHeight(height: number): this {
		this.height = height;
		return this;
	}

	/**
	 * Set both width and height (convenience method)
	 */
	public setSize(width: number, height: number): this {
		const oldWidth = this.width;
		const oldHeight = this.height;
		this.width = width;
		this.height = height;
		
		// Call onResized if dimensions actually changed
		if (oldWidth !== width || oldHeight !== height) {
			this.onResized();
		}
		
		return this;
	}
	
	/**
	 * Called when the layer is resized
	 * Override this in subclasses to handle resize events
	 */
	protected onResized(): void {
		// Default implementation does nothing
		// Subclasses can override to update child components
	}

	/**
	 * Set the layer's visibility
	 */
	public setVisible(visible: boolean): this {
		this.visible = visible;
		return this;
	}

	/**
	 * Get the layer's x position
	 */
	public getX(): number {
		return this.x;
	}

	/**
	 * Get the layer's y position
	 */
	public getY(): number {
		return this.y;
	}

	/**
	 * Get the layer's width
	 */
	public getWidth(): number {
		return this.width;
	}

	/**
	 * Get the layer's height
	 */
	public getHeight(): number {
		return this.height;
	}

	/**
	 * Get whether the layer is visible
	 */
	public isVisible(): boolean {
		return this.visible;
	}

	/**
	 * Set the overflow behavior
	 * @param overflow 'visible' or 'hidden' - requires width and height to be set
	 */
	public setOverflow(overflow: 'visible' | 'hidden'): this {
		if (this.width <= 0 || this.height <= 0) {
			console.warn('Layer: overflow property requires both width and height to be set');
			return this;
		}
		this.overflow = overflow;
		return this;
	}

	/**
	 * Get the overflow behavior
	 */
	public getOverflow(): 'visible' | 'hidden' {
		return this.overflow;
	}

	/**
	 * Add a child layer
	 */
	public addChild(child: Layer): this {
		child.parent = this;
		this.children.push(child);
		return this;
	}

	/**
	 * Remove a child layer
	 */
	public removeChild(child: Layer): boolean {
		const index = this.children.indexOf(child);
		if (index !== -1) {
			child.parent = null;
			this.children.splice(index, 1);
			return true;
		}
		return false;
	}

	/**
	 * Get all child layers
	 */
	public getChildren(): Layer[] {
		return this.children;
	}

	/**
	 * Check if a point is inside this layer
	 * This method now properly handles coordinate transformation hierarchy
	 */
	public containsPoint(x: number, y: number): boolean {
		// Convert global coordinates to local coordinates
		const localPoint = this.globalToLocal(x, y);
		const contains =
			localPoint.x >= 0 &&
			localPoint.x <= this.width &&
			localPoint.y >= 0 &&
			localPoint.y <= this.height;


		return contains;
	}

	/**
	 * Convert global screen coordinates to local coordinates relative to this layer
	 */
	public globalToLocal(globalX: number, globalY: number): { x: number; y: number } {
		return this.calculateLocalCoordinates(globalX, globalY);
	}

	/**
	 * Convert local coordinates to global screen coordinates
	 */
	public localToGlobal(localX: number, localY: number): { x: number; y: number } {
		return this.calculateGlobalCoordinates(localX, localY);
	}

	/**
	 * Calculate local coordinates by walking up the parent chain
	 */
	private calculateLocalCoordinates(globalX: number, globalY: number): { x: number; y: number } {
		// Start with global coordinates
		let localX = globalX;
		let localY = globalY;

		// Subtract this layer's offset
		localX -= this.x;
		localY -= this.y;

		// Recursively subtract parent offsets
		if (this.parent) {
			const parentLocal = this.parent.globalToLocal(globalX, globalY);
			return { x: parentLocal.x - this.x, y: parentLocal.y - this.y };
		}

		return { x: localX, y: localY };
	}

	/**
	 * Calculate global coordinates by walking up the parent chain
	 */
	private calculateGlobalCoordinates(localX: number, localY: number): { x: number; y: number } {
		// Start with local coordinates plus this layer's offset
		let globalX = localX + this.x;
		let globalY = localY + this.y;

		// Add parent's global position
		if (this.parent) {
			const parentGlobal = this.parent.localToGlobal(0, 0);
			globalX += parentGlobal.x;
			globalY += parentGlobal.y;
		}

		return { x: globalX, y: globalY };
	}

	/**
	 * Update method for game logic
	 * @param dt Time since last update in seconds
	 */
	public update(dt: number): void {
		// Update children
		for (const child of this.children) {
			child.update(dt);
		}
	}

	/**
	 * Layout method called when the layer needs to position its children
	 * Override in subclasses to implement specific layout behavior
	 */
	public layout(): void {
		// Layout children recursively
		for (const child of this.children) {
			child.layout();
		}
	}

	/**
	 * Clean up resources and event handlers
	 * This should be called when a layer is permanently removed
	 * Override in subclasses to implement specific cleanup behavior
	 */
	public cleanup(): void {
		// Clean up children
		for (const child of this.children) {
			child.cleanup();
		}
	}

	/**
	 * Set the background color of the layer
	 * @param color RGBA color array [r, g, b, a] with values from 0-1
	 */
	public setBackgroundColor(color: [number, number, number, number] | null): this {
		this.backgroundColor = color;
		return this;
	}

	/**
	 * Get the background color of the layer
	 */
	public getBackgroundColor(): [number, number, number, number] | null {
		return this.backgroundColor;
	}

	/**
	 * Render the layer and all its children
	 * @param context Optional render context with coordinate transforms
	 */
	public render(context?: RenderContext): void {
		if (!this.visible) return;

		// Use default context if none provided (root level)
		const ctx = context || DEFAULT_RENDER_CONTEXT;

		// Calculate screen position by adding local position to context offset
		const screenX = ctx.offsetX + this.x;
		const screenY = ctx.offsetY + this.y;

		// If the layer has a background color, render the background
		if (this.backgroundColor && this.width > 0 && this.height > 0) {
			// Get the renderer instance
			const renderer = RendererContext.getInstance().getRenderer();

			// Draw the background rectangle at screen position
			renderer.drawRectangle(screenX, screenY, this.width, this.height, this.backgroundColor);
		}

		// Handle overflow clipping with scissor testing
		const renderer = RendererContext.getInstance().getRenderer();
		let wasScissorEnabled = false;
		let previousScissorBox: Int32Array | null = null;

		if (this.overflow === 'hidden' && this.width > 0 && this.height > 0) {
			// Save current scissor state
			wasScissorEnabled = renderer.isScissorEnabled();
			if (wasScissorEnabled) {
				previousScissorBox = renderer.getContext().getParameter(renderer.getContext().SCISSOR_BOX);
			}

			// Convert from top-left UI coordinates to bottom-left WebGL coordinates
			const canvas = renderer.getContext().canvas as HTMLCanvasElement;
			const dpr = window.devicePixelRatio || 1;
			
			// Apply device pixel ratio to get actual pixel coordinates
			const webglX = Math.floor(screenX * dpr);
			const webglY = Math.floor((canvas.height / dpr - screenY - this.height) * dpr);
			const webglWidth = Math.floor(this.width * dpr);
			const webglHeight = Math.floor(this.height * dpr);

			// Enable scissor testing for this layer (auto-flushes text if needed)
			renderer.enableScissor(webglX, webglY, webglWidth, webglHeight);
		}

		// Create child context with our position added
		const childContext: RenderContext = {
			offsetX: screenX,
			offsetY: screenY,
		};

		// Render all children with transformed context
		for (const child of this.children) {
			if (child.isVisible()) {
				child.render(childContext);
			}
		}

		// Restore previous scissor state
		if (this.overflow === 'hidden' && this.width > 0 && this.height > 0) {
			if (wasScissorEnabled && previousScissorBox) {
				// Restore previous scissor box (auto-flushes text if needed)
				renderer.enableScissor(
					previousScissorBox[0],
					previousScissorBox[1], 
					previousScissorBox[2],
					previousScissorBox[3]
				);
			} else {
				// Disable scissor testing (auto-flushes text if needed)
				renderer.disableScissor();
			}
		}
	}
}
