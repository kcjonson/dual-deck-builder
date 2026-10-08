import { Rng } from '../core/Rng';
import { resolveMapParams } from '../map/MapParams';
import { Campaign, CampaignOptions, CardBlocker, CardMove, CardPlace, CardRuleError } from './Campaign';
import { CardCounts, NO_CARDS, addCards, cardCount, totalCards } from './CardCounts';
import { DECK_RULES, cardArchetype } from './DeckRules';
import { DriverRecord } from './DriverRecord';
import { MemorySaveStorage } from './SaveStorage';
import { storeOver } from './__fixtures__/storeFixtures';

const SEED = 20261008;

const newCampaign = (options: Partial<CampaignOptions> = {}): Campaign => new Campaign({
	seed: SEED,
	generatorVersion: 1,
	mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
	...options
});

const { min, max } = DECK_RULES.deckSize;

/** A deck of `size` repair kits, a card anyone can take. */
const deckOf = (size: number): CardCounts => ({ repair_kit: size });

/** Both sets of counts added together. */
const together = (first: CardCounts, second: CardCounts): CardCounts =>
	Object.entries(second).reduce((counts, [cardType, count]) => addCards(counts, cardType, count), first);

/** Every copy in the locker and every default deck, summed here rather than by the campaign. */
const ownedByHand = (campaign: Campaign): CardCounts =>
	campaign.drivers.reduce((counts, driver) => together(counts, driver.defaultDeck), campaign.locker);

/** The error an action throws, which must be a rules refusal. */
function refusal(action: () => void): CardRuleError {
	try {
		action();
	} catch (error) {
		expect(error).toBeInstanceOf(CardRuleError);
		expect(error).toBeInstanceOf(RangeError);
		return error as CardRuleError;
	}
	throw new Error('expected the rules to refuse it');
}

/** Checks the action refuses with the blocker its check gave, and changes nothing. */
function expectRefused({ campaign, action, blocker }: { campaign: Campaign; action: () => void; blocker: CardBlocker }): void {
	const before = JSON.stringify(campaign);

	expect(refusal(action).blocker).toEqual(blocker);
	expect(JSON.stringify(campaign)).toBe(before);
}

/** Saved through a store and loaded back in a new one, as Continue does. */
async function throughStore(campaign: Campaign): Promise<Campaign> {
	const storage = new MemorySaveStorage();
	await storeOver(storage).save(campaign);
	const loaded = await storeOver(storage).load();
	if (loaded === null) throw new Error('the store kept no save');
	return loaded;
}

describe('Campaign cards under the deck rules', () => {
	describe('between the locker and a default deck', () => {
		it('add a card from the locker to a deck, and take it back', () => {
			const campaign = newCampaign({ locker: { headshot: 1 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const owned = campaign.cardsOwned;
			const add: CardMove = { cardType: 'headshot', from: 'locker', to: warrior };
			const remove: CardMove = { cardType: 'headshot', from: warrior, to: 'locker' };

			expect(campaign.getCardMoveBlocker(add)).toBeNull();
			campaign.moveCards(add);
			expect([campaign.locker, cardCount(warrior.defaultDeck, 'headshot')]).toEqual([{}, 1]);

			expect(campaign.getCardMoveBlocker(remove)).toBeNull();
			campaign.moveCards(remove);
			expect([campaign.locker, cardCount(warrior.defaultDeck, 'headshot')]).toEqual([{ headshot: 1 }, 0]);
			expect(campaign.cardsOwned).toEqual(owned);
		});

		it('count every copy the compound owns, in the locker and every deck, the dead\'s empty one included', () => {
			const campaign = newCampaign({ locker: { headshot: 2, emp_blast: 1 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
			campaign.recruitDriver({ archetype: 'interceptor' }).set({ status: 'dead', hitpoints: 0, defaultDeck: {} });

			expect(campaign.cardsOwned).toEqual(together(together(campaign.locker, warrior.defaultDeck), mechanic.defaultDeck));
			expect(Object.isFrozen(campaign.cardsOwned)).toBe(true);
		});
	});

	describe('deck size limits', () => {
		it('won\'t fill a deck past the most it holds, and say how full it is', () => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			warrior.set({ defaultDeck: deckOf(max) });
			const heard = jest.fn();
			campaign.on('change', heard);
			warrior.on('change', heard);
			const move: CardMove = { cardType: 'headshot', from: 'locker', to: warrior };

			const blocker = campaign.getCardMoveBlocker(move);

			expect(blocker).toEqual({ reason: 'deck_full', place: warrior, max });
			expectRefused({ campaign, action: () => campaign.moveCards(move), blocker: blocker as CardBlocker });
			expect(() => campaign.moveCards(move)).toThrow(`Can't add 1 headshot to Road Warrior 1's deck, which holds ${max} of at most ${max}`);
			expect(heard).not.toHaveBeenCalled();
		});

		it('count every copy a move would add', () => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			warrior.set({ defaultDeck: deckOf(max - 1) });

			expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: warrior, count: 2 })).toMatchObject({ reason: 'deck_full' });
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });

			expect(warrior.deckSize).toBe(max);
		});

		it('won\'t thin a deck below the fewest it holds', () => {
			const campaign = newCampaign();
			const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
			mechanic.set({ defaultDeck: deckOf(min) });
			const move: CardMove = { cardType: 'repair_kit', from: mechanic, to: 'locker' };

			const blocker = campaign.getCardMoveBlocker(move);

			expect(blocker).toEqual({ reason: 'deck_at_minimum', place: mechanic, min });
			expectRefused({ campaign, action: () => campaign.moveCards(move), blocker: blocker as CardBlocker });
			expect(() => campaign.moveCards(move)).toThrow(`Can't take 1 repair_kit from Mechanic 1's deck, which holds ${min} of at least ${min}`);
		});

		it('check both decks of a move between two drivers, naming the one that refuses', () => {
			const campaign = newCampaign();
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
			warrior.set({ defaultDeck: deckOf(min) });
			mechanic.set({ defaultDeck: deckOf(max) });

			expect(campaign.getCardMoveBlocker({ cardType: 'repair_kit', from: warrior, to: mechanic })).toEqual({ reason: 'deck_full', place: mechanic, max });
			mechanic.set({ defaultDeck: deckOf(min) });
			expect(campaign.getCardMoveBlocker({ cardType: 'repair_kit', from: warrior, to: mechanic })).toEqual({ reason: 'deck_at_minimum', place: warrior, min });
			warrior.set({ defaultDeck: deckOf(min + 1) });
			campaign.moveCards({ cardType: 'repair_kit', from: warrior, to: mechanic });

			expect([warrior.deckSize, mechanic.deckSize]).toEqual([min, min + 1]);
		});

		it('let a deck outside the limits, as a set can leave it, move back toward them and no further away', () => {
			const campaign = newCampaign({ locker: { headshot: 1 } });
			const short = campaign.recruitDriver({ archetype: 'road_warrior' });
			const long = campaign.recruitDriver({ archetype: 'mechanic' });
			short.set({ defaultDeck: deckOf(min - 3) });
			long.set({ defaultDeck: deckOf(max + 3) });

			expect(campaign.getCardMoveBlocker({ cardType: 'repair_kit', from: short, to: 'locker' })).toMatchObject({ reason: 'deck_at_minimum' });
			expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: long })).toMatchObject({ reason: 'deck_full' });
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: short });
			campaign.moveCards({ cardType: 'repair_kit', from: long, to: 'locker' });

			expect([short.deckSize, long.deckSize]).toEqual([min - 2, max + 2]);
		});
	});

	describe('archetype eligibility', () => {
		it('puts a card marked for an archetype only in that archetype\'s decks', () => {
			expect(cardArchetype('precision_shot')).toBe('interceptor');
			const campaign = newCampaign({ locker: { precision_shot: 1 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
			const move: CardMove = { cardType: 'precision_shot', from: 'locker', to: warrior };

			const blocker = campaign.getCardMoveBlocker(move);

			expect(blocker).toEqual({ reason: 'other_archetype', place: warrior, archetype: 'interceptor' });
			expectRefused({ campaign, action: () => campaign.moveCards(move), blocker: blocker as CardBlocker });
			expect(() => campaign.moveCards(move)).toThrow("precision_shot is for interceptor drivers only, so it can't go in Road Warrior 1's deck");
			campaign.moveCards({ cardType: 'precision_shot', from: 'locker', to: interceptor });
			expect(cardCount(interceptor.defaultDeck, 'precision_shot')).toBe(4);
		});

		it('won\'t pass one between drivers of different archetypes, and will between two of the same', () => {
			const campaign = newCampaign();
			const first = campaign.recruitDriver({ archetype: 'interceptor' });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const second = campaign.recruitDriver({ archetype: 'interceptor' });

			expect(campaign.getCardMoveBlocker({ cardType: 'precision_shot', from: first, to: warrior })).toMatchObject({ reason: 'other_archetype' });
			campaign.moveCards({ cardType: 'precision_shot', from: first, to: second });

			expect(cardCount(second.defaultDeck, 'precision_shot')).toBe(4);
		});

		it('says a card is for another archetype before it says the deck is full', () => {
			const campaign = newCampaign({ locker: { precision_shot: 1 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			warrior.set({ defaultDeck: deckOf(max) });

			expect(campaign.getCardMoveBlocker({ cardType: 'precision_shot', from: 'locker', to: warrior })).toMatchObject({ reason: 'other_archetype' });
		});

		it('let any driver take a card marked for nobody, and any card go back to the locker', () => {
			const campaign = newCampaign({ locker: { berserker: 1, headshot: 1 } });
			const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
			const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });

			campaign.moveCards({ cardType: 'berserker', from: 'locker', to: mechanic });
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: mechanic });
			campaign.moveCards({ cardType: 'precision_shot', from: interceptor, to: 'locker' });

			expect(campaign.locker).toEqual({ precision_shot: 1 });
		});
	});

	describe('scrapping', () => {
		it('scraps locker copies for scrap, in one change, and says how much it made', () => {
			const campaign = newCampaign({ locker: { emp_blast: 3 }, resources: { food: 0, water: 0, fuel: 0, meds: 0, scrap: 10, people: 0 } });
			const owned = totalCards(campaign.cardsOwned);
			const heard = jest.fn();
			campaign.on('change', heard);

			expect(campaign.getScrapBlocker({ cardType: 'emp_blast', count: 2 })).toBeNull();
			const scrap = campaign.scrapCards({ cardType: 'emp_blast', count: 2 });

			expect(scrap).toBe(2 * DECK_RULES.scrapPerCard);
			expect(campaign.resources.scrap).toBe(10 + scrap);
			expect(campaign.locker).toEqual({ emp_blast: 1 });
			expect(totalCards(campaign.cardsOwned)).toBe(owned - 2);
			expect(heard).toHaveBeenCalledTimes(1);
		});

		it('won\'t scrap more copies than the locker holds, and changes nothing', () => {
			const campaign = newCampaign({ locker: { emp_blast: 1 } });
			const blocker = campaign.getScrapBlocker({ cardType: 'emp_blast', count: 2 });

			expect(blocker).toEqual({ reason: 'too_few', place: 'locker', held: 1 });
			expectRefused({ campaign, action: () => campaign.scrapCards({ cardType: 'emp_blast', count: 2 }), blocker: blocker as CardBlocker });
			expect(() => campaign.scrapCards({ cardType: 'emp_blast', count: 2 })).toThrow("Can't scrap 2 emp_blast from the locker, which holds 1");
		});

		it('only scraps from the locker, so a deck\'s copy goes back there first', () => {
			const campaign = newCampaign();
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });

			expect(campaign.getScrapBlocker({ cardType: 'ramming_speed' })).toEqual({ reason: 'too_few', place: 'locker', held: 0 });
			campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: 'locker' });
			campaign.scrapCards({ cardType: 'ramming_speed' });

			expect([campaign.locker, campaign.resources.scrap]).toEqual([{}, DECK_RULES.scrapPerCard]);
		});

		it('won\'t scrap while a card move is being stored', () => {
			const campaign = newCampaign({ locker: { headshot: 1, emp_blast: 1 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const refused: string[] = [];
			warrior.once('defaultDeck', () => {
				try {
					campaign.scrapCards({ cardType: 'emp_blast' });
				} catch (error) {
					refused.push((error as Error).message);
				}
			});

			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });

			expect(refused).toEqual(["Campaign can't change while a card move is being stored"]);
			expect([campaign.locker, campaign.resources.scrap]).toEqual([{ emp_blast: 1 }, 0]);
		});

		it.each([
			['a count of 0', { count: 0 }, 'count must be an integer >= 1, got 0'],
			['a card by its name', { cardType: 'EMP Blast' }, 'cardType must be a card type in lower snake case, got "EMP Blast"']
		])('refuses to scrap %s, which no rule covers', (_label, options, message) => {
			const campaign = newCampaign({ locker: { emp_blast: 1 } });

			expect(() => campaign.getScrapBlocker({ cardType: 'emp_blast', ...options })).toThrow(message);
			expect(() => campaign.scrapCards({ cardType: 'emp_blast', ...options })).toThrow(message);
		});
	});

	describe('what a refusal says', () => {
		it.each([
			['dead', { status: 'dead', hitpoints: 0, defaultDeck: {} }],
			['missing', { status: 'missing' }]
		] as const)('names a %s driver at either end as away', (status, fate) => {
			const campaign = newCampaign({ locker: { headshot: 1 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const gone = campaign.recruitDriver({ archetype: 'mechanic' });
			gone.set(fate);

			for (const move of [
				{ cardType: 'headshot', from: 'locker', to: gone },
				{ cardType: 'repair_kit', from: gone, to: warrior }
			] as CardMove[]) {
				const blocker = campaign.getCardMoveBlocker(move);

				expect(blocker).toEqual({ reason: 'driver_away', place: gone });
				expectRefused({ campaign, action: () => campaign.moveCards(move), blocker: blocker as CardBlocker });
				expect(() => campaign.moveCards(move)).toThrow(`Mechanic 1 (driver-2) is ${status}, so no cards move to or from their deck`);
			}
		});

		it('names the place holding too few copies, and how many it holds', () => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });

			expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: warrior, count: 3 })).toEqual({ reason: 'too_few', place: 'locker', held: 2 });
			expect(campaign.getCardMoveBlocker({ cardType: 'emp_blast', from: warrior, to: 'locker' })).toEqual({ reason: 'too_few', place: warrior, held: 0 });
		});

		it('throws from the check, as from the move, on a move no rule covers', () => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const stranger = newCampaign().recruitDriver({ archetype: 'mechanic' });

			for (const [move, message] of [
				[{ cardType: 'headshot', from: 'locker', to: stranger }, "Mechanic 1 (driver-1) isn't in this campaign's pool"],
				[{ cardType: 'headshot', from: warrior, to: warrior }, "Can't move headshot from Road Warrior 1's deck to itself"],
				[{ cardType: 'headshot', from: 'locker', to: warrior, count: 1.5 }, 'count must be an integer >= 1, got 1.5']
			] as [CardMove, string][]) {
				expect(() => campaign.getCardMoveBlocker(move)).toThrow(message);
				expect(() => campaign.moveCards(move)).toThrow(message);
				expect(() => campaign.moveCards(move)).not.toThrow(CardRuleError);
			}
		});
	});

	describe('every copy stays in exactly one place', () => {
		/** Card types to draw from: those the crew holds, an archetype card, and one nobody holds. */
		const CARD_TYPES = ['headshot', 'precision_shot', 'emp_blast', 'repair_kit', 'armor_plating', 'ramming_speed', 'nitro_boost', 'berserker', 'flanking_maneuver', 'no_such_card'];

		/**
		 * A crew to move cards around: a deck one short of the most, one at the
		 * fewest, an injured driver, a missing one, a dead one, two drivers of
		 * one archetype, and a locker with an archetype card in it.
		 */
		function crew(): Campaign {
			const campaign = newCampaign({
				locker: { headshot: 4, precision_shot: 3, emp_blast: 2, repair_kit: 6, armor_plating: 3 },
				resources: { food: 0, water: 0, fuel: 0, meds: 0, scrap: 40, people: 0 }
			});
			campaign.recruitDriver({ archetype: 'road_warrior' });
			campaign.recruitDriver({ archetype: 'interceptor' });
			campaign.recruitDriver({ archetype: 'mechanic' }).set({ defaultDeck: { armor_plating: 2, repair_kit: min - 2 } });
			campaign.recruitDriver({ archetype: 'raider' }).set({ defaultDeck: { berserker: 3, ramming_speed: max - 4 } });
			campaign.recruitDriver({ archetype: 'road_warrior' }).set({ status: 'injured', hitpoints: 20, injuredDays: 2 });
			campaign.recruitDriver({ archetype: 'interceptor' }).set({ status: 'missing' });
			campaign.recruitDriver({ archetype: 'mechanic' }).set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
			return campaign;
		}

		/** Whether a driver here holds a deck the rules allow: inside the limits, and only cards they can take. */
		const keepsTheRules = (driver: DriverRecord): boolean =>
			driver.deckSize >= min && driver.deckSize <= max &&
			Object.keys(driver.defaultDeck).every(cardType => [null, driver.archetype].includes(cardArchetype(cardType)));

		it.each([1, 2, 3, 4, 5])('across a seeded run of moves and scraps, and through the store (seed %i)', async (seed) => {
			const rng = new Rng({ seed }).fork('card-moves');
			const campaign = crew();
			const places: CardPlace[] = ['locker', ...campaign.drivers];
			const here = campaign.drivers.filter(driver => driver.status !== 'dead' && driver.status !== 'missing');
			const away = campaign.drivers.filter(driver => !here.includes(driver)).map(driver => [driver, driver.defaultDeck] as const);
			const start = ownedByHand(campaign);
			const scrapBefore = campaign.resources.scrap;
			const outcomes = new Set<string>();
			let scrapped = NO_CARDS;

			expect(here.every(keepsTheRules)).toBe(true);
			for (let step = 0; step < 400; step += 1) {
				const from = rng.pick(places);
				// Mostly a card `from` holds, so moves land often enough to walk decks to their limits.
				const held = Object.keys(from === 'locker' ? campaign.locker : from.defaultDeck);
				const cardType = held.length > 0 && rng.int(0, 3) > 0 ? rng.pick(held) : rng.pick(CARD_TYPES);
				const count = rng.int(1, 3);
				if (rng.int(0, 9) === 0) {
					const blocker = campaign.getScrapBlocker({ cardType, count });
					if (blocker === null) {
						campaign.scrapCards({ cardType, count });
						scrapped = addCards(scrapped, cardType, count);
					} else {
						expectRefused({ campaign, action: () => campaign.scrapCards({ cardType, count }), blocker });
					}
					outcomes.add(`scrap: ${blocker?.reason ?? 'done'}`);
				} else {
					const move: CardMove = { cardType, from, to: rng.pick(places.filter(place => place !== from)), count };
					const blocker = campaign.getCardMoveBlocker(move);
					if (blocker === null) campaign.moveCards(move);
					else expectRefused({ campaign, action: () => campaign.moveCards(move), blocker });
					outcomes.add(`move: ${blocker?.reason ?? 'done'}`);
				}

				expect(together(ownedByHand(campaign), scrapped)).toEqual(start);
				expect(here.filter(driver => !keepsTheRules(driver))).toEqual([]);
			}

			expect([...outcomes].sort()).toEqual([
				'move: deck_at_minimum', 'move: deck_full', 'move: done', 'move: driver_away', 'move: other_archetype', 'move: too_few',
				'scrap: done', 'scrap: too_few'
			]);
			expect(campaign.cardsOwned).toEqual(ownedByHand(campaign));
			expect(campaign.resources.scrap).toBe(scrapBefore + totalCards(scrapped) * DECK_RULES.scrapPerCard);
			expect(away.every(([driver, deck]) => driver.defaultDeck === deck)).toBe(true);

			const loaded = await throughStore(campaign);

			expect(loaded.toJSON()).toEqual(campaign.toJSON());
			expect(loaded.cardsOwned).toEqual(campaign.cardsOwned);
		});
	});

	describe('a save', () => {
		it('keeps decks, the locker, and scrap through the store, and the campaign it loads keeps the rules', async () => {
			const campaign = newCampaign({ locker: { precision_shot: 1, emp_blast: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
			campaign.moveCards({ cardType: 'precision_shot', from: 'locker', to: interceptor });
			campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: 'locker', count: 2 });
			campaign.scrapCards({ cardType: 'emp_blast' });

			const loaded = await throughStore(campaign);
			const [loadedWarrior, loadedInterceptor] = loaded.drivers;

			expect(loaded.toJSON()).toEqual(campaign.toJSON());
			expect([loaded.locker, loaded.resources.scrap]).toEqual([{ emp_blast: 1, ramming_speed: 2 }, DECK_RULES.scrapPerCard]);
			expect(cardCount(loadedInterceptor.defaultDeck, 'precision_shot')).toBe(4);
			expect(loaded.getCardMoveBlocker({ cardType: 'precision_shot', from: loadedInterceptor, to: loadedWarrior }))
				.toEqual({ reason: 'other_archetype', place: loadedWarrior, archetype: 'interceptor' });
			loaded.moveCards({ cardType: 'ramming_speed', from: 'locker', to: loadedWarrior, count: 2 });
			expect(loaded.cardsOwned).toEqual(campaign.cardsOwned);
		});
	});
});
