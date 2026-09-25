import { Card, CardData } from '../mechanics/Card';
import cardsFile from './cards.json';

/**
 * Card data check (Card System Design 1.1, Battle Screen Design 5 and 8).
 * Over budget is a content bug: rewrite the text, never shrink the type.
 */

// Full text in the detail view, measured at about 357 characters with a two-line name.
const DESCRIPTION_MAX_CHARS = 330;

// Stand-in for "three lines of 12px text in a 114px box" until phase 2 text
// measurement lands and this becomes a real wrap check. Counted as rendered,
// so keyword brackets don't count. The longest current summary is 55.
const SUMMARY_MAX_CHARS = 60;

const renderedSummary = (text: string): string => text.replace(/\[(.+?)\]/g, '$1');

const cards = (cardsFile as unknown as { cards: CardData[] }).cards;

const texts = cards.flatMap((data) =>
	[false, true].map((upgraded) => {
		const card = new Card({ ...data, upgraded });
		return {
			label: `${data.type}${upgraded ? '+' : ''}`,
			summary: card.displaySummary,
			description: card.displayDescription,
		};
	})
);

describe('card data check', () => {
	it.each(texts)('$label description fits the detail view', ({ description }) => {
		expect(description.length).toBeLessThanOrEqual(DESCRIPTION_MAX_CHARS);
	});

	it.each(texts)('$label summary fits the card face', ({ summary }) => {
		expect(renderedSummary(summary).length).toBeLessThanOrEqual(SUMMARY_MAX_CHARS);
	});

	it.each(texts)('$label has no unfilled {variables}', ({ summary, description }) => {
		expect(summary).not.toMatch(/\{\w+\}/);
		expect(description).not.toMatch(/\{\w+\}/);
	});

	it('the summary proxy rejects full rules text used as a summary', () => {
		const headshot = texts.find((t) => t.label === 'headshot');
		expect(headshot).toBeDefined();
		expect(renderedSummary(headshot?.description ?? '').length).toBeGreaterThan(SUMMARY_MAX_CHARS);
	});
});
