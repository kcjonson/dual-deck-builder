import type { Rng } from '../core/Rng';
import { startRadii } from './Land';
import { cellCentre } from './LandGrid';
import type { MapParams } from './MapParams';
import type { HazardLayer, Terrain } from './Terrain';
import { CRATER_GAP, Hotspot, MAX_CRATER_RADIUS, placeHotspots } from './TerrainSites';

/**
 * Stage 3 of area map generation, hazards (Area Map Generation, Pipeline, 3.
 * Biomes, hazards, and cost), after the water: `hotspots` blast sites and
 * spills, each an impassable crater in a plume of contamination, spread out
 * past the metro and kept off the rivers and lakes. Laid over the land with
 * its water through `Terrain.withHazards`, so craters are impassable and
 * plumes add to the contamination for every stage after. Starting values are
 * provisional calls, listed in docs/AI_TECHNICAL_DECISIONS/places.md.
 */

/**
 * Craters keep off the land's drainage, so a blast site doesn't sit on a
 * river: no cell within `margin` cells of the crater carries `area` cells'
 * drainage, under the least a river needs at any `riverDensity` and the
 * heaviest rain (Rivers.ts, Water.ts). The water stage routes the land again
 * with a little noise, which can move a river a cell on flat ground, so the
 * margin is two cells.
 */
export const CRATER_DRAINAGE = { area: 40, margin: 2 } as const;
/** Crater centres lie inside this share of the radius, and outside the blend radius by the largest crater. */
export const HOTSPOT_OUTER = 0.9;

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;

export interface HazardsOptions {
	readonly params: MapParams;
	/** The land with its water: the water stage's `water.terrain`. */
	readonly terrain: Terrain;
	/** The stage's stream, nested in the water's winning one; hazards fork it by feature and never draw from it directly. */
	readonly rng: Rng;
}

/**
 * Stage 3: up to `hotspots` hotspots on the stream's `hotspots` fork, each
 * where no cell within two cells of its crater carries a river's drainage
 * and no lake cell lies within `CRATER_GAP` and a cell of it.
 */
export function generateHazards({ params, terrain, rng }: HazardsOptions): Hazards {
	const { surface } = terrain;
	const water = terrain.water;
	const { grid } = surface;
	const hotspots = placeHotspots({
		rng: rng.fork('hotspots'),
		count: params.hotspots,
		radius: params.radius,
		ring: { inner: startRadii(params).blendRadius + MAX_CRATER_RADIUS, outer: HOTSPOT_OUTER * params.radius },
		suits: (x, y, craterRadius) => clearOf({
			terrain, x, y,
			reach: craterRadius + CRATER_DRAINAGE.margin * grid.cellSize,
			lakeReach: craterRadius + CRATER_GAP + grid.cellSize,
			lake: water === null ? null : (cellX, cellY) => water.lakeDepth(cellX, cellY) > 0,
		}),
	});
	return new Hazards({ terrain, hotspots });
}

/**
 * The hazards stage's output: its hotspots, and the land with its water and
 * these hazards (`terrain`), what every stage after reads. Built from the
 * hotspots alone, so the client rebuilds it from what the worker sends.
 * Sampling allocates nothing.
 */
export class Hazards implements HazardLayer {
	public readonly hotspots: readonly Hotspot[];
	/** The land with its water and these hazards. */
	public readonly terrain: Terrain;
	/** Hotspots flattened for the per-sample loops: x, y, crater radius squared, plume radius squared, strength. */
	private readonly data: Float64Array;

	constructor({ terrain, hotspots }: { terrain: Terrain; hotspots: readonly Hotspot[] }) {
		this.hotspots = Object.freeze(hotspots.map((hotspot) => Object.freeze({ ...hotspot })));
		this.data = new Float64Array(hotspots.length * 5);
		hotspots.forEach((hotspot, index) => {
			this.data.set([hotspot.x, hotspot.y, hotspot.craterRadius * hotspot.craterRadius, hotspot.plumeRadius * hotspot.plumeRadius, hotspot.strength], index * 5);
		});
		this.terrain = terrain.withHazards(this);
	}

	public crater(x: number, y: number): boolean {
		const data = this.data;
		for (let index = 0; index < data.length; index += 5) {
			const dx = x - data[index];
			const dy = y - data[index + 1];
			if (dx * dx + dy * dy < data[index + 2]) return true;
		}
		return false;
	}

	/** Each plume falls off with the square of one less the squared distance over its radius squared, and they combine as 1 - (1 - a)(1 - b). */
	public plumes(x: number, y: number, contamination: number): number {
		const data = this.data;
		let out = contamination;
		for (let index = 0; index < data.length; index += 5) {
			const dx = x - data[index];
			const dy = y - data[index + 1];
			const hotspotSquared = dx * dx + dy * dy;
			const plumeSquared = data[index + 3];
			if (hotspotSquared < plumeSquared) {
				const falloff = 1 - hotspotSquared / plumeSquared;
				const plume = data[index + 4] * falloff * falloff;
				out += plume - out * plume;
			}
		}
		return out;
	}
}

/**
 * Whether no cell whose centre lies within `reach` of (x, y) carries
 * `CRATER_DRAINAGE.area` cells of the land's drainage, and none within
 * `lakeReach` is a lake.
 */
function clearOf({ terrain, x, y, reach, lakeReach, lake }: {
	terrain: Terrain; x: number; y: number; reach: number; lakeReach: number; lake: ((x: number, y: number) => boolean) | null;
}): boolean {
	const { grid, drainage } = terrain.surface;
	const size = grid.size;
	const far = reach > lakeReach ? reach : lakeReach;
	const first = floor((x - far + grid.halfExtent) / grid.cellSize);
	const last = floor((x + far + grid.halfExtent) / grid.cellSize);
	const bottom = floor((y - far + grid.halfExtent) / grid.cellSize);
	const top = floor((y + far + grid.halfExtent) / grid.cellSize);
	for (let row = bottom < 0 ? 0 : bottom; row <= top && row < size; row += 1) {
		const cellY = cellCentre(grid, row);
		const dy = cellY - y;
		for (let column = first < 0 ? 0 : first; column <= last && column < size; column += 1) {
			const cellX = cellCentre(grid, column);
			const dx = cellX - x;
			const squared = dx * dx + dy * dy;
			if (squared <= reach * reach && drainage.area[row * size + column] >= CRATER_DRAINAGE.area) return false;
			if (lake !== null && squared <= lakeReach * lakeReach && lake(cellX, cellY)) return false;
		}
	}
	return true;
}
