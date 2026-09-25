import { Card } from './Card';

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
