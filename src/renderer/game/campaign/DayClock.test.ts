import { Rng } from '../core/Rng';
import { resolveMapParams } from '../map/MapParams';
import { DriverArchetype } from '../mechanics/Driver';
import { Campaign, Resources } from './Campaign';
import { CAMPAIGN_START } from './CampaignStart';
import { COMPOUND_RULES, CompoundRules, UPKEEP_RESOURCES } from './CompoundRules';
import { DAY_END_HOOKS, DayEnd, DayEndHooks, DayHaul, DuskState, MapDayStep, NeedsForecast, endDay, forecastNeeds } from './DayClock';
import { DriverRecord, DriverStatus } from './DriverRecord';
import { foundCampaign } from './Founding';
import { MapState } from './MapState';

const SEED = 20261008;

const ARCHETYPES: readonly DriverArchetype[] = ['road_warrior', 'interceptor', 'mechanic'];

/** The shipped stores: 21 food and water and 12 people, a week of upkeep. */
const STORES: Readonly<Resources> = CAMPAIGN_START.resources;

const newCampaign = (resources: Partial<Resources> = {}): Campaign => new Campaign({
	seed: SEED,
	generatorVersion: 1,
	mapParams: resolveMapParams({ seed: SEED, environment: 'mixed' }).params,
	resources: { ...STORES, ...resources }
});

/** A save and a load: through JSON text and back. */
const reload = (campaign: Campaign): Campaign => Campaign.fromJSON(JSON.parse(JSON.stringify(campaign)));

const savedText = (campaign: Campaign): string => JSON.stringify(campaign);

const rulesWith = (shortfall: Partial<CompoundRules['shortfall']>): CompoundRules => ({
	...COMPOUND_RULES,
	shortfall: { ...COMPOUND_RULES.shortfall, ...shortfall }
});

const injure = (driver: DriverRecord, injuredDays: number): void => {
	driver.set({ status: 'injured', injuredDays, hitpoints: Math.max(1, driver.maxHitpoints - 9) });
};

describe('endDay', () => {
	describe('upkeep', () => {
		it('eats a unit of food and water for every 4 people, from the stores, and nothing else', () => {
			const campaign = newCampaign();

			const result = endDay({ campaign });

			expect(result.upkeep).toEqual({ food: 3, water: 3 });
			expect(result.shortfall).toEqual({ food: 0, water: 0 });
			expect(campaign.resources).toEqual({ ...STORES, food: 18, water: 18 });
			expect(campaign.unrest).toBe(0);
		});

		it.each([
			[0, 0],
			[1, 1],
			[4, 1],
			[5, 2],
			[12, 3],
			[13, 4],
			[40, 10]
		])('rounds up: %i people eat %i of each', (people, each) => {
			expect(endDay({ campaign: newCampaign({ people, food: 50, water: 50 }) }).upkeep).toEqual({ food: each, water: each });
		});

		it('tunes food and water apart', () => {
			const rules: CompoundRules = { ...COMPOUND_RULES, upkeep: { peoplePerUnit: { food: 3, water: 5 } } };

			expect(endDay({ campaign: newCampaign({ people: 12 }), rules }).upkeep).toEqual({ food: 4, water: 3 });
		});

		it('eats the stores down to nothing without a shortfall when they hold exactly a day', () => {
			const campaign = newCampaign({ food: 3, water: 3 });

			const result = endDay({ campaign });

			expect(result.shortfall).toEqual({ food: 0, water: 0 });
			expect(result.peopleLost).toBe(0);
			expect(campaign.resources).toMatchObject({ food: 0, water: 0, people: 12 });
		});

		it('writes nothing in the log on a day the compound eats its fill', () => {
			const campaign = newCampaign();

			endDay({ campaign });

			expect(campaign.log).toEqual([]);
		});
	});

	describe('shortfalls', () => {
		it('eats what there is, and each unit short costs a person and a point of unrest', () => {
			const campaign = newCampaign({ food: 2, water: 1 });
			campaign.set({ unrest: 4 });

			const result = endDay({ campaign });

			expect(result.shortfall).toEqual({ food: 1, water: 2 });
			expect(result.peopleLost).toBe(3);
			expect(result.unrestGained).toBe(3);
			expect(campaign.resources).toEqual({ ...STORES, food: 0, water: 0, people: 9 });
			expect(campaign.unrest).toBe(7);
		});

		it('logs the shortfall on the day it happened', () => {
			const campaign = newCampaign({ food: 2, water: 1 });
			campaign.set({ day: 5 });

			endDay({ campaign });

			expect(campaign.log).toEqual([{ day: 5, message: 'Ran short of 1 food and 2 water; 3 people lost.' }]);
		});

		it('names only what ran short', () => {
			const campaign = newCampaign({ people: 4, water: 0 });

			endDay({ campaign });

			expect(campaign.log.map(entry => entry.message)).toEqual(['Ran short of 1 water; 1 person lost.']);
		});

		it('costs what the rules say', () => {
			const campaign = newCampaign({ food: 0 });

			const result = endDay({ campaign, rules: rulesWith({ peopleLostPerUnit: 2, unrestPerUnit: 3 }) });

			expect(result).toMatchObject({ peopleLost: 6, unrestGained: 9 });
			expect(campaign.resources.people).toBe(6);
			expect(campaign.unrest).toBe(9);
		});

		it('never loses more people than the compound has, though unrest still counts every unit short', () => {
			const campaign = newCampaign({ people: 3, food: 0, water: 0 });

			const result = endDay({ campaign, rules: rulesWith({ peopleLostPerUnit: 5 }) });

			expect(result).toMatchObject({ shortfall: { food: 1, water: 1 }, peopleLost: 3, unrestGained: 2 });
			expect(campaign.resources.people).toBe(0);
		});

		it('logs a shortfall that costs nobody', () => {
			const campaign = newCampaign({ food: 0 });

			const result = endDay({ campaign, rules: rulesWith({ peopleLostPerUnit: 0 }) });

			expect(result.peopleLost).toBe(0);
			expect(campaign.log.map(entry => entry.message)).toEqual(['Ran short of 3 food.']);
		});

		it('raises unrest day after day while the stores stay empty, as People shrinks', () => {
			const campaign = newCampaign({ people: 12, food: 0, water: 0 });

			const results = [1, 2, 3].map(() => endDay({ campaign }));

			expect(results.map(result => result.peopleLost)).toEqual([6, 4, 2]);
			expect(results.map(result => result.unrestGained)).toEqual([6, 4, 2]);
			expect(campaign.resources.people).toBe(0);
			expect(campaign.unrest).toBe(12);
		});
	});

	describe('People reaching 0', () => {
		it('says the compound is abandoned on the day the last of its people go', () => {
			const campaign = newCampaign({ people: 3, food: 0, water: 0 });

			const first = endDay({ campaign });
			const second = endDay({ campaign });

			expect(first).toMatchObject({ peopleLost: 2, outcome: 'continues' });
			expect(campaign.resources.people).toBe(0);
			expect(second).toMatchObject({ peopleLost: 1, outcome: 'abandoned' });
		});

		it('leaves ending the campaign to the caller: an empty compound eats nothing, and the day still turns', () => {
			const campaign = newCampaign({ people: 0, food: 5, water: 0 });

			const result = endDay({ campaign });

			expect(result).toMatchObject({ upkeep: { food: 0, water: 0 }, shortfall: { food: 0, water: 0 }, peopleLost: 0, outcome: 'abandoned' });
			expect(campaign.resources.food).toBe(5);
			expect(campaign.day).toBe(2);
		});

		it('says the compound continues while anyone is left', () => {
			expect(endDay({ campaign: newCampaign({ people: 1, food: 0, water: 0 }), rules: rulesWith({ peopleLostPerUnit: 0 }) }).outcome).toBe('continues');
		});
	});

	describe('healing', () => {
		it('brings an injured driver a day closer to fit each day, and back to ready at full HP when they get there', () => {
			const campaign = newCampaign();
			const driver = campaign.recruitDriver({ archetype: 'mechanic' });
			injure(driver, 3);
			const hurt = driver.hitpoints;

			const days = [1, 2, 3].map(() => {
				const result = endDay({ campaign });
				return { healed: result.healed, status: driver.status, injuredDays: driver.injuredDays, hitpoints: driver.hitpoints };
			});

			expect(days).toEqual([
				{ healed: [], status: 'injured', injuredDays: 2, hitpoints: hurt },
				{ healed: [], status: 'injured', injuredDays: 1, hitpoints: hurt },
				{ healed: [driver], status: 'ready', injuredDays: 0, hitpoints: driver.maxHitpoints }
			]);
		});

		it('heals every injured driver at once, and touches nobody else', () => {
			const campaign = newCampaign();
			const [warrior, interceptor, mechanic, raider] = (['road_warrior', 'interceptor', 'mechanic', 'raider'] as const)
				.map(archetype => campaign.recruitDriver({ archetype }));
			injure(warrior, 1);
			injure(interceptor, 4);
			mechanic.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });
			raider.set({ status: 'missing' });
			const others = [mechanic, raider].map(driver => JSON.stringify(driver));
			const changed: string[] = [];
			campaign.drivers.forEach(driver => driver.on('change', () => changed.push(driver.id)));

			const result = endDay({ campaign });

			expect(result.healed).toEqual([warrior]);
			expect(warrior.status).toBe('ready');
			expect(interceptor.injuredDays).toBe(3);
			expect([mechanic, raider].map(driver => JSON.stringify(driver))).toEqual(others);
			expect(changed).toEqual([warrior.id, interceptor.id]);
		});

		it('leaves a ready driver\'s HP alone: only the infirmary heals, and only the injured are in it', () => {
			const campaign = newCampaign();
			const driver = campaign.recruitDriver({ archetype: 'interceptor' });
			driver.set({ hitpoints: driver.maxHitpoints - 2 });

			endDay({ campaign });

			expect(driver.hitpoints).toBe(driver.maxHitpoints - 2);
		});
	});

	describe('the day', () => {
		it('turns once a call, from whatever ended it: a run home, or a day of rest', () => {
			const campaign = newCampaign();

			const days = [1, 2, 3].map(() => endDay({ campaign }).day);

			expect(days).toEqual([1, 2, 3]);
			expect(campaign.day).toBe(4);
		});

		it('stores the campaign in one change, after the healed drivers, so a listener sees the whole day end', () => {
			const campaign = newCampaign({ food: 0 });
			const driver = campaign.recruitDriver({ archetype: 'road_warrior' });
			injure(driver, 1);
			const seen: { day: number; status: DriverStatus; food: number }[] = [];
			campaign.on('change', () => seen.push({ day: campaign.day, status: driver.status, food: campaign.resources.food }));

			endDay({ campaign });

			expect(seen).toEqual([{ day: 2, status: 'ready', food: 0 }]);
		});

		it('hands back a frozen account of the night', () => {
			const result = endDay({ campaign: newCampaign() });

			expect(Object.isFrozen(result)).toBe(true);
			expect(Object.isFrozen(result.upkeep)).toBe(true);
			expect(Object.isFrozen(result.shortfall)).toBe(true);
			expect(Object.isFrozen(result.healed)).toBe(true);
		});

		it('checks the rules it\'s given before changing anything', () => {
			const campaign = newCampaign();
			const before = savedText(campaign);
			const rules: CompoundRules = { ...COMPOUND_RULES, upkeep: { peoplePerUnit: { food: 0, water: 4 } } };

			expect(() => endDay({ campaign, rules })).toThrow('CompoundRules.upkeep.peoplePerUnit.food must be an integer from 1 to 100, got 0');
			expect(savedText(campaign)).toBe(before);
		});

		it.each([
			['unrest a shortfall would push past what a save holds', (campaign: Campaign) => campaign.set({ unrest: Number.MAX_SAFE_INTEGER }), {},
				/^Campaign\.unrest must be an integer >= 0, got 900719925474099\d$/],
			['a day past what a save holds', (campaign: Campaign) => campaign.set({ day: Number.MAX_SAFE_INTEGER }), {},
				'Campaign.day must be an integer >= 1, got 9007199254740992'],
			['rules whose unrest per unit would overflow it', () => undefined, { unrestPerUnit: 2 ** 52 },
				'CompoundRules.shortfall.unrestPerUnit must be an integer from 0 to 100, got 4503599627370496']
		])('refuses %s before anyone heals or the day turns', (_label, setUp, shortfall, message) => {
			const campaign = newCampaign({ food: 0 });
			const driver = campaign.recruitDriver({ archetype: 'road_warrior' });
			injure(driver, 1);
			setUp(campaign);
			const before = savedText(campaign);

			expect(() => endDay({ campaign, rules: rulesWith(shortfall) })).toThrow(message);
			expect(savedText(campaign)).toBe(before);
			expect(driver.status).toBe('injured');
		});

		it('refuses partway through a card move, before anyone heals, so a record\'s listener can\'t end half a night', () => {
			const campaign = newCampaign();
			const mover = campaign.recruitDriver({ archetype: 'road_warrior' });
			const patient = campaign.recruitDriver({ archetype: 'mechanic' });
			injure(patient, 1);
			const [cardType] = Object.keys(mover.defaultDeck);
			const held = mover.defaultDeck[cardType];
			campaign.set({ locker: { [cardType]: 1 } });
			const refusals: string[] = [];
			mover.on('change', () => {
				try {
					endDay({ campaign });
				} catch (error) {
					refusals.push((error as Error).message);
				}
			});

			campaign.moveCards({ cardType, from: 'locker', to: mover });

			expect(refusals).toEqual(["The day can't end while a card move is being stored"]);
			expect(campaign.day).toBe(1);
			expect(patient).toMatchObject({ status: 'injured', injuredDays: 1 });
			expect(mover.defaultDeck[cardType]).toBe(held + 1);
		});

		it('keeps a line a driver\'s listener logs as they heal, ahead of the shortfall', () => {
			const campaign = newCampaign({ food: 0 });
			const driver = campaign.recruitDriver({ archetype: 'road_warrior' });
			injure(driver, 1);
			driver.on('change', () => {
				if (driver.status === 'ready') campaign.addLogEntry({ message: `${driver.name} is fit again.` });
			});

			endDay({ campaign });

			expect(campaign.log).toEqual([
				{ day: 1, message: 'Road Warrior 1 is fit again.' },
				{ day: 1, message: 'Ran short of 3 food; 3 people lost.' }
			]);
		});
	});

	describe('a haul at dusk', () => {
		const haul = (resources: Partial<Resources>, message = 'A haul came in.'): DayHaul => ({ resources, message });

		it('comes into the stores before the compound eats, so food it brings feeds that night', () => {
			const campaign = newCampaign({ food: 0, water: 1, fuel: 0 });

			const result = endDay({ campaign, haul: haul({ food: 3, water: 2, fuel: 2, scrap: 15 }) });

			expect(result.shortfall).toEqual({ food: 0, water: 0 });
			expect(campaign.resources).toEqual({ ...STORES, food: 0, water: 0, fuel: 2, scrap: STORES.scrap + 15 });
		});

		it('logs its line dated the day that ended, ahead of the shortfall that followed it', () => {
			const campaign = newCampaign({ food: 0 });
			campaign.set({ day: 4 });

			endDay({ campaign, haul: haul({ fuel: 1 }, 'A scavenging party brought back 1 fuel.') });

			expect(campaign.log).toEqual([
				{ day: 4, message: 'A scavenging party brought back 1 fuel.' },
				{ day: 4, message: 'Ran short of 3 food; 3 people lost.' }
			]);
		});

		it('is in the state at dusk the map\'s steps see', () => {
			const campaign = newCampaign({ fuel: 0 });
			const seen: number[] = [];
			const hooks: DayEndHooks = { ...DAY_END_HOOKS, poiRefills: ({ campaign: atDusk, map }) => { seen.push(atDusk.resources.fuel); return map; } };

			endDay({ campaign, hooks, haul: haul({ fuel: 2 }) });

			expect(seen).toEqual([2]);
		});

		it('is stored in the day end\'s one set: the campaign\'s single change already holds the haul and the new day', () => {
			const campaign = newCampaign({ fuel: 0 });
			const seen: { day: number; fuel: number; log: number }[] = [];
			campaign.on('change', () => seen.push({ day: campaign.day, fuel: campaign.resources.fuel, log: campaign.log.length }));

			endDay({ campaign, haul: haul({ fuel: 2 }) });

			expect(seen).toEqual([{ day: 2, fuel: 2, log: 1 }]);
		});

		it.each([
			['a resource the campaign doesn\'t keep', haul({ ammo: 3 } as Partial<Resources>), 'haul.resources has an unknown field "ammo"'],
			['an amount taken away', haul({ scrap: -5 }), 'haul.resources.scrap must be an integer >= 0, got -5'],
			['part of a unit', haul({ fuel: 0.5 }), 'haul.resources.fuel must be an integer >= 0, got 0.5'],
			['an amount in a string', haul({ fuel: '2' as unknown as number }), 'haul.resources.fuel must be a number, got "2"'],
			['stores pushed past what a save holds', haul({ fuel: Number.MAX_SAFE_INTEGER }), /^Campaign\.resources\.fuel must be an integer >= 0, got 9007199254740\d+$/],
			['a blank log line', haul({ fuel: 1 }, ' '), 'haul.message must not be blank']
		])('refuses %s before anyone heals or the day turns', (_label, refused, message) => {
			const campaign = newCampaign({ fuel: 1 });
			const driver = campaign.recruitDriver({ archetype: 'road_warrior' });
			injure(driver, 1);
			const before = savedText(campaign);

			expect(() => endDay({ campaign, haul: refused })).toThrow(message);
			expect(savedText(campaign)).toBe(before);
			expect(driver.status).toBe('injured');
		});

		it('doesn\'t land when a hook throws', () => {
			const campaign = newCampaign({ fuel: 0 });
			const before = savedText(campaign);
			const hooks: DayEndHooks = { ...DAY_END_HOOKS, stopCooldowns: () => { throw new Error('no stop table'); } };

			expect(() => endDay({ campaign, hooks, haul: haul({ fuel: 2 }) })).toThrow('no stop table');
			expect(savedText(campaign)).toBe(before);
		});
	});

	describe('stop cooldowns and POI refills', () => {
		it('runs stop cooldowns, then POI refills, each once, on the campaign\'s state at dusk and the map so far, and keeps the map the last returns', () => {
			const campaign = newCampaign();
			campaign.set({ map: { stops: { 's-1': { clearedOn: 1 } }, pois: {} } });
			const driver = campaign.recruitDriver({ archetype: 'mechanic' });
			injure(driver, 1);
			const calls: { step: string; map: MapState; day: number; food: number; status: DriverStatus }[] = [];
			const states: DuskState[] = [];
			const step = (name: string, next: MapState): MapDayStep => ({ campaign: atDusk, map }) => {
				calls.push({ step: name, map, day: atDusk.day, food: atDusk.resources.food, status: driver.status });
				states.push(atDusk);
				return next;
			};
			const cooled = { stops: { 's-1': { clearedOn: 1, rolls: 1 } }, pois: {} };
			const refilled = { stops: { 's-1': { clearedOn: 1, rolls: 1 } }, pois: { 'p-1': { stock: 3 } } };
			const hooks: DayEndHooks = { stopCooldowns: step('stopCooldowns', cooled), poiRefills: step('poiRefills', refilled) };
			const mapAtDusk = campaign.map;

			endDay({ campaign, hooks });

			expect(calls).toEqual([
				{ step: 'stopCooldowns', map: mapAtDusk, day: 1, food: 21, status: 'injured' },
				{ step: 'poiRefills', map: cooled, day: 1, food: 21, status: 'injured' }
			]);
			expect(campaign.map).toEqual(refilled);
			expect(Object.isFrozen(campaign.map)).toBe(true);
			// A frozen snapshot, not the live campaign: a step can't set anything through it, or read the map anywhere but `map`.
			expect(states[0]).toBe(states[1]);
			expect(states[0]).not.toBeInstanceOf(Campaign);
			expect(Object.isFrozen(states[0])).toBe(true);
			expect('map' in states[0]).toBe(false);
		});

		it('keeps the map as it is with the shipped hooks', () => {
			const campaign = newCampaign();
			campaign.set({ map: { fog: [1, 2, 3] } });
			const map = campaign.map;

			endDay({ campaign, hooks: DAY_END_HOOKS });

			expect(campaign.map).toBe(map);
		});

		it('changes nothing when a hook throws', () => {
			const campaign = newCampaign({ food: 0 });
			injure(campaign.recruitDriver({ archetype: 'road_warrior' }), 1);
			const before = savedText(campaign);
			const changes: string[] = [];
			campaign.on('change', () => changes.push('campaign'));
			campaign.drivers.forEach(driver => driver.on('change', () => changes.push(driver.id)));
			const hooks: DayEndHooks = {
				...DAY_END_HOOKS,
				poiRefills: () => { throw new Error('no POI table'); }
			};

			expect(() => endDay({ campaign, hooks })).toThrow('no POI table');
			expect(savedText(campaign)).toBe(before);
			expect(changes).toEqual([]);
		});

		it('refuses a map a save couldn\'t hold, naming the hook, and changes nothing', () => {
			const campaign = newCampaign();
			const before = savedText(campaign);
			const hooks: DayEndHooks = { ...DAY_END_HOOKS, stopCooldowns: () => ({ stops: { 's-1': { clearedOn: NaN } } }) };

			expect(() => endDay({ campaign, hooks })).toThrow('DayEndHooks.stopCooldowns.stops.s-1.clearedOn must be a finite number, got NaN');
			expect(savedText(campaign)).toBe(before);
		});
	});
});

describe('forecastNeeds', () => {
	it('says how long the founding stores last: a week of food and water for 12 people', () => {
		expect(forecastNeeds({ resources: STORES })).toEqual({
			food: { stock: 21, perDay: 3, days: 7, shortTonight: 0 },
			water: { stock: 21, perDay: 3, days: 7, shortTonight: 0 }
		});
	});

	it('counts whole days only: "Food runs out in 6 days" with 20 food for 12 people', () => {
		expect(forecastNeeds({ resources: { ...STORES, food: 20 } }).food).toEqual({ stock: 20, perDay: 3, days: 6, shortTonight: 0 });
	});

	it.each([
		[2, 1],
		[0, 3]
	])('is already short with %i food for 12 people, by %i tonight', (food, short) => {
		expect(forecastNeeds({ resources: { ...STORES, food } }).food).toEqual({ stock: food, perDay: 3, days: 0, shortTonight: short });
	});

	it('never runs out with nobody to eat it', () => {
		expect(forecastNeeds({ resources: { ...STORES, people: 0, water: 0 } })).toEqual({
			food: { stock: 21, perDay: 0, days: null, shortTonight: 0 },
			water: { stock: 0, perDay: 0, days: null, shortTonight: 0 }
		});
	});

	it('forecasts each resource on its own, by its own rule', () => {
		const rules: CompoundRules = { ...COMPOUND_RULES, upkeep: { peoplePerUnit: { food: 2, water: 6 } } };

		const forecast = forecastNeeds({ resources: { ...STORES, food: 30, water: 5 }, rules });

		expect(forecast.food).toEqual({ stock: 30, perDay: 6, days: 5, shortTonight: 0 });
		expect(forecast.water).toEqual({ stock: 5, perDay: 2, days: 2, shortTonight: 0 });
	});

	it.each([
		[12, 21, 21],
		[12, 20, 9],
		[13, 7, 30],
		[5, 1, 0],
		[1, 4, 3],
		[0, 0, 0]
	])('matches the day end for %i people with %i food and %i water: the first short night follows the days it gives, and nothing runs short sooner', (people, food, water) => {
		const campaign = newCampaign({ people, food, water });
		const forecast = forecastNeeds({ resources: campaign.resources });
		const forecastNight = { food: Infinity, water: Infinity };
		const firstShort = { food: Infinity, water: Infinity };
		for (const resource of UPKEEP_RESOURCES) {
			const days = forecast[resource].days;
			if (days !== null) forecastNight[resource] = days + 1;
		}

		for (let night = 1; night <= 40; night++) {
			const result = endDay({ campaign });
			for (const resource of UPKEEP_RESOURCES) {
				if (result.shortfall[resource] > 0) firstShort[resource] = Math.min(firstShort[resource], night);
			}
		}

		// Exact up to the first shortage; after it People shrinks, and so does the upkeep the forecast assumed.
		expect(Math.min(firstShort.food, firstShort.water)).toBe(Math.min(forecastNight.food, forecastNight.water));
		for (const resource of UPKEEP_RESOURCES) expect(firstShort[resource]).toBeGreaterThanOrEqual(forecastNight[resource]);
	});

	it('comes back frozen', () => {
		const forecast = forecastNeeds({ resources: STORES });

		expect(Object.isFrozen(forecast)).toBe(true);
		expect(Object.isFrozen(forecast.food)).toBe(true);
	});

	it('rejects stores that aren\'t whole numbers', () => {
		expect(() => forecastNeeds({ resources: { ...STORES, water: 2.5 } })).toThrow('resources.water must be an integer >= 0, got 2.5');
	});
});

/** A night's account as plain data, drivers by id, for comparing two campaigns. */
const accountOf = (result: DayEnd) => ({ ...result, healed: result.healed.map(driver => driver.id) });

/**
 * A founded campaign through `days` day ends, with runs scripted on `script`:
 * cargo some days, a settler find now and then, drivers coming home hurt.
 */
function playDays({ seed, script, days, check }: {
	seed: number;
	script: Rng;
	days: number;
	check?: (campaign: Campaign, before: Snapshot, result: DayEnd) => void;
}): { campaign: Campaign; results: DayEnd[] } {
	const campaign = foundCampaign({ seed, unlockedArchetypes: ARCHETYPES });
	const results: DayEnd[] = [];
	for (let night = 0; night < days; night++) {
		const stores = campaign.resources;
		const cargo = script.int(0, 1) === 1;
		campaign.set({
			resources: {
				...stores,
				food: stores.food + (cargo ? script.int(0, 8) : 0),
				water: stores.water + (cargo ? script.int(0, 8) : 0),
				people: stores.people + (script.int(0, 9) === 0 ? script.int(1, 3) : 0)
			}
		});
		const ready = campaign.drivers.filter(driver => driver.status === 'ready');
		if (ready.length > 0 && script.int(0, 3) === 0) injure(script.pick(ready), script.int(1, 4));
		const snapshot = snapshotOf(campaign);
		const result = endDay({ campaign });
		check?.(campaign, snapshot, result);
		results.push(result);
	}
	return { campaign, results };
}

interface DriverCondition {
	status: DriverStatus;
	injuredDays: number;
	hitpoints: number;
}

const conditionOf = ({ status, injuredDays, hitpoints }: DriverCondition): DriverCondition => ({ status, injuredDays, hitpoints });

interface Snapshot {
	day: number;
	resources: Readonly<Resources>;
	unrest: number;
	logLength: number;
	forecast: NeedsForecast;
	drivers: (DriverCondition & { id: string })[];
}

function snapshotOf(campaign: Campaign): Snapshot {
	return {
		day: campaign.day,
		resources: campaign.resources,
		unrest: campaign.unrest,
		logLength: campaign.log.length,
		forecast: forecastNeeds({ resources: campaign.resources }),
		drivers: campaign.drivers.map(driver => ({ id: driver.id, ...conditionOf(driver) }))
	};
}

describe('the day clock over a campaign', () => {
	it('keeps the books straight night after night for 150 days of runs and rests', () => {
		let shortNights = 0;
		let healedDrivers = 0;
		const { campaign } = playDays({
			seed: SEED,
			script: new Rng({ seed: SEED }).fork('script'),
			days: 150,
			check: (after, before, result) => {
				const unitsShort = result.shortfall.food + result.shortfall.water;
				expect(result.day).toBe(before.day);
				expect(after.day).toBe(before.day + 1);
				for (const resource of UPKEEP_RESOURCES) {
					expect(result.upkeep[resource]).toBe(before.forecast[resource].perDay);
					expect(result.shortfall[resource]).toBe(before.forecast[resource].shortTonight);
					expect(result.shortfall[resource] > 0).toBe(before.forecast[resource].days === 0);
					expect(after.resources[resource]).toBe(before.resources[resource] - result.upkeep[resource] + result.shortfall[resource]);
				}
				expect(result.peopleLost).toBe(Math.min(before.resources.people, unitsShort));
				expect(after.resources).toEqual({ ...before.resources, food: after.resources.food, water: after.resources.water, people: before.resources.people - result.peopleLost });
				expect(result.unrestGained).toBe(unitsShort);
				expect(after.unrest).toBe(before.unrest + unitsShort);
				expect(after.log.length).toBe(before.logLength + (unitsShort > 0 ? 1 : 0));
				expect(result.outcome).toBe(after.resources.people === 0 ? 'abandoned' : 'continues');
				before.drivers.forEach((was, index) => {
					const driver = after.drivers[index];
					const expected = was.status !== 'injured' ? conditionOf(was)
						: was.injuredDays === 1 ? { status: 'ready', injuredDays: 0, hitpoints: driver.maxHitpoints }
						: { status: 'injured', injuredDays: was.injuredDays - 1, hitpoints: was.hitpoints };
					expect(conditionOf(driver)).toEqual(expected);
				});
				expect(result.healed.map(driver => driver.id)).toEqual(before.drivers.filter(was => was.status === 'injured' && was.injuredDays === 1).map(was => was.id));
				if (unitsShort > 0) shortNights++;
				healedDrivers += result.healed.length;
			}
		});

		expect(campaign.day).toBe(151);
		// The script has to have gone hungry and healed someone to have tested either.
		expect(shortNights).toBeGreaterThan(5);
		expect(healedDrivers).toBeGreaterThan(5);
		expect(savedText(reload(campaign))).toBe(savedText(campaign));
	});

	it('plays out the same from the same seed and script, without Math.random', () => {
		const random = jest.spyOn(Math, 'random');
		try {
			const play = () => playDays({ seed: SEED, script: new Rng({ seed: 7 }), days: 60 });
			const first = play();
			const second = play();

			expect(random).not.toHaveBeenCalled();
			expect(savedText(second.campaign)).toBe(savedText(first.campaign));
			expect(second.results.map(accountOf)).toEqual(first.results.map(accountOf));
		} finally {
			random.mockRestore();
		}
	});
});
