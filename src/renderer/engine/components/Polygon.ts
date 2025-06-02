import { Component, ComponentOptions } from './Component';
import { RendererContext } from '../rendering/RendererContext';
import { RenderContext, DEFAULT_RENDER_CONTEXT } from '../rendering/RenderContext';
import { Style, StyleParser } from '../types/Style';

/**
 * Polygon component for rendering arbitrary polygons
 */
export class Polygon extends Component {
	private fillColor: [number, number, number, number] = [1, 1, 1, 1];
	private strokeColor: [number, number, number, number] = [0, 0, 0, 1];
	private strokeWidth = 0;
	private points: [number, number][] = [];

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
	 * Set the polygon's stroke width
	 * @param width Stroke width in pixels
	 */
	public setStrokeWidth(width: number): this {
		this.strokeWidth = width;
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
		this.points = points;
		return this;
	}

	/**
	 * Get the polygon's points
	 */
	public getPoints(): [number, number][] {
		return this.points;
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

		this.points = points;
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

		this.points = vertices;
		return this;
	}

	/**
	 * Render the polygon
	 * @param context Render context with coordinate transforms
	 */
	public render(context?: RenderContext): void {
		if (!this.visible || this.points.length < 3) return;

		// Use default context if none provided
		const ctx = context || DEFAULT_RENDER_CONTEXT;

		// Calculate screen position
		const screenX = ctx.offsetX + this.x;
		const screenY = ctx.offsetY + this.y;

		// Get the renderer instance
		const renderer = RendererContext.getInstance().getRenderer();

		// Draw the polygon at screen position
		renderer.drawPolygon(
			screenX,
			screenY,
			this.width,
			this.height,
			this.points,
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