import type { Rng } from '../core/Rng';
import { BIOME_THRESHOLDS } from './Biome';
import { Vector, unitVector } from './Geometry';
import type { Hazards } from './Hazards';
import { MapLabel, MapRange, mapLabels } from './MapLabels';
import { MAP_PARAMETERS, MapParams } from './MapParams';
import type { Places } from './Places';
import type { PoiLayer } from './Pois';
import { RailLine, railLines } from './RailLines';
import type { RoadNetwork } from './RoadNetwork';
import { StreetDistrict, streetGrids } from './StreetGrids';
import type { Terrain } from './Terrain';
import type { Water } from './Water';

/**
 * Stage 11 of area map generation, the dressing (Area Map Generation, 11.
 * Dressing): street grids, rail lines, contamination hatching and mire
 * stipple, and label candidates. It makes the page read as an atlas and
 * carries no gameplay: it reads every stage before it, writes nothing back,
 * isn't saved, and a load makes it again from the seed, the params, and the
 * map. Everything in it is plain data for the view to draw. The decision
 * record is docs/AI_TECHNICAL_DECISIONS/dressing.md.
 */

export interface Dressing {
	/** Each town's and village's street grid, and the metro's districts. */
	readonly districts: readonly StreetDistrict[];
	readonly rails: readonly RailLine[];
	/** Contamination round each crater, to hatch. */
	readonly hatches: readonly HatchRegion[];
	/** Dots stippled over mire, x, y per dot. */
	readonly stipple: Float64Array;
	/** The metro's name, as a place: its label is in capitals. */
	readonly metroName: string;
	/** Each highway's route number, by its number from 0 (`RoadStretch.highway`), for its shields. */
	readonly routeNumbers: readonly number[];
	/** The named ranges. */
	readonly ranges: readonly MapRange[];
	/** Every label the atlas could print, highest priority first. */
	readonly labels: readonly MapLabel[];
}

/** A crater's plume, hatched from the crater's rim out to where its contamination fades to `HATCH.level`. */
export interface HatchRegion {
	readonly x: number;
	readonly y: number;
	/** World units: the crater's radius... */
	readonly inner: number;
	/** ...and where the hatching stops. */
	readonly outer: number;
	/** The hatching's direction, a unit vector, and world units between its lines. */
	readonly ux: number;
	readonly uy: number;
	readonly spacing: number;
}

/**
 * - Hatching runs out to where a plume's contamination falls to `level`,
 *   `spacing` world units between lines at the dressing's default, closer
 *   as it rises, at `angle` degrees turned up to `turn` either way per crater.
 * - Mire is stippled a dot a cell of a grid `spacing` world units across at
 *   the default, each dot anywhere in its cell, the cells finer as the
 *   dressing rises.
 * - Route numbers are drawn from `least` to `most`, no two alike.
 */
export const HATCH = { level: 0.15, spacing: 8, angle: 45, turn: 15 } as const;
export const STIPPLE = { spacing: 12 } as const;
export const ROUTE_NUMBERS = { least: 2, most: 99 } as const;

/** What the dressing reads: the products of every stage before it. */
export interface DressingInputs {
	readonly params: Pick<MapParams, 'radius' | 'dressing' | 'streetGrids' | 'railLines'>;
	readonly water: Water;
	/** `hazards.terrain` is the land with its water and hazards. */
	readonly hazards: Hazards;
	readonly places: Places;
	readonly network: RoadNetwork;
	readonly pois: PoiLayer;
	/** Each POI's name, in the layer's order. */
	readonly poiNames: readonly string[];
	/** The stage's stream; each part forks its own from it by name. */
	readonly rng: Rng;
}

/**
 * `dressing` over its default: 1 at the default, 0 with no dressing. The
 * parts with a parameter of their own (`streetGrids`, `railLines`) thin
 * below the default and keep to their parameter above it; the rest
 * (hatching, stipple, which features are labelled) scale on up.
 */
export function dressingScale(dressing: number): number {
	return dressing / MAP_PARAMETERS.dressing.default;
}

// Read once, at load: under Jest's vm context each global read costs about 0.15 us (seeded-prng.md).
const floor = Math.floor;
const round = Math.round;
const sqrt = Math.sqrt;

/** The dressing over a finished map. Nothing it's given is changed. */
export function generateDressing({ params, water, hazards, places, network, pois, poiNames, rng }: DressingInputs): Dressing {
	const terrain = hazards.terrain;
	const scale = dressingScale(params.dressing);
	const thinned = scale < 1 ? scale : 1;
	const highways = places.exits.filter(({ highway }) => highway).length;
	const routeNumbers = drawRouteNumbers(highways, rng.fork('routes'));
	const names = mapLabels({
		radius: params.radius, land: terrain.surface, water: water.surface, places, network, pois, poiNames, routeNumbers, scale, rng: rng.fork('names'),
	});
	const rails = railLines({
		ground: terrain, grid: terrain.surface.grid, mountains: terrain.surface.mountains, lowland: water.surface.lowland, area: water.surface.area, threshold: water.surface.threshold,
		count: round(params.railLines * thinned), rng: rng.fork('rails'),
	});
	// Roads, collapsed spans, and rails all run through the grids, so their blocks are street.
	const lines = [...network.stretches, ...network.broken, ...rails];
	const ground = { obstacle: (x: number, y: number) => terrain.obstacle(x, y), nearRiver: (x: number, y: number, reach: number) => water.nearRiver(x, y, reach) };
	return Object.freeze({
		districts: Object.freeze(streetGrids({ places, lines, ground, built: params.streetGrids, cover: thinned, rng: rng.fork('grids') })),
		rails: Object.freeze(rails),
		hatches: Object.freeze(hatchRegions({ hazards, radius: params.radius, scale, rng: rng.fork('hatches') })),
		stipple: mireStipple({ terrain, water, scale, rng: rng.fork('stipple') }),
		metroName: names.metro,
		routeNumbers: Object.freeze(routeNumbers),
		ranges: names.ranges,
		labels: names.labels,
	});
}

/** A dressing that crossed the worker boundary frozen again, as generation leaves it; its typed arrays can't be, and nothing writes them. */
export function freezeDressing({ districts, rails, hatches, stipple, metroName, routeNumbers, ranges, labels }: Dressing): Dressing {
	return Object.freeze({
		districts: Object.freeze(districts.map((district) => Object.freeze({ ...district }))),
		rails: Object.freeze(rails.map(({ points, length, bridges }) => Object.freeze({ points: Object.freeze(points), length, bridges: Object.freeze(bridges.map((deck) => Object.freeze(deck))) }))),
		hatches: Object.freeze(hatches.map((hatch) => Object.freeze(hatch))),
		stipple,
		metroName,
		routeNumbers: Object.freeze(routeNumbers),
		ranges: Object.freeze(ranges.map((range) => Object.freeze(range))),
		labels: Object.freeze(labels.map(({ path, ...label }) => Object.freeze({ ...label, path: Object.freeze(path) }))),
	});
}

/** A distinct route number per highway. */
function drawRouteNumbers(count: number, rng: Rng): number[] {
	const numbers: number[] = [];
	for (let number = ROUTE_NUMBERS.least; number <= ROUTE_NUMBERS.most; number += 1) numbers.push(number);
	return rng.shuffle(numbers).slice(0, count);
}

/** Each crater inside the disc whose plume is strong enough, hatched out to where it fades. */
function hatchRegions({ hazards, radius, scale, rng }: { hazards: Pick<Hazards, 'hotspots'>; radius: number; scale: number; rng: Rng }): HatchRegion[] {
	if (scale <= 0) return [];
	const towards: Vector = { x: 0, y: 0 };
	const regions: HatchRegion[] = [];
	hazards.hotspots.forEach(({ x, y, craterRadius, plumeRadius, strength }) => {
		const turn = (rng.float() * 2 - 1) * HATCH.turn;
		if (x * x + y * y > radius * radius || strength <= HATCH.level) return;
		// A plume is strength * (1 - d^2 / r^2)^2, so it falls to the level at r * sqrt(1 - sqrt(level / strength)).
		const outer = plumeRadius * sqrt(1 - sqrt(HATCH.level / strength));
		if (outer <= craterRadius) return;
		unitVector(HATCH.angle + turn, towards);
		regions.push(Object.freeze({ x, y, inner: craterRadius, outer, ux: towards.x, uy: towards.y, spacing: HATCH.spacing / scale }));
	});
	return regions;
}

/** A dot in each cell of a grid over the disc where it lands on mire and no water. */
function mireStipple({ terrain, water, scale, rng }: { terrain: Pick<Terrain, 'radius' | 'biome' | 'waterAt'>; water: Pick<Water, 'lowland'>; scale: number; rng: Rng }): Float64Array {
	if (scale <= 0) return new Float64Array(0);
	const spacing = STIPPLE.spacing / sqrt(scale);
	const radius = terrain.radius;
	const cells = floor(2 * radius / spacing) + 1;
	const dots: number[] = [];
	for (let row = 0; row < cells; row += 1) {
		for (let column = 0; column < cells; column += 1) {
			// Every cell takes its two draws, so one cell's dot never moves another's.
			const x = -radius + (column + rng.float()) * spacing;
			const y = -radius + (row + rng.float()) * spacing;
			// Mire is only ever low ground, which is cheap to ask first.
			if (x * x + y * y > radius * radius || water.lowland(x, y) < BIOME_THRESHOLDS.mireLowland) continue;
			if (terrain.biome(x, y) === 'mire' && terrain.waterAt(x, y) === null) dots.push(x, y);
		}
	}
	return Float64Array.from(dots);
}
