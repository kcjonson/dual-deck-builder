/**
 * @jest-environment jsdom
 */
import { Clock } from '../../../engine/animation/Clock';
import { Stack } from '../../../engine/components/Stack';
import { createTestContext } from '../../../engine/components/testing';
import { lookup } from '../testing';
import type { CardEntry } from './cardSource';
import { DeckBuilder } from './DeckBuilder';

/**
 * The builder as Customize will use it, with sources of its own: a card's
 * own copies and its borrowed ones as two stacks, a control disabled beside
 * one that says why, and no note under the pool.
 */
describe('DeckBuilder', () => {
	const own: CardEntry = {
		cardType: 'headshot',
		copies: 2,
		controls: [
			{ key: 'fewer', label: '-', reason: null, run: () => undefined },
			{ key: 'more', label: '+', reason: 'Deck full', run: () => undefined },
		],
	};
	const borrowed: CardEntry = {
		key: 'headshot_borrowed',
		cardType: 'headshot',
		copies: 1,
		state: 'borrowed',
		controls: [
			{ key: 'fewer', label: '-', reason: null, run: () => undefined },
			{ key: 'more', label: '+', reason: null, disabled: true, run: () => undefined },
		],
	};

	function mount(deck: readonly CardEntry[]): DeckBuilder {
		const context = createTestContext({ viewport: { logical: { width: 1440, height: 882 } }, clock: new Clock() });
		const builder = new DeckBuilder({
			id: 'builder',
			side: new Stack({ id: 'side', width: 200 }),
			deckHeader: new Stack({ id: 'header' }),
			deckCaption: 'Run deck',
			deck: { entries: () => deck },
			pool: { entries: () => [] },
			poolTitle: 'Locker',
			poolKicker: 'Free copies',
			cards: lookup,
			emptyDeck: 'Nothing here.',
			emptyPool: 'Nothing to borrow.',
		});
		const root = new Stack({ id: 'root', widthMode: 'fill', heightMode: 'fill', crossAlign: 'stretch' });
		root.addChild(builder);
		root.mount(context);
		builder.refresh();
		context.frame.layout();
		return builder;
	}

	it('shows two stacks of one card apart by their keys, the card type first', () => {
		const builder = mount([borrowed, own]);
		const views = builder.deckGrid.views;
		expect(views.map((view) => view.id)).toEqual(['builder_deck_grid_headshot', 'builder_deck_grid_headshot_borrowed']);
		expect(builder.deckGrid.entryFor('headshot_borrowed')?.card.miniState).toBe('borrowed');
		expect(builder.deckGrid.entryFor('headshot')?.card.copies).toBe(2);
	});

	it('disables a control with no line of its own, and says why only for one with a reason', () => {
		const builder = mount([own, borrowed]);
		const plain = builder.deckGrid.entryFor('headshot');
		const quiet = builder.deckGrid.entryFor('headshot_borrowed');
		expect([plain?.control('more')?.enabled, plain?.reason]).toEqual([false, 'Deck full']);
		expect([quiet?.control('more')?.enabled, quiet?.reason]).toEqual([false, '']);
		expect(quiet?.card.focusDown).toBe(quiet?.control('fewer'));
	});

	it('leaves the pool without a note when it has none, and hides an empty grid behind what it says', () => {
		const builder = mount([own]);
		expect(builder.findById('builder_pool_foot')?.visible).toBe(false);
		expect(builder.poolGrid.visible).toBe(false);
		expect(builder.findById('builder_pool_empty')?.visible).toBe(true);
		builder.poolNote = 'Borrowed cards come back with the driver.';
		expect(builder.findById('builder_pool_foot')?.visible).toBe(true);
	});
});
