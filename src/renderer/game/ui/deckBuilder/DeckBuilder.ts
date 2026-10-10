import type { Component } from '../../../engine/components/Component';
import { Stack, StackOptions } from '../../../engine/components/Stack';
import { Text } from '../../../engine/components/Text';
import { Panel } from '../../../engine/ui/Panel';
import { ScrollContainer } from '../../../engine/ui/ScrollContainer';
import { SCROLLBAR_GUTTER } from '../../../engine/ui/Scrollbar';
import { SegmentedControl } from '../../../engine/ui/SegmentedControl';
import { tokens } from '../../../engine/theme/tokens';
import { MINI_GRID } from '../Card';
import { inspectOnContextMenu } from '../cardInspect';
import { DRIVER_CARD_SIZE } from '../DriverCard';
import { CardLookup, deckOrder } from '../DriverDetailView';
import { CardEntryGrid, CardEntryItem } from './CardEntryGrid';
import { CARD_FILTERS, CardEntry, CardFilter, CardSource, entryKey, passesFilter } from './cardSource';

const { space, fontSize } = tokens;

/** How far in a flush panel still sets its content, which clears the border and the corner radius both (R12.19). */
const FLUSH_EDGE = Math.max(tokens.borderWidth.bw, tokens.radius.radius_panel);

/**
 * The builder's spacing: between its columns, a panel's inset round what
 * isn't a grid, how far in a flush panel sets its content, and the left
 * column's width, which the Crew screen's roster and Customize's driver
 * share so the deck and the pool are as wide on both: two driver cards
 * abreast, spaced as minis are, beside a scroller's gutter, inside a flush
 * panel.
 */
export const DECK_BUILDER = {
	gap: space.space_3,
	inset: space.space_2,
	flushEdge: FLUSH_EDGE,
	sideWidth: DRIVER_CARD_SIZE.width * 2 + MINI_GRID.gap + MINI_GRID.margin * 2 + SCROLLBAR_GUTTER + FLUSH_EDGE * 2,
} as const;

export interface DeckBuilderOptions extends Omit<StackOptions, 'id' | 'direction'> {
	/** Every id inside starts with it: `<id>_deck_grid`, `<id>_pool_grid`, `<id>_pool_grid_<cardType>_add`. */
	id: string;
	/** The left column, sized by the caller: the Crew screen's roster, Customize's driver. */
	side: Component;
	/** Over the deck: whose it is and its size against the limits. */
	deckHeader: Component;
	/** The mono line between the header and the deck ("Default deck / hover a card for its detail view"). */
	deckCaption: string;
	/** Under the deck, if anything: the Crew screen's cost curve, Customize's note. */
	deckFoot?: Component | null;
	/** The deck being built. */
	deck: CardSource;
	/** What it's built from. */
	pool: CardSource;
	poolTitle: string;
	/** The small line over the pool's title. */
	poolKicker: string;
	/** The line under the pool, if any: what lands there, and what scrapping pays. */
	poolNote?: string;
	/** Where card types are looked up; a type it doesn't know is left out. */
	cards: CardLookup;
	/** Said in place of an empty deck. */
	emptyDeck: string;
	/** Said in place of an empty pool, when nothing filters it. */
	emptyPool: string;
}

/**
 * The deck-building layout the Crew screen and Customize share (Game Flow
 * 3.2 and 1.2, "the two feel like the same tool"): a column on the left the
 * caller fills, the deck in the middle under the caller's header, and the
 * pool on the right, filterable by kind, each card a mini stacked to its
 * copies with its controls under it.
 *
 * It knows nothing of campaigns. What each side holds and what its controls
 * do come from two `CardSource`s, read again on `refresh`, which the screen
 * calls when what they read changes. Each grid is one Tab stop (R9.29), and
 * each scrolls on its own (R12.20), Page Up and Page Down included, so a
 * 20-card deck and a locker of every card type fit at 1024x600.
 *
 * The deck and pool panels are flush, so their grids get every pixel
 * across, which three columns of entries need at 1024 px; what isn't a
 * grid is inset as a compact panel's content is.
 */
export class DeckBuilder extends Stack {
	public readonly deckGrid: CardEntryGrid;
	public readonly poolGrid: CardEntryGrid;
	public readonly deckScroll: ScrollContainer;
	public readonly poolScroll: ScrollContainer;
	public readonly filterControl: SegmentedControl<CardFilter>;
	private readonly deck: CardSource;
	private readonly pool: CardSource;
	private readonly cards: CardLookup;
	private readonly deckEmpty: Text;
	private readonly poolEmpty: Text;
	private readonly note: Text;
	private readonly noteSection: Stack;
	private readonly poolPanel: Panel;
	private readonly foot: Stack | null;
	private emptyDeckText: string;
	private emptyPoolText: string;
	private filterValue: CardFilter = 'all';
	/** The pool holds cards, and the filter shows none of them. */
	private filteredOut = false;

	constructor({
		id,
		side,
		deckHeader,
		deckCaption,
		deckFoot = null,
		deck,
		pool,
		poolTitle,
		poolKicker,
		poolNote = '',
		cards,
		emptyDeck,
		emptyPool,
		...options
	}: DeckBuilderOptions) {
		super({ widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch', gap: DECK_BUILDER.gap, ...options, id, direction: 'horizontal' });
		this.deck = deck;
		this.pool = pool;
		this.cards = cards;
		this.emptyDeckText = emptyDeck;
		this.emptyPoolText = emptyPool;

		// A grid that empties under focus hands it on: the locker to its filter, the deck to the locker or the filter.
		this.poolGrid = new CardEntryGrid({ id: `${id}_pool_grid`, fallback: () => this.selectedSegment() });
		this.deckGrid = new CardEntryGrid({ id: `${id}_deck_grid`, fallback: () => this.poolGrid.views[0]?.card ?? this.selectedSegment() });
		// Hidden until they hold something, so an empty grid is never a box with no height.
		this.poolGrid.visible = false;
		this.deckGrid.visible = false;
		this.deckEmpty = caption({ id: `${id}_deck_empty`, text: emptyDeck });
		this.poolEmpty = caption({ id: `${id}_pool_empty`, text: emptyPool });
		this.deckScroll = gridScroller({ id: `${id}_deck_scroll`, grid: this.deckGrid, empty: this.deckEmpty });
		this.poolScroll = gridScroller({ id: `${id}_pool_scroll`, grid: this.poolGrid, empty: this.poolEmpty });
		inspectOnContextMenu(this.deckGrid);
		inspectOnContextMenu(this.poolGrid);

		this.addChild(side);

		const deckPanel = new Panel({ id: `${id}_deck_panel`, flush: true, widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch' });
		deckPanel.addChild(insetSection({
			id: `${id}_deck_head`,
			edge: 'top',
			children: [deckHeader, new Text({
				id: `${id}_deck_caption`,
				text: deckCaption,
				widthMode: 'fill',
				style: { fontRole: 'mono', fontSize: fontSize.fs_xs, color: 'text_dim', textTransform: 'uppercase' },
				wrap: 'none',
				textOverflow: 'ellipsis',
			})],
		}));
		deckPanel.addChild(this.deckScroll);
		this.foot = deckFoot ? insetSection({ id: `${id}_deck_foot`, edge: 'bottom', children: [deckFoot] }) : null;
		if (this.foot) deckPanel.addChild(this.foot);
		this.addChild(deckPanel);

		const poolPanel = this.poolPanel = new Panel({
			id: `${id}_pool_panel`,
			title: poolTitle,
			kicker: poolKicker,
			flush: true,
			widthMode: 'fill',
			heightMode: 'fill',
			crossAlign: 'stretch',
		});
		this.filterControl = new SegmentedControl<CardFilter>({
			id: `${id}_pool_filter`,
			options: CARD_FILTERS,
			selected: 'all',
			size: 'sm',
			alignSelf: 'start',
			onChange: (value) => {
				this.filter = value;
			},
		});
		poolPanel.addChild(insetSection({ id: `${id}_pool_head`, edge: 'top', children: [this.filterControl] }));
		poolPanel.addChild(this.poolScroll);
		this.note = caption({ id: `${id}_pool_note`, text: poolNote });
		this.noteSection = insetSection({ id: `${id}_pool_foot`, edge: 'bottom', children: [this.note] });
		this.noteSection.visible = poolNote !== '';
		poolPanel.addChild(this.noteSection);
		this.addChild(poolPanel);
	}

	/** Which kind of card the pool shows. Setting it shows the pool again; the segment follows. */
	public get filter(): CardFilter {
		return this.filterValue;
	}

	public set filter(filter: CardFilter) {
		this.filterControl.value = filter;
		if (filter === this.filterValue) return;
		this.filterValue = filter;
		this.showPool();
	}

	/** The small line over the pool's title. */
	public get poolKicker(): string {
		return this.poolPanel.kicker ?? '';
	}

	public set poolKicker(text: string) {
		this.poolPanel.kicker = text;
	}

	/** The line under the pool. */
	public get poolNote(): string {
		return this.note.text;
	}

	public set poolNote(text: string) {
		this.note.text = text;
		this.noteSection.visible = text !== '';
	}

	/** Whether the deck's foot shows; a screen hides it when there's nothing true to put there. */
	public get footVisible(): boolean {
		return this.foot?.visible ?? false;
	}

	public set footVisible(visible: boolean) {
		if (this.foot) this.foot.visible = visible;
	}

	/** What an empty deck says: why there's nothing to build, when there's no driver or no campaign. */
	public get emptyDeck(): string {
		return this.emptyDeckText;
	}

	public set emptyDeck(text: string) {
		this.emptyDeckText = text;
		this.deckEmpty.text = text;
	}

	/** What an empty pool says when nothing filters it. */
	public get emptyPool(): string {
		return this.emptyPoolText;
	}

	public set emptyPool(text: string) {
		this.emptyPoolText = text;
		this.sayPoolEmpty();
	}

	/** Reads both sources again and shows what they hold. */
	public refresh(): void {
		this.showDeck();
		this.showPool();
	}

	/** A grid with nothing in it is hidden rather than drawn as an empty box, and what it says shows instead. */
	private showDeck(): void {
		this.deckGrid.show(this.ordered(this.deck.entries()));
		const empty = this.deckGrid.views.length === 0;
		this.deckGrid.visible = !empty;
		this.deckEmpty.visible = empty;
	}

	private showPool(): void {
		const all = this.ordered(this.pool.entries());
		const shown = all.filter(({ card }) => passesFilter(card, this.filterValue));
		this.poolGrid.show(shown);
		const empty = this.poolGrid.views.length === 0;
		this.poolGrid.visible = !empty;
		this.poolEmpty.visible = empty;
		this.filteredOut = all.length > 0 && shown.length === 0;
		this.sayPoolEmpty();
	}

	/** An empty pool says the filter left nothing, or what the screen says when there's nothing at all. */
	private sayPoolEmpty(): void {
		const label = CARD_FILTERS.find((option) => option.value === this.filterValue)?.label ?? '';
		this.poolEmpty.text = this.filteredOut ? `No ${label.toLowerCase()} cards here.` : this.emptyPoolText;
	}

	/**
	 * The entries whose cards the lookup knows, with their cards, cheapest
	 * first and then by name (`deckOrder`), and two stacks of one card by key.
	 */
	private ordered(entries: readonly CardEntry[]): CardEntryItem[] {
		return entries
			.flatMap((entry) => {
				const card = this.cards(entry.cardType);
				return card ? [{ entry, card }] : [];
			})
			.sort((a, b) => deckOrder(a.card, b.card) || entryKey(a.entry).localeCompare(entryKey(b.entry)));
	}

	/** The filter's selected segment, where focus goes when the locker empties under it. */
	private selectedSegment(): Component | null {
		const control = this.filterControl;
		return control.items.find((segment) => segment.value === control.value) ?? null;
	}
}

/** A grid in a scroller of its own, with what to say when it's empty. */
function gridScroller({ id, grid, empty }: { id: string; grid: CardEntryGrid; empty: Text }): ScrollContainer {
	const scroll = new ScrollContainer({ id, widthMode: 'fill', heightMode: 'fill' });
	const content = new Stack({ id: `${id}_content`, crossAlign: 'stretch' });
	content.addChild(grid);
	empty.margin = { left: DECK_BUILDER.inset, right: DECK_BUILDER.inset };
	content.addChild(empty);
	scroll.addChild(content);
	return scroll;
}

/**
 * What sits above or below a flush panel's grid, inset from the panel's
 * sides and its outer edge as a compact panel's content is.
 */
function insetSection({ id, edge, children }: { id: string; edge: 'top' | 'bottom'; children: readonly Component[] }): Stack {
	const { inset } = DECK_BUILDER;
	const section = new Stack({
		id,
		crossAlign: 'stretch',
		gap: inset,
		padding: { left: inset, right: inset, top: edge === 'top' ? inset : space.space_1, bottom: edge === 'bottom' ? inset : space.space_1 },
	});
	for (const child of children) section.addChild(child);
	return section;
}

function caption({ id, text }: { id: string; text: string }): Text {
	return new Text({ id, text, widthMode: 'fill', style: { fontSize: 'fs_sm', color: 'text_dim' } });
}
