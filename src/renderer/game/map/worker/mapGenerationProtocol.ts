import { Rng } from '../../core/Rng';
import { AreaMapGeneration, AreaMapStageName, TERRAIN_STAGE, generateAreaMap } from '../AreaMapPipeline';
import type { HighwayDeparture } from '../Highways';
import type { MapParams } from '../MapParams';
import { MapPipelineError, StageAttempt, StageFailure } from '../MapPipeline';
import type { GrowthStats } from '../RoadGrowth';
import type { Road, RoadNetwork, RoadNode, RoadStretch } from '../RoadNetwork';

/**
 * What crosses between the generation worker and its client, and how a map
 * is packed for the crossing. The worker shell and the client's in-process
 * fallback both run `generateTransfer`, so the two paths make the same map
 * and a test of the fallback covers the format the worker sends.
 */

/** The one message a worker gets. The seed is the params'. */
export interface GenerateRequest {
	/** Resolved and validated. */
	readonly params: MapParams;
}

export type WorkerReply =
	| { readonly type: 'progress'; readonly progress: StageAttempt<AreaMapStageName> }
	| { readonly type: 'done'; readonly map: AreaMapTransfer }
	| {
		readonly type: 'failed';
		readonly message: string;
		readonly stack: string | null;
		/** A MapPipelineError's details, so the client throws one again. */
		readonly pipeline: { readonly failure: StageFailure; readonly exhausted: MapPipelineError['exhausted'] } | null;
	};

/** A stretch without its points, which travel packed. */
export type PackedStretch = Omit<RoadStretch, 'points'>;

/**
 * A road network with every stretch's points end to end in one
 * Float64Array, so the bulk of the map transfers instead of being cloned.
 * Float64, so every coordinate arrives exactly as it was generated.
 */
export interface PackedRoadNetwork {
	readonly nodes: readonly RoadNode[];
	readonly roads: readonly Road[];
	readonly stretches: readonly PackedStretch[];
	readonly points: Float64Array;
	/** Stretch i's points run from offsets[i] up to offsets[i + 1]. */
	readonly offsets: Uint32Array;
}

/**
 * An `AreaMapGeneration` as plain data. The terrain isn't sent: today it's
 * analytic fields a client rebuilds from its winning stream in about 2 ms,
 * which is cheaper than any encoding of it. A gridded terrain would send its
 * grids here as typed arrays instead.
 */
export interface AreaMapTransfer extends Omit<AreaMapGeneration, 'products'> {
	readonly highways: readonly HighwayDeparture[];
	readonly growthStats: GrowthStats;
	readonly network: PackedRoadNetwork;
}

export function packRoadNetwork(network: RoadNetwork): PackedRoadNetwork {
	const offsets = new Uint32Array(network.stretches.length + 1);
	network.stretches.forEach((stretch, id) => {
		offsets[id + 1] = offsets[id] + stretch.points.length;
	});
	const points = new Float64Array(offsets[network.stretches.length]);
	const stretches = network.stretches.map(({ points: line, ...stretch }, id) => {
		points.set(line, offsets[id]);
		return stretch;
	});
	return { nodes: network.nodes, roads: network.roads, stretches, points, offsets };
}

export function unpackRoadNetwork({ nodes, roads, stretches, points, offsets }: PackedRoadNetwork): RoadNetwork {
	return {
		nodes,
		roads,
		stretches: stretches.map((stretch, id) => ({ ...stretch, points: Array.from(points.subarray(offsets[id], offsets[id + 1])) })),
	};
}

/** The map as plain data, and the buffers to transfer with it. */
export function encodeAreaMap({ products, ...map }: AreaMapGeneration): { map: AreaMapTransfer; buffers: ArrayBuffer[] } {
	const network = packRoadNetwork(products.growth.network);
	return {
		map: { ...map, highways: products.highways, growthStats: products.growth.stats, network },
		buffers: [network.points.buffer as ArrayBuffer, network.offsets.buffer as ArrayBuffer],
	};
}

/** The map back, its terrain rebuilt by the terrain stage itself on its winning stream. */
export function decodeAreaMap({ highways, growthStats, network, ...map }: AreaMapTransfer): AreaMapGeneration {
	const terrain = TERRAIN_STAGE.run({ input: map.params, products: {}, rng: new Rng({ seed: map.streams.terrain }) });
	return { ...map, products: { terrain, highways, growth: { network: unpackRoadNetwork(network), stats: growthStats } } };
}

/** One request's generation, packed for the reply. */
export function generateTransfer({ params, onProgress }: GenerateRequest & { onProgress?: (progress: StageAttempt<AreaMapStageName>) => void }): { map: AreaMapTransfer; buffers: ArrayBuffer[] } {
	return encodeAreaMap(generateAreaMap({ params, onProgress }));
}

/** A thrown error as a reply, keeping a pipeline failure's details. */
export function failureReply(error: unknown): WorkerReply {
	const pipeline = error instanceof MapPipelineError ? { failure: error.failure, exhausted: error.exhausted } : null;
	if (error instanceof Error) return { type: 'failed', message: error.message, stack: error.stack ?? null, pipeline };
	return { type: 'failed', message: String(error), stack: null, pipeline };
}

/** A failed reply as an error again on the client's side: a MapPipelineError when the pipeline gave up. */
export function errorFromReply({ message, stack, pipeline }: Extract<WorkerReply, { type: 'failed' }>): Error {
	const error = pipeline ? new MapPipelineError({ message, ...pipeline }) : new Error(message);
	if (stack) error.stack = stack;
	return error;
}
