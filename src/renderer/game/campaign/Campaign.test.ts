import { runInNewContext } from 'vm';
import { MapParams, resolveMapParams } from '../map/MapParams';
import { Convoy } from '../mechanics/Convoy';
import { DriverArchetype } from '../mechanics/Driver';
import { createEscort } from '../mechanics/Escort';
import { CAMPAIGN_SCHEMA_VERSION, Campaign, CampaignJson, CampaignOptions, NO_RESOURCES } from './Campaign';
import type { EscortJson } from './ConvoyJson';
import { historyEntry, historyToJson } from './CampaignHistory';
import { cardCount, totalCards } from './CardCounts';
import { DECK_RULES } from './DeckRules';
import { DriverRecord } from './DriverRecord';
import { CAMPAIGN_FIXTURE } from './__fixtures__/storeFixtures';
import { stressCampaign } from './__fixtures__/stressCampaign';

const SEED = 20261006;

/** The Mixed environment's params for a map made from `seed`, as founding resolves them. */
const mapParamsFor = (seed: number): MapParams => resolveMapParams({ seed, environment: 'mixed' }).params;

const newCampaign = (options: Partial<CampaignOptions> = {}): Campaign => new Campaign({
	seed: SEED,
	generatorVersion: 1,
	mapParams: mapParamsFor(options.seed ?? SEED),
	...options
});

/** A save and a load: through JSON text and back. */
const reload = (campaign: Campaign): Campaign => Campaign.fromJSON(JSON.parse(JSON.stringify(campaign)));

/** The fixture as a fresh object to damage. */
const savedCampaign = (): CampaignJson => JSON.parse(JSON.stringify(CAMPAIGN_FIXTURE));

const record = (id: string): DriverRecord => new DriverRecord({ id, archetype: 'mechanic', name: 'Mechanic 1' });

/**
 * Keys whose children are data rather than format: card counts keyed by
 * card type, and map params, which a load repairs as the table moves on.
 */
const DATA_KEYS: Readonly<Record<string, string>> = {
	'locker': '<card type>',
	'drivers[].defaultDeck': '<card type>',
	'runDecks[].own': '<card type>',
	'runDecks[].leftHome': '<card type>',
	'runDecks[].borrowed': '<card type>',
	'mapParams': '<map parameter>'
};

/** Every key path in a JSON value, sorted, with array items as [] and data keys collapsed. */
const keyPaths = (value: unknown): string[] => {
	const paths = new Set<string>();
	const walk = (node: unknown, path: string): void => {
		if (path !== '') paths.add(path);
		if (Array.isArray(node)) node.forEach(item => walk(item, `${path}[]`));
		else if (typeof node === 'object' && node !== null) {
			for (const [key, item] of Object.entries(node)) walk(item, path === '' ? key : `${path}.${DATA_KEYS[path] ?? key}`);
		}
	};
	walk(value, '');
	return [...paths].sort();
};

/** The save format at the version the test below pins: a change here is a change of format, which bumps `CAMPAIGN_SCHEMA_VERSION`. */
const SAVE_FORMAT = {
	campaign: [
		'convoy', 'convoy.escorts', 'convoy.escorts[]', 'convoy.escorts[].armor', 'convoy.escorts[].baseSpeed', 'convoy.escorts[].escort',
		'convoy.escorts[].escort.dividend', 'convoy.escorts[].escort.dividend.amount', 'convoy.escorts[].escort.dividend.kind', 'convoy.escorts[].escort.evade',
		'convoy.escorts[].escort.gunnery', 'convoy.escorts[].escort.preferredSlot', 'convoy.escorts[].escort.preferredSlot.lane', 'convoy.escorts[].escort.preferredSlot.row',
		'convoy.escorts[].escort.ramming', 'convoy.escorts[].escort.role', 'convoy.escorts[].escort.signatureCard', 'convoy.escorts[].escort.type', 'convoy.escorts[].id',
		'convoy.escorts[].maxArmor', 'convoy.escorts[].maxStructure', 'convoy.escorts[].mods', 'convoy.escorts[].mods[]', 'convoy.escorts[].mods[].kind',
		'convoy.escorts[].mods[].name', 'convoy.escorts[].name', 'convoy.escorts[].structure', 'convoy.nextEscortNumber',
		'day', 'drivers', 'drivers[]', 'drivers[].archetype', 'drivers[].defaultDeck', 'drivers[].defaultDeck.<card type>',
		'drivers[].handLimit', 'drivers[].hitpoints', 'drivers[].id', 'drivers[].injuredDays', 'drivers[].maxHitpoints', 'drivers[].name',
		'drivers[].runsCompleted', 'drivers[].status', 'drivers[].vehicle', 'drivers[].vehicle.armor', 'drivers[].vehicle.structure', 'end', 'foundOnRun', 'foundOnRun[]', 'generatorVersion', 'locker', 'locker.<card type>', 'log', 'log[]', 'log[].day', 'log[].message', 'map',
		'mapParams', 'mapParams.<map parameter>', 'nextDriverNumber', 'nextRunNumber', 'resources', 'resources.food', 'resources.fuel', 'resources.meds', 'resources.people',
		'resources.scrap', 'resources.water', 'runDecks', 'runDecks[]', 'runDecks[].borrowed', 'runDecks[].borrowed.<card type>', 'runDecks[].driver',
		'runDecks[].escortCards', 'runDecks[].escortCards[]', 'runDecks[].escortCards[].broughtBy', 'runDecks[].escortCards[].cardType',
		'runDecks[].leftHome', 'runDecks[].leftHome.<card type>', 'runDecks[].own', 'runDecks[].own.<card type>',
		'seed', 'strongholdsTaken', 'strongholdsTaken[]', 'tally', 'tally.fightsWon', 'tally.runsFailed', 'tally.runsHome', 'unrest'
	],
	/** The fixture's campaign stands, so its end is null; a campaign that's over writes these. */
	end: ['cause', 'ending'],
	historyEntry: ['day', 'ending', 'seed', 'strongholdsTaken'],
	history: ['campaigns', 'version']
};

/** Every copy the compound owns between runs: the locker and every default deck. */
const cardsOwned = (campaign: Campaign): number =>
	totalCards(campaign.locker) + campaign.drivers.reduce((total, driver) => total + driver.deckSize, 0);

/** A few days in: drivers hurt, lost, and recruited, cards moved, an escort, a stronghold, a log. */
function campaignInProgress(): Campaign {
	const campaign = newCampaign({
		resources: { food: 14, water: 11, fuel: 6, meds: 2, scrap: 35, people: 18 },
		map: { fog: [0, 7, 255], roads: [{ id: 'r1', knowledge: 'charted', stops: null }] }
	});
	const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
	const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
	const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
	campaign.addLogEntry({ message: 'Founded the compound.' });
	campaign.set({ locker: { headshot: 2, emp_blast: 1 } });
	campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: 'locker' });
	campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });
	const hauler = createEscort({ type: 'fuel_hauler' });
	hauler.set({ structure: 31, mods: [{ name: 'Reinforced Tank', kind: 'defense' }] });
	campaign.convoy.add(hauler);
	campaign.set({ day: 3, unrest: 2 });
	interceptor.set({ status: 'dead', hitpoints: 0, defaultDeck: {}, runsCompleted: 2 });
	mechanic.set({ status: 'injured', hitpoints: 18, injuredDays: 2, runsCompleted: 1 });
	campaign.addLogEntry({ message: 'Interceptor 1 died on the road.' });
	campaign.set({ day: 6, strongholdsTaken: ['stronghold-3'] });
	campaign.recruitDriver({ archetype: 'interceptor' });
	campaign.addLogEntry({ message: 'Interceptor 2 joined from a wreck at Mile 40.' });
	return campaign;
}

describe('Campaign', () => {
	describe('a new campaign', () => {
		it('starts on day 1 with empty stores, no drivers, an empty locker, and no escorts', () => {
			const campaign = newCampaign();

			expect(campaign.day).toBe(1);
			expect(campaign.resources).toEqual(NO_RESOURCES);
			expect(campaign.unrest).toBe(0);
			expect(campaign.drivers).toEqual([]);
			expect(campaign.nextDriverNumber).toBe(1);
			expect(campaign.locker).toEqual({});
			expect(campaign.convoy.escorts).toEqual([]);
			expect(campaign.strongholdsTaken).toEqual([]);
			expect(campaign.log).toEqual([]);
			expect(campaign.map).toEqual({});
		});

		it.each([0, 0xffffffff])('takes a seed of %i, any uint32', (seed) => {
			expect(newCampaign({ seed }).seed).toBe(seed);
		});

		it.each([-1, 2 ** 32, 1.5, NaN])('rejects a seed of %p', (seed) => {
			expect(() => newCampaign({ seed })).toThrow(`Campaign.seed must be an integer from 0 to 4294967295, got ${seed}`);
		});

		it('rejects map params made from another seed', () => {
			expect(() => newCampaign({ mapParams: mapParamsFor(7) }))
				.toThrow("Campaign.mapParams.seed must be the campaign's seed, 20261006, got 7");
		});

		it.each([
			['an unknown environment', { environment: 'moon' }, 'Campaign.mapParams.environment must be one of highDesert, rustBelt, floodlands, badlands, mixed, got "moon"'],
			['a parameter in a string', { radius: '1000' }, 'Campaign.mapParams.radius must be a number, got "1000"'],
			['a parameter the map doesn\'t have', { weather: 0.5 }, 'Campaign.mapParams has an unknown field "weather"'],
			['stop tables that aren\'t an object', { stopTables: [] }, 'Campaign.mapParams.stopTables must be an object, got []']
		])('rejects map params with %s', (_label, change, message) => {
			expect(() => newCampaign({ mapParams: { ...mapParamsFor(SEED), ...change } as unknown as MapParams })).toThrow(message);
		});

		it('leaves ranges to the validator, which founding runs before it makes a map', () => {
			const campaign = newCampaign({ mapParams: { ...mapParamsFor(SEED), radius: 5000, highways: 6.5 } });

			expect([campaign.mapParams.radius, campaign.mapParams.highways]).toEqual([5000, 6.5]);
		});

		it.each(['radius', 'seed'] as const)('rejects map params with no %s', (param) => {
			const params: Partial<MapParams> = { ...mapParamsFor(SEED) };
			delete params[param];

			expect(() => newCampaign({ mapParams: params as MapParams })).toThrow(`Campaign.mapParams.${param} is missing`);
		});

		it('holds params whatever order they came in, written in the table\'s order', () => {
			const params = mapParamsFor(SEED);
			const reversed = Object.fromEntries(Object.entries(params).reverse()) as unknown as MapParams;

			expect(JSON.stringify(newCampaign({ mapParams: reversed }))).toBe(JSON.stringify(newCampaign({ mapParams: params })));
			expect(Object.keys(newCampaign({ mapParams: reversed }).mapParams)).toEqual(Object.keys(params));
		});

		it('keeps stop tables, frozen, through a save', () => {
			const stopTables = { highway: { raider_ambush: 3, checkpoint: 2 }, trail: { hazard: [1, 2] } };
			const campaign = newCampaign({ mapParams: { ...mapParamsFor(SEED), stopTables } });

			expect(reload(campaign).mapParams.stopTables).toEqual(stopTables);
			expect(Object.isFrozen((campaign.mapParams.stopTables as { trail: { hazard: number[] } }).trail.hazard)).toBe(true);
		});

		it('rejects a generator version below 1', () => {
			expect(() => newCampaign({ generatorVersion: 0 })).toThrow('Campaign.generatorVersion must be an integer >= 1, got 0');
		});
	});

	describe('the driver pool', () => {
		it('hands out ids in order and names each driver by archetype and ordinal', () => {
			const campaign = newCampaign();

			const drivers = (['road_warrior', 'interceptor', 'road_warrior'] as const).map(archetype => campaign.recruitDriver({ archetype }));

			expect(drivers.map(driver => [driver.id, driver.name])).toEqual([
				['driver-1', 'Road Warrior 1'],
				['driver-2', 'Interceptor 1'],
				['driver-3', 'Road Warrior 2']
			]);
			expect(campaign.drivers).toEqual(drivers);
			expect(campaign.nextDriverNumber).toBe(4);
		});

		it('counts the dead in an ordinal, so no two drivers share a name', () => {
			const campaign = newCampaign();
			campaign.recruitDriver({ archetype: 'mechanic' }).set({ status: 'dead', hitpoints: 0, defaultDeck: {} });

			expect(campaign.recruitDriver({ archetype: 'mechanic' }).name).toBe('Mechanic 2');
		});

		it('never hands out an id twice, even across a save and a load', () => {
			const campaign = newCampaign();
			campaign.recruitDriver({ archetype: 'road_warrior' });
			campaign.recruitDriver({ archetype: 'interceptor' });

			const loaded = reload(campaign);
			const recruit = loaded.recruitDriver({ archetype: 'mechanic' });

			expect(recruit.id).toBe('driver-3');
			expect(loaded.drivers.map(driver => driver.id)).toEqual(['driver-1', 'driver-2', 'driver-3']);
		});

		it('carries on from a saved counter that runs ahead of the pool', () => {
			const campaign = newCampaign({ drivers: [record('driver-1')], nextDriverNumber: 7 });

			expect(campaign.recruitDriver({ archetype: 'raider' }).id).toBe('driver-7');
		});

		it('takes a driver set into the pool only with an id the counter hasn\'t passed', () => {
			const campaign = newCampaign({ drivers: [record('driver-1')], nextDriverNumber: 7 });
			const pool = campaign.drivers;

			expect(() => campaign.set({ drivers: [...pool, record('driver-3')], nextDriverNumber: 8 }))
				.toThrow("Campaign.drivers[1].id must be driver-7 or later, an id the counter hasn't passed, got driver-3");
			campaign.set({ drivers: [...pool, record('driver-7')], nextDriverNumber: 8 });

			expect(campaign.drivers.map(driver => driver.id)).toEqual(['driver-1', 'driver-7']);
		});

		it('starts the counter past the highest id when built without one', () => {
			expect(newCampaign({ drivers: [record('driver-4'), record('driver-2')] }).nextDriverNumber).toBe(5);
		});

		it('never turns the counter back, so an id can\'t come round again', () => {
			const campaign = newCampaign();
			campaign.recruitDriver({ archetype: 'road_warrior' });
			campaign.recruitDriver({ archetype: 'interceptor' });

			expect(() => campaign.set({ nextDriverNumber: 2 })).toThrow("Campaign.nextDriverNumber can't go back, from 3 to 2");
			campaign.set({ nextDriverNumber: 5 });

			expect(campaign.recruitDriver({ archetype: 'mechanic' }).id).toBe('driver-5');
		});

		it('keeps every driver it has had, in their places, and only adds after them', () => {
			const campaign = newCampaign();
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const interceptor = campaign.recruitDriver({ archetype: 'interceptor' });
			const pool = campaign.drivers;

			expect(() => campaign.set({ drivers: [] })).toThrow('Campaign.drivers is missing driver-1 (Road Warrior 1): drivers stay in the pool, the dead and missing too');
			expect(() => campaign.set({ drivers: [warrior] })).toThrow('Campaign.drivers is missing driver-2 (Interceptor 1)');
			expect(() => campaign.set({ drivers: [interceptor, warrior] }))
				.toThrow('Campaign.drivers[0] must still be driver-1 (Road Warrior 1): drivers keep their places in the pool');
			expect(() => campaign.set({ drivers: [record('driver-1'), interceptor] })).toThrow('Campaign.drivers[0] must still be driver-1 (Road Warrior 1)');
			expect(() => campaign.set({ drivers: [...pool, record('driver-1')], nextDriverNumber: 4 }))
				.toThrow('Campaign.drivers[2].id driver-1 belongs to an earlier driver');
			campaign.set({ drivers: [...pool, record('driver-3')], nextDriverNumber: 4 });

			expect(campaign.drivers.map(driver => driver.id)).toEqual(['driver-1', 'driver-2', 'driver-3']);
		});

		it('checks the archetype before naming a recruit, and takes nobody', () => {
			const campaign = newCampaign();

			expect(() => campaign.recruitDriver({ archetype: 'mutant' as DriverArchetype }))
				.toThrow('archetype must be one of road_warrior, interceptor, mechanic, raider, got "mutant"');
			expect(campaign.drivers).toEqual([]);
			expect(campaign.nextDriverNumber).toBe(1);
		});

		it('draws nothing random: the ids and the whole save come out the same whatever Math.random says', () => {
			const random = jest.spyOn(Math, 'random');
			random.mockReturnValue(0.1);
			const first = campaignInProgress();
			random.mockReturnValue(0.9);
			const second = campaignInProgress();
			random.mockRestore();

			expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		});

		it.each([
			['two drivers with one id', [record('driver-1'), record('driver-1')], 3, 'Campaign.drivers[1].id driver-1 belongs to an earlier driver'],
			['an id the counter will hand out again', [record('driver-3')], 3, 'Campaign.drivers[0].id must come before driver-3, the next id to hand out, got driver-3'],
			['an id that isn\'t driver-<n>', [record('max')], 1, 'Campaign.drivers[0].id must look like driver-1, got "max"'],
			['an id with a leading zero', [record('driver-01')], 2, 'Campaign.drivers[0].id must look like driver-1, got "driver-01"']
		])('rejects %s', (_label, drivers, nextDriverNumber, message) => {
			expect(() => newCampaign({ drivers, nextDriverNumber })).toThrow(message);
		});

		it('rejects a driver that isn\'t a record', () => {
			const json = record('driver-1').toJSON();

			expect(() => newCampaign({ drivers: [json as unknown as DriverRecord] })).toThrow(/^Campaign\.drivers\[0\] must be a DriverRecord, got \{"id":"driver-1"/);
		});
	});

	describe('cards between the locker and default decks', () => {
		it('move without making or losing a copy', () => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const owned = cardsOwned(campaign);

			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });
			campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: 'locker', count: 2 });

			expect(campaign.locker).toEqual({ headshot: 1, ramming_speed: 2 });
			expect(cardCount(warrior.defaultDeck, 'headshot')).toBe(1);
			expect(cardCount(warrior.defaultDeck, 'ramming_speed')).toBe(3);
			expect(cardsOwned(campaign)).toBe(owned);
		});

		it('move from one driver\'s deck to another\'s', () => {
			const campaign = newCampaign();
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
			const owned = cardsOwned(campaign);
			const ramming = cardCount(warrior.defaultDeck, 'ramming_speed');
			const count = warrior.deckSize - DECK_RULES.deckSize.min;

			campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic, count });

			expect(cardCount(warrior.defaultDeck, 'ramming_speed')).toBe(ramming - count);
			expect(cardCount(mechanic.defaultDeck, 'ramming_speed')).toBe(count);
			expect(cardsOwned(campaign)).toBe(owned);
		});

		it('tell the campaign and the driver when they change', () => {
			const campaign = newCampaign({ locker: { headshot: 1 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const lockerChanged = jest.fn();
			const deckChanged = jest.fn();
			campaign.on('locker', lockerChanged);
			warrior.on('defaultDeck', deckChanged);

			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });

			expect(lockerChanged).toHaveBeenCalledWith({}, { headshot: 1 });
			expect(deckChanged).toHaveBeenCalledTimes(1);
		});

		it('move nothing when the source holds too few, and say so', () => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const deck = warrior.defaultDeck;
			const changes = jest.fn();
			campaign.on('change', changes);
			warrior.on('change', changes);

			expect(() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior, count: 3 }))
				.toThrow("Can't move 3 headshot from the locker, which holds 2");
			expect(() => campaign.moveCards({ cardType: 'emp_blast', from: warrior, to: 'locker' }))
				.toThrow("Can't move 1 emp_blast from Road Warrior 1's deck, which holds 0");

			expect(campaign.locker).toEqual({ headshot: 2 });
			expect(warrior.defaultDeck).toBe(deck);
			expect(changes).not.toHaveBeenCalled();
		});

		it('only move between places in this campaign', () => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const stranger = newCampaign().recruitDriver({ archetype: 'road_warrior' });

			expect(() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: stranger }))
				.toThrow("Road Warrior 1 (driver-1) isn't in this campaign's pool");
			expect(() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: 'locker' }))
				.toThrow("Can't move headshot from the locker to itself");
			expect(campaign.locker).toEqual({ headshot: 2 });
		});

		describe.each([
			['dead', { status: 'dead', hitpoints: 0, defaultDeck: {} }],
			['missing', { status: 'missing', hitpoints: 12 }]
		] as const)('with a %s driver', (status, fate) => {
			/** The locker, a driver still at the compound, and one who's gone, with the move that would touch them. */
			function setUp(): { campaign: Campaign; gone: DriverRecord; before: string } {
				const campaign = newCampaign({ locker: { headshot: 2 } });
				campaign.recruitDriver({ archetype: 'road_warrior' });
				const gone = campaign.recruitDriver({ archetype: 'interceptor' });
				gone.set(fate);
				return { campaign, gone, before: JSON.stringify(campaign) };
			}

			it(`won't hand cards to a ${status} driver`, () => {
				const { campaign, gone, before } = setUp();

				expect(() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: gone }))
					.toThrow(`Interceptor 1 (driver-2) is ${status}, so no cards move to or from their deck`);
				expect(JSON.stringify(campaign)).toBe(before);
			});

			it(`won't take cards from a ${status} driver`, () => {
				const { campaign, gone, before } = setUp();

				expect(() => campaign.moveCards({ cardType: 'precision_shot', from: gone, to: campaign.drivers[0] }))
					.toThrow(`Interceptor 1 (driver-2) is ${status}, so no cards move to or from their deck`);
				expect(() => campaign.moveCards({ cardType: 'precision_shot', from: gone, to: 'locker' }))
					.toThrow(`Interceptor 1 (driver-2) is ${status}, so no cards move to or from their deck`);
				expect(JSON.stringify(campaign)).toBe(before);
			});
		});

		it('still reach an injured driver, who is at the compound healing', () => {
			const campaign = newCampaign({ locker: { headshot: 1 } });
			const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
			mechanic.set({ status: 'injured', hitpoints: 10, injuredDays: 3 });

			campaign.moveCards({ cardType: 'headshot', from: 'locker', to: mechanic });

			expect(cardCount(mechanic.defaultDeck, 'headshot')).toBe(1);
		});

		it('store neither end when the far end can\'t take the copies', () => {
			const campaign = newCampaign({ locker: { ramming_speed: Number.MAX_SAFE_INTEGER } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const deck = warrior.defaultDeck;

			expect(() => campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: 'locker' })).toThrow(RangeError);

			expect(campaign.locker).toEqual({ ramming_speed: Number.MAX_SAFE_INTEGER });
			expect(warrior.defaultDeck).toBe(deck);
		});

		it('store neither end of a move between decks when the locker, where the copies fall back to, couldn\'t take them', () => {
			const campaign = newCampaign({ locker: { ramming_speed: Number.MAX_SAFE_INTEGER } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
			const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
			const decks = [warrior.defaultDeck, mechanic.defaultDeck];

			expect(() => campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic })).toThrow(RangeError);

			expect([warrior.defaultDeck, mechanic.defaultDeck]).toEqual(decks);
		});

		describe('and what listeners hear', () => {
			/** A campaign with copies in the locker and two drivers, and every copy it owns. */
			function setUp(): { campaign: Campaign; warrior: DriverRecord; mechanic: DriverRecord; owned: number } {
				const campaign = newCampaign({ locker: { headshot: 2 } });
				const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });
				const mechanic = campaign.recruitDriver({ archetype: 'mechanic' });
				return { campaign, warrior, mechanic, owned: cardsOwned(campaign) };
			}

			it.each([
				['from the locker to a deck', (warrior: DriverRecord) => ({ from: 'locker' as const, to: warrior, cardType: 'headshot' })],
				['from a deck to the locker', (warrior: DriverRecord) => ({ from: warrior, to: 'locker' as const, cardType: 'ramming_speed' })],
				['from one deck to another', (warrior: DriverRecord, mechanic: DriverRecord) => ({ from: warrior, to: mechanic, cardType: 'ramming_speed' })]
			])('a campaign listener hears a move %s once, when it\'s whole', (_label, move) => {
				const { campaign, warrior, mechanic, owned } = setUp();
				const heard: number[] = [];
				campaign.on('change', () => heard.push(cardsOwned(campaign)));

				campaign.moveCards(move(warrior, mechanic));

				expect(heard).toEqual([owned]);
			});

			it('a listener can\'t start another move, or change the campaign at all, while one is being stored', () => {
				const { campaign, warrior, mechanic, owned } = setUp();
				const refused: string[] = [];
				const heard = jest.fn();
				campaign.on('change', heard);
				warrior.on('defaultDeck', () => {
					for (const attempt of [
						() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: mechanic }),
						() => campaign.set({ locker: {} }),
						() => campaign.set({ day: 2 }),
						() => campaign.addLogEntry({ message: 'Moved a headshot.' })
					]) {
						try {
							attempt();
						} catch (error) {
							refused.push((error as Error).message);
						}
					}
				});

				campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });

				expect(refused).toEqual([
					"Can't move cards while another move is being stored",
					"Campaign can't change while a card move is being stored",
					"Campaign can't change while a card move is being stored",
					"Campaign can't change while a card move is being stored"
				]);
				expect([campaign.locker, campaign.day, campaign.log]).toEqual([{ headshot: 1 }, 1, []]);
				expect(cardsOwned(campaign)).toBe(owned);
				expect(heard).toHaveBeenCalledTimes(1);
			});

			it('the copies land on the deck the far end holds once the near end is stored', () => {
				const { campaign, warrior, mechanic } = setUp();
				const ramming = cardCount(warrior.defaultDeck, 'ramming_speed');
				warrior.once('defaultDeck', () => mechanic.set({ defaultDeck: { headshot: 1 } }));

				campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic });

				expect(mechanic.defaultDeck).toEqual({ headshot: 1, ramming_speed: 1 });
				expect(cardCount(warrior.defaultDeck, 'ramming_speed')).toBe(ramming - 1);
			});

			it.each([
				['dies', { status: 'dead', hitpoints: 0, defaultDeck: {} }],
				['goes missing', { status: 'missing' }]
			] as const)('the copies go back when a listener on the near end sees to it the far end %s', (_label, fate) => {
				const { campaign, warrior, mechanic } = setUp();
				const deck = warrior.defaultDeck;
				const heard = jest.fn();
				campaign.on('change', heard);
				warrior.once('defaultDeck', () => mechanic.set(fate));

				campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic });

				expect(warrior.defaultDeck).toEqual(deck);
				expect(mechanic.status).toBe(fate.status);
				expect(cardCount(mechanic.defaultDeck, 'ramming_speed')).toBe(0);
				expect(heard).toHaveBeenCalledTimes(1);
			});

			it('the copies go to the locker when both ends have left by the time they land', () => {
				const { campaign, warrior, mechanic, owned } = setUp();
				warrior.once('defaultDeck', () => {
					warrior.set({ status: 'missing' });
					mechanic.set({ status: 'missing' });
				});

				campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic });

				expect(campaign.locker).toEqual({ headshot: 2, ramming_speed: 1 });
				expect(cardsOwned(campaign)).toBe(owned);
			});

			it('the copies go back when a listener fills the far deck past what a count holds', () => {
				const { campaign, warrior, mechanic } = setUp();
				const deck = warrior.defaultDeck;
				const heard = jest.fn();
				campaign.on('change', heard);
				warrior.once('defaultDeck', () => mechanic.set({ defaultDeck: { ramming_speed: Number.MAX_SAFE_INTEGER } }));

				campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic });

				expect(warrior.defaultDeck).toEqual(deck);
				expect(mechanic.defaultDeck).toEqual({ ramming_speed: Number.MAX_SAFE_INTEGER });
				expect(heard).toHaveBeenCalledTimes(1);
			});

			it('a campaign listener can move cards once the move it heard is whole', () => {
				const { campaign, warrior, mechanic, owned } = setUp();
				let followed = false;
				campaign.on('change', () => {
					if (followed) return;
					followed = true;
					campaign.moveCards({ cardType: 'headshot', from: warrior, to: mechanic });
				});

				campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior });

				expect([campaign.locker, cardCount(warrior.defaultDeck, 'headshot'), cardCount(mechanic.defaultDeck, 'headshot')])
					.toEqual([{ headshot: 1 }, 0, 1]);
				expect(cardsOwned(campaign)).toBe(owned);
			});
		});

		it.each([
			['a count of 0', { count: 0 }, 'count must be an integer >= 1, got 0'],
			['half a copy', { count: 0.5 }, 'count must be an integer >= 1, got 0.5'],
			['a card by its name', { cardType: 'Headshot' }, 'cardType must be a card type in lower snake case, got "Headshot"']
		])('refuse to move %s', (_label, options, message) => {
			const campaign = newCampaign({ locker: { headshot: 2 } });
			const warrior = campaign.recruitDriver({ archetype: 'road_warrior' });

			expect(() => campaign.moveCards({ cardType: 'headshot', from: 'locker', to: warrior, ...options })).toThrow(message);
		});
	});

	describe('the log', () => {
		it('dates each entry with the day it was added', () => {
			const campaign = newCampaign();
			campaign.addLogEntry({ message: 'Founded the compound.' });
			campaign.set({ day: 4 });
			campaign.addLogEntry({ message: 'Took the north stronghold.' });

			expect(campaign.log).toEqual([
				{ day: 1, message: 'Founded the compound.' },
				{ day: 4, message: 'Took the north stronghold.' }
			]);
		});

		it('adds to the entries it holds rather than rebuilding them', () => {
			const campaign = newCampaign();
			campaign.addLogEntry({ message: 'Founded the compound.' });
			const [founded] = campaign.log;

			campaign.set({ day: 2 });
			campaign.addLogEntry({ message: 'Took the north stronghold.' });

			expect(campaign.log[0]).toBe(founded);
			expect(campaign.log).toHaveLength(2);
		});

		it('checks an added entry against the newest one before it and today', () => {
			const campaign = newCampaign({ day: 5 });
			campaign.addLogEntry({ message: 'Took the north stronghold.' });

			expect(() => campaign.set({ log: [...campaign.log, { day: 3, message: 'Earlier.' }] }))
				.toThrow('Campaign.log[1].day must not come before the entry above it (day 5), got 3');
			expect(() => campaign.set({ log: [...campaign.log, { day: 6, message: 'Tomorrow.' }] }))
				.toThrow('Campaign.log[1].day must be an integer from 1 to today (5), got 6');
		});

		it('checks a log that changes what came before in full', () => {
			const campaign = newCampaign({ day: 5 });
			campaign.addLogEntry({ message: 'Took the north stronghold.' });

			campaign.set({ log: [{ day: 2, message: 'Founded the compound.' }, { day: 5, message: 'Took the north stronghold.' }] });

			expect(() => campaign.set({ log: [{ day: 4, message: 'Later.' }, { day: 3, message: 'Earlier.' }] }))
				.toThrow('Campaign.log[1].day must not come before the entry above it (day 4), got 3');
			expect(campaign.log.map(entry => entry.day)).toEqual([2, 5]);
		});
	});

	describe('set', () => {
		it('changes fields together, with one change event', () => {
			const campaign = newCampaign();
			const changes = jest.fn();
			campaign.on('change', changes);

			campaign.set({ day: 2, unrest: 1, resources: { ...NO_RESOURCES, food: 8 } });

			expect([campaign.day, campaign.unrest, campaign.resources.food]).toEqual([2, 1, 8]);
			expect(changes).toHaveBeenCalledTimes(1);
		});

		it.each([
			['day 0', { day: 0 }, 'Campaign.day must be an integer >= 1, got 0'],
			['negative fuel', { resources: { ...NO_RESOURCES, fuel: -1 } }, 'Campaign.resources.fuel must be an integer >= 0, got -1'],
			['part of a scrap', { resources: { ...NO_RESOURCES, scrap: 0.5 } }, 'Campaign.resources.scrap must be an integer >= 0, got 0.5'],
			['a missing resource', { resources: { food: 1 } }, 'Campaign.resources.water is missing'],
			['an unknown resource', { resources: { ...NO_RESOURCES, ammo: 3 } }, 'Campaign.resources has an unknown field "ammo"'],
			['negative unrest', { unrest: -1 }, 'Campaign.unrest must be an integer >= 0, got -1'],
			['a blank stronghold id', { strongholdsTaken: [''] }, 'Campaign.strongholdsTaken[0] must not be blank'],
			['a stronghold taken twice', { strongholdsTaken: ['north', 'north'] }, 'Campaign.strongholdsTaken[1] "north" is already in the list'],
			['a log entry dated after today', { log: [{ day: 2, message: 'Tomorrow.' }] }, 'Campaign.log[0].day must be an integer from 1 to today (1), got 2'],
			['log entries out of order', { day: 5, log: [{ day: 4, message: 'Later.' }, { day: 3, message: 'Earlier.' }] }, 'Campaign.log[1].day must not come before the entry above it (day 4), got 3'],
			['a blank log message', { log: [{ day: 1, message: '' }] }, 'Campaign.log[0].message must not be blank'],
			['a locker count of 0', { locker: { headshot: 0 } }, 'Campaign.locker.headshot must be an integer >= 1, got 0'],
			['map state JSON can\'t hold', { map: { found: new Date(0) } }, 'Campaign.map.found must be JSON'],
			['map state with no number', { map: { fog: [1, NaN] } }, 'Campaign.map.fog[1] must be a finite number, got NaN'],
			['map state with a hole in it', { map: { fog: undefined } }, 'Campaign.map.fog must be JSON'],
			['a field a campaign doesn\'t have', { weather: 'dust' }, 'Campaign has an unknown field "weather"']
		])('rejects %s', (_label, changes, message) => {
			expect(() => newCampaign().set(changes as unknown as Partial<CampaignOptions>)).toThrow(message);
		});

		it('rejects a list with a hole in it, which nothing would check', () => {
			const strongholdsTaken: string[] = Array(3);
			strongholdsTaken[0] = 'north';
			strongholdsTaken[2] = 'south';

			expect(() => newCampaign().set({ strongholdsTaken })).toThrow('Campaign.strongholdsTaken[1] is missing: the array has a hole there');
		});

		it('rejects map state that contains itself', () => {
			const fog: Record<string, unknown> = {};
			fog.again = fog;

			expect(() => newCampaign().set({ map: { fog } as unknown as CampaignOptions['map'] })).toThrow('Campaign.map.fog.again contains itself');
		});

		it('changes nothing when part of a change is invalid', () => {
			const campaign = newCampaign({ day: 3 });

			expect(() => campaign.set({ day: 4, unrest: -1 })).toThrow('Campaign.unrest must be an integer >= 0, got -1');

			expect(campaign.day).toBe(3);
		});

		it('won\'t turn the day back, since it names each day\'s draws, though it takes the same day again', () => {
			const campaign = newCampaign({ day: 6 });

			expect(() => campaign.set({ day: 5 })).toThrow("Campaign.day can't go back, from 6 to 5");
			campaign.set({ day: 6, unrest: 1 });

			expect([campaign.day, campaign.unrest]).toEqual([6, 1]);
		});

		it('won\'t turn the clock back before a logged day', () => {
			const campaign = newCampaign({ day: 6 });
			campaign.addLogEntry({ message: 'Took the north stronghold.' });

			expect(() => campaign.set({ day: 5 })).toThrow('Campaign.log[0].day must be an integer from 1 to today (5), got 6');
		});

		it('treats what it already holds as unchanged, and keeps it as it is', () => {
			const campaign = campaignInProgress();
			const held = {
				map: campaign.map,
				mapParams: campaign.mapParams,
				resources: campaign.resources,
				drivers: campaign.drivers,
				locker: campaign.locker,
				strongholdsTaken: campaign.strongholdsTaken,
				log: campaign.log
			};
			const changes = jest.fn();
			campaign.on('change', changes);

			campaign.set(held);
			campaign.set({ ...held, unrest: 7 });

			expect(changes).toHaveBeenCalledTimes(1);
			expect(changes).toHaveBeenCalledWith(expect.objectContaining({ unrest: 7 }));
			expect(Object.entries(held).filter(([field, value]) => campaign[field as keyof typeof held] !== value)).toEqual([]);
		});

		it('keeps the seed, generator version, and map params from founding', () => {
			const campaign = newCampaign();

			expect(() => campaign.set({ seed: 7 })).toThrow('Campaign.seed is fixed at founding');
			expect(() => campaign.set({ generatorVersion: 2 })).toThrow('Campaign.generatorVersion is fixed at founding');
			expect(() => campaign.set({ mapParams: mapParamsFor(SEED) })).toThrow('Campaign.mapParams is fixed at founding');
			campaign.set({ seed: SEED, generatorVersion: 1, mapParams: campaign.mapParams });
		});

		it('keeps its convoy for good, since a new one would start the escort ids over', () => {
			const campaign = campaignInProgress();

			expect(() => campaign.set({ convoy: new Convoy() })).toThrow('Campaign.convoy is fixed at founding');
			campaign.set({ convoy: campaign.convoy });
			expect(() => newCampaign({ convoy: { escorts: [] } as unknown as Convoy })).toThrow('Campaign.convoy must be a Convoy, got {"escorts":[]}');
		});

		it('holds every value frozen, so nothing changes without a check', () => {
			const campaign = campaignInProgress();

			expect([
				campaign.resources,
				campaign.drivers,
				campaign.locker,
				campaign.strongholdsTaken,
				campaign.log,
				campaign.log[0],
				campaign.mapParams,
				campaign.map,
				(campaign.map.roads as readonly unknown[])[0]
			].every(value => Object.isFrozen(value))).toBe(true);
		});

		it('is the only way in: the properties are read-only to the compiler', () => {
			const campaign = newCampaign();
			const assign = (): void => {
				// @ts-expect-error properties are read-only, so changes go through set's checks
				campaign.day = 2;
				// @ts-expect-error the pool is a read-only list; recruitDriver adds to it
				campaign.drivers.push(record('driver-1'));
			};

			expect(assign).toBeInstanceOf(Function);
		});
	});

	describe('saving and loading', () => {
		it('loads what it saved, field for field', () => {
			const campaign = campaignInProgress();

			const loaded = reload(campaign);

			expect(loaded.toJSON()).toEqual(campaign.toJSON());
			expect(JSON.stringify(loaded)).toBe(JSON.stringify(campaign));
			expect(loaded.drivers.map(driver => [driver.name, driver.status])).toEqual([
				['Road Warrior 1', 'ready'],
				['Interceptor 1', 'dead'],
				['Mechanic 1', 'injured'],
				['Interceptor 2', 'ready']
			]);
			expect(loaded.convoy.escorts[0].structure).toBe(31);
			expect(loaded.map).toEqual({ fog: [0, 7, 255], roads: [{ id: 'r1', knowledge: 'charted', stops: null }] });
		});

		it('keeps each escort\'s id and the counter they come from, so a load hands out none of them again', () => {
			const campaign = campaignInProgress();
			campaign.convoy.add(createEscort({ type: 'outrider' }));
			campaign.convoy.afterFight({ lost: [campaign.convoy.escorts[0]] });

			const loaded = reload(campaign);
			loaded.convoy.add(createEscort({ type: 'med_truck' }));

			expect(campaign.convoy.escorts.map(escort => escort.convoyId)).toEqual(['escort-2']);
			expect(loaded.convoy.escorts.map(escort => escort.convoyId)).toEqual(['escort-2', 'escort-3']);
			expect(reload(loaded).convoy.escorts.map(escort => escort.convoyId)).toEqual(['escort-2', 'escort-3']);
		});

		it('loads a campaign of its own: changing it leaves the original alone', () => {
			const campaign = campaignInProgress();
			const loaded = reload(campaign);

			loaded.drivers[0].set({ hitpoints: 3, status: 'injured', injuredDays: 1 });
			loaded.convoy.dismiss({ escort: loaded.convoy.escorts[0], drivers: [] });
			loaded.moveCards({ cardType: 'headshot', from: loaded.drivers[0], to: 'locker' });

			expect(campaign.toJSON()).toEqual(campaignInProgress().toJSON());
		});

		it('writes plain JSON that comes through JSON text whole, and is the caller\'s to change', () => {
			const campaign = campaignInProgress();
			const before = JSON.stringify(campaign);
			const json = campaign.toJSON();

			expect(JSON.parse(JSON.stringify(json))).toEqual(json);
			json.locker.headshot = 99;
			json.drivers[0].defaultDeck.headshot = 99;
			json.convoy.escorts[0].mods[0].name = 'Spikes';
			(json.map.roads as { id: string }[])[0].id = 'r9';

			expect(JSON.stringify(campaign)).toBe(before);
		});

		it('writes the same text for the same campaign, whatever order it was built in', () => {
			const first = newCampaign({ locker: { repair_kit: 1, headshot: 2 }, resources: { ...NO_RESOURCES, people: 4, food: 2 } });
			const second = newCampaign({ locker: { headshot: 2, repair_kit: 1 }, resources: { food: 2, people: 4, water: 0, fuel: 0, meds: 0, scrap: 0 } });

			expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		});

		it('reads the fixture and writes it back the same', () => {
			const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);

			expect(campaign.toJSON()).toEqual(CAMPAIGN_FIXTURE);
			expect(campaign.drivers.map(driver => driver.status)).toEqual(['ready', 'dead', 'injured', 'missing', 'ready']);
			expect(campaign.convoy.escorts.map(escort => [escort.escort?.type, escort.convoyId])).toEqual([['fuel_hauler', 'escort-1'], ['outrider', 'escort-3']]);
			// A run out, with Road Warrior 1 and Interceptor 2 seated
			const [first, second] = campaign.runDecks;
			expect([first.driver, second.driver]).toEqual([campaign.drivers[0], campaign.drivers[4]]);
			expect([first.deckSize, first.escortCards]).toEqual([11, [{ cardType: 'top_off', broughtBy: 'escort-1' }]]);
			expect(second.borrowed).toEqual({ headshot: 1 });
			expect(campaign.recruitDriver({ archetype: 'mechanic' }).id).toBe('driver-6');
			const hired = createEscort({ type: 'pilot_car' });
			campaign.convoy.add(hired);
			expect(hired.convoyId).toBe('escort-4');
		});

		it('builds what it keeps from a save parsed in another realm in this one', () => {
			const foreign: unknown = runInNewContext('JSON.parse(text)', { text: JSON.stringify(CAMPAIGN_FIXTURE) });
			const campaign = Campaign.fromJSON(foreign);
			const [first] = campaign.runDecks;
			const arrays = [campaign.log, campaign.strongholdsTaken, campaign.runDecks, first.escortCards, campaign.convoy.escorts[0].mods];

			expect(arrays.map(array => Object.getPrototypeOf(array) === Array.prototype)).toEqual([true, true, true, true, true]);
			expect(campaign.toJSON()).toEqual(CAMPAIGN_FIXTURE);
		});

		it('holds the save format to the version it\'s stamped with', () => {
			const campaign = Campaign.fromJSON(CAMPAIGN_FIXTURE);
			// The fixture home from its run, with nobody left: People gone, so the compound fell
			const ended = Campaign.fromJSON({
				...savedCampaign(),
				runDecks: [],
				foundOnRun: [],
				resources: { ...CAMPAIGN_FIXTURE.resources, people: 0 },
				end: { ending: 'disbanded', cause: 'no_people' }
			});
			const format = {
				campaign: keyPaths(CAMPAIGN_FIXTURE),
				end: keyPaths(ended.toJSON().end),
				historyEntry: Object.keys(historyEntry({ campaign, ending: 'won' })).sort(),
				history: Object.keys(historyToJson({ version: CAMPAIGN_SCHEMA_VERSION, entries: [] })).sort()
			};

			expect(CAMPAIGN_SCHEMA_VERSION).toBe(6);
			try {
				expect(format).toEqual(SAVE_FORMAT);
			} catch (error) {
				throw new Error(`format changed: bump CAMPAIGN_SCHEMA_VERSION and re-pin\n${(error as Error).message}`);
			}
		});

		describe('a damaged save', () => {
			it.each([
				['a missing field', (save: CampaignJson) => { delete (save as Partial<CampaignJson>).day; }, TypeError, 'Campaign.day is missing'],
				['an unknown field', (save: CampaignJson) => { (save as unknown as Record<string, unknown>).weather = 'dust'; }, TypeError, 'Campaign has an unknown field "weather"'],
				['a seed past uint32', (save: CampaignJson) => { save.seed = 2 ** 32; }, RangeError, 'Campaign.seed must be an integer from 0 to 4294967295, got 4294967296'],
				['map params from another seed', (save: CampaignJson) => { save.mapParams = mapParamsFor(7); }, RangeError, "Campaign.mapParams.seed must be the campaign's seed, 20261006, got 7"],
				['map params that aren\'t an object', (save: CampaignJson) => { (save as unknown as Record<string, unknown>).mapParams = null; }, TypeError, 'Campaign.mapParams must be an object, got null'],
				['map params with no seed', (save: CampaignJson) => { delete (save.mapParams as Partial<MapParams>).seed; }, TypeError, 'Campaign.mapParams.seed is missing'],
				['a map parameter in a string', (save: CampaignJson) => { (save.mapParams as unknown as Record<string, unknown>).radius = '1000'; }, TypeError, 'Campaign.mapParams.radius must be a number, got "1000"'],
				['an environment that isn\'t a string', (save: CampaignJson) => { (save.mapParams as unknown as Record<string, unknown>).environment = 7; }, TypeError, 'Campaign.mapParams.environment must be a string, got 7'],
				['stop tables that aren\'t an object', (save: CampaignJson) => { (save.mapParams as unknown as Record<string, unknown>).stopTables = []; }, TypeError, 'Campaign.mapParams.stopTables must be an object, got []'],
				['a driver with an unknown status', (save: CampaignJson) => { (save.drivers[1] as { status: string }).status = 'sleeping'; }, RangeError, 'Campaign.drivers[1].status must be one of ready, injured, dead, missing, got "sleeping"'],
				['a driver over max HP', (save: CampaignJson) => { save.drivers[0].hitpoints = 41; }, RangeError, 'Campaign.drivers[0].hitpoints must be an integer from 0 to maxHitpoints (40), got 41'],
				['a dead driver with HP', (save: CampaignJson) => { save.drivers[1].hitpoints = 5; }, RangeError, 'Campaign.drivers[1].hitpoints must be 0 for a dead driver, got 5'],
				['two drivers with one id', (save: CampaignJson) => { save.drivers[1].id = 'driver-1'; }, RangeError, 'Campaign.drivers[1].id driver-1 belongs to an earlier driver'],
				['a counter that would hand out an id again', (save: CampaignJson) => { save.nextDriverNumber = 5; }, RangeError, 'Campaign.drivers[4].id must come before driver-5, the next id to hand out, got driver-5'],
				['a locker count of 0', (save: CampaignJson) => { save.locker.headshot = 0; }, RangeError, 'Campaign.locker.headshot must be an integer >= 1, got 0'],
				['an escort with an unknown role', (save: CampaignJson) => { (save.convoy.escorts[0].escort as { role: string }).role = 'scout'; }, RangeError, 'Campaign.convoy.escorts[0].escort.role must be one of gun, hauler, got "scout"'],
				['an escort with no id', (save: CampaignJson) => { delete (save.convoy.escorts[0] as Partial<EscortJson>).id; }, TypeError, 'Campaign.convoy.escorts[0].id is missing'],
				['an escort named by a session\'s model id', (save: CampaignJson) => { save.convoy.escorts[0].id = 'Vehicle_12'; }, RangeError, 'Campaign.convoy.escorts[0].id must look like escort-1, got "Vehicle_12"'],
				['two escorts with one id', (save: CampaignJson) => { save.convoy.escorts[1].id = 'escort-1'; }, RangeError, 'Campaign.convoy.escorts[1].id escort-1 belongs to an earlier escort'],
				['an escort counter that would hand out an id again', (save: CampaignJson) => { save.convoy.nextEscortNumber = 3; }, RangeError, 'Campaign.convoy.escorts[1].id must come before escort-3, the next id to hand out, got escort-3'],
				['more escorts than a convoy holds', (save: CampaignJson) => { save.convoy.escorts.push(...save.convoy.escorts, save.convoy.escorts[0]); }, RangeError, 'Campaign.convoy.escorts holds 5 escorts, and a convoy holds 4 at most'],
				['a log entry from the future', (save: CampaignJson) => { save.log[3].day = 99; }, RangeError, 'Campaign.log[3].day must be an integer from 1 to today (9), got 99'],
				['negative water', (save: CampaignJson) => { save.resources.water = -3; }, RangeError, 'Campaign.resources.water must be an integer >= 0, got -3'],
				['a dead driver who kept their cards', (save: CampaignJson) => { save.drivers[1].defaultDeck = { headshot: 1 }; }, RangeError, 'Campaign.drivers[1].defaultDeck must be empty for a dead driver, whose cards went with them, got {"headshot":1}'],
				['a wrecked escort', (save: CampaignJson) => { save.convoy.escorts[0].structure = 0; }, RangeError, 'Campaign.convoy.escorts[0].structure must be an integer from 1 to maxStructure (40), got 0'],
				['a run deck for a driver who isn\'t in the pool', (save: CampaignJson) => { save.runDecks[1].driver = 'driver-9'; }, RangeError, 'Campaign.runDecks[1].driver "driver-9" isn\'t a driver in the pool'],
				['one run deck', (save: CampaignJson) => { save.runDecks.pop(); }, RangeError, 'Campaign.runDecks holds 1 run decks: a run out has one for each of its two seats, and none are kept at home'],
				['two run decks for one driver', (save: CampaignJson) => { save.runDecks[1].driver = 'driver-1'; }, RangeError, 'Campaign.runDecks[1].driver driver-1 has the run deck before it; each seat is a different driver'],
				['a run out with no run handed out', (save: CampaignJson) => { save.nextRunNumber = 1; }, RangeError, 'Campaign.nextRunNumber must be an integer >= 2, got 1'],
				['no run counter', (save: CampaignJson) => { delete (save as Partial<CampaignJson>).nextRunNumber; }, TypeError, 'Campaign.nextRunNumber is missing'],
				['a borrowed count of 0', (save: CampaignJson) => { save.runDecks[0].borrowed.medical_kit = 0; }, RangeError, 'Campaign.runDecks[0].borrowed.medical_kit must be an integer >= 1, got 0'],
				['a seated driver whose default deck holds cards', (save: CampaignJson) => { save.drivers[4].defaultDeck = { headshot: 1 }; }, RangeError,
					'Campaign.runDecks[1].driver driver-5 holds cards in their default deck, {"headshot":1}, which is in their run deck while a run is out'],
				['a card both left at home and borrowed', (save: CampaignJson) => { save.runDecks[0].leftHome.medical_kit = 1; }, RangeError,
					"Campaign.runDecks[0].borrowed.medical_kit can't be borrowed while 1 of the driver's own are left at home, which come back first"],
				['an escort card named by a session\'s model id', (save: CampaignJson) => { save.runDecks[0].escortCards[0].broughtBy = 'Vehicle_12'; }, RangeError, 'Campaign.runDecks[0].escortCards[0].broughtBy must look like escort-1, got "Vehicle_12"'],
				['an escort card from an escort the convoy lost', (save: CampaignJson) => { save.runDecks[0].escortCards[0].broughtBy = 'escort-2'; }, RangeError, 'Campaign.runDecks[0].escortCards[0].broughtBy escort-2 isn\'t an escort in the convoy'],
				['an escort card that isn\'t its escort\'s', (save: CampaignJson) => { save.runDecks[0].escortCards[0].cardType = 'triage'; }, RangeError, 'Campaign.runDecks[0].escortCards[0].cardType must be "top_off", the card Fuel Hauler (escort-1) brings, got "triage"'],
				['one escort\'s card in both run decks', (save: CampaignJson) => { save.runDecks[1].escortCards[0] = { ...save.runDecks[0].escortCards[0] }; }, RangeError, 'Campaign.runDecks[1].escortCards[0].broughtBy escort-1 brought a card into the run deck before it; an escort brings one']
			])('fails loudly on %s', (_label, damage, errorType, message) => {
				const save = savedCampaign();
				damage(save);

				expect(() => Campaign.fromJSON(save)).toThrow(errorType);
				expect(() => Campaign.fromJSON(save)).toThrow(message);
			});

			it('fails loudly on a save that isn\'t an object', () => {
				expect(() => Campaign.fromJSON(null)).toThrow('Campaign must be an object, got null');
				expect(() => Campaign.fromJSON(JSON.stringify(CAMPAIGN_FIXTURE))).toThrow(/^Campaign must be an object, got "\{/);
			});
		});

		describe('a save whose map params drifted from the table', () => {
			/** The fixture with its params changed, loaded, and the warnings it gave. */
			function loadDrifted(drift: (params: Record<string, unknown>) => void): { campaign: Campaign; warnings: string[] } {
				const save = savedCampaign();
				drift(save.mapParams as unknown as Record<string, unknown>);
				const warnings: string[] = [];
				const campaign = Campaign.fromJSON(save, { onWarning: warning => warnings.push(warning) });
				return { campaign, warnings };
			}

			it('loads a save with nothing to repair without a word', () => {
				const onWarning = jest.fn();

				Campaign.fromJSON(CAMPAIGN_FIXTURE, { onWarning });

				expect(onWarning).not.toHaveBeenCalled();
			});

			it('gives a parameter the save is missing its environment\'s default', () => {
				const { campaign, warnings } = loadDrifted(params => { delete params.radius; });

				expect(campaign.mapParams.radius).toBe(1000);
				expect(warnings).toEqual(['Campaign.mapParams.radius was missing; took 1000, the mixed default']);
			});

			it('takes the default from the environment the save names', () => {
				const { campaign, warnings } = loadDrifted(params => {
					params.environment = 'highDesert';
					delete params.aridity;
				});

				expect(campaign.mapParams.aridity).toBe(0.15);
				expect(warnings).toEqual(['Campaign.mapParams.aridity was missing; took 0.15, the highDesert default']);
			});

			it('drops a parameter the table no longer has', () => {
				const { campaign, warnings } = loadDrifted(params => { params.weather = 0.5; });

				expect('weather' in campaign.mapParams).toBe(false);
				expect(warnings).toEqual(['Campaign.mapParams.weather isn\'t a map parameter; dropped it']);
			});

			it('repairs a Rust Belt map\'s params from the table before the realistic map: new ones from Rust Belt, old ones dropped', () => {
				const { campaign, warnings } = loadDrifted(params => {
					for (const key of Object.keys(params)) delete params[key];
					Object.assign(params, {
						seed: SEED, environment: 'rustBelt',
						radius: 1000, aridity: 0.55, mountainCoverage: 0.15, ruggedness: 0.35, rivers: 3, riverMeander: 0.5, lakes: 2,
						contamination: 0.45, hotspots: 4, metroSize: 0.18, towns: 8,
						highways: 6, highwaySeparation: 35, curviness: 0.5, branchiness: 0.6, trailShare: 0.35, roadClearance: 24,
						strongholds: 4, poiDensity: 1, routesTarget: 3, startingReveal: 1, stopDensity: 1, dangerCurve: 1, driverFinds: 2,
						daylightHours: 14, travelPace: 1,
						sceneryDensity: 0.6, streetGrids: 0.85, countyRoads: 0.65, brokenHighways: 3, railLines: 2, farmTracks: 0.4
					});
				});

				expect(campaign.mapParams).toEqual(resolveMapParams({ seed: SEED, environment: 'rustBelt' }).params);
				expect(warnings).toEqual([
					'Campaign.mapParams.riverDensity was missing; took 0.5, the rustBelt default',
					'Campaign.mapParams.villages was missing; took 26, the rustBelt default',
					'Campaign.mapParams.roadDensity was missing; took 0.6, the rustBelt default',
					'Campaign.mapParams.loops was missing; took 0.6, the rustBelt default',
					'Campaign.mapParams.routeSplit was missing; took 0.5, the rustBelt default',
					'Campaign.mapParams.dressing was missing; took 0.6, the rustBelt default',
					'Campaign.mapParams.branchiness isn\'t a map parameter; dropped it',
					'Campaign.mapParams.roadClearance isn\'t a map parameter; dropped it',
					'Campaign.mapParams.sceneryDensity isn\'t a map parameter; dropped it',
					'Campaign.mapParams.countyRoads isn\'t a map parameter; dropped it',
					'Campaign.mapParams.farmTracks isn\'t a map parameter; dropped it'
				]);
				expect(Object.keys(reload(campaign).toJSON().mapParams)).toEqual(Object.keys(CAMPAIGN_FIXTURE.mapParams));
			});

			it('keeps a value today\'s ranges would clamp, since its map was made with it, and says so', () => {
				const { campaign, warnings } = loadDrifted(params => { params.radius = 5000; });

				expect(campaign.mapParams.radius).toBe(5000);
				expect(warnings).toEqual(['Campaign.mapParams.radius lowered to 1600 (tuning range 600 to 1600) for a new map; this one keeps the 5000 it was made with']);
			});

			it('gives a value today\'s validator would clamp twice one warning, naming the saved value and both clamps', () => {
				const { campaign, warnings } = loadDrifted(params => { params.highways = 2; });

				expect(campaign.mapParams.highways).toBe(2);
				expect(warnings).toEqual([
					'Campaign.mapParams.highways raised to 3 (tuning range 3 to 9), then highways raised to 6 (strongholds + 2) for a new map; this one keeps the 2 it was made with'
				]);
			});

			it('folds a clamp into the warning for a default it filled in, which no map was made with', () => {
				const { campaign, warnings } = loadDrifted(params => {
					params.strongholds = 6;
					delete params.highways;
				});

				expect(campaign.mapParams.highways).toBe(6);
				expect(warnings).toEqual(['Campaign.mapParams.highways was missing; took 6, the mixed default, which a new map wouldn\'t keep: highways raised to 8 (strongholds + 2)']);
			});

			it('takes Mixed for an environment that\'s missing or no longer exists', () => {
				const unknown = loadDrifted(params => { params.environment = 'moon'; });
				const missing = loadDrifted(params => { delete params.environment; });

				expect([unknown.campaign.mapParams.environment, missing.campaign.mapParams.environment]).toEqual(['mixed', 'mixed']);
				expect(unknown.warnings).toEqual(['Campaign.mapParams.environment "moon" isn\'t an environment; took mixed']);
				expect(missing.warnings).toEqual(['Campaign.mapParams.environment was missing; took mixed']);
			});

			it('keeps everything else as saved, and saves the repaired params from then on', () => {
				const { campaign } = loadDrifted(params => {
					delete params.radius;
					params.weather = 0.5;
					params.highways = 12;
				});

				expect(campaign.toJSON().mapParams).toEqual({ ...CAMPAIGN_FIXTURE.mapParams, radius: 1000, highways: 12 });
				expect(reload(campaign).toJSON()).toEqual(campaign.toJSON());
			});

			it('reports nothing from a save that then fails to load', () => {
				const onWarning = jest.fn();
				const save = savedCampaign();
				delete (save.mapParams as Partial<MapParams>).radius;
				(save.drivers[0] as { status: string }).status = 'sleeping';

				expect(() => Campaign.fromJSON(save, { onWarning })).toThrow('Campaign.drivers[0].status must be one of ready, injured, dead, missing, got "sleeping"');
				expect(onWarning).not.toHaveBeenCalled();
			});

			it('logs the repairs when nobody asks to hear them', () => {
				const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
				const save = savedCampaign();
				delete (save.mapParams as Partial<MapParams>).radius;

				try {
					Campaign.fromJSON(save);

					expect(warn).toHaveBeenCalledWith('Campaign.mapParams.radius was missing; took 1000, the mixed default');
				} finally {
					warn.mockRestore();
				}
			});
		});
	});

	it('is what JSON.stringify writes', () => {
		const campaign = campaignInProgress();

		expect(JSON.parse(JSON.stringify(campaign))).toEqual(campaign.toJSON());
		expect(Object.keys(campaign.toJSON())).toEqual(Object.keys(CAMPAIGN_FIXTURE));
	});

	it.each([
		['a campaign in progress', campaignInProgress],
		['the fixture', () => Campaign.fromJSON(CAMPAIGN_FIXTURE)],
		['a stress campaign', stressCampaign]
	])('writes the same save text for %s without toJSON\'s copies', (_label, build) => {
		const campaign = build();

		expect(campaign.toSaveText()).toBe(JSON.stringify(campaign));
	});

	it.each([
		['structure past its max', 41, 'Campaign.convoy.escorts[0].structure must be an integer from 1 to maxStructure (40), got 41'],
		['no structure left', 0, 'Campaign.convoy.escorts[0].structure must be an integer from 1 to maxStructure (40), got 0']
	])('won\'t write a save with an escort at %s, which it couldn\'t load back', (_label, structure, message) => {
		const campaign = campaignInProgress();
		campaign.convoy.escorts[0].set({ structure });

		expect(() => campaign.toJSON()).toThrow(message);
		expect(() => JSON.stringify(campaign)).toThrow(message);
		expect(() => campaign.toSaveText()).toThrow(message);
	});

	it('takes a convoy of its own', () => {
		const convoy = new Convoy({ escorts: [createEscort({ type: 'outrider' })] });

		expect(newCampaign({ convoy }).convoy).toBe(convoy);
	});
});
