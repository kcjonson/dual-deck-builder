import { Component, ComponentOptions, ResolvedColors } from './Component';
import type { DrawApi } from '../draw/DrawApi';
import { Style, StyleParser } from '../types/Style';

type Color = [number, number, number, number];

/** A filled, optionally bordered and rounded box: what Rectangle draws and Panel draws behind its children. */
export interface BoxStyle {
	fill: Color;
	borderColor: Color | null;
	borderWidth: number;
	cornerRadius: number;
}

/** `base` with whichever box properties `style` sets, the `border` shorthand last. */
export function resolveBoxStyle(style: Style, base: BoxStyle): BoxStyle {
	const box = { ...base };
	if (style.backgroundColor !== undefined) box.fill = StyleParser.parseColor(style.backgroundColor);
	if (style.borderColor !== undefined) box.borderColor = StyleParser.parseColor(style.borderColor);
	if (style.borderWidth !== undefined) box.borderWidth = parseLength(style.borderWidth);
	if (style.borderRadius !== undefined) box.cornerRadius = parseLength(style.borderRadius);
	// Shorthand, e.g. "2px solid #ffffff"
	if (style.border !== undefined) {
		for (const part of style.border.split(' ')) {
			if (part.endsWith('px')) {
				box.borderWidth = parseFloat(part.slice(0, -2));
			} else if (part.startsWith('#') || part.startsWith('rgb')) {
				box.borderColor = StyleParser.parseColor(part);
			}
		}
	}
	return box;
}

/** The box as one draw over `width` by `height` at the local origin. */
export function drawBox(draw: DrawApi, id: string | null, width: number, height: number, box: BoxStyle): void {
	draw.drawRect({
		id: id ?? undefined,
		rect: { x: 0, y: 0, width, height },
		fill: box.fill,
		radius: box.cornerRadius > 0 ? box.cornerRadius : undefined,
		// Keyed off width alone, with a black fallback, because that is what
		// the legacy stroke did with a width and no colour.
		border: box.borderWidth > 0
			? { color: box.borderColor ?? [0, 0, 0, 1], width: box.borderWidth }
			: undefined,
	});
}

/** The colours `drawBox` draws `box` with, for the tree snapshot (R13.22). */
export function boxColors(box: BoxStyle): ResolvedColors {
	return box.borderWidth > 0
		? { fill: box.fill, border: box.borderColor ?? [0, 0, 0, 1] }
		: { fill: box.fill };
}

function parseLength(size: string | number): number {
	if (typeof size === 'number') return size;
	if (size.endsWith('px')) return parseFloat(size.slice(0, -2));
	return parseFloat(size) || 0;
}

/**
 * Rectangle component for rendering rectangles
 */
export class Rectangle extends Component {
	private box: BoxStyle = { fill: [1, 1, 1, 1], borderColor: null, borderWidth: 0, cornerRadius: 0 };

	/**
	 * Create a new rectangle
	 * @param options Optional configuration including style
	 */
	constructor(options?: ComponentOptions) {
		super(options);
		this.componentType = 'Rectangle';

		if (options?.style) {
			this.box = resolveBoxStyle(options.style, this.box);
		}
	}

	/**
	 * Set the fill color of the rectangle
	 * @param color Color value (hex string or RGBA array)
	 */
	public setFillColor(color: string | Color): this {
		this.box.fill = StyleParser.parseColor(color);
		return this;
	}

	/**
	 * Set the border color of the rectangle
	 * @param color Color value (hex string or RGBA array) or null
	 */
	public setBorderColor(color: string | Color | null): this {
		this.box.borderColor = color ? StyleParser.parseColor(color) : null;
		return this;
	}

	/**
	 * Set the border width of the rectangle
	 * @param width Border width in pixels
	 */
	public setBorderWidth(width: number): this {
		this.box.borderWidth = width;
		return this;
	}

	/**
	 * Set the corner radius of the rectangle
	 * @param radius Corner radius in pixels
	 */
	public setCornerRadius(radius: number): this {
		this.box.cornerRadius = radius;
		return this;
	}

	public get resolvedColors(): ResolvedColors {
		return boxColors(this.box);
	}

	public render(draw: DrawApi): void {
		drawBox(draw, this.id, this.width, this.height, this.box);
	}
}
