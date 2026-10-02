import type { Component } from '../components/Component';
import { Stack, StackOptions } from '../components/Stack';
import type { DrawApi } from '../draw/DrawApi';
import type { AnyUiEvent, UiActionEvent, UiKeyEvent, UiPointerEvent } from '../input/events';
import { CONTROL_SIZES, ControlSize, tabLayers } from '../style/variants';
import { tokens } from '../theme/tokens';
import { LabelledPressable } from './LabelledPressable';

export interface TabSpec {
	id: string;
	label: string;
	disabled?: boolean;
}

/** A user change: the newly selected tab's id, and the press or key that made it. */
export type TabSelectCallback = (id: string, event: UiPointerEvent | UiActionEvent | UiKeyEvent) => void;

export interface TabBarOptions extends Omit<StackOptions, 'style' | 'direction'> {
	tabs: readonly TabSpec[];
	/**
	 * Controlled when given: an unknown or disabled id shows no selection and
	 * the parent supplies a valid one. Absent, the bar starts at its first
	 * enabled tab and keeps its own selection.
	 */
	selectedId?: string | null;
	onSelect?: TabSelectCallback | null;
	/** R11.10: the bar's height and label size. */
	size?: ControlSize;
	disabled?: boolean;
}

/** One tab: its label in display caps with tracking, and the 2 px underline when selected. */
export class Tab extends LabelledPressable {
	public readonly tabId: string;

	constructor({ tabId, label, size, disabled }: { tabId: string; label: string; size: ControlSize; disabled: boolean }) {
		super({
			label,
			face: { font: 'display', size: CONTROL_SIZES[size].fontSize, letterSpacing: tokens.letterSpacing.ls_wide, textTransform: 'uppercase' },
			layers: tabLayers(),
			inset: tokens.control.inset_field,
			height: CONTROL_SIZES[size].height,
			...(disabled ? { enabled: false } : {}),
		});
		this.componentType = 'Tab';
		this.tabId = tabId;
	}

	/** Rows of tabs abut, so the ring is drawn inside, as a list row's is. */
	public get drawsOwnFocusRing(): boolean {
		return true;
	}

	public render(draw: DrawApi): void {
		const look = this.transition.look;
		const { width, height } = this;
		if (look.fill[3] > 0) draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: 0, width, height }, fill: look.fill });
		this.drawLabel(draw, { x: 0, y: 0, width, height });
		if (this.selected) {
			const underline = tokens.borderWidth.bw_thick;
			draw.drawRect({ rect: { x: 0, y: height - underline, width, height: underline }, fill: this.effectivelyEnabled ? tokens.color.accent : tokens.color.text_disabled });
		}
		if (look.focusRing) {
			draw.drawRect({
				rect: { x: 0, y: 0, width, height },
				fill: [0, 0, 0, 0],
				border: { color: look.focusRing, width: tokens.control.focus_ring_width, position: 'inside' },
			});
		}
	}
}

/** Arrows that move to the previous or next tab. */
const STEP: Readonly<Record<string, -1 | 1>> = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * R12.16's tab bar: a row of tabs over a hairline, one Tab stop entered at
 * the selected tab (a focus group, R9.29). A tab is selected on a release
 * over it (the press machine's click) or `activate`; Left and Right move
 * focus and selection together to the next enabled tab, wrapping, and Home
 * and End go to the ends. `onSelect` fires on user changes only, and never
 * for the tab already selected.
 */
export class TabBar extends Stack {
	public onSelect: TabSelectCallback | null;

	private readonly tabItems: Tab[] = [];
	private readonly controlled: boolean;
	private selection: string | null = null;

	constructor({ tabs, selectedId, onSelect = null, size = 'md', disabled = false, ...options }: TabBarOptions) {
		super({
			...(disabled ? { enabled: false } : {}),
			...options,
			direction: 'horizontal',
			gap: 0,
			focusGroup: { orientation: 'horizontal', wrap: true },
		});
		this.componentType = 'TabBar';
		this.onSelect = onSelect;
		for (const tab of tabs) {
			const item = new Tab({ tabId: tab.id, label: tab.label, size, disabled: tab.disabled ?? false });
			this.tabItems.push(item);
			this.addChild(item);
		}
		this.controlled = selectedId !== undefined;
		this.selectedId = selectedId === undefined ? this.firstEnabled?.tabId ?? null : selectedId;
	}

	public get tabs(): readonly Tab[] {
		return this.tabItems;
	}

	/** The selected tab's id, or null when none shows. */
	public get selectedId(): string | null {
		return this.selection;
	}

	/** Programmatic: never fires `onSelect`. An unknown or disabled id shows no selection. */
	public set selectedId(id: string | null) {
		const match = this.tabItems.find((tab) => tab.tabId === id && tab.enabled) ?? null;
		this.selection = match ? match.tabId : null;
		for (const tab of this.tabItems) tab.selected = tab === match;
		// Tab enters the group at the selection (R9.29).
		if (match) this.activeChild = match;
	}

	/** Whether a parent supplies the selection (`selectedId` was given at construction). */
	public get isControlled(): boolean {
		return this.controlled;
	}

	/** A tab was clicked or activated. */
	public memberPressed(member: Component, event: UiPointerEvent | UiActionEvent): void {
		if (!(member instanceof Tab) || !this.tabItems.includes(member)) return;
		this.choose(member, event);
	}

	/** Left, Right, Home, and End from a focused tab move focus and selection together. */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.type !== 'keydown' || event.consumed) return;
		const { ctrl, meta, alt, shift } = event.modifiers;
		if (ctrl || meta || alt || shift) return;
		const current = this.tabItems.find((tab) => tab.focused);
		if (!current) return;
		const enabled = this.tabItems.filter((tab) => tab === current || tab.canReceiveFocus());
		let target: Tab | undefined;
		if (event.key === 'Home') target = enabled[0];
		else if (event.key === 'End') target = enabled[enabled.length - 1];
		else if (STEP[event.key] !== undefined) {
			const index = enabled.indexOf(current);
			target = enabled[(index + STEP[event.key] + enabled.length) % enabled.length];
		}
		if (!target) return;
		event.consume();
		if (target === current) return;
		this.context?.focus.focus(target, 'keyboard');
		this.choose(target, event);
	}

	/** The hairline the tabs stand on; the selected tab's underline is drawn over it. */
	public render(draw: DrawApi): void {
		const hairline = tokens.borderWidth.bw_hair;
		draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: this.height - hairline, width: this.width, height: hairline }, fill: tokens.color.line_hairline });
	}

	private choose(tab: Tab, event: UiPointerEvent | UiActionEvent | UiKeyEvent): void {
		if (tab.tabId === this.selection || !tab.effectivelyEnabled) return;
		this.selectedId = tab.tabId;
		this.onSelect?.(tab.tabId, event);
	}

	private get firstEnabled(): Tab | null {
		return this.tabItems.find((tab) => tab.enabled) ?? null;
	}
}
