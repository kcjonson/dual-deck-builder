/**
 * @jest-environment jsdom
 */
import { Clock } from '../../engine/animation/Clock';
import type { MountContext } from '../../engine/components/MountContext';
import { clipOnScreen, createTestContext, expectWithin, inkOnScreen } from '../../engine/components/testing';
import { key, pointer, send } from '../../engine/services/testing';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { ScrollContainer } from '../../engine/ui/ScrollContainer';
import cardsFile from '../data/cards.json';
import { Card as GameCard, CardData } from '../mechanics/Card';
import { Card as UICard } from './Card';
import { openPileDialog } from './CardPileView';

/**
 * The draw and discard dialog's scroller, walked from the keys (DDB-406):
 * each card that takes focus shows top to bottom, its cost hex and ring
 * included, whichever way the walk scrolls. Only y is checked: the first
 * column's hex hangs past the scroller's left edge, a layout gap the
 * vertical reveal can't close (DDB-407, DDB-409).
 */

const cards = (cardsFile as unknown as { cards: CardData[] }).cards;

/** The dialog over nine draw-pile cards and four discards, opened, laid out, and settled. */
function open(width: number, height: number): { context: MountContext; scroll: ScrollContainer; faces: UICard[] } {
	const context = createTestContext({ draw: createMeasuringDrawApi().api, viewport: { logical: { width, height } }, clock: new Clock() });
	const pile = cards.slice(0, 9).map((data) => new GameCard(data));
	openPileDialog(context, { driverName: 'Road Warrior', driver: 1, drawPile: pile, discardPile: pile.slice(0, 4) });
	context.frame.layout();
	context.animator.settle();
	context.frame.layout();
	const scroll = context.overlays.roots.map((root) => root.findById('piles_scroll')).find((found) => found !== null);
	if (!(scroll instanceof ScrollContainer)) throw new Error('the pile dialog lost its scroller; update the lookup');
	const faces = pile.map((_card, index) => scroll.findById(`piles_draw_card_${index}`));
	if (!faces.every((face): face is UICard => face instanceof UICard)) throw new Error('the pile dialog lost its cards; update the lookup');
	return { context, scroll, faces };
}

function press(context: MountContext, name: string): void {
	send(context, [key(name), key(name, 'up')]);
}

function focusedId(context: MountContext): string | null {
	return context.focus.focused?.id ?? null;
}

describe('openPileDialog', () => {
	it.each([[1024, 600], [800, 450], [640, 400]])("shows each draw pile card's hex and ring top to bottom, walking right and back left, at %ix%i", (width, height) => {
		const { context, scroll, faces } = open(width, height);
		const shown = (face: UICard): void => expectWithin(inkOnScreen(face), clipOnScreen(scroll), 'y');
		expect(focusedId(context)).toBe(faces[0].id);
		shown(faces[0]);
		let furthest = 0;
		for (let index = 1; index < faces.length; index++) {
			press(context, 'ArrowRight');
			expect(focusedId(context)).toBe(faces[index].id);
			shown(faces[index]);
			furthest = Math.max(furthest, scroll.scrollPosition);
		}
		for (let index = faces.length - 2; index >= 0; index--) {
			press(context, 'ArrowLeft');
			expect(focusedId(context)).toBe(faces[index].id);
			shown(faces[index]);
		}
		// The walk went past the first screenful, so it scrolled
		expect(furthest).toBeGreaterThan(0);
		context.tooltips.hide();
	});

	it('opens at 800x330 with the first card shown whole once its first layout has placed it', () => {
		const { context, scroll, faces } = open(800, 330);
		expect(focusedId(context)).toBe(faces[0].id);
		expect(scroll.scrollPosition).toBeGreaterThan(0);
		expectWithin(inkOnScreen(faces[0]), clipOnScreen(scroll), 'y');
	});

	it('keeps the detail view on the focused card while the walk scrolls another under a resting pointer', () => {
		const { context, faces } = open(1024, 600);
		const foot = faces[1].screenBounds;
		send(context, [pointer('move', foot.x + foot.width / 2, foot.y + foot.height - 4)]);
		for (let step = 0; step < 4; step++) press(context, 'ArrowRight');
		expect(focusedId(context)).toBe(faces[4].id);
		// The scroll slid another card under the pointer, which doesn't take the view
		expect(faces.some((face) => face.hovered && face !== faces[4])).toBe(true);
		expect(context.tooltips.owner?.id).toBe(faces[4].id);
		context.tooltips.hide();
	});
});
