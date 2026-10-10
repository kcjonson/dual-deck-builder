import { landGridFor } from '../../map/LandGrid';
import { TerrainSample, WaterLayer, createTerrainSample } from '../../map/Terrain';
import type { Hotspot, Ruin } from '../../map/TerrainSites';
import { HILL_SHADE, OBSTACLE_COLOURS, RUIN_SHADE, landColour } from './areaMapStyle';

/**
 * The area map's terrain picture, baked once per map into premultiplied
 * RGBA8 texels for `DrawApi.createTexture` (Area Map Generation,
 * Performance: terrain bakes into one image, rebaked only when the map is
 * generated or loaded). No GL here, so it runs and is tested in Node.
 *
 * The texture covers the disc's bounding square, row 0 at the north edge.
 * A full terrain sample costs about half a microsecond and a slope about
 * 140 ns (terrain-erosion.md), so the bake reads the land on three lattices
 * coarser than the texels and interpolates between their nodes:
 *
 * - the land's colour, a continuous blend of elevation, moisture, and
 *   contamination (`landColour`), and the ruins' shade, every `colourStep`
 *   texels, where they change slowly. Biomes are categories the game reads,
 *   never paint, so country shades from one kind to the next;
 * - hill shade from the slope about every half land cell, the finest the
 *   land's hills come: a coarser lattice draws the grid's cells as blocks;
 * - how far into a cliff the land is (`Terrain.cliffDepth`) every
 *   `CLIFF_STEP` texels, closed so a notch or gap a node or two wide in a
 *   band fills in. Cliffs are read off the land grid's averaged grade, so
 *   this draws the cliffs `Terrain.obstacle` reports, a band per
 *   escarpment, give or take the closing and a texel at their edges.
 *
 * Craters are circles, so they're drawn exactly. Lakes are read per texel
 * from the water's depth field, a bilinear lookup, and filled with a darker
 * shore where a texel beside them is dry. Rivers aren't baked: the view
 * draws them live, under the roads. Obstacles take `obstacle`'s precedence:
 * crater, lake, cliff. Texels past the rim are transparent, the rim itself
 * anti-aliased.
 */

/** What the bake reads of a `Terrain`. */
export interface BakeTerrain {
	readonly radius: number;
	readonly hotspots: readonly Hotspot[];
	readonly water: Pick<WaterLayer, 'lakeDepth'> | null;
	sample(x: number, y: number, out: TerrainSample): TerrainSample;
	slope<Out extends { x: number; y: number }>(x: number, y: number, out: Out): Out;
	cliffDepth(x: number, y: number): number;
}

export interface TerrainBakeOptions {
	terrain: BakeTerrain;
	/** Texels along each side of the disc's bounding square. */
	size: number;
	/** Texels between colour samples, 1 for every texel; about `COLOUR_WORLD_UNITS` apart when left out. */
	colourStep?: number;
	/** The metro, towns, and villages, shaded darker out to twice their radius; none when left out. */
	ruins?: readonly Ruin[];
}

export const TEXEL_WORLD_UNITS = 2.5;
export const MIN_BAKE_SIZE = 256;
export const MAX_BAKE_SIZE = 1024;
/** World units between colour samples: the land's colour changes over hundreds, and hills a few dozen at their finest. */
export const COLOUR_WORLD_UNITS = 16;
/** Texels between cliff samples. */
export const CLIFF_STEP = 2;

/**
 * Texels per side for a map of `radius`: about `TEXEL_WORLD_UNITS` a texel,
 * held between `MIN_BAKE_SIZE` and `MAX_BAKE_SIZE`, so the largest maps get
 * coarser texels rather than a longer bake.
 */
export function terrainBakeSize(radius: number): number {
	const size = Math.ceil((radius * 2) / TEXEL_WORLD_UNITS);
	return Math.max(MIN_BAKE_SIZE, Math.min(MAX_BAKE_SIZE, size));
}

export function bakeTerrain({ terrain, size, colourStep, ruins = [] }: TerrainBakeOptions): Uint8Array {
	if (!Number.isInteger(size) || size < 1) throw new Error(`bakeTerrain: size must be a positive integer, got ${size}`);
	const step = colourStep ?? Math.max(1, Math.round(COLOUR_WORLD_UNITS / ((terrain.radius * 2) / size)));
	if (!Number.isInteger(step) || step < 1) throw new Error(`bakeTerrain: colourStep must be a positive integer, got ${step}`);
	const baker = new TerrainBaker({ terrain, size, step, ruins });
	// A row at a time, each its own call, so the engine optimises the row
	// whole rather than entering it mid-loop and leaving at every row's end.
	for (let row = 0; row < size; row++) baker.row(row);
	return baker.texels;
}

class TerrainBaker {
	public readonly texels: Uint8Array;
	private readonly terrain: BakeTerrain;
	private readonly size: number;
	private readonly radius: number;
	private readonly texel: number;
	private readonly step: number;
	private readonly nodes: number;
	private readonly colours: Float32Array;
	private readonly shades: ShadeLattice;
	private readonly cliffs: CliffLattice;
	private readonly outerSquared: number;
	private readonly innerSquared: number;

	constructor({ terrain, size, step, ruins }: { terrain: BakeTerrain; size: number; step: number; ruins: readonly Ruin[] }) {
		this.terrain = terrain;
		this.size = size;
		this.radius = terrain.radius;
		this.texel = (terrain.radius * 2) / size;
		this.step = step;
		this.nodes = latticeNodes(size, step);
		this.colours = colourLattice(terrain, size, step, ruins);
		this.shades = new ShadeLattice({ terrain, size });
		this.cliffs = new CliffLattice({ terrain, size });
		this.texels = new Uint8Array(size * size * 4);
		const radius = this.radius;
		const texel = this.texel;
		this.outerSquared = (radius + texel) * (radius + texel);
		this.innerSquared = radius > texel ? (radius - texel) * (radius - texel) : 0;
	}

	public row(row: number): void {
		const { radius, texel, step, nodes, colours, texels, outerSquared, innerSquared, terrain, shades } = this;
		const craters = terrain.hotspots;
		const water = terrain.water;
		const worldY = radius - (row + 0.5) * texel;
		const latticeRow = Math.min(nodes - 2, Math.floor(row / step));
		const fy = row / step - latticeRow;
		const shadeStep = shades.step;
		const shadeNodes = shades.nodes;
		const lights = shades.values;
		const shadeRow = Math.min(shadeNodes - 2, Math.floor(row / shadeStep));
		const shadeFy = row / shadeStep - shadeRow;
		// The disc's span of this row, so nothing past the rim is visited.
		const halfChord = Math.sqrt(Math.max(0, outerSquared - worldY * worldY));
		const first = Math.max(0, Math.floor((radius - halfChord) / texel - 0.5));
		const last = Math.min(this.size - 1, Math.ceil((radius + halfChord) / texel - 0.5));
		for (let column = first; column <= last; column++) {
			const worldX = -radius + (column + 0.5) * texel;
			const distanceSquared = worldX * worldX + worldY * worldY;
			if (distanceSquared >= outerSquared) continue;
			// R5.6's one-texel ramp, on the rim: the texel's share inside the disc.
			const coverage = distanceSquared <= innerSquared
				? 1
				: Math.min(1, Math.max(0, (radius - Math.sqrt(distanceSquared)) / texel + 0.5));
			if (coverage <= 0) continue;

			const latticeColumn = Math.min(nodes - 2, Math.floor(column / step));
			const fx = column / step - latticeColumn;
			const at = (latticeRow * nodes + latticeColumn) * CHANNELS;
			const below = at + nodes * CHANNELS;
			const shadeColumn = Math.min(shadeNodes - 2, Math.floor(column / shadeStep));
			const shadeNode = shadeRow * shadeNodes + shadeColumn;
			const light = bilinear(lights[shadeNode], lights[shadeNode + 1], lights[shadeNode + shadeNodes], lights[shadeNode + shadeNodes + 1], column / shadeStep - shadeColumn, shadeFy);
			const shade = light * bilinear(colours[at + 3], colours[at + CHANNELS + 3], colours[below + 3], colours[below + CHANNELS + 3], fx, fy);
			let red = Math.min(255, bilinear(colours[at], colours[at + CHANNELS], colours[below], colours[below + CHANNELS], fx, fy) * shade);
			let green = Math.min(255, bilinear(colours[at + 1], colours[at + CHANNELS + 1], colours[below + 1], colours[below + CHANNELS + 1], fx, fy) * shade);
			let blue = Math.min(255, bilinear(colours[at + 2], colours[at + CHANNELS + 2], colours[below + 2], colours[below + CHANNELS + 2], fx, fy) * shade);

			const inCrater = craterCoverage(craters, worldX, worldY, texel);
			if (inCrater < 1) {
				let obstacle = 0;
				let colour = OBSTACLE_COLOURS.cliff;
				if (water !== null && water.lakeDepth(worldX, worldY) > 0) {
					obstacle = 1;
					colour = this.onShore(water, worldX, worldY) ? OBSTACLE_COLOURS.shore : OBSTACLE_COLOURS.lake;
				} else {
					obstacle = this.cliffs.at(column, row);
				}
				if (obstacle > 0) {
					const amount = obstacle < 1 ? obstacle : 1;
					red += (colour[0] - red) * amount;
					green += (colour[1] - green) * amount;
					blue += (colour[2] - blue) * amount;
				}
			}
			if (inCrater > 0) {
				const colour = OBSTACLE_COLOURS.crater;
				red += (colour[0] - red) * inCrater;
				green += (colour[1] - green) * inCrater;
				blue += (colour[2] - blue) * inCrater;
			}

			const out = (row * this.size + column) * 4;
			texels[out] = red * coverage + 0.5;
			texels[out + 1] = green * coverage + 0.5;
			texels[out + 2] = blue * coverage + 0.5;
			texels[out + 3] = 255 * coverage + 0.5;
		}
	}

	/** Whether a lake texel at (x, y) has dry ground a texel away on any side: its shore. */
	private onShore(water: Pick<WaterLayer, 'lakeDepth'>, x: number, y: number): boolean {
		const texel = this.texel;
		return water.lakeDepth(x - texel, y) <= 0 || water.lakeDepth(x + texel, y) <= 0
			|| water.lakeDepth(x, y - texel) <= 0 || water.lakeDepth(x, y + texel) <= 0;
	}
}

/** Nodes along each side of a lattice every `step` texels: one past the last texel, so each texel has four around it. */
function latticeNodes(size: number, step: number): number {
	return Math.ceil((size - 1) / step) + 2;
}

/** What a colour lattice node holds: the land's red, green, and blue, then how much ruins darken the hill shade. */
const CHANNELS = 4;

/**
 * Per node, at every `step`th texel centre: the land's colour and the
 * ruins' shade. Nodes far enough past the rim that no texel inside the disc
 * reads them are skipped; the fields are defined past the rim, so a node
 * just outside is real land.
 */
function colourLattice(terrain: BakeTerrain, size: number, step: number, ruins: readonly Ruin[]): Float32Array {
	const radius = terrain.radius;
	const texel = (radius * 2) / size;
	const nodes = latticeNodes(size, step);
	const values = new Float32Array(nodes * nodes * CHANNELS);
	const sample = createTerrainSample();
	const colour = [0, 0, 0];
	const reach = radius + texel * (step * 1.5 + 1);
	const reachSquared = reach * reach;
	for (let row = 0; row < nodes; row++) {
		const worldY = radius - (row * step + 0.5) * texel;
		for (let column = 0; column < nodes; column++) {
			const worldX = -radius + (column * step + 0.5) * texel;
			if (worldX * worldX + worldY * worldY > reachSquared) continue;
			terrain.sample(worldX, worldY, sample);
			landColour(sample.elevation, sample.moisture, sample.contamination, colour);
			const at = (row * nodes + column) * CHANNELS;
			values[at] = colour[0];
			values[at + 1] = colour[1];
			values[at + 2] = colour[2];
			values[at + 3] = 1 - RUIN_SHADE * smooth(ruinAt(worldX, worldY, ruins));
		}
	}
	return values;
}

/**
 * Hill shade from the slope about every half land cell, every node the bake
 * reads: a slope costs a third of a full sample, so this lattice can be
 * finer than the colours'. Lit from the north-west, like the rest of the map.
 */
class ShadeLattice {
	public readonly step: number;
	public readonly nodes: number;
	public readonly values: Float32Array;

	constructor({ terrain, size }: { terrain: BakeTerrain; size: number }) {
		const radius = terrain.radius;
		const texel = (radius * 2) / size;
		const step = Math.max(1, Math.ceil(landGridFor(radius).cellSize / 2 / texel));
		const nodes = latticeNodes(size, step);
		const values = new Float32Array(nodes * nodes);
		const slope = { x: 0, y: 0 };
		const reach = radius + texel * (step * 1.5 + 1);
		const reachSquared = reach * reach;
		for (let row = 0; row < nodes; row++) {
			const worldY = radius - (row * step + 0.5) * texel;
			for (let column = 0; column < nodes; column++) {
				const worldX = -radius + (column * step + 0.5) * texel;
				if (worldX * worldX + worldY * worldY > reachSquared) continue;
				terrain.slope(worldX, worldY, slope);
				values[row * nodes + column] = Math.max(HILL_SHADE.min, Math.min(HILL_SHADE.max, 1 + (slope.y - slope.x) * HILL_SHADE.gain));
			}
		}
		this.step = step;
		this.nodes = nodes;
		this.values = values;
	}
}

/**
 * How far into a cliff the land is (`cliffDepth`) every `CLIFF_STEP`
 * texels, closed: each node takes the most round it, then the least of
 * that round it, which fills a notch or a gap in a band a node or two wide,
 * so an escarpment draws as one. A texel reads the nodes bilinear, its edge
 * anti-aliased over a texel by the field's own gradient there.
 */
class CliffLattice {
	private readonly nodes: number;
	private readonly values: Float32Array;

	constructor({ terrain, size }: { terrain: BakeTerrain; size: number }) {
		const radius = terrain.radius;
		const texel = (radius * 2) / size;
		const nodes = latticeNodes(size, CLIFF_STEP);
		const depths = new Float32Array(nodes * nodes).fill(-1);
		const reach = radius + texel * (CLIFF_STEP * 2.5 + 1);
		const reachSquared = reach * reach;
		for (let row = 0; row < nodes; row++) {
			const worldY = radius - (row * CLIFF_STEP + 0.5) * texel;
			for (let column = 0; column < nodes; column++) {
				const worldX = -radius + (column * CLIFF_STEP + 0.5) * texel;
				if (worldX * worldX + worldY * worldY > reachSquared) continue;
				depths[row * nodes + column] = Math.max(-1, terrain.cliffDepth(worldX, worldY));
			}
		}
		this.nodes = nodes;
		this.values = spread(spread(depths, nodes, Math.max), nodes, Math.min);
	}

	/** How much of the texel is cliff, 0 to 1. */
	public at(column: number, row: number): number {
		const nodes = this.nodes;
		const values = this.values;
		const latticeRow = Math.min(nodes - 2, Math.floor(row / CLIFF_STEP));
		const latticeColumn = Math.min(nodes - 2, Math.floor(column / CLIFF_STEP));
		const node = latticeRow * nodes + latticeColumn;
		const topLeft = values[node];
		const topRight = values[node + 1];
		const bottomLeft = values[node + nodes];
		const bottomRight = values[node + nodes + 1];
		if (topLeft < 0 && topRight < 0 && bottomLeft < 0 && bottomRight < 0) return 0;
		const depth = bilinear(topLeft, topRight, bottomLeft, bottomRight, column / CLIFF_STEP - latticeColumn, row / CLIFF_STEP - latticeRow);
		// The change in depth across a texel, so the edge ramps over one.
		const acrossX = (topRight - topLeft + bottomRight - bottomLeft) * 0.5 / CLIFF_STEP;
		const acrossY = (bottomLeft - topLeft + bottomRight - topRight) * 0.5 / CLIFF_STEP;
		const change = Math.sqrt(acrossX * acrossX + acrossY * acrossY);
		if (!(change > 0)) return depth >= 0 ? 1 : 0;
		return Math.min(1, Math.max(0, depth / change + 0.5));
	}
}

/** Each node of a square lattice `nodes` across set to `pick` of itself and its eight neighbours, held at the edges. */
function spread(values: Float32Array, nodes: number, pick: (a: number, b: number) => number): Float32Array {
	const across = new Float32Array(values.length);
	const out = new Float32Array(values.length);
	for (let row = 0; row < nodes; row++) {
		for (let column = 0; column < nodes; column++) {
			const at = row * nodes + column;
			across[at] = pick(values[at], pick(values[column > 0 ? at - 1 : at], values[column < nodes - 1 ? at + 1 : at]));
		}
	}
	for (let row = 0; row < nodes; row++) {
		for (let column = 0; column < nodes; column++) {
			const at = row * nodes + column;
			out[at] = pick(across[at], pick(across[row > 0 ? at - nodes : at], across[row < nodes - 1 ? at + nodes : at]));
		}
	}
	return out;
}

function bilinear(topLeft: number, topRight: number, bottomLeft: number, bottomRight: number, fx: number, fy: number): number {
	const top = topLeft + (topRight - topLeft) * fx;
	const bottom = bottomLeft + (bottomRight - bottomLeft) * fx;
	return top + (bottom - top) * fy;
}

/** How much of a texel at (x, y) lies in a crater: exact for a circle, anti-aliased over one texel. */
function craterCoverage(hotspots: readonly Hotspot[], x: number, y: number, texel: number): number {
	let coverage = 0;
	for (let index = 0; index < hotspots.length; index++) {
		const hotspot = hotspots[index];
		const dx = x - hotspot.x;
		const dy = y - hotspot.y;
		const reach = hotspot.craterRadius + texel;
		const squared = dx * dx + dy * dy;
		if (squared >= reach * reach) continue;
		const inside = (hotspot.craterRadius - Math.sqrt(squared)) / texel + 0.5;
		if (inside >= 1) return 1;
		if (inside > coverage) coverage = inside;
	}
	return coverage;
}

/** 1 inside a ruin, fading to 0 at twice its radius; the most of any ruin over (x, y). */
export function ruinAt(x: number, y: number, ruins: readonly Ruin[]): number {
	let most = 0;
	for (let index = 0; index < ruins.length && most < 1; index++) {
		const ruin = ruins[index];
		const dx = x - ruin.x;
		const dy = y - ruin.y;
		const ratio = (dx * dx + dy * dy) / (ruin.radius * ruin.radius);
		const weight = ratio <= 1 ? 1 : ratio >= 4 ? 0 : (4 - ratio) / 3;
		if (weight > most) most = weight;
	}
	return most;
}

/** Ruin's 0 to 1, eased so the edge of a ruin is soft rather than a ring. */
function smooth(value: number): number {
	const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
	return clamped * clamped * (3 - 2 * clamped);
}
