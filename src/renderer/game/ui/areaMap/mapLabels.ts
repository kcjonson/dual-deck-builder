import { LABEL_LAYOUT } from './areaMapStyle';

/**
 * Label placement for the area map (Area Map Generation, Rendering: the road
 * atlas): labels are placed by priority, each in the first of its candidate
 * spots that stays inside the view and clear of everything placed before it,
 * and dropped rather than overlapped when none is. Screen space.
 */

/** A box on screen. */
export interface LabelBox {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

/** The sides of an anchor a label may sit on, in the order they're tried. */
export type LabelSide = 'right' | 'left' | 'above' | 'below';

export const BESIDE: readonly LabelSide[] = ['right', 'left', 'above', 'below'];

/**
 * A label `width` by `height` beside a symbol `radius` across at (x, y), on
 * each of `sides` in turn, `LABEL_LAYOUT.gap` clear of its edge: level with
 * its centre to the right or left, centred over it above or below.
 */
export function besideBoxes({ x, y, radius, width, height, sides = BESIDE }: { x: number; y: number; radius: number; width: number; height: number; sides?: readonly LabelSide[] }): LabelBox[] {
	const away = radius + LABEL_LAYOUT.gap;
	return sides.map((side) => {
		switch (side) {
			case 'right':
				return { x: x + away, y: y - height / 2, width, height };
			case 'left':
				return { x: x - away - width, y: y - height / 2, width, height };
			case 'above':
				return { x: x - width / 2, y: y - away - height, width, height };
			case 'below':
				return { x: x - width / 2, y: y + away, width, height };
		}
	});
}

export function overlaps(a: LabelBox, b: LabelBox): boolean {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/**
 * One frame's taken space: symbols blocked first, then each label as it's
 * placed, padded by `LABEL_LAYOUT.pad` so neighbouring halos don't touch.
 */
export class LabelLayout {
	private readonly taken: LabelBox[] = [];
	private width = 0;
	private height = 0;

	/** A new frame in a view `width` by `height`. */
	public reset(width: number, height: number): void {
		this.taken.length = 0;
		this.width = width;
		this.height = height;
	}

	/** Space no label may enter: a symbol, or a label placed whatever was there. */
	public block(box: LabelBox): void {
		this.taken.push(box);
	}

	/** Whether `box` is inside the view and clear of everything taken. */
	public isClear(box: LabelBox): boolean {
		if (box.x < 0 || box.y < 0 || box.x + box.width > this.width || box.y + box.height > this.height) return false;
		const pad = LABEL_LAYOUT.pad;
		const padded = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
		for (const other of this.taken) if (overlaps(padded, other)) return false;
		return true;
	}

	/** The first clear candidate, taken; null when none is. */
	public place(candidates: readonly LabelBox[]): LabelBox | null {
		for (const box of candidates) {
			if (!this.isClear(box)) continue;
			this.taken.push(box);
			return box;
		}
		return null;
	}
}
