import type { Rect, Vec2 } from '../draw/geometry';
import type { ViewportSource } from '../components/MountContext';
import { tokens } from '../theme/tokens';

export type PlacementSide = 'top' | 'bottom' | 'left' | 'right';

/** Where the placed box lines up along the anchor's edge: its start, centre, or end. */
export type PlacementAlign = 'start' | 'center' | 'end';

export interface PlaceOptions {
	/** The anchor in viewport logical pixels: a component's `screenBounds`, or a zero-size rect at a point. */
	anchor: Rect;
	/** The size the placed box wants. */
	size: { width: number; height: number };
	/** Tried first; the opposite side is the flip (R12.30). */
	side?: PlacementSide;
	align?: PlacementAlign;
	/** Distance between the anchor and the box. */
	offset?: number;
	/** Distance the box keeps from the viewport's edges. */
	gap?: number;
	/** Defaults to the service's viewport; a caller may pass a smaller one (a panel acting as a bounds). */
	viewport?: Rect;
}

export interface Placement extends Rect {
	/** The side the box ended on. */
	side: PlacementSide;
	/** It ended on the side opposite the one asked for. */
	flipped: boolean;
	/**
	 * It had to be made smaller than it asked to be to fit: a menu reads the
	 * height and scrolls internally (R12.11).
	 */
	constrained: boolean;
}

export const DEFAULT_PLACEMENT_OFFSET = tokens.space.space_1;
export const DEFAULT_PLACEMENT_GAP = tokens.space.space_2;

const OPPOSITE: Readonly<Record<PlacementSide, PlacementSide>> = {
	top: 'bottom',
	bottom: 'top',
	left: 'right',
	right: 'left',
};

/**
 * R12.30: the one placement routine for popups, popovers, tooltips, and
 * menus. Try the preferred side; when the box overflows the viewport there
 * and the opposite side has more room, flip; then shift along the anchor's
 * edge so the box stays inside the viewport less `gap`; and when even the
 * roomier side is too small, shrink the box to the room there
 * (`constrained`). A box wider than the whole viewport is shrunk to it on the
 * cross axis too.
 *
 * Pure and in viewport logical pixels. A caller whose box is a promoted child
 * converts the answer back with `screenToLocal` (R8.13); an overlay root's
 * content box is the viewport, so its caller uses it as is.
 */
export function place({
	anchor,
	size,
	side = 'bottom',
	align = 'start',
	offset = DEFAULT_PLACEMENT_OFFSET,
	gap = DEFAULT_PLACEMENT_GAP,
	viewport,
}: PlaceOptions & { viewport: Rect }): Placement {
	const vertical = side === 'top' || side === 'bottom';
	const minMain = vertical ? viewport.y + gap : viewport.x + gap;
	const maxMain = vertical ? viewport.y + viewport.height - gap : viewport.x + viewport.width - gap;
	const mainSize = vertical ? size.height : size.width;

	// Room on each side of the anchor along the main axis, offset included.
	const room = (candidate: PlacementSide): number => {
		switch (candidate) {
			case 'bottom': return maxMain - (anchor.y + anchor.height + offset);
			case 'top': return anchor.y - offset - minMain;
			case 'right': return maxMain - (anchor.x + anchor.width + offset);
			case 'left': return anchor.x - offset - minMain;
		}
	};

	let chosen = side;
	const opposite = OPPOSITE[side];
	if (room(side) < mainSize && room(opposite) > room(side)) chosen = opposite;
	const available = Math.max(0, room(chosen));
	const main = Math.min(mainSize, available);

	// Cross axis: aligned to the anchor, then shifted inside the viewport.
	const crossStart = vertical ? viewport.x + gap : viewport.y + gap;
	const crossEnd = vertical ? viewport.x + viewport.width - gap : viewport.y + viewport.height - gap;
	const crossRoom = Math.max(0, crossEnd - crossStart);
	const crossWanted = vertical ? size.width : size.height;
	const cross = Math.min(crossWanted, crossRoom);
	const anchorStart = vertical ? anchor.x : anchor.y;
	const anchorLength = vertical ? anchor.width : anchor.height;
	let crossPosition = align === 'start'
		? anchorStart
		: align === 'end'
			? anchorStart + anchorLength - cross
			: anchorStart + (anchorLength - cross) / 2;
	crossPosition = Math.min(Math.max(crossPosition, crossStart), crossEnd - cross);

	let mainPosition: number;
	switch (chosen) {
		case 'bottom':
			mainPosition = anchor.y + anchor.height + offset;
			break;
		case 'top':
			mainPosition = anchor.y - offset - main;
			break;
		case 'right':
			mainPosition = anchor.x + anchor.width + offset;
			break;
		case 'left':
			mainPosition = anchor.x - offset - main;
			break;
	}

	return {
		x: vertical ? crossPosition : mainPosition,
		y: vertical ? mainPosition : crossPosition,
		width: vertical ? cross : main,
		height: vertical ? main : cross,
		side: chosen,
		flipped: chosen !== side,
		constrained: main < mainSize || cross < crossWanted,
	};
}

/** A zero-size anchor at a point: a context menu at the pointer, a tooltip below it. */
export function pointAnchor(point: Vec2): Rect {
	return { x: point.x, y: point.y, width: 0, height: 0 };
}

/** R12.30 in the mount context: `place` against the context's viewport. */
export class PlacementService {
	private readonly viewportSource: ViewportSource;

	constructor({ viewport }: { viewport: ViewportSource }) {
		this.viewportSource = viewport;
	}

	/** The viewport rect placement clamps to, in logical pixels. */
	public get viewport(): Rect {
		const { width, height } = this.viewportSource.logical;
		return { x: 0, y: 0, width, height };
	}

	public place(options: PlaceOptions): Placement {
		return place({ ...options, viewport: options.viewport ?? this.viewport });
	}
}
