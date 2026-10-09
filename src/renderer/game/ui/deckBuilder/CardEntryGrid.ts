import type { Component } from '../../../engine/components/Component';
import { Stack } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Button } from '../../../engine/ui/Button';
import { tokens } from '../../../engine/theme/tokens';
import type { Card as GameCard } from '../../mechanics/Card';
import { Card as UICard, CardSize, MINI_CARD_INK, MINI_GRID } from '../Card';
import { makeInspectable } from '../cardInspect';
import { FlowWrap } from '../FlowWrap';
import type { CardEntry } from './cardSource';

const { space, fontSize } = tokens;
const MINI = UICard.getDimensions(CardSize.MINI);

/**
 * An entry's box, in its own pixels: the mini centred at the top, its
 * controls under it, and a line for why one is disabled.
 *
 * Wider than the mini so a reason ("Road Warrior only") and two controls
 * fit on one line each. The mini stands `(width - 80) / 2` in from each
 * side, so with `gap` between entries two minis are 24 px apart, past
 * `MINI_GRID.gap`, and a stack's edges, count, and tag stay inside their
 * own entry (`MINI_CARD_INK` is 7). The controls start past the count that
 * hangs below the mini.
 */
export const CARD_ENTRY = {
	width: 96,
	gap: space.space_2,
	controls: { top: MINI_CARD_INK + 1, gap: space.space_1, inset: space.space_2 },
	reason: { top: space.space_1, size: fontSize.fs_xs, line: 14 },
} as const;

/** The height of one entry: the mini, its controls, and the reason line. */
export const CARD_ENTRY_HEIGHT = MINI.height + CARD_ENTRY.controls.top + tokens.control.control_h_sm + CARD_ENTRY.reason.top + CARD_ENTRY.reason.line;

/** The height `rows` rows of entries take, the grid's margin left out. */
export function cardEntryGridHeight(rows: number): number {
	return rows > 0 ? rows * CARD_ENTRY_HEIGHT + (rows - 1) * CARD_ENTRY.gap : 0;
}

/** Where focus was in an entry, so it can land on the same control of a neighbour. */
type FocusSpot = { index: number; key: string };

/**
 * One card's copies with what can be done to them: the mini stacked to its
 * count, opening the card's detail view on hover, focus, or a touch hold
 * (Game Flow 7.0), its controls side by side under it, and under those why
 * a control is disabled, since a disabled control takes neither focus nor
 * hover and so can't carry a tooltip (R9.5, R12.22).
 */
export class CardEntryView extends Stack {
	public readonly card: UICard;
	private readonly controlRow: Stack;
	private readonly reasonLine: Text;
	private buttons = new Map<string, Button>();
	private entry: CardEntry;

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

	/** Why a control is disabled, as shown; empty when every control is live. */
	public get reason(): string {
		return this.reasonLine.text;
	}

	/** The key of the part of this entry that is `component`: `card` or a control's, else null. */
	public spotOf(component: Component): string | null {
		if (component === this.card) return 'card';
		for (const [key, button] of this.buttons) if (button === component) return key;
		return null;
	}

	/**
	 * Shows the entry's copies, state, and controls in place. A control that
	 * had focus and is now disabled hands focus to the mini above it, so it
	 * stays where the player was rather than going back to the screen's
	 * first stop (R9.28), with the reason right under it.
	 */
	public show(entry: CardEntry): void {
		this.entry = entry;
		this.card.copies = entry.copies;
		this.card.miniState = entry.state ?? null;
		const keys = entry.controls.map((control) => control.key);
		if (keys.join('|') !== [...this.buttons.keys()].join('|')) this.buildControls(keys);

		const focus = this.context?.focus;
		for (const control of entry.controls) {
			const button = this.buttons.get(control.key) as Button;
			button.label = control.label;
			button.ghost = control.ghost ?? false;
			button.onClick = () => control.run();
			const live = control.reason === null;
			if (!live && focus?.focused === button) focus.focus(this.card);
			button.enabled = live;
		}
		this.reasonLine.text = entry.controls.find((control) => control.reason !== null)?.reason ?? '';
	}

	/** One button per control, sharing the row's width. */
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
			this.buttons.set(key, button);
			this.controlRow.addChild(button);
		}
	}
}

/**
 * A grid of card entries, spaced as `CARD_ENTRY` says and one focus group
 * (R9.29): Left and Right walk every mini and control in reading order, and
 * Up and Down go unconsumed to directional focus (R9.24, R9.26), so they
 * move between a mini and its controls and between rows.
 *
 * `show` reconciles by card type (R8.27): an entry that stays keeps its
 * components, hover, and focus, and only what changed is redrawn. When the
 * entry with focus goes (its last copy moved), focus lands on the same
 * control of the entry now in its place, or the one before it, rather than
 * going back to the screen's first stop.
 */
export class CardEntryGrid extends FlowWrap {
	private readonly cards: (type: string) => GameCard | null;

	constructor({ id, cards }: { id: string; cards: (type: string) => GameCard | null }) {
		super({
			id,
			margin: MINI_GRID.margin,
			gap: CARD_ENTRY.gap,
			focusGroup: { orientation: 'horizontal' },
		});
		this.cards = cards;
	}

	/** The entries shown, in order. */
	public get views(): readonly CardEntryView[] {
		return this.children.filter((child): child is CardEntryView => child instanceof CardEntryView);
	}

	/** The entry for a card type, if it's shown. */
	public entryFor(cardType: string): CardEntryView | null {
		return this.views.find((view) => view.shown.cardType === cardType) ?? null;
	}

	/**
	 * Shows these entries in this order, each one whose card the lookup
	 * knows; the caller sorts and filters.
	 */
	public show(entries: readonly CardEntry[]): void {
		const known = entries.flatMap((entry) => {
			const data = this.cards(entry.cardType);
			return data ? [{ entry, data }] : [];
		});
		const spot = this.focusSpot();
		this.reconcileChildren(known, {
			key: ({ entry }) => entry.cardType,
			create: ({ entry, data }) => new CardEntryView({ id: `${this.id}_${entry.cardType}`, data, entry }),
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
			const key = views[index].spotOf(focused);
			if (key !== null) return { index, key };
		}
		return null;
	}

	/** Focus went with its entry: the same control of the entry now at its place, or the last, else that entry's mini. */
	private restoreFocus({ index, key }: FocusSpot): void {
		const focus = this.context?.focus;
		if (!focus || focus.focused !== null) return;
		const views = this.views;
		if (views.length === 0) return;
		const view = views[Math.min(index, views.length - 1)];
		const control = key === 'card' ? null : view.control(key);
		focus.focus(control?.canReceiveFocus() ? control : view.card);
	}
}
