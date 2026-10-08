import { DriverLoader } from '../core/DriverLoader';
import { RNG_VERSION, Rng } from '../core/Rng';
import { MapParamSet, resolveMapParams } from '../map/MapParams';
import { validateMapParams } from '../map/ParamValidator';
import { rollParams } from '../map/RollParams';
import { DRIVER_CONFIGS, DriverArchetype } from '../mechanics/Driver';
import { Campaign } from './Campaign';
import { CAMPAIGN_START, CampaignStart } from './CampaignStart';
import { startingDeckCounts } from './CardCounts';
import { DRIVER_ARCHETYPES, placeholderName } from './DriverRecord';
import { FoundingOptions, dealStartingPool, foundCampaign } from './Founding';

const SEED = 20261007;

/** Four archetypes, written out, so a new one in DRIVER_CONFIGS moves none of these deals. */
const ARCHETYPES: readonly DriverArchetype[] = ['road_warrior', 'interceptor', 'mechanic', 'raider'];

/** Unlocked before any progression: every archetype but the Raider. */
const UNLOCKED = DRIVER_ARCHETYPES.filter(archetype => DRIVER_CONFIGS[archetype].metadata.unlocked);

/** A start dealing four, whatever the shipped file is tuned to. */
const FOUR: CampaignStart = { ...CAMPAIGN_START, poolSize: 4 };

/** Seeds spread over the uint32 range. */
const SEEDS = Array.from({ length: 400 }, (_, index) => (index * 2654435761) >>> 0);

const found = (options: Partial<FoundingOptions> = {}): Campaign => foundCampaign({
	seed: SEED,
	unlockedArchetypes: ARCHETYPES,
	...options
});

const archetypesOf = (campaign: Campaign): DriverArchetype[] => campaign.drivers.map(driver => driver.archetype);

describe('foundCampaign', () => {
	describe('from a seed', () => {
		it('founds the same campaign from the same seed', () => {
			const first = found({ start: { ...CAMPAIGN_START, escorts: ['fuel_hauler'] } });
			const second = found({ start: { ...CAMPAIGN_START, escorts: ['fuel_hauler'] } });

			expect(second).not.toBe(first);
			expect(JSON.stringify(second.toJSON())).toBe(JSON.stringify(first.toJSON()));
		});

		it('founds a different campaign from a different seed: other map params, and another deal', () => {
			const campaigns = SEEDS.slice(0, 8).map(seed => foundCampaign({ seed, unlockedArchetypes: ARCHETYPES }));
			const params = new Set(campaigns.map(campaign => JSON.stringify({ ...campaign.mapParams, seed: 0 })));
			const pools = new Set(campaigns.map(campaign => archetypesOf(campaign).join()));

			expect(params.size).toBe(campaigns.length);
			expect(pools.size).toBeGreaterThan(1);
		});

		// Everything founding draws comes from the seed's streams, and building
		// the campaign, its records, its convoy, and its escorts draws nothing.
		it('never calls Math.random, with params rolled or given, starter escorts and all', () => {
			const start: CampaignStart = { ...CAMPAIGN_START, escorts: ['med_truck', 'outrider'] };
			const random = jest.spyOn(Math, 'random');
			try {
				found({ start });
				found({ start, mapParams: { seed: SEED, environment: 'rustBelt', towns: 9 } });
				expect(random).not.toHaveBeenCalled();
			} finally {
				random.mockRestore();
			}
		});

		it.each([-1, 2 ** 32, 1.5, NaN])('rejects a seed of %p', (seed) => {
			expect(() => found({ seed })).toThrow(`seed must be an integer from 0 to 4294967295, got ${seed}`);
		});
	});

	describe('map params', () => {
		it('rolls them from the seed when none are given', () => {
			expect(found().mapParams).toEqual(rollParams(SEED));
		});

		it('founds on a validated set as it is, as the Map Lab passes it', () => {
			const params = validateMapParams(resolveMapParams({ seed: SEED, environment: 'badlands', radius: 1400, strongholds: 6 }).params).params;

			expect(found({ mapParams: params }).mapParams).toEqual(params);
		});

		it('fills out a set from its environment', () => {
			const campaign = found({ mapParams: { seed: SEED, environment: 'highDesert', towns: 7 } });

			expect(campaign.mapParams).toEqual(resolveMapParams({ seed: SEED, environment: 'highDesert', towns: 7 }).params);
			expect([campaign.mapParams.aridity, campaign.mapParams.towns]).toEqual([0.15, 7]);
		});

		it('founds on a set with stop tables, holding a frozen copy that saves and loads back the same', () => {
			const stopTables = { highway: { raider_ambush: 2 } };
			const campaign = found({ mapParams: { seed: SEED, stopTables } });
			stopTables.highway.raider_ambush = 9;

			expect(campaign.mapParams.stopTables).toStrictEqual({ highway: { raider_ambush: 2 } });
			expect(Object.isFrozen(campaign.mapParams.stopTables)).toBe(true);
			const onWarning = jest.fn();
			const loaded = Campaign.fromJSON(JSON.parse(JSON.stringify(campaign)), { onWarning });
			expect(loaded.mapParams.stopTables).toStrictEqual({ highway: { raider_ambush: 2 } });
			expect(onWarning).not.toHaveBeenCalled();
		});

		it('validates them first, so the campaign holds the params generation runs on', () => {
			const { mapParams } = found({ mapParams: { seed: SEED, strongholds: 8, highways: 3, radius: 5000 } });

			expect([mapParams.strongholds, mapParams.highways, mapParams.highwaySeparation, mapParams.radius]).toEqual([7, 9, 35, 1600]);
		});

		it('refuses params made from another seed', () => {
			expect(() => found({ mapParams: { ...rollParams(7) } })).toThrow("mapParams.seed must be the campaign's seed, 20261007, got 7");
		});

		it('takes a seed that wraps to the campaign\'s, comparing it as the validator wraps it', () => {
			expect(found({ mapParams: { seed: SEED + 2 ** 32 } }).mapParams.seed).toBe(SEED);
		});

		it.each([
			['that aren\'t an object', null, 'Invalid map preset: expected a JSON object'],
			['with a parameter the map doesn\'t have', { seed: SEED, strongholdz: 99 }, 'Invalid map preset: unknown parameter "strongholdz"'],
			['with a parameter in a string', { seed: SEED, radius: '1400' }, 'Invalid map preset: radius must be a number, got "1400"'],
			['with stop tables in a list', { seed: SEED, stopTables: [] }, 'Invalid map preset: stopTables must be an object'],
			['with null for stop tables', { seed: SEED, stopTables: null }, 'Invalid map preset: stopTables must be an object']
		])('refuses params %s, as a map preset would be refused', (_label, mapParams, message) => {
			expect(() => found({ mapParams: mapParams as unknown as MapParamSet })).toThrow(message);
		});

		it('names the path to a value in the stop tables that JSON can\'t hold', () => {
			expect(() => found({ mapParams: { seed: SEED, stopTables: { highway: { raider_ambush: NaN } } } }))
				.toThrow('Invalid map preset: stopTables.highway.raider_ambush must be a finite number, got NaN');
		});
	});

	describe('the starting pool', () => {
		it('recruits the deal through the campaign: ids in the order dealt, each named as the first of their archetype', () => {
			const campaign = found({ start: FOUR });

			expect(archetypesOf(campaign)).toEqual(dealStartingPool({ seed: SEED, unlockedArchetypes: ARCHETYPES, size: 4 }));
			expect(campaign.drivers.map(driver => driver.id)).toEqual(['driver-1', 'driver-2', 'driver-3', 'driver-4']);
			expect(campaign.drivers.map(driver => driver.name)).toEqual(campaign.drivers.map(({ archetype }) => placeholderName({ archetype, ordinal: 1 })));
			expect(campaign.nextDriverNumber).toBe(5);
		});

		it('deals the pool size from the start', () => {
			expect(found()).toHaveProperty('drivers.length', Math.min(CAMPAIGN_START.poolSize, ARCHETYPES.length));
			expect(found({ start: { ...CAMPAIGN_START, poolSize: 2 } }).drivers).toHaveLength(2);
		});

		it('gives each driver their archetype\'s starting deck as their default deck, its hand limit, and full HP', () => {
			for (const driver of found({ start: FOUR }).drivers) {
				const config = DRIVER_CONFIGS[driver.archetype];
				expect(driver.defaultDeck).toEqual(startingDeckCounts(driver.archetype));
				expect(driver.handLimit).toBe(config.handLimit);
				expect([driver.hitpoints, driver.maxHitpoints]).toEqual([config.maxHitpoints, config.maxHitpoints]);
				expect([driver.status, driver.injuredDays, driver.runsCompleted]).toEqual(['ready', 0, 0]);
			}
		});

		it('takes one of each of today\'s unlocked archetypes, since three is fewer than four', () => {
			const campaign = found({ unlockedArchetypes: UNLOCKED, start: FOUR });

			expect(UNLOCKED).toEqual(['road_warrior', 'interceptor', 'mechanic']);
			expect([...archetypesOf(campaign)].sort()).toEqual([...UNLOCKED].sort());
		});

		it('deals from what DriverLoader has unlocked, passed in by archetype', async () => {
			const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
			try {
				const loader = DriverLoader.getInstance();
				await loader.loadDrivers();
				const campaign = found({ unlockedArchetypes: loader.getUnlockedDrivers().map(driver => driver.archetype), start: FOUR });

				expect([...archetypesOf(campaign)].sort()).toEqual([...UNLOCKED].sort());
			} finally {
				log.mockRestore();
			}
		});

		it('founds with two archetypes unlocked, enough for a run', () => {
			expect(archetypesOf(found({ unlockedArchetypes: ['raider', 'mechanic'], start: FOUR })).sort()).toEqual(['mechanic', 'raider']);
		});

		it.each([
			['nothing', [], 0],
			['one archetype', ['mechanic'], 1],
			['one archetype twice', ['mechanic', 'mechanic'], 1]
		] as const)('refuses to found a compound with %s unlocked, which could never send out a run', (_label, unlockedArchetypes, count) => {
			expect(() => found({ unlockedArchetypes })).toThrow(
				`unlockedArchetypes must hold at least 2 different archetypes, since a run takes 2 drivers and no two alike, got ${count}`
			);
		});
	});

	describe('the compound', () => {
		it('starts with the start\'s stores and escorts, an empty locker, no unrest, and nothing taken', () => {
			const campaign = found();

			expect(campaign.resources).toEqual(CAMPAIGN_START.resources);
			expect(campaign.convoy.escorts.map(escort => escort.escort?.type)).toEqual(CAMPAIGN_START.escorts);
			expect(campaign.locker).toEqual({});
			expect(campaign.unrest).toBe(0);
			expect(campaign.strongholdsTaken).toEqual([]);
		});

		it('brings the starter escorts a start lists, fresh, in roster order, and no cards with them', () => {
			const campaign = found({ start: { ...FOUR, escorts: ['fuel_hauler', 'outrider', 'fuel_hauler'] } });

			expect(campaign.convoy.escorts.map(escort => escort.name)).toEqual(['Fuel Hauler', 'Outrider', 'Fuel Hauler']);
			for (const escort of campaign.convoy.escorts) {
				expect([escort.structure, escort.armor]).toEqual([escort.maxStructure, escort.maxArmor]);
				expect(escort.escort?.setPiece).toBe(false);
			}
			// Signature cards join run decks at load out, never the locker or a default deck.
			expect(campaign.locker).toEqual({});
			expect(campaign.drivers.map(driver => driver.defaultDeck)).toEqual(campaign.drivers.map(driver => startingDeckCounts(driver.archetype)));
		});

		it('is day 1, with the founding in the log', () => {
			const campaign = found();

			expect(campaign.day).toBe(1);
			expect(campaign.log).toEqual([{ day: 1, message: 'Founded the compound.' }]);
		});

		it('is founded on the model\'s stand-in map, at generator version 1, until the generator exists', () => {
			const campaign = found();

			expect(campaign.map).toEqual({});
			expect(campaign.generatorVersion).toBe(1);
		});

		it('checks the start it\'s given', () => {
			expect(() => found({ start: { ...CAMPAIGN_START, poolSize: 1 } })).toThrow('CampaignStart.poolSize must be an integer >= 2, got 1');
			expect(() => found({ start: { ...CAMPAIGN_START, resources: { ...CAMPAIGN_START.resources, fuel: -2 } } }))
				.toThrow('CampaignStart.resources.fuel must be an integer >= 0, got -2');
		});
	});

	it('saves, and loads back the same with nothing to repair', () => {
		const campaign = found({ start: { ...CAMPAIGN_START, escorts: ['pilot_car', 'med_truck'] } });
		const onWarning = jest.fn();
		const loaded = Campaign.fromJSON(JSON.parse(JSON.stringify(campaign)), { onWarning });

		expect(JSON.stringify(loaded)).toBe(JSON.stringify(campaign));
		expect(onWarning).not.toHaveBeenCalled();
	});
});

describe('dealStartingPool', () => {
	const deal = (options: Partial<Parameters<typeof dealStartingPool>[0]> = {}): DriverArchetype[] => dealStartingPool({
		seed: SEED,
		unlockedArchetypes: ARCHETYPES,
		size: 4,
		...options
	});

	it.each([1, 2, 3, 4])('deals %i different archetypes', (size) => {
		const pool = deal({ size });

		expect(pool).toHaveLength(size);
		expect(new Set(pool).size).toBe(size);
	});

	it('deals only what\'s unlocked, and all of it when that\'s fewer than the size', () => {
		expect([...deal({ unlockedArchetypes: ['raider', 'mechanic'] })].sort()).toEqual(['mechanic', 'raider']);
		expect(deal({ unlockedArchetypes: ['interceptor'] })).toEqual(['interceptor']);
	});

	it('deals the same whatever order the unlocked archetypes come in, repeats and all', () => {
		const pool = deal({ unlockedArchetypes: UNLOCKED, size: 2 });

		expect(deal({ unlockedArchetypes: [...UNLOCKED].reverse(), size: 2 })).toEqual(pool);
		expect(deal({ unlockedArchetypes: [...UNLOCKED, ...UNLOCKED], size: 2 })).toEqual(pool);
	});

	it('deals each archetype into a smaller pool about as often as the others', () => {
		const size = 2;
		const dealt = new Map<DriverArchetype, number>();
		for (const seed of SEEDS) {
			for (const archetype of deal({ seed, size })) dealt.set(archetype, (dealt.get(archetype) ?? 0) + 1);
		}

		// Each archetype's share of the seeds, give or take three standard deviations.
		const share = size / ARCHETYPES.length;
		const expected = SEEDS.length * share;
		const spread = 3 * Math.sqrt(SEEDS.length * share * (1 - share));
		for (const archetype of ARCHETYPES) {
			expect(dealt.get(archetype)).toBeGreaterThan(expected - spread);
			expect(dealt.get(archetype)).toBeLessThan(expected + spread);
		}
	});

	it('shuffles the unlocked archetypes, sorted by id, on the pool fork of the seed\'s founding stream', () => {
		for (const seed of SEEDS.slice(0, 50)) {
			const stream = new Rng({ seed }).fork('founding').fork('pool');
			expect(deal({ seed, size: 3 })).toEqual(stream.shuffle([...ARCHETYPES].sort()).slice(0, 3));
		}
	});

	// What a seed deals is part of what the seed means, pinned like the PRNG's
	// goldens. Unlocking an archetype moves every seed's deal; reordering
	// DRIVER_CONFIGS, or adding a locked archetype, moves none.
	it('deals the pinned pools for one seed', () => {
		expect(RNG_VERSION).toBe(1);
		expect(deal({ unlockedArchetypes: ['road_warrior', 'interceptor', 'mechanic', 'raider'] }))
			.toEqual(['road_warrior', 'mechanic', 'interceptor', 'raider']);
		expect(deal({ unlockedArchetypes: ['road_warrior', 'interceptor', 'mechanic'] }))
			.toEqual(['mechanic', 'interceptor', 'road_warrior']);
	});

	it('never calls Math.random', () => {
		const random = jest.spyOn(Math, 'random');
		try {
			deal();
			expect(random).not.toHaveBeenCalled();
		} finally {
			random.mockRestore();
		}
	});

	it('refuses to deal from nothing', () => {
		expect(() => deal({ unlockedArchetypes: [] })).toThrow("unlockedArchetypes is empty, so there's nothing to deal");
	});

	it('rejects an archetype that doesn\'t exist', () => {
		expect(() => deal({ unlockedArchetypes: ['road_warrior', 'mutant' as DriverArchetype] }))
			.toThrow('unlockedArchetypes[1] must be one of road_warrior, interceptor, mechanic, raider, got "mutant"');
	});

	it.each([0, 1.5])('rejects a size of %p', (size) => {
		expect(() => deal({ size })).toThrow(`size must be an integer >= 1, got ${size}`);
	});
});
