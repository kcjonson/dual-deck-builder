import { generateAreaMap } from '../AreaMapPipeline';
import { MapPipelineError, StageFailure } from '../MapPipeline';
import { createTerrainSample } from '../Terrain';
import { paramsFor } from '../roadTesting';
import { decodeAreaMap, encodeAreaMap, errorFromReply, failureReply, packRoadNetwork, unpackRoadNetwork } from './mapGenerationProtocol';

describe('the generation worker\'s transfer format', () => {
	const params = paramsFor({ seed: 5, environment: 'floodlands', radius: 700 });
	const map = generateAreaMap({ params });
	const { network } = map.products.growth;

	it('packs every stretch\'s points into one Float64Array and back, exactly', () => {
		const packed = packRoadNetwork(network);
		expect(packed.offsets).toHaveLength(network.stretches.length + 1);
		expect(packed.points).toHaveLength(network.stretches.reduce((sum, { points }) => sum + points.length, 0));
		packed.stretches.forEach((stretch) => expect(stretch).not.toHaveProperty('points'));
		expect(unpackRoadNetwork(packed)).toEqual(network);
	});

	it('is plain data a structured clone keeps, with the bulk in the buffers it transfers', () => {
		const { map: transfer, buffers } = encodeAreaMap(map);
		expect(buffers).toHaveLength(2);
		expect(buffers[0]).toBe(transfer.network.points.buffer);
		expect(buffers[1]).toBe(transfer.network.offsets.buffer);
		// Jest's structuredClone builds in Node's outer realm, whose typed arrays toEqual won't match to this realm's.
		const { network: clonedNetwork, ...cloned } = structuredClone(transfer);
		const { network: sentNetwork, ...sent } = transfer;
		expect(cloned).toEqual(sent);
		expect({ ...clonedNetwork, points: Array.from(clonedNetwork.points), offsets: Array.from(clonedNetwork.offsets) })
			.toEqual({ ...sentNetwork, points: Array.from(sentNetwork.points), offsets: Array.from(sentNetwork.offsets) });
		expect(transfer).not.toHaveProperty('products');
		expect(transfer.params).toEqual(params);
	});

	it('decodes to the map it encoded, the terrain rebuilt from its winning stream', () => {
		const decoded = decodeAreaMap(structuredClone(encodeAreaMap(map).map));
		const { products, ...rest } = decoded;
		const { products: original, ...expected } = map;
		expect(rest).toEqual(expected);
		expect(products.highways).toEqual(original.highways);
		expect(products.growth).toEqual(original.growth);
		const sample = createTerrainSample();
		const want = createTerrainSample();
		for (const [x, y] of [[0, 0], [250, 300], [-410, -90], [120, -600]]) {
			products.terrain.sample(x, y, sample);
			original.terrain.sample(x, y, want);
			expect(sample).toEqual(want);
		}
	});

	it('carries an error across, keeping a pipeline failure\'s details', () => {
		const failure: StageFailure = { stage: 'growth', index: 2, count: 3, attempt: 7, mapAttempt: 31, seed: 5, problems: ['disc: out'] };
		const reply = failureReply(new MapPipelineError({ message: 'ran out', failure }));
		expect(reply).toMatchObject({ type: 'failed', message: 'ran out', failure });
		const error = errorFromReply(structuredClone(reply) as Extract<typeof reply, { type: 'failed' }>);
		expect(error).toBeInstanceOf(MapPipelineError);
		expect((error as MapPipelineError).failure).toEqual(failure);

		const plain = failureReply(new TypeError('broke'));
		expect(plain).toMatchObject({ type: 'failed', message: 'broke', failure: null });
		expect(errorFromReply(plain as Extract<typeof plain, { type: 'failed' }>)).not.toBeInstanceOf(MapPipelineError);
		expect(failureReply('a string')).toEqual({ type: 'failed', message: 'a string', stack: null, failure: null });
	});
});
