import { Component, Cursor, PointerEvents } from '../components/Component';
import type { AnyUiEvent, UiActionEvent, UiPointerEvent } from '../input/events';

/**
 * R12.7's press machine, shared by every control that is pressed and
 * released like a button (Button, ListRow, Checkbox, Toggle, a radio item):
 *
 * - a primary `pointerdown` on it, while enabled, arms the press, sets
 *   `pressed`, and captures the pointer, so the release comes back here
 *   wherever it lands (R9.10);
 * - while armed, `pressed` follows whether the pointer is over it: it drops
 *   when the pointer leaves and returns when it comes back;
 * - the dispatcher's `click` (R9.31) is honoured only when the release
 *   landed on it; a release outside ends the press with no click, and the
 *   click is consumed so a parent list does not select on it;
 * - `activate` while focused presses it too, once per key press, since the
 *   dispatcher never repeats one (R9.27), unless `acceptsActivation` turns
 *   that key down;
 * - cancel, capture loss, unmount, and disabling end the press.
 *
 * A press becomes `onClick` (the base callback property), then
 * `onPressed`, which a subclass overrides to toggle or select, then the
 * nearest focus group's `memberPressed` (R12.34). The
 * dispatcher's drag threshold does not cancel these clicks: it applies only
 * to presses that started a drag (docs/AI_TECHNICAL_DECISIONS/input-dispatcher.md).
 */
export abstract class Pressable extends Component {
	/** A press began here and has not been released or cancelled. */
	private armed = false;
	/** The last release was over this component, so the click that follows it counts. */
	private releasedInside = false;

	/** R8.29: labels and marks are internals, not targets. */
	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	protected get defaultCursor(): Cursor | null {
		return 'pointer';
	}

	/** Presses show on it whether or not a caller set onClick (the lint's rules 6 and 7). */
	public get handlesPointer(): boolean {
		return true;
	}

	public handleEvent(event: AnyUiEvent): void {
		if (event.type === 'click' && !this.releasedInside) {
			// A captured release outside still reaches the captor as a click
			// (R9.31): it is swallowed there. A click bubbling up from a
			// pressable nested inside this one is that one's, and goes on.
			if (event.target === this) event.consume();
			return;
		}
		super.handleEvent(event);
		switch (event.type) {
			case 'click':
				this.releasedInside = false;
				this.press(event);
				return;
			case 'activate':
				if (!this.acceptsActivation(event)) return;
				event.consume();
				this.onClick?.(event);
				this.press(event);
				return;
			case 'pointerdown':
				if (event.button !== 0 || !this.effectivelyEnabled) return;
				// The innermost pressable takes the press: one nested inside
				// this one has captured it already on the way up.
				if (this.context?.dispatcher.captorOf(event.pointerId)) return;
				this.armed = true;
				this.releasedInside = false;
				this.pressed = true;
				event.capturePointer();
				return;
			case 'pointermove':
			case 'pointerenter':
			case 'pointerleave':
				if (!this.armed) return;
				// A press that became a drag is not a press any more (R9.12),
				// whatever the ghost is, and it will not click.
				if (this.context?.drag.isDragging) {
					this.endPress();
					return;
				}
				this.pressed = event.type !== 'pointerleave' && this.isOver(event);
				return;
			case 'pointerup':
				this.releasedInside = this.armed && this.isOver(event);
				this.endPress();
				return;
			case 'pointercancel':
			case 'lostpointercapture':
				this.releasedInside = false;
				this.endPress();
				return;
		}
	}

	/**
	 * Whether a focus group's selection includes this control (R12.34). A
	 * control whose `selected` means something of its own says no, and the
	 * group leaves it alone; the checkables keep their value apart anyway.
	 */
	public get takesGroupSelection(): boolean {
		return true;
	}

	/** Whether this key's `activate` presses it; every key by default. */
	protected acceptsActivation(_event: UiActionEvent): boolean {
		return true;
	}

	/** After `onClick`, for a click that counts or an accepted `activate`. */
	protected onPressed(_event: UiPointerEvent | UiActionEvent): void {
		// Override in subclasses
	}

	protected onUnmount(): void {
		this.armed = false;
		this.releasedInside = false;
	}

	/**
	 * Becoming effectively disabled ends the press for good (R9.5): the base
	 * has dropped `pressed`, and the release will not come here, so nothing
	 * may re-arm it when the control is enabled again. Subclasses that
	 * restyle here call this first.
	 */
	protected onStateChange(): void {
		if (this.armed && !this.effectivelyEnabled) {
			this.armed = false;
			this.releasedInside = false;
		}
	}

	/**
	 * The control's own response, then its focus group's (R12.34): the group
	 * hears the press here rather than through the bubble, since `activate`
	 * is consumed by the control so no hotkey also takes the key.
	 */
	private press(event: UiPointerEvent | UiActionEvent): void {
		this.onPressed(event);
		if (!this.isMounted) return;
		for (let node = this.parent; node; node = node.parent) {
			if (!node.focusGroup) continue;
			node.memberPressed(this, event);
			return;
		}
	}

	private endPress(): void {
		this.armed = false;
		this.pressed = false;
	}

	private isOver(event: UiPointerEvent): boolean {
		return this.containsScreenPoint(event.screen.x, event.screen.y);
	}
}
