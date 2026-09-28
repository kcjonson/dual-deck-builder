import { Component, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { ColorValue, resolveColor } from '../style/styleObject';
import { ShapeOptions, resolveShapeStyle } from './shapeStyle';

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
	private fillColor: RGBA;
	private strokeColor: RGBA;
	private strokeWidth: number;
	/** `TRIANGLE_POINTS` on the component's box, rewritten each render; the draw API copies them. */
	private readonly boxPoints = TRIANGLE_POINTS.map(() => ({ x: 0, y: 0 }));

	/**
	 * Create a new triangle component
	 * @param options Optional configuration including style
	 */
	constructor({ style = {}, ...options }: ShapeOptions = {}) {
		super(options);
		const shape = resolveShapeStyle('Triangle', style);
		this.fillColor = shape.fill;
		this.strokeColor = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.componentType = 'Triangle';

		// Set default size if not provided
		if (this.width === 0) this.width = 100;
		if (this.height === 0) this.height = 100;

	}

	/**
	 * Set the triangle's fill color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: ColorValue): this {
		this.fillColor = resolveColor(color);
		return this;
	}

	/**
	 * Set the triangle's stroke color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setStrokeColor(color: ColorValue): this {
		this.strokeColor = resolveColor(color);
		return this;
	}

	/** The stroke is centred on the outline, so half of it lands outside the box (R8.8). */
	public get inkExtent(): number {
		return this.strokeWidth > 0 ? this.strokeWidth / 2 : 0;
	}

	public get resolvedColors(): ResolvedColors {
		return this.strokeWidth > 0 ? { fill: this.fillColor, border: this.strokeColor } : { fill: this.fillColor };
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
