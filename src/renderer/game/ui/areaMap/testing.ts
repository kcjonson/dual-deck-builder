import type { RiverLines } from '../../map/Rivers';
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
	stretches: [
		{ roadClass: 'highway', from: 0, to: 1, length: 100, points: [0, 0, 0, 100], bridges: [], street: true },
		{ roadClass: 'highway', from: 1, to: 2, length: 200, points: [0, 100, 0, 200, 0, 300], bridges: [], street: false },
		{ roadClass: 'highway', from: 2, to: 3, length: 200, points: [0, 300, 0, 400, 0, 500], bridges: [], street: false },
		{ roadClass: 'backRoad', from: 2, to: 4, length: 2 * Math.sqrt(12500), points: [0, 300, 100, 350, 200, 400], bridges: [], street: false },
	],
	broken: [],
	passes: [],
};

/** A map's rivers when it has none. */
export const NO_RIVERS: RiverLines = { points: new Float64Array(0), widths: new Float64Array(0), offsets: Uint32Array.of(0) };

export interface FlatTerrainOptions {
	radius?: number;
	/** Craters, as `Terrain.hotspots` holds them. */
	craters?: { x: number; y: number; craterRadius: number }[];
	/** How far into a cliff a point is, as `Terrain.cliffDepth` reads it: 0 or more on one; no cliffs when left out. */
	cliffDepth?: (x: number, y: number) => number;
	/** The slope east, everywhere, for the hill shade; flat when left out. */
	slope?: number;
	/** Moisture at a point; middling, 0.5, everywhere when left out. */
	moisture?: (x: number, y: number) => number;
	/** A water layer's lake depth, more than 0 under a lake; no water when left out. */
	lakeDepth?: (x: number, y: number) => number;
}

/**
 * Middling scrub with whatever craters, cliffs, slope, moisture, and lakes a
 * test asks for; it counts the samples, slopes, and cliff depths taken.
 */
export function flatTerrain({ radius = 600, craters = [], cliffDepth = () => -1, slope = 0, moisture, lakeDepth }: FlatTerrainOptions = {}): BakeTerrain & { samples: number; slopes: number; depths: number } {
	const terrain = {
		radius,
		hotspots: craters.map((crater) => ({ ...crater, plumeRadius: crater.craterRadius * 5, strength: 1 })),
		water: lakeDepth ? { lakeDepth } : null,
		samples: 0,
		slopes: 0,
		depths: 0,
		sample: (x: number, y: number, out = createTerrainSample()) => {
			terrain.samples += 1;
			out.biome = 'scrub';
			out.elevation = 0;
			out.moisture = moisture ? moisture(x, y) : 0.5;
			out.contamination = 0;
			out.slopeX = 0;
			out.slopeY = 0;
			return out;
		},
		slope: <Out extends { x: number; y: number }>(_x: number, _y: number, out: Out): Out => {
			terrain.slopes += 1;
			out.x = slope;
			out.y = 0;
			return out;
		},
		cliffDepth: (x: number, y: number) => {
			terrain.depths += 1;
			return cliffDepth(x, y);
		},
	};
	return terrain;
}
