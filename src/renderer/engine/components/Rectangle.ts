import { Component } from './Component';
import { RendererContext } from '../rendering/RendererContext';

/**
 * Rectangle component for rendering rectangles
 */
export class Rectangle extends Component {
	private fillColor: [number, number, number, number] = [1, 1, 1, 1];
	private borderColor: [number, number, number, number] | null = null;
	private borderWidth = 0;
	private cornerRadius = 0;

	/**
	 * Create a new rectangle
	 * @param id Unique identifier for this component
	 */
	constructor(id: string) {
		super(id);
	}

	/**
	 * Set the fill color of the rectangle
	 * @param color RGBA color array [r, g, b, a] with values from 0-1
	 */
	public setFillColor(color: [number, number, number, number]): this {
		this.fillColor = color;
		return this;
	}

	/**
	 * Set the border color of the rectangle
	 * @param color RGBA color array [r, g, b, a] with values from 0-1
	 */
	public setBorderColor(color: [number, number, number, number] | null): this {
		this.borderColor = color;
		return this;
	}

	/**
	 * Set the border width of the rectangle
	 * @param width Border width in pixels
	 */
	public setBorderWidth(width: number): this {
		this.borderWidth = width;
		return this;
	}

	/**
	 * Set the corner radius of the rectangle
	 * @param radius Corner radius in pixels
	 */
	public setCornerRadius(radius: number): this {
		this.cornerRadius = radius;
		return this;
	}

	/**
	 * Render the rectangle
	 */
	public render(): void {
		if (!this.visible) return;

		// Get the renderer instance
		const renderer = RendererContext.getInstance().getRenderer();

		// Draw the rectangle fill
		renderer.drawRectangle(this.x, this.y, this.width, this.height, this.fillColor);

		// If there is a border, draw it as four lines
		if (this.borderColor && this.borderWidth > 0) {
			const x = this.x;
			const y = this.y;
			const w = this.width;
			const h = this.height;

			// Draw top border
			renderer.drawLine(x, y, x + w, y, this.borderColor, this.borderWidth);

			// Draw right border
			renderer.drawLine(x + w, y, x + w, y + h, this.borderColor, this.borderWidth);

			// Draw bottom border
			renderer.drawLine(x + w, y + h, x, y + h, this.borderColor, this.borderWidth);

			// Draw left border
			renderer.drawLine(x, y + h, x, y, this.borderColor, this.borderWidth);
		}

		// Render children
		for (const child of this.children) {
			if (child.isVisible()) {
				child.render();
			}
		}
	}
}
