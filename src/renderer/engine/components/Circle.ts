import { Component, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA, Rect } from '../draw/geometry';
import { ColorValue, resolveColor } from '../style/styleObject';
import { ShapeOptions, ShapeStyleObject, resolveShapeStyle } from './shapeStyle';

/**
 * Circle component for rendering circles
 */
export class Circle extends Component {
	private fillColor: RGBA;
	private strokeColor: RGBA;
	private strokeWidth: number;
	private styleObject: ShapeStyleObject;
	private radius = 50;

	/**
	 * Create a new circle component
	 * @param options Optional configuration including style
	 */
	constructor({ style = {}, ...options }: ShapeOptions = {}) {
		super(options);
		this.styleObject = style;
		const shape = resolveShapeStyle('Circle', style);
		this.fillColor = shape.fill;
		this.strokeColor = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.componentType = 'Circle';

		// Set default size based on radius
		if (this.width === 0) this.width = this.radius * 2;
		if (this.height === 0) this.height = this.radius * 2;
	}

	/**
	 * A circle draws from its radius, so it cannot take a size layout assigns:
	 * `fill` and `stretch` leave it at its own (worldsim's non-resizable leaf
	 * contract). Wrap it in a container when it has to fill.
	 */
	public assignSize(_width: number, _height: number): void {
		// Keeps its radius-derived size.
	}

	public get style(): ShapeStyleObject {
		return this.styleObject;
	}

	/** R11.16: construction's path and validation; the new style replaces the old one whole. */
	public set style(style: ShapeStyleObject) {
		const shape = resolveShapeStyle('Circle', style);
		this.styleObject = style;
		this.fillColor = shape.fill;
		this.strokeColor = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.invalidateInk();
	}

	/**
	 * Set the circle's fill color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: ColorValue): this {
		this.fillColor = resolveColor(color);
		return this;
	}

	/**
	 * Set the circle's stroke color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setStrokeColor(color: ColorValue): this {
		this.strokeColor = resolveColor(color);
		return this;
	}

	/**
	 * Set the circle's radius
	 * @param radius Circle radius in pixels
	 */
	public setRadius(radius: number): this {
		if (radius !== this.radius) this.invalidateInk();
		this.radius = radius;
		this.setSize(radius * 2, radius * 2);
		return this;
	}

	/** The stroke is centred on the outline, so half of it lands outside the box (R8.8). */
	public get inkExtent(): number {
		return this.strokeWidth > 0 ? this.strokeWidth / 2 : 0;
	}

	/**
	 * The subtree cull's bound (DDB-184): the box, and the disc `render`
	 * draws from its radius, which a size given without `setRadius` does not
	 * change, so the two can differ.
	 */
	protected get cullInk(): Rect {
		const box = this.inkRect;
		const extent = this.radius * 2 + this.inkExtent;
		const minX = Math.min(box.x, -this.inkExtent);
		const minY = Math.min(box.y, -this.inkExtent);
		return {
			x: minX,
			y: minY,
			width: Math.max(box.x + box.width, extent) - minX,
			height: Math.max(box.y + box.height, extent) - minY,
		};
	}

	public get resolvedColors(): ResolvedColors {
		return this.strokeWidth > 0 ? { fill: this.fillColor, border: this.strokeColor } : { fill: this.fillColor };
	}

	public render(draw: DrawApi): void {
		draw.drawCircle({
			id: this.id ?? undefined,
			center: { x: this.radius, y: this.radius },
			radius: this.radius,
			fill: this.fillColor,
			// `center`, not the `inside` default: the stroke has always straddled
			// the radius, so a circle keeps its outer size when it gains one.
			border: this.strokeWidth > 0
				? { color: this.strokeColor, width: this.strokeWidth, position: 'center' }
				: undefined,
		});
	}
}
