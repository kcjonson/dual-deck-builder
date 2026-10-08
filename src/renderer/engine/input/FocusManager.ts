import type { Rect } from '../draw/geometry';
import type { Clock } from '../animation/Clock';
import type { Component } from '../components/Component';
import { revealInAncestors } from '../components/reveal';
import { UiFocusEvent } from './events';

export type FocusDirection = 'up' | 'down' | 'left' | 'right';

/** R9.29: which arrows move within a focus group. */
export type FocusGroupOrientation = 'horizontal' | 'vertical' | 'both';

export interface FocusGroupConfig {
	readonly orientation: FocusGroupOrientation;
	/** Past the last member an arrow goes back to the first, and the reverse. */
	readonly wrap: boolean;
}

/** The keys a focus group moves on (R9.29, R9.24). */
export type GroupKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

/**
 * Why focus is moving, which decides `focusVisible` (R9.23): a pointer
 * clears it, keyboard navigation sets it, and a programmatic move keeps
 * whatever the last input established.
 */
export type FocusReason = 'pointer' | 'keyboard' | 'programmatic';

export interface FocusManagerOptions {
	/** Stamps focus events; the frame advances it (R8.28). */
	clock: Clock;
	/** The mounted roots in mount order: the active set while no scope is pushed. */
	roots: () => readonly Component[];
	/** Whether a layout is due, so geometry read now may be stale; never, when absent. */
	layoutPending?: () => boolean;
}

interface Scope {
	readonly root: Component;
	/** Focus when the scope was pushed, restored on pop if it can still take it (R9.20). */
	restore: Component | null;
}

/** What a walk of one scope finds, cached until the tree or a focus property changes (R9.18). */
interface ScopeIndex {
	/** Tab stops in sequential order: focusables and focus groups, `tabIndex > 0` first. */
	readonly stops: readonly Component[];
	/** Every focusable in tree order, group members included, for directional search. */
	readonly all: readonly Component[];
}

/** A focus move, as the services hear it: the focused component, and whether its focus is visible (R9.23). */
export type FocusChangeListener = (focused: Component | null, visible: boolean) => void;

/**
 * Chapter 9's focus manager (9.7), one per mount context as `context.focus`.
 *
 * Nothing registers with it. Tab order is derived from the tree on demand
 * (R9.18): within the active scope, focusables with `tabIndex > 0` in
 * ascending order, then the rest in depth-first tree order, with a focus
 * group standing in for its members as one stop (R9.29). The walk is cached
 * and dropped whenever a mounted tree changes shape or a focus property
 * changes. `canReceiveFocus()` filters every move.
 *
 * A scope is a subtree root (R9.20): `pushScope(root)` traps Tab, arrows and
 * the fixup inside it and focuses its first focusable; `popScope(root)`
 * restores what was focused before. The overlay service pushes one per modal
 * and a root that unmounts pops its own.
 *
 * The dispatcher drives it from input: a press focuses the nearest focusable
 * ancestor of its target (R9.23), Tab and Shift+Tab step through the order
 * (R9.19), arrows move within a group or directionally (R9.26), and the
 * frame's layout ends with `fixup`, which moves focus off a component that
 * was hidden, disabled, or unmounted (R9.28).
 */
export class FocusManager {
	private readonly clock: Clock;
	private readonly roots: () => readonly Component[];
	private readonly layoutPending: () => boolean;
	private current: Component | null = null;
	/** Revealed while a layout was due: revealed again once it has run, unless focus or a scroller above it moves first. */
	private revealAfterLayout: Component | null = null;
	private visibleModality = false;
	private readonly scopes: Scope[] = [];
	/** Keyed by scope root, or null for the whole set of roots. */
	private readonly indexCache = new Map<Component | null, ScopeIndex>();
	/** Focus was dropped without callbacks (an unmount); the fixup moves it into the active scope. */
	private lostFocus = false;
	private readonly listeners: FocusChangeListener[] = [];
	/** What the listeners last heard, so they hear each change once. */
	private heard: { focused: Component | null; visible: boolean } = { focused: null, visible: false };

	constructor({ clock, roots, layoutPending = () => false }: FocusManagerOptions) {
		this.clock = clock;
		this.roots = roots;
		this.layoutPending = layoutPending;
	}

	/** The component keys go to, or null. */
	public get focused(): Component | null {
		return this.current;
	}

	/**
	 * The focus-visible modality (R9.23): true since the last Tab, arrow, or
	 * navigation key the focused component or a popup handled, false since
	 * the last press. Game code reads it to decide
	 * whether to move focus for a keyboard player.
	 */
	public get focusVisible(): boolean {
		return this.visibleModality;
	}

	/**
	 * Hears every change of the focused component or of whether its focus is
	 * visible, after the `blur` and `focus` events, including focus an
	 * unmount dropped. The services' view: the popup service closes on focus
	 * moving elsewhere (R9.14) and the tooltip service shows on visible focus
	 * (R12.22). Returns the unsubscribe.
	 */
	public onFocusChange(listener: FocusChangeListener): () => void {
		this.listeners.push(listener);
		return () => {
			const index = this.listeners.indexOf(listener);
			if (index !== -1) this.listeners.splice(index, 1);
		};
	}

	private notify(): void {
		const focused = this.current;
		const visible = focused !== null && this.visibleModality;
		if (this.heard.focused === focused && this.heard.visible === visible) return;
		this.heard = { focused, visible };
		for (const listener of [...this.listeners]) listener(focused, visible);
	}

	/** The innermost pushed scope's root, or null when the whole tree is the scope. */
	public get activeScope(): Component | null {
		return this.scopes.length > 0 ? this.scopes[this.scopes.length - 1].root : null;
	}

	// -- moving focus (R9.22) -------------------------------------------------

	/**
	 * Programmatic focus: `blur` on the previous component, then `focus` on
	 * this one, keeping the current modality (R9.22). Null clears focus.
	 * Returns false, changing nothing, for a component that cannot receive
	 * focus.
	 */
	public focus(component: Component | null, reason: FocusReason = 'programmatic'): boolean {
		if (component && !component.canReceiveFocus()) return false;
		const scope = this.scopes[this.scopes.length - 1];
		if (component && scope && !isInclusiveAncestor(scope.root, component)) {
			// R9.20: nothing outside the active scope takes focus, so keys never
			// reach what a modal covers (a screen mounting under a transition).
			// The request is kept: it is where focus goes when the scope pops.
			scope.restore = component;
			return false;
		}
		this.setFocus(component, reason);
		return true;
	}

	/** Clears focus, with `blur`. */
	public blur(): void {
		this.setFocus(null, 'programmatic');
	}

	/**
	 * R9.23: a press focuses the nearest inclusive ancestor of its target that
	 * can take focus, so a press on a button's label focuses the button, and
	 * clears focus when there is none. Focus moved this way is not visible.
	 */
	public focusFromPointer(target: Component | null): void {
		let node = target;
		while (node && !node.canReceiveFocus()) node = node.parent;
		this.setFocus(node, 'pointer');
	}

	/**
	 * Marks the current focus as keyboard-driven: a navigation key handled at
	 * a component a press focused shows the ring from then on (R9.23).
	 */
	public showFocusVisible(): void {
		this.visibleModality = true;
		this.current?.setFocusState(true, true);
		this.notify();
	}

	/** The first component that can take focus in `root`'s Tab order, or null. */
	public firstIn(root: Component): Component | null {
		for (const stop of this.indexOf(root).stops) {
			const target = this.resolveStop(stop);
			if (target) return target;
		}
		return null;
	}

	/** Focuses the first focusable in `root` (the active scope by default); false when it has none. */
	public focusFirst(root: Component | null = this.activeScope, reason: FocusReason = 'programmatic'): boolean {
		const stops = root ? this.indexOf(root).stops : this.stopsOfActiveScope();
		for (const stop of stops) {
			const target = this.resolveStop(stop);
			if (!target) continue;
			this.setFocus(target, reason);
			return true;
		}
		return false;
	}

	// -- sequential navigation (R9.18, R9.19) ---------------------------------

	/**
	 * Tab: the next stop in the active scope that can take focus, wrapping
	 * around, entering a focus group at its active child. With nothing
	 * focused, the first. False when nothing in the scope can take focus.
	 */
	public focusNext(): boolean {
		return this.step(1);
	}

	/** Shift+Tab: as `focusNext`, backwards; with nothing focused, the last. */
	public focusPrevious(): boolean {
		return this.step(-1);
	}

	/** The active scope's Tab order as the components focus would land on, for tests and the snapshot. */
	public get tabOrder(): Component[] {
		const order: Component[] = [];
		for (const stop of this.stopsOfActiveScope()) {
			const target = this.resolveStop(stop);
			if (target) order.push(target);
		}
		return order;
	}

	private step(delta: 1 | -1): boolean {
		const stops = this.stopsOfActiveScope();
		if (stops.length === 0) return false;
		const current = this.current;
		const from = current ? stops.indexOf(this.stopOf(current)) : -1;
		const count = stops.length;
		for (let offset = 1; offset <= count; offset++) {
			const index = from === -1
				? (delta === 1 ? offset - 1 : count - offset)
				: (from + delta * offset + count * offset) % count;
			const target = this.resolveStop(stops[index]);
			if (!target) continue;
			this.setFocus(target, 'keyboard');
			return true;
		}
		return false;
	}

	// -- focus groups (R9.29) -------------------------------------------------

	/**
	 * Moves within the focused component's group: the arrows along the
	 * group's orientation, Home and End to its ends, skipping members that
	 * cannot take focus. False when the key does not apply or the group is at
	 * its end without wrap, so the dispatcher can fall back to directional
	 * focus.
	 */
	public moveWithinGroup(key: GroupKey): boolean {
		const current = this.current;
		if (!current) return false;
		const group = this.groupOf(current);
		if (!group?.focusGroup) return false;
		const { orientation, wrap } = group.focusGroup;
		const members = groupMembers(group).filter((member) => member === current || member.canReceiveFocus());
		const index = members.indexOf(current);
		if (index === -1 || members.length < 2) return false;

		let target: Component | undefined;
		if (key === 'Home') target = members[0];
		else if (key === 'End') target = members[members.length - 1];
		else {
			const delta = groupDelta(key, orientation);
			if (delta === 0) return false;
			let next = index + delta;
			if (next < 0 || next >= members.length) {
				if (!wrap) return false;
				next = (next + members.length) % members.length;
			}
			target = members[next];
		}
		if (!target || target === current) return false;
		this.setFocus(target, 'keyboard');
		return true;
	}

	// -- directional focus (R9.26) --------------------------------------------

	/**
	 * The nearest focusable in the direction, from the focused component's
	 * `screenBounds`: candidates beyond its centre in that direction, scored
	 * by distance along the direction plus twice the distance across it, less
	 * their overlap across it. An explicit neighbour (`focusUp` and the rest)
	 * wins when it can take focus. With nothing focused, the scope's first.
	 * A candidate in a focus group the focus is not in yields to the group's
	 * active child.
	 */
	public focusDirection(direction: FocusDirection): boolean {
		const current = this.current && this.current.canReceiveFocus() ? this.current : null;
		if (!current) return this.focusFirst(this.activeScope, 'keyboard');

		const explicit = current.focusNeighbour(direction);
		if (explicit && explicit.canReceiveFocus() && this.inActiveScope(explicit)) {
			this.setFocus(explicit, 'keyboard');
			return true;
		}

		const from = current.screenBounds;
		let best: Component | null = null;
		let bestScore = Infinity;
		for (const candidate of this.allOfActiveScope()) {
			if (candidate === current || !candidate.canReceiveFocus()) continue;
			const score = directionalScore(from, candidate.screenBounds, direction);
			if (score < bestScore) {
				bestScore = score;
				best = candidate;
			}
		}
		if (!best) return false;
		this.setFocus(this.groupEntry(best, current), 'keyboard');
		return true;
	}

	/**
	 * Arriving in a focus group from outside it lands on its active child, as
	 * Tab does (R9.26, R9.29), so focus and a segmented control's or radio
	 * group's selection agree. Within a group, or with no usable active
	 * child, the nearest candidate stands.
	 */
	private groupEntry(candidate: Component, from: Component): Component {
		const group = this.groupOf(candidate);
		if (!group || group === this.groupOf(from)) return candidate;
		const active = group.activeChild;
		if (active && active.isMounted && active.canReceiveFocus() && this.groupOf(active) === group) return active;
		return candidate;
	}

	// -- scopes (R9.20) -------------------------------------------------------

	/**
	 * Makes `root`'s subtree the active scope: Tab, arrows, and the fixup stay
	 * inside it, and its first focusable takes focus unless focus is already
	 * inside. With no focusable inside, focus is cleared, so keys cannot reach
	 * what the scope covers.
	 */
	public pushScope(root: Component): void {
		if (this.scopes.some((scope) => scope.root === root)) return;
		this.scopes.push({ root, restore: this.current });
		const current = this.current;
		if (current && isInclusiveAncestor(root, current)) return;
		if (!this.focusFirst(root)) this.setFocus(null, 'programmatic');
	}

	/**
	 * Removes `root`'s scope. When it was the active one, focus goes back to
	 * what was focused when it was pushed if that can still take focus, else
	 * to the next scope's first focusable, else nowhere.
	 */
	public popScope(root: Component): void {
		const index = this.scopes.findIndex((scope) => scope.root === root);
		if (index === -1) return;
		const [removed] = this.scopes.splice(index, 1);
		if (index !== this.scopes.length) return;

		const restore = removed.restore;
		if (restore && restore.canReceiveFocus() && this.inActiveScope(restore)) {
			this.setFocus(restore, 'programmatic');
			return;
		}
		const current = this.current;
		if (current && current.canReceiveFocus() && this.inActiveScope(current)) return;
		if (this.activeScope && this.focusFirst(this.activeScope)) return;
		this.setFocus(null, 'programmatic');
	}

	// -- upkeep ---------------------------------------------------------------

	/**
	 * R9.28, at the end of every layout: focus on a component that can no
	 * longer take it (hidden, disabled, no longer focusable) is cleared with
	 * `blur`, and when a scope is active it moves to the scope's first
	 * focusable, as does focus an unmount dropped silently. A component
	 * revealed while that layout was due is revealed again against the
	 * geometry it produced (R12.20).
	 */
	public fixup(): void {
		const pending = this.revealAfterLayout;
		this.revealAfterLayout = null;
		const current = this.current;
		if (current && !current.canReceiveFocus()) {
			this.setFocus(null, 'programmatic');
			this.lostFocus = true;
		}
		if (this.lostFocus) {
			this.lostFocus = false;
			if (!this.current && this.activeScope) this.focusFirst(this.activeScope);
		}
		if (pending && pending === this.current && pending.isMounted) revealInAncestors(pending);
	}

	/**
	 * `scroller` was scrolled by the player or by code, not by a layout's
	 * re-clamp: a reveal still owed after the layout to a component inside it
	 * is dropped, so the layout doesn't undo that scroll (R12.20).
	 */
	public scrolled(scroller: Component): void {
		const pending = this.revealAfterLayout;
		if (pending && pending !== scroller && isInclusiveAncestor(scroller, pending)) this.revealAfterLayout = null;
	}

	/** Any mounted tree changed shape, or a focus property changed: the cached order is stale (R9.18). */
	public invalidateOrder(): void {
		if (this.indexCache.size > 0) this.indexCache.clear();
	}

	/**
	 * R9.21: `component` is unmounting. Focus on it is dropped without
	 * callbacks, since it may be mid-teardown; a scope rooted at it pops.
	 */
	public forget(component: Component): void {
		this.invalidateOrder();
		if (this.current === component) {
			this.current = null;
			this.lostFocus = true;
			this.notify();
		}
		for (const scope of this.scopes) {
			if (scope.restore === component) scope.restore = null;
		}
		if (this.scopes.some((scope) => scope.root === component)) this.popScope(component);
	}

	/** The shell's teardown. */
	public reset(): void {
		this.current = null;
		this.revealAfterLayout = null;
		this.scopes.length = 0;
		this.indexCache.clear();
		this.lostFocus = false;
		this.visibleModality = false;
		this.heard = { focused: null, visible: false };
	}

	// -- internals ------------------------------------------------------------

	/**
	 * Brings `component` into view in its scrolling ancestors (R12.20), and
	 * again after the layout when one is due: a dialog moves focus into its
	 * content before its first layout, when nothing in it has a size yet.
	 * Focus moving on, or a scroll of one of those ancestors, cancels the
	 * second reveal. The frame empties its dirty set before it lays out, so
	 * `layoutPending` reads false during a layout: focus set from
	 * `layoutChildren` or `onLayout` is revealed once, against geometry that
	 * may be only half placed.
	 */
	private reveal(component: Component): void {
		revealInAncestors(component);
		this.revealAfterLayout = this.layoutPending() ? component : null;
	}

	/**
	 * The one place focus changes: `blur` on the previous component, then
	 * `focus` on the next (R9.22), neither bubbling. A group member that takes
	 * focus becomes its group's active child (R9.29).
	 */
	private setFocus(next: Component | null, reason: FocusReason): void {
		if (reason === 'pointer') this.visibleModality = false;
		else if (reason === 'keyboard') this.visibleModality = true;
		const visible = this.visibleModality;
		const previous = this.current;
		if (next) {
			const group = this.groupOf(next);
			if (group) group.activeChild = next;
		}
		if (previous === next) {
			// R9.22's text-entry exception has nothing to switch here: the
			// component draws its own caret whatever the modality.
			next?.setFocusState(true, visible);
			this.notify();
			return;
		}

		this.current = next;
		this.revealAfterLayout = null;
		this.lostFocus = false;
		if (previous && previous.isMounted) {
			previous.setFocusState(false, false);
			previous.handleEvent(new UiFocusEvent({
				type: 'blur',
				timestamp: this.clock.now,
				target: previous,
				relatedTarget: next,
				focusVisible: false,
			}));
			// A blur handler that moved focus itself has the last word.
			if (this.current !== next) return;
		}
		if (next) {
			next.setFocusState(true, visible);
			next.handleEvent(new UiFocusEvent({
				type: 'focus',
				timestamp: this.clock.now,
				target: next,
				relatedTarget: previous,
				focusVisible: visible,
			}));
			// A press lands on something already in view; keyboard and code
			// may not. After the focus event, so ink its handler adds shows
			// too, and not at all when that handler moved focus on (R12.20).
			if (reason !== 'pointer' && this.current === next) this.reveal(next);
		}
		// A focus handler that moved focus again has already notified.
		if (this.current === next) this.notify();
	}

	/** A stop resolved to the component focus lands on: a group's active child or first member. */
	private resolveStop(stop: Component): Component | null {
		if (!stop.focusGroup) return stop.canReceiveFocus() ? stop : null;
		const active = stop.activeChild;
		if (active && active.isMounted && active.canReceiveFocus() && this.groupOf(active) === stop) return active;
		for (const member of groupMembers(stop)) {
			if (member.canReceiveFocus()) return member;
		}
		return null;
	}

	/** The stop a focused component belongs to: its group, or itself. */
	private stopOf(component: Component): Component {
		return this.groupOf(component) ?? component;
	}

	/** The nearest ancestor that is a focus group, below the active scope's root. */
	private groupOf(component: Component): Component | null {
		const scope = this.activeScope;
		for (let node = component.parent; node; node = node.parent) {
			if (node.focusGroup) return node;
			if (node === scope) return null;
		}
		return null;
	}

	private inActiveScope(component: Component): boolean {
		const scope = this.activeScope;
		return scope === null || isInclusiveAncestor(scope, component);
	}

	private stopsOfActiveScope(): readonly Component[] {
		const scope = this.activeScope;
		return scope ? this.indexOf(scope).stops : this.indexOfRoots().stops;
	}

	private allOfActiveScope(): readonly Component[] {
		const scope = this.activeScope;
		return scope ? this.indexOf(scope).all : this.indexOfRoots().all;
	}

	private indexOf(root: Component): ScopeIndex {
		let index = this.indexCache.get(root);
		if (!index) {
			index = buildIndex([root]);
			this.indexCache.set(root, index);
		}
		return index;
	}

	private indexOfRoots(): ScopeIndex {
		let index = this.indexCache.get(null);
		if (!index) {
			index = buildIndex(this.roots());
			this.indexCache.set(null, index);
		}
		return index;
	}
}

/**
 * One depth-first walk in insertion order (R9.18; `zIndex` never matters).
 * A focus group is one stop and its focusable descendants are its members,
 * not stops; `tabIndex < 0` takes focus from a press or programmatically but
 * is never a stop, nor a directional target.
 */
function buildIndex(roots: readonly Component[]): ScopeIndex {
	const positive: Component[] = [];
	const ordinary: Component[] = [];
	const all: Component[] = [];

	const walk = (node: Component, inGroup: boolean): void => {
		if (node.focusGroup) {
			if (!inGroup && node.tabIndex >= 0) (node.tabIndex > 0 ? positive : ordinary).push(node);
			for (const child of node.children) walk(child, true);
			return;
		}
		if (node.focusable && node.tabIndex >= 0) {
			all.push(node);
			if (!inGroup) (node.tabIndex > 0 ? positive : ordinary).push(node);
		}
		for (const child of node.children) walk(child, inGroup);
	};
	for (const root of roots) walk(root, false);

	// Array sort is stable, so equal tabIndex keeps tree order.
	positive.sort((a, b) => a.tabIndex - b.tabIndex);
	return { stops: [...positive, ...ordinary], all };
}

/** A group's members: focusable descendants in tree order, not inside a nested group. */
export function groupMembers(group: Component): Component[] {
	const members: Component[] = [];
	const walk = (node: Component): void => {
		for (const child of node.children) {
			if (child.focusGroup) continue;
			if (child.focusable) members.push(child);
			walk(child);
		}
	};
	walk(group);
	return members;
}

function groupDelta(key: GroupKey, orientation: FocusGroupOrientation): -1 | 0 | 1 {
	const horizontal = orientation !== 'vertical';
	const vertical = orientation !== 'horizontal';
	switch (key) {
		case 'ArrowLeft':
			return horizontal ? -1 : 0;
		case 'ArrowRight':
			return horizontal ? 1 : 0;
		case 'ArrowUp':
			return vertical ? -1 : 0;
		case 'ArrowDown':
			return vertical ? 1 : 0;
		default:
			return 0;
	}
}

/**
 * R9.26's cost of moving from `from` to `to` in `direction`, or Infinity
 * when `to` is not in that half-plane (its centre is not beyond `from`'s
 * centre). Distance along is between the facing edges, zero when they
 * overlap; distance across is between centres; the overlap across is the
 * bonus that keeps a row's neighbour ahead of a nearer diagonal.
 */
export function directionalScore(from: Rect, to: Rect, direction: FocusDirection): number {
	const horizontal = direction === 'left' || direction === 'right';
	const sign = direction === 'right' || direction === 'down' ? 1 : -1;

	const fromStart = horizontal ? from.x : from.y;
	const fromSize = horizontal ? from.width : from.height;
	const toStart = horizontal ? to.x : to.y;
	const toSize = horizontal ? to.width : to.height;
	const fromCentre = fromStart + fromSize / 2;
	const toCentre = toStart + toSize / 2;
	if ((toCentre - fromCentre) * sign <= 0) return Infinity;

	const fromEdge = sign > 0 ? fromStart + fromSize : fromStart;
	const toEdge = sign > 0 ? toStart : toStart + toSize;
	const along = Math.max(0, (toEdge - fromEdge) * sign);

	const fromCrossStart = horizontal ? from.y : from.x;
	const fromCrossSize = horizontal ? from.height : from.width;
	const toCrossStart = horizontal ? to.y : to.x;
	const toCrossSize = horizontal ? to.height : to.width;
	const across = Math.abs((toCrossStart + toCrossSize / 2) - (fromCrossStart + fromCrossSize / 2));
	const overlap = Math.max(0, Math.min(fromCrossStart + fromCrossSize, toCrossStart + toCrossSize) - Math.max(fromCrossStart, toCrossStart));

	return along + 2 * across - overlap;
}

function isInclusiveAncestor(ancestor: Component, node: Component): boolean {
	for (let current: Component | null = node; current; current = current.parent) {
		if (current === ancestor) return true;
	}
	return false;
}
