import { Mat2D, Rect, concat, translation } from '../draw/geometry';

/** `rect` grown by `amount` on every side. */
export function grownRect(rect: Rect, amount: number): Rect {
	return { x: rect.x - amount, y: rect.y - amount, width: rect.width + amount * 2, height: rect.height + amount * 2 };
}

/** R8.2's per-side margin. A number is the uniform shorthand. */
export interface Sides {
	readonly top: number;
	readonly right: number;
	readonly bottom: number;
	readonly left: number;
}

export type MarginInput = number | Partial<Sides>;

export const ZERO_SIDES: Sides = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });

export function normalizeSides(input: MarginInput): Sides {
	if (typeof input === 'number') {
		return input === 0 ? ZERO_SIDES : Object.freeze({ top: input, right: input, bottom: input, left: input });
	}
	const sides = {
		top: input.top ?? 0,
		right: input.right ?? 0,
		bottom: input.bottom ?? 0,
		left: input.left ?? 0,
	};
	if (sides.top === 0 && sides.right === 0 && sides.bottom === 0 && sides.left === 0) return ZERO_SIDES;
	return Object.freeze(sides);
}

/**
 * R8.26's transform. `origin` is a fraction of the content box, so a card
 * rotates about its centre whatever its size. Layout ignores all of it.
 */
export interface ComponentTransform {
	/** Radians, clockwise in this y-down space. */
	readonly rotate: number;
	readonly scale: number | readonly [number, number];
	readonly translate: readonly [number, number];
	readonly origin: readonly [number, number];
}

export type TransformInput = Partial<ComponentTransform>;

export const IDENTITY_TRANSFORM: ComponentTransform = Object.freeze({
	rotate: 0,
	scale: 1,
	translate: Object.freeze([0, 0]) as readonly [number, number],
	origin: Object.freeze([0.5, 0.5]) as readonly [number, number],
});

export function normalizeTransform(input: TransformInput): ComponentTransform {
	const transform: ComponentTransform = {
		rotate: input.rotate ?? 0,
		scale: input.scale ?? 1,
		translate: input.translate ?? IDENTITY_TRANSFORM.translate,
		origin: input.origin ?? IDENTITY_TRANSFORM.origin,
	};
	return isIdentityTransform(transform) ? IDENTITY_TRANSFORM : Object.freeze(transform);
}

export function isIdentityTransform(transform: ComponentTransform): boolean {
	const [sx, sy] = scalePair(transform.scale);
	return transform.rotate === 0
		&& sx === 1
		&& sy === 1
		&& transform.translate[0] === 0
		&& transform.translate[1] === 0;
}

function scalePair(scale: number | readonly [number, number]): readonly [number, number] {
	return typeof scale === 'number' ? [scale, scale] : scale;
}

/**
 * The transform as a matrix over the content box's local space, or null for
 * the identity so the walk pushes nothing: `translate * about(origin, rotate * scale)`.
 */
export function transformMatrix(transform: ComponentTransform, width: number, height: number): Mat2D | null {
	if (transform === IDENTITY_TRANSFORM) return null;
	const [sx, sy] = scalePair(transform.scale);
	const cos = Math.cos(transform.rotate);
	const sin = Math.sin(transform.rotate);
	const pivotX = transform.origin[0] * width;
	const pivotY = transform.origin[1] * height;
	const rotateScale: Mat2D = [cos * sx, sin * sx, -sin * sy, cos * sy, 0, 0];
	const aboutPivot = concat(translation(pivotX, pivotY), concat(rotateScale, translation(-pivotX, -pivotY)));
	const moved = concat(translation(transform.translate[0], transform.translate[1]), aboutPivot);
	return moved[0] === 1 && moved[1] === 0 && moved[2] === 0 && moved[3] === 1 && moved[4] === 0 && moved[5] === 0
		? null
		: moved;
}
