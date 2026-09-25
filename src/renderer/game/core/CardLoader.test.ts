import { CardLoader } from './CardLoader';
import cardsFile from '../data/cards.json';

const respondWith = (body: unknown): void => {
	global.fetch = jest.fn().mockResolvedValue({
		ok: true,
		statusText: 'OK',
		json: async () => body,
	}) as unknown as typeof fetch;
};

const baseCard = {
	type: 'test_card',
	name: 'Test Card',
	summary: 'Deal {damage}.',
	description: 'Deal {damage} damage.',
	rarity: 'common',
	cost: 1,
	targetType: 'enemy_single',
	effects: [],
	variables: { damage: { base: 3 } },
	tags: [],
};

describe('CardLoader', () => {
	const originalFetch = global.fetch;
	const loader = CardLoader.getInstance();

	beforeEach(() => {
		jest.spyOn(console, 'log').mockImplementation(() => undefined);
		jest.spyOn(console, 'error').mockImplementation(() => undefined);
	});

	afterEach(() => {
		global.fetch = originalFetch;
		jest.restoreAllMocks();
	});

	it('loads every card in the real cards.json', async () => {
		respondWith(cardsFile);
		await loader.loadCards();
		expect(loader.getCardCount()).toBe(cardsFile.cards.length);
		expect(loader.createCard('point_blank')?.displaySummary).toBe('Deal 3. [Range 1]. +1 to hit.');
	});

	it('rejects a card with no summary', async () => {
		const withoutSummary: Partial<typeof baseCard> = { ...baseCard };
		delete withoutSummary.summary;
		respondWith({ cards: [withoutSummary] });
		await expect(loader.loadCards()).rejects.toThrow('Card test_card missing required field: summary');
	});

	it('rejects a card with an empty summary', async () => {
		respondWith({ cards: [{ ...baseCard, summary: '  ' }] });
		await expect(loader.loadCards()).rejects.toThrow('Card test_card summary must be a non-empty string');
	});

	it('rejects a card with an empty description', async () => {
		respondWith({ cards: [{ ...baseCard, description: '' }] });
		await expect(loader.loadCards()).rejects.toThrow('Card test_card description must be a non-empty string');
	});
});
