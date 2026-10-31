import { resolveMapParams } from '../map/MapParams';
import { createEscort } from '../mechanics/Escort';
import { Vehicle } from '../mechanics/Vehicle';
import { Campaign, CampaignOptions, CardRuleError, NO_RESOURCES, Resources } from './Campaign';
import { CardCounts, NO_CARDS, addCounts, removeCards, startingDeckCounts, totalCards } from './CardCounts';
import { addCardsWon, getDebrief } from './CardsWon';
import { FailedRun, RunParty } from './CombatBridge';
import { DECK_RULES } from './DeckRules';
import { DriverRecord } from './DriverRecord';
import { RunDeck } from './RunDeck';
import { MemorySaveStorage } from './SaveStorage';
import { storeOver } from './__fixtures__/storeFixtures';

/**
 * DDB-316: cards won on a run ride home as cargo, reach the locker when the
 * run is unloaded, are lost with a failed run, and the debrief offers each
 * one to a default deck. Cards bought at home go straight to the locker.
 * Fights are scripted in CombatBridge.test.ts; here a run is load out's run
 * decks and a party built by hand.
 */

const SEED = 20261009;

const { max } = DECK_RULES.deckSize;

const STORES: Resources = { food: 20, water: 20, fuel: 6, meds: 3, scrap: 40, people: 8 };

const newCampaign = (options: Partial<CampaignOptions> = {}): Campaign => new Campaign({
	seed: SEED,
	generatorVersion: 1,
	mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
	resources: STORES,
	...options
});

interface Crew {
	campaign: Campaign;
	warrior: DriverRecord;
	interceptor: DriverRecord;
	/** At home, their deck as full as it gets */
	mechanic: DriverRecord;
	/** At home, healing */
	injured: DriverRecord;
	missing: DriverRecord;
	dead: DriverRecord;
	/** The Fuel Hauler, escort-1, bringing Top Off */
	hauler: Vehicle;
}

/** A compound with a driver of every status, a full deck at home, and a locker. */
function crew(): Crew {
	const campaign = newCampaign({ locker: { medical_kit: 1, emp_blast: 1 } });
	const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
	const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
	const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
	mechanic.set({ defaultDeck: { repair_kit: max } });
	const injured = campaign.recruitDriver({ archetype: 'raider' });
	injured.set({ status: 'injured', hitpoints: 20, injuredDays: 2 });
	const missing = campaign.recruitDriver({ archetype: 'road_warrior' });
	missing.set({ status: 'missing' });
	const dead = campaign.recruitDriver({ archetype: 'interceptor' });
	dead.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
	const hauler = createEscort({ type: 'fuel_hauler' });
	campaign.convoy.add(hauler);
	return { campaign, warrior, interceptor, mechanic, injured, missing, dead, hauler };
}

/** Cargo a run picked up: fuel from the hauler, scrap from fights, and a settler from a Find. */
const CARGO: Resources = { ...NO_RESOURCES, fuel: 2, scrap: 30, people: 1 };

/** Cards it won: a Headshot from one fight, a Precision Shot from another, and two Repair Kits from a Find: cards. */
const CARDS_WON: CardCounts = { headshot: 1, precision_shot: 1, repair_kit: 2 };

/**
 * The crew with the Road Warrior and the Interceptor out, the hauler along,
 * each run deck customized (the Road Warrior leaves both Nitro Boosts home,
 * the Interceptor borrows the Medical Kit), and the party carrying CARGO and
 * CARDS_WON.
 */
function onARun(): Crew & { party: RunParty } {
	const seated = crew();
	const { campaign, warrior, interceptor, hauler } = seated;
	campaign.startRunDecks({ seats: [warrior, interceptor], escorts: [hauler] });
	campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, warrior), to: 'locker', count: 2 });
	campaign.moveCards({ cardType: 'medical_kit', from: 'locker', to: runDeckOf(campaign, interceptor) });
	const party = addCardsWon({ party: setOff({ campaign, seats: [warrior, interceptor], escorts: [hauler], cargo: CARGO }), cardsWon: CARDS_WON });
	return { ...seated, party };
}

/** The party that sets off on the run out, as the run controller builds it once load out has started the run decks. */
function setOff({ campaign, seats, escorts = [], cargo = NO_RESOURCES }: { campaign: Campaign; seats: DriverRecord[]; escorts?: Vehicle[]; cargo?: Resources }): RunParty {
	const run = campaign.currentRun;
	if (run === null) throw new Error('a run should be out');
	return { seats, escorts, cargo, cargoCards: NO_CARDS, run };
}

/** A seated driver's run deck as it is now. */
function runDeckOf(campaign: Campaign, driver: DriverRecord): RunDeck {
	const deck = campaign.runDeckOf(driver);
	if (deck === null) throw new Error(`${driver.name} should have a run deck`);
	return deck;
}

/** Every copy in the locker, every default deck, and every run deck, summed here rather than by the campaign. */
const ownedByHand = (campaign: Campaign): CardCounts => [
	...campaign.drivers.map(driver => driver.defaultDeck),
	...campaign.runDecks.flatMap(deck => [deck.own, deck.leftHome, deck.borrowed])
].reduce(addCounts, campaign.locker);

/** The run failed as the combat bridge writes it: the Road Warrior crashed out and missing, the Interceptor dead. */
function failed({ campaign, warrior, interceptor, party }: Crew & { party: RunParty }): FailedRun {
	warrior.set({ status: 'missing' });
	interceptor.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
	return {
		outcome: 'run_failed',
		party: null,
		dead: [interceptor],
		missing: [warrior],
		escortsLost: [...campaign.convoy.escorts],
		cargoLost: party.cargo,
		cargoCardsLost: party.cargoCards,
		run: party.run
	};
}

/** Checks the action throws this message and changes nothing, the records included. */
function expectRefused({ campaign, action, message }: { campaign: Campaign; action: () => unknown; message: string }): void {
	const before = campaign.toSaveText();

	expect(action).toThrow(message);
	expect(campaign.toSaveText()).toBe(before);
}

/** Saved through a store and loaded back in a new one, as Continue does. */
async function throughStore(campaign: Campaign): Promise<Campaign> {
	const storage = new MemorySaveStorage();
	await storeOver(storage).save(campaign);
	const loaded = await storeOver(storage).load();
	if (loaded === null) throw new Error('the store kept no save');
	return loaded;
}

describe('Cards won (DDB-316)', () => {
	describe('on the road', () => {
		it('ride in the party\'s cargo, each reward, find, or roadside sale added to the last, leaving the party given as it was', () => {
			const { campaign, warrior, interceptor, hauler } = crew();
			campaign.startRunDecks({ seats: [warrior, interceptor], escorts: [hauler] });
			const party = setOff({ campaign, seats: [warrior, interceptor], escorts: [hauler], cargo: CARGO });
			const before = campaign.toSaveText();

			const rewarded = addCardsWon({ party, cardsWon: { headshot: 1 } });
			const found = addCardsWon({ party: rewarded, cardsWon: { headshot: 1, repair_kit: 2 } });

			expect(found.cargoCards).toEqual({ headshot: 2, repair_kit: 2 });
			expect(Object.isFrozen(found.cargoCards)).toBe(true);
			expect([found.seats, found.escorts, found.cargo, found.run]).toEqual([party.seats, party.escorts, party.cargo, 'run-1']);
			expect([party.cargoCards, rewarded.cargoCards]).toEqual([{}, { headshot: 1 }]);
			// Cargo isn't the compound's until it's home
			expect(campaign.toSaveText()).toBe(before);
		});

		it.each([
			['a card cards.json doesn\'t list', { no_such_card: 1 }, "cardsWon.no_such_card isn't a card in cards.json"],
			['an escort\'s signature card', { triage: 1 }, "cardsWon.triage is the signature card of the med_truck escort, which comes with it and is never the compound's"],
			['no copies of a card', { headshot: 0 }, 'cardsWon.headshot must be an integer >= 1, got 0'],
			['a card by its name', { Headshot: 1 }, 'cardsWon has a key that isn\'t a card type: "Headshot"']
		])('refuse %s, adding nothing', (_label, cardsWon, message) => {
			const { warrior, interceptor } = crew();
			const party: RunParty = { seats: [warrior, interceptor], escorts: [], cargo: NO_RESOURCES, cargoCards: { headshot: 1 }, run: 'run-1' };

			expect(() => addCardsWon({ party, cardsWon })).toThrow(message);
			expect(party.cargoCards).toEqual({ headshot: 1 });
		});
	});

	describe('bought at home', () => {
		it('go straight into the locker, in one change, and the compound owns that many more', () => {
			const { campaign, warrior } = crew();
			const owned = campaign.cardsOwned;
			const heard = jest.fn();
			campaign.on('change', heard);

			campaign.addToLocker({ cardType: 'headshot' });
			campaign.addToLocker({ cardType: 'emp_blast', count: 2 });

			expect(campaign.locker).toEqual({ emp_blast: 3, headshot: 1, medical_kit: 1 });
			expect(campaign.cardsOwned).toEqual(addCounts(owned, { emp_blast: 2, headshot: 1 }));
			expect(heard).toHaveBeenCalledTimes(2);
			// And from there to a deck, as any locker card goes
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });
		});

		it('are paid for in scrap from the stores in the same change, and refused, changing nothing, when the stores hold too little', () => {
			const { campaign } = crew();
			const heard = jest.fn();
			campaign.on('change', heard);

			expect(campaign.getAddToLockerBlocker({ cardType: 'headshot', count: 2, price: STORES.scrap })).toBeNull();
			campaign.addToLocker({ cardType: 'headshot', count: 2, price: 30 });

			expect([campaign.locker, campaign.resources]).toEqual([{ emp_blast: 1, headshot: 2, medical_kit: 1 }, { ...STORES, scrap: 10 }]);
			expect(heard).toHaveBeenCalledTimes(1);
			const blocker = campaign.getAddToLockerBlocker({ cardType: 'headshot', price: 11 });
			expect(blocker).toEqual({ reason: 'too_little_scrap', needed: 11, held: 10 });
			const before = campaign.toSaveText();
			const error = (() => {
				try {
					campaign.addToLocker({ cardType: 'headshot', price: 11 });
				} catch (thrown) {
					return thrown;
				}
				throw new Error('expected the stores to refuse it');
			})();
			expect(error).toBeInstanceOf(CardRuleError);
			expect([(error as CardRuleError).blocker, (error as Error).message]).toEqual([blocker, 'Buying 1 headshot costs 11 scrap, and the stores hold 10']);
			expect(campaign.toSaveText()).toBe(before);
			campaign.addToLocker({ cardType: 'headshot', price: 10 });
			expect(campaign.resources.scrap).toBe(0);
		});

		it.each([
			['a card cards.json doesn\'t list', { cardType: 'no_such_card' }, "cards.no_such_card isn't a card in cards.json"],
			['an escort\'s signature card', { cardType: 'top_off' }, "cards.top_off is the signature card of the fuel_hauler escort, which comes with it and is never the compound's"],
			['no copies', { cardType: 'headshot', count: 0 }, 'count must be an integer >= 1, got 0'],
			['a card by its name', { cardType: 'Headshot' }, 'cardType must be a card type in lower snake case, got "Headshot"'],
			['a price below 0', { cardType: 'headshot', price: -5 }, 'price must be an integer >= 0, got -5'],
			['part of a scrap', { cardType: 'headshot', price: 2.5 }, 'price must be an integer >= 0, got 2.5']
		])('refuse %s, from the check too, changing nothing', (_label, deposit, message) => {
			const { campaign } = crew();

			expect(() => campaign.getAddToLockerBlocker(deposit)).toThrow(message);
			expectRefused({ campaign, action: () => campaign.addToLocker(deposit), message });
		});

		it('won\'t go in while a card move is being stored', () => {
			const { campaign, warrior } = crew();
			const refused: string[] = [];
			warrior.once('defaultDeck', () => {
				try {
					campaign.addToLocker({ cardType: 'headshot' });
				} catch (error) {
					refused.push((error as Error).message);
				}
			});

			campaign.moveCards({ cardType: 'emp_blast', from: 'locker', to: warrior });

			expect(refused).toEqual(["Campaign can't change while a card move is being stored"]);
			expect(campaign.locker).toEqual({ medical_kit: 1 });
		});
	});

	describe('a run that got home', () => {
		it('is unwound, then its cargo unloaded, the resources into the stores and the cards won into the locker, so every copy is in exactly one place', () => {
			const { campaign, warrior, interceptor, party } = onARun();
			const owned = campaign.cardsOwned;

			const unloaded = campaign.unloadRun({ party });

			expect(unloaded).toEqual({ resources: CARGO, cards: CARDS_WON, found: [] });
			expect(Object.isFrozen(unloaded)).toBe(true);
			expect(campaign.runDecks).toEqual([]);
			expect(campaign.resources).toEqual({ ...STORES, fuel: 8, scrap: 70, people: 9 });
			// The Nitro Boosts left home are back in the Road Warrior's deck, and the borrowed Medical Kit in the locker beside the cards won
			expect([warrior.defaultDeck, interceptor.defaultDeck]).toEqual([startingDeckCounts('road_warrior'), startingDeckCounts('interceptor')]);
			expect(campaign.locker).toEqual({ emp_blast: 1, headshot: 1, medical_kit: 1, precision_shot: 1, repair_kit: 2 });
			expect(campaign.cardsOwned).toEqual(addCounts(owned, CARDS_WON));
			expect(campaign.cardsOwned).toEqual(ownedByHand(campaign));
		});

		it('stores the records first, in seat order, then the campaign in one change, refusing every other change meanwhile', () => {
			const { campaign, warrior, interceptor, party } = onARun();
			const heard: string[] = [];
			warrior.on('change', () => {
				heard.push('Road Warrior 1');
				try {
					campaign.unloadRun({ party });
				} catch (error) {
					heard.push((error as Error).message);
				}
			});
			interceptor.on('change', () => heard.push('Interceptor 1'));
			campaign.on('change', () => heard.push('campaign'));

			campaign.unloadRun({ party });

			expect(heard).toEqual(['Road Warrior 1', "Can't unload a run while a card move is being stored", 'Interceptor 1', 'campaign']);
		});

		it('saves at the step\'s checkpoint after it, and loads home with the cards in the locker', async () => {
			const { campaign, party } = onARun();
			const storage = new MemorySaveStorage();
			const store = storeOver(storage);
			await store.save(campaign);

			campaign.unloadRun({ party });
			expect(await store.checkpoint(campaign)).toBe('saved');
			const loaded = await storeOver(storage).load();

			expect(loaded?.toJSON()).toEqual(campaign.toJSON());
			expect(loaded?.cardsOwned).toEqual(campaign.cardsOwned);
		});

		it('unloads once: a second unload of the run, from the same party, a copy of it, or a party rebuilt from a save, finds no run out', async () => {
			const { campaign, party } = onARun();
			campaign.unloadRun({ party });
			const loaded = await throughStore(campaign);
			const rebuilt: RunParty = { ...party, seats: party.seats.map(seat => loaded.drivers.find(driver => driver.id === seat.id) as DriverRecord), escorts: [] };

			for (const [home, again] of [[campaign, party], [campaign, { ...party }], [loaded, rebuilt]] as const) {
				expectRefused({ campaign: home, action: () => home.unloadRun({ party: again }), message: 'No run is out, so there are no run decks' });
			}
			expect(campaign.resources).toEqual({ ...STORES, fuel: 8, scrap: 70, people: 9 });
		});

		it('refuses a party whose seats aren\'t the run\'s, and takes them in either order', () => {
			const { campaign, warrior, interceptor, mechanic, party } = onARun();

			for (const seats of [[warrior, mechanic], [warrior], [warrior, warrior]]) {
				expectRefused({
					campaign,
					action: () => campaign.unloadRun({ party: { ...party, seats } }),
					message: `This party seats ${seats.map(seat => `${seat.name} (${seat.id})`).join(' and ')}, and the run out seats Road Warrior 1 (driver-1) and Interceptor 1 (driver-2)`
				});
			}
			campaign.unloadRun({ party: { ...party, seats: [interceptor, warrior] } });
			expect(campaign.runDecks).toEqual([]);
		});

		it('refuses a party left over from an earlier run with the same seats, while the next one is out', () => {
			const { campaign, warrior, interceptor, party } = onARun();
			campaign.unloadRun({ party });
			campaign.startRunDecks({ seats: [warrior, interceptor] });
			const next = setOff({ campaign, seats: [warrior, interceptor] });

			expect([party.run, next.run, campaign.currentRun]).toEqual(['run-1', 'run-2', 'run-2']);
			expectRefused({ campaign, action: () => campaign.unloadRun({ party }), message: 'This party set off on "run-1", and the run out is run-2' });
			warrior.set({ status: 'missing' });
			interceptor.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
			const stale: FailedRun = { outcome: 'run_failed', party: null, dead: [interceptor], missing: [warrior], escortsLost: [], cargoLost: party.cargo, cargoCardsLost: party.cargoCards, run: party.run };
			expectRefused({ campaign, action: () => campaign.loseRun({ result: stale }), message: 'This failed run is "run-1", and the run out is run-2' });

			campaign.loseRun({ result: { ...stale, cargoLost: NO_RESOURCES, cargoCardsLost: NO_CARDS, run: next.run } });
			expect(campaign.locker).toEqual({ emp_blast: 1, headshot: 1, medical_kit: 1, precision_shot: 1, repair_kit: 2 });
		});

		it('refuses cards won that the locker can\'t count, before any record is stored, so the run can still come home', () => {
			const { campaign, warrior, interceptor, party } = onARun();
			campaign.addToLocker({ cardType: 'headshot' });
			const heard = jest.fn();
			[warrior, interceptor, campaign].forEach(model => model.on('change', heard));

			expectRefused({
				campaign,
				action: () => campaign.unloadRun({ party: { ...party, cargoCards: { headshot: Number.MAX_SAFE_INTEGER } } }),
				message: `Campaign.locker.headshot must be an integer >= 1, got ${Number.MAX_SAFE_INTEGER + 1}`
			});
			expect(heard).not.toHaveBeenCalled();
			expect([warrior.defaultDeck, campaign.runDecks.length]).toEqual([{}, 2]);

			campaign.unloadRun({ party });
			expect(warrior.defaultDeck).toEqual(startingDeckCounts('road_warrior'));
			expect(campaign.cardsOwned).toEqual(ownedByHand(campaign));
		});

		it('refuses cargo the stores can\'t count, changing nothing', () => {
			const { campaign, party } = onARun();

			expectRefused({
				campaign,
				action: () => campaign.unloadRun({ party: { ...party, cargo: { ...party.cargo, food: Number.MAX_SAFE_INTEGER } } }),
				message: `Campaign.resources.food must be an integer >= 0, got ${Number.MAX_SAFE_INTEGER + STORES.food}`
			});
		});

		it.each(['dead', 'missing'] as const)('refuses a party with a seat who\'s %s, since only a failed run leaves one, and nothing reaches the stores or the locker', (status) => {
			const { campaign, interceptor, party } = onARun();
			interceptor.set(status === 'dead' ? { status, hitpoints: 0, defaultDeck: {} } : { status });

			expectRefused({
				campaign,
				action: () => campaign.unloadRun({ party }),
				message: `Interceptor 1 (driver-2) is ${status}, so this run didn't come home, and its cargo is lost`
			});
		});

		it('takes the seats home injured, as the infirmary may have left them first', () => {
			const { campaign, warrior, party } = onARun();
			warrior.set({ status: 'injured', hitpoints: 30, injuredDays: 1 });

			campaign.unloadRun({ party });

			expect(warrior.defaultDeck).toEqual(startingDeckCounts('road_warrior'));
		});

		it('refuses cargo that isn\'t whole numbers, and cards won that aren\'t card counts, changing nothing', () => {
			const { campaign, party } = onARun();

			expectRefused({ campaign, action: () => campaign.unloadRun({ party: { ...party, cargo: { ...CARGO, fuel: 1.5 } } }), message: 'RunParty.cargo.fuel must be an integer >= 0, got 1.5' });
			expectRefused({ campaign, action: () => campaign.unloadRun({ party: { ...party, cargoCards: { headshot: -1 } } }), message: 'RunParty.cargoCards.headshot must be an integer >= 1, got -1' });
		});

		it('brings home a card cards.json has dropped since it was won, as the locker keeps any it holds', () => {
			const { campaign, party } = onARun();

			campaign.unloadRun({ party: { ...party, cargoCards: { retired_card: 1 } } });

			expect(campaign.locker).toMatchObject({ retired_card: 1 });
		});
	});

	describe('a failed run', () => {
		it('is unwound, the dead losing what went with them, and loses its cargo, none of it reaching the stores or the locker', () => {
			const seated = onARun();
			const { campaign, warrior, interceptor } = seated;
			const owned = campaign.cardsOwned;
			const theirs = runDeckOf(campaign, interceptor);
			const result = failed(seated);

			expect(campaign.loseRun({ result })).toEqual({ lost: [theirs] });

			expect(campaign.runDecks).toEqual([]);
			expect(campaign.resources).toEqual(STORES);
			// The missing Road Warrior keeps their deck, Nitro Boosts left at home included; the borrowed Medical Kit went with the Interceptor
			expect([warrior.defaultDeck, interceptor.defaultDeck]).toEqual([startingDeckCounts('road_warrior'), {}]);
			expect(campaign.locker).toEqual({ emp_blast: 1 });
			expect(campaign.cardsOwned).toEqual(ownedByHand(campaign));
			expect(totalCards(owned) - totalCards(campaign.cardsOwned)).toBe(theirs.deckSize);
		});

		it('says in the log what was lost, dated today, in one change with the unwinding', () => {
			const seated = onARun();
			const { campaign } = seated;
			const heard = jest.fn();
			campaign.on('change', heard);

			campaign.loseRun({ result: failed(seated) });

			expect(campaign.log[campaign.log.length - 1]).toEqual({ day: 1, message: 'Cargo lost with the run: 2 fuel, 30 scrap, 1 person, Headshot, Precision Shot, and Repair Kit x2.' });
			expect(heard).toHaveBeenCalledTimes(1);
		});

		it.each([
			['nothing', NO_RESOURCES, NO_CARDS, null],
			['one thing', { ...NO_RESOURCES, scrap: 15 }, NO_CARDS, 'Cargo lost with the run: 15 scrap.'],
			['two things', NO_RESOURCES, { headshot: 2, repair_kit: 1 }, 'Cargo lost with the run: Headshot x2 and Repair Kit.'],
			['settlers', { ...NO_RESOURCES, people: 3 }, NO_CARDS, 'Cargo lost with the run: 3 people.'],
			['one med', { ...NO_RESOURCES, meds: 1 }, NO_CARDS, 'Cargo lost with the run: 1 med.'],
			['a card cards.json has dropped', { ...NO_RESOURCES, meds: 2 }, { retired_card: 1 }, 'Cargo lost with the run: 2 meds and retired_card.']
		])('words a run that carried %s', (_label, cargo, cards, message) => {
			const seated = onARun();
			const { campaign } = seated;
			const log = campaign.log;

			campaign.loseRun({ result: { ...failed(seated), cargoLost: cargo, cargoCardsLost: cards } });

			expect(campaign.log).toEqual(message === null ? log : [...log, { day: 1, message }]);
		});

		it('refuses a run that hasn\'t failed, a result for other drivers, and a second loss, changing nothing', () => {
			const seated = onARun();
			const { campaign, warrior, interceptor, mechanic, party } = seated;
			const result = failed(seated);

			warrior.set({ status: 'ready' });
			expectRefused({ campaign, action: () => campaign.loseRun({ result }), message: "Road Warrior 1 (driver-1) is ready, so this run hasn't failed" });
			warrior.set({ status: 'missing' });
			expectRefused({
				campaign,
				action: () => campaign.loseRun({ result: { ...result, missing: [mechanic] } }),
				message: 'This failed run lost Interceptor 1 (driver-2) and Mechanic 1 (driver-3), and the run out seats Road Warrior 1 (driver-1) and Interceptor 1 (driver-2)'
			});
			expectRefused({ campaign, action: () => campaign.loseRun({ result: { ...result, dead: [] } }), message: 'This failed run lost Road Warrior 1 (driver-1)' });
			expectRefused({ campaign, action: () => campaign.loseRun({ result: { ...result, missing: [interceptor] } }), message: 'This failed run lost Interceptor 1 (driver-2) and Interceptor 1 (driver-2)' });

			campaign.loseRun({ result });
			expectRefused({ campaign, action: () => campaign.loseRun({ result }), message: 'No run is out, so there are no run decks' });
			// The party the run set off with can't bring its cargo home after it either
			expectRefused({ campaign, action: () => campaign.unloadRun({ party }), message: 'No run is out, so there are no run decks' });
			expect(campaign.locker).toEqual({ emp_blast: 1 });
			expect(interceptor.defaultDeck).toEqual({});
		});
	});

	describe('the debrief', () => {
		/** Each driver's name and why they can't take a copy of the card, or null. */
		const takersOf = (campaign: Campaign, cardType: string, cardsWon: CardCounts) =>
			getDebrief({ campaign, cardsWon }).find(card => card.cardType === cardType)?.takers.map(({ driver, blocker }) => [driver.name, blocker?.reason ?? null]);

		it('offers each card won, in card-type order, to every driver in the pool, saying who can take one now and why the rest can\'t', () => {
			const { campaign, party } = onARun();
			const { cards } = campaign.unloadRun({ party });

			const debrief = getDebrief({ campaign, cardsWon: cards });

			expect(debrief.map(({ cardType, count }) => [cardType, count])).toEqual([['headshot', 1], ['precision_shot', 1], ['repair_kit', 2]]);
			expect(Object.isFrozen(debrief) && debrief.every(card => Object.isFrozen(card) && Object.isFrozen(card.takers))).toBe(true);
			expect(takersOf(campaign, 'headshot', cards)).toEqual([
				['Road Warrior 1', null],
				['Interceptor 1', null],
				['Mechanic 1', 'deck_full'],
				['Raider 1', null],
				['Road Warrior 2', 'driver_away'],
				['Interceptor 2', 'driver_away']
			]);
			expect(takersOf(campaign, 'precision_shot', cards)).toEqual([
				['Road Warrior 1', 'other_archetype'],
				['Interceptor 1', null],
				['Mechanic 1', 'other_archetype'],
				['Raider 1', 'other_archetype'],
				['Road Warrior 2', 'driver_away'],
				['Interceptor 2', 'driver_away']
			]);
			const [, , mechanic] = debrief[0].takers;
			expect(mechanic.blocker).toEqual({ reason: 'deck_full', place: mechanic.driver, max });
		});

		it('takes a card with the Crew screen\'s own move, and asked again, offers what\'s left', () => {
			const { campaign, warrior, interceptor, party } = onARun();
			const { cards } = campaign.unloadRun({ party });

			for (const [cardType, driver] of [['headshot', warrior], ['repair_kit', interceptor]] as const) {
				const taker = getDebrief({ campaign, cardsWon: cards }).find(card => card.cardType === cardType)?.takers.find(offer => offer.driver === driver);
				expect(taker?.blocker).toBeNull();
				campaign.moveCards({ cardType, from: 'locker', to: driver });
			}
			const left = removeCards(removeCards(cards, 'headshot'), 'repair_kit');

			expect(getDebrief({ campaign, cardsWon: left }).map(({ cardType, count }) => [cardType, count])).toEqual([['precision_shot', 1], ['repair_kit', 1]]);
			expect(warrior.defaultDeck).toEqual(addCounts(startingDeckCounts('road_warrior'), { headshot: 1 }));
			// The headshot is in a deck now, so offered again, the locker holds none to give
			expect(takersOf(campaign, 'headshot', { headshot: 1 })?.slice(0, 2)).toEqual([['Road Warrior 1', 'too_few'], ['Interceptor 1', 'too_few']]);
		});

		it('says the seated drivers are out on the run when it\'s asked before the run is unloaded, and changes nothing', () => {
			const { campaign, party } = onARun();
			const before = campaign.toSaveText();

			expect(takersOf(campaign, 'headshot', party.cargoCards)?.slice(0, 2)).toEqual([['Road Warrior 1', 'on_run'], ['Interceptor 1', 'on_run']]);
			expect(campaign.toSaveText()).toBe(before);
		});
	});
});
