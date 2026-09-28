import type { Component } from '../components/Component';
import type { Direction } from '../components/layoutTypes';
import { Stack, StackOptions } from '../components/Stack';
import type { UiActionEvent, UiPointerEvent } from '../input/events';
import { FocusGroupOrientation, groupMembers } from '../input/FocusManager';
import { Pressable } from './Pressable';

/** `none` leaves members alone; `single` keeps at most one selected; `multiple` toggles each. */
export type SelectionMode = 'none' | 'single' | 'multiple';

/** The selection after a user change, in member order, and the press that made it. */
export type SelectCallback = (selected: Component[], event: UiPointerEvent | UiActionEvent) => void;

export type ActivateCallback = (member: Component, event: UiPointerEvent | UiActionEvent) => void;

export interface FocusGroupOptions extends StackOptions {
	/** Which arrows move between members (R9.29). Default `vertical`. */
	orientation?: FocusGroupOrientation;
	/** Past the last member an arrow goes back to the first. Default false. */
	wrap?: boolean;
	/** Default `none`: a toolbar or a checklist selects nothing; a list says `single` or `multiple`. */
	selection?: SelectionMode;
	onSelect?: SelectCallback;
	onActivate?: ActivateCallback;
}

/**
 * R12.34's focus group (a list): a stack that is one Tab stop (R9.29), whose
 * focusable descendants the arrows, Home, and End move between, entered at
 * the member last focused. A list of ListRows is one; so is a toolbar of
 * buttons (the default `selection: 'none'`, so a pressed tool does not
 * stay selected).
 *
 * Selection is the group's, shown through each member's `selected` flag:
 * a click on a member, or `activate` on the focused one, selects it (and in
 * `multiple` mode toggles it), then `onSelect` hears the new selection when
 * it changed, and `activate` also fires `onActivate`. Members report presses
 * through `memberPressed` (they are `Pressable`s), so a member's own
 * `onClick` runs first. `select` is the programmatic form and never fires
 * `onSelect`. Type-ahead is not implemented (R12.34 makes it optional).
 */
export class FocusGroup extends Stack {
	public onSelect: SelectCallback | null = null;
	public onActivate: ActivateCallback | null = null;
	private selectionMode: SelectionMode;

	constructor({ orientation = 'vertical', wrap = false, selection = 'none', onSelect, onActivate, direction, ...options }: FocusGroupOptions = {}) {
		super({ ...options, direction: direction ?? defaultDirection(orientation), focusGroup: { orientation, wrap } });
		this.componentType = 'FocusGroup';
		this.selectionMode = selection;
		if (onSelect) this.onSelect = onSelect;
		if (onActivate) this.onActivate = onActivate;
	}

	public get selection(): SelectionMode {
		return this.selectionMode;
	}

	/** The members, in tree order: focusable descendants not inside a nested group. */
	public get members(): Component[] {
		return groupMembers(this);
	}

	/** The members the selection covers: every member but a control that keeps its own `selected` (a checkbox). */
	public get selectableMembers(): Component[] {
		return this.members.filter(takesSelection);
	}

	/** The selected members, in order. */
	public get selectedMembers(): Component[] {
		return this.selectableMembers.filter((member) => member.selected);
	}

	/**
	 * Replaces the selection without firing `onSelect`. In `single` mode only
	 * the first counts; in `none` it does nothing.
	 */
	public select(members: readonly Component[]): void {
		if (this.selectionMode === 'none') return;
		const selectable = this.selectableMembers;
		const allowed = members.filter((member) => selectable.includes(member));
		const chosen = new Set(this.selectionMode === 'single' ? allowed.slice(0, 1) : allowed);
		for (const member of selectable) member.selected = chosen.has(member);
		const first = selectable.find((member) => chosen.has(member));
		if (first) this.activeChild = first;
	}

	public memberPressed(member: Component, event: UiPointerEvent | UiActionEvent): void {
		if (!this.members.includes(member)) return;
		if (this.selectionMode !== 'none' && takesSelection(member)) {
			const before = this.selectedMembers;
			if (this.selectionMode === 'single') {
				for (const other of this.selectableMembers) other.selected = other === member;
			} else {
				member.selected = !member.selected;
			}
			const after = this.selectedMembers;
			const changed = before.length !== after.length || before.some((entry, index) => entry !== after[index]);
			if (changed) this.onSelect?.(after, event);
		}
		if (event.type === 'activate') this.onActivate?.(member, event);
	}
}

function takesSelection(member: Component): boolean {
	return !(member instanceof Pressable) || member.takesGroupSelection;
}

function defaultDirection(orientation: FocusGroupOrientation): Direction {
	return orientation === 'horizontal' ? 'horizontal' : 'vertical';
}
