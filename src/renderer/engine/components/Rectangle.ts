import { Component, ComponentOptions, ResolvedColors } from './Component';
import type { BoxShadow } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import { shadowExtent } from '../style/look';
import {
	ColorValue,
	StyleAcceptance,
	StyleProperties,
	StyleProperty,
	resolveColor,
	resolveLength,
	resolveShadow,
	validateStyle,
} from '../style/styleObject';

/** R11.14's properties a box renders: what Rectangle, and a stack's background, accept. */
export type BoxStyleObject = Pick<StyleProperties, 'backgroundColor' | 'borderColor' | 'borderWidth' | 'borderRadius' | 'opacity' | 'shadow'>;

export interface RectangleOptions extends Omit<ComponentOptions, 'style'> {
	style?: BoxStyleObject;
}

/** A filled, optionally bordered, rounded, and shadowed box. */
export interface BoxStyle {
	fill: RGBA;
	borderColor: RGBA | null;
	borderWidth: number;
	cornerRadius: number;
	shadow: BoxShadow | null;
}

const BOX_PROPERTIES = new Set<StyleProperty>(['backgroundColor', 'borderColor', 'borderWidth', 'borderRadius', 'opacity', 'shadow']);

/** R11.14: what a component drawing a box accepts, named for messages. */
export function boxAcceptance(component: string): StyleAcceptance {
	return { component, properties: BOX_PROPERTIES, states: new Set() };
}

/** `base` with whichever box properties `style` sets (R11.15's instance step). */
export function resolveBoxStyle(style: BoxStyleObject, base: BoxStyle): BoxStyle {
	return {
		fill: style.backgroundColor !== undefined ? resolveColor(style.backgroundColor) : base.fill,
		borderColor: style.borderColor !== undefined ? resolveColor(style.borderColor) : base.borderColor,
		borderWidth: style.borderWidth !== undefined ? resolveLength(style.borderWidth, 'borderWidth') : base.borderWidth,
		cornerRadius: style.borderRadius !== undefined ? resolveLength(style.borderRadius, 'borderRadius') : base.cornerRadius,
		shadow: style.shadow !== undefined ? resolveShadow(style.shadow) : base.shadow,
	};
}

/** The box as one draw over `width` by `height` at the local origin (two with a shadow, R12.1). */
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
		shadow: box.shadow ?? undefined,
	});
}

/** The colours `drawBox` draws `box` with, for the tree snapshot (R13.22). */
export function boxColors(box: BoxStyle): ResolvedColors {
	return box.borderWidth > 0
		? { fill: box.fill, border: box.borderColor ?? [0, 0, 0, 1] }
		: { fill: box.fill };
}

/** How far a box's own draws reach past it: its shadow (R8.8). */
export function boxInkExtent(box: BoxStyle): number {
	return box.shadow ? shadowExtent(box.shadow) : 0;
}

const DEFAULT_BOX: BoxStyle = { fill: [1, 1, 1, 1], borderColor: null, borderWidth: 0, cornerRadius: 0, shadow: null };

/**
 * R12.1's rectangle on R11.14's closed set: `backgroundColor`, `borderColor`,
 * `borderWidth`, `borderRadius`, `opacity`, and `shadow`, each rendered; any
 * other key is rejected at construction. Resizable by layout.
 */
export class Rectangle extends Component {
	private box: BoxStyle;
	private styleObject: BoxStyleObject;

	constructor({ style = {}, ...options }: RectangleOptions = {}) {
		super(options);
		this.componentType = 'Rectangle';
		validateStyle(style, boxAcceptance('Rectangle'));
		this.styleObject = style;
		this.box = resolveBoxStyle(style, DEFAULT_BOX);
		if (style.opacity !== undefined) this.opacity = style.opacity;
	}

	public get style(): BoxStyleObject {
		return this.styleObject;
	}

	/** R11.16: construction's path, and its validation; paint only. */
	public set style(style: BoxStyleObject) {
		validateStyle(style, boxAcceptance('Rectangle'));
		this.styleObject = style;
		this.box = resolveBoxStyle(style, DEFAULT_BOX);
		if (style.opacity !== undefined) this.opacity = style.opacity;
		this.invalidateInk();
	}

	public setFillColor(color: ColorValue): this {
		this.box = { ...this.box, fill: resolveColor(color) };
		return this;
	}

	public setBorderColor(color: ColorValue | null): this {
		this.box = { ...this.box, borderColor: color ? resolveColor(color) : null };
		return this;
	}

	public setBorderWidth(width: number): this {
		this.box = { ...this.box, borderWidth: width };
		return this;
	}

	public setCornerRadius(radius: number): this {
		this.box = { ...this.box, cornerRadius: radius };
		return this;
	}

	public get inkExtent(): number {
		return boxInkExtent(this.box);
	}

	public get resolvedColors(): ResolvedColors {
		return boxColors(this.box);
	}

	public render(draw: DrawApi): void {
		drawBox(draw, this.id, this.width, this.height, this.box);
	}
}
