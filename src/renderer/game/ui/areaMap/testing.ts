import type { RoadNetwork } from '../../map/RoadNetwork';
import { createTerrainSample } from '../../map/Terrain';
import type { BakeTerrain } from './terrainBake';

/**
 * Fixtures the area map view's tests share. Nothing in the game imports this file.
 */

/**
 * A compound, a highway north through the metro's edge to a junction and on
 * to a dead end, and a back road north-east from the junction to another.
 */
export const SMALL_NETWORK: RoadNetwork = {
	nodes: [
		{ kind: 'compound', x: 0, y: 0 },
		{ kind: 'metroEdge', x: 0, y: 100 },
		{ kind: 'junction', x: 0, y: 300 },
		{ kind: 'end', x: 0, y: 500 },
		{ kind: 'end', x: 200, y: 400 },
	],
	roads: [
		{ roadClass: 'highway', parent: -1, from: 0, stretches: [0, 1, 2] },
		{ roadClass: 'backRoad', parent: 0, from: 2, stretches: [3] },
	],
	stretches: [
		{ road: 0, roadClass: 'highway', from: 0, to: 1, parent: -1, points: [0, 0, 0, 100] },
		{ road: 0, roadClass: 'highway', from: 1, to: 2, parent: 0, points: [0, 100, 0, 200, 0, 300] },
		{ road: 0, roadClass: 'highway', from: 2, to: 3, parent: 1, points: [0, 300, 0, 400, 0, 500] },
		{ road: 1, roadClass: 'backRoad', from: 2, to: 4, parent: 1, points: [0, 300, 100, 350, 200, 400] },
	],
};

export interface FlatTerrainOptions {
	radius?: number;
	/** Craters, as `Terrain.hotspots` holds them. */
	craters?: { x: number; y: number; craterRadius: number }[];
	/** Rough country, and its slope's size there. */
	rough?: (x: number, y: number) => boolean;
	slope?: number;
}

/** Flat scrub with whatever craters and rough ground a test asks for; it counts the samples taken. */
export function flatTerrain({ radius = 600, craters = [], rough = () => false, slope = 0 }: FlatTerrainOptions = {}): BakeTerrain & { samples: number; slopes: number } {
	const terrain = {
		radius,
		hotspots: craters.map((crater) => ({ ...crater, plumeRadius: crater.craterRadius * 5, strength: 1 })),
		water: null,
		samples: 0,
		slopes: 0,
		sample: (x: number, y: number, out = createTerrainSample()) => {
			terrain.samples += 1;
			out.biome = 'scrub';
			out.slopeX = 0;
			out.slopeY = 0;
			out.ruin = 0;
			return out;
		},
		slope: <Out extends { x: number; y: number }>(_x: number, _y: number, out: Out): Out => {
			terrain.slopes += 1;
			out.x = slope;
			out.y = 0;
			return out;
		},
		rough,
	};
	return terrain;
}
