/**
 * The drivable road network (Area Map Generation, Pipeline, 2 to 4): trees
 * of roads grown outward from the compound, as plain data a save can hold.
 * Nodes are where something happens on a road, stretches are the road
 * between two nodes, and roads are the lineage growth works in: a highway
 * out of the metro, or a branch from its junction to its end.
 */

/** In the order a road can degrade: a class never comes before its road's earlier one. */
export const ROAD_CLASSES = ['highway', 'backRoad', 'trail'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const ROAD_CLASS_LABELS: { readonly [Name in RoadClass]: string } = {
	highway: 'Highway',
	backRoad: 'Back road',
	trail: 'Trail',
};

/**
 * - `compound`: the root at the origin, node 0, where every highway out of the metro starts.
 * - `metroEdge`: where a highway's city street meets the metro's edge and growth took over.
 * - `junction`: where a branch leaves its parent road.
 * - `classChange`: where a back road degrades to a trail.
 * - `end`: a dead end, where a road was blocked or reached its class's longest.
 * - `exit`: where a road leaves the area at the disc's rim.
 */
export type RoadNodeKind = 'compound' | 'metroEdge' | 'junction' | 'classChange' | 'end' | 'exit';

export interface RoadNode {
	readonly kind: RoadNodeKind;
	readonly x: number;
	readonly y: number;
}

/**
 * Road between two nodes, of one class: the unit stops, knowledge, and
 * travel time work in. Its points run outward, from `from` to `to`.
 */
export interface RoadStretch {
	/** The road it's part of. */
	readonly road: number;
	readonly roadClass: RoadClass;
	/** The node at its inner end, nearer the compound along the road... */
	readonly from: number;
	/** ...and at its outer end. */
	readonly to: number;
	/** The stretch it leads on from, toward the compound; -1 for a city street, which starts at the compound. */
	readonly parent: number;
	/** The polyline from `from` to `to`, flat: x0, y0, x1, y1, ... At least two points. */
	readonly points: readonly number[];
}

export interface Road {
	/** Its class where it starts; later stretches may have degraded to trails. */
	readonly roadClass: RoadClass;
	/** The road it branched from, or -1 for a highway out of the metro. */
	readonly parent: number;
	/** The node it starts at: the compound, or its junction on its parent. */
	readonly from: number;
	/** Its stretches, inner to outer. */
	readonly stretches: readonly number[];
}

/** The drivable layer: trees rooted at the compound, planar by construction. */
export interface RoadNetwork {
	/** Node 0 is the compound. */
	readonly nodes: readonly RoadNode[];
	/** The highways out of the metro first, in departure order, then branches in the order they grew. */
	readonly roads: readonly Road[];
	readonly stretches: readonly RoadStretch[];
}

/** 0 for a highway, 1 a back road, 2 a trail. */
export function classRank(roadClass: RoadClass): number {
	return ROAD_CLASSES.indexOf(roadClass);
}
