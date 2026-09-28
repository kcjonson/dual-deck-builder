import { Component, ComponentOptions, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
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
	 * Set the circle's radius
	 * @param radius Circle radius in pixels
	 */
	public setRadius(radius: number): this {
		this.radius = radius;
		this.setSize(radius * 2, radius * 2);
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
