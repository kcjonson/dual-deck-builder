import { LABEL_LAYOUT } from './areaMapStyle';

/**
 * Label placement for the area map (Area Map Generation, Rendering: the road
 * atlas): labels are placed by priority, each on the first side of its
 * symbol that stays inside the view and clear of everything placed before
 * it, and dropped rather than overlapped when none is. Screen space. A frame
 * places into boxes kept from the last, so placing allocates nothing once
 * the map has been drawn.
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

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BesideOptions {
	/** The symbol's centre and its extent from it. */
	x: number;
	y: number;
	radius: number;
	/** The label's size. */
	width: number;
	height: number;
	sides?: readonly LabelSide[];
	/** With no side clear, take the first anyway, and block it. */
	anyway?: boolean;
}

/**
 * One frame's taken space: symbols blocked first, then each label as it's
 * placed, kept `LABEL_LAYOUT.pad` from its neighbours so halos don't touch.
 */
export class LabelLayout {
	private readonly taken: Box[] = [];
	private count = 0;
	private width = 0;
	private height = 0;
	/** Without measured text nothing can be kept clear, so every label takes its first side. */
	private checked = true;
	private readonly corner = { x: 0, y: 0 };

	/** A new frame in a view `width` by `height`; `checked` false where labels can't be measured. */
	public reset(width: number, height: number, checked = true): void {
		this.count = 0;
		this.width = width;
		this.height = height;
		this.checked = checked;
	}

	/** Space no label may enter: a symbol. */
	public block(x: number, y: number, width: number, height: number): void {
		this.take(x, y, width, height);
	}

	/**
	 * A label `width` by `height` beside a symbol `radius` across at (x, y),
	 * on the first of `sides` that's clear, `LABEL_LAYOUT.gap` from the
	 * symbol's edge: level with its centre to the right or left, centred over
	 * it above or below. Returns its box, valid until the next `reset`, or
	 * null when no side is clear.
	 */
	public placeBeside({ x, y, radius, width, height, sides = BESIDE, anyway = false }: BesideOptions): LabelBox | null {
		const away = radius + LABEL_LAYOUT.gap;
		const at = this.corner;
		for (const side of sides) {
			cornerBeside(side, x, y, away, width, height, at);
			if (!this.checked || this.isClear(at.x, at.y, width, height)) return this.take(at.x, at.y, width, height);
		}
		if (!anyway || sides.length === 0) return null;
		cornerBeside(sides[0], x, y, away, width, height, at);
		return this.take(at.x, at.y, width, height);
	}

	/** Whether a box is inside the view and `pad` clear of everything taken. */
	public isClear(x: number, y: number, width: number, height: number): boolean {
		if (x < 0 || y < 0 || x + width > this.width || y + height > this.height) return false;
		const pad = LABEL_LAYOUT.pad;
		const left = x - pad;
		const top = y - pad;
		const right = x + width + pad;
		const bottom = y + height + pad;
		for (let index = 0; index < this.count; index++) {
			const other = this.taken[index];
			if (left < other.x + other.width && right > other.x && top < other.y + other.height && bottom > other.y) return false;
		}
		return true;
	}

	private take(x: number, y: number, width: number, height: number): Box {
		let box = this.taken[this.count];
		if (!box) {
			box = { x: 0, y: 0, width: 0, height: 0 };
			this.taken.push(box);
		}
		box.x = x;
		box.y = y;
		box.width = width;
		box.height = height;
		this.count += 1;
		return box;
	}
}

/** The top-left corner, into `out`, of a label `width` by `height` on `side` of a symbol at (x, y), `away` from its centre. */
function cornerBeside(side: LabelSide, x: number, y: number, away: number, width: number, height: number, out: { x: number; y: number }): void {
	out.x = side === 'right' ? x + away : side === 'left' ? x - away - width : x - width / 2;
	out.y = side === 'above' ? y - away - height : side === 'below' ? y + away : y - height / 2;
}
