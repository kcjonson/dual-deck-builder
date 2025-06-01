import { Interactive } from '../input/InputSystem';
import { Style, ComponentOptions } from '../types/Style';

/**
 * Base Component class that all components will inherit from
 */
export abstract class Component implements Interactive {
	protected x = 0;
	protected y = 0;
	protected width = 0;
	protected height = 0;
	protected visible = true;
	protected parent: Component | null = null;
	protected children: Component[] = [];
	protected componentType: string = 'Component';

	/**
	 * Create a new component
	 * @param options Optional configuration options
	 */
	constructor(options?: ComponentOptions) {
		if (options?.style) {
			this.applyStyle(options.style);
		}
	}

	/**
	 * Apply style properties to the component
	 */
	protected applyStyle(style: Style): void {
		// Position and size
		if (style.left !== undefined) this.x = this.parseSize(style.left);
		if (style.top !== undefined) this.y = this.parseSize(style.top);
		if (style.width !== undefined) this.width = this.parseSize(style.width);
		if (style.height !== undefined) this.height = this.parseSize(style.height);
		
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
	 * Set the component's position
	 */
	public setPosition(x: number, y: number): this {
		this.x = x;
		this.y = y;
		return this;
	}

	/**
	 * Set the component's size
	 */
	public setSize(width: number, height: number): this {
		this.width = width;
		this.height = height;
		return this;
	}

	/**
	 * Set the component's visibility
	 */
	public setVisible(visible: boolean): this {
		this.visible = visible;
		return this;
	}

	/**
	 * Get the component's x position
	 */
	public getX(): number {
		return this.x;
	}

	/**
	 * Get the component's y position
	 */
	public getY(): number {
		return this.y;
	}

	/**
	 * Get the component's width
	 */
	public getWidth(): number {
		return this.width;
	}

	/**
	 * Get the component's height
	 */
	public getHeight(): number {
		return this.height;
	}

	/**
	 * Get whether the component is visible
	 */
	public isVisible(): boolean {
		return this.visible;
	}

	/**
	 * Add a child component
	 */
	public addChild(child: Component): this {
		child.parent = this;
		this.children.push(child);
		return this;
	}

	/**
	 * Remove a child component
	 */
	public removeChild(child: Component): boolean {
		const index = this.children.indexOf(child);
		if (index !== -1) {
			this.children[index].parent = null;
			this.children.splice(index, 1);
			return true;
		}
		return false;
	}

	/**
	 * Get all child components
	 */
	public getChildren(): Component[] {
		return this.children;
	}

	/**
	 * Get parent component
	 */
	public getParent(): Component | null {
		return this.parent;
	}

	/**
	 * Check if a point is inside this component
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
	 * Clean up resources and event handlers
	 * This should be called when a component is permanently removed
	 * Override in subclasses to implement specific cleanup behavior
	 */
	public cleanup(): void {
		// Clean up children
		for (const child of this.children) {
			child.cleanup();
		}
	}

	/**
	 * Render method to draw the component
	 * This should be implemented by each subclass
	 */
	public abstract render(): void;
}
