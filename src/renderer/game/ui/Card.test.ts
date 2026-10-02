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
import { KeywordText } from './KeywordText';
import { Icon } from '../../engine/components/Icon';
import type { Component } from '../../engine/components/Component';
import { DRIVER_COLORS, hexRgba } from '../screens/combat/combatStyle';
import { layoutLint } from '../../engine/debug/layoutLint';
import { treeSnapshot } from '../../engine/debug/treeSnapshot';

// Lays out every card face at both sizes; the 5 s default fails under a loaded machine.
jest.setTimeout(30_000);

const cardData = (cardsFile as unknown as { cards: CardData[] }).cards;

function part(card: Card, suffix: string): Text {
	const found = card.children.find((child) => child.id === `card_${suffix}`);
	if (!(found instanceof Text)) throw new Error(`no ${suffix}`);
	return found;
}

let context: MountContext;

/** Mounted and laid out, so its texts have measured through the context (R1.6). */
function build(data: CardData, driverNumber: 1 | 2 | null, upgraded = false, size = CardSize.NORMAL): Card {
	const model = new GameCard({ ...data, upgraded });
	const card = new Card({ id: 'card', x: 0, y: 0, data: model, size, driverNumber });
	card.mount(context);
	context.frame.layout();
	return card;
}

/** Every Text under `root`, at any depth. */
function texts(root: Component): Text[] {
	return root.children.flatMap((child) => (child instanceof Text ? [child] : texts(child)));
}

describe('Card face (Battle Screen Design, section 5)', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it('is 128x180, the hand\'s card size', () => {
		expect(Card.getDimensions(CardSize.NORMAL)).toEqual({ width: 128, height: 180 });
	});

	it('fits every name from cards.json in its slot at 16 or 14, upgraded or not, without the ellipsis', () => {
		for (const data of cardData) {
			for (const upgraded of [false, true]) {
				const card = build(data, 1, upgraded);
				const title = part(card, 'title');
				expect([data.name, upgraded, [16, 14]]).toEqual([data.name, upgraded, expect.arrayContaining([card.nameSize])]);
				expect([data.name, upgraded, (title.measured?.width ?? Infinity) <= title.width]).toEqual([data.name, upgraded, true]);
			}
		}
	});

	it('shrinks a name too wide at 16 to 14, then cuts one too wide even then with an ellipsis', () => {
		const base = cardData.find((candidate) => candidate.name === 'Ram') as CardData;
		expect(build(base, 1).nameSize).toBe(16);
		const longer = build({ ...base, name: 'Coordinated Rammings' }, 1);
		expect(longer.nameSize).toBe(14);
		expect(part(longer, 'title').overflowOutcome).toBe('none');
		const longest = build({ ...base, name: 'Coordinated Convoy Ramming Assault' }, 1);
		expect(longest.nameSize).toBe(14);
		expect(part(longest, 'title').overflowOutcome).toBe('ellipsis');
	});

	it('cuts nothing on any face, badged or not, upgraded or not', () => {
		for (const size of [CardSize.NORMAL, CardSize.MINI]) {
			for (const driverNumber of [1, null] as const) {
				for (const data of cardData) {
					for (const upgraded of [false, true]) {
						const card = build(data, driverNumber, upgraded, size);
						for (const child of texts(card)) {
							if (!child.visible) continue;
							const measured = child.measured;
							const label = `${data.name}${upgraded ? '+' : ''} ${size} ${child.id}`;
							expect([label, measured]).not.toEqual([label, null]);
							expect([label, (measured?.width ?? 0) <= child.width + 1e-6]).toEqual([label, true]);
							expect([label, (measured?.height ?? 0) <= child.height + 1e-6]).toEqual([label, true]);
						}
					}
				}
			}
		}
	});

	it('shows the summary with its bracketed keywords highlighted and the brackets gone', () => {
		const data = cardData.find((candidate) => candidate.type === 'ramming_speed') as CardData;
		const card = build(data, 1);
		const words = card.faceWords;
		expect(words.flat().some((piece) => /[[\]]/.test(piece.text))).toBe(false);
		expect(words.flat().filter((piece) => piece.keyword).map((piece) => piece.text)).toEqual(['Range', '1', 'Vulnerable']);
		expect(words.map((word) => word.map((piece) => piece.text).join('')).join(' ')).toBe(new GameCard({ ...data }).displaySummary.replace(/[[\]]/g, ''));
	});

	it('keeps the summary inside its three lines, above the foot', () => {
		for (const data of cardData) {
			const card = build(data, null);
			expect([data.name, card.summaryLines <= 3]).toEqual([data.name, true]);
			for (const word of texts(card).filter((text) => text.id?.startsWith('card_description_'))) {
				expect(word.y + word.height).toBeLessThanOrEqual(51 + 1e-6);
			}
		}
	});

	it('frames the card in its driver\'s colour, never its rarity\'s', () => {
		const rare = cardData.find((candidate) => candidate.rarity === 'rare') as CardData;
		const amber = hexRgba(DRIVER_COLORS[1]);
		expect(build(rare, 1).resolvedColors?.border).toEqual(amber);
		const unowned = build(rare, null).resolvedColors?.border;
		expect(unowned).not.toEqual(hexRgba(Card.colorForRarity('rare')));
	});

	it('reaches past its top-left corner for the cost hex, and says so in its ink', () => {
		expect(build(cardData[0], 1).inkExtent).toBe(7);
		expect(build(cardData[0], 1, false, CardSize.MINI).inkExtent).toBe(0);
	});

	it('marks a card its driver can\'t pay for, apart from being disabled', () => {
		const card = build(cardData[0], 1);
		expect(card.unaffordable).toBe(false);
		card.unaffordable = true;
		expect(card.unaffordable).toBe(true);
		expect(card.effectivelyEnabled).toBe(true);
	});

	it('shows the range a card reaches as a chip, and none on a card without one', () => {
		const ranged = build(cardData.find((candidate) => candidate.type === 'far_shoot') as CardData, 1);
		expect(part(ranged, 'range').text).toBe('R2');
		const unranged = build(cardData.find((candidate) => candidate.type === 'repair_kit') as CardData, 1);
		expect(unranged.children.some((child) => child.id === 'card_range')).toBe(false);
	});
});

describe('Card state', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it('rises by its transform when hovered or selected, leaving its position to layout', () => {
		const card = build(cardData[0], 1);
		card.setPosition(40, 25);

		card.hovered = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		expect(card.y).toBe(25);
		card.hovered = false;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, 0]);

		card.selected = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		card.selected = false;
		context.animator.settle();
		expect(card.y).toBe(25);
	});

	it('eases up on the animator rather than jumping', () => {
		const card = build(cardData[0], 1);
		card.hovered = true;
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

		card.hovered = true;
		context.animator.settle();
		expect(card.transform.rotate).toBe(0);
		expect(card.transform.scale).toBeGreaterThan(1);
		expect(card.layer).toBe('raised');
		expect(card.zIndex).toBe(2);

		card.hovered = false;
		context.animator.settle();
		expect(card.transform.rotate).toBe(0.03);
		expect(card.layer).toBeNull();
		expect(card.zIndex).toBe(2);
	});

	it('stays in its place when not liftable, as a pile\'s or the browser\'s cards do', () => {
		const card = build(cardData[0], 1);
		card.liftable = false;
		card.hovered = true;
		card.selected = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, 0]);
		expect(card.layer).toBeNull();
		expect(card.resolvedColors?.border).not.toEqual(hexRgba(DRIVER_COLORS[1]));
	});

	it('keeps the strip it rose out of while lifted, so the pointer on its bottom edge holds it up', () => {
		const card = build(cardData[0], 1);
		const below = card.height + CARD_LIFT / 2;
		expect(card.containsPoint(10, below)).toBe(false);
		card.hovered = true;
		context.animator.settle();
		expect(card.containsPoint(10, below)).toBe(true);
	});

	it('does not rise under the pointer while disabled, and dims through the base enabled flag', () => {
		const card = build(cardData[0], 1);
		const enabledFill = card.resolvedColors.fill;

		card.enabled = false;
		card.hovered = true;
		context.animator.settle();
		expect(card.effectivelyEnabled).toBe(false);
		expect(card.transform.translate).toEqual([0, 0]);
		expect(card.resolvedColors.fill).not.toEqual(enabledFill);

		card.enabled = true;
		context.animator.settle();
		expect(card.transform.translate).toEqual([0, -CARD_LIFT]);
		expect(card.resolvedColors.fill).toEqual(enabledFill);
	});
});

describe('Card layout lint (DDB-91)', () => {
	beforeAll(() => {
		context = createTestContext({ draw: createMeasuringDrawApi().api });
	});

	it.each([CardSize.MINI, CardSize.NORMAL])('lints clean for every card at %s, badged or not', (size) => {
		for (const data of cardData) {
			for (const driverNumber of [1, null] as const) {
				const card = build(data, driverNumber, false, size);
				const { width, height } = Card.getDimensions(size);
				const result = layoutLint(treeSnapshot([card], { width, height }));
				expect({ card: data.name, violations: result.violations }).toEqual({ card: data.name, violations: [] });
			}
		}
	});

	it('draws its frame, art ground, hex, mark and gem itself rather than as child shapes', () => {
		const card = build(cardData[0], 1);
		expect(card.children.every((child) => child instanceof Text || child instanceof KeywordText || child instanceof Icon)).toBe(true);
	});
});
