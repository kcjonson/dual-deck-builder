import { BIOMES, classifyBiome } from '../../map/Biome';
import { landGridFor } from '../../map/LandGrid';
import { CLIFF_GRADE, RELIEF, TerrainSample, WaterLayer, createTerrainSample } from '../../map/Terrain';
import type { Hotspot } from '../../map/TerrainSites';
import { BIOME_COLOURS, HILL_SHADE, OBSTACLE_COLOURS, RUIN_SHADE } from './areaMapStyle';

/**
 * The area map's terrain picture, baked once per map into premultiplied
 * RGBA8 texels for `DrawApi.createTexture` (Area Map Generation,
 * Performance: terrain bakes into one image, rebaked only when the map is
 * generated or loaded). No GL here, so it runs and is tested in Node.
 *
 * The texture covers the disc's bounding square, row 0 at the north edge.
 * A full terrain sample costs about 450 ns and a slope about 140
 * (terrain-erosion.md), so the bake reads the land on three lattices coarser
 * than the texels and interpolates between their nodes:
 *
 * - the fields biomes are read from, and the ruins' shade, every
 *   `colourStep` texels, where they change slowly. Each texel classifies
 *   its own biome from the fields interpolated there, so a biome's edge is
 *   a curve through the lattice rather than a staircase of its cells;
 * - hill shade from the slope about every half land cell, the finest the
 *   land's hills come: a coarser lattice draws the grid's cells as blocks;
 * - the slope every `CLIFF_STEP` texels, and only around rough country,
 *   the one place a cliff can stand. A texel in rough country is a cliff
 *   where the interpolated slope reaches the cliff grade, which draws the
 *   cliffs `Terrain.obstacle` reports, give or take a texel at their
 *   edges, for a quarter of the samples.
 *
 * Craters are circles, so they're drawn exactly, and water is asked per
 * texel. Obstacles take `obstacle`'s precedence: crater, water, cliff.
 * Texels past the rim are transparent, the rim itself anti-aliased.
 */

/** What the bake reads of a `Terrain`. */
export interface BakeTerrain {
	readonly radius: number;
	readonly hotspots: readonly Hotspot[];
	readonly water: WaterLayer | null;
	sample(x: number, y: number, out: TerrainSample): TerrainSample;
	slope<Out extends { x: number; y: number }>(x: number, y: number, out: Out): Out;
	rough(x: number, y: number): boolean;
}

export interface TerrainBakeOptions {
	terrain: BakeTerrain;
	/** Texels along each side of the disc's bounding square. */
	size: number;
	/** Texels between colour samples, 1 for every texel; about `COLOUR_WORLD_UNITS` apart when left out. */
	colourStep?: number;
}

export const TEXEL_WORLD_UNITS = 2.5;
export const MIN_BAKE_SIZE = 256;
export const MAX_BAKE_SIZE = 1024;
/** World units between colour samples: biomes span hundreds, and hills a few dozen at their finest. */
export const COLOUR_WORLD_UNITS = 16;
/** Texels between slope samples in rough country. */
export const CLIFF_STEP = 2;

const CLIFF_SLOPE_SQUARED = (CLIFF_GRADE / RELIEF) ** 2;
/** `BIOME_COLOURS` by index into `BIOMES`, three channels each. */
const BIOME_RGB = new Float32Array(BIOMES.flatMap((biome) => BIOME_COLOURS[biome]));
const BIOME_INDEX = Object.fromEntries(BIOMES.map((biome, index) => [biome, index])) as Record<string, number>;
/** How far either side of the cliff grade, in the slope's square, a cliff's edge ramps in: an anti-aliased edge, not a band. */
const CLIFF_RAMP = CLIFF_SLOPE_SQUARED * 0.15;

/**
 * Texels per side for a map of `radius`: about `TEXEL_WORLD_UNITS` a texel,
 * held between `MIN_BAKE_SIZE` and `MAX_BAKE_SIZE`, so the largest maps get
 * coarser texels rather than a longer bake.
 */
export function terrainBakeSize(radius: number): number {
	const size = Math.ceil((radius * 2) / TEXEL_WORLD_UNITS);
	return Math.max(MIN_BAKE_SIZE, Math.min(MAX_BAKE_SIZE, size));
}

export function bakeTerrain({ terrain, size, colourStep }: TerrainBakeOptions): Uint8Array {
	if (!Number.isInteger(size) || size < 1) throw new Error(`bakeTerrain: size must be a positive integer, got ${size}`);
	const step = colourStep ?? Math.max(1, Math.round(COLOUR_WORLD_UNITS / ((terrain.radius * 2) / size)));
	if (!Number.isInteger(step) || step < 1) throw new Error(`bakeTerrain: colourStep must be a positive integer, got ${step}`);
	const baker = new TerrainBaker({ terrain, size, step });
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
	private readonly fields: Float32Array;
	private readonly biomes: Uint8Array;
	private readonly shades: ShadeLattice;
	private readonly slopes: SlopeLattice;
	private readonly outerSquared: number;
	private readonly innerSquared: number;
	private readonly land = { lowland: 0, moisture: 0, contamination: 0, mountains: 0, canyons: 0, badlands: 0 };

	constructor({ terrain, size, step }: { terrain: BakeTerrain; size: number; step: number }) {
		this.terrain = terrain;
		this.size = size;
		this.radius = terrain.radius;
		this.texel = (terrain.radius * 2) / size;
		this.step = step;
		this.nodes = latticeNodes(size, step);
		const { fields, biomes } = fieldLattice(terrain, size, step);
		this.fields = fields;
		this.biomes = biomes;
		this.shades = new ShadeLattice({ terrain, size });
		this.slopes = new SlopeLattice({ terrain, size });
		this.texels = new Uint8Array(size * size * 4);
		const radius = this.radius;
		const texel = this.texel;
		this.outerSquared = (radius + texel) * (radius + texel);
		this.innerSquared = radius > texel ? (radius - texel) * (radius - texel) : 0;
	}

	public row(row: number): void {
		const { radius, texel, step, nodes, fields, biomes, texels, outerSquared, innerSquared, terrain, shades } = this;
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
			const node = latticeRow * nodes + latticeColumn;
			const at = node * FIELDS;
			const below = at + nodes * FIELDS;
			const shadeColumn = Math.min(shadeNodes - 2, Math.floor(column / shadeStep));
			const shadeNode = shadeRow * shadeNodes + shadeColumn;
			const light = bilinear(lights[shadeNode], lights[shadeNode + 1], lights[shadeNode + shadeNodes], lights[shadeNode + shadeNodes + 1], column / shadeStep - shadeColumn, shadeFy);
			const shade = light * bilinear(fields[at + 6], fields[at + FIELDS + 6], fields[below + 6], fields[below + FIELDS + 6], fx, fy);
			// Inside one biome's nodes the texel is that biome. Where they
			// differ, the biome is read off the fields interpolated at the
			// texel, so the edge is a curve through the lattice rather than
			// its cells' staircase.
			let biome = biomes[node];
			if (biomes[node + 1] !== biome || biomes[node + nodes] !== biome || biomes[node + nodes + 1] !== biome) {
				biome = this.classify(at, below, fx, fy);
			}
			let red = Math.min(255, BIOME_RGB[biome * 3] * shade);
			let green = Math.min(255, BIOME_RGB[biome * 3 + 1] * shade);
			let blue = Math.min(255, BIOME_RGB[biome * 3 + 2] * shade);

			const inCrater = craterCoverage(craters, worldX, worldY, texel);
			if (inCrater < 1) {
				let obstacle = 0;
				let colour = OBSTACLE_COLOURS.cliff;
				if (water !== null && water.isWater(worldX, worldY)) {
					obstacle = 1;
					colour = OBSTACLE_COLOURS.water;
				} else if (terrain.rough(worldX, worldY)) {
					obstacle = (this.slopes.at(column, row) - CLIFF_SLOPE_SQUARED) / CLIFF_RAMP + 0.5;
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

	/** The biome, as an index into `BIOMES`, at (fx, fy) in the lattice cell whose top-left node's fields start at `at`. */
	private classify(at: number, below: number, fx: number, fy: number): number {
		const { fields, land } = this;
		land.lowland = bilinear(fields[at], fields[at + FIELDS], fields[below], fields[below + FIELDS], fx, fy);
		land.moisture = bilinear(fields[at + 1], fields[at + FIELDS + 1], fields[below + 1], fields[below + FIELDS + 1], fx, fy);
		land.contamination = bilinear(fields[at + 2], fields[at + FIELDS + 2], fields[below + 2], fields[below + FIELDS + 2], fx, fy);
		land.mountains = bilinear(fields[at + 3], fields[at + FIELDS + 3], fields[below + 3], fields[below + FIELDS + 3], fx, fy);
		land.canyons = bilinear(fields[at + 4], fields[at + FIELDS + 4], fields[below + 4], fields[below + FIELDS + 4], fx, fy);
		land.badlands = bilinear(fields[at + 5], fields[at + FIELDS + 5], fields[below + 5], fields[below + FIELDS + 5], fx, fy);
		return BIOME_INDEX[classifyBiome(land)];
	}
}

/** Nodes along each side of a lattice every `step` texels: one past the last texel, so each texel has four around it. */
function latticeNodes(size: number, step: number): number {
	return Math.ceil((size - 1) / step) + 2;
}

/** What a field lattice node holds: the six fields biomes are read from, then the ruins' shade. */
const FIELDS = 7;

/**
 * Per node, at every `step`th texel centre: low ground, moisture,
 * contamination, mountains, canyons, badlands, and how much ruins darken
 * the hill shade. Nodes far enough past the rim that no
 * texel inside the disc reads them are skipped; the fields are defined past
 * the rim, so a node just outside is real land.
 */
function fieldLattice(terrain: BakeTerrain, size: number, step: number): { fields: Float32Array; biomes: Uint8Array } {
	const radius = terrain.radius;
	const texel = (radius * 2) / size;
	const nodes = latticeNodes(size, step);
	const values = new Float32Array(nodes * nodes * FIELDS);
	// Each node's own biome, as an index into BIOMES.
	const biomes = new Uint8Array(nodes * nodes);
	const sample = createTerrainSample();
	const reach = radius + texel * (step * 1.5 + 1);
	const reachSquared = reach * reach;
	for (let row = 0; row < nodes; row++) {
		const worldY = radius - (row * step + 0.5) * texel;
		for (let column = 0; column < nodes; column++) {
			const worldX = -radius + (column * step + 0.5) * texel;
			if (worldX * worldX + worldY * worldY > reachSquared) continue;
			terrain.sample(worldX, worldY, sample);
			const at = (row * nodes + column) * FIELDS;
			values[at] = sample.lowland;
			values[at + 1] = sample.moisture;
			values[at + 2] = sample.contamination;
			values[at + 3] = sample.mountains;
			values[at + 4] = sample.canyons;
			values[at + 5] = sample.badlands;
			values[at + 6] = 1 - RUIN_SHADE * smooth(sample.ruin);
			biomes[row * nodes + column] = BIOME_INDEX[sample.biome];
		}
	}
	return { fields: values, biomes };
}

/**
 * Hill shade from the slope about every half land cell, every node the bake
 * reads: a slope costs a third of a full sample, so this lattice can be
 * finer than the fields'. Lit from the north-west, like the rest of the map.
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
 * The slope's square every `CLIFF_STEP` texels, each node read from the
 * terrain the first time a texel needs it, so nothing is sampled away from
 * rough country.
 */
class SlopeLattice {
	private readonly terrain: BakeTerrain;
	private readonly radius: number;
	private readonly texel: number;
	private readonly nodes: number;
	private readonly values: Float32Array;
	private readonly slope = { x: 0, y: 0 };

	constructor({ terrain, size }: { terrain: BakeTerrain; size: number }) {
		this.terrain = terrain;
		this.radius = terrain.radius;
		this.texel = (terrain.radius * 2) / size;
		this.nodes = latticeNodes(size, CLIFF_STEP);
		this.values = new Float32Array(this.nodes * this.nodes).fill(-1);
	}

	/** The slope's square at a texel, bilinear between its four nodes. */
	public at(column: number, row: number): number {
		const nodes = this.nodes;
		const latticeRow = Math.min(nodes - 2, Math.floor(row / CLIFF_STEP));
		const latticeColumn = Math.min(nodes - 2, Math.floor(column / CLIFF_STEP));
		const node = latticeRow * nodes + latticeColumn;
		return bilinear(
			this.node(node, latticeColumn, latticeRow),
			this.node(node + 1, latticeColumn + 1, latticeRow),
			this.node(node + nodes, latticeColumn, latticeRow + 1),
			this.node(node + nodes + 1, latticeColumn + 1, latticeRow + 1),
			column / CLIFF_STEP - latticeColumn,
			row / CLIFF_STEP - latticeRow,
		);
	}

	private node(node: number, column: number, row: number): number {
		const known = this.values[node];
		if (known >= 0) return known;
		const slope = this.terrain.slope(
			-this.radius + (column * CLIFF_STEP + 0.5) * this.texel,
			this.radius - (row * CLIFF_STEP + 0.5) * this.texel,
			this.slope,
		);
		const squared = slope.x * slope.x + slope.y * slope.y;
		this.values[node] = squared;
		return squared;
	}
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

/** Ruin's 0 to 1, eased so the edge of a ruin is soft rather than a ring. */
function smooth(value: number): number {
	const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
	return clamped * clamped * (3 - 2 * clamped);
}
