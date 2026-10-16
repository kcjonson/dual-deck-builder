import { landGridFor } from '../../map/LandGrid';
import { TerrainSample, WaterLayer, createTerrainSample } from '../../map/Terrain';
import type { Hotspot, Ruin } from '../../map/TerrainSites';
import { BUILT_UP, CRATER_STYLE, HILL_SHADE, OBSTACLE_COLOURS, PAPER, RIM, TOXIC_HATCH, landColour } from './areaMapStyle';

/**
 * The area map's terrain picture, baked once per map into premultiplied
 * RGBA8 texels for `DrawApi.createTexture` (Area Map Generation,
 * Performance: terrain bakes into one image, rebaked only when the map is
 * generated or loaded), styled as a page of a road atlas (Rendering: the
 * road atlas). No GL here, so it runs and is tested in Node.
 *
 * The texture covers the disc's bounding square, row 0 at the north edge.
 * A full terrain sample costs about half a microsecond and a slope about
 * 140 ns (terrain-erosion.md), so the bake reads the land on three lattices
 * coarser than the texels and interpolates between their nodes:
 *
 * - the land's colour, a continuous blend of elevation, moisture, and
 *   contamination (`landColour`), how strongly it's hill-shaded, and its
 *   contamination for the hatching, every `colourStep` texels, where they
 *   change slowly. Biomes are categories the game reads, never paint, so
 *   country shades from one kind to the next;
 * - hill shade from the slope about every half land cell, the finest the
 *   land's hills come, read bicubic so its cells never show as facets, and
 *   squashed through a tanh so it's never harsh;
 * - how far into a cliff the land is (`Terrain.cliffDepth`) every
 *   `CLIFF_STEP` texels, closed so a notch or gap a node or two wide in a
 *   band fills in, drawn as a soft scarp shade.
 *
 * Per texel over that: contamination hatched, towns and villages as
 * built-up patches, lakes from the water's depth field with a darker shore,
 * craters as craters with each plume's edge dashed, and the rim faded toward
 * paper with a dashed edge. Rivers aren't baked: the view draws them live,
 * under the roads. Texels past the rim are transparent, the rim itself
 * anti-aliased, so the view's paper shows there.
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

/** A place drawn as a built-up patch: a village plain, the metro and towns with a street grid. */
export interface BuiltUpPlace extends Ruin {
	readonly kind?: 'metro' | 'town' | 'village';
}

export interface TerrainBakeOptions {
	terrain: BakeTerrain;
	/** Texels along each side of the disc's bounding square. */
	size: number;
	/** Texels between colour samples, 1 for every texel; about `COLOUR_WORLD_UNITS` apart when left out. */
	colourStep?: number;
	/** The metro, towns, and villages, drawn as built-up patches; none when left out. */
	ruins?: readonly BuiltUpPlace[];
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

/** A colour being worked on, 0 to 255 a channel. */
interface Ink {
	red: number;
	green: number;
	blue: number;
}

/** `ink` moved `amount` of the way to `colour`. */
function mix(ink: Ink, colour: readonly number[], amount: number): void {
	ink.red += (colour[0] - ink.red) * amount;
	ink.green += (colour[1] - ink.green) * amount;
	ink.blue += (colour[2] - ink.blue) * amount;
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
	private readonly builtUp: BuiltUp;
	private readonly outerSquared: number;
	private readonly innerSquared: number;
	/** Inside this, squared, the rim neither fades nor is lined. */
	private readonly rimSquared: number;
	private readonly ink: Ink = { red: 0, green: 0, blue: 0 };

	constructor({ terrain, size, step, ruins }: { terrain: BakeTerrain; size: number; step: number; ruins: readonly BuiltUpPlace[] }) {
		this.terrain = terrain;
		this.size = size;
		this.radius = terrain.radius;
		this.texel = (terrain.radius * 2) / size;
		this.step = step;
		this.nodes = latticeNodes(size, step);
		this.colours = colourLattice(terrain, size, step);
		this.shades = new ShadeLattice({ terrain, size });
		this.cliffs = new CliffLattice({ terrain, size });
		this.builtUp = new BuiltUp({ ruins, texel: this.texel });
		this.texels = new Uint8Array(size * size * 4);
		const radius = this.radius;
		const texel = this.texel;
		this.outerSquared = (radius + texel) * (radius + texel);
		this.innerSquared = radius > texel ? (radius - texel) * (radius - texel) : 0;
		const rimInner = Math.max(0, Math.min(radius * (1 - RIM.fade), radius - texel * 2.5));
		this.rimSquared = rimInner * rimInner;
	}

	public row(row: number): void {
		const { radius, texel, step, nodes, colours, texels, outerSquared, innerSquared, terrain, shades, ink } = this;
		const water = terrain.water;
		const worldY = radius - (row + 0.5) * texel;
		const latticeRow = Math.min(nodes - 2, Math.floor(row / step));
		const fy = row / step - latticeRow;
		const lights = shades.rowAt(row);
		const shadeStep = shades.step;
		const ruins = this.builtUp.rowAt(worldY);
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
			const relief = bilinear(colours[at + 3], colours[at + CHANNELS + 3], colours[below + 3], colours[below + CHANNELS + 3], fx, fy);
			const shade = 1 + relief * cubicRow(lights, column / shadeStep);
			ink.red = bilinear(colours[at], colours[at + CHANNELS], colours[below], colours[below + CHANNELS], fx, fy) * shade;
			ink.green = bilinear(colours[at + 1], colours[at + CHANNELS + 1], colours[below + 1], colours[below + CHANNELS + 1], fx, fy) * shade;
			ink.blue = bilinear(colours[at + 2], colours[at + CHANNELS + 2], colours[below + 2], colours[below + CHANNELS + 2], fx, fy) * shade;

			const contamination = bilinear(colours[at + 4], colours[at + CHANNELS + 4], colours[below + 4], colours[below + CHANNELS + 4], fx, fy);
			if (contamination > TOXIC_HATCH.from) this.hatch(worldX, worldY, contamination);
			if (ruins.length > 0) this.builtUp.draw(ruins, worldX, worldY, ink);

			if (water !== null && water.lakeDepth(worldX, worldY) > 0) {
				const colour = this.onShore(water, worldX, worldY) ? OBSTACLE_COLOURS.shore : OBSTACLE_COLOURS.lake;
				ink.red = colour[0];
				ink.green = colour[1];
				ink.blue = colour[2];
			} else {
				const cliff = this.cliffs.at(column, row);
				if (cliff > 0) mix(ink, OBSTACLE_COLOURS.cliff, (cliff < 1 ? cliff : 1) * OBSTACLE_COLOURS.cliffWeight);
			}
			this.hotspots(worldX, worldY);
			if (distanceSquared > this.rimSquared) this.rim(worldX, worldY, Math.sqrt(distanceSquared));

			const out = (row * this.size + column) * 4;
			texels[out] = Math.min(255, ink.red) * coverage + 0.5;
			texels[out + 1] = Math.min(255, ink.green) * coverage + 0.5;
			texels[out + 2] = Math.min(255, ink.blue) * coverage + 0.5;
			texels[out + 3] = 255 * coverage + 0.5;
		}
	}

	/** Diagonal rust lines over contaminated land, anti-aliased over a texel, stronger the worse it is. */
	private hatch(x: number, y: number, contamination: number): void {
		const { spacing, width, from, to, weight } = TOXIC_HATCH;
		const strength = smooth((contamination - from) / (to - from)) * weight;
		const across = ((x + y) * Math.SQRT1_2) % spacing;
		const along = across < 0 ? across + spacing : across;
		const distance = along < spacing / 2 ? along : spacing - along;
		const line = (width / 2 - distance) / this.texel + 0.5;
		if (line > 0) mix(this.ink, TOXIC_HATCH.colour, (line < 1 ? line : 1) * strength);
	}

	/** Craters over everything, as craters: rim, floor, and core; and each plume's edge a dashed ring. */
	private hotspots(x: number, y: number): void {
		const hotspots = this.terrain.hotspots;
		const texel = this.texel;
		const ink = this.ink;
		const { rim, core, ring } = CRATER_STYLE;
		for (let index = 0; index < hotspots.length; index++) {
			const hotspot = hotspots[index];
			const dx = x - hotspot.x;
			const dy = y - hotspot.y;
			const squared = dx * dx + dy * dy;
			const plumeOuter = hotspot.plumeRadius + texel;
			if (squared >= plumeOuter * plumeOuter) continue;
			const crater = hotspot.craterRadius;
			const plumeInner = hotspot.plumeRadius - texel;
			if (squared > plumeInner * plumeInner) {
				const distance = Math.sqrt(squared);
				const onRing = 1 - Math.abs(distance - hotspot.plumeRadius) / (texel * 0.75);
				if (onRing > 0 && dashOn(Math.atan2(dy, dx) * hotspot.plumeRadius, ring.dash)) mix(ink, ring.colour, onRing * ring.weight);
				continue;
			}
			const craterOuter = crater + texel;
			if (squared >= craterOuter * craterOuter) continue;
			const distance = Math.sqrt(squared);
			const inside = Math.min(1, (crater - distance) / texel + 0.5);
			if (inside <= 0) continue;
			const share = distance / crater;
			const colour = share > 1 - rim ? CRATER_STYLE.rimColour : share < core ? CRATER_STYLE.coreColour : CRATER_STYLE.floor;
			mix(ink, colour, inside);
		}
	}

	/** The rim: the land faded toward paper over its last stretch, and a dashed line a texel or so inside the edge. */
	private rim(x: number, y: number, distance: number): void {
		const radius = this.radius;
		const texel = this.texel;
		const into = (distance - radius * (1 - RIM.fade)) / (radius * RIM.fade);
		if (into > 0) mix(this.ink, PAPER, smooth(into) * RIM.fadeWeight);
		const onLine = 1 - Math.abs(distance - (radius - texel * 1.5)) / texel;
		if (onLine > 0 && dashOn(Math.atan2(y, x) * radius, RIM.dash)) mix(this.ink, RIM.line, onLine * RIM.lineWeight);
	}

	/** Whether a lake texel at (x, y) has dry ground a texel away on any side: its shore. */
	private onShore(water: Pick<WaterLayer, 'lakeDepth'>, x: number, y: number): boolean {
		const texel = this.texel;
		return water.lakeDepth(x - texel, y) <= 0 || water.lakeDepth(x + texel, y) <= 0
			|| water.lakeDepth(x, y - texel) <= 0 || water.lakeDepth(x, y + texel) <= 0;
	}
}

/** Whether `along` world units round a circle falls on a dash of `dash` units, the gaps as long. */
function dashOn(along: number, dash: number): boolean {
	const phase = (along / dash) % 2;
	return (phase < 0 ? phase + 2 : phase) < 1;
}

/** Nodes along each side of a lattice every `step` texels: one past the last texel, so each texel has four around it. */
function latticeNodes(size: number, step: number): number {
	return Math.ceil((size - 1) / step) + 2;
}

/** What a colour lattice node holds: the land's red, green, and blue, how strongly it's hill-shaded, and its contamination. */
const CHANNELS = 5;

/**
 * Per node, at every `step`th texel centre: the land's colour, its hill
 * shade's strength (stronger in high country), and its contamination. Nodes
 * far enough past the rim that no texel inside the disc reads them are
 * skipped; the fields are defined past the rim, so a node just outside is
 * real land.
 */
function colourLattice(terrain: BakeTerrain, size: number, step: number): Float32Array {
	const radius = terrain.radius;
	const texel = (radius * 2) / size;
	const nodes = latticeNodes(size, step);
	const values = new Float32Array(nodes * nodes * CHANNELS);
	const sample = createTerrainSample();
	const colour = [0, 0, 0];
	const reach = radius + texel * (step * 1.5 + 1);
	const reachSquared = reach * reach;
	const { low, high, from, to } = HILL_SHADE;
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
			values[at + 3] = low + (high - low) * smooth((sample.elevation - from) / (to - from));
			values[at + 4] = sample.contamination;
		}
	}
	return values;
}

/**
 * Hill shade from the slope about every half land cell: a slope costs a
 * third of a full sample, so this lattice can be finer than the colours'.
 * Lit from the north-west, like the rest of the map, and squashed through a
 * tanh to -1 to 1 so the steepest ground is never harsh, the lit side
 * weaker (`HILL_SHADE.light`). Read bicubic, a row
 * at a time (`rowAt`, then `cubicRow` along it), so the land grid's cells
 * never show as facets.
 */
class ShadeLattice {
	public readonly step: number;
	private readonly nodes: number;
	private readonly values: Float32Array;
	/** One texel row's shade at every lattice column, interpolated down the columns. */
	private readonly row: Float32Array;

	constructor({ terrain, size }: { terrain: BakeTerrain; size: number }) {
		const radius = terrain.radius;
		const texel = (radius * 2) / size;
		const step = Math.max(1, Math.ceil(landGridFor(radius).cellSize / 2 / texel));
		const nodes = latticeNodes(size, step);
		const values = new Float32Array(nodes * nodes);
		const slope = { x: 0, y: 0 };
		// Bicubic reads a node further out than bilinear does.
		const reach = radius + texel * (step * 2.5 + 1);
		const reachSquared = reach * reach;
		for (let row = 0; row < nodes; row++) {
			const worldY = radius - (row * step + 0.5) * texel;
			for (let column = 0; column < nodes; column++) {
				const worldX = -radius + (column * step + 0.5) * texel;
				if (worldX * worldX + worldY * worldY > reachSquared) continue;
				terrain.slope(worldX, worldY, slope);
				const lit = Math.tanh((slope.y - slope.x) * HILL_SHADE.gain);
				values[row * nodes + column] = lit > 0 ? lit * HILL_SHADE.light : lit;
			}
		}
		this.step = step;
		this.nodes = nodes;
		this.values = values;
		this.row = new Float32Array(nodes);
	}

	/** Texel row `row`'s shade at each lattice column, for `cubicRow`. Reused: valid until the next call. */
	public rowAt(row: number): Float32Array {
		const { nodes, values, step } = this;
		const along = row / step;
		const node = Math.min(nodes - 2, Math.floor(along));
		const fraction = along - node;
		const above = Math.max(0, node - 1) * nodes;
		const at = node * nodes;
		const below = (node + 1) * nodes;
		const further = Math.min(nodes - 1, node + 2) * nodes;
		for (let column = 0; column < nodes; column++) {
			this.row[column] = catmullRom(values[above + column], values[at + column], values[below + column], values[further + column], fraction);
		}
		return this.row;
	}
}

/** A lattice row read bicubic at `along` nodes. */
function cubicRow(row: Float32Array, along: number): number {
	const last = row.length - 1;
	const node = Math.min(last - 1, Math.floor(along));
	return catmullRom(row[node > 0 ? node - 1 : 0], row[node], row[node + 1], row[node + 2 > last ? last : node + 2], along - node);
}

/** The Catmull-Rom spline through four evenly spaced values, `t` of the way from the second to the third. */
function catmullRom(before: number, from: number, to: number, after: number, t: number): number {
	return from + 0.5 * t * (to - before + t * (2 * before - 5 * from + 4 * to - after + t * (3 * (from - to) + after - before)));
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

/** A built-up patch as the bake draws it. */
interface Patch {
	readonly x: number;
	readonly y: number;
	readonly radius: number;
	/** The farthest its ragged edge reaches, plus a texel. */
	readonly reach: number;
	readonly grid: boolean;
	/** Its street grid's turn, as a unit vector. */
	readonly cos: number;
	readonly sin: number;
	/** Where its edge's two waves start, radians. */
	readonly phase3: number;
	readonly phase5: number;
}

/**
 * Towns and villages as built-up patches (Rendering: the road atlas), until
 * the dressing's street grids: a flat pale fill inside a ragged edge, with a
 * street grid on the metro and towns. Each place's turn and edge come from
 * its position, so a map bakes the same every time.
 */
class BuiltUp {
	private readonly patches: readonly Patch[];
	private readonly texel: number;
	private readonly found: Patch[] = [];
	private foundY = NaN;

	constructor({ ruins, texel }: { ruins: readonly BuiltUpPlace[]; texel: number }) {
		this.texel = texel;
		this.patches = ruins.map((ruin) => {
			const hash = positionHash(ruin.x, ruin.y);
			const turn = ((hash & 0xffff) / 0x10000) * (Math.PI / 2);
			return {
				x: ruin.x,
				y: ruin.y,
				radius: ruin.radius,
				reach: ruin.radius * (1 + BUILT_UP.ragged) + texel,
				grid: ruin.kind !== 'village',
				cos: Math.cos(turn),
				sin: Math.sin(turn),
				phase3: ((hash >>> 16) & 0xff) / 40,
				phase5: ((hash >>> 24) & 0xff) / 40,
			};
		});
	}

	/** The patches a texel row at world `y` crosses. Reused: valid until the next call. */
	public rowAt(y: number): readonly Patch[] {
		if (y === this.foundY) return this.found;
		this.foundY = y;
		this.found.length = 0;
		for (const patch of this.patches) if (Math.abs(y - patch.y) < patch.reach) this.found.push(patch);
		return this.found;
	}

	/** Any patch over (x, y), mixed into `ink`. */
	public draw(patches: readonly Patch[], x: number, y: number, ink: Ink): void {
		const texel = this.texel;
		for (let index = 0; index < patches.length; index++) {
			const patch = patches[index];
			const dx = x - patch.x;
			const dy = y - patch.y;
			const squared = dx * dx + dy * dy;
			if (squared >= patch.reach * patch.reach) continue;
			const distance = Math.sqrt(squared);
			const angle = Math.atan2(dy, dx);
			const wave = 0.6 * Math.sin(3 * angle + patch.phase3) + 0.4 * Math.sin(5 * angle + patch.phase5);
			const edge = patch.radius * (1 + BUILT_UP.ragged * wave);
			const inside = (edge - distance) / texel + 0.5;
			if (inside <= 0) continue;
			const cover = inside < 1 ? inside : 1;
			mix(ink, BUILT_UP.fill, cover);
			if (patch.grid) {
				const { spacing, width, colour } = BUILT_UP.street;
				const street = Math.max(gridLine(dx * patch.cos + dy * patch.sin, spacing, width, texel), gridLine(dy * patch.cos - dx * patch.sin, spacing, width, texel));
				if (street > 0) mix(ink, colour, street * cover);
			}
			return;
		}
	}
}

/** How much of a texel at `along` lies on a line `width` wide every `spacing`, anti-aliased over the texel. */
function gridLine(along: number, spacing: number, width: number, texel: number): number {
	const into = along % spacing;
	const wrapped = into < 0 ? into + spacing : into;
	const distance = wrapped < spacing / 2 ? wrapped : spacing - wrapped;
	const cover = (width / 2 - distance) / texel + 0.5;
	return cover <= 0 ? 0 : cover >= 1 ? 1 : cover;
}

/** A 32-bit hash of a world position rounded to the unit, the same in every engine. */
function positionHash(x: number, y: number): number {
	let hash = Math.imul(Math.round(x) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y) | 0, 0x165667b1);
	hash = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b);
	hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35);
	return (hash ^ (hash >>> 16)) >>> 0;
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

/** 0 to 1, eased at both ends. */
function smooth(value: number): number {
	const clamped = value <= 0 ? 0 : value >= 1 ? 1 : value;
	return clamped * clamped * (3 - 2 * clamped);
}
