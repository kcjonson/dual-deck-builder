import type { Places } from '../../map/Places';
import type { RiverLines } from '../../map/Rivers';
import type { RoadNetwork } from '../../map/RoadNetwork';
import type { BakeTerrain } from './terrainBake';

/**
 * What the area map view draws, as the small typed inputs the later
 * generation stages fill in. Only the map itself is required; every other
 * layer is optional, and absent it draws as if nothing were known yet to
 * hide: every road charted, no fog, no markers. So POIs (DDB-291), knowledge
 * and fog (DDB-294), and whatever screen hosts the view plug in by setting a
 * property, never by changing the view.
 *
 * Positions are world space: world units, the compound at the origin, y
 * north, as generation lays them.
 */

/** The generated map: terrain to bake, its lakes with it, and the rivers, drivable network, and places to draw. */
export interface AreaMapData {
	readonly terrain: BakeTerrain;
	readonly network: RoadNetwork;
	/** The water stage's rivers, drawn live under the roads, width by size. */
	readonly rivers: RiverLines;
	/** The places stage's: towns and villages named, crossroads, and exits, and the ruins baked under them. None when absent. */
	readonly places?: Places | null;
}

/**
 * Compound and Supply Runs, Fog of war: charted roads are solid, rumored
 * roads solid but paler, and uncharted roads a dashed stub fading into the
 * fog from where they leave known road.
 */
export const ROAD_KNOWLEDGE = ['charted', 'rumored', 'uncharted'] as const;
export type RoadKnowledge = (typeof ROAD_KNOWLEDGE)[number];

/**
 * Per-stretch knowledge, by stretch id. An uncharted stretch is drawn only
 * where it leaves known road (either end is the compound, or a node a
 * charted or rumored stretch ends on), as a stub from that end; one deeper
 * in the fog isn't drawn at all, so the three states are enough to say
 * what's hidden.
 */
export interface RoadKnowledgeLayer {
	knowledgeOf(stretch: number): RoadKnowledge;
}

/**
 * Land fog (Area Map Generation, Fog): a coarse grid of cells over the
 * disc's bounding square, each revealed or not. Column 0 is the west edge
 * and row 0 the south edge, as world x and y run, so cell (column, row)
 * covers x from `-radius + column * side` and y from `-radius + row * side`,
 * where side is `2 * radius / cells`.
 */
export interface LandFogLayer {
	/** Cells along each side; the spec's is 64. */
	readonly cells: number;
	isRevealed(column: number, row: number): boolean;
}

export const MAP_MARKER_KINDS = ['poi', 'stronghold'] as const;
export type MapMarkerKind = (typeof MAP_MARKER_KINDS)[number];

/** Compound and Supply Runs, POIs: what's left to take. */
export const POI_STATES = ['unvisited', 'looted', 'depleted'] as const;
export type PoiState = (typeof POI_STATES)[number];

/** A point of interest or a stronghold, as the view draws and picks it. */
export interface MapMarker {
	/** Unique among the markers: selection is kept by it. */
	readonly id: string;
	readonly kind: MapMarkerKind;
	readonly x: number;
	readonly y: number;
	/** Drawn beside the marker; none when absent. */
	readonly label?: string;
	/** A POI's; unvisited when absent. Strongholds ignore it. */
	readonly state?: PoiState;
}

/** What a press on the map picked: a marker, a drawn stretch, or nothing (null). */
export type AreaMapSelection =
	| { readonly kind: 'marker'; readonly id: string }
	| { readonly kind: 'stretch'; readonly stretch: number };

/** Which layers draw. Every layer is on unless turned off; the Map Lab's toggles set these. */
export interface AreaMapLayerToggles {
	readonly terrain: boolean;
	/** Rivers; lakes are baked with the terrain. */
	readonly water: boolean;
	readonly roads: boolean;
	readonly junctions: boolean;
	/** Towns, villages, crossroads, and exits; a place under the fog isn't drawn. */
	readonly places: boolean;
	readonly markers: boolean;
	readonly fog: boolean;
}

export const ALL_LAYERS: AreaMapLayerToggles = Object.freeze({
	terrain: true,
	water: true,
	roads: true,
	junctions: true,
	places: true,
	markers: true,
	fog: true,
});

/** The absent knowledge layer: every stretch charted. */
export const ALL_CHARTED: RoadKnowledgeLayer = Object.freeze({
	knowledgeOf: (): RoadKnowledge => 'charted',
});

/**
 * Whether stretch `id` is drawn under `knowledge`, and how: as itself, or as
 * a stub of an uncharted stretch leaving known road; null when it's hidden.
 */
export function drawnKnowledge(network: RoadNetwork, knowledge: RoadKnowledgeLayer, id: number): RoadKnowledge | null {
	const own = knowledge.knowledgeOf(id);
	if (own !== 'uncharted') return own;
	return stubEnd(network, knowledge, id) === null ? null : own;
}

/**
 * The end an uncharted stretch's stub leaves known road from: `from` or
 * `to`, whichever is the compound or a node where a charted or rumored
 * stretch ends, `from` when both are; null when neither is.
 */
export function stubEnd(network: RoadNetwork, knowledge: RoadKnowledgeLayer, id: number): 'from' | 'to' | null {
	const { from, to } = network.stretches[id];
	const meeting = stretchesAt(network);
	const known = (node: number) => node === 0 || meeting[node].some((other) => other !== id && knowledge.knowledgeOf(other) !== 'uncharted');
	if (known(from)) return 'from';
	return known(to) ? 'to' : null;
}

const incidence = new WeakMap<RoadNetwork, readonly (readonly number[])[]>();

/** Per node, the stretches ending on it, worked out once a network. */
export function stretchesAt(network: RoadNetwork): readonly (readonly number[])[] {
	let found = incidence.get(network);
	if (!found) {
		const lists: number[][] = network.nodes.map(() => []);
		network.stretches.forEach(({ from, to }, id) => {
			lists[from].push(id);
			lists[to].push(id);
		});
		found = lists;
		incidence.set(network, found);
	}
	return found;
}

/**
 * The world rect around the revealed cells, or null when none are: what a
 * screen fits the camera to so the map shows what's been uncovered.
 */
export function revealedBounds(fog: LandFogLayer, radius: number): { x: number; y: number; width: number; height: number } | null {
	const side = (radius * 2) / fog.cells;
	let minColumn = Infinity;
	let minRow = Infinity;
	let maxColumn = -Infinity;
	let maxRow = -Infinity;
	for (let row = 0; row < fog.cells; row++) {
		for (let column = 0; column < fog.cells; column++) {
			if (!fog.isRevealed(column, row)) continue;
			if (column < minColumn) minColumn = column;
			if (column > maxColumn) maxColumn = column;
			if (row < minRow) minRow = row;
			if (row > maxRow) maxRow = row;
		}
	}
	if (minColumn === Infinity) return null;
	return {
		x: -radius + minColumn * side,
		y: -radius + minRow * side,
		width: (maxColumn - minColumn + 1) * side,
		height: (maxRow - minRow + 1) * side,
	};
}
