import { Component, ComponentOptions, ResolvedColors } from './Component';
import type { LineCap } from '../draw/commands';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA, Vec2 } from '../draw/geometry';
import { ColorValue, StyleProperties, StyleProperty, resolveColor, validateStyle } from '../style/styleObject';

/** R11.14's properties a line renders. */
export type LineStyleObject = Pick<StyleProperties, 'color' | 'opacity'>;

export interface LineOptions extends Omit<ComponentOptions, 'style' | 'width' | 'height'> {
	/** The endpoints, in the line's own space; `position` moves both. */
	start: Vec2;
	end: Vec2;
	/** Logical pixels across. Default 1. */
	thickness?: number;
	/** Default `butt`. */
	cap?: LineCap;
	style?: LineStyleObject;
}

const WHITE: RGBA = [1, 1, 1, 1];
const LINE_STYLE = { component: 'Line', properties: new Set<StyleProperty>(['color', 'opacity']), states: new Set<never>() };

/**
 * R12.3's line: `start` and `end` in the line's own space, a `thickness`, a
 * colour (the closed set's `color`), and optional round caps, drawn as one
 * capsule by the draw API. Its box is the endpoints' bounding box from the
 * origin, so `position` moves both endpoints; half the thickness (and a round
 * cap) lands outside the box, which is its ink (R8.8). It is not resized by
 * layout: a line is its endpoints.
 */
export class Line extends Component {
	private from: Vec2;
	private to: Vec2;
	private lineThickness: number;
	private lineCap: LineCap;
	private lineColor: RGBA;
	private styleObject: LineStyleObject;

	constructor({ start, end, thickness = 1, cap = 'butt', style = {}, ...options }: LineOptions) {
		super(options);
		this.componentType = 'Line';
		this.styleObject = {};
		this.lineColor = WHITE;
		this.style = style;
		this.from = { ...start };
		this.to = { ...end };
		this.lineThickness = thickness;
		this.lineCap = cap;
		this.fitBox();
	}

	public get style(): LineStyleObject {
		return this.styleObject;
	}

	/** R11.16: construction's path and validation; the new style replaces the old one whole. */
	public set style(style: LineStyleObject) {
		validateStyle(style, LINE_STYLE);
		this.styleObject = style;
		this.lineColor = style.color !== undefined ? resolveColor(style.color) : WHITE;
		if (style.opacity !== undefined) this.opacity = style.opacity;
	}

	public get start(): Vec2 {
		return this.from;
	}

	public set start(point: Vec2) {
		this.from = { ...point };
		this.fitBox();
	}

	public get end(): Vec2 {
		return this.to;
	}

	public set end(point: Vec2) {
		this.to = { ...point };
		this.fitBox();
	}

	public get thickness(): number {
		return this.lineThickness;
	}

	public set thickness(thickness: number) {
		this.lineThickness = thickness;
		this.invalidateInk();
	}

	public get color(): RGBA {
		return this.lineColor;
	}

	public set color(color: ColorValue) {
		this.lineColor = resolveColor(color);
	}

	/** Keeps its endpoints: layout cannot stretch a line. */
	public assignSize(_width: number, _height: number): void {
		// A line is its endpoints.
	}

	/** Half the thickness past the box on every side (a round cap reaches no further), and any endpoint left of or above the origin. */
	public get inkExtent(): number {
		return this.lineThickness / 2 + Math.max(0, -Math.min(this.from.x, this.to.x, this.from.y, this.to.y));
	}

	public get resolvedColors(): ResolvedColors {
		return { fill: this.lineColor };
	}

	public render(draw: DrawApi): void {
		draw.drawLine({ id: this.id ?? undefined, from: this.from, to: this.to, color: this.lineColor, width: this.lineThickness, cap: this.lineCap });
	}

	/** The box from the origin to the furthest endpoint on each axis. */
	private fitBox(): void {
		this.setSize(Math.max(this.from.x, this.to.x, 0), Math.max(this.from.y, this.to.y, 0));
		this.invalidateInk();
	}
}
