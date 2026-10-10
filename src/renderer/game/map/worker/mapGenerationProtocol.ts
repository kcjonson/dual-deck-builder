import { Rng } from '../../core/Rng';
import { AreaMapGeneration, AreaMapStageName, generateAreaMap } from '../AreaMapPipeline';
import { Hazards } from '../Hazards';
import { LandSurface, freezeSurface } from '../Land';
import type { MapParams } from '../MapParams';
import { MapPipelineError, StageAttempt, StageFailure } from '../MapPipeline';
import { Places, freezePlaces } from '../Places';
import type { GrowthStats } from '../RoadGrowth';
import type { Road, RoadNetwork, RoadNode, RoadStretch } from '../RoadNetwork';
import { terrainFromSurface } from '../Terrain';
import type { Hotspot } from '../TerrainSites';
import { WaterSurface, waterFromSurface } from '../Water';

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
 * An `AreaMapGeneration` as plain data. The terrain travels as its eroded
 * land and its badlands, and the water as its surface, whose arrays
 * transfer; the client rebuilds the rest of the terrain from the land on the
 * winning terrain stream, and the water's river index from its lines, which
 * costs a small part of the erosion and routing they save. The hazards
 * travel as their hotspots and the places as they are, both small.
 */
export interface AreaMapTransfer extends Omit<AreaMapGeneration, 'products'> {
	readonly surface: LandSurface;
	readonly badlands: Float32Array;
	readonly water: WaterSurface;
	readonly hotspots: readonly Hotspot[];
	readonly places: Places;
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

/**
 * The map as plain data, and the buffers to transfer with it: the network's
 * two, the land's seven, the badlands, and the water's ten. Transferring
 * detaches those arrays from the terrain and water that were encoded, so
 * encode once nothing reads them again; the worker does, as its last act
 * before it's terminated.
 */
export function encodeAreaMap({ products, ...map }: AreaMapGeneration): { map: AreaMapTransfer; buffers: ArrayBuffer[] } {
	const { terrain, water, hazards, places, growth } = products;
	const { surface } = terrain;
	const network = packRoadNetwork(growth.network);
	const { elevation, mountains, drainage } = surface;
	const badlands = terrain.badlandsCells;
	const wet = water.surface;
	const arrays = [
		network.points, network.offsets,
		elevation, mountains, drainage.receivers, drainage.levels, drainage.area, drainage.order, drainage.outlets, badlands,
		wet.receivers, wet.area, wet.moisture, wet.lowland, wet.canyons, wet.lakeDepth, wet.lakeOf, wet.lines.points, wet.lines.widths, wet.lines.offsets,
	];
	return {
		map: { ...map, surface, badlands, water: wet, hotspots: hazards.hotspots, places, growthStats: growth.stats, network },
		// Listing a buffer twice is a DataCloneError, so each goes once.
		buffers: [...new Set(arrays.map((array) => array.buffer as ArrayBuffer))],
	};
}

/**
 * The map back, its terrain rebuilt over the land it was sent on the winning
 * terrain stream, its water over that, and its hazards over that, without
 * eroding or routing again.
 */
export function decodeAreaMap({ surface, badlands, water, hotspots, places, growthStats, network, ...map }: AreaMapTransfer): AreaMapGeneration {
	const terrain = terrainFromSurface({ params: map.params, rng: new Rng({ seed: map.streams.terrain }), surface: freezeSurface(surface), badlands });
	const wet = waterFromSurface({ terrain, surface: water });
	return {
		...map,
		products: {
			terrain,
			water: wet,
			hazards: new Hazards({ terrain: wet.terrain, hotspots }),
			places: freezePlaces(places),
			growth: { network: unpackRoadNetwork(network), stats: growthStats },
		},
	};
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
