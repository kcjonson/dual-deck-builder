import { AreaMapGeneration, generateAreaMap } from '../AreaMapPipeline';
import * as drainage from '../Drainage';
import * as land from '../Land';
import { MapPipelineError, StageFailure } from '../MapPipeline';
import { meshMap, randomMesh } from '../meshTesting';
import { describeMap } from '../RouteDescriptors';
import { rollStop } from '../Stops';
import { Terrain, TerrainSample, WaterKind, createTerrainSample } from '../Terrain';
import { paramsFor } from '../roadTesting';
import { AreaMapTransfer, decodeAreaMap, encodeAreaMap, errorFromReply, failureReply, packRoadNetwork, unpackRoadNetwork } from './mapGenerationProtocol';

interface LatticePoint {
	readonly sample: TerrainSample;
	readonly water: WaterKind | null;
	/** A back road's cost to move about a land cell east from the point. */
	readonly cost: number;
}

/**
 * Every field of a terrain sample, the water there, and a move's cost, on a
 * 16 by 16 lattice over the land square round the disc: taken before a
 * terrain is sent, since sending detaches its land's and water's arrays.
 */
function landLattice(terrain: Terrain): LatticePoint[] {
	const reach = 1.2 * terrain.radius;
	const lattice: LatticePoint[] = [];
	for (let row = 0; row < 16; row += 1) {
		for (let column = 0; column < 16; column += 1) {
			const x = -reach + (2 * reach * (column + 0.5)) / 16;
			const y = -reach + (2 * reach * (row + 0.5)) / 16;
			lattice.push({ sample: terrain.sample(x, y, createTerrainSample()), water: terrain.waterAt(x, y), cost: terrain.moveCost(x, y, x + 9, y, 'backRoad') });
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
	// Floodlands, so the water stage has rivers, reservoirs, and wet ground to send.
	const params = paramsFor({ seed: 5, environment: 'floodlands', radius: 700 });
	const map = generateAreaMap({ params });
	const mapLand = landLattice(map.products.water.terrain);
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

	it('is plain data a structured clone keeps, with the bulk in the buffers it transfers: the network\'s, the land\'s, and the water\'s', () => {
		const { map: transfer, buffers } = encodeAreaMap(map);
		const { surface } = map.products.terrain;
		const { drainage: routing } = surface;
		const wet = map.products.water.surface;
		const bulk = [
			transfer.network.points, transfer.network.offsets,
			surface.elevation, surface.mountains, routing.receivers, routing.levels, routing.area, routing.order, routing.outlets, map.products.terrain.badlandsCells,
			wet.receivers, wet.area, wet.moisture, wet.lowland, wet.canyons, wet.lakeDepth, wet.lakeOf, wet.lines.points, wet.lines.widths, wet.lines.offsets,
		];
		expect(buffers).toHaveLength(bulk.length);
		bulk.forEach(({ buffer }, index) => expect(buffers[index]).toBe(buffer));
		expect(transfer.surface).toBe(surface);
		expect(transfer.badlands).toBe(map.products.terrain.badlandsCells);
		expect(transfer.water).toBe(wet);
		expect(wet.lakes.length).toBeGreaterThan(0);
		expect(plain(structuredClone(transfer))).toEqual(plain(transfer));
		expect(transfer).not.toHaveProperty('products');
		expect(transfer.params).toEqual(params);
	});

	it('decodes to the map it encoded, the terrain and its water rebuilt over what was sent without eroding or routing again', () => {
		// A map of its own to send, since sending detaches its arrays; the same as the shared one, from the same seed.
		const own = generateAreaMap({ params });
		const erode = jest.spyOn(land, 'generateLand');
		const route = jest.spyOn(drainage, 'routeDrainage');
		const decoded = decodeAreaMap(sent(own));
		expect(erode).not.toHaveBeenCalled();
		expect(route).not.toHaveBeenCalled();
		// Transferred, not copied: the encoded terrain's land and water are detached.
		expect(own.products.terrain.surface.elevation).toHaveLength(0);
		expect(own.products.water.surface.moisture).toHaveLength(0);
		const { products, ...rest } = decoded;
		const { products: original, ...expected } = own;
		expect(rest).toEqual(expected);
		expect(products.highways).toEqual(original.highways);
		expect(products.growth).toEqual(original.growth);
		expect(plain(products.routeTree)).toEqual(plain(original.routeTree));
		expect(products.pois).toEqual(original.pois);
		expect(products.stops).toEqual(original.stops);
		expect(products.water.rivers).toEqual(map.products.water.rivers);
		expect(products.water.lakes).toEqual(map.products.water.lakes);
		expect(products.water.terrain.water).toBe(products.water);
		expect(landLattice(products.water.terrain)).toEqual(mapLand);
		expect(Object.isFrozen(products.terrain.surface)).toBe(true);
		expect(Object.isFrozen(products.terrain.surface.drainage)).toBe(true);
		expect(Object.isFrozen(products.water.surface)).toBe(true);
		expect(Object.isFrozen(products.water.surface.lines)).toBe(true);
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
		expect(retried.attempts).toEqual({ terrain: 0, water: 0, highways: 0, growth: 2, routeTree: 0, pois: 0, stops: 0 });
		const retriedLand = landLattice(retried.products.water.terrain);
		const decoded = decodeAreaMap(sent(retried));
		expect(decoded.products.growth).toEqual(retried.products.growth);
		expect(landLattice(decoded.products.water.terrain)).toEqual(retriedLand);
		// Map attempt 1's terrain, not the first map attempt's.
		expect(decoded.streams.terrain).not.toBe(map.streams.terrain);
	});

	it('carries the POIs and their stops across as they are, so routes and stop contents come out the same on the other side', () => {
		// Real maps have no POIs until the road graph (Map 8), so a mesh's stand in for them.
		const mesh = meshMap(randomMesh({ seed: 41 }), { seed: 3 });
		const own = generateAreaMap({ params });
		const withStops = { ...own, products: { ...own.products, pois: mesh.products.pois, stops: mesh.products.stops } };
		expect(mesh.products.stops.stops.length).toBeGreaterThan(0);
		const { products } = decodeAreaMap(sent(withStops));
		expect(products.pois).toEqual(mesh.products.pois);
		expect(products.stops).toEqual(mesh.products.stops);
		const decoded = { params: { ...params, daylightHours: 14, stopDensity: 1 }, products };
		expect(describeMap(decoded)).toEqual(describeMap({ ...decoded, products: mesh.products }));
		expect(rollStop({ products }, 5, 2)).toEqual(rollStop(mesh, 5, 2));
	});

	it('carries an error across, keeping a pipeline failure\'s details', () => {
		const failure: StageFailure = { stage: 'growth', index: 3, count: 4, attempt: 7, mapAttempt: 31, seed: 5, problems: ['disc: out'] };
		const reply = failureReply(new MapPipelineError({ message: 'ran out', failure, exhausted: 'map' }));
		expect(reply).toMatchObject({ type: 'failed', message: 'ran out', pipeline: { failure, exhausted: 'map' } });
		const error = errorFromReply(structuredClone(reply) as Extract<typeof reply, { type: 'failed' }>);
		expect(error).toBeInstanceOf(MapPipelineError);
		expect((error as MapPipelineError).failure).toEqual(failure);
		expect((error as MapPipelineError).exhausted).toBe('map');

		const plainError = failureReply(new TypeError('broke'));
		expect(plainError).toMatchObject({ type: 'failed', message: 'broke', pipeline: null });
		expect(errorFromReply(plainError as Extract<typeof plainError, { type: 'failed' }>)).not.toBeInstanceOf(MapPipelineError);
		expect(failureReply('a string')).toEqual({ type: 'failed', message: 'a string', stack: null, pipeline: null });
	});
});
