import { Card, CardEffect } from './Card';

const makeCard = (upgraded = false): Card =>
	new Card({
		type: 'ramming_speed',
		name: 'Ramming Speed',
		summary: 'Deal {damage}. [Range 1]. If [Vulnerable]: +{adrenaline} Adrenaline.',
		description: 'Deal {damage} damage. If target has Vulnerable, gain {adrenaline} Adrenaline. Range 1.',
		rarity: 'common',
		cost: 2,
		targetType: 'enemy_single',
		effects: [{ type: 'damage', value: 12 }],
		variables: {
			damage: { base: 12, upgraded: 18 },
			adrenaline: { base: 1 },
		},
		tags: ['attack'],
		upgraded,
	});

describe('Card text', () => {
	it('fills summary variables with base values', () => {
		expect(makeCard().displaySummary).toBe('Deal 12. [Range 1]. If [Vulnerable]: +1 Adrenaline.');
	});

	it('fills description variables with base values', () => {
		expect(makeCard().displayDescription).toBe('Deal 12 damage. If target has Vulnerable, gain 1 Adrenaline. Range 1.');
	});

	it('uses upgraded values once upgraded, falling back to base', () => {
		const card = makeCard(true);
		expect(card.displaySummary).toBe('Deal 18. [Range 1]. If [Vulnerable]: +1 Adrenaline.');
		expect(card.displayDescription).toBe('Deal 18 damage. If target has Vulnerable, gain 1 Adrenaline. Range 1.');
	});

	it('leaves placeholders with no matching variable untouched', () => {
		const card = new Card({
			type: 'odd',
			name: 'Odd',
			summary: 'Deal {missing}.',
			description: 'Deal {missing} damage.',
			rarity: 'common',
			cost: 1,
			targetType: 'enemy_single',
			effects: [],
			tags: [],
		});
		expect(card.displaySummary).toBe('Deal {missing}.');
		expect(card.displayDescription).toBe('Deal {missing} damage.');
	});

	it('keeps the summary through copy()', () => {
		expect(makeCard().copy().summary).toBe('Deal {damage}. [Range 1]. If [Vulnerable]: +{adrenaline} Adrenaline.');
	});
});

describe('Card upgrades', () => {
	const draw = (value: number): CardEffect => ({ type: 'draw_cards', value, target: 'self' });
	const makeDrawCard = (upgraded = false): Card =>
		new Card({
			type: 'quick_draw',
			name: 'Quick Draw',
			summary: 'Draw {cards}.',
			description: 'Draw {cards} cards.',
			rarity: 'common',
			cost: 1,
			targetType: 'self',
			effects: [draw(2)],
			variables: { cards: { base: 2, upgraded: 3 } },
			upgrades: { cost: 0, effects: [draw(3)] },
			tags: ['draw'],
			upgraded,
		});
	const stateOf = (card: Card) => ({ upgraded: card.upgraded, cost: card.cost, effects: card.effects, summary: card.displaySummary });

	it('takes its upgrade block\'s cost and effects once upgraded', () => {
		expect(stateOf(makeDrawCard().upgrade())).toEqual({ upgraded: true, cost: 0, effects: [draw(3)], summary: 'Draw 3.' });
	});

	it('built upgraded, is the same card upgrade() makes', () => {
		expect(stateOf(makeDrawCard(true))).toEqual(stateOf(makeDrawCard().upgrade()));
	});

	it('keeps its upgrade through copy()', () => {
		expect(stateOf(makeDrawCard().upgrade().copy())).toEqual(stateOf(makeDrawCard().upgrade()));
	});

	it('built upgraded with no upgrade block, keeps its own cost and effects', () => {
		expect(stateOf(makeCard(true))).toEqual({ upgraded: true, cost: 2, effects: [{ type: 'damage', value: 12 }], summary: 'Deal 18. [Range 1]. If [Vulnerable]: +1 Adrenaline.' });
	});
});
