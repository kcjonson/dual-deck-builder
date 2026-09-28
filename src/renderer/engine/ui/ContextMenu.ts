import type { Component } from '../components/Component';
import type { MountContext } from '../components/MountContext';
import type { Vec2 } from '../draw/geometry';
import type { AnyUiEvent, UiPointerEvent } from '../input/events';
import { pointAnchor } from '../services/Placement';
import type { PopupCloseReason, PopupHandle } from '../services/PopupService';
import { Menu, MenuOptions } from './Menu';

export interface ContextMenuOptions extends MenuOptions {
	/** Heard once each time it closes, whatever closed it. */
	onClose?: ((reason: PopupCloseReason) => void) | null;
}

export interface OpenAtOptions {
	/**
	 * The `pointerdown` that opened it, when one did: it is captured by the
	 * component handling it, so its release cannot select the item that
	 * opens under it (R9.11). A menu opened from `contextmenu` needs none,
	 * since that event comes on the release.
	 */
	press?: UiPointerEvent;
	/**
	 * A mounted component whose mount context to open in (usually the one
	 * handling the event); the press's target when absent. An unopened
	 * context menu is in no tree, so it has no context of its own.
	 */
	from?: Component;
	/** Show the focus ring on the menu, for a menu opened from the keyboard. */
	keyboard?: boolean;
}

/**
 * R12.14's context menu: a Menu opened at a point with `openAt`, placed by
 * the placement service below and right of it, flipped or clamped to stay
 * in the viewport (R12.30), in the `popup` layer through the popup service.
 *
 * It takes focus while open (off the Tab order) so the keys are its own: Up
 * and Down move the highlight, wrapping and skipping separators and disabled
 * items, Home and End jump, `activate` selects, and Escape closes. A primary
 * press outside closes it and is consumed; a secondary press outside closes
 * it without being consumed, so the scene can open a new one where it landed
 * (R9.13). Selecting closes it, and closing gives focus back to what had it.
 */
export class ContextMenu extends Menu {
	public onClose: ((reason: PopupCloseReason) => void) | null;

	private handle: PopupHandle | null = null;
	private returnFocus: Component | null = null;
	/** The context it last opened in, for giving focus back after it has unmounted. */
	private openedIn: MountContext | null = null;

	constructor({ onClose = null, ...options }: ContextMenuOptions = {}) {
		super({ focusable: true, tabIndex: -1, ...options });
		this.componentType = 'ContextMenu';
		this.onClose = onClose;
	}

	public get isOpen(): boolean {
		return this.handle !== null;
	}

	/** Opens at `point` (viewport logical pixels), replacing any open popup; an open context menu moves there. */
	public openAt(point: Vec2, { press, from, keyboard = false }: OpenAtOptions = {}): void {
		press?.capturePointer();
		const context = from?.context ?? press?.currentTarget.context ?? this.context;
		if (!context) throw new Error('ContextMenu.openAt: pass `from` (a mounted component) or the opening press');
		if (this.handle) this.close();
		this.hoveredIndex = -1;
		const focused = context.focus.focused;
		const handle = context.popups.show({
			popup: this,
			anchor: pointAnchor(point),
			side: 'bottom',
			align: 'start',
			offset: 0,
			onClose: (reason) => {
				if (this.handle !== handle) return;
				this.handle = null;
				this.restoreFocus();
				this.onClose?.(reason);
			},
		});
		this.handle = handle;
		this.openedIn = context;
		this.returnFocus = focused;
		context.focus.focus(this, keyboard ? 'keyboard' : 'pointer');
		if (keyboard) this.hoverEdge('first');
	}

	public close(): void {
		this.handle?.close();
	}

	/** Selecting closes it. */
	public select(index: number): boolean {
		if (!super.select(index)) return false;
		this.close();
		return true;
	}

	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		switch (event.type) {
			case 'activate':
				event.consume();
				this.selectHovered();
				return;
			case 'cancel':
				event.consume();
				this.close();
				return;
			case 'keydown': {
				const { modifiers } = event;
				if (modifiers.ctrl || modifiers.meta || modifiers.alt) return;
				switch (event.key) {
					case 'ArrowDown':
					case 'ArrowUp':
						this.moveHover(event.key === 'ArrowDown' ? 1 : -1);
						event.consume();
						return;
					case 'Home':
					case 'End':
						this.hoverEdge(event.key === 'Home' ? 'first' : 'last');
						event.consume();
						return;
				}
				return;
			}
		}
	}

	private restoreFocus(): void {
		const previous = this.returnFocus;
		this.returnFocus = null;
		const focus = this.openedIn?.focus;
		if (!focus) return;
		if (previous && previous.isMounted && previous.canReceiveFocus()) focus.focus(previous, 'programmatic');
		else if (focus.focused === this) focus.blur();
	}
}
