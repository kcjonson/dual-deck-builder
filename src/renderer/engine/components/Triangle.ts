import { Component, ComponentOptions } from './Component';
import { RendererContext } from '../rendering/RendererContext';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { Style, StyleParser } from '../types/Style';

/**
 * The unit triangle `Renderer.drawTriangle` drew, in the box-local space the
 * pushed transform maps onto the component's rectangle. Three points and no
 * index list is already R2.11's triangle list.
 */
const TRIANGLE_POINTS = [
	{ x: 0, y: 1 },
	{ x: -1, y: -1 },
	{ x: 1, y: -1 },
] as const;

/**
 * Triangle component for rendering triangles
 */
export class Triangle extends Component {
	private fillColor: [number, number, number, number] = [1, 1, 1, 1];
	private strokeColor: [number, number, number, number] = [0, 0, 0, 1];
	private strokeWidth = 0;

	/**
	 * Create a new triangle component
	 * @param options Optional configuration including style
	 */
	constructor(options?: ComponentOptions) {
		super(options);
		this.componentType = 'Triangle';

		// Set default size if not provided
		if (this.width === 0) this.width = 100;
		if (this.height === 0) this.height = 100;

		if (options?.style) {
			this.applyTriangleStyle(options.style);
		}
	}

	/**
	 * Apply triangle-specific style properties
	 */
	private applyTriangleStyle(style: Style): void {
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
	 * Set the triangle's fill color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | [number, number, number, number]): this {
		this.fillColor = StyleParser.parseColor(color);
		return this;
	}

	/**
	 * Set the triangle's stroke color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setStrokeColor(color: string | [number, number, number, number]): this {
		this.strokeColor = StyleParser.parseColor(color);
		return this;
	}

	/**
	 * Render the triangle
	 * @param context Render context with coordinate transforms
	 */
	public render(context?: RenderContext): void {
		if (!this.visible) return;

		// Use default context if none provided
		const ctx = context || DEFAULT_RENDER_CONTEXT;

		// Calculate screen position
		const screenX = ctx.offsetX + this.x;
		const screenY = ctx.offsetY + this.y;

		// The box goes in the transform rather than into the points, so the
		// matrix the shader receives is the translate-then-scale the legacy
		// draw built and no vertex multiply moves from the GPU to the CPU.
		const draw = RendererContext.getInstance().draw;
		draw.pushTransform([
			this.width / 2,
			0,
			0,
			this.height / 2,
			screenX + this.width / 2,
			screenY + this.height / 2,
		]);
		draw.drawPolygon({ id: this.id ?? undefined, points: TRIANGLE_POINTS, fill: this.fillColor });
		if (this.strokeWidth > 0) {
			draw.drawPolyline({
				points: TRIANGLE_POINTS,
				color: this.strokeColor,
				width: this.strokeWidth,
				closed: true,
			});
		}
		draw.popTransform();

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
