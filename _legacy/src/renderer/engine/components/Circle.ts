import { Component, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA, Rect } from '../draw/geometry';
import { ColorValue, resolveColor } from '../style/styleObject';
import { ShapeOptions, ShapeStyleObject, resolveShapeStyle } from './shapeStyle';

/**
 * Circle component for rendering circles
 */
export class Circle extends Component {
	private ownFill: RGBA;
	private ownStroke: RGBA;
	private strokeWidth: number;
	private styleObject: ShapeStyleObject;
	private ownRadius = 50;

	/**
	 * Create a new circle component
	 * @param options Optional configuration including style
	 */
	constructor({ style = {}, ...options }: ShapeOptions = {}) {
		super(options);
		this.styleObject = style;
		const shape = resolveShapeStyle('Circle', style);
		this.ownFill = shape.fill;
		this.ownStroke = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.componentType = 'Circle';

		// Set default size based on radius
		if (this.width === 0) this.width = this.ownRadius * 2;
		if (this.height === 0) this.height = this.ownRadius * 2;
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

	/** The radius. */
	public get radius(): number {
		return this.ownRadius;
	}

	public set radius(radius: number) {
		if (radius !== this.ownRadius) this.invalidateInk();
		this.ownRadius = radius;
		this.setSize(radius * 2, radius * 2);
	}

	/** The stroke is centred on the outline, so half of it lands outside the box (R8.8). */
	public get inkExtent(): number {
		return this.strokeWidth > 0 ? this.strokeWidth / 2 : 0;
	}

	/**
	 * The subtree cull's bound (DDB-184): the box, and the disc `render`
	 * draws from its radius, which a size given without setting `radius` does not
	 * change, so the two can differ.
	 */
	protected get cullInk(): Rect {
		const box = this.inkRect;
		const extent = this.ownRadius * 2 + this.inkExtent;
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
		return this.strokeWidth > 0 ? { fill: this.ownFill, border: this.ownStroke } : { fill: this.ownFill };
	}

	public render(draw: DrawApi): void {
		draw.drawCircle({
			id: this.id ?? undefined,
			center: { x: this.ownRadius, y: this.ownRadius },
			radius: this.ownRadius,
			fill: this.ownFill,
			// `center`, not the `inside` default: the stroke has always straddled
			// the radius, so a circle keeps its outer size when it gains one.
			border: this.strokeWidth > 0
				? { color: this.ownStroke, width: this.strokeWidth, position: 'center' }
				: undefined,
		});
	}
}
