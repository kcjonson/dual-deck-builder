/**
 * @jest-environment jsdom
 */
import { Clock } from '../../engine/animation/Clock';
import type { Component } from '../../engine/components/Component';
import { createTestContext } from '../../engine/components/testing';
import { NO_MODIFIERS } from '../../engine/input/events';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { ScrollContainer } from '../../engine/ui/ScrollContainer';
import cardsFile from '../data/cards.json';
import { Card as GameCard, CardData } from '../mechanics/Card';
import { Card as UICard } from './Card';
import { openPileDialog } from './CardPileView';

/**
 * The draw and discard dialog's scroller, walked from the keys (DDB-406):
 * each card that takes focus shows whole, its cost hex and ring included,
 * not just its box, whichever way the walk scrolls.
 */

const cards = (cardsFile as unknown as { cards: CardData[] }).cards;

/** How far down the screen a component's own ink bound reaches. */
function inkOnScreen(component: Component): { top: number; bottom: number } {
	const ink = component.ownInkBound ?? { x: 0, y: 0, width: component.width, height: component.height };
	return {
		top: component.localToScreen({ x: ink.x, y: ink.y }).y,
		bottom: component.localToScreen({ x: ink.x, y: ink.y + ink.height }).y,
	};
}

describe('openPileDialog', () => {
	it.each([[1024, 600], [800, 450], [640, 400]])("shows each draw pile card's hex and ring as the arrows walk the pile at %ix%i", (width, height) => {
		const context = createTestContext({ draw: createMeasuringDrawApi().api, viewport: { logical: { width, height } }, clock: new Clock() });
		const pile = cards.slice(0, 9).map((data) => new GameCard(data));
		openPileDialog(context, { driverName: 'Road Warrior', driver: 1, drawPile: pile, discardPile: pile.slice(0, 4) });
		context.frame.layout();
		context.animator.settle();
		context.frame.layout();

		const scroll = context.overlays.roots.map((root) => root.findById('piles_scroll')).find((found) => found !== null);
		if (!(scroll instanceof ScrollContainer)) throw new Error('the pile dialog lost its scroller; update the lookup');
		const faces = pile.map((_card, index) => scroll.findById(`piles_draw_card_${index}`));
		const clipTop = scroll.localToScreen({ x: 0, y: scroll.clipRect.y }).y;
		const clipBottom = clipTop + scroll.clipRect.height;
		expect(context.focus.focused).toBe(faces[0]);

		for (let index = 1; index < faces.length; index++) {
			context.dispatcher.enqueue({ kind: 'key', phase: 'down', key: 'ArrowRight', repeat: false, modifiers: NO_MODIFIERS });
			context.dispatcher.enqueue({ kind: 'key', phase: 'up', key: 'ArrowRight', repeat: false, modifiers: NO_MODIFIERS });
			context.dispatcher.dispatchPending();
			context.frame.layout();
			const face = faces[index];
			expect(face).toBeInstanceOf(UICard);
			expect(context.focus.focused).toBe(face);
			if (!face) continue;
			const ink = inkOnScreen(face);
			expect(ink.top).toBeGreaterThanOrEqual(clipTop - 1e-6);
			expect(ink.bottom).toBeLessThanOrEqual(clipBottom + 1e-6);
		}
		// The walk went down past the first screenful, so it scrolled to get there
		expect(scroll.scrollPosition).toBeGreaterThan(0);
		context.tooltips.hide();
	});
});
