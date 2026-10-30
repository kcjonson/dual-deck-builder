import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawPolygonOptions, DrawRectOptions } from '../../engine/draw/commands';
import type { RGBA } from '../../engine/draw/geometry';
import { resolveColor } from '../../engine/style/styleObject';

/**
 * Who something belongs to or is aimed at (Battle Screen Design, sections 3
 * and 7): driver 1 a triangle, driver 2 a diamond, both for an area hit on
 * the whole convoy, and a square for an escort.
 */
export type TargetMark = 'driver1' | 'driver2' | 'both' | 'escort';

/** A driver seat's mark; seats are 1 and 2 (`PlayerHandView.DriverSeat`). */
export function seatMark(seat: 1 | 2): TargetMark {
	return seat === 1 ? 'driver1' : 'driver2';
}

/** Each mark's outline in a -1 to 1 box, the mock's `m-d1` and `m-d2`. */
export const MARK_OUTLINES: Readonly<Record<'driver1' | 'driver2', [number, number][]>> = {
	driver1: [[0, -0.87], [0.9, 0.83], [-0.9, 0.83]],
	driver2: [[0, -0.95], [0.95, 0], [0, 0.95], [-0.95, 0]],
};

/**
 * Driver identity owns the two strongest hues (section 7); escorts are
 * neutral bone. Kept beside the shapes so a mark is never drawn in a colour
 * that isn't its own.
 */
export const MARK_COLORS: Readonly<Record<'driver1' | 'driver2' | 'escort', string>> = {
	driver1: '#f2a33a',
	driver2: '#3cc3c9',
	escort: '#8f8a7e',
};

const FILLS = {
	driver1: resolveColor(MARK_COLORS.driver1),
	driver2: resolveColor(MARK_COLORS.driver2),
	escort: resolveColor(MARK_COLORS.escort),
};

/** The diamond's two triangles; the triangle is one already. */
const DIAMOND_INDICES = [0, 1, 2, 0, 2, 3];
/** The square inside its box, as the mock's `m-esc` (9 of 12). */
const SQUARE_INSET = 0.125;

/**
 * One mark as draws of the caller's own, built once and moved in place, so
 * a component that redraws it every frame allocates nothing. `both` is a
 * triangle and a diamond side by side, so it is twice as wide as tall.
 */
export class TargetMarkDraw {
	private current: TargetMark | null = null;
	private readonly triangle: DrawPolygonOptions & { points: { x: number; y: number }[]; fill: RGBA };
	private readonly diamond: DrawPolygonOptions & { points: { x: number; y: number }[]; fill: RGBA };
	private readonly square: DrawRectOptions & { rect: { x: number; y: number; width: number; height: number } };
	/** A colour every part takes instead of its own, for a wreck; null for the mark's own. */
	private override: RGBA | null = null;

	constructor() {
		this.triangle = { points: MARK_OUTLINES.driver1.map(() => ({ x: 0, y: 0 })), fill: FILLS.driver1 };
		this.diamond = { points: MARK_OUTLINES.driver2.map(() => ({ x: 0, y: 0 })), indices: DIAMOND_INDICES, fill: FILLS.driver2 };
		this.square = { rect: { x: 0, y: 0, width: 0, height: 0 }, fill: FILLS.escort };
	}

	get mark(): TargetMark | null {
		return this.current;
	}

	/** The width a mark takes at `size`: `both` is two marks wide. */
	static widthOf(mark: TargetMark | null, size: number): number {
		if (mark === null) return 0;
		return mark === 'both' ? size * 2 : size;
	}

	/** Every part drawn in `color` (a wreck's grey), or each in its own with null. */
	set tint(color: RGBA | null) {
		this.override = color;
		this.applyColors();
	}

	/** The mark, its box's top-left, and its height; nothing draws for null. */
	place(mark: TargetMark | null, x: number, y: number, size: number): void {
		this.current = mark;
		if (mark === 'driver1' || mark === 'both') placeOutline(this.triangle.points, MARK_OUTLINES.driver1, x, y, size);
		if (mark === 'driver2') placeOutline(this.diamond.points, MARK_OUTLINES.driver2, x, y, size);
		if (mark === 'both') placeOutline(this.diamond.points, MARK_OUTLINES.driver2, x + size, y, size);
		if (mark === 'escort') {
			const rect = this.square.rect;
			rect.x = x + size * SQUARE_INSET;
			rect.y = y + size * SQUARE_INSET;
			rect.width = size * (1 - SQUARE_INSET * 2);
			rect.height = rect.width;
		}
		this.applyColors();
	}

	draw(draw: DrawApi): void {
		switch (this.current) {
			case 'driver1':
				draw.drawPolygon(this.triangle);
				return;
			case 'driver2':
				draw.drawPolygon(this.diamond);
				return;
			case 'both':
				draw.drawPolygon(this.triangle);
				draw.drawPolygon(this.diamond);
				return;
			case 'escort':
				draw.drawRect(this.square);
				return;
			default:
				return;
		}
	}

	private applyColors(): void {
		this.triangle.fill = this.override ?? FILLS.driver1;
		this.diamond.fill = this.override ?? FILLS.driver2;
		this.square.fill = this.override ?? FILLS.escort;
	}
}

function placeOutline(points: { x: number; y: number }[], outline: readonly [number, number][], x: number, y: number, size: number): void {
	const half = size / 2;
	outline.forEach(([u, v], index) => {
		points[index].x = x + half + u * half;
		points[index].y = y + half + v * half;
	});
}
