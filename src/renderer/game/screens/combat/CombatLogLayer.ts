import type { Component } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import type { DrawApi } from '../../../engine/draw/DrawApi';
import type { AnyUiEvent } from '../../../engine/input/events';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { CombatLog, CombatLogEntry } from '../../mechanics/CombatLog';
import { ChromeStack } from './ChromeStack';
import { hexRgba, rgba } from './combatStyle';

/** The mock's `.drawer` ground. */
const DRAWER_BACKGROUND = hexRgba('#0c0d0e', 0.96);
/** The mock's `.ln` colour, a step down from bone. */
const LINE_COLOR = hexRgba('#d5d0c3');
/** Section 8: log lines are 13 and wrap, on the mock's 18 px leading (a multiple of the size). */
const LINE_FONT_SIZE = 13;
const LINE_HEIGHT = 18 / LINE_FONT_SIZE;
const LINE_GAP = 8;
const LINE_RULE_GAP = 6;
/** The turn tag's column, wide enough for "T99". */
const TURN_TAG_WIDTH = 30;

/**
 * One log line: its turn tag, the one prefix a line has (DDB-123), and the
 * text, wrapping beside it, over a hairline rule.
 */
export class LogLine extends Stack {
	constructor({ entry, ...options }: StackOptions & { entry: CombatLogEntry }) {
		super({ direction: 'horizontal', padding: { bottom: LINE_RULE_GAP }, ...options });
		this.addChild(new Text({
			text: entry.turn === undefined ? '' : `T${entry.turn}`,
			width: TURN_TAG_WIDTH,
			style: { fontRole: 'mono', fontSize: 11, color: rgba('text_faint') },
			// Sits on the first line's baseline band rather than the row's top
			margin: { top: 3 },
			wrap: 'none',
		}));
		this.addChild(new Text({
			text: entry.message,
			widthMode: 'fill',
			lineHeight: LINE_HEIGHT,
			style: { fontSize: LINE_FONT_SIZE, color: LINE_COLOR },
		}));
	}

	public get text(): string {
		return (this.children[1] as Text).text;
	}

	public render(draw: DrawApi): void {
		super.render(draw);
		if (this.width <= 0 || this.height <= 0) return;
		draw.drawRect({ id: this.id ?? undefined, rect: { x: 0, y: this.height - 1, width: this.width, height: 1 }, fill: rgba('line_hairline') });
	}
}

/**
 * The combat log drawer (Battle Screen Design, section 6): 320 wide over
 * the right of the road, a header, and the lines in a scroll container that
 * follows the newest one (DDB-32). Lines wrap (section 8) and are reconciled
 * by entry id (R8.27), so a change adds the new line and drops the ones the
 * log's rolling buffer let go rather than rebuilding them all.
 *
 * Opening it moves focus to the scroll container, so the arrows, Page Up
 * and Down, Home, and End scroll it; closing it, by its key or Escape, puts
 * focus back where it was.
 */
export class CombatLogLayer extends ChromeStack {
	private readonly combatLog: CombatLog;
	private readonly scroller: ScrollContainer;
	private readonly entryList: Stack;
	/** Where focus goes back to on close, when it was in the drawer. */
	private focusBeforeOpen: Component | null = null;
	/** Focus to restore that has gone (a card played since), so the screen picks a place. */
	private readonly onFocusLost: (() => void) | null;
	private unsubscriber: (() => void) | null = null;

	constructor({ combatLog, onFocusLost, ...options }: StackOptions & { combatLog: CombatLog; onFocusLost?: () => void }) {
		super({
			direction: 'vertical',
			crossAlign: 'stretch',
			gap: LINE_GAP,
			padding: { top: 10, bottom: 10, left: 12, right: 12 },
			chrome: { fill: DRAWER_BACKGROUND, edge: { color: rgba('line_edge'), edges: { left: true } } },
			visible: false,
			...options,
		});
		this.combatLog = combatLog;
		this.onFocusLost = onFocusLost ?? null;

		this.addChild(new Text({
			text: 'Combat log',
			id: 'combat_log_title',
			style: {
				fontRole: 'display',
				fontSize: 15,
				letterSpacing: 0.12,
				textTransform: 'uppercase',
				color: rgba('text_dim'),
			},
			wrap: 'none',
		}));

		this.scroller = new ScrollContainer({ id: 'combat_log_scroll', widthMode: 'fill', heightMode: 'fill' });
		this.entryList = new Stack({ id: 'combat_log_entries', gap: LINE_GAP, crossAlign: 'stretch' });
		this.scroller.addChild(this.entryList);
		this.addChild(this.scroller);
	}

	/** The scroll container the lines are in. */
	public get scrollContainer(): ScrollContainer {
		return this.scroller;
	}

	public get isOpen(): boolean {
		return this.visible;
	}

	/** Shows the drawer and takes focus into it, remembering where focus was. */
	public openDrawer(): void {
		if (this.isOpen) return;
		this.visible = true;
		const focus = this.context?.focus;
		if (!focus) return;
		this.focusBeforeOpen = focus.focused;
		focus.focus(this.scroller);
	}

	/** Hides the drawer and, if focus was in it, puts focus back. */
	public closeDrawer(): void {
		if (!this.isOpen) return;
		const focus = this.context?.focus;
		const focusInside = focus?.focused ? this.isInclusiveAncestorOf(focus.focused) : false;
		const restore = this.focusBeforeOpen;
		this.focusBeforeOpen = null;
		this.visible = false;
		if (!focus || !focusInside) return;
		if (restore?.canReceiveFocus()) focus.focus(restore);
		else if (this.onFocusLost) this.onFocusLost();
		else focus.blur();
	}

	public toggle(): void {
		if (this.isOpen) this.closeDrawer();
		else this.openDrawer();
	}

	private isInclusiveAncestorOf(component: Component): boolean {
		for (let node: Component | null = component; node; node = node.parent) {
			if (node === (this as Component)) return true;
		}
		return false;
	}

	/** Escape inside the drawer closes it, before the screen's Escape sees it. */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.consumed || event.type !== 'keydown' || event.key !== 'Escape') return;
		this.closeDrawer();
		event.consume();
	}

	/**
	 * The model subscription is registered on mount and released on unmount
	 * (R8.14), and the lines are reconciled with the model, which may have
	 * moved on while the layer was detached.
	 */
	protected onMount(): void {
		this.unsubscriber = this.combatLog.on('change', () => this.syncEntries());
		this.syncEntries();
	}

	protected onUnmount(): void {
		this.unsubscriber?.();
		this.unsubscriber = null;
		this.focusBeforeOpen = null;
	}

	/**
	 * One line per entry, in the log's order, kept by entry id. A reader at
	 * the bottom follows the newest line (the scroll container settles at its
	 * end after the layout the new lines cause); one who scrolled up to read
	 * back stays where they are.
	 */
	private syncEntries(): void {
		const following = this.scroller.atBottom;
		this.entryList.reconcileChildren(this.combatLog.entries, {
			key: (entry) => entry.id,
			create: (entry) => new LogLine({ entry, crossAlign: 'start' }),
		});
		if (following) this.scroller.scrollToBottom();
	}
}

