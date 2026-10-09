import type { Component } from '../../../engine/components/Component';
import type { AnyUiEvent } from '../../../engine/input/events';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { tokens } from '../../../engine/theme/tokens';
import type { Card as GameCard } from '../../mechanics/Card';
import { Card as UICard, CardSize, MINI_CARD_INK, MINI_GRID } from '../Card';
import { makeInspectable } from '../cardInspect';
import { FlowWrap } from '../FlowWrap';
import { CardControl, CardEntry, entryKey } from './cardSource';

const { space, fontSize } = tokens;

/**
 * An entry's box, in its own pixels: the mini centred at the top, its
 * controls under it, and a line for why one is disabled.
 *
 * Wider than the mini so a reason ("Road Warrior only") and two controls
 * fit on one line each, an armed Scrap's "Confirm" included. The mini
 * stands `(width - 80) / 2` in from each side, so with `gap` between
 * entries two minis are 24 px apart, past `MINI_GRID.gap`, and a stack's
 * edges, count, and tag stay inside their own entry (`MINI_CARD_INK` is
 * 7). The controls start past the count that hangs below the mini.
 */
export const CARD_ENTRY = {
	width: 96,
	gap: space.space_2,
	controls: { top: MINI_CARD_INK + 1, gap: space.space_1, inset: space.space_1 },
	reason: { top: space.space_1, size: fontSize.fs_xs, line: 14 },
	/** How long an armed destructive control waits for its second press. */
	armedMs: 3000,
	/** A second press sooner than this after arming is a double-click's, not a confirmation, and is ignored. */
	confirmAfterMs: 300,
	/** What an armed destructive control says. */
	confirm: 'Confirm',
} as const;

/** A card and the entry that shows it, which a grid is handed together. */
export interface CardEntryItem {
	entry: CardEntry;
	card: GameCard;
}

/** Where focus was in an entry, so it can land on a neighbour's same part. */
type FocusSpot = { index: number; key: string; destructive: boolean };

/**
 * One card's copies with what can be done to them: the mini stacked to its
 * count, opening the card's detail view on hover, focus, or a touch hold
 * (Game Flow 7.0), its controls side by side under it, and under those why
 * a control is disabled, since a disabled control takes neither focus nor
 * hover and so can't carry a tooltip (R9.5, R12.22).
 *
 * A destructive control (Scrap) takes two presses on the same card. The
 * first arms it: it reads "Confirm" in R12.7's danger tone, in the same
 * place. A second press within `confirmAfterMs` is a double-click's and is
 * ignored. It disarms when focus or the pointer leaves it, after
 * `armedMs`, on Escape (the `cancel` action, which it consumes: R9.15,
 * R9.27), or when the entry is shown again for any change, so a card that
 * slides under the pointer or into focus after a scrap is only ever armed
 * by the next press.
 */
export class CardEntryView extends Stack {
	public readonly card: UICard;
	private readonly controlRow: Stack;
	private readonly reasonLine: Text;
	private buttons = new Map<string, Button>();
	private entry: CardEntry;
	/** The destructive control waiting for its second press, by key, and how long it waits yet. */
	private armed: string | null = null;
	private armedLeft = 0;
	/** The frame clock's time when it was armed. */
	private armedAt = 0;

	constructor({ id, data, entry }: { id: string; data: GameCard; entry: CardEntry }) {
		super({ id, width: CARD_ENTRY.width, crossAlign: 'stretch' });
		this.entry = entry;
		this.card = new UICard({ id: `${id}_card`, x: 0, y: 0, data, size: CardSize.MINI, copies: entry.copies, miniState: entry.state ?? null });
		this.card.alignSelf = 'center';
		this.card.focusable = true;
		makeInspectable(this.card);
		this.addChild(this.card);

		this.controlRow = new Stack({
			id: `${id}_controls`,
			direction: 'horizontal',
			gap: CARD_ENTRY.controls.gap,
			margin: { top: CARD_ENTRY.controls.top },
		});
		this.addChild(this.controlRow);
		this.reasonLine = new Text({
			id: `${id}_reason`,
			height: CARD_ENTRY.reason.line,
			margin: { top: CARD_ENTRY.reason.top },
			style: { fontSize: CARD_ENTRY.reason.size, color: 'text_dim', textAlign: 'center' },
			lineHeight: CARD_ENTRY.reason.line / CARD_ENTRY.reason.size,
			verticalAlign: 'middle',
			wrap: 'none',
			textOverflow: 'ellipsis',
		});
		this.addChild(this.reasonLine);
		this.show(entry);
	}

	/** The entry it shows. */
	public get shown(): CardEntry {
		return this.entry;
	}

	/** A control by its key, if the entry has one. */
	public control(key: string): Button | null {
		return this.buttons.get(key) ?? null;
	}

	/** The key of the destructive control waiting for its second press, or null. */
	public get armedControl(): string | null {
		return this.armed;
	}

	/** Why a control is disabled, as shown; empty when there's nothing to say. */
	public get reason(): string {
		return this.reasonLine.text;
	}

	/** Which part of this entry `component` is: `card`, a control's key, or null; and whether that control is destructive. */
	public spotOf(component: Component): { key: string; destructive: boolean } | null {
		if (component === this.card) return { key: 'card', destructive: false };
		for (const [key, button] of this.buttons) {
			if (button !== component) continue;
			const destructive = this.entry.controls.find((control) => control.key === key)?.destructive ?? false;
			return { key, destructive };
		}
		return null;
	}

	/**
	 * Shows the entry's copies, state, and controls in place, disarming a
	 * destructive control. A control that had focus and is now disabled
	 * hands focus to the mini above it, so it stays where the player was
	 * rather than going back to the screen's first stop (R9.28), with the
	 * reason right under it. Down from the mini goes to its first live
	 * control and Up from a control back to the mini: directional focus
	 * alone would pass a control by for the next row's mini (R9.26).
	 */
	public show(entry: CardEntry): void {
		this.entry = entry;
		this.armed = null;
		this.card.copies = entry.copies;
		this.card.miniState = entry.state ?? null;
		const keys = entry.controls.map((control) => control.key);
		if (keys.join('|') !== [...this.buttons.keys()].join('|')) this.buildControls(keys);

		const focus = this.context?.focus;
		let firstLive: Button | null = null;
		for (const control of entry.controls) {
			const button = this.buttons.get(control.key) as Button;
			button.onClick = () => this.press(control);
			button.focusUp = this.card;
			this.lookFor(control);
			const live = control.reason === null && !control.disabled;
			if (!live && focus?.focused === button) focus.focus(this.card);
			button.enabled = live;
			if (live && !firstLive) firstLive = button;
		}
		this.card.focusDown = firstLive;
		this.reasonLine.text = entry.controls.find((control) => control.reason !== null)?.reason ?? '';
	}

	/** Counts an armed control down on the frame's time. */
	public update(dt: number): void {
		if (this.armed === null) return;
		this.armedLeft -= dt * 1000;
		if (this.armedLeft <= 0) this.disarm();
		else this.requestUpdate();
	}

	/** Escape takes an armed control back to what it was, and goes no further. */
	public handleEvent(event: AnyUiEvent): void {
		super.handleEvent(event);
		if (event.type !== 'cancel' || event.consumed || this.armed === null) return;
		event.consume();
		this.disarm();
	}

	/** Runs a control, or arms a destructive one first. */
	private press(control: CardControl): void {
		const now = this.context?.clock.now ?? 0;
		if (!control.destructive || this.armed === control.key) {
			if (control.destructive && now - this.armedAt < CARD_ENTRY.confirmAfterMs) return;
			this.disarm();
			control.run();
			return;
		}
		this.disarm();
		this.armed = control.key;
		this.armedAt = now;
		this.armedLeft = CARD_ENTRY.armedMs;
		this.lookFor(control);
		this.requestUpdate();
	}

	private disarm(): void {
		const key = this.armed;
		if (key === null) return;
		this.armed = null;
		const control = this.entry.controls.find((candidate) => candidate.key === key);
		if (control) this.lookFor(control);
	}

	/** A control's label and look: its own, or armed. */
	private lookFor(control: CardControl): void {
		const button = this.buttons.get(control.key);
		if (!button) return;
		const armed = this.armed === control.key;
		button.label = armed ? CARD_ENTRY.confirm : control.label;
		button.tone = armed ? 'crit' : 'default';
		button.ghost = !armed && (control.ghost ?? false);
	}

	/** One button per control, sharing the row's width; leaving one disarms it. */
	private buildControls(keys: readonly string[]): void {
		this.controlRow.clearChildren();
		this.buttons = new Map();
		for (const key of keys) {
			const button = new Button({
				id: `${this.id}_${key}`,
				size: 'sm',
				block: true,
				style: { padding: { left: CARD_ENTRY.controls.inset, right: CARD_ENTRY.controls.inset } },
			});
			const leave = (): void => {
				if (this.armed === key) this.disarm();
			};
			button.onBlur = leave;
			button.onPointerLeave = leave;
			this.buttons.set(key, button);
			this.controlRow.addChild(button);
		}
	}
}

/**
 * A grid of card entries, spaced as `CARD_ENTRY` says and one focus group
 * (R9.29): Left and Right walk every mini and control in reading order, Up
 * and Down go between a mini and its controls, and on to the next row by
 * directional focus (R9.24, R9.26).
 *
 * `show` reconciles by entry key (R8.27): an entry that stays keeps its
 * components, hover, and focus, and only what changed is redrawn. When the
 * entry with focus goes (its last copy moved), focus lands on the same part
 * of the entry now in its place, or the one before it; after a destructive
 * control, on that entry's mini, so the next press can't destroy a card the
 * player didn't aim at. With no entry left, focus goes to `fallback`.
 */
export class CardEntryGrid extends FlowWrap {
	private readonly fallback: () => Component | null;

	constructor({ id, fallback = () => null }: { id: string; fallback?: () => Component | null }) {
		super({
			id,
			margin: MINI_GRID.margin,
			gap: CARD_ENTRY.gap,
			focusGroup: { orientation: 'horizontal' },
		});
		this.fallback = fallback;
	}

	/** The entries shown, in order. */
	public get views(): readonly CardEntryView[] {
		return this.children.filter((child): child is CardEntryView => child instanceof CardEntryView);
	}

	/** The entry with this key (its card type, unless it has a key of its own), if it's shown. */
	public entryFor(key: string): CardEntryView | null {
		return this.views.find((view) => entryKey(view.shown) === key) ?? null;
	}

	/** Shows these entries in this order; the caller sorts and filters. */
	public show(items: readonly CardEntryItem[]): void {
		const spot = this.focusSpot();
		this.reconcileChildren(items, {
			key: ({ entry }) => entryKey(entry),
			create: ({ entry, card }) => new CardEntryView({ id: `${this.id}_${entryKey(entry)}`, data: card, entry }),
			update: (view: CardEntryView, { entry }) => view.show(entry),
		});
		if (spot) this.restoreFocus(spot);
	}

	/** Where focus is among the entries, if it's in one. */
	private focusSpot(): FocusSpot | null {
		const focused = this.context?.focus.focused;
		if (!focused) return null;
		const views = this.views;
		for (let index = 0; index < views.length; index += 1) {
			const spot = views[index].spotOf(focused);
			if (spot !== null) return { index, ...spot };
		}
		return null;
	}

	/** Focus went with its entry: the same part of the entry now at its place, or the last, else the fallback. */
	private restoreFocus({ index, key, destructive }: FocusSpot): void {
		const focus = this.context?.focus;
		if (!focus || focus.focused !== null) return;
		const views = this.views;
		if (views.length === 0) {
			const fallback = this.fallback();
			if (fallback) focus.focus(fallback);
			return;
		}
		const view = views[Math.min(index, views.length - 1)];
		const control = key === 'card' || destructive ? null : view.control(key);
		focus.focus(control?.canReceiveFocus() ? control : view.card);
	}
}
