import { resolveMapParams } from '../map/MapParams';
import { createEscort } from '../mechanics/Escort';
import { Vehicle } from '../mechanics/Vehicle';
import { Campaign, CampaignOptions, CardBlocker, CardMove, CardRuleError } from './Campaign';
import { CardCounts, addCounts, startingDeckCounts, totalCards } from './CardCounts';
import { DECK_RULES } from './DeckRules';
import { DriverRecord } from './DriverRecord';
import { RunDeck } from './RunDeck';
import { MemorySaveStorage } from './SaveStorage';
import { storeOver } from './__fixtures__/storeFixtures';

/**
 * DDB-315: run decks (Compound and Supply Runs, At load out and After the
 * run). Each seated driver's starts as their default deck; they borrow from
 * the locker and leave cards home inside the limits; escort cards ride
 * locked and outside the limits; and unwinding gives everything back, but
 * what went with a driver who died.
 */

const SEED = 20261009;

const { min, max } = DECK_RULES.deckSize;

const newCampaign = (options: Partial<CampaignOptions> = {}): Campaign => new Campaign({
	seed: SEED,
	generatorVersion: 1,
	mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
	...options
});

interface Crew {
	campaign: Campaign;
	warrior: DriverRecord;
	interceptor: DriverRecord;
	mechanic: DriverRecord;
	/** The Fuel Hauler, escort-1, bringing Top Off */
	hauler: Vehicle;
	/** The Med Truck, escort-2, bringing Triage */
	truck: Vehicle;
	/** The Pilot Car, escort-3, which stays home */
	pilotCar: Vehicle;
}

/** A compound with three drivers, a locker, and three escorts, nobody out yet. */
function crew(locker: CardCounts = { headshot: 2, medical_kit: 1, precision_shot: 1 }): Crew {
	const campaign = newCampaign({ locker });
	const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
	const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
	const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
	const [hauler, truck, pilotCar] = (['fuel_hauler', 'med_truck', 'pilot_car'] as const).map(type => createEscort({ type }));
	[hauler, truck, pilotCar].forEach(escort => campaign.convoy.add(escort));
	return { campaign, warrior, interceptor, mechanic, hauler, truck, pilotCar };
}

/** The crew with the Road Warrior and the Interceptor out on a run, the hauler and the truck along. */
function onARun(locker?: CardCounts): Crew {
	const seated = crew(locker);
	seated.campaign.startRunDecks({ seats: [seated.warrior, seated.interceptor], escorts: [seated.hauler, seated.truck] });
	return seated;
}

/** A seated driver's run deck as it is now. */
function runDeckOf(campaign: Campaign, driver: DriverRecord): RunDeck {
	const deck = campaign.runDeckOf(driver);
	if (deck === null) throw new Error(`${driver.name} should have a run deck`);
	return deck;
}

/** The error an action throws, which must be a rules refusal. */
function refusal(action: () => void): CardRuleError {
	try {
		action();
	} catch (error) {
		expect(error).toBeInstanceOf(CardRuleError);
		return error as CardRuleError;
	}
	throw new Error('expected the rules to refuse it');
}

/** Checks the move's check gives this blocker, and the move refuses with it and changes nothing. */
function expectRefused({ campaign, move, blocker }: { campaign: Campaign; move: CardMove; blocker: CardBlocker }): void {
	const before = campaign.toSaveText();

	expect(campaign.getCardMoveBlocker(move)).toEqual(blocker);
	expect(refusal(() => campaign.moveCards(move)).blocker).toEqual(blocker);
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

describe('Run decks (DDB-315)', () => {
	describe('at load out', () => {
		it('start as each seated driver\'s whole default deck, going, which the default deck hands over so every copy stays in one place', () => {
			const { campaign, warrior, interceptor, mechanic } = crew();
			const owned = campaign.cardsOwned;

			const [first, second] = campaign.startRunDecks({ seats: [warrior, interceptor] });

			expect([first.driver, second.driver]).toEqual([warrior, interceptor]);
			expect([first.own, first.leftHome, first.borrowed]).toEqual([startingDeckCounts('road_warrior'), {}, {}]);
			expect(second.own).toEqual(startingDeckCounts('interceptor'));
			expect([first.deckSize, second.deckSize]).toEqual([12, 11]);
			expect(first.defaultDeck).toEqual(startingDeckCounts('road_warrior'));
			expect([warrior.defaultDeck, interceptor.defaultDeck]).toEqual([{}, {}]);
			expect(mechanic.defaultDeck).toEqual(startingDeckCounts('mechanic'));
			expect(campaign.runDecks).toEqual([first, second]);
			expect(campaign.runDeckOf(mechanic)).toBeNull();
			expect(campaign.cardsOwned).toEqual(owned);
		});

		it('bring the signature card of each escort that came along into Driver 1\'s run deck, locked there, outside the limits, and not the compound\'s', () => {
			const { campaign, warrior, interceptor, hauler, truck, pilotCar } = crew();
			const owned = campaign.cardsOwned;

			campaign.startRunDecks({ seats: [warrior, interceptor], escorts: [truck, hauler] });

			expect(runDeckOf(campaign, warrior).escortCards).toEqual([
				{ cardType: 'top_off', broughtBy: 'escort-1' },
				{ cardType: 'triage', broughtBy: 'escort-2' }
			]);
			expect(runDeckOf(campaign, interceptor).escortCards).toEqual([]);
			expect(runDeckOf(campaign, warrior).deckSize).toBe(12);
			expect(campaign.cardsOwned).toEqual(owned);
			expect(pilotCar.convoyId).toBe('escort-3');
		});

		it('store the records first, in seat order, then the campaign, which refuses every change while they\'re stored', () => {
			const { campaign, warrior, interceptor } = crew();
			const heard: string[] = [];
			warrior.on('change', () => {
				heard.push('Road Warrior 1');
				try {
					campaign.set({ unrest: 3 });
				} catch (error) {
					heard.push((error as Error).message);
				}
			});
			interceptor.on('change', () => heard.push('Interceptor 1'));
			campaign.on('change', () => heard.push('campaign'));

			campaign.startRunDecks({ seats: [warrior, interceptor] });

			expect(heard).toEqual(['Road Warrior 1', "Campaign can't change while a card move is being stored", 'Interceptor 1', 'campaign']);
			expect(campaign.unrest).toBe(0);
		});

		it('give the default decks back, and throw on, when a listener leaves the run decks unstorable partway through', () => {
			const { campaign, warrior, interceptor, hauler } = crew();
			const owned = campaign.cardsOwned;
			// The listener runs again as the copies go back, and its second dismissal throws, which the emitter logs
			const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
			warrior.on('change', () => campaign.convoy.dismiss({ escort: hauler, drivers: [] }));

			try {
				expect(() => campaign.startRunDecks({ seats: [warrior, interceptor], escorts: [hauler] }))
					.toThrow("Campaign.runDecks[0].escortCards[0].broughtBy escort-1 isn't an escort in the convoy");
			} finally {
				logged.mockRestore();
			}

			expect(campaign.runDecks).toEqual([]);
			expect([warrior.defaultDeck, interceptor.defaultDeck]).toEqual([startingDeckCounts('road_warrior'), startingDeckCounts('interceptor')]);
			expect(campaign.cardsOwned).toEqual(owned);
		});

		it('take the second deck as it is when it empties, so a listener\'s change to it partway through goes with it', () => {
			const { campaign, warrior, interceptor } = crew();
			warrior.once('defaultDeck', () => interceptor.set({ defaultDeck: { headshot: 9 } }));

			campaign.startRunDecks({ seats: [warrior, interceptor] });

			expect(runDeckOf(campaign, interceptor).own).toEqual({ headshot: 9 });
			expect(interceptor.defaultDeck).toEqual({});
		});

		type StartOptions = Parameters<Campaign['startRunDecks']>[0];
		const stranger = (): DriverRecord => new DriverRecord({ id: 'driver-9', archetype: 'mechanic', name: 'Mechanic 1' });

		it.each([
			['while a run is out', ({ campaign, mechanic, interceptor }: Crew) => {
				campaign.startRunDecks({ seats: [mechanic, interceptor] });
				return { seats: [mechanic, interceptor] };
			}, 'A run is already out; unwind its run decks before starting new ones'],
			['one seat', ({ warrior }: Crew) => ({ seats: [warrior] }), 'A run seats two drivers, not 1'],
			['one driver in both seats', ({ warrior }: Crew) => ({ seats: [warrior, warrior] }), "Road Warrior 1 (driver-1) can't take both seats"],
			['a driver from outside the pool', ({ warrior }: Crew) => ({ seats: [warrior, stranger()] }), "Mechanic 1 (driver-9) isn't in this campaign's pool"],
			['an injured driver', ({ warrior, interceptor }: Crew) => {
				interceptor.set({ status: 'injured', injuredDays: 2 });
				return { seats: [warrior, interceptor] };
			}, "Interceptor 1 (driver-2) is injured, so they can't go on a run"],
			['two drivers of one archetype', ({ campaign, warrior }: Crew) => ({ seats: [warrior, campaign.recruitDriver({ archetype: 'road_warrior' })] }),
				'Road Warrior 1 (driver-1) and Road Warrior 2 (driver-4) are both road_warrior; a run seats two different archetypes'],
			['an escort that isn\'t in the convoy', ({ warrior, interceptor }: Crew) => ({ seats: [warrior, interceptor], escorts: [createEscort({ type: 'outrider' })] }), "Outrider isn't in the campaign's convoy"],
			['an escort listed twice', ({ warrior, interceptor, hauler }: Crew) => ({ seats: [warrior, interceptor], escorts: [hauler, hauler] }), 'Fuel Hauler (escort-1) is listed twice']
		] as [string, (seated: Crew) => StartOptions, string][])('refuse to start %s, changing nothing', (_label, setUp, message) => {
			const seated = crew();
			const { campaign, warrior, interceptor } = seated;
			const options = setUp(seated);
			const text = campaign.toSaveText();
			const decks = [warrior.defaultDeck, interceptor.defaultDeck];

			expect(() => campaign.startRunDecks(options)).toThrow(message);

			expect(campaign.toSaveText()).toBe(text);
			expect([warrior.defaultDeck, interceptor.defaultDeck]).toEqual(decks);
		});
	});

	describe('borrowing and leaving home', () => {
		it('borrow from the locker into a run deck and send it back, each in one change, never making or losing a copy', () => {
			const { campaign, warrior } = onARun();
			const owned = campaign.cardsOwned;
			const heard = jest.fn();
			campaign.on('change', heard);
			warrior.on('change', heard);
			const borrow: CardMove = { cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, warrior) };

			expect(campaign.getCardMoveBlocker(borrow)).toBeNull();
			campaign.moveCards(borrow);

			expect(runDeckOf(campaign, warrior).borrowed).toEqual({ headshot: 1 });
			expect(runDeckOf(campaign, warrior).deckSize).toBe(13);
			expect(campaign.locker).toEqual({ headshot: 1, medical_kit: 1, precision_shot: 1 });
			campaign.moveCards({ cardType: 'headshot', from: runDeckOf(campaign, warrior), to: 'locker' });
			expect(runDeckOf(campaign, warrior).borrowed).toEqual({});
			expect(campaign.locker).toEqual({ headshot: 2, medical_kit: 1, precision_shot: 1 });
			expect(campaign.cardsOwned).toEqual(owned);
			expect(heard).toHaveBeenCalledTimes(2);
		});

		it('leave the driver\'s own cards at home, kept for them rather than lent out, and take those back before borrowing', () => {
			const { campaign, warrior, interceptor } = onARun({ nitro_boost: 1 });
			const owned = campaign.cardsOwned;

			campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, warrior), to: 'locker', count: 2 });

			expect(runDeckOf(campaign, warrior).leftHome).toEqual({ nitro_boost: 2 });
			expect(runDeckOf(campaign, warrior).deckSize).toBe(10);
			expect(campaign.locker).toEqual({ nitro_boost: 1 });
			// The Interceptor can borrow the locker's one, never the two the Road Warrior left at home
			const tooMany: CardMove = { cardType: 'nitro_boost', from: 'locker', to: runDeckOf(campaign, interceptor), count: 2 };
			expectRefused({ campaign, move: tooMany, blocker: { reason: 'too_few', place: 'locker', held: 1 } });
			expect(() => campaign.moveCards(tooMany)).toThrow("Can't take 2 nitro_boost into a run deck, with 1 available, from the locker and the driver's own left at home");
			// The Road Warrior has three: their own two at home, and the locker's
			expect(campaign.getCardMoveBlocker({ ...tooMany, to: runDeckOf(campaign, warrior), count: 4 })).toEqual({ reason: 'too_few', place: 'locker', held: 3 });

			campaign.moveCards({ cardType: 'nitro_boost', from: 'locker', to: runDeckOf(campaign, warrior), count: 3 });

			expect(runDeckOf(campaign, warrior)).toMatchObject({ own: startingDeckCounts('road_warrior'), leftHome: {}, borrowed: { nitro_boost: 1 } });
			expect(campaign.locker).toEqual({});
			expect(campaign.cardsOwned).toEqual(owned);
		});

		it('send borrowed copies home before the driver\'s own', () => {
			const { campaign, warrior } = onARun({ repair_kit: 2 });
			campaign.moveCards({ cardType: 'repair_kit', from: 'locker', to: runDeckOf(campaign, warrior), count: 2 });

			campaign.moveCards({ cardType: 'repair_kit', from: runDeckOf(campaign, warrior), to: 'locker', count: 3 });

			expect(runDeckOf(campaign, warrior)).toMatchObject({ borrowed: {}, leftHome: { repair_kit: 1 } });
			expect(runDeckOf(campaign, warrior).own.repair_kit).toBe(1);
			expect(campaign.locker).toEqual({ repair_kit: 2 });
		});

		it('keep a run deck inside the limits, counting its own and borrowed copies and not its escort cards', () => {
			const { campaign, warrior, interceptor, hauler } = crew({ headshot: 2 });
			warrior.set({ defaultDeck: { repair_kit: max } });
			interceptor.set({ defaultDeck: { repair_kit: min } });
			campaign.startRunDecks({ seats: [warrior, interceptor], escorts: [hauler] });
			const full = runDeckOf(campaign, warrior);
			const thin = runDeckOf(campaign, interceptor);

			expect(full.deckSize).toBe(max);
			const fill: CardMove = { cardType: 'headshot', from: 'locker', to: full };
			expectRefused({ campaign, move: fill, blocker: { reason: 'deck_full', place: full, max } });
			expect(() => campaign.moveCards(fill)).toThrow(`Can't add 1 headshot to Road Warrior 1's run deck, which holds ${max} of at most ${max}`);
			const thinner: CardMove = { cardType: 'repair_kit', from: thin, to: 'locker' };
			expectRefused({ campaign, move: thinner, blocker: { reason: 'deck_at_minimum', place: thin, min } });
			expect(() => campaign.moveCards(thinner)).toThrow(`Can't take 1 repair_kit from Interceptor 1's run deck, which holds ${min} of at least ${min}`);
			// Escort cards sit outside the limits, so a full run deck still takes one
			campaign.moveEscortCard({ broughtBy: 'escort-1', to: thin });
			campaign.moveEscortCard({ broughtBy: 'escort-1', to: full });
			expect(runDeckOf(campaign, warrior).deckSize).toBe(max);
		});

		it('say a copy the other seated driver borrowed isn\'t free, and say so apart from a locker that never had it', () => {
			const { campaign, warrior, interceptor } = onARun();
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, interceptor), count: 2 });
			const borrow: CardMove = { cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, warrior) };

			expectRefused({ campaign, move: borrow, blocker: { reason: 'already_borrowed', place: 'locker', held: 0, by: runDeckOf(campaign, interceptor) } });
			expect(() => campaign.moveCards(borrow))
				.toThrow("Can't take 1 headshot into a run deck, with 0 available, from the locker and the driver's own left at home: Interceptor 1 (driver-2) has borrowed the rest");
			expectRefused({
				campaign,
				move: { cardType: 'emp_blast', from: 'locker', to: runDeckOf(campaign, warrior) },
				blocker: { reason: 'too_few', place: 'locker', held: 0 }
			});

			campaign.moveCards({ cardType: 'headshot', from: runDeckOf(campaign, interceptor), to: 'locker' });
			expect(campaign.getCardMoveBlocker(borrow)).toBeNull();
		});

		it('keep a card marked for an archetype out of another archetype\'s run deck', () => {
			const { campaign, warrior, interceptor } = onARun();

			expectRefused({
				campaign,
				move: { cardType: 'precision_shot', from: 'locker', to: runDeckOf(campaign, warrior) },
				blocker: { reason: 'other_archetype', place: runDeckOf(campaign, warrior), archetype: 'interceptor' }
			});
			campaign.moveCards({ cardType: 'precision_shot', from: 'locker', to: runDeckOf(campaign, interceptor) });
			expect(runDeckOf(campaign, interceptor).cards.precision_shot).toBe(4);
		});

		it('refuse the Crew screen\'s moves on a seated driver\'s default deck, which is out on the run', () => {
			const { campaign, warrior, interceptor, mechanic } = onARun();

			for (const [move, place] of [
				[{ cardType: 'headshot', from: 'locker', to: warrior }, warrior],
				[{ cardType: 'repair_kit', from: mechanic, to: interceptor }, interceptor],
				[{ cardType: 'repair_kit', from: interceptor, to: 'locker' }, interceptor]
			] as [CardMove, DriverRecord][]) {
				expectRefused({ campaign, move, blocker: { reason: 'on_run', place } });
			}
			expect(() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior }))
				.toThrow("Road Warrior 1 (driver-1) is out on a run, so their default deck is in their run deck until it's unwound");
			expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: mechanic })).toBeNull();
		});

		it('won\'t save, or store a run deck change, while a set has put cards in a seated driver\'s default deck', () => {
			const { campaign, warrior } = onARun();
			warrior.set({ defaultDeck: { headshot: 1 } });
			const message = 'Campaign.runDecks[0].driver driver-1 holds cards in their default deck, {"headshot":1}, which is in their run deck while a run is out';

			expect(() => campaign.toSaveText()).toThrow(message);
			expect(() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, warrior) })).toThrow(message);
			warrior.set({ defaultDeck: {} });
			expect(() => campaign.toSaveText()).not.toThrow();
		});

		it('never hold a card both left at home and borrowed, which no move makes', () => {
			const { warrior } = crew();

			expect(() => new RunDeck({ driver: warrior, leftHome: { headshot: 1 }, borrowed: { headshot: 2 } }))
				.toThrow("RunDeck.borrowed.headshot can't be borrowed while 1 of the driver's own are left at home, which come back first");
		});

		it('refuse a run deck whose driver is away, as after a fight that failed the run', () => {
			const { campaign, warrior, interceptor } = onARun();
			interceptor.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });

			expectRefused({ campaign, move: { cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, interceptor) }, blocker: { reason: 'driver_away', place: interceptor } });
			expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, warrior) })).toBeNull();
		});

		it('take a stale run deck as the one its driver has now', () => {
			const { campaign, warrior } = onARun();
			const stale = runDeckOf(campaign, warrior);

			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: stale });
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: stale });

			expect(runDeckOf(campaign, warrior).borrowed).toEqual({ headshot: 2 });
			expect(stale.borrowed).toEqual({});
		});

		it('reset a run deck to its driver\'s default deck in one change, leaving the escort cards where they are', () => {
			const { campaign, warrior } = onARun();
			const locker = campaign.locker;
			campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, warrior), to: 'locker', count: 2 });
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, warrior), count: 2 });
			const heard = jest.fn();
			campaign.on('change', heard);

			campaign.resetRunDeck({ runDeck: runDeckOf(campaign, warrior) });

			expect(runDeckOf(campaign, warrior)).toMatchObject({ own: startingDeckCounts('road_warrior'), leftHome: {}, borrowed: {} });
			expect(runDeckOf(campaign, warrior).escortCards.map(card => card.broughtBy)).toEqual(['escort-1', 'escort-2']);
			expect(campaign.locker).toEqual(locker);
			expect(heard).toHaveBeenCalledTimes(1);
		});

		it('throw from the check, as from the move, on a move no rule covers', () => {
			const { campaign, warrior, interceptor, mechanic } = onARun();
			const warriorDeck = runDeckOf(campaign, warrior);

			for (const [move, message] of [
				[{ cardType: 'headshot', from: warriorDeck, to: warrior }, "Cards move between a run deck and the locker, not from Road Warrior 1's run deck to Road Warrior 1's deck; escort cards move with moveEscortCard"],
				[{ cardType: 'headshot', from: warriorDeck, to: runDeckOf(campaign, interceptor) }, "Cards move between a run deck and the locker, not from Road Warrior 1's run deck to Interceptor 1's run deck"],
				[{ cardType: 'headshot', from: warriorDeck, to: new RunDeck({ driver: warrior }) }, "Can't move headshot from Road Warrior 1's run deck to itself"],
				[{ cardType: 'headshot', from: 'locker', to: new RunDeck({ driver: mechanic }) }, "Mechanic 1 (driver-3) has no run deck in this campaign"],
				[{ cardType: 'headshot', from: 'locker', to: warriorDeck, count: 0 }, 'count must be an integer >= 1, got 0']
			] as [CardMove, string][]) {
				expect(() => campaign.getCardMoveBlocker(move)).toThrow(message);
				expect(() => campaign.moveCards(move)).toThrow(message);
				expect(() => campaign.moveCards(move)).not.toThrow(CardRuleError);
			}
		});
	});

	describe('escort cards', () => {
		it('are locked in their run deck: no move takes one to the locker or a default deck', () => {
			const { campaign, warrior } = onARun();
			const deck = runDeckOf(campaign, warrior);
			const blocker: CardBlocker = { reason: 'card_locked', place: deck, broughtBy: 'escort-1' };

			for (const to of ['locker', warrior] as const) {
				expect(campaign.getEscortCardMoveBlocker({ broughtBy: 'escort-1', to })).toEqual(blocker);
				expect(refusal(() => campaign.moveEscortCard({ broughtBy: 'escort-1', to })).blocker).toEqual(blocker);
			}
			expectRefused({ campaign, move: { cardType: 'top_off', from: deck, to: 'locker' }, blocker });
			expect(() => campaign.moveCards({ cardType: 'top_off', from: deck, to: 'locker' })).toThrow("The top_off escort-1 brought is locked in Road Warrior 1's run deck");
		});

		it('go to Driver 2 and back in one change each, under no deck rule', () => {
			const { campaign, warrior, interceptor } = onARun();
			const heard = jest.fn();
			campaign.on('change', heard);

			expect(campaign.getEscortCardMoveBlocker({ broughtBy: 'escort-2', to: runDeckOf(campaign, interceptor) })).toBeNull();
			campaign.moveEscortCard({ broughtBy: 'escort-2', to: runDeckOf(campaign, interceptor) });

			expect(runDeckOf(campaign, warrior).escortCards).toEqual([{ cardType: 'top_off', broughtBy: 'escort-1' }]);
			expect(runDeckOf(campaign, interceptor).escortCards).toEqual([{ cardType: 'triage', broughtBy: 'escort-2' }]);
			campaign.moveEscortCard({ broughtBy: 'escort-2', to: runDeckOf(campaign, warrior) });
			expect(runDeckOf(campaign, warrior).escortCards.map(card => card.broughtBy)).toEqual(['escort-1', 'escort-2']);
			expect(heard).toHaveBeenCalledTimes(2);
		});

		it('won\'t go to a driver who\'s away', () => {
			const { campaign, interceptor } = onARun();
			interceptor.set({ status: 'missing' });

			expect(campaign.getEscortCardMoveBlocker({ broughtBy: 'escort-1', to: runDeckOf(campaign, interceptor) })).toEqual({ reason: 'driver_away', place: interceptor });
		});

		it.each([
			['a card no run deck holds', { broughtBy: 'escort-3', toWarrior: false }, 'No run deck holds a card "escort-3" brought'],
			['a run deck that holds it already', { broughtBy: 'escort-1', toWarrior: true }, "Road Warrior 1's run deck holds the top_off escort-1 brought already"]
		])('throw for %s', (_label, { broughtBy, toWarrior }, message) => {
			const { campaign, warrior, interceptor } = onARun();
			const to = runDeckOf(campaign, toWarrior ? warrior : interceptor);

			expect(() => campaign.getEscortCardMoveBlocker({ broughtBy, to })).toThrow(message);
			expect(() => campaign.moveEscortCard({ broughtBy, to })).toThrow(message);
		});

		it('leave with their escort from whichever run deck holds them, and join with one', () => {
			const { campaign, warrior, interceptor, hauler, truck, pilotCar } = onARun();
			campaign.moveEscortCard({ broughtBy: 'escort-2', to: runDeckOf(campaign, interceptor) });
			const heard = jest.fn();
			campaign.on('change', heard);

			campaign.removeEscortCards({ escorts: [truck] });
			campaign.removeEscortCards({ escorts: [truck, pilotCar] });

			expect(runDeckOf(campaign, interceptor).escortCards).toEqual([]);
			expect(heard).toHaveBeenCalledTimes(1);
			campaign.addEscortCards({ escorts: [pilotCar] });
			expect(runDeckOf(campaign, warrior).escortCards).toEqual([
				{ cardType: 'top_off', broughtBy: 'escort-1' },
				{ cardType: 'flag_down', broughtBy: 'escort-3' }
			]);
			expect(() => campaign.addEscortCards({ escorts: [hauler] })).toThrow("The top_off escort-1 brought is in Road Warrior 1's run deck already");
		});

		it('won\'t save while a run deck holds the card of an escort the convoy let go, which a load would refuse', () => {
			const { campaign, hauler } = onARun();
			campaign.convoy.dismiss({ escort: hauler, drivers: [] });

			expect(() => campaign.toSaveText()).toThrow("Campaign.runDecks[0].escortCards[0].broughtBy escort-1 isn't an escort in the convoy");
			campaign.removeEscortCards({ escorts: [hauler] });
			expect(Campaign.fromJSON(campaign.toJSON()).toJSON()).toEqual(campaign.toJSON());
		});
	});

	describe('after the run', () => {
		/** The run customized: the Road Warrior leaves both Nitro Boosts home and borrows a Headshot, the Interceptor leaves a Repair Kit home and borrows a Medical Kit. */
		function customized(): Crew & { owned: CardCounts; locker: CardCounts } {
			const seated = crew();
			const { campaign, warrior, interceptor, hauler, truck } = seated;
			const owned = campaign.cardsOwned;
			const locker = campaign.locker;
			campaign.startRunDecks({ seats: [warrior, interceptor], escorts: [hauler, truck] });
			campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, warrior), to: 'locker', count: 2 });
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, warrior) });
			campaign.moveCards({ cardType: 'repair_kit', from: runDeckOf(campaign, interceptor), to: 'locker' });
			campaign.moveCards({ cardType: 'medical_kit', from: 'locker', to: runDeckOf(campaign, interceptor) });
			campaign.moveEscortCard({ broughtBy: 'escort-2', to: runDeckOf(campaign, interceptor) });
			return { ...seated, owned, locker };
		}

		it('unwind a run everyone came home from: default decks as they were, borrowed cards in the locker, escort cards gone', () => {
			const { campaign, warrior, interceptor, owned, locker } = customized();

			expect(campaign.unwindRunDecks()).toEqual({ lost: [] });

			expect(campaign.runDecks).toEqual([]);
			expect([warrior.defaultDeck, interceptor.defaultDeck]).toEqual([startingDeckCounts('road_warrior'), startingDeckCounts('interceptor')]);
			expect(campaign.locker).toEqual(locker);
			expect(campaign.cardsOwned).toEqual(owned);
			expect(campaign.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: warrior })).toBeNull();
		});

		it('store the records first, in seat order, then the campaign, which refuses every change while they\'re stored', () => {
			const { campaign, warrior, interceptor } = customized();
			const heard: string[] = [];
			warrior.on('change', () => {
				heard.push('Road Warrior 1');
				try {
					campaign.moveCards({ cardType: 'emp_blast', from: 'locker', to: warrior });
				} catch (error) {
					heard.push((error as Error).message);
				}
			});
			interceptor.on('change', () => heard.push('Interceptor 1'));
			campaign.on('change', () => heard.push('campaign'));

			campaign.unwindRunDecks();

			expect(heard).toEqual(['Road Warrior 1', "Can't move cards while another move is being stored", 'Interceptor 1', 'campaign']);
		});

		it('loses the whole run deck of a driver who died, their own cards and what they borrowed, and puts what they left at home in the locker', () => {
			const { campaign, warrior, interceptor, owned } = customized();
			const theirs = runDeckOf(campaign, interceptor);
			// As the combat bridge writes a death on a failed run
			interceptor.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });

			expect(campaign.unwindRunDecks()).toEqual({ lost: [theirs] });

			expect(interceptor.defaultDeck).toEqual({});
			expect(warrior.defaultDeck).toEqual(startingDeckCounts('road_warrior'));
			// The Road Warrior's Headshot is back, the Medical Kit went with the Interceptor, and the Repair Kit they left at home stays
			expect(campaign.locker).toEqual({ headshot: 2, precision_shot: 1, repair_kit: 1 });
			expect(campaign.cardsOwned).toEqual(addCounts(addCounts(campaign.locker, startingDeckCounts('road_warrior')), startingDeckCounts('mechanic')));
			expect(totalCards(owned) - totalCards(campaign.cardsOwned)).toBe(theirs.deckSize);
		});

		it.each(['dead', 'missing'] as const)('won\'t reset the run deck of a driver who\'s %s, which would lose what they left at home when it\'s unwound', (status) => {
			const { campaign, warrior } = onARun();
			campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, warrior), to: 'locker', count: 2 });
			campaign.moveCards({ cardType: 'medical_kit', from: 'locker', to: runDeckOf(campaign, warrior) });
			// As the combat bridge writes a failed run
			warrior.set(status === 'dead' ? { status, hitpoints: 0, defaultDeck: {} } : { status });
			const before = campaign.toSaveText();

			const error = refusal(() => campaign.resetRunDeck({ runDeck: runDeckOf(campaign, warrior) }));

			expect(error.blocker).toEqual({ reason: 'driver_away', place: warrior });
			expect(error.message).toBe(`Road Warrior 1 (driver-1) is ${status}, so their run deck can't be reset`);
			expect(campaign.toSaveText()).toBe(before);
			campaign.unwindRunDecks();
			// The Nitro Boosts left at home are safe either way; the Medical Kit went with the dead and came back with the missing
			expect(campaign.locker).toEqual(status === 'dead' ? { headshot: 2, nitro_boost: 2, precision_shot: 1 } : { headshot: 2, medical_kit: 1, precision_shot: 1 });
		});

		it('unwinds a missing driver\'s run deck as if they\'d come home', () => {
			const { campaign, interceptor, locker } = customized();
			interceptor.set({ status: 'missing' });

			expect(campaign.unwindRunDecks()).toEqual({ lost: [] });

			expect(interceptor.defaultDeck).toEqual(startingDeckCounts('interceptor'));
			expect(campaign.locker).toEqual(locker);
		});

		it('unwinds a driver a listener kills before their run deck is reached as dead', () => {
			const { campaign, warrior, interceptor } = customized();
			const theirs = runDeckOf(campaign, interceptor);
			warrior.once('defaultDeck', () => interceptor.set({ status: 'dead', hitpoints: 0, defaultDeck: {} }));

			expect(campaign.unwindRunDecks()).toEqual({ lost: [theirs] });
			expect(interceptor.defaultDeck).toEqual({});
		});

		it('throws with no run out', () => {
			const { campaign } = crew();

			expect(() => campaign.unwindRunDecks()).toThrow('No run is out, so there are no run decks');
		});
	});

	describe('a save mid-run', () => {
		it('keeps every run deck through the store, borrowed and left-home copies and escort cards with their escorts, and carries on from it', async () => {
			const { campaign, interceptor } = onARun();
			campaign.moveCards({ cardType: 'nitro_boost', from: runDeckOf(campaign, interceptor), to: 'locker' });
			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: runDeckOf(campaign, interceptor), count: 2 });
			campaign.moveEscortCard({ broughtBy: 'escort-2', to: runDeckOf(campaign, interceptor) });

			const loaded = await throughStore(campaign);
			const [loadedWarrior, loadedInterceptor] = loaded.drivers;

			expect(loaded.toJSON()).toEqual(campaign.toJSON());
			expect(loaded.cardsOwned).toEqual(campaign.cardsOwned);
			expect(loaded.runDecks.map(deck => deck.driver)).toEqual([loadedWarrior, loadedInterceptor]);
			expect(runDeckOf(loaded, loadedInterceptor)).toMatchObject({
				leftHome: { nitro_boost: 1 },
				borrowed: { headshot: 2 },
				escortCards: [{ cardType: 'triage', broughtBy: 'escort-2' }]
			});
			// The rules carry on from the load: the Interceptor borrowed both Headshots
			expect(loaded.getCardMoveBlocker({ cardType: 'headshot', from: 'locker', to: runDeckOf(loaded, loadedWarrior) }))
				.toEqual({ reason: 'already_borrowed', place: 'locker', held: 0, by: runDeckOf(loaded, loadedInterceptor) });
			loaded.unwindRunDecks();
			campaign.unwindRunDecks();
			expect(loaded.toJSON()).toEqual(campaign.toJSON());
		});
	});
});
