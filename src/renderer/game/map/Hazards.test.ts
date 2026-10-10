import { Rng } from '../core/Rng';
import { CRATER_DRAINAGE, HOTSPOT_OUTER, Hazards, generateHazards } from './Hazards';
import { startRadii } from './Land';
import { cellCentre } from './LandGrid';
import { MapParamSet, MapParams, resolveMapParams } from './MapParams';
import { validateMapParams } from './ParamValidator';
import { generateTerrain } from './Terrain';
import { CRATER_GAP, HOTSPOT_SPACING, MAX_CRATER_RADIUS } from './TerrainSites';
import { Water, generateWater } from './Water';

const paramsFor = (set: MapParamSet): MapParams => validateMapParams(resolveMapParams(set).params).params;
/** The water stream as the pipeline nests it, and the hazards' under it. */
const waterStream = (seed: number) => new Rng({ seed }).fork('map', 0).fork('terrain', 0).fork('water', 0);

/** Erosion makes a terrain dear to build, so each set's water is built once a file. */
const waters = new Map<string, Water>();
function waterFor(set: MapParamSet): Water {
	const key = JSON.stringify(set);
	let water = waters.get(key);
	if (!water) {
		const params = paramsFor(set);
		const land = generateTerrain({ params, rng: new Rng({ seed: params.seed }).fork('map', 0).fork('terrain', 0) });
		water = generateWater({ params, terrain: land, rng: waterStream(params.seed) });
		waters.set(key, water);
	}
	return water;
}
/** The hazards over a set's water; `hotspots` asks for another count over the same water, which reads none. */
function hazardsFor(set: MapParamSet, attempt = 0, hotspots?: number): Hazards {
	const params = paramsFor(hotspots === undefined ? set : { ...set, hotspots });
	return generateHazards({ params, terrain: waterFor(set).terrain, rng: waterStream(params.seed).fork('hazards', attempt) });
}

/** The most hotspots, on wet and dry maps, a closed basin, and the smallest metro, at radius 800 and 600. */
const SETS: [string, MapParamSet][] = [
	['Mixed', { seed: 7, radius: 800, hotspots: 6 }],
	['Rust Belt', { seed: 11, environment: 'rustBelt', radius: 800, hotspots: 6 }],
	['Floodlands', { seed: 5, environment: 'floodlands', radius: 800, hotspots: 6, lakes: 8 }],
	['Badlands', { seed: 13, environment: 'badlands', radius: 800, hotspots: 6 }],
	['a closed basin', { seed: 17, environment: 'floodlands', radius: 800, rivers: 0, hotspots: 6 }],
	['the wettest, densest corner', { seed: 19, radius: 600, aridity: 1, riverDensity: 1, lakes: 8, hotspots: 6, metroSize: 0.08 }],
];

describe('generateHazards', () => {
	it.each(SETS)('places every hotspot asked for, each an impassable crater in a plume of contamination, in %s', (_name, set) => {
		const hazards = hazardsFor(set);
		const { terrain } = hazards;
		expect(hazards.hotspots).toHaveLength(paramsFor(set).hotspots);
		hazards.hotspots.forEach((hotspot) => {
			expect(terrain.obstacle(hotspot.x, hotspot.y)).toBe('crater');
			expect(terrain.moveCost(hotspot.x + hotspot.craterRadius * 2, hotspot.y, hotspot.x, hotspot.y, 'trail')).toBe(Infinity);
			expect(terrain.contamination(hotspot.x, hotspot.y)).toBeGreaterThanOrEqual(hotspot.strength);
			expect(terrain.obstacle(hotspot.x + hotspot.craterRadius * 1.01, hotspot.y)).not.toBe('crater');
		});
		// The water stage's land with its water stays as it was; only the hazards' terrain has craters.
		hazards.hotspots.forEach(({ x, y }) => expect(waterFor(set).terrain.obstacle(x, y)).not.toBe('crater'));
	});

	// Map 5's rules for craters, kept now they come after the water: past the metro's blend by the largest crater, inside 0.9 of the radius, a quarter of the radius apart, and off the land's drainage.
	it.each(SETS)('keeps the old crater rules: out of the metro, spread out, and off the land\'s drainage, in %s', (_name, set) => {
		const params = paramsFor(set);
		const { hotspots, terrain } = hazardsFor(set);
		const { grid, drainage } = terrain.surface;
		hotspots.forEach((hotspot, index) => {
			const fromCentre = Math.hypot(hotspot.x, hotspot.y);
			expect(fromCentre).toBeGreaterThanOrEqual(startRadii(params).blendRadius + MAX_CRATER_RADIUS);
			expect(fromCentre - hotspot.craterRadius).toBeGreaterThan(terrain.metro.radius);
			expect(fromCentre).toBeLessThanOrEqual(HOTSPOT_OUTER * params.radius);
			hotspots.slice(index + 1).forEach((other) => expect(Math.hypot(hotspot.x - other.x, hotspot.y - other.y)).toBeGreaterThanOrEqual(HOTSPOT_SPACING * params.radius));
			const reach = hotspot.craterRadius + CRATER_DRAINAGE.margin * grid.cellSize;
			for (let row = 0; row < grid.size; row += 1) {
				for (let column = 0; column < grid.size; column += 1) {
					if (Math.hypot(cellCentre(grid, column) - hotspot.x, cellCentre(grid, row) - hotspot.y) > reach) continue;
					expect(drainage.area[row * grid.size + column]).toBeLessThan(CRATER_DRAINAGE.area);
				}
			}
		});
	});

	it.each(SETS)('keeps every crater off the rivers and clear of the lakes, in %s', (_name, set) => {
		const water = waterFor(set);
		const { hotspots } = hazardsFor(set);
		const { grid, lakeOf } = water.surface;
		hotspots.forEach(({ x, y, craterRadius }) => {
			for (let ring = 0; ring <= craterRadius; ring += 2) {
				for (let step = 0; step < 48; step += 1) {
					const angle = (step / 48) * 2 * Math.PI;
					expect(water.waterAt(x + ring * Math.cos(angle), y + ring * Math.sin(angle))).toBeNull();
				}
			}
			for (let cell = 0; cell < lakeOf.length; cell += 1) {
				if (lakeOf[cell] < 0) continue;
				const [cx, cy] = [cellCentre(grid, cell % grid.size), cellCentre(grid, Math.floor(cell / grid.size))];
				expect(Math.hypot(cx - x, cy - y)).toBeGreaterThan(craterRadius + CRATER_GAP);
			}
		});
	});

	it('makes the same hazards from the same stream, others from another, and draws them on the stream\'s hotspots fork alone', () => {
		const set = SETS[0][1];
		expect(hazardsFor(set).hotspots).toEqual(hazardsFor(set).hotspots);
		expect(hazardsFor(set, 1).hotspots).not.toEqual(hazardsFor(set).hotspots);
		// One more hotspot asked for leaves the ones before it where they were.
		const fewer = hazardsFor(set, 0, 3).hotspots;
		expect(hazardsFor(set).hotspots.slice(0, 3)).toEqual(fewer);
	});

	it('places none when asked for none, leaving the land and its water as they were', () => {
		const set = SETS[0][1];
		const { hotspots, terrain } = hazardsFor(set, 0, 0);
		const wet = waterFor(set).terrain;
		expect(hotspots).toEqual([]);
		for (let x = -700; x <= 700; x += 140) {
			for (let y = -700; y <= 700; y += 140) {
				expect(terrain.contamination(x, y)).toBe(wet.contamination(x, y));
				expect(terrain.obstacle(x, y)).toBe(wet.obstacle(x, y));
			}
		}
	});

	it('rebuilds the same hazards over the same land and water from their hotspots, as the client does', () => {
		const set = SETS[1][1];
		const hazards = hazardsFor(set);
		const rebuilt = new Hazards({ terrain: waterFor(set).terrain, hotspots: structuredClone(hazards.hotspots) });
		expect(rebuilt.hotspots).toEqual(hazards.hotspots);
		expect(Object.isFrozen(rebuilt.hotspots)).toBe(true);
		for (let x = -760; x <= 760; x += 38) {
			for (let y = -760; y <= 760; y += 38) {
				expect(rebuilt.terrain.contamination(x, y)).toBe(hazards.terrain.contamination(x, y));
				expect(rebuilt.terrain.obstacle(x, y)).toBe(hazards.terrain.obstacle(x, y));
			}
		}
	});
});
