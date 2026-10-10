import { Rng } from '../core/Rng';
import type { Biome } from './Biome';
import type { PoiGround } from './Pois';
import type { RoadClass, RoadNetwork, RoadNode, RoadStretch } from './RoadNetwork';

/**
 * Synthetic road networks for the route tree and POI tests: hand-built
 * meshes with loops, and random planar meshes, the shape the road links
 * (Map 7 and 8) will make, which outward growth never does. Nothing in the
 * game imports this file.
 */

/** A node's place, and an edge as its two nodes and its class (a back road when left out). */
export type MeshEdge = readonly [number, number] | readonly [number, number, RoadClass];

/**
 * A network from points and edges, in the order given: node 0 is the
 * compound, and each edge a straight stretch from its first node to its
 * second, with no bridges.
 */
export function meshFrom({ nodes, edges }: { nodes: readonly (readonly [number, number])[]; edges: readonly MeshEdge[] }): RoadNetwork {
	const roadNodes: RoadNode[] = nodes.map(([x, y], id) => ({ kind: id === 0 ? 'compound' : 'junction', x, y }));
	const stretches: RoadStretch[] = edges.map(([from, to, roadClass = 'backRoad']) => {
		const [x0, y0] = nodes[from];
		const [x1, y1] = nodes[to];
		return { roadClass, from, to, length: Math.sqrt((x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0)), points: [x0, y0, x1, y1], bridges: [], street: false };
	});
	return { nodes: roadNodes, stretches, broken: [], passes: [] };
}

export interface RandomMeshOptions {
	readonly seed: number;
	readonly radius?: number;
	/** World units between grid points before jitter. */
	readonly spacing?: number;
	/** Share of the spacing each point moves at most, each way. */
	readonly jitter?: number;
	/** Chance a grid cell gets a diagonal. */
	readonly diagonals?: number;
	/** Chance an edge off the spanning tree is kept, which is what makes loops. */
	readonly loops?: number;
	/** Chance a back road is a trail. */
	readonly trails?: number;
}

/**
 * A random planar mesh over a disc: a jittered square grid with the
 * compound at its origin, each cell given at most one diagonal so no two
 * edges cross, cut to a random spanning tree plus `loops` of the rest. The
 * grid's two axes through the compound are highways. Points stay within
 * 0.97 of the radius.
 */
export function randomMesh({ seed, radius = 1000, spacing = 90, jitter = 0.25, diagonals = 0.4, loops = 0.6, trails = 0.2 }: RandomMeshOptions): RoadNetwork {
	const rng = new Rng({ seed });
	const span = Math.floor(0.97 * radius / spacing);
	const ids = new Map<string, number>();
	const nodes: [number, number][] = [];
	const cell = (i: number, j: number) => `${i},${j}`;
	const add = (i: number, j: number) => {
		const x = i * spacing + (i === 0 && j === 0 ? 0 : (rng.float() * 2 - 1) * jitter * spacing);
		const y = j * spacing + (i === 0 && j === 0 ? 0 : (rng.float() * 2 - 1) * jitter * spacing);
		if (x * x + y * y > 0.97 * radius * 0.97 * radius) return;
		ids.set(cell(i, j), nodes.length);
		nodes.push([x, y]);
	};
	add(0, 0);
	for (let j = -span; j <= span; j += 1) for (let i = -span; i <= span; i += 1) if (i !== 0 || j !== 0) add(i, j);
	const at = (i: number, j: number) => ids.get(cell(i, j)) ?? -1;
	const candidates: { a: number; b: number; roadClass: RoadClass }[] = [];
	const link = (a: number, b: number, highway: boolean) => {
		if (a < 0 || b < 0) return;
		candidates.push({ a, b, roadClass: highway ? 'highway' : rng.float() < trails ? 'trail' : 'backRoad' });
	};
	for (let j = -span; j <= span; j += 1) {
		for (let i = -span; i <= span; i += 1) {
			link(at(i, j), at(i + 1, j), j === 0);
			link(at(i, j), at(i, j + 1), i === 0);
			if (rng.float() < diagonals) {
				if (rng.float() < 0.5) link(at(i, j), at(i + 1, j + 1), false);
				else link(at(i + 1, j), at(i, j + 1), false);
			}
		}
	}
	// Kruskal over random weights: a random spanning tree, then each other edge kept by chance.
	const weights = candidates.map(() => rng.float());
	const order = candidates.map((_, index) => index).sort((a, b) => weights[a] - weights[b] || a - b);
	const root = nodes.map((_, index) => index);
	const find = (node: number): number => {
		let at = node;
		while (root[at] !== at) {
			root[at] = root[root[at]];
			at = root[at];
		}
		return at;
	};
	const kept = new Uint8Array(candidates.length);
	for (const index of order) {
		const { a, b } = candidates[index];
		const [ra, rb] = [find(a), find(b)];
		if (ra !== rb) {
			root[ra] = rb;
			kept[index] = 1;
		} else if (rng.float() < loops) {
			kept[index] = 1;
		}
	}
	const edges: MeshEdge[] = [];
	candidates.forEach(({ a, b, roadClass }, index) => {
		if (kept[index] === 0) return;
		// Either way round, since the route tree drives a stretch whichever way its points run.
		edges.push(rng.float() < 0.5 ? [a, b, roadClass] : [b, a, roadClass]);
	});
	return meshFrom({ nodes, edges });
}

export interface FakeGroundOptions {
	readonly radius?: number;
	readonly metroRadius?: number;
	readonly biome?: (x: number, y: number) => Biome;
	readonly ruin?: (x: number, y: number) => number;
	readonly elevation?: (x: number, y: number) => number;
	readonly moisture?: (x: number, y: number) => number;
}

/** Land made of functions: scrub everywhere, no ruin, middling height and moisture, unless given. */
export function fakeGround({ radius = 1000, metroRadius = 150, biome, ruin, elevation, moisture }: FakeGroundOptions = {}): PoiGround {
	return {
		radius,
		metro: { x: 0, y: 0, radius: metroRadius },
		biome: (x, y) => biome?.(x, y) ?? 'scrub',
		ruin: (x, y) => ruin?.(x, y) ?? 0,
		elevation: (x, y) => elevation?.(x, y) ?? 0.5,
		moisture: (x, y) => moisture?.(x, y) ?? 0.5,
	};
}
