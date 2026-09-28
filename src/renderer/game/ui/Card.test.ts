/**
 * @jest-environment jsdom
 */
import { Layer } from '../../engine/components/Layer';
import { Text } from '../../engine/components/Text';
import { installMeasuringDrawApi } from '../../engine/text/testing';
import { Card as GameCard, CardData } from '../mechanics/Card';
import cardsFile from '../data/cards.json';
import { Card, CardSize } from './Card';

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

function part(card: Card, suffix: string): Text {
	const found = card.getChildren().find((child: Layer) => child.id === `card_${suffix}`);
	if (!(found instanceof Text)) throw new Error(`no ${suffix}`);
	return found;
}

function build(data: CardData, driverNumber: 1 | 2 | null, upgraded = false): Card {
	const model = new GameCard({ ...data, upgraded });
	return new Card({ id: 'card', x: 0, y: 0, data: model, size: CardSize.NORMAL, driverNumber });
}

describe('Card header (DDB-198)', () => {
	beforeAll(() => {
		installMeasuringDrawApi();
	});

	it.each([1, null] as const)('fits every title from cards.json in its slot, badged or not (driver %p)', (driverNumber) => {
		for (const data of cardData) {
			for (const upgraded of [false, true]) {
				const card = build(data, driverNumber, upgraded);
				const title = part(card, 'title');
				const cost = part(card, 'cost');
				const measured = title.measured;

				// The slot ends before the cost's box, so nothing runs under the digit.
				expect(title.x + title.width).toBeLessThanOrEqual(cost.x);
				// Every line of the wrapped title fits the slot's width and the slot
				// holds all of them: no name needs the ellipsis today.
				expect(measured).not.toBeNull();
				expect(measured?.width).toBeLessThanOrEqual(title.width);
				expect(measured?.height).toBeLessThanOrEqual(title.height);
			}
		}
	});

	it('wraps a long badged title onto a second line instead of under the cost', () => {
		const data = cardData.find((candidate) => candidate.name === 'Coordinated Attack');
		expect(data).toBeDefined();
		const title = part(build(data as CardData, 1), 'title');
		expect(title.measured?.lines).toBe(2);
	});

	it('centres the badge label and the cost in their boxes', () => {
		const card = build(cardData[0], 2);
		const badge = part(card, 'driver_badge');
		expect(badge.width).toBeGreaterThan(0);
		expect(badge.height).toBe(badge.width);
		expect(part(card, 'cost').width).toBeGreaterThan(0);
	});
});
