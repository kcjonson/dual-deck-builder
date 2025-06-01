import { Component, ComponentOptions } from './Component';
import { RendererContext } from '../rendering/RendererContext';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { Style, StyleParser } from '../types/Style';

/**
 * Circle component for rendering circles
 */
export class Circle extends Component {
	private fillColor: [number, number, number, number] = [1, 1, 1, 1];
	private strokeColor: [number, number, number, number] = [0, 0, 0, 1];
	private strokeWidth = 0;
	private radius = 50;

	/**
	 * Create a new circle component
	 * @param options Optional configuration including style
	 */
	constructor(options?: ComponentOptions) {
		super(options);
		this.componentType = 'Circle';

		if (options?.style) {
			this.applyCircleStyle(options.style);
		}

		// Set default size based on radius
		if (this.width === 0) this.width = this.radius * 2;
		if (this.height === 0) this.height = this.radius * 2;
	}

	/**
	 * Apply circle-specific style properties
	 */
	private applyCircleStyle(style: Style): void {
		if (style.backgroundColor !== undefined) {
			this.fillColor = StyleParser.parseColor(style.backgroundColor);
		}
		if (style.borderColor !== undefined) {
			this.strokeColor = StyleParser.parseColor(style.borderColor);
		}
		if (style.borderWidth !== undefined) {
			this.strokeWidth = this.parseSize(style.borderWidth);
		}
	}

	/**
	 * Set the circle's fill color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | [number, number, number, number]): this {
		this.fillColor = StyleParser.parseColor(color);
		return this;
	}

	/**
	 * Set the circle's stroke color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setStrokeColor(color: string | [number, number, number, number]): this {
		this.strokeColor = StyleParser.parseColor(color);
		return this;
	}

	/**
	 * Set the circle's stroke width
	 * @param width Stroke width in pixels
	 */
	public setStrokeWidth(width: number): this {
		this.strokeWidth = width;
		return this;
	}

	/**
	 * Set the circle's radius
	 * @param radius Circle radius in pixels
	 */
	public setRadius(radius: number): this {
		this.radius = radius;
		this.setSize(radius * 2, radius * 2);
		return this;
	}

	/**
	 * Get the circle's radius
	 */
	public getRadius(): number {
		return this.radius;
	}

	/**
	 * Render the circle
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

		// Calculate center position
		const centerX = screenX + this.radius;
		const centerY = screenY + this.radius;

		// Draw the circle at screen position
		renderer.drawCircle(
			centerX,
			centerY,
			this.radius,
			this.fillColor,
			this.strokeColor,
			this.strokeWidth,
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
