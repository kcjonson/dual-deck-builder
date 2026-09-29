import { Component, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { ColorValue, resolveColor } from '../style/styleObject';
import { ShapeOptions, ShapeStyleObject, resolveShapeStyle } from './shapeStyle';
import { triangulatePolygon, type Vec2 } from '../draw';

/**
 * Polygon component for rendering arbitrary polygons
 */
export class Polygon extends Component {
	private fillColor: RGBA;
	private strokeColor: RGBA;
	private strokeWidth: number;
	private styleObject: ShapeStyleObject;
	private points: Vec2[] = [];
	/** R2.11's triangle list, recomputed when the outline changes rather than per frame. */
	private indices: number[] = [];
	/** `points` on the component's box, rewritten each render; the draw API copies them. */
	private boxPoints: { x: number; y: number }[] = [];

	/**
	 * Create a new polygon component
	 * @param options Optional configuration including style
	 */
	constructor({ style = {}, ...options }: ShapeOptions = {}) {
		super(options);
		this.styleObject = style;
		const shape = resolveShapeStyle('Polygon', style);
		this.fillColor = shape.fill;
		this.strokeColor = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.componentType = 'Polygon';

		// Set default size if not provided
		if (this.width === 0) this.width = 100;
		if (this.height === 0) this.height = 100;

	}

	public get style(): ShapeStyleObject {
		return this.styleObject;
	}

	/** R11.16: construction's path and validation; the new style replaces the old one whole. */
	public set style(style: ShapeStyleObject) {
		const shape = resolveShapeStyle('Polygon', style);
		this.styleObject = style;
		this.fillColor = shape.fill;
		this.strokeColor = shape.stroke;
		this.strokeWidth = shape.strokeWidth;
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.invalidateInk();
	}

	/**
	 * Set the polygon's fill color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: ColorValue): this {
		this.fillColor = resolveColor(color);
		return this;
	}

	/**
	 * Set the polygon's stroke color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setStrokeColor(color: ColorValue): this {
		this.strokeColor = resolveColor(color);
		return this;
	}

	/**
	 * Set the polygon's points
	 * Points are relative to the polygon's position and will be scaled by width/height
	 * @param points Array of [x, y] coordinates normalized to -1 to 1 range
	 */
	public setPoints(points: [number, number][]): this {
		if (points.length < 3) {
			throw new Error('Polygon must have at least 3 points');
		}
		this.outline = points;
		return this;
	}

	/**
	 * Create a regular polygon with n sides
	 * @param sides Number of sides (minimum 3)
	 */
	public makeRegular(sides: number): this {
		if (sides < 3) {
			throw new Error('Polygon must have at least 3 sides');
		}

		const points: [number, number][] = [];
		const angleStep = (2 * Math.PI) / sides;

		for (let i = 0; i < sides; i++) {
			const angle = i * angleStep - Math.PI / 2; // Start at top
			const x = Math.cos(angle);
			const y = Math.sin(angle);
			points.push([x, y]);
		}

		this.outline = points;
		return this;
	}

	/**
	 * Create a star polygon
	 * @param points Number of points on the star
	 * @param innerRadius Inner radius ratio (0-1)
	 */
	public makeStar(points: number, innerRadius = 0.5): this {
		if (points < 3) {
			throw new Error('Star must have at least 3 points');
		}

		const vertices: [number, number][] = [];
		const angleStep = Math.PI / points;

		for (let i = 0; i < points * 2; i++) {
			const angle = i * angleStep - Math.PI / 2;
			const radius = i % 2 === 0 ? 1 : innerRadius;
			const x = Math.cos(angle) * radius;
			const y = Math.sin(angle) * radius;
			vertices.push([x, y]);
		}

		this.outline = vertices;
		return this;
	}

	private set outline(points: [number, number][]) {
		this.points = points.map(([x, y]) => ({ x, y }));
		this.boxPoints = points.map(() => ({ x: 0, y: 0 }));
		this.indices = triangulatePolygon(this.points);
	}

	/** The stroke is centred on the outline, so half of it lands outside the box (R8.8). */
	public get inkExtent(): number {
		return this.strokeWidth > 0 ? this.strokeWidth / 2 : 0;
	}

	public get resolvedColors(): ResolvedColors {
		return this.strokeWidth > 0 ? { fill: this.fillColor, border: this.strokeColor } : { fill: this.fillColor };
	}

	public render(draw: DrawApi): void {
		if (this.points.length < 3) return;

		// The box is applied to the points, not pushed as a transform; see Triangle.
		const halfWidth = this.width / 2;
		const halfHeight = this.height / 2;
		for (let index = 0; index < this.points.length; index++) {
			this.boxPoints[index].x = halfWidth + this.points[index].x * halfWidth;
			this.boxPoints[index].y = halfHeight + this.points[index].y * halfHeight;
		}
		if (this.indices.length > 0) {
			draw.drawPolygon({
				id: this.id ?? undefined,
				points: this.boxPoints,
				indices: this.indices,
				fill: this.fillColor,
			});
		}
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
