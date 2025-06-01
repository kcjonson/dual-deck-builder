import { RendererContext } from '../rendering/RendererContext';
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
}

/**
 * Layer component for grouping and organizing other components
 * This is the base class for all visual elements
 */
export class Layer {
	protected x = 0;
	protected y = 0;
	protected width = 0;
	protected height = 0;
	protected visible = true;
	protected children: Layer[] = [];
	protected componentType = 'Layer';
	private backgroundColor: [number, number, number, number] | null = null;

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
		this.width = width;
		this.height = height;
		return this;
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
	 * Add a child layer
	 */
	public addChild(child: Layer): this {
		this.children.push(child);
		return this;
	}

	/**
	 * Remove a child layer
	 */
	public removeChild(child: Layer): boolean {
		const index = this.children.indexOf(child);
		if (index !== -1) {
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
	 */
	public containsPoint(x: number, y: number): boolean {
		return x >= this.x && x <= this.x + this.width && y >= this.y && y <= this.y + this.height;
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
	 */
	public render(): void {
		if (!this.visible) return;

		// If the layer has a background color, render the background
		if (this.backgroundColor && this.width > 0 && this.height > 0) {
			// Get the renderer instance
			const renderer = RendererContext.getInstance().getRenderer();

			// Draw the background rectangle
			renderer.drawRectangle(this.x, this.y, this.width, this.height, this.backgroundColor);
		}

		// Render all children
		for (const child of this.children) {
			if (child.isVisible()) {
				child.render();
			}
		}
	}
}
