import { Component, ComponentOptions } from './Component';
import { RendererContext } from '../rendering/RendererContext';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { Style, StyleParser } from '../types/Style';

/**
 * Rectangle component for rendering rectangles
 */
export class Rectangle extends Component {
	protected fillColor: [number, number, number, number] = [1, 1, 1, 1];
	protected borderColor: [number, number, number, number] | null = null;
	protected borderWidth = 0;
	protected cornerRadius = 0;

	/**
	 * Create a new rectangle
	 * @param options Optional configuration including style
	 */
	constructor(options?: ComponentOptions) {
		super(options);
		this.componentType = 'Rectangle';

		if (options?.style) {
			this.applyRectangleStyle(options.style);
		}
	}

	/**
	 * Apply rectangle-specific style properties
	 */
	protected applyRectangleStyle(style: Style): void {
		if (style.backgroundColor !== undefined) {
			this.fillColor = StyleParser.parseColor(style.backgroundColor);
		}
		if (style.borderColor !== undefined) {
			this.borderColor = StyleParser.parseColor(style.borderColor);
		}
		if (style.borderWidth !== undefined) {
			this.borderWidth = this.parseSize(style.borderWidth);
		}
		if (style.borderRadius !== undefined) {
			this.cornerRadius = this.parseSize(style.borderRadius);
		}

		// Handle shorthand border property
		if (style.border !== undefined) {
			this.parseBorderShorthand(style.border);
		}
	}

	/**
	 * Parse border shorthand (e.g., "2px solid #ffffff")
	 */
	private parseBorderShorthand(border: string): void {
		const parts = border.split(' ');
		for (const part of parts) {
			if (part.endsWith('px')) {
				this.borderWidth = parseFloat(part.slice(0, -2));
			} else if (part.startsWith('#') || part.startsWith('rgb')) {
				this.borderColor = StyleParser.parseColor(part);
			}
		}
	}

	/**
	 * Set the fill color of the rectangle
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | [number, number, number, number]): this {
		this.fillColor = StyleParser.parseColor(color);
		return this;
	}

	/**
	 * Set the border color of the rectangle
	 * @param color Color value (hex string or RGBA array) or null
	 */
	public setBorderColor(color: string | [number, number, number, number] | null): this {
		this.borderColor = color ? StyleParser.parseColor(color) : null;
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
	 * @param context Render context with coordinate transforms
	 */
	public render(context?: RenderContext): void {
		if (!this.visible) return;

		// Use default context if none provided
		const ctx = context || DEFAULT_RENDER_CONTEXT;

		// Calculate screen position
		const screenX = ctx.offsetX + this.x;
		const screenY = ctx.offsetY + this.y;

		// Get the renderer instance
		const renderer = RendererContext.getInstance().getRenderer();

		// Draw the rectangle with fill and stroke in a single call
		renderer.drawRectangle(
			screenX, 
			screenY, 
			this.width, 
			this.height, 
			this.fillColor, 
			this.borderColor || undefined, 
			this.borderWidth
		);

		// Create child context with our position added
		const childContext: RenderContext = {
			offsetX: screenX,
			offsetY: screenY,
		};

		// Render children with transformed context
		for (const child of this.children) {
			if (child.isVisible()) {
				child.render(childContext);
			}
		}
	}
}
