import { AreaMapGeneration, generateAreaMap } from '../AreaMapPipeline';
import { MapPipelineError, StageFailure } from '../MapPipeline';
import { Terrain, createTerrainSample } from '../Terrain';
import { paramsFor } from '../roadTesting';
import { AreaMapTransfer, decodeAreaMap, encodeAreaMap, errorFromReply, failureReply, packRoadNetwork, unpackRoadNetwork } from './mapGenerationProtocol';

/** Every field of a terrain sample, and travel cost, on a 16 by 16 lattice over the land square round the disc. */
function expectSameLand(actual: Terrain, expected: Terrain): void {
	const got = createTerrainSample();
	const want = createTerrainSample();
	const reach = 1.2 * expected.radius;
	for (let row = 0; row < 16; row += 1) {
		for (let column = 0; column < 16; column += 1) {
			const x = -reach + (2 * reach * (column + 0.5)) / 16;
			const y = -reach + (2 * reach * (row + 0.5)) / 16;
			actual.sample(x, y, got);
			expected.sample(x, y, want);
			expect(got).toEqual(want);
			expect(Object.is(actual.travelCost(x, y), expected.travelCost(x, y))).toBe(true);
		}
	}
}

/** The transfer as the worker's postMessage hands it over: cloned, its buffers moved. */
function sent(map: AreaMapGeneration): AreaMapTransfer {
	const { map: transfer, buffers } = encodeAreaMap(map);
	return structuredClone(transfer, { transfer: buffers });
}

describe('the generation worker\'s transfer format', () => {
	const params = paramsFor({ seed: 5, environment: 'floodlands', radius: 700 });
	const map = generateAreaMap({ params });
	const { network } = map.products.growth;

	it('packs every stretch\'s points into one Float64Array and back, exactly', () => {
		const packed = packRoadNetwork(network);
		expect(packed.offsets).toHaveLength(network.stretches.length + 1);
		expect(packed.points).toHaveLength(network.stretches.reduce((sum, { points }) => sum + points.length, 0));
		packed.stretches.forEach((stretch) => expect(stretch).not.toHaveProperty('points'));
		const unpacked = unpackRoadNetwork(packed);
		expect(unpacked).toEqual(network);
		unpacked.stretches.forEach(({ points }, id) => points.forEach((value, index) => expect(Object.is(value, network.stretches[id].points[index])).toBe(true)));
	});

	it('is plain data a structured clone keeps, with the bulk in the buffers it transfers', () => {
		const { map: transfer, buffers } = encodeAreaMap(map);
		expect(buffers).toHaveLength(2);
		expect(buffers[0]).toBe(transfer.network.points.buffer);
		expect(buffers[1]).toBe(transfer.network.offsets.buffer);
		// Jest's structuredClone builds in Node's outer realm, whose typed arrays toEqual won't match to this realm's.
		const { network: clonedNetwork, ...cloned } = structuredClone(transfer);
		const { network: sentNetwork, ...rest } = transfer;
		expect(cloned).toEqual(rest);
		expect({ ...clonedNetwork, points: Array.from(clonedNetwork.points), offsets: Array.from(clonedNetwork.offsets) })
			.toEqual({ ...sentNetwork, points: Array.from(sentNetwork.points), offsets: Array.from(sentNetwork.offsets) });
		expect(transfer).not.toHaveProperty('products');
		expect(transfer.params).toEqual(params);
	});

	it('decodes to the map it encoded, the terrain rebuilt by the terrain stage on its winning stream', () => {
		const decoded = decodeAreaMap(sent(map));
		const { products, ...rest } = decoded;
		const { products: original, ...expected } = map;
		expect(rest).toEqual(expected);
		expect(products.highways).toEqual(original.highways);
		expect(products.growth).toEqual(original.growth);
		expectSameLand(products.terrain, original.terrain);
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
		expect(retried.attempts).toEqual({ terrain: 0, highways: 0, growth: 2 });
		const decoded = decodeAreaMap(sent(retried));
		expect(decoded.products.growth).toEqual(retried.products.growth);
		expectSameLand(decoded.products.terrain, retried.products.terrain);
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
