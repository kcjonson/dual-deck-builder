/**
 * Chapter 10's vocabulary: the per-axis sizing modes every component carries
 * and the properties a stack container reads from its children.
 */

/**
 * R10.1. `fixed` uses the component's size; `hug` sizes to content; `fill`
 * takes a share of the parent stack's leftover by `fillWeight` on its main
 * axis, and the whole content box on its cross axis. Authored, never changed
 * by layout.
 */
export type SizeMode = 'fixed' | 'hug' | 'fill';

export type Axis = 'width' | 'height';

export type Direction = 'vertical' | 'horizontal';

/** R10.2's main-axis distribution of leftover space; it stacks on top of `gap`. */
export type Distribution = 'start' | 'center' | 'end' | 'spaceBetween' | 'spaceAround' | 'spaceEvenly';

/** R10.2's cross-axis alignment; `alignSelf` overrides it per child (R10.4). */
export type CrossAlign = 'start' | 'center' | 'end' | 'stretch';

/** R10.15: `absolute` leaves the flow and is placed by `anchor` and `pivot`. */
export type Positioned = 'flow' | 'absolute';

export interface Size {
	width: number;
	height: number;
}

/** A per-axis constraint; an absent axis is unconstrained (R10.4). */
export interface AxisLimits {
	width?: number;
	height?: number;
}

/**
 * R10.15's anchor and pivot: a fraction pair of a box, or one of the nine
 * named shorthands.
 */
export type AnchorName =
	| 'topLeft'
	| 'top'
	| 'topRight'
	| 'left'
	| 'center'
	| 'right'
	| 'bottomLeft'
	| 'bottom'
	| 'bottomRight';

export type Fraction2 = readonly [number, number];

export type AnchorInput = AnchorName | Fraction2;

const NAMED_ANCHORS: Readonly<Record<AnchorName, Fraction2>> = {
	topLeft: [0, 0],
	top: [0.5, 0],
	topRight: [1, 0],
	left: [0, 0.5],
	center: [0.5, 0.5],
	right: [1, 0.5],
	bottomLeft: [0, 1],
	bottom: [0.5, 1],
	bottomRight: [1, 1],
};

export const TOP_LEFT: Fraction2 = NAMED_ANCHORS.topLeft;

export function normalizeAnchor(input: AnchorInput): Fraction2 {
	if (typeof input === 'string') return NAMED_ANCHORS[input];
	return input[0] === 0 && input[1] === 0 ? TOP_LEFT : Object.freeze([input[0], input[1]]) as Fraction2;
}

/**
 * The mode an authored size gives an axis: positive fixes it, zero hugs it
 * again, and `fill` stays `fill` (a fill axis has no authored size to keep).
 */
export function authoredSizeMode(size: number, current: SizeMode): SizeMode {
	if (size > 0) return 'fixed';
	return current === 'fill' ? 'fill' : 'hug';
}
