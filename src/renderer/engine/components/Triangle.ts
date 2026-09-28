import { Component, ComponentOptions } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import { Style, StyleParser } from '../types/Style';

/**
 * The unit triangle, in a box-local space from -1 to 1 on each axis that
 * `render` maps onto the component's rectangle. Three points and no index
 * list is already R2.11's triangle list.
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
	/** `TRIANGLE_POINTS` on the component's box, rewritten each render; the draw API copies them. */
	private readonly boxPoints = TRIANGLE_POINTS.map(() => ({ x: 0, y: 0 }));

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

	public render(draw: DrawApi): void {
		// The box is applied to the points rather than pushed as a transform, so
		// the stroke width stays in pixels instead of scaling with the box.
		const halfWidth = this.width / 2;
		const halfHeight = this.height / 2;
		for (let index = 0; index < TRIANGLE_POINTS.length; index++) {
			this.boxPoints[index].x = halfWidth + TRIANGLE_POINTS[index].x * halfWidth;
			this.boxPoints[index].y = halfHeight + TRIANGLE_POINTS[index].y * halfHeight;
		}
		draw.drawPolygon({ id: this.id ?? undefined, points: this.boxPoints, fill: this.fillColor });
		if (this.strokeWidth > 0) {
			draw.drawPolyline({
				points: this.boxPoints,
				color: this.strokeColor,
				width: this.strokeWidth,
				closed: true,
			});
		}
	}
}
