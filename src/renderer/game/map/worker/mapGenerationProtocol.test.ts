import { AreaMapGeneration, generateAreaMap } from '../AreaMapPipeline';
import * as land from '../Land';
import { MapPipelineError, StageFailure } from '../MapPipeline';
import { Terrain, TerrainSample, createTerrainSample } from '../Terrain';
import { paramsFor } from '../roadTesting';
import { AreaMapTransfer, decodeAreaMap, encodeAreaMap, errorFromReply, failureReply, packRoadNetwork, unpackRoadNetwork } from './mapGenerationProtocol';

/**
 * Every field of a terrain sample, and travel cost, on a 16 by 16 lattice
 * over the land square round the disc: taken before a terrain is sent,
 * since sending detaches its land's arrays.
 */
function landLattice(terrain: Terrain): { sample: TerrainSample; cost: number }[] {
	const reach = 1.2 * terrain.radius;
	const lattice: { sample: TerrainSample; cost: number }[] = [];
	for (let row = 0; row < 16; row += 1) {
		for (let column = 0; column < 16; column += 1) {
			const x = -reach + (2 * reach * (column + 0.5)) / 16;
			const y = -reach + (2 * reach * (row + 0.5)) / 16;
			lattice.push({ sample: terrain.sample(x, y, createTerrainSample()), cost: terrain.travelCost(x, y) });
		}
	}
	return lattice;
}

/** Typed arrays as plain ones, all the way down, so a structured clone, built in Node's outer realm, compares to this realm's. */
function plain(value: unknown): unknown {
	if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
	if (Array.isArray(value)) return value.map(plain);
	if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, plain(entry)]));
	return value;
}

/** The transfer as the worker's postMessage hands it over: cloned, its buffers moved. */
function sent(map: AreaMapGeneration): AreaMapTransfer {
	const { map: transfer, buffers } = encodeAreaMap(map);
	return structuredClone(transfer, { transfer: buffers });
}

describe('the generation worker\'s transfer format', () => {
	const params = paramsFor({ seed: 5, environment: 'floodlands', radius: 700 });
	const map = generateAreaMap({ params });
	const mapLand = landLattice(map.products.terrain);
	const { network } = map.products.growth;

	afterEach(() => {
		jest.restoreAllMocks();
	});

	it('packs every stretch\'s points into one Float64Array and back, exactly', () => {
		const packed = packRoadNetwork(network);
		expect(packed.offsets).toHaveLength(network.stretches.length + 1);
		expect(packed.points).toHaveLength(network.stretches.reduce((sum, { points }) => sum + points.length, 0));
		packed.stretches.forEach((stretch) => expect(stretch).not.toHaveProperty('points'));
		const unpacked = unpackRoadNetwork(packed);
		expect(unpacked).toEqual(network);
		unpacked.stretches.forEach(({ points }, id) => points.forEach((value, index) => expect(Object.is(value, network.stretches[id].points[index])).toBe(true)));
	});

	it('is plain data a structured clone keeps, with the bulk in the buffers it transfers: the network\'s and the land\'s', () => {
		const { map: transfer, buffers } = encodeAreaMap(map);
		const { surface } = map.products.terrain;
		const { drainage } = surface;
		const bulk = [transfer.network.points, transfer.network.offsets, surface.elevation, surface.mountains, drainage.receivers, drainage.levels, drainage.area, drainage.order, drainage.outlets];
		expect(buffers).toHaveLength(bulk.length);
		bulk.forEach(({ buffer }, index) => expect(buffers[index]).toBe(buffer));
		expect(transfer.surface).toBe(surface);
		expect(plain(structuredClone(transfer))).toEqual(plain(transfer));
		expect(transfer).not.toHaveProperty('products');
		expect(transfer.params).toEqual(params);
	});

	it('refuses a terrain with water, which is functions a structured clone can\'t carry', () => {
		const wet = { ...map, products: { ...map.products, terrain: map.products.terrain.withWater({ isWater: () => false }) } };
		expect(() => encodeAreaMap(wet)).toThrow(/water/);
	});

	it('decodes to the map it encoded, the terrain rebuilt over the land it was sent without eroding it again', () => {
		// A map of its own to send, since sending detaches its land; the same as the shared one, from the same seed.
		const own = generateAreaMap({ params });
		const erode = jest.spyOn(land, 'generateLand');
		const decoded = decodeAreaMap(sent(own));
		expect(erode).not.toHaveBeenCalled();
		// Transferred, not copied: the encoded terrain's land is detached.
		expect(own.products.terrain.surface.elevation).toHaveLength(0);
		const { products, ...rest } = decoded;
		const { products: original, ...expected } = own;
		expect(rest).toEqual(expected);
		expect(products.highways).toEqual(original.highways);
		expect(products.growth).toEqual(original.growth);
		expect(plain(products.routeTree)).toEqual(plain(original.routeTree));
		expect(products.pois).toEqual(original.pois);
		expect(landLattice(products.terrain)).toEqual(mapLand);
		expect(Object.isFrozen(products.terrain.surface)).toBe(true);
		expect(Object.isFrozen(products.terrain.surface.drainage)).toBe(true);
	});

	it('decodes the streams that won, after retries and a map restart', () => {
		let growthRejections = 0;
		const retried = generateAreaMap({
			params,
			accept: (_map, { stage, mapAttempt }) => {
				if (stage === 'highways' && mapAttempt === 0) return ['force a map restart'];
				if (stage === 'growth' && growthRejections < 2) {
					growthRejections += 1;
					return ['force a growth rerun'];
				}
				return [];
			},
		});
		expect(retried.mapAttempt).toBe(1);
		expect(retried.attempts).toEqual({ terrain: 0, highways: 0, growth: 2, routeTree: 0, pois: 0 });
		const retriedLand = landLattice(retried.products.terrain);
		const decoded = decodeAreaMap(sent(retried));
		expect(decoded.products.growth).toEqual(retried.products.growth);
		expect(landLattice(decoded.products.terrain)).toEqual(retriedLand);
		// Map attempt 1's terrain, not the first map attempt's.
		expect(decoded.streams.terrain).not.toBe(map.streams.terrain);
	});

	it('carries an error across, keeping a pipeline failure\'s details', () => {
		const failure: StageFailure = { stage: 'growth', index: 2, count: 3, attempt: 7, mapAttempt: 31, seed: 5, problems: ['disc: out'] };
		const reply = failureReply(new MapPipelineError({ message: 'ran out', failure, exhausted: 'map' }));
		expect(reply).toMatchObject({ type: 'failed', message: 'ran out', pipeline: { failure, exhausted: 'map' } });
		const error = errorFromReply(structuredClone(reply) as Extract<typeof reply, { type: 'failed' }>);
		expect(error).toBeInstanceOf(MapPipelineError);
		expect((error as MapPipelineError).failure).toEqual(failure);
		expect((error as MapPipelineError).exhausted).toBe('map');

		const plain = failureReply(new TypeError('broke'));
		expect(plain).toMatchObject({ type: 'failed', message: 'broke', pipeline: null });
		expect(errorFromReply(plain as Extract<typeof plain, { type: 'failed' }>)).not.toBeInstanceOf(MapPipelineError);
		expect(failureReply('a string')).toEqual({ type: 'failed', message: 'a string', stack: null, pipeline: null });
	});
});
