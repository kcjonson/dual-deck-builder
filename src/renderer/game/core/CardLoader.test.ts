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

	it('accepts an order aimed at an escort', async () => {
		respondWith({ cards: [{ ...baseCard, targetType: 'escort', tags: ['order'] }] });
		await loader.loadCards();
		expect(loader.createCard('test_card')?.isOrder).toBe(true);
	});

	it('rejects an order tagged attack, so passengers can always play orders', async () => {
		respondWith({ cards: [{ ...baseCard, tags: ['order', 'attack'] }] });
		await expect(loader.loadCards()).rejects.toThrow("Card test_card is an order, so it can't also be tagged attack");
	});

	it('rejects an escort target on a card that isn\'t an order', async () => {
		respondWith({ cards: [{ ...baseCard, targetType: 'escort' }] });
		await expect(loader.loadCards()).rejects.toThrow('Card test_card commands an escort, so it must be tagged order');
	});

	it('rejects a signature card for an unknown escort type', async () => {
		respondWith({ cards: [{ ...baseCard, tags: ['order'], rarity: 'signature', signatureOf: 'war_rig' }] });
		await expect(loader.loadCards()).rejects.toThrow('Card test_card is the signature of an unknown escort type: war_rig');
	});

	it('ties signature rarity to signatureOf', async () => {
		respondWith({ cards: [{ ...baseCard, tags: ['order'], signatureOf: 'outrider' }] });
		await expect(loader.loadCards()).rejects.toThrow('Card test_card must have signature rarity exactly when it has signatureOf');
		respondWith({ cards: [{ ...baseCard, rarity: 'signature' }] });
		await expect(loader.loadCards()).rejects.toThrow('Card test_card must have signature rarity exactly when it has signatureOf');
	});
});
