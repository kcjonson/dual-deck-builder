import { RNG_VERSION, Rng } from '../core/Rng';
import { resolveMapParams } from '../map/MapParams';
import { Campaign, Resources } from './Campaign';
import { CAMPAIGN_START } from './CampaignStart';
import { COMPOUND_RULES, CompoundRules } from './CompoundRules';
import { DAY_END_HOOKS, DayEndHooks, forecastNeeds } from './DayClock';
import { DRIVER_ARCHETYPES, DriverRecord } from './DriverRecord';
import { ScavengeHaul, ScavengeRuleError, getScavengeBlocker, rollScavengeHaul, scavenge, scavengeMessage } from './Scavenging';

const SEED = 20261008;

/** The founding stores: 21 food and water, 10 fuel, 150 scrap, and 12 people. */
const STORES: Readonly<Resources> = CAMPAIGN_START.resources;

/**
 * Fuel for one run. Route costs aren't set yet; the founding stores' 10 is
 * "fuel for a few runs", so half of it stands in, the dear end of a few.
 */
const RUN_FUEL = Math.ceil(STORES.fuel / 2);

/** `rollScavengeHaul` for `SEED`, days 1 to 6, at `RNG_VERSION` 1. A change here moves every campaign's hauls. */
const PINNED_HAULS: readonly ScavengeHaul[] = [
	{ fuel: 2, scrap: 13 },
	{ fuel: 1, scrap: 11 },
	{ fuel: 1, scrap: 8 },
	{ fuel: 2, scrap: 14 },
	{ fuel: 1, scrap: 13 },
	{ fuel: 1, scrap: 15 }
];

const newCampaign = ({ seed = SEED, resources = {} }: { seed?: number; resources?: Partial<Resources> } = {}): Campaign => new Campaign({
	seed,
	generatorVersion: 1,
	mapParams: resolveMapParams({ seed, environment: 'mixed' }).params,
	resources: { ...STORES, ...resources }
});

/** A campaign with nothing to drive on: no fuel, and no scrap to trade for any. */
const strandedCampaign = (resources: Partial<Resources> = {}, seed = SEED): Campaign =>
	newCampaign({ seed, resources: { fuel: 0, scrap: 0, ...resources } });

const reload = (campaign: Campaign): Campaign => Campaign.fromJSON(JSON.parse(JSON.stringify(campaign)));

const savedText = (campaign: Campaign): string => JSON.stringify(campaign);

const scavengingRules = (scavenging: Partial<CompoundRules['scavenging']>): CompoundRules => ({
	...COMPOUND_RULES,
	scavenging: { ...COMPOUND_RULES.scavenging, ...scavenging }
});

const injure = (driver: DriverRecord, injuredDays: number): void => {
	driver.set({ status: 'injured', injuredDays, hitpoints: Math.max(1, driver.maxHitpoints - 9) });
};

const kill = (driver: DriverRecord): void => driver.set({ status: 'dead', hitpoints: 0, defaultDeck: {} });

describe('rollScavengeHaul', () => {
	it('rolls the pinned hauls for one seed', () => {
		expect(RNG_VERSION).toBe(1);
		expect([1, 2, 3, 4, 5, 6].map(day => rollScavengeHaul({ seed: SEED, day }))).toEqual(PINNED_HAULS);
	});

	it('draws fuel, then scrap, from the day\'s own stream off the campaign seed', () => {
		const stream = new Rng({ seed: SEED }).fork('scavenge', 9);
		const { fuel, scrap } = COMPOUND_RULES.scavenging;

		expect(rollScavengeHaul({ seed: SEED, day: 9 })).toEqual({ fuel: stream.int(fuel.min, fuel.max), scrap: stream.int(scrap.min, scrap.max) });
	});

	it('rolls the same haul for the same seed and day, every time', () => {
		const first = Array.from({ length: 40 }, (_, index) => rollScavengeHaul({ seed: SEED, day: index + 1 }));
		const second = Array.from({ length: 40 }, (_, index) => rollScavengeHaul({ seed: SEED, day: index + 1 }));

		expect(second).toEqual(first);
	});

	it('rolls a different run of hauls for another seed', () => {
		const days = Array.from({ length: 40 }, (_, index) => index + 1);
		const run = (seed: number) => days.map(day => rollScavengeHaul({ seed, day }));

		expect(run(SEED + 1)).not.toEqual(run(SEED));
	});

	it('keeps inside the rules\' ranges and reaches both ends of each', () => {
		const hauls = Array.from({ length: 400 }, (_, index) => rollScavengeHaul({ seed: SEED, day: index + 1 }));
		const { fuel, scrap } = COMPOUND_RULES.scavenging;

		expect(new Set(hauls.map(haul => haul.fuel))).toEqual(new Set([1, 2]));
		expect(Math.min(...hauls.map(haul => haul.scrap))).toBe(scrap.min);
		expect(Math.max(...hauls.map(haul => haul.scrap))).toBe(scrap.max);
		expect(hauls.every(haul => haul.fuel >= fuel.min && haul.fuel <= fuel.max && Number.isInteger(haul.scrap))).toBe(true);
	});

	it('rolls what the rules it\'s given say', () => {
		const rules = scavengingRules({ fuel: { min: 4, max: 4 }, scrap: { min: 0, max: 0 } });

		expect(rollScavengeHaul({ seed: SEED, day: 3, rules })).toEqual({ fuel: 4, scrap: 0 });
	});

	it('comes back frozen', () => {
		expect(Object.isFrozen(rollScavengeHaul({ seed: SEED, day: 1 }))).toBe(true);
	});

	it.each([
		['a seed past a uint32', { seed: 2 ** 32, day: 1 }, 'seed must be an integer from 0 to 4294967295, got 4294967296'],
		['day 0', { seed: SEED, day: 0 }, 'day must be an integer from 1 to 4294967295, got 0'],
		['part of a day', { seed: SEED, day: 1.5 }, 'day must be an integer from 1 to 4294967295, got 1.5'],
		['a day past the attempts a stream takes', { seed: SEED, day: 2 ** 32 }, 'day must be an integer from 1 to 4294967295, got 4294967296']
	])('rejects %s', (_label, options, message) => {
		expect(() => rollScavengeHaul(options)).toThrow(message);
	});
});

describe('scavenge', () => {
	it('brings the haul home and ends the day: the compound eats, the day turns, and the log says what came back', () => {
		const campaign = strandedCampaign();
		const expected = rollScavengeHaul({ seed: SEED, day: 1 });

		const { haul, dayEnd } = scavenge({ campaign });

		expect(haul).toEqual(expected);
		expect(dayEnd).toMatchObject({ day: 1, upkeep: { food: 3, water: 3 }, shortfall: { food: 0, water: 0 } });
		expect(campaign.isOver).toBe(false);
		expect(campaign.day).toBe(2);
		expect(campaign.resources).toEqual({ ...STORES, food: 18, water: 18, fuel: haul.fuel, scrap: haul.scrap });
		expect(campaign.log).toEqual([{ day: 1, message: scavengeMessage(haul) }]);
	});

	it('logs "A scavenging party brought back 2 fuel and 15 scrap."', () => {
		expect(scavengeMessage({ fuel: 2, scrap: 15 })).toBe('A scavenging party brought back 2 fuel and 15 scrap.');
		expect(scavengeMessage({ fuel: 1, scrap: 0 })).toBe('A scavenging party brought back 1 fuel.');
	});

	it('logs the haul ahead of the shortfall it didn\'t prevent, both dated the day that ended', () => {
		const campaign = strandedCampaign({ food: 1 });
		campaign.set({ day: 7 });

		const { haul } = scavenge({ campaign });

		expect(campaign.log).toEqual([
			{ day: 7, message: scavengeMessage(haul) },
			{ day: 7, message: 'Ran short of 2 food; 2 people lost.' }
		]);
	});

	it('heals the injured overnight, as a day of rest does', () => {
		const campaign = strandedCampaign();
		const driver = campaign.recruitDriver({ archetype: 'mechanic' });
		injure(driver, 1);

		const { dayEnd } = scavenge({ campaign });

		expect(dayEnd.healed).toEqual([driver]);
		expect(driver.status).toBe('ready');
	});

	it('rolls its haul from the day it went out, so a second day brings back the second day\'s', () => {
		const campaign = strandedCampaign();

		const hauls = [1, 2, 3].map(() => scavenge({ campaign }).haul);

		expect(hauls).toEqual([1, 2, 3].map(day => rollScavengeHaul({ seed: SEED, day })));
		expect(campaign.resources.fuel).toBe(hauls.reduce((total, haul) => total + haul.fuel, 0));
		expect(campaign.resources.scrap).toBe(hauls.reduce((total, haul) => total + haul.scrap, 0));
	});

	it('brings back the same haul from a reloaded save, since the day is the stream\'s counter', () => {
		const campaign = strandedCampaign();
		scavenge({ campaign });
		const loaded = reload(campaign);

		expect(scavenge({ campaign: loaded }).haul).toEqual(scavenge({ campaign }).haul);
		expect(savedText(loaded)).toBe(savedText(campaign));
	});

	describe('one set', () => {
		it('stores the haul and the day end in one campaign change, after the healed drivers', () => {
			const campaign = strandedCampaign();
			const driver = campaign.recruitDriver({ archetype: 'road_warrior' });
			injure(driver, 1);
			const seen: { day: number; fuel: number; status: string; log: number }[] = [];
			campaign.on('change', () => seen.push({ day: campaign.day, fuel: campaign.resources.fuel, status: driver.status, log: campaign.log.length }));

			const { haul } = scavenge({ campaign });

			expect(seen).toEqual([{ day: 2, fuel: haul.fuel, status: 'ready', log: 1 }]);
		});

		it('lands whole when listeners throw: the emitter logs them, and the haul and the new day are stored together', () => {
			const campaign = strandedCampaign();
			const driver = campaign.recruitDriver({ archetype: 'road_warrior' });
			injure(driver, 1);
			driver.on('change', () => { throw new Error('a record listener broke'); });
			campaign.on('change', () => { throw new Error('a campaign listener broke'); });
			const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined);
			try {
				const { haul } = scavenge({ campaign });

				expect(campaign.day).toBe(2);
				expect(campaign.resources).toMatchObject({ fuel: haul.fuel, scrap: haul.scrap });
				expect(campaign.log).toEqual([{ day: 1, message: scavengeMessage(haul) }]);
				expect(driver.status).toBe('ready');
				expect(logged.mock.calls.map(call => (call[1] as Error).message)).toEqual(['a record listener broke', 'a campaign listener broke']);
			} finally {
				logged.mockRestore();
			}
		});

		it('changes nothing when a map step throws: no haul, no healing, no day', () => {
			const campaign = strandedCampaign();
			injure(campaign.recruitDriver({ archetype: 'road_warrior' }), 1);
			const before = savedText(campaign);
			const changes: string[] = [];
			campaign.on('change', () => changes.push('campaign'));
			campaign.drivers.forEach(driver => driver.on('change', () => changes.push(driver.id)));
			const hooks: DayEndHooks = { ...DAY_END_HOOKS, poiRefills: () => { throw new Error('no POI table'); } };

			expect(() => scavenge({ campaign, hooks })).toThrow('no POI table');
			expect(savedText(campaign)).toBe(before);
			expect(changes).toEqual([]);
		});

		it('changes nothing when the haul would push the stores past what a save holds', () => {
			const campaign = strandedCampaign({ scrap: Number.MAX_SAFE_INTEGER - 1 });
			const driver = campaign.recruitDriver({ archetype: 'road_warrior' });
			injure(driver, 1);
			const before = savedText(campaign);

			expect(() => scavenge({ campaign })).toThrow(/^Campaign\.resources\.scrap must be an integer >= 0, got 900719925474\d+$/);
			expect(savedText(campaign)).toBe(before);
			expect(driver.status).toBe('injured');
		});

		it('checks the rules it\'s given before rolling or changing anything', () => {
			const campaign = strandedCampaign();
			const before = savedText(campaign);

			expect(() => scavenge({ campaign, rules: scavengingRules({ fuel: { min: 0, max: 2 } }) }))
				.toThrow('CompoundRules.scavenging.fuel.min must be an integer from 1 to 100, got 0');
			expect(savedText(campaign)).toBe(before);
		});
	});

	describe('who can go', () => {
		it('refuses an empty compound, which has fallen, with a typed reason, and changes nothing', () => {
			const campaign = strandedCampaign({ people: 0 });
			const before = savedText(campaign);
			const changes: number[] = [];
			campaign.on('change', () => changes.push(campaign.day));

			expect(getScavengeBlocker({ campaign })).toEqual({ reason: 'abandoned' });
			expect(() => scavenge({ campaign })).toThrow(ScavengeRuleError);
			expect(() => scavenge({ campaign })).toThrow('Nobody is left at the compound to send out scavenging');
			try {
				scavenge({ campaign });
			} catch (error) {
				expect((error as ScavengeRuleError).blocker).toEqual({ reason: 'abandoned' });
			}
			expect(savedText(campaign)).toBe(before);
			expect(changes).toEqual([]);
		});

		it('refuses while a run is out, since its return ends the day, and changes nothing', () => {
			const campaign = strandedCampaign();
			campaign.startRunDecks({ seats: (['road_warrior', 'mechanic'] as const).map(archetype => campaign.recruitDriver({ archetype })) });
			const before = savedText(campaign);
			const changes: number[] = [];
			campaign.on('change', () => changes.push(campaign.day));

			expect(getScavengeBlocker({ campaign })).toEqual({ reason: 'run_out', run: 'run-1' });
			expect(() => scavenge({ campaign })).toThrow("run-1 is out, so no scavenging party goes until it's home");
			expect(savedText(campaign)).toBe(before);
			expect(changes).toEqual([]);
		});

		it('names the fallen compound first when a run is out as the last people go', () => {
			const campaign = strandedCampaign({ people: 0 });
			campaign.startRunDecks({ seats: (['road_warrior', 'mechanic'] as const).map(archetype => campaign.recruitDriver({ archetype })) });

			expect(getScavengeBlocker({ campaign })).toEqual({ reason: 'abandoned' });
		});

		it.each([
			['one settler and no drivers', () => strandedCampaign({ people: 1 })],
			['every driver injured', () => {
				const campaign = strandedCampaign();
				DRIVER_ARCHETYPES.forEach(archetype => injure(campaign.recruitDriver({ archetype }), 3));
				return campaign;
			}],
			['every driver dead or missing', () => {
				const campaign = strandedCampaign();
				kill(campaign.recruitDriver({ archetype: 'road_warrior' }));
				campaign.recruitDriver({ archetype: 'mechanic' }).set({ status: 'missing' });
				return campaign;
			}],
			['nothing in the stores and unrest high', () => {
				const campaign = strandedCampaign({ food: 0, water: 0, meds: 0 });
				campaign.set({ unrest: 400 });
				return campaign;
			}]
		])('sends settlers on foot with %s', (_label, setUp) => {
			const campaign = setUp();
			const fuel = campaign.resources.fuel;

			expect(getScavengeBlocker({ campaign })).toBeNull();
			expect(scavenge({ campaign }).haul.fuel).toBeGreaterThanOrEqual(1);
			expect(campaign.resources.fuel).toBeGreaterThan(fuel);
		});
	});
});

describe('never stuck', () => {
	it('gets a founded compound with no fuel and no scrap a run\'s fuel well inside the week its food lasts', () => {
		const campaign = strandedCampaign();
		let days = 0;

		while (campaign.resources.fuel < RUN_FUEL) {
			scavenge({ campaign });
			days++;
			expect(campaign.isOver).toBe(false);
		}

		expect(days).toBeLessThanOrEqual(Math.ceil(RUN_FUEL / COMPOUND_RULES.scavenging.fuel.min));
		expect(forecastNeeds({ resources: campaign.resources }).food.days).toBeGreaterThan(0);
	});

	it('can always send a party while anyone is left, and a fed compound always scavenges its way to a run, over 300 seeds and stranded states', () => {
		const script = new Rng({ seed: 303 }).fork('sweep');
		const fuelMin = COMPOUND_RULES.scavenging.fuel.min;
		const daysNeeded = Math.ceil(RUN_FUEL / fuelMin);
		let fedCompounds = 0;
		let fallenCompounds = 0;

		for (let index = 0; index < 300; index++) {
			const seed = script.next();
			const people = script.pick([1, 2, 3, 4, 5, 12, 13, 40, script.int(1, 200)]);
			const campaign = strandedCampaign({
				people,
				food: script.int(0, 30 * Math.ceil(people / 4)),
				water: script.int(0, 30 * Math.ceil(people / 4)),
				meds: script.int(0, 5)
			}, seed);
			campaign.set({ day: script.int(1, 2000), unrest: script.int(0, 300) });
			for (const archetype of DRIVER_ARCHETYPES) {
				if (script.int(0, 2) === 0) continue;
				const driver = campaign.recruitDriver({ archetype });
				const condition = script.int(0, 3);
				if (condition === 1) injure(driver, script.int(1, 6));
				else if (condition === 2) kill(driver);
				else if (condition === 3) driver.set({ status: 'missing' });
			}
			const forecast = forecastNeeds({ resources: campaign.resources });
			const fed = Math.min(forecast.food.days ?? Infinity, forecast.water.days ?? Infinity) >= daysNeeded;

			for (let day = 0; day < daysNeeded && campaign.resources.fuel < RUN_FUEL; day++) {
				if (campaign.resources.people === 0) break;
				const before = campaign.resources;
				expect(getScavengeBlocker({ campaign })).toBeNull();

				const { haul, dayEnd } = scavenge({ campaign });

				expect(haul.fuel).toBeGreaterThanOrEqual(fuelMin);
				// The night eats food and water; nothing it does touches fuel or scrap.
				expect(campaign.resources.fuel).toBe(before.fuel + haul.fuel);
				expect(campaign.resources.scrap).toBe(before.scrap + haul.scrap);
				if (fed) expect(dayEnd.shortfall).toEqual({ food: 0, water: 0 });
			}

			if (fed) {
				fedCompounds++;
				expect(campaign.resources.fuel).toBeGreaterThanOrEqual(RUN_FUEL);
				expect(campaign.resources.people).toBe(people);
			}
			if (campaign.resources.people === 0) {
				fallenCompounds++;
				// The night that emptied it ended the campaign (DDB-305), which the check names first
				expect(campaign.end?.cause).toBe('no_people');
				expect(getScavengeBlocker({ campaign })).toEqual({ reason: 'campaign_over', end: campaign.end });
			}
		}

		// The sweep has to have held fed compounds and starving ones to have tested either.
		expect(fedCompounds).toBeGreaterThan(50);
		expect(fallenCompounds).toBeGreaterThan(10);
	});

	it('plays out the same from the same seed, without Math.random', () => {
		const random = jest.spyOn(Math, 'random');
		try {
			const play = () => {
				const campaign = strandedCampaign();
				const hauls: ScavengeHaul[] = Array.from({ length: 8 }, () => scavenge({ campaign }).haul);
				return { hauls, saved: savedText(campaign) };
			};
			const first = play();
			const second = play();

			expect(random).not.toHaveBeenCalled();
			expect(second).toEqual(first);
		} finally {
			random.mockRestore();
		}
	});
});
