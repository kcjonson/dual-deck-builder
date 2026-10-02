import type { AnyUiEvent, UiActionEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
import type { PopupHandle } from '../services/PopupService';
import { Button, ButtonOptions } from './Button';
import { Menu, MenuItem } from './Menu';

export interface DropdownButtonOptions extends Omit<ButtonOptions, 'icon' | 'iconPosition' | 'onClick'> {
	items?: MenuItem[];
	/** Prefer opening above the button; the placement service still flips when there is no room. */
	openUpward?: boolean;
	/** The menu's width; the button's when absent. */
	menuWidth?: number;
	/** The tallest the menu grows before it scrolls. */
	maxMenuHeight?: number;
	/** After the item's own `onSelect`, with the item and its index. */
	onSelect?: ((item: MenuItem, index: number) => void) | null;
}

const DEFAULT_MENU_HEIGHT = 320;

/**
 * R12.13's menu button: a Button with a trailing caret that opens a Menu of
 * `items` through the popup service. It toggles on release (the press
 * machine's click), so the release never lands on a row; Down opens it with
 * the first item highlighted, and Up and Down, Home and End move the
 * highlight while it is open, where `activate` picks the highlighted item.
 * A press outside closes it (consumed, except on another popup trigger), as
 * do focus moving elsewhere, Escape, and a selection. `open` (R11.11) lifts
 * its border to the accent while the menu shows.
 */
export class DropdownButton extends Button {
	public onSelect: ((item: MenuItem, index: number) => void) | null;
	public openUpward: boolean;
	public menuWidth: number | null;
	public maxMenuHeight: number;

	private menuItems: MenuItem[];
	private menu: Menu | null = null;
	private handle: PopupHandle | null = null;

	constructor({ items = [], openUpward = false, menuWidth, maxMenuHeight = DEFAULT_MENU_HEIGHT, onSelect = null, ...options }: DropdownButtonOptions = {}) {
		super({ ...options, icon: 'expand_more', iconPosition: 'right' });
		this.componentType = 'DropdownButton';
		this.popupTrigger = true;
		this.menuItems = items;
		this.openUpward = openUpward;
		this.menuWidth = menuWidth ?? null;
		this.maxMenuHeight = maxMenuHeight;
		this.onSelect = onSelect;
	}

	public get items(): MenuItem[] {
		return this.menuItems;
	}

	/** New items; an open menu closes. */
	public set items(items: MenuItem[]) {
		this.menuItems = items;
		this.closeMenu();
	}

	/** The open menu, or null. */
	public get openMenu(): Menu | null {
		return this.menu;
	}

	/** Opens the menu; `highlightFirst` for keyboard opening. Nothing when disabled, empty, or unmounted. */
	public show({ highlightFirst = false }: { highlightFirst?: boolean } = {}): void {
		const context = this.context;
		if (this.menu || !context || !this.effectivelyEnabled || this.menuItems.length === 0) return;
		const menu = new Menu({
			id: this.id ? `${this.id}_menu` : undefined,
			items: this.menuItems,
			width: this.menuWidth ?? this.width,
			size: this.size,
			maxHeight: this.maxMenuHeight,
			onSelect: (item, index) => {
				this.closeMenu();
				this.onSelect?.(item, index);
			},
		});
		if (highlightFirst) menu.hoverEdge('first');
		this.menu = menu;
		this.handle = context.popups.show({
			popup: menu,
			trigger: this,
			anchor: this,
			side: this.openUpward ? 'top' : 'bottom',
			align: 'start',
			onClose: () => {
				if (this.menu !== menu) return;
				this.menu = null;
				this.handle = null;
				this.open = false;
			},
		});
		this.open = true;
	}

	public closeMenu(): void {
		this.handle?.close();
	}

	public handleEvent(event: AnyUiEvent): void {
		if (event.type === 'cancel' && this.menu) {
			event.consume();
			this.closeMenu();
			return;
		}
		super.handleEvent(event);
		if (event.type === 'keydown' && this.handleKey(event)) event.consume();
	}

	/** A click toggles; `activate` picks the highlighted item of an open menu, or toggles. */
	protected onPressed(event: UiPointerEvent | UiActionEvent): void {
		if (event.type === 'activate' && this.menu && this.menu.selectHovered()) return;
		if (this.menu) this.closeMenu();
		else this.show({ highlightFirst: event.type === 'activate' });
	}

	protected onUnmount(): void {
		super.onUnmount();
		this.closeMenu();
	}

	private handleKey(event: UiKeyEvent): boolean {
		const { modifiers } = event;
		if (!this.effectivelyEnabled || modifiers.ctrl || modifiers.meta || modifiers.alt) return false;
		const menu = this.menu;
		switch (event.key) {
			case 'ArrowDown':
				if (!menu) this.show({ highlightFirst: true });
				else menu.moveHover(1);
				return true;
			case 'ArrowUp':
				if (!menu) return false;
				menu.moveHover(-1);
				return true;
			case 'Home':
			case 'End':
				if (!menu) return false;
				menu.hoverEdge(event.key === 'Home' ? 'first' : 'last');
				return true;
		}
		return false;
	}
}
