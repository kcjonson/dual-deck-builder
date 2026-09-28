import { Component, ComponentOptions, PointerEvents, ResolvedColors } from '../components/Component';
import type { DrawApi } from '../draw/DrawApi';
import type { RGBA } from '../draw/geometry';
import type { AnyUiEvent, UiPointerEvent } from '../input/events';
import { tokens } from '../theme/tokens';

export type ScrollbarOrientation = 'vertical' | 'horizontal';

/** What a scrollbar shows: how far in, how long the whole, and how much of it is visible, on one axis. */
export interface ScrollRange {
	offset: number;
	extent: number;
	viewport: number;
}

export interface ScrollbarOptions extends Omit<ComponentOptions, 'style'> {
	orientation?: ScrollbarOrientation;
	range?: ScrollRange;
	/** A user drag or track press asks for this offset, already clamped; the owner applies it and sets `range`. */
	onScroll?: (offset: number) => void;
}

const { color } = tokens;
/** The track as drawn, across. */
export const SCROLLBAR_THICKNESS = tokens.space.space_1_5;
/**
 * The scrollbar's box across: R13.25.7's 24 px minimum target, with the thin
 * track drawn centred in it. It is also the gutter a scroll container gives
 * up for it, so the whole target lies beside the content, never over it.
 */
export const SCROLLBAR_BREADTH = tokens.space.space_6;
export const SCROLLBAR_GUTTER = SCROLLBAR_BREADTH;
/** The thumb never gets shorter than this, however long the content. */
const MIN_THUMB = tokens.space.space_6;

/**
 * R12.37's standalone scrollbar: a track and a thumb bound to any
 * `{ offset, extent, viewport }` on one axis, so a scroll container, a wide
 * hand, or a map can share one implementation (ScrollContainer composes
 * it). The thumb's length is the visible share of the track, never below a
 * minimum; its position is the offset's share of the scrollable range.
 *
 * It holds no scroll state of its own: a drag or a track press reports the
 * offset it wants through `onScroll`, and the owner, which clamps and
 * applies it, sets `range` back. A press on the thumb drags it with the
 * pointer captured; a press on the track jumps the thumb's centre to the
 * pointer and keeps dragging. Neither takes focus (`preventFocus`, R9.23),
 * so a press on a scrollbar does not blur a field in the content.
 *
 * Its box is the target, `SCROLLBAR_BREADTH` across by default, and the
 * track and thumb draw `SCROLLBAR_THICKNESS` thick along its middle.
 *
 * With nothing to scroll (`extent <= viewport`) it draws and hits nothing.
 */
export class Scrollbar extends Component {
	public onScroll: ((offset: number) => void) | null = null;
	private readonly axis: ScrollbarOrientation;
	private current: ScrollRange;
	/** While dragging: the pointer's along-track position and the offset at the press. */
	private drag: { start: number; offset: number } | null = null;

	constructor({ orientation = 'vertical', range = { offset: 0, extent: 0, viewport: 0 }, onScroll, ...options }: ScrollbarOptions = {}) {
		super({
			...options,
			width: options.width ?? (orientation === 'vertical' ? SCROLLBAR_BREADTH : 0),
			height: options.height ?? (orientation === 'horizontal' ? SCROLLBAR_BREADTH : 0),
		});
		this.componentType = 'Scrollbar';
		this.axis = orientation;
		this.current = { ...range };
		if (onScroll) this.onScroll = onScroll;
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'auto';
	}

	public get orientation(): ScrollbarOrientation {
		return this.axis;
	}

	public get range(): ScrollRange {
		return this.current;
	}

	/** The owner's current offset, extent, and viewport. Paint only. */
	public set range(range: ScrollRange) {
		this.current = { ...range };
	}

	/** Whether there is anything to scroll, so anything to draw. */
	public get active(): boolean {
		return this.current.extent > this.current.viewport + 1e-6 && this.trackLength > 0;
	}

	public get dragging(): boolean {
		return this.drag !== null;
	}

	/** The thumb along the track: start and length, in the track's own space. */
	public get thumb(): { start: number; length: number } {
		const track = this.trackLength;
		const { offset, extent, viewport } = this.current;
		if (!this.active) return { start: 0, length: track };
		const length = Math.min(track, Math.max(MIN_THUMB, (track * viewport) / extent));
		const range = extent - viewport;
		const start = range > 0 ? ((track - length) * Math.min(Math.max(offset, 0), range)) / range : 0;
		return { start, length };
	}

	/** R8.12's override: the whole box, and only while there is something to scroll. */
	public containsPoint(localX: number, localY: number): boolean {
		return this.active && super.containsPoint(localX, localY);
	}

	/** It acts on presses in `handleEvent`, with or without a caller callback (the lint's rules 6 and 7). */
	public get handlesPointer(): boolean {
		return true;
	}

	public get resolvedColors(): ResolvedColors | null {
		if (!this.active) return null;
		return { fill: this.thumbColor };
	}

	public render(draw: DrawApi): void {
		if (!this.active) return;
		const vertical = this.axis === 'vertical';
		const across = Math.min(SCROLLBAR_THICKNESS, vertical ? this.width : this.height);
		const inset = ((vertical ? this.width : this.height) - across) / 2;
		const radius = across / 2;
		const along = vertical ? this.height : this.width;
		const band = (start: number, length: number) => (vertical
			? { x: inset, y: start, width: across, height: length }
			: { x: start, y: inset, width: length, height: across });
		draw.drawRect({ id: this.id ?? undefined, rect: band(0, along), fill: color.line_hairline, radius });
		const { start, length } = this.thumb;
		draw.drawRect({ rect: band(start, length), fill: this.thumbColor, radius });
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'pointerdown':
				if (event.button !== 0 || !this.active) return;
				this.press(event);
				return;
			case 'pointermove':
				if (this.drag) this.follow(event);
				return;
			case 'pointerup':
			case 'pointercancel':
			case 'lostpointercapture':
				if (this.drag) {
					this.drag = null;
					this.onStateChange();
				}
				return;
		}
	}

	protected onUnmount(): void {
		this.drag = null;
	}

	private get trackLength(): number {
		return this.axis === 'vertical' ? this.height : this.width;
	}

	private get thumbColor(): RGBA {
		if (this.drag) return color.accent;
		return this.hovered ? color.text_dim : color.line_strong;
	}

	private along(event: UiPointerEvent): number | null {
		const local = event.local;
		if (!local) return null;
		return this.axis === 'vertical' ? local.y : local.x;
	}

	/** A press on the thumb grabs it where it was pressed; one on the track first centres the thumb there. */
	private press(event: UiPointerEvent): void {
		const position = this.along(event);
		if (position === null) return;
		event.consume();
		event.preventFocus();
		event.capturePointer();
		const { start, length } = this.thumb;
		if (position < start || position > start + length) {
			const offset = this.offsetForThumbStart(position - length / 2);
			this.onScroll?.(offset);
			this.current = { ...this.current, offset };
		}
		this.drag = { start: position, offset: this.current.offset };
		this.onStateChange();
	}

	private follow(event: UiPointerEvent): void {
		const drag = this.drag;
		const position = this.along(event);
		if (!drag || position === null) return;
		const { length } = this.thumb;
		const travel = this.trackLength - length;
		const range = this.current.extent - this.current.viewport;
		if (travel <= 0 || range <= 0) return;
		const offset = clamp(drag.offset + ((position - drag.start) * range) / travel, range);
		if (offset === this.current.offset) return;
		this.onScroll?.(offset);
		this.current = { ...this.current, offset };
	}

	private offsetForThumbStart(start: number): number {
		const { length } = this.thumb;
		const travel = this.trackLength - length;
		const range = this.current.extent - this.current.viewport;
		if (travel <= 0 || range <= 0) return 0;
		return clamp((start * range) / travel, range);
	}
}

function clamp(offset: number, range: number): number {
	return Math.max(0, Math.min(range, offset));
}
