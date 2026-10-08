import { Component, ComponentOptions, Cursor, PointerEvents, ResolvedColors } from '../components/Component';
import { drawIcon } from '../components/Icon';
import type { DrawApi } from '../draw/DrawApi';
import type { Rect } from '../draw/geometry';
import type { AnyUiEvent, UiKeyEvent } from '../input/events';
import type { PopupHandle } from '../services/PopupService';
import { Look, LookInk, LookLayers, lookInk, resolveLook } from '../style/look';
import { LookTransition } from '../style/LookTransition';
import { CONTROL_SIZES, ControlSize, fieldLayers } from '../style/variants';
import { tokens } from '../theme/tokens';
import { drawControlBox } from './controlBox';
import { Menu } from './Menu';

export interface SelectOption {
	label: string;
	value: string;
	/** Default true. */
	enabled?: boolean;
}

export interface SelectOptions extends Omit<ComponentOptions, 'style'> {
	options?: SelectOption[];
	/** The selected option's value; null or an unknown value shows the placeholder. */
	value?: string | null;
	placeholder?: string;
	disabled?: boolean;
	/** R11.10: height (unless `height` is given), text size, caret size, and the menu's rows. */
	size?: ControlSize;
	/** The tallest the list grows before it scrolls. */
	maxMenuHeight?: number;
	/** A user pick of a different value, already applied. Never fired by setting `value`. */
	onChange?: ((value: string) => void) | null;
}

const DEFAULT_WIDTH = 180;
const INSET = tokens.control.inset_field;
const CARET_GAP = tokens.space.space_2;
const DEFAULT_MENU_HEIGHT = 320;

/**
 * R12.12's select: a field showing the chosen option's label (or a faint
 * placeholder) and a caret icon, which opens its options as a Menu through
 * the popup service (R12.31), placed below it or flipped above (R12.30).
 *
 * - A press toggles it, and is captured so its release cannot pick the row
 *   that opens under it (R9.11).
 * - Opening highlights the current value; Up and Down move the highlight,
 *   Down opens a closed select, Home and End jump.
 * - `activate` (Enter or Space) opens a closed select and picks the
 *   highlighted option of an open one.
 * - Escape, a press outside (consumed, unless it lands on another popup
 *   trigger), and focus moving elsewhere close it. A press inside the menu
 *   keeps the select focused (R9.23).
 *
 * It is a `popupTrigger` (R9.13), so a press on it while another select is
 * open switches in one press. `open` (R11.11) lifts its border to the accent.
 */
export class Select extends Component {
	public onChange: ((value: string) => void) | null;
	public maxMenuHeight: number;

	private choices: SelectOption[];
	private current: string | null;
	private placeholderText: string;
	private readonly selectSize: ControlSize;
	private readonly layers: LookLayers;
	private readonly transition: LookTransition;
	private menu: Menu | null = null;
	private handle: PopupHandle | null = null;

	constructor({
		options = [],
		value = null,
		placeholder = 'Select...',
		disabled = false,
		size = 'md',
		maxMenuHeight = DEFAULT_MENU_HEIGHT,
		onChange = null,
		...rest
	}: SelectOptions = {}) {
		super({
			focusable: true,
			popupTrigger: true,
			...(disabled ? { enabled: false } : {}),
			...rest,
			width: rest.width ?? DEFAULT_WIDTH,
			height: rest.height ?? CONTROL_SIZES[size].height,
		});
		this.componentType = 'Select';
		this.choices = options;
		this.current = value;
		this.placeholderText = placeholder;
		this.selectSize = size;
		this.maxMenuHeight = maxMenuHeight;
		this.onChange = onChange;
		this.layers = fieldLayers({});
		this.transition = new LookTransition({ owner: this, look: this.targetLook });
	}

	protected get defaultPointerEvents(): PointerEvents {
		return 'unit';
	}

	protected get defaultCursor(): Cursor | null {
		return 'pointer';
	}

	public get handlesPointer(): boolean {
		return true;
	}

	public get options(): SelectOption[] {
		return this.choices;
	}

	/** New options; an open list closes, since its rows no longer say what they did. */
	public set options(options: SelectOption[]) {
		this.choices = options;
		this.closeMenu();
	}

	public get value(): string | null {
		return this.current;
	}

	/** Programmatic: never fires `onChange`. */
	public set value(value: string | null) {
		this.current = value;
	}

	public get placeholder(): string {
		return this.placeholderText;
	}

	public set placeholder(placeholder: string) {
		this.placeholderText = placeholder;
	}

	/** What the field shows: the chosen option's label, or the placeholder. */
	public get selectedLabel(): string {
		return this.selectedOption?.label ?? this.placeholderText;
	}

	public get size(): ControlSize {
		return this.selectSize;
	}

	/** The open list, or null. */
	public get openMenu(): Menu | null {
		return this.menu;
	}

	/** The label or placeholder it draws (the text record, DDB-206). */
	public get drawnText(): readonly string[] {
		return [this.selectedLabel];
	}

	public get look(): Look {
		return this.transition.look;
	}

	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	/** R8.8: the ring, the style's shadow, and any glow its style gives a state. */
	public get inkExtent(): number {
		return this.inkFromLook.extent;
	}

	/** The ring while focus shows and the style's shadow where it falls, never a glow (R12.20). */
	protected get restingInk(): Rect {
		return this.inkFromLook.resting;
	}

	private get inkFromLook(): LookInk {
		return lookInk(this.layers, this.stateFlags, this.boxGrownBy(0));
	}

	public get resolvedColors(): ResolvedColors {
		const look = this.transition.look;
		return { fill: look.fill, border: look.border, text: look.text };
	}

	/** Opens the list with the current value highlighted; nothing when disabled, empty, or unmounted. */
	public show(): void {
		const context = this.context;
		if (this.menu || !context || !this.effectivelyEnabled || this.choices.length === 0) return;
		const menu = new Menu({
			id: this.id ? `${this.id}_menu` : undefined,
			items: this.choices.map((option) => ({ label: option.label, enabled: option.enabled })),
			width: this.width,
			size: this.selectSize,
			maxHeight: this.maxMenuHeight,
			hoveredIndex: this.selectedIndex,
			onSelect: (_item, index) => this.pick(index),
		});
		this.menu = menu;
		this.handle = context.popups.show({
			popup: menu,
			trigger: this,
			anchor: this,
			side: 'bottom',
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
		super.handleEvent(event);
		switch (event.type) {
			case 'pointerdown':
				if (event.button !== 0 || !this.effectivelyEnabled) return;
				event.consume();
				event.capturePointer();
				if (this.menu) this.closeMenu();
				else this.show();
				return;
			case 'activate':
				if (!this.effectivelyEnabled) return;
				event.consume();
				if (!this.menu) this.show();
				else if (!this.menu.selectHovered()) this.closeMenu();
				return;
			case 'cancel':
				if (!this.menu) return;
				event.consume();
				this.closeMenu();
				return;
			case 'keydown':
				if (this.handleKey(event)) event.consume();
				return;
		}
	}

	protected onMount(): void {
		this.transition.moveTo(this.targetLook, null);
	}

	protected onUnmount(): void {
		this.closeMenu();
		this.transition.moveTo(this.targetLook, null);
	}

	protected onStateChange(): void {
		this.transition.moveTo(this.targetLook, this.context?.animator ?? null);
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		drawControlBox(draw, { id: this.id ?? undefined, width: this.width, height: this.height, look });
		const metrics = CONTROL_SIZES[this.selectSize];
		const caretBox = { x: this.width - INSET - metrics.iconSize, y: 0, width: metrics.iconSize, height: this.height };
		const chosen = this.selectedOption;
		const enabled = this.effectivelyEnabled;
		draw.drawText({
			text: this.selectedLabel,
			box: { x: INSET, y: 0, width: Math.max(0, caretBox.x - CARET_GAP - INSET), height: this.height },
			font: 'body',
			size: metrics.fontSize,
			color: !enabled ? tokens.color.text_disabled : chosen ? look.text : tokens.color.text_faint,
			align: 'left',
			verticalAlign: 'middle',
			wrap: 'none',
			overflow: 'ellipsis',
		});
		drawIcon(draw, {
			glyph: this.menu ? 'expand_less' : 'expand_more',
			size: metrics.iconSize,
			tint: enabled ? tokens.color.text_dim : tokens.color.text_disabled,
			box: caretBox,
		});
	}

	private handleKey(event: UiKeyEvent): boolean {
		const { modifiers } = event;
		if (!this.effectivelyEnabled || modifiers.ctrl || modifiers.meta || modifiers.alt) return false;
		const menu = this.menu;
		switch (event.key) {
			case 'ArrowDown':
				if (!menu) this.show();
				else menu.moveHover(1, { wrap: false });
				return true;
			case 'ArrowUp':
				if (!menu) return false;
				menu.moveHover(-1, { wrap: false });
				return true;
			case 'Home':
			case 'End':
				if (!menu) return false;
				menu.hoverEdge(event.key === 'Home' ? 'first' : 'last');
				return true;
		}
		return false;
	}

	/** A user pick: close, then `onChange` when the value moved. */
	private pick(index: number): void {
		const option = this.choices[index];
		this.closeMenu();
		if (!option || option.value === this.current) return;
		this.current = option.value;
		this.onChange?.(option.value);
	}

	private get selectedIndex(): number {
		return this.choices.findIndex((option) => option.value === this.current);
	}

	private get selectedOption(): SelectOption | null {
		return this.current === null ? null : this.choices.find((option) => option.value === this.current) ?? null;
	}

	private get targetLook(): Look {
		return resolveLook(this.layers, this.stateFlags);
	}
}
