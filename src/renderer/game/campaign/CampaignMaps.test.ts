import { AreaMapGeneration, areaMapPipeline } from '../map/AreaMapPipeline';
import { AREA_MAP_GENERATOR_VERSION } from '../map/GeneratorVersion';
import { MapGenerationCancelled } from '../map/worker/MapGeneration';
import { encodeAreaMap } from '../map/worker/mapGenerationProtocol';
import type { DriverArchetype } from '../mechanics/Driver';
import { CAMPAIGN_SCHEMA_VERSION, Campaign } from './Campaign';
import { CampaignFounding, FoundedCampaign } from './CampaignFounding';
import { AreaMapProgress, CampaignMapGeneration, CampaignMaps, CampaignMapsOptions } from './CampaignMaps';
import { CampaignStore } from './CampaignStore';
import { MemorySaveStorage } from './SaveStorage';
import { foundTestCampaign, stubResult } from './__fixtures__/mapFixtures';

const SEED = 20261011;
const ARCHETYPES: readonly DriverArchetype[] = ['road_warrior', 'interceptor', 'mechanic', 'raider'];
/** Generating a real map takes about a second in Node, and more with coverage on. */
const GENERATING = 60_000;

/** FNV-1a over a value: typed arrays by their bytes, objects by sorted key, everything else as JSON. */
function hashOf(value: unknown): string {
	let hash = 0x811c9dc5;
	const feed = (byte: number): void => {
		hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
	};
	const text = (chunk: string): void => {
		for (let index = 0; index < chunk.length; index += 1) {
			const code = chunk.charCodeAt(index);
			feed(code & 0xff);
			feed(code >>> 8);
		}
	};
	const walk = (node: unknown): void => {
		if (ArrayBuffer.isView(node)) {
			text(`<${node.constructor.name} ${node.byteLength}>`);
			new Uint8Array(node.buffer, node.byteOffset, node.byteLength).forEach(feed);
		} else if (Array.isArray(node)) {
			text('[');
			node.forEach(walk);
			text(']');
		} else if (typeof node === 'object' && node !== null) {
			text('{');
			for (const key of Object.keys(node).sort()) {
				text(key);
				walk((node as Record<string, unknown>)[key]);
			}
			text('}');
		} else {
			text(String(JSON.stringify(node)));
		}
	};
	walk(value);
	return hash.toString(16).padStart(8, '0');
}

/**
 * A map's hashes, over what crosses the worker boundary: the road network,
 * the land (elevation, mountains, drainage), the water, and everything else
 * the map holds. Timings, failures, and where it ran differ between a
 * founding and a replay, and say nothing about the map.
 */
function fingerprint(map: AreaMapGeneration): Record<string, string> {
	const { network, surface, water, badlands, ...rest } = encodeAreaMap(map).map;
	const howItRan = ['timings', 'milliseconds', 'failures', 'keptFailing', 'inWorker', 'wallMilliseconds', 'decodeMilliseconds'];
	return {
		roads: hashOf(network),
		terrain: hashOf(surface),
		badlands: hashOf(badlands),
		water: hashOf(water),
		everything: hashOf(Object.fromEntries(Object.entries(rest).filter(([key]) => !howItRan.includes(key)))),
	};
}

/** A generation a test resolves, fails, or watches being cancelled. */
class HeldGeneration implements CampaignMapGeneration {
	public readonly result: Promise<AreaMapGeneration>;
	public cancelled = 0;
	public resolve: (map: AreaMapGeneration) => void = () => undefined;
	public reject: (error: unknown) => void = () => undefined;

	constructor() {
		this.result = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
		this.result.catch(() => undefined);
	}

	public cancel(): void {
		this.cancelled += 1;
		this.reject(new MapGenerationCancelled());
	}
}

/** A cache whose generations the test holds, with what each was asked for. */
function held() {
	const generations: HeldGeneration[] = [];
	const asked: Parameters<NonNullable<CampaignMapsOptions['generate']>>[0][] = [];
	const maps = new CampaignMaps({
		generate: (options) => {
			asked.push(options);
			const generation = new HeldGeneration();
			generations.push(generation);
			return generation;
		},
	});
	return { maps, generations, asked };
}

const founded = (seed = SEED): Campaign => foundTestCampaign({ seed, unlockedArchetypes: ARCHETYPES });
const reloaded = (campaign: Campaign): Campaign => Campaign.fromJSON(JSON.parse(campaign.toSaveText()));

function outcome<T>(promise: Promise<T>): Promise<T | unknown> {
	return promise.then((value) => value, (error: unknown) => error);
}

describe('CampaignMaps', () => {
	describe('a founded campaign, saved and loaded', () => {
		let founding: FoundedCampaign;
		let loaded: Campaign;
		let saveText: string;

		beforeAll(async () => {
			founding = await new CampaignFounding({ seed: SEED, unlockedArchetypes: ARCHETYPES }).result;
			const storage = new MemorySaveStorage();
			await new CampaignStore({ storage, namespace: 'test' }).save(founding.campaign);
			const texts = await Promise.all(storage.keys.map((key) => storage.getItem(key)));
			saveText = texts.find((text) => text?.includes('"campaign"')) ?? '';
			// A store of its own, as a new session would have.
			loaded = (await new CampaignStore({ storage, namespace: 'test' }).load()) as Campaign;
		}, GENERATING);

		it('saves at the new version, keeping the seed, the params, and every attempt the map needs, and not the map', () => {
			const { campaign, map } = founding;
			expect(saveText.startsWith(`{"version":${CAMPAIGN_SCHEMA_VERSION},`)).toBe(true);
			const saved = JSON.parse(saveText).campaign;
			expect(saved.mapAttempts).toEqual({ map: map.mapAttempt, stages: map.attempts });
			expect(saved.map).toEqual({});
			expect(saved.generatorVersion).toBe(AREA_MAP_GENERATOR_VERSION);
			expect(loaded.seed).toBe(campaign.seed);
			expect(loaded.mapParams).toEqual(campaign.mapParams);
			expect(loaded.mapAttempts).toEqual(campaign.mapAttempts);
			expect(loaded).not.toBe(campaign);
		});

		it('makes the loaded campaign\'s map again, the very map founding made: the same roads, land, and water, hash for hash', async () => {
			const maps = new CampaignMaps();
			const progress: AreaMapProgress[] = [];
			const map = await maps.mapOf(loaded, { onProgress: (attempt) => progress.push(attempt) });
			expect(map).not.toBe(founding.map);
			expect(fingerprint(map)).toEqual(fingerprint(founding.map));
			// One value of the land moved moves its hash.
			const elevation = founding.map.products.terrain.surface.elevation.slice();
			elevation[elevation.length >> 1] += 1;
			expect(hashOf({ ...founding.map.products.terrain.surface, elevation })).not.toBe(fingerprint(founding.map).terrain);
			expect(map.streams).toEqual(founding.map.streams);
			expect({ mapAttempt: map.mapAttempt, attempts: map.attempts }).toEqual({ mapAttempt: founding.map.mapAttempt, attempts: founding.map.attempts });
			expect(map.failures).toEqual([]);
			// Each stage once, on the attempt that won it.
			expect(progress.map(({ stage, attempt }) => [stage, attempt])).toEqual(Object.entries(founding.map.attempts));
			// Kept for the session.
			expect(await maps.mapOf(loaded)).toBe(map);
		}, GENERATING);

		it('keeps the map founding made, so a founded campaign, or that campaign loaded, never makes it again', async () => {
			const { maps, asked } = held();
			maps.remember(founding.campaign, founding.map);
			expect(await maps.mapOf(founding.campaign)).toBe(founding.map);
			expect(await maps.mapOf(loaded)).toBe(founding.map);
			expect(asked).toEqual([]);
		});
	});

	it('asks the generation to replay the campaign\'s attempts on its params', () => {
		const { maps, asked } = held();
		const campaign = reloaded(founded());
		maps.prepare(campaign);
		expect(asked).toEqual([{ params: campaign.mapParams, replay: { mapAttempt: 0, attempts: campaign.mapAttempts?.stages }, onProgress: expect.any(Function) }]);
	});

	it('makes a map once, however many ask while it\'s being made, from any instance of the campaign', async () => {
		const { maps, generations } = held();
		const campaign = founded();
		maps.prepare(campaign);
		const waiting = [maps.mapOf(campaign), maps.mapOf(reloaded(campaign))];
		expect(generations).toHaveLength(1);
		const map = stubResult(campaign.mapParams);
		generations[0].resolve(map);
		expect(await Promise.all(waiting)).toEqual([map, map]);
		expect(await maps.mapOf(campaign)).toBe(map);
		expect(generations).toHaveLength(1);
	});

	it('passes the generation\'s progress to everyone waiting, and stops once the map is made', async () => {
		const asked: Parameters<NonNullable<CampaignMapsOptions['generate']>>[0][] = [];
		const generation = new HeldGeneration();
		const maps = new CampaignMaps({ generate: (options) => (asked.push(options), generation) });
		const campaign = founded();
		const heard: string[] = [];
		const waiting = maps.mapOf(campaign, { onProgress: ({ stage }) => heard.push(`a ${stage}`) });
		void maps.mapOf(campaign, { onProgress: ({ stage }) => heard.push(`b ${stage}`) });
		const tell = (stage: string): void => asked[0].onProgress?.({ stage: stage as 'terrain', index: 0, count: 4, attempt: 0, mapAttempt: 0, seed: SEED });
		tell('terrain');
		generation.resolve(stubResult(campaign.mapParams));
		await waiting;
		tell('water');
		expect(heard).toEqual(['a terrain', 'b terrain']);
	});

	describe('a caller\'s signal', () => {
		it('stops that caller waiting and hearing progress when it aborts, and nobody else: the map goes on, and is kept', async () => {
			const asked: Parameters<NonNullable<CampaignMapsOptions['generate']>>[0][] = [];
			const generation = new HeldGeneration();
			const maps = new CampaignMaps({ generate: (options) => (asked.push(options), generation) });
			const campaign = founded();
			const heard: string[] = [];
			const hear = (who: string) => ({ stage }: AreaMapProgress): void => {
				heard.push(`${who} ${stage}`);
			};
			const leaving = new AbortController();
			const staying = new AbortController();
			// The same function from two callers, so detaching one can't detach the other.
			const shared = hear('shared');
			const waits = {
				leaving: maps.mapOf(campaign, { onProgress: hear('leaving'), signal: leaving.signal }),
				staying: maps.mapOf(campaign, { onProgress: hear('staying'), signal: staying.signal }),
				sharedLeaving: maps.mapOf(campaign, { onProgress: shared, signal: leaving.signal }),
				sharedStaying: maps.mapOf(campaign, { onProgress: shared }),
			};
			const tell = (stage: AreaMapProgress['stage']): void => asked[0].onProgress?.({ stage, index: 0, count: 6, attempt: 0, mapAttempt: 0, seed: SEED });
			tell('terrain');
			leaving.abort();
			const error = await outcome(waits.leaving);
			expect(error).toBeInstanceOf(DOMException);
			expect((error as DOMException).name).toBe('AbortError');
			expect(error).toBe(leaving.signal.reason);
			expect(await outcome(waits.sharedLeaving)).toBe(leaving.signal.reason);
			tell('water');
			expect(heard).toEqual(['leaving terrain', 'staying terrain', 'shared terrain', 'shared terrain', 'staying water', 'shared water']);
			expect(generation.cancelled).toBe(0);

			const map = stubResult(campaign.mapParams);
			generation.resolve(map);
			expect(await waits.staying).toBe(map);
			expect(await waits.sharedStaying).toBe(map);
			// Aborting once the map is made changes nothing, and the map is kept for the next to ask.
			staying.abort();
			tell('growth');
			expect(heard).toHaveLength(6);
			expect(await maps.mapOf(campaign, { signal: new AbortController().signal })).toBe(map);
			expect(asked).toHaveLength(1);
		});

		it('rejects at once when it has already aborted, with the reason the caller gave, starting nothing', async () => {
			const { maps, asked } = held();
			const controller = new AbortController();
			const reason = new Error('the area map screen closed');
			controller.abort(reason);
			expect(await outcome(maps.mapOf(founded(), { signal: controller.signal }))).toBe(reason);
			expect(asked).toEqual([]);
		});

		it('still hears a failure before it aborts', async () => {
			const { maps, generations } = held();
			const waiting = maps.mapOf(founded(), { signal: new AbortController().signal });
			generations[0].reject(new Error('worker failed'));
			expect(await outcome(waiting)).toEqual(new Error('worker failed'));
		});
	});

	it('keeps one campaign\'s map: asking for another\'s cancels the one being made and drops the one kept', async () => {
		const { maps, generations } = held();
		const first = founded(SEED);
		const second = founded(SEED + 1);
		const abandoned = maps.mapOf(first);
		const wanted = maps.mapOf(second);
		expect(generations[0].cancelled).toBe(1);
		expect(await outcome(abandoned)).toBeInstanceOf(MapGenerationCancelled);
		generations[1].resolve(stubResult(second.mapParams));
		await wanted;
		maps.remember(first, stubResult(first.mapParams));
		void maps.mapOf(second);
		expect(generations).toHaveLength(3);
	});

	it('keeps no failure, so asking again tries again', async () => {
		const { maps, generations } = held();
		const campaign = founded();
		const failing = maps.mapOf(campaign);
		generations[0].reject(new Error('worker failed'));
		expect(await outcome(failing)).toEqual(new Error('worker failed'));
		const retried = maps.mapOf(campaign);
		expect(generations).toHaveLength(2);
		generations[1].resolve(stubResult(campaign.mapParams));
		expect(await retried).toEqual(stubResult(campaign.mapParams));
	});

	it('forgets the kept map on asking, cancelling one being made', () => {
		const { maps, generations } = held();
		maps.prepare(founded());
		maps.forget();
		expect(generations[0].cancelled).toBe(1);
		maps.forget();
		expect(generations[0].cancelled).toBe(1);
	});

	it('refuses, generating nothing, a campaign without map attempts or with a map another generator version made', async () => {
		const { maps, asked } = held();
		const campaign = founded();
		const mapless = new Campaign({ seed: SEED, generatorVersion: AREA_MAP_GENERATOR_VERSION, mapParams: campaign.mapParams });
		const older = new Campaign({ seed: SEED, generatorVersion: 1, mapParams: campaign.mapParams, mapAttempts: campaign.mapAttempts });
		expect(await outcome(maps.mapOf(mapless))).toEqual(new Error('CampaignMaps: the campaign has no map attempts, so it has no map to make again'));
		expect(await outcome(maps.mapOf(older)))
			.toEqual(new Error(`CampaignMaps: this save's map is from an older build (generator version 1; this build makes version ${AREA_MAP_GENERATOR_VERSION})`));
		maps.prepare(older);
		expect(asked).toEqual([]);
	});

	// A save names the stages (mapAttempts.stages), and one made before a stage was added, removed, or renamed can't replay.
	it('pins the pipeline\'s stages to the generator version', () => {
		const pinned = { generatorVersion: AREA_MAP_GENERATOR_VERSION, stages: areaMapPipeline().stageNames };
		try {
			expect(pinned).toEqual({ generatorVersion: 5, stages: ['terrain', 'water', 'hazards', 'places', 'growth', 'routeTree', 'pois', 'stops'] });
		} catch (error) {
			throw new Error(`the pipeline's stages changed: bump AREA_MAP_GENERATOR_VERSION (map/GeneratorVersion.ts), so the store reads older saves as outdated, and re-pin\n${(error as Error).message}`);
		}
	});

	it('rejects attempts the pipeline can\'t replay, in the generation, where the pipeline is', async () => {
		const campaign = founded();
		const stranger = new Campaign({ seed: SEED, generatorVersion: AREA_MAP_GENERATOR_VERSION, mapParams: campaign.mapParams, mapAttempts: { map: 0, stages: { terrain: 0, rivers: 0 } } });
		const error = await outcome(new CampaignMaps().mapOf(stranger));
		expect(error).toBeInstanceOf(RangeError);
		expect((error as Error).message).toMatch(/^MapPipeline: can't replay an attempt for rivers/);
	});
});
