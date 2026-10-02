import { Component, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { ColorValue, resolveColor } from '../style/styleObject';
import { ShapeOptions, ShapeStyleObject, resolveShapeStyle } from './shapeStyle';

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
	private ownFill: RGBA;
	private ownStroke: RGBA;
	private strokeWidth: number;
	private styleObject: ShapeStyleObject;
	/** `TRIANGLE_POINTS` on the component's box, rewritten each render; the draw API copies them. */
	private readonly boxPoints = TRIANGLE_POINTS.map(() => ({ x: 0, y: 0 }));

	/**
	 * Create a new triangle component
	 * @param options Optional configuration including style
	 */
	constructor({ style = {}, ...options }: ShapeOptions = {}) {
		super(options);
		this.styleObject = style;
		const shape = resolveShapeStyle('Triangle', style);
		this.ownFill = shape.fill;
		this.ownStroke = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.componentType = 'Triangle';

		// Set default size if not provided
		if (this.width === 0) this.width = 100;
		if (this.height === 0) this.height = 100;

	}

	public get style(): ShapeStyleObject {
		return this.styleObject;
	}

	/** R11.16: construction's path and validation; the new style replaces the old one whole. */
	public set style(style: ShapeStyleObject) {
		const shape = resolveShapeStyle('Triangle', style);
		this.styleObject = style;
		this.ownFill = shape.fill;
		this.ownStroke = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.invalidateInk();
	}

	/** The fill color. */
	public get fillColor(): RGBA {
		return this.ownFill;
	}

	public set fillColor(color: ColorValue) {
		this.ownFill = resolveColor(color);
	}

	/** The stroke color. */
	public get strokeColor(): RGBA {
		return this.ownStroke;
	}

	public set strokeColor(color: ColorValue) {
		this.ownStroke = resolveColor(color);
	}

	/** The stroke is centred on the outline, so half of it lands outside the box (R8.8). */
	public get inkExtent(): number {
		return this.strokeWidth > 0 ? this.strokeWidth / 2 : 0;
	}

	public get resolvedColors(): ResolvedColors {
		return this.strokeWidth > 0 ? { fill: this.ownFill, border: this.ownStroke } : { fill: this.ownFill };
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
		draw.drawPolygon({ id: this.id ?? undefined, points: this.boxPoints, fill: this.ownFill });
		if (this.strokeWidth > 0) {
			draw.drawPolyline({
				points: this.boxPoints,
				color: this.ownStroke,
				width: this.strokeWidth,
				closed: true,
			});
		}
	}
}
