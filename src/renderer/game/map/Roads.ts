import type { Rng } from '../core/Rng';
import { unitVector } from './Geometry';
import type { MapParams } from './MapParams';
import type { RiverLines } from './Rivers';
import { EdgeCostField } from './RoadCost';
import { RoadGraphStats, buildRoadGraph } from './RoadGraph';
import { RoadCells, RoadLinkStats, RoadPlace, buildRoadCells } from './RoadLinks';
import { RoadNetwork, RoadStretch, loopCount } from './RoadNetwork';
import type { Terrain } from './Terrain';

/**
 * Stage 5 of area map generation, roads (Area Map Generation, 5. Roads): the
 * edge cost field over the land with its water (RoadCost.ts), the road links
 * over it (Map 7, RoadLinks.ts), the road graph from them (Map 8,
 * RoadGraph.ts), and then the broken highways: spans that collapsed, taken
 * out of the network only where every node still reaches the compound.
 *
 * The stage fails when its network has fewer loops than the POIs need,
 * `poiDensity` times 30 plus `strongholds`, so a different attempt can try
 * again (Validation and retries); `roadsProblems` says so.
 */

export interface RoadStats {
	readonly links: RoadLinkStats;
	readonly graph: RoadGraphStats;
	/** Moves the edge cost field worked out. */
	readonly moves: number;
	readonly loops: number;
	/** World units of road by class, broken spans left out. */
	readonly lengths: { readonly highway: number; readonly backRoad: number; readonly trail: number };
	readonly bridges: number;
}

export interface Roads {
	readonly network: RoadNetwork;
	readonly stats: RoadStats;
}

export interface RoadsOptions {
	/** The land with its water. */
	readonly terrain: Terrain;
	/** The water's river lines. */
	readonly rivers: RiverLines;
	readonly params: MapParams;
	/** Index 0 the compound at the origin, then every place the roads join. */
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
	return { network, stats: { links: cells.stats, graph: graph.stats, moves: field.worked, loops: loopCount(network), lengths, bridges } };
}

/** The loops the POIs need: one each, and one for each stronghold. */
export function loopsNeeded(params: Pick<MapParams, 'poiDensity' | 'strongholds'>): number {
	return Math.ceil(params.poiDensity * 30) + params.strongholds;
}

/** What fails the roads stage: places no road reaches, and too few loops. The network checks come on top. */
export function roadsProblems({ network, stats }: Roads, params: Pick<MapParams, 'poiDensity' | 'strongholds'>): string[] {
	const problems: string[] = [];
	if (stats.links.unreached.length > 0) problems.push(`reach: no road reaches places ${stats.links.unreached.join(', ')}`);
	const needed = loopsNeeded(params);
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

/**
 * Places for the roads until the places stage (Map 6) lands: the compound,
 * the terrain's towns, crossroads thrown over open ground `roadDensity`
 * apart (140 world units at 0 to 70 at 1), and the highways' exits at the
 * rim, evenly round it from a drawn turn, each slid up to 8 degrees to ground
 * the roads can reach. Only cells a flood fill from the compound reaches
 * past lakes, cliffs, and craters, with rivers bridged, hold a place, so the
 * links can join them all, as the places stage promises. Draws on
 * `crossroads` and `exits`.
 */
export function standInPlaces({ terrain, params, rng }: { terrain: Terrain; params: MapParams; rng: Rng }): RoadPlace[] {
	const radius = terrain.radius;
	const { grid } = terrain.surface;
	const reached = reachedCells(terrain);
	const reaches = (x: number, y: number) => {
		const column = Math.floor((x + grid.halfExtent) / grid.cellSize);
		const row = Math.floor((y + grid.halfExtent) / grid.cellSize);
		return reached[row * grid.size + column] === 1;
	};
	const places: RoadPlace[] = [{ id: 0, kind: 'compound', x: 0, y: 0 }];
	for (const town of terrain.towns) if (reaches(town.x, town.y)) places.push({ id: places.length, kind: 'town', x: town.x, y: town.y });
	const direction = { x: 0, y: 0 };
	const turn = rng.fork('exits').float() * 360;
	const exits: RoadPlace[] = [];
	for (let index = 0; index < params.highways; index += 1) {
		for (const slide of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7, 8, -8]) {
			unitVector(turn + index * 360 / params.highways + slide, direction);
			const x = direction.x * 0.985 * radius;
			const y = direction.y * 0.985 * radius;
			if (!reaches(x, y)) continue;
			exits.push({ id: 0, kind: 'exit', x, y, highway: true });
			break;
		}
	}
	const spacing = 140 - 70 * params.roadDensity;
	const metro = terrain.metro.radius + 0.5 * spacing;
	const candidates: [number, number][] = [];
	for (let row = 0; row < grid.size; row += 1) {
		const y = -grid.halfExtent + (row + 0.5) * grid.cellSize;
		for (let column = 0; column < grid.size; column += 1) {
			const x = -grid.halfExtent + (column + 0.5) * grid.cellSize;
			const squared = x * x + y * y;
			if (squared < metro * metro || squared > 0.93 * 0.93 * radius * radius) continue;
			if (reached[row * grid.size + column] === 0 || terrain.obstacle(x, y) !== null || terrain.rough(x, y) || terrain.grade(x, y) > 0.6) continue;
			candidates.push([x, y]);
		}
	}
	rng.fork('crossroads').shuffle(candidates);
	const taken: { x: number; y: number; gap: number }[] = [...places.slice(1), ...exits].map(({ x, y }) => ({ x, y, gap: 0.75 * spacing }));
	const crossroads: RoadPlace[] = [];
	for (const [x, y] of candidates) {
		if (taken.some((other) => (other.x - x) * (other.x - x) + (other.y - y) * (other.y - y) < other.gap * other.gap)) continue;
		taken.push({ x, y, gap: spacing });
		crossroads.push({ id: 0, kind: 'crossroads', x, y });
	}
	return [...places, ...crossroads, ...exits].map((place, id) => ({ ...place, id }));
}

/** Per land cell, 1 where a flood fill from the compound's cells gets to, side to side, through cells inside the disc that are open or in a river. */
function reachedCells(terrain: Terrain): Uint8Array {
	const { grid } = terrain.surface;
	const size = grid.size;
	const reach = terrain.radius - 0.5;
	const passable = new Uint8Array(size * size);
	for (let row = 0; row < size; row += 1) {
		const y = -grid.halfExtent + (row + 0.5) * grid.cellSize;
		for (let column = 0; column < size; column += 1) {
			const x = -grid.halfExtent + (column + 0.5) * grid.cellSize;
			if (x * x + y * y >= reach * reach) continue;
			const obstacle = terrain.obstacle(x, y);
			if (obstacle === null || obstacle === 'river') passable[row * size + column] = 1;
		}
	}
	const reached = new Uint8Array(size * size);
	const middle = size / 2;
	const stack = [middle * size + middle];
	reached[stack[0]] = 1;
	while (stack.length > 0) {
		const cell = stack.pop() as number;
		for (const next of [cell + 1, cell - 1, cell + size, cell - size]) {
			if (reached[next] === 1 || passable[next] === 0) continue;
			reached[next] = 1;
			stack.push(next);
		}
	}
	return reached;
}
