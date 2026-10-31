import type { RGBA } from '../draw/geometry';
import {
	StyleProperties,
	StyleProperty,
	resolveColor,
	resolveLength,
	validateStyle,
} from '../style/styleObject';
import type { ComponentOptions } from './Component';

/** R11.14's properties an SDF or polygon shape renders: Circle, Triangle, Polygon. */
export type ShapeStyleObject = Pick<StyleProperties, 'backgroundColor' | 'borderColor' | 'borderWidth' | 'opacity'>;

export interface ShapeOptions extends Omit<ComponentOptions, 'style'> {
	style?: ShapeStyleObject;
}

/** A shape's fill and centred stroke; no stroke is drawn at width 0. */
export interface ShapeStyle {
	fill: RGBA;
	stroke: RGBA;
	strokeWidth: number;
}

export const DEFAULT_SHAPE: Readonly<ShapeStyle> = { fill: [1, 1, 1, 1], stroke: [0, 0, 0, 1], strokeWidth: 0 };

const SHAPE_PROPERTIES = new Set<StyleProperty>(['backgroundColor', 'borderColor', 'borderWidth', 'opacity']);

/** Validates `style` for `component` (R11.14) and applies it over `base`. */
export function resolveShapeStyle(component: string, style: ShapeStyleObject, base: ShapeStyle = DEFAULT_SHAPE): ShapeStyle {
	validateStyle(style, { component, properties: SHAPE_PROPERTIES, states: new Set() });
	return {
		fill: style.backgroundColor !== undefined ? resolveColor(style.backgroundColor) : base.fill,
		stroke: style.borderColor !== undefined ? resolveColor(style.borderColor) : base.stroke,
		strokeWidth: style.borderWidth !== undefined ? resolveLength(style.borderWidth, 'borderWidth') : base.strokeWidth,
	};
}
