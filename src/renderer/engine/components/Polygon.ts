import { Component, ComponentOptions, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import { Style, StyleParser } from '../types/Style';
import { triangulatePolygon, type Vec2 } from '../draw';

/**
 * Polygon component for rendering arbitrary polygons
 */
export class Polygon extends Component {
	private fillColor: [number, number, number, number] = [1, 1, 1, 1];
	private strokeColor: [number, number, number, number] = [0, 0, 0, 1];
	private strokeWidth = 0;
	private points: Vec2[] = [];
	/** R2.11's triangle list, recomputed when the outline changes rather than per frame. */
	private indices: number[] = [];
	/** `points` on the component's box, rewritten each render; the draw API copies them. */
	private boxPoints: { x: number; y: number }[] = [];

	/**
	 * Create a new polygon component
	 * @param options Optional configuration including style
	 */
	constructor(options?: ComponentOptions) {
		super(options);
		this.componentType = 'Polygon';

		// Set default size if not provided
		if (this.width === 0) this.width = 100;
		if (this.height === 0) this.height = 100;

		if (options?.style) {
			this.applyPolygonStyle(options.style);
		}
	}

	/**
	 * Apply polygon-specific style properties
	 */
	private applyPolygonStyle(style: Style): void {
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
	 * Set the polygon's fill color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | [number, number, number, number]): this {
		this.fillColor = StyleParser.parseColor(color);
		return this;
	}

	/**
	 * Set the polygon's stroke color
	 * @param color Color value (hex string or RGBA array)
	 */
	public setStrokeColor(color: string | [number, number, number, number]): this {
		this.strokeColor = StyleParser.parseColor(color);
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
