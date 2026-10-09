import { Component, PointerEvents } from '../../engine/components/Component';
import type { ComponentOptions, Cursor } from '../../engine/components/Component';
import type { DrawApi } from '../../engine/draw/DrawApi';
import type { DrawRectOptions } from '../../engine/draw/commands';
import type { AnyUiEvent } from '../../engine/input/events';
import { focusRingDraw } from './cardStyle';

/**
 * What every kind of card shares, whatever it shows (Game Flow 7.0): a play
 * card at either size, a driver card, and an escort card. Each is one
 * composite target (R8.29) that a click or `activate` selects (R9.31,
 * R9.27), draws its own focus ring so its tags and hex sit on top of it, and
 * settles its look whenever its state changes or it mounts again.
 */
export abstract class CardBase<Data> extends Component {
	/** A click or `activate` on the card, with the data it shows (R8.25). */
	public onSelect: ((data: Data) => void) | null = null;

	/** The walk's focus ring, drawn by the card in `render` (`drawFocusRing`). */
	private readonly focusRing: DrawRectOptions;

	constructor({ id, x, y, width, height }: Pick<ComponentOptions, 'id' | 'x' | 'y'> & { width: number; height: number }) {
		super({ id, x, y, width, height });
		this.focusRing = focusRingDraw({ id, width, height });
	}

	/** What the card shows, which `onSelect` hands back. */
	public abstract get data(): Data;

	/** Recolours the card for its state: hover, focus, selection, enabled, and whatever it fades for. */
	protected abstract updateLook(): void;

	/** Parts derive their ids from the card's own, so a caller names the card once; an unnamed card's parts go unnamed. */
	protected childId(suffix: string): string | undefined {
		return this.id === null ? undefined : `${this.id}_${suffix}`;
	}

	/** R8.29: a card is one target; its words and frame are internals. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	/** A card someone listens to is clickable. */
	protected get defaultCursor(): Cursor | null {
		return this.onSelect ? 'pointer' : null;
	}

	/** A card acts on click and `activate` in `handleEvent`, with or without a listener. */
	public get handlesPointer(): boolean {
		return true;
	}

	/**
	 * The ring is the walk's fallback ring (R11.12's sixth layer, the same
	 * tokens), drawn by the card in `render` so its hex and tags sit on top
	 * of it rather than cut through by it.
	 */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** The focus ring, while the card has keyboard focus and can be used; each card calls it under its tags. */
	protected drawFocusRing(draw: DrawApi): void {
		if (this.focusVisible && this.effectivelyEnabled) draw.drawRect(this.focusRing);
	}

	/**
	 * A click is the dispatcher's, synthesised when press and release both
	 * land on the card (R9.31); a disabled card receives neither it nor
	 * `activate` (R9.5). A focused card treats `activate` (Enter or Space) as
	 * a click (R9.27); a card is focusable only where a screen opts in.
	 */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'activate':
				// Taken only when something listens, so otherwise Enter and Space reach the screen's hotkeys
				if (!this.onSelect) return;
				event.consume();
				this.onSelect(this.data);
				return;
			case 'click':
				this.onSelect?.(this.data);
				return;
		}
	}

	/** Hover, focus, selection, and enabled state, the last inherited (R8.3). */
	protected onStateChange(): void {
		this.updateLook();
	}

	/**
	 * Unmounting clears hover and focus without a callback (R9.21), so a card
	 * that left hovered or focused would come back outlined. It settles its
	 * look for the state it mounts in.
	 */
	protected onMount(): void {
		this.updateLook();
	}

	/**
	 * A pinned detail view was built from the data it opened with, so new
	 * data pins it again, which builds it anew. An open view that isn't
	 * pinned (hover, focus, a touch hold) keeps its data until it opens
	 * again (DDB-422).
	 */
	protected refreshPinnedView(): void {
		const tooltips = this.context?.tooltips;
		if (tooltips?.pinned === this) tooltips.pin(this, { fade: false });
	}
}
