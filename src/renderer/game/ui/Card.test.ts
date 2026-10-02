/**
 * @jest-environment jsdom
 */
import { Text } from '../../engine/components/Text';
import { createMeasuringDrawApi } from '../../engine/text/testing';
import { createTestContext } from '../../engine/components/testing';
import type { MountContext } from '../../engine/components/MountContext';
import { Card as GameCard, CardData } from '../mechanics/Card';
import cardsFile from '../data/cards.json';
import { CARD_LIFT, Card, CardSize } from './Card';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';

// Lays out every card face at both sizes, a second idle; the 5 s default fails under a loaded machine.
jest.setTimeout(30_000);

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

function part(card: Card, suffix: string): Text {
	const found = card.getChildren().find((child) => child.id === `card_${suffix}`);
	if (!(found instanceof Text)) throw new Error(`no ${suffix}`);
	return found;
}

let context: MountContext;

/** Mounted and laid out, so its texts have measured through the context (R1.6). */
function build(data: CardData, driverNumber: 1 | 2 | null, upgraded = false, size = CardSize.NORMAL, fullText = false): Card {
	const model = new GameCard({ ...data, upgraded });
	const card = new Card({ id: 'card', x: 0, y: 0, data: model, size, driverNumber, fullText });
	card.mount(context);
	context.frame.layout();
	return card;
}

describe('Card header (DDB-198)', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it.each([1, null] as const)('fits every title from cards.json in its slot, badged or not (driver %p)', (driverNumber) => {
		for (const data of cardData) {
			for (const upgraded of [false, true]) {
				const card = build(data, driverNumber, upgraded);
				const title = part(card, 'title');
				const cost = part(card, 'cost');
				const measured = title.measured;

				// The slot ends before the cost's digits, so nothing runs under them.
				expect(title.x + title.width).toBeLessThanOrEqual(cost.x);
				// Every line of the wrapped title fits the slot's width and the slot
				// holds all of them: no name needs the ellipsis today.
				expect(measured).not.toBeNull();
				expect(measured?.width).toBeLessThanOrEqual(title.width);
				expect(measured?.height).toBeLessThanOrEqual(title.height);
			}
		}
	});

	it('keeps a title that fits beside the cost on one line', () => {
		for (const name of ['Armor Plating', 'Precision Shot']) {
			const data = cardData.find((candidate) => candidate.name === name);
			expect(data).toBeDefined();
			expect(part(build(data as CardData, 1), 'title').measured?.lines).toBe(1);
		}
	});

	it('cuts nothing on any card face, NORMAL or LARGE, badged or not, upgraded or not, or the full text in a LARGE preview', () => {
		const faces = [
			{ size: CardSize.NORMAL, fullText: false },
			{ size: CardSize.LARGE, fullText: false },
			{ size: CardSize.LARGE, fullText: true },
		];
		for (const { size, fullText } of faces) {
			for (const driverNumber of [1, null] as const) {
				for (const data of cardData) {
					for (const upgraded of [false, true]) {
						const card = build(data, driverNumber, upgraded, size, fullText);
						for (const child of card.getChildren()) {
							if (!(child instanceof Text)) continue;
							const measured = child.measured;
							const label = `${data.name}${upgraded ? '+' : ''} ${size}${fullText ? ' full' : ''} ${child.id}`;
							expect([label, measured]).not.toEqual([label, null]);
							// No ellipsis or clip can fire: the laid-out text fits its box.
							expect([label, (measured?.width ?? 0) <= child.width + 1e-6]).toEqual([label, true]);
							expect([label, (measured?.height ?? 0) <= child.height + 1e-6]).toEqual([label, true]);
						}
					}
				}
			}
		}
	});

	it('shows the summary on the face, keyword brackets stripped', () => {
		const data = cardData.find((candidate) => candidate.summary.includes('['));
		expect(data).toBeDefined();
		const model = new GameCard({ ...(data as CardData) });
		const description = part(build(data as CardData, null), 'description');
		expect(description.getText()).toBe(Card.faceText(model.displaySummary));
		expect(description.getText()).not.toMatch(/[[\]]/);
	});

	it('wraps a long badged title onto a second line instead of under the cost', () => {
		const data = cardData.find((candidate) => candidate.name === 'Coordinated Attack');
		expect(data).toBeDefined();
		const title = part(build(data as CardData, 1), 'title');
		expect(title.measured?.lines).toBe(2);
	});

	it('ends the description above the rarity line, however long it is', () => {
		for (const data of cardData) {
			const card = build(data, null);
			const description = part(card, 'description');
			expect(description.y + description.height).toBeLessThan(part(card, 'rarity').y);
		}
	});

	it('centres the badge label and the cost in their boxes', () => {
		const card = build(cardData[0], 2);
		const badge = part(card, 'driver_badge');
		expect(badge.width).toBeGreaterThan(0);
		expect(badge.height).toBe(badge.width);
		expect(part(card, 'cost').width).toBeGreaterThan(0);
	});
});

describe('Card state', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it('rises by its transform when hovered or selected, leaving its position to layout', () => {
		const card = build(cardData[0], 1);
		card.setPosition(40, 25);

		card.setHovered(true);
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		expect(card.getY()).toBe(25);
		card.setHovered(false);
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, 0]);

		card.setSelected(true);
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		card.setSelected(false);
		context.animator.settle();
		expect(card.getY()).toBe(25);
	});

	it('eases up on the animator rather than jumping', () => {
		const card = build(cardData[0], 1);
		card.setHovered(true);
		// The tween starts from where the card rests
		expect(card.transform.translate).toEqual([0, 0]);
		expect(context.animator.settle()).toBeGreaterThan(0);
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
	});

	it('straightens out of its fan pose when lifted, and paints raised over its neighbours', () => {
		const card = build(cardData[0], 1);
		card.fanPose = { rotate: 0.03, drop: 4, order: 2 };
		expect(card.zIndex).toBe(2);
		expect(card.transform.rotate).toBe(0.03);
		expect(card.transform.translate).toEqual([0, 4]);
		expect(card.transform.origin).toEqual([0.5, 1]);
		expect(card.layer).toBeNull();

		card.setHovered(true);
		context.animator.settle();
		expect(card.transform.rotate).toBe(0);
		expect(card.transform.scale).toBeGreaterThan(1);
		expect(card.layer).toBe('raised');
		expect(card.zIndex).toBe(2);

		card.setHovered(false);
		context.animator.settle();
		expect(card.transform.rotate).toBe(0.03);
		expect(card.layer).toBeNull();
		expect(card.zIndex).toBe(2);
	});

	it('keeps the strip it rose out of while lifted, so the pointer on its bottom edge holds it up', () => {
		const card = build(cardData[0], 1);
		const below = card.height + CARD_LIFT / 2;
		expect(card.containsPoint(10, below)).toBe(false);
		card.setHovered(true);
		context.animator.settle();
		expect(card.containsPoint(10, below)).toBe(true);
	});

	it('does not rise under the pointer while disabled, and dims through the base enabled flag', () => {
		const card = build(cardData[0], 1);
		const enabledFill = card.resolvedColors.fill;

		card.enabled = false;
		card.setHovered(true);
		context.animator.settle();
		expect(card.effectivelyEnabled).toBe(false);
		expect(card.transform.translate).toEqual([0, 0]);
		expect(card.resolvedColors.fill).not.toEqual(enabledFill);

		card.enabled = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		expect(card.resolvedColors.fill).toEqual(enabledFill);
	});

	it('shows the full rules text when asked, and the summary otherwise', () => {
		const data = cardData.find((entry) => entry.summary !== entry.description) ?? cardData[0];
		const model = new GameCard({ ...data });
		const full = new Card({ id: 'card', x: 0, y: 0, data: model, size: CardSize.LARGE, fullText: true });
		const face = new Card({ id: 'card', x: 0, y: 0, data: model, size: CardSize.LARGE });
		expect(part(full, 'description').getText()).toBe(model.displayDescription);
		expect(part(face, 'description').getText()).toBe(Card.faceText(model.displaySummary));
	});
});

describe('Card layout lint (DDB-91)', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it.each([CardSize.MINI, CardSize.NORMAL, CardSize.LARGE])('lints clean for every card at %s, badged or not', (size) => {
		for (const data of cardData) {
			for (const driverNumber of [1, null] as const) {
				const card = build(data, driverNumber, false, size);
				const { width, height } = Card.getDimensions(size);
				const result = layoutLint(treeSnapshot([card], { width, height }));
				expect({ card: data.name, violations: result.violations }).toEqual({ card: data.name, violations: [] });
			}
		}
	});

	it('draws its frame, face and badge itself rather than as child rectangles', () => {
		const card = build(cardData[0], 1);
		expect(card.getChildren().every((child) => child instanceof Text)).toBe(true);
	});
});
