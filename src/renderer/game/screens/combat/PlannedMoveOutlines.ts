import { drawIcon, DrawIconOptions } from '../../../engine/components/Icon';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../../engine/draw/commands';
import type { RGBA } from '../../../engine/draw/geometry';
import { RoadSlot, sameSlot } from '../../mechanics/Road';
import { SWERVE_ICON } from '../../ui/IntentPill';
import { RoadLayout, roadSlotRect } from './CombatLayout';
import { hexRgba } from './combatStyle';

/** Inside the cell as far as an empty slot's dashed outline, so the two line up. */
const INSET_X = 6;
const INSET_Y = 4;
const BORDER_WIDTH = 2;
const RADIUS = 4;
const ICON_SIZE = 28;
const RAIDER_RED = '#d4513f';
const BORDER_COLOR = hexRgba(RAIDER_RED, 0.8);
const FILL_COLOR = hexRgba(RAIDER_RED, 0.08);
const ICON_COLOR = hexRgba(RAIDER_RED, 0.6);
/**
 * While a card waits for its slot, the road's slot targets are drawn over
 * these in the raiders' red too, and a hovered one is solid; the outlines
 * recede to a faint border and icon so none reads as a chosen target.
 */
const RECEDED_BORDER_COLOR = hexRgba(RAIDER_RED, 0.35);
const RECEDED_FILL_COLOR = hexRgba(RAIDER_RED, 0);
const RECEDED_ICON_COLOR = hexRgba(RAIDER_RED, 0.3);

/**
 * Where raiders' planned swerves will take them (call 288): each
 * destination slot outlined in the raiders' red, with the swerve icon its
 * pill leads with at the middle, while the plan stands. The road draws
 * these under the tokens and its slot targets, after the empty slots'
 * dashes. Geometry is built only when the destinations or the layout
 * change, and replayed each frame.
 */
export class PlannedMoveOutlines {
	private slots: RoadSlot[] = [];
	private readonly outlines: (DrawRectOptions & { border: { color: RGBA; width: number } })[] = [];
	private readonly icons: DrawIconOptions[] = [];

	/** The slots outlined now, each once. */
	public get destinations(): readonly RoadSlot[] {
		return this.slots;
	}

	/** Outline these slots on this layout. True when the set changed. */
	public show(slots: readonly RoadSlot[], layout: RoadLayout): boolean {
		const unique = slots.filter((slot, index) => slots.findIndex((other) => sameSlot(other, slot)) === index);
		const same = unique.length === this.slots.length && unique.every((slot) => this.slots.some((shown) => sameSlot(shown, slot)));
		if (same) return false;
		this.slots = unique;
		this.build(layout);
		return true;
	}

	/** Rebuild the outlines for a new layout, the slots unchanged. */
	public build(layout: RoadLayout): void {
		this.outlines.length = 0;
		this.icons.length = 0;
		if (layout.slotWidth <= INSET_X * 2 || layout.slotHeight <= INSET_Y * 2) return;
		for (const slot of this.slots) {
			const cell = roadSlotRect(layout, slot);
			const rect = { x: cell.x + INSET_X, y: cell.y + INSET_Y, width: cell.width - INSET_X * 2, height: cell.height - INSET_Y * 2 };
			this.outlines.push({ rect, fill: FILL_COLOR, radius: RADIUS, border: { color: BORDER_COLOR, width: BORDER_WIDTH } });
			this.icons.push({ glyph: SWERVE_ICON, size: ICON_SIZE, tint: ICON_COLOR, box: rect });
		}
	}

	/** `receded` while the road shows slot targets over them. */
	public draw(draw: DrawApi, receded = false): void {
		for (const outline of this.outlines) {
			outline.fill = receded ? RECEDED_FILL_COLOR : FILL_COLOR;
			outline.border.color = receded ? RECEDED_BORDER_COLOR : BORDER_COLOR;
			draw.drawRect(outline);
		}
		for (const icon of this.icons) {
			icon.tint = receded ? RECEDED_ICON_COLOR : ICON_COLOR;
			drawIcon(draw, icon);
		}
	}
}
