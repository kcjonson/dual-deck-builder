import type { Rng } from '../core/Rng';
import type { MapParams } from './MapParams';
import type { RiverLines } from './Rivers';
import { EdgeCostField } from './RoadCost';
import { RoadGraphStats, buildRoadGraph } from './RoadGraph';
import { RoadCells, RoadLinkStats, RoadPlace, buildRoadCells } from './RoadLinks';
import { RoadNetwork, RoadStretch, loopCount } from './RoadNetwork';
import type { Terrain } from './Terrain';

/**
 * Stage 5 of area map generation, roads (Area Map Generation, 5. Roads): the
 * edge cost field over the land with its water and hazards (RoadCost.ts),
 * the road links between the places over it (Map 7, RoadLinks.ts), the road
 * graph from them (Map 8, RoadGraph.ts), and then the broken highways: spans
 * that collapsed, taken out of the network only where every node still
 * reaches the compound.
 *
 * The stage fails when its network has fewer loops than the POIs need,
 * `poiDensity` times 30 plus `strongholds`, or than its places can close
 * where that's fewer, so a different attempt can try again (Validation and
 * retries); `roadsProblems` says so.
 */

export interface RoadStats {
	readonly links: RoadLinkStats;
	readonly graph: RoadGraphStats;
	/** Moves the edge cost field worked out. */
	readonly moves: number;
	readonly loops: number;
	/** Towns, villages, and crossroads: the places a loop can run round, where the exits stand on the rim. */
	readonly inland: number;
	/** World units of road by class, broken spans left out. */
	readonly lengths: { readonly highway: number; readonly backRoad: number; readonly trail: number };
	readonly bridges: number;
}

export interface Roads {
	readonly network: RoadNetwork;
	readonly stats: RoadStats;
}

export interface RoadsOptions {
	/** The land with its water and hazards. */
	readonly terrain: Terrain;
	/** The water's river lines. */
	readonly rivers: RiverLines;
	readonly params: MapParams;
	/** Every place the roads join, in `placeList`'s order: the metro first, where the compound stands at the origin. */
	readonly places: readonly RoadPlace[];
	/** The stage's stream: spurs draw on its `spur` forks, broken highways on `broken`. */
	readonly rng: Rng;
}

/** Highway spans long enough to break, and far enough out: this many world units long or more... */
const BROKEN = { length: 70, outside: 0.35 } as const;

/** The roads stage (Maps 7 and 8). */
export function generateRoads({ terrain, rivers, params, places, rng }: RoadsOptions): Roads {
	const field = new EdgeCostField({ terrain, rivers, curviness: params.curviness });
	const cells: RoadCells = buildRoadCells({ field, terrain, places, loops: params.loops, trailShare: params.trailShare, rng });
	const graph = buildRoadGraph({ cells, terrain });
	const { stretches, broken } = breakHighways({ nodes: graph.nodes, stretches: graph.stretches, count: params.brokenHighways, radius: terrain.radius, rng: rng.fork('broken') });
	const network: RoadNetwork = { nodes: graph.nodes, stretches, broken, passes: cells.passes };
	const lengths = { highway: 0, backRoad: 0, trail: 0 };
	let bridges = 0;
	for (const stretch of stretches) {
		lengths[stretch.roadClass] += stretch.length;
		bridges += stretch.bridges.length;
	}
	const inland = places.filter(({ kind }) => kind === 'town' || kind === 'village' || kind === 'crossroads').length;
	return { network, stats: { links: cells.stats, graph: graph.stats, moves: field.worked, loops: loopCount(network), inland, lengths, bridges } };
}

/**
 * The loops a map's places can close, for each town, village, and crossroads
 * past the first `first`, which only branch: `none` at `loops` 0, where
 * the detour lets fewest links in, rising by `rise` times `loops` to at
 * most `most`.
 */
export const LOOPS_PER_PLACE = { first: 4, none: 0.3, rise: 0.9, most: 0.6 } as const;

/** The loops the POIs want: one each, and one for each stronghold. */
export function loopsWanted(params: Pick<MapParams, 'poiDensity' | 'strongholds'>): number {
	return Math.ceil(params.poiDensity * 30) + params.strongholds;
}

/**
 * The loops the POIs want, but no more than the map's `inland` places can
 * close: a map in the high ranges with a few villages and crossroads can't
 * hold more, whatever the roads do.
 */
export function loopsNeeded(params: Pick<MapParams, 'poiDensity' | 'strongholds' | 'loops'>, inland: number): number {
	const wanted = loopsWanted(params);
	const { first, none, rise, most } = LOOPS_PER_PLACE;
	const rising = none + rise * params.loops;
	const share = rising < most ? rising : most;
	const closable = inland > first ? Math.ceil(share * (inland - first)) : 0;
	return closable < wanted ? closable : wanted;
}

/** What fails the roads stage: places no road reaches, and too few loops. The network checks come on top. */
export function roadsProblems({ network, stats }: Roads, params: Pick<MapParams, 'poiDensity' | 'strongholds' | 'loops'>): string[] {
	const problems: string[] = [];
	if (stats.links.unreached.length > 0) problems.push(`reach: no road reaches places ${stats.links.unreached.join(', ')}`);
	const needed = loopsNeeded(params, stats.inland);
	const loops = loopCount(network);
	if (loops < needed) problems.push(`loops: the roads close ${loops} loops, and the POIs need ${needed}`);
	return problems;
}

/**
 * Highway spans that collapsed (`brokenHighways`): highway stretches at
 * least `BROKEN.length` long whose middle lies past `BROKEN.outside` of the
 * radius, tried in an order shuffled on the `broken` stream, each taken out
 * only where every node still reaches the compound without it.
 */
function breakHighways({ nodes, stretches, count, radius, rng }: {
	nodes: RoadNetwork['nodes']; stretches: readonly RoadStretch[]; count: number; radius: number; rng: Rng;
}): { stretches: RoadStretch[]; broken: RoadStretch[] } {
	const candidates = stretches.flatMap((stretch, id) => {
		if (stretch.roadClass !== 'highway' || stretch.length < BROKEN.length) return [];
		const middle = 2 * Math.floor(stretch.points.length / 4);
		const x = stretch.points[middle];
		const y = stretch.points[middle + 1];
		return x * x + y * y > BROKEN.outside * BROKEN.outside * radius * radius ? [id] : [];
	});
	rng.shuffle(candidates);
	const gone = new Set<number>();
	for (const id of candidates) {
		if (gone.size >= count) break;
		gone.add(id);
		if (!allReach(nodes.length, stretches, gone)) gone.delete(id);
	}
	return {
		stretches: stretches.filter((_stretch, id) => !gone.has(id)),
		broken: stretches.filter((_stretch, id) => gone.has(id)),
	};
}

function allReach(nodeCount: number, stretches: readonly RoadStretch[], gone: ReadonlySet<number>): boolean {
	const linked: number[][] = Array.from({ length: nodeCount }, () => []);
	stretches.forEach(({ from, to }, id) => {
		if (gone.has(id)) return;
		linked[from].push(to);
		linked[to].push(from);
	});
	const reached = new Uint8Array(nodeCount);
	reached[0] = 1;
	let count = 1;
	const stack = [0];
	while (stack.length > 0) {
		for (const next of linked[stack.pop() as number]) {
			if (reached[next] === 1) continue;
			reached[next] = 1;
			count += 1;
			stack.push(next);
		}
	}
	return count === nodeCount;
}
