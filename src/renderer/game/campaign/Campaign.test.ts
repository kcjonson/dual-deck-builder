import { Convoy } from '../mechanics/Convoy';
import { createEscort } from '../mechanics/Escort';
import { Campaign, CampaignJson, CampaignOptions, NO_RESOURCES } from './Campaign';
import { cardCount, totalCards } from './CardCounts';
import { DriverRecord } from './DriverRecord';
import { MapParams } from './MapStubs';
import { CAMPAIGN_SCHEMA_VERSION, SaveMigration, migrateSave } from './SaveMigrations';
import campaignV1 from './__fixtures__/campaign-v1.json';

const SEED = 20261006;

/**
 * Params for a map made from `seed`: the stand-in's minimum until MapParams
 * (DDB-287) is on main, when this resolves real ones for the seed.
 */
const mapParamsFor = (seed: number): MapParams => ({ seed, environment: 'mixed' });

const newCampaign = (options: Partial<CampaignOptions> = {}): Campaign => new Campaign({
	seed: SEED,
	generatorVersion: 1,
	mapParams: mapParamsFor(options.seed ?? SEED),
	...options
});

/** A save and a load: through JSON text and back. */
const reload = (campaign: Campaign): Campaign => Campaign.fromJSON(JSON.parse(JSON.stringify(campaign)));

/** The version 1 fixture as a fresh object to damage. */
const savedCampaign = (): CampaignJson => JSON.parse(JSON.stringify(campaignV1));

const record = (id: string): DriverRecord => new DriverRecord({ id, archetype: 'mechanic', name: 'Mechanic 1' });

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

		it('rejects map params with no seed', () => {
			expect(() => newCampaign({ mapParams: { environment: 'mixed' } as unknown as MapParams }))
				.toThrow('Campaign.mapParams.seed must be a number, got undefined');
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
			campaign.recruitDriver({ archetype: 'mechanic' }).set({ status: 'dead', hitpoints: 0 });

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

		it('starts the counter past the highest id when built without one', () => {
			expect(newCampaign({ drivers: [record('driver-4'), record('driver-2')] }).nextDriverNumber).toBe(5);
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

			campaign.moveCards({ cardType: 'ramming_speed', from: warrior, to: mechanic, count: 5 });

			expect(cardCount(warrior.defaultDeck, 'ramming_speed')).toBe(0);
			expect(cardCount(mechanic.defaultDeck, 'ramming_speed')).toBe(5);
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
			['a convoy that isn\'t a Convoy', { convoy: { escorts: [] } }, 'Campaign.convoy must be a Convoy, got {"escorts":[]}'],
			['map state JSON can\'t hold', { map: { found: new Date(0) } }, 'Campaign.map.found must be JSON'],
			['map state with no number', { map: { fog: [1, NaN] } }, 'Campaign.map.fog[1] must be a finite number, got NaN'],
			['map state with a hole in it', { map: { fog: undefined } }, 'Campaign.map.fog must be JSON'],
			['a field a campaign doesn\'t have', { weather: 'dust' }, 'Campaign has an unknown field "weather"']
		])('rejects %s', (_label, changes, message) => {
			expect(() => newCampaign().set(changes as unknown as Partial<CampaignOptions>)).toThrow(message);
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

		it('won\'t turn the clock back before a logged day', () => {
			const campaign = newCampaign({ day: 6 });
			campaign.addLogEntry({ message: 'Took the north stronghold.' });

			expect(() => campaign.set({ day: 5 })).toThrow('Campaign.log[0].day must be an integer from 1 to today (5), got 6');
		});

		it('treats the map and params it already holds as unchanged', () => {
			const campaign = campaignInProgress();
			const { map, mapParams } = campaign;
			const changes = jest.fn();
			campaign.on('change', changes);

			campaign.set({ map, mapParams });

			expect(campaign.map).toBe(map);
			expect(campaign.mapParams).toBe(mapParams);
			expect(changes).not.toHaveBeenCalled();
		});

		it('keeps the seed, generator version, and map params from founding', () => {
			const campaign = newCampaign();

			expect(() => campaign.set({ seed: 7 })).toThrow('Campaign.seed is fixed at founding');
			expect(() => campaign.set({ generatorVersion: 2 })).toThrow('Campaign.generatorVersion is fixed at founding');
			expect(() => campaign.set({ mapParams: mapParamsFor(SEED) })).toThrow('Campaign.mapParams is fixed at founding');
			campaign.set({ seed: SEED, generatorVersion: 1, mapParams: campaign.mapParams });
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
			json.convoy[0].mods[0].name = 'Spikes';
			(json.map.roads as { id: string }[])[0].id = 'r9';

			expect(JSON.stringify(campaign)).toBe(before);
		});

		it('writes the same text for the same campaign, whatever order it was built in', () => {
			const first = newCampaign({ locker: { repair_kit: 1, headshot: 2 }, resources: { ...NO_RESOURCES, people: 4, food: 2 } });
			const second = newCampaign({ locker: { headshot: 2, repair_kit: 1 }, resources: { food: 2, people: 4, water: 0, fuel: 0, meds: 0, scrap: 0 } });

			expect(JSON.stringify(second)).toBe(JSON.stringify(first));
		});

		it('reads the version 1 fixture and writes it back the same', () => {
			const campaign = Campaign.fromJSON(campaignV1);

			expect(campaign.toJSON()).toEqual(campaignV1);
			expect(campaign.drivers.map(driver => driver.status)).toEqual(['ready', 'dead', 'injured', 'missing', 'ready']);
			expect(campaign.convoy.escorts.map(escort => escort.escort?.type ?? null)).toEqual(['fuel_hauler', null]);
			expect(campaign.recruitDriver({ archetype: 'mechanic' }).id).toBe('driver-6');
		});

		it('keeps the fixture at the current schema version; on a bump, keep it loading through the migration', () => {
			expect(campaignV1.schemaVersion).toBe(CAMPAIGN_SCHEMA_VERSION);
		});

		describe('a damaged save', () => {
			it.each([
				['no schema version', (save: CampaignJson) => { delete (save as Partial<CampaignJson>).schemaVersion; }, TypeError, 'Campaign.schemaVersion must be a number, got undefined'],
				['schema version 0', (save: CampaignJson) => { save.schemaVersion = 0; }, RangeError, 'Campaign.schemaVersion must be an integer >= 1, got 0'],
				['a fractional schema version', (save: CampaignJson) => { save.schemaVersion = 1.5; }, RangeError, 'Campaign.schemaVersion must be an integer >= 1, got 1.5'],
				['a schema version in a string', (save: CampaignJson) => { (save as unknown as Record<string, unknown>).schemaVersion = '1'; }, TypeError, 'Campaign.schemaVersion must be a number, got "1"'],
				['a newer schema version', (save: CampaignJson) => { save.schemaVersion = 2; }, RangeError, 'Campaign.schemaVersion is 2, newer than this build reads (1)'],
				['a missing field', (save: CampaignJson) => { delete (save as Partial<CampaignJson>).day; }, TypeError, 'Campaign.day is missing'],
				['an unknown field', (save: CampaignJson) => { (save as unknown as Record<string, unknown>).weather = 'dust'; }, TypeError, 'Campaign has an unknown field "weather"'],
				['a seed past uint32', (save: CampaignJson) => { save.seed = 2 ** 32; save.mapParams = mapParamsFor(2 ** 32); }, RangeError, 'Campaign.seed must be an integer from 0 to 4294967295, got 4294967296'],
				['map params from another seed', (save: CampaignJson) => { save.mapParams = mapParamsFor(7); }, RangeError, "Campaign.mapParams.seed must be the campaign's seed, 20261006, got 7"],
				['a driver with an unknown status', (save: CampaignJson) => { (save.drivers[1] as { status: string }).status = 'sleeping'; }, RangeError, 'Campaign.drivers[1].status must be one of ready, injured, dead, missing, got "sleeping"'],
				['a driver over max HP', (save: CampaignJson) => { save.drivers[0].hitpoints = 41; }, RangeError, 'Campaign.drivers[0].hitpoints must be an integer from 0 to maxHitpoints (40), got 41'],
				['a dead driver with HP', (save: CampaignJson) => { save.drivers[1].hitpoints = 5; }, RangeError, 'Campaign.drivers[1].hitpoints must be 0 for a dead driver, got 5'],
				['two drivers with one id', (save: CampaignJson) => { save.drivers[1].id = 'driver-1'; }, RangeError, 'Campaign.drivers[1].id driver-1 belongs to an earlier driver'],
				['a counter that would hand out an id again', (save: CampaignJson) => { save.nextDriverNumber = 5; }, RangeError, 'Campaign.drivers[4].id must come before driver-5, the next id to hand out, got driver-5'],
				['a locker count of 0', (save: CampaignJson) => { save.locker.headshot = 0; }, RangeError, 'Campaign.locker.headshot must be an integer >= 1, got 0'],
				['an escort with an unknown role', (save: CampaignJson) => { (save.convoy[0].escort as { role: string }).role = 'scout'; }, RangeError, 'Campaign.convoy[0].escort.role must be one of gun, hauler, got "scout"'],
				['a log entry from the future', (save: CampaignJson) => { save.log[3].day = 99; }, RangeError, 'Campaign.log[3].day must be an integer from 1 to today (9), got 99'],
				['negative water', (save: CampaignJson) => { save.resources.water = -3; }, RangeError, 'Campaign.resources.water must be an integer >= 0, got -3']
			])('fails loudly on %s', (_label, damage, errorType, message) => {
				const save = savedCampaign();
				damage(save);

				expect(() => Campaign.fromJSON(save)).toThrow(errorType);
				expect(() => Campaign.fromJSON(save)).toThrow(message);
			});

			it('fails loudly on a save that isn\'t an object', () => {
				expect(() => Campaign.fromJSON(null)).toThrow('Campaign must be an object, got null');
				expect(() => Campaign.fromJSON(JSON.stringify(campaignV1))).toThrow(/^Campaign must be an object, got "\{/);
			});
		});
	});

	describe('migrateSave', () => {
		/** Steps that note each upgrade they make, in order. */
		const steps: Record<number, SaveMigration> = {
			1: save => ({ ...save, upgrades: [...(save.upgrades as string[]), '1 to 2'] }),
			2: save => ({ ...save, upgrades: [...(save.upgrades as string[]), '2 to 3'] })
		};

		it('upgrades a save one version at a time, stamping each step\'s version', () => {
			expect(migrateSave({ save: { schemaVersion: 1, upgrades: [] }, to: 3, migrations: steps }))
				.toEqual({ schemaVersion: 3, upgrades: ['1 to 2', '2 to 3'] });
		});

		it('starts from the version the save is at', () => {
			expect(migrateSave({ save: { schemaVersion: 2, upgrades: [] }, to: 3, migrations: steps }))
				.toEqual({ schemaVersion: 3, upgrades: ['2 to 3'] });
		});

		it('leaves a save at the current version as it is', () => {
			const save = { schemaVersion: CAMPAIGN_SCHEMA_VERSION, day: 4 };

			expect(migrateSave({ save })).toBe(save);
		});

		it('refuses a save with a step missing on the way up', () => {
			expect(() => migrateSave({ save: { schemaVersion: 1 }, to: 3, migrations: { 2: steps[2] } }))
				.toThrow("Campaign.schemaVersion 1 can't be read: nothing upgrades a version 1 save");
		});
	});

	it('is what JSON.stringify writes', () => {
		const campaign = campaignInProgress();

		expect(JSON.parse(JSON.stringify(campaign))).toEqual(campaign.toJSON());
		expect(Object.keys(campaign.toJSON())).toEqual(Object.keys(campaignV1));
	});

	it('takes a convoy of its own', () => {
		const convoy = new Convoy({ escorts: [createEscort({ type: 'outrider' })] });

		expect(newCampaign({ convoy }).convoy).toBe(convoy);
	});
});
