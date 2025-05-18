import { Component } from './Component';
import { RendererContext } from '../rendering/RendererContext';

/**
 * Layer component for grouping and organizing other components
 */
export class Layer extends Component {
	private backgroundColor: [number, number, number, number] | null = null;

	/**
	 * Create a new layer
	 * @param id Unique identifier for this component
	 */
	constructor(id: string) {
		super(id);
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
