/**
 * The road network (Area Map Generation, Pipeline, 5. Roads): every road on
 * the map, highways, back roads, and trails, as plain data a save can hold.
 * Nodes are where something happens on a road and stretches are the road
 * between two nodes. It's a real network with loops, not a tree: a stretch
 * runs either way, and the route tree (RouteTree.ts) chooses each place's
 * way home over it.
 */

/** Best first: a highway outranks a back road, which outranks a trail. */
export const ROAD_CLASSES = ['highway', 'backRoad', 'trail'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const ROAD_CLASS_LABELS: { readonly [Name in RoadClass]: string } = {
	highway: 'Highway',
	backRoad: 'Back road',
	trail: 'Trail',
};

/**
 * - `compound`: node 0, at the origin, where every road into the metro ends.
 * - `town`, `village`, `crossroads`, `exit`: a place the roads join, `place` naming it.
 * - `junction`: where three or more stretches meet away from a place.
 * - `metroEdge`: the last point inside the metro on a road leaving it, so the
 *   stretches inside are city streets.
 * - `classChange`: where a road's class changes along it, a back road giving out to a trail say.
 * - `end`: a dead end, where a spur trail stops at a pass, a mine, or a lookout.
 * - `roadside`: a point that splits a long stretch, so meeting points and legs have places to fall.
 */
export type RoadNodeKind = 'compound' | 'town' | 'village' | 'crossroads' | 'exit' | 'junction' | 'metroEdge' | 'classChange' | 'end' | 'roadside';

export interface RoadNode {
	readonly kind: RoadNodeKind;
	readonly x: number;
	readonly y: number;
	/** The place it stands for, by its id in the places list; absent on a node that's no place. */
	readonly place?: number;
}

/** Where a stretch crosses a river: its deck, as world units along the stretch's polyline from its first point. */
export interface RoadBridge {
	readonly start: number;
	readonly end: number;
}

/** Road between two nodes, of one class: what a route drives, either way. */
export interface RoadStretch {
	readonly roadClass: RoadClass;
	readonly from: number;
	readonly to: number;
	/** World units along its polyline. */
	readonly length: number;
	/** The polyline from `from` to `to`, flat: x0, y0, x1, y1, ... At least two points. */
	readonly points: readonly number[];
	/** Its bridges, in order along it. */
	readonly bridges: readonly RoadBridge[];
	/** A city street: wholly inside the metro, charted from the start. */
	readonly street: boolean;
	/**
	 * A highway stretch's highway, which the shields number: its exit's order
	 * among the highway exits in the places list, from 0. Where highways merge
	 * into a trunk, the trunk is the first one laid's. Absent on any other class.
	 */
	readonly highway?: number;
}

/** The highest point of a road over a range, which the dressing can label. */
export interface RoadPass {
	readonly x: number;
	readonly y: number;
}

export interface RoadNetwork {
	/** Node 0 is the compound. */
	readonly nodes: readonly RoadNode[];
	readonly stretches: readonly RoadStretch[];
	/** Highway spans that collapsed: drawn with their gap, never driven, and in no node's stretches. */
	readonly broken: readonly RoadStretch[];
	readonly passes: readonly RoadPass[];
}

/** 0 for a highway, 1 a back road, 2 a trail. */
export function classRank(roadClass: RoadClass): number {
	return ROAD_CLASSES.indexOf(roadClass);
}

/** Independent loops: stretches less nodes plus the pieces they make, what a road network's POIs need one each of. */
export function loopCount({ nodes, stretches }: Pick<RoadNetwork, 'nodes' | 'stretches'>): number {
	const parent = nodes.map((_node, id) => id);
	const find = (id: number): number => {
		let root = id;
		while (parent[root] !== root) root = parent[root];
		while (parent[id] !== root) {
			const next = parent[id];
			parent[id] = root;
			id = next;
		}
		return root;
	};
	let pieces = nodes.length;
	for (const { from, to } of stretches) {
		const a = find(from);
		const b = find(to);
		if (a !== b) {
			parent[a] = b;
			pieces -= 1;
		}
	}
	return stretches.length - nodes.length + pieces;
}
