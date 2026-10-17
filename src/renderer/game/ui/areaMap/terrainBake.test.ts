import { Rng } from '../../core/Rng';
import { MapParamSet, resolveMapParams } from '../../map/MapParams';
import { validateMapParams } from '../../map/ParamValidator';
import { Terrain, generateTerrain } from '../../map/Terrain';
import { generateWater } from '../../map/Water';
import { BUILT_UP, CRATER_STYLE, HILL_SHADE, LAND_COLOURS, OBSTACLE_COLOURS, PAPER, RIM, TOXIC_HATCH, landColour } from './areaMapStyle';
import { BakeTerrain, MAX_BAKE_SIZE, MIN_BAKE_SIZE, TEXEL_WORLD_UNITS, bakeTerrain, terrainBakeSize } from './terrainBake';
import { flatTerrain } from './testing';

/** The texel at world (x, y) in a bake of `size` over a disc of `radius`. */
function texelAt(texels: Uint8Array, size: number, radius: number, x: number, y: number): [number, number, number, number] {
	const column = Math.floor(((x + radius) / (radius * 2)) * size);
	const row = Math.floor(((radius - y) / (radius * 2)) * size);
	const at = (row * size + column) * 4;
	return [texels[at], texels[at + 1], texels[at + 2], texels[at + 3]];
}

/** Middling ground, what `flatTerrain` is unless a test says otherwise, as a texel. */
const MIDDLING = [...LAND_COLOURS.middling, 255];

/** `ink` moved `amount` of the way to `colour`, rounded as the bake stores it. */
function mixedTexel(ink: readonly number[], colour: readonly number[], amount: number): number[] {
	return [0, 1, 2].map((channel) => Math.trunc(ink[channel] + (colour[channel] - ink[channel]) * amount + 0.5)).concat(255);
}

/** Stage 1 on the pipeline's terrain stream. */
function terrainFor(set: MapParamSet): Terrain {
	const { params } = validateMapParams(resolveMapParams(set).params);
	return generateTerrain({ params, rng: new Rng({ seed: params.seed }).fork('map', 0).fork('terrain', 0) });
}

describe('terrainBakeSize', () => {
	it('gives about one texel per TEXEL_WORLD_UNITS, held between the bounds', () => {
		expect(terrainBakeSize(1000)).toBe(Math.ceil(2000 / TEXEL_WORLD_UNITS));
		expect(terrainBakeSize(100)).toBe(MIN_BAKE_SIZE);
		expect(terrainBakeSize(1600)).toBe(MAX_BAKE_SIZE);
	});
});

describe('landColour', () => {
	it('runs buff to khaki to sage with moisture, warms toward grey-brown with height, and tints rust with contamination', () => {
		const at = (elevation: number, moisture: number, contamination: number) => landColour(elevation, moisture, contamination, [0, 0, 0]);
		expect(at(0, 0, 0)).toEqual([...LAND_COLOURS.dry]);
		expect(at(0, 0.5, 0)).toEqual([...LAND_COLOURS.middling]);
		expect(at(0, 1, 0)).toEqual([...LAND_COLOURS.wet]);
		expect(at(1, 0.5, 0)).toEqual([...LAND_COLOURS.high.colour]);
		const toxic = at(0, 0.5, 1);
		toxic.forEach((channel, index) => {
			expect(channel).toBeCloseTo(LAND_COLOURS.middling[index] + (LAND_COLOURS.toxic.colour[index] - LAND_COLOURS.middling[index]) * LAND_COLOURS.toxic.weight, 9);
		});
	});
});

describe('bakeTerrain', () => {
	it('fills the disc and leaves past the rim clear, the rim anti-aliased', () => {
		const size = 64;
		const texels = bakeTerrain({ terrain: flatTerrain({ radius: 600 }), size });
		expect(texelAt(texels, size, 600, 0, 0)).toEqual(MIDDLING);
		expect(texelAt(texels, size, 600, 590, 590)).toEqual([0, 0, 0, 0]);
		const alphas = new Set<number>();
		for (let index = 3; index < texels.length; index += 4) alphas.add(texels[index]);
		// Some texels on the rim are partly covered
		expect([...alphas].some((alpha) => alpha > 0 && alpha < 255)).toBe(true);
		// Premultiplied: no channel above its alpha
		for (let index = 0; index < texels.length; index += 4) {
			for (let channel = 0; channel < 3; channel++) expect(texels[index + channel]).toBeLessThanOrEqual(texels[index + 3]);
		}
	});

	it('blends the land\'s colour continuously, with no patches: ground drying steadily across the map shades steadily', () => {
		const size = 240;
		const radius = 600;
		const texels = bakeTerrain({ terrain: flatTerrain({ radius, moisture: (x) => (x / radius + 1) / 2 }), size });
		let previous = texelAt(texels, size, radius, -radius * (1 - RIM.fade) + 2.5, 0);
		let steps = 0;
		for (let x = -radius * (1 - RIM.fade) + 7.5; x < radius * (1 - RIM.fade) - 5; x += 5) {
			const texel = texelAt(texels, size, radius, x, 0);
			// The red channel falls from buff's toward sage's, a level at a time, never in a jump.
			expect(Math.abs(texel[0] - previous[0])).toBeLessThanOrEqual(1);
			if (texel[0] !== previous[0]) steps += 1;
			previous = texel;
		}
		expect(steps).toBeGreaterThan(15);
	});

	it('draws towns and villages as built-up patches, the towns with a street grid, and leaves the land past them be', () => {
		const terrain = flatTerrain({ radius: 600 });
		const ruins = [{ x: 0, y: 0, radius: 100, kind: 'town' as const }, { x: 300, y: 300, radius: 30, kind: 'village' as const }];
		const plain = bakeTerrain({ terrain, size: 480 });
		const ruined = bakeTerrain({ terrain, size: 480, ruins });
		const fill = [...BUILT_UP.fill, 255];
		// A village is a plain patch...
		expect(texelAt(ruined, 480, 600, 300, 300)).toEqual(fill);
		// ...and a town has streets through its fill.
		let streets = 0;
		let filled = 0;
		for (let x = -60; x <= 60; x += 1.25) {
			const texel = texelAt(ruined, 480, 600, x, 10);
			if (texel.every((channel, index) => Math.abs(channel - fill[index]) <= 1)) filled += 1;
			else if (texel[0] < BUILT_UP.fill[0] - 5) streets += 1;
		}
		expect(filled).toBeGreaterThan(10);
		expect(streets).toBeGreaterThan(3);
		// The edge is ragged, never past the radius and its raggedness...
		const beyond = 100 * (1 + BUILT_UP.ragged) + 6;
		expect(texelAt(ruined, 480, 600, 0, beyond)).toEqual(texelAt(plain, 480, 600, 0, beyond));
		expect(texelAt(ruined, 480, 600, -400, -200)).toEqual(texelAt(plain, 480, 600, -400, -200));
		// ...and the same each bake: a place's patch comes from where it is.
		expect(Buffer.from(bakeTerrain({ terrain, size: 480, ruins })).equals(Buffer.from(ruined))).toBe(true);
	});

	it('draws craters as craters, rim, floor, and core, anti-aliased at the edge, and dashes each plume\'s edge', () => {
		const size = 240;
		// Texels are 5 units; one's centre at (242.5, -102.5) sits about on the crater's edge
		const terrain = flatTerrain({ radius: 600, craters: [{ x: 202.5, y: -100, craterRadius: 40 }] });
		const texels = bakeTerrain({ terrain, size });
		expect(texelAt(texels, size, 600, 202.5, -100)).toEqual([...CRATER_STYLE.coreColour, 255]);
		expect(texelAt(texels, size, 600, 202.5 + 25, -100)).toEqual([...CRATER_STYLE.floor, 255]);
		expect(texelAt(texels, size, 600, 202.5 + 35, -100)).toEqual([...CRATER_STYLE.rimColour, 255]);
		expect(texelAt(texels, size, 600, 260, -100)).toEqual(MIDDLING);
		const edge = texelAt(texels, size, 600, 242.5, -102.5);
		expect(edge[0]).toBeLessThan(LAND_COLOURS.middling[0]);
		expect(edge[0]).toBeGreaterThan(CRATER_STYLE.rimColour[0]);
		// The plume, five times the crater's radius here, has a dashed ring: some texels round it rust, some not.
		let rust = 0;
		let land = 0;
		for (let step = 0; step < 200; step++) {
			const angle = (step / 200) * Math.PI * 2;
			const texel = texelAt(texels, size, 600, 202.5 + Math.cos(angle) * 200, -100 + Math.sin(angle) * 200);
			if (texel[2] < LAND_COLOURS.middling[2] - 20) rust += 1;
			else if (texel.every((channel, index) => channel === MIDDLING[index])) land += 1;
		}
		expect(rust).toBeGreaterThan(30);
		expect(land).toBeGreaterThan(30);
	});

	it('hatches contaminated land, lightly, and leaves clean land plain', () => {
		const size = 240;
		const radius = 600;
		const base = flatTerrain({ radius });
		const terrain: BakeTerrain = { ...base, sample: (x, y, out) => {
			base.sample(x, y, out);
			out.contamination = x > 0 ? 1 : 0;
			return out;
		} };
		const texels = bakeTerrain({ terrain, size });
		const tinted = landColour(0, 0.5, 1, [0, 0, 0]);
		const blues = new Set<number>();
		for (let y = -200; y <= 200; y += 5) blues.add(texelAt(texels, size, radius, 300, y)[2]);
		// Plain tinted land between the lines, darker texels on them, none past the hatch's weight.
		expect(blues.has(Math.trunc(tinted[2] + 0.5))).toBe(true);
		expect(Math.min(...blues)).toBeLessThan(tinted[2] - 5);
		expect(Math.min(...blues)).toBeGreaterThanOrEqual(Math.trunc(tinted[2] + (TOXIC_HATCH.colour[2] - tinted[2]) * TOXIC_HATCH.weight));
		expect(texelAt(texels, size, radius, -300, 0)).toEqual(MIDDLING);
	});

	it('fades the land toward paper at the rim and dashes the edge', () => {
		const size = 480;
		const radius = 600;
		const texels = bakeTerrain({ terrain: flatTerrain({ radius }), size });
		// Inside the fade, untouched.
		expect(texelAt(texels, size, radius, radius * (1 - RIM.fade) - 5, 0)).toEqual(MIDDLING);
		// In it, paler, toward the paper.
		const faded = texelAt(texels, size, radius, radius * (1 - RIM.fade / 2), 0);
		expect(faded[2]).toBeGreaterThan(LAND_COLOURS.middling[2]);
		expect(faded[2]).toBeLessThan(PAPER[2]);
		// The line just inside the edge, dashed: some texels on it grey, some not.
		let line = 0;
		let gap = 0;
		for (let step = 0; step < 400; step++) {
			const angle = (step / 400) * Math.PI * 2;
			const texel = texelAt(texels, size, radius, Math.cos(angle) * (radius - 3.75), Math.sin(angle) * (radius - 3.75));
			if (texel[3] < 255) continue;
			if (texel[0] < LAND_COLOURS.middling[0] - 20) line += 1;
			else gap += 1;
		}
		expect(line).toBeGreaterThan(50);
		expect(gap).toBeGreaterThan(50);
	});

	it('draws lakes from the water\'s depth field, filled, with a darker shore', () => {
		const size = 240;
		// A round lake 100 units across, deepest at its middle.
		const terrain = flatTerrain({ radius: 600, lakeDepth: (x, y) => 0.01 * (1 - Math.hypot(x - 100, y - 50) / 50) });
		const texels = bakeTerrain({ terrain, size });
		expect(texelAt(texels, size, 600, 100, 50)).toEqual([...OBSTACLE_COLOURS.lake, 255]);
		expect(texelAt(texels, size, 600, 100 + 48.5, 50)).toEqual([...OBSTACLE_COLOURS.shore, 255]);
		expect(texelAt(texels, size, 600, 100 + 60, 50)).toEqual(MIDDLING);
	});

	it('shades cliffs where the land is into one, softly, anti-aliased at the edge, and hill-shades the rest', () => {
		const size = 240;
		const radius = 600;
		const slope = 0.004;
		// Into a cliff east of x = 2.5, a texel's centre, a tenth of the way more every 10 units.
		const texels = bakeTerrain({ terrain: flatTerrain({ radius, cliffDepth: (x) => (x - 2.5) / 100, slope }), size });
		// The land, hill-shaded: the slope falls to the east, away from the light, as flat country's is.
		const lit = Math.fround(Math.tanh(-slope * HILL_SHADE.gain));
		expect(lit).toBeLessThan(0);
		const light = 1 + Math.fround(HILL_SHADE.low) * lit;
		const shaded = LAND_COLOURS.middling.map((channel) => channel * light);
		expect(texelAt(texels, size, radius, -300, 0)).toEqual([...shaded.map((channel) => Math.trunc(channel + 0.5)), 255]);
		// East of the edge, the cliff's shade over it, never the cliff's colour outright.
		expect(texelAt(texels, size, radius, 300, 0)).toEqual(mixedTexel(shaded, OBSTACLE_COLOURS.cliff, OBSTACLE_COLOURS.cliffWeight));
		// The texel the edge runs through is half each.
		expect(texelAt(texels, size, radius, 2.5, 0)).toEqual(mixedTexel(shaded, OBSTACLE_COLOURS.cliff, OBSTACLE_COLOURS.cliffWeight / 2));
	});

	it('closes a gap a node or so wide in a band of cliff, so an escarpment draws as one', () => {
		const size = 240;
		const radius = 600;
		const cliff = mixedTexel(LAND_COLOURS.middling, OBSTACLE_COLOURS.cliff, OBSTACLE_COLOURS.cliffWeight);
		// A band east of x = 0, broken by a gap 12 units across along y = 0: a cliff sample every 10.
		const terrain = flatTerrain({ radius, cliffDepth: (x, y) => (x > 0 && Math.abs(y) > 6 ? 1 : -1) });
		const texels = bakeTerrain({ terrain, size });
		expect(texelAt(texels, size, radius, 300, 0)).toEqual(cliff);
		expect(texelAt(texels, size, radius, 300, 100)).toEqual(cliff);
		expect(texelAt(texels, size, radius, -300, 0)).toEqual(MIDDLING);
		// A gap wider than the closing stays open.
		const wide = flatTerrain({ radius, cliffDepth: (x, y) => (x > 0 && Math.abs(y) > 40 ? 1 : -1) });
		expect(texelAt(bakeTerrain({ terrain: wide, size }), size, radius, 300, 0)).toEqual(MIDDLING);
	});

	it('reads the land on lattices coarser than the texels: colour every colourStep, hill shade about every half land cell, and cliffs every two texels', () => {
		// Texels 2.5 units across, so shade every 2, about half a 9.4-unit land cell.
		const terrain = flatTerrain({ radius: 1000 });
		bakeTerrain({ terrain, size: 800, colourStep: 8 });
		// 101 nodes a side at most, fewer past the rim
		expect(terrain.samples).toBeLessThanOrEqual(102 * 102);
		expect(terrain.samples).toBeGreaterThan(100 * 100 * 0.7);
		// 401 a side at most for the shade and the cliffs
		expect(terrain.slopes).toBeLessThanOrEqual(402 * 402);
		expect(terrain.slopes).toBeGreaterThan(400 * 400 * 0.7);
		expect(terrain.depths).toBeLessThanOrEqual(402 * 402);
		expect(terrain.depths).toBeGreaterThan(400 * 400 * 0.7);
	});

	it('bakes the same bytes for the same terrain, its craters, and its places', () => {
		const land = terrainFor({ seed: 11, radius: 600 });
		const craters = [{ x: 150, y: -200, craterRadius: 20, plumeRadius: 120, strength: 1 }];
		const terrain: BakeTerrain = { radius: land.radius, hotspots: craters, water: land.water, sample: (x, y, out) => land.sample(x, y, out), slope: (x, y, out) => land.slope(x, y, out), cliffDepth: (x, y) => land.cliffDepth(x, y) };
		const ruins = [{ x: 0, y: 0, radius: 90, kind: 'metro' as const }, { x: -250, y: 150, radius: 40, kind: 'town' as const }, { x: 200, y: 250, radius: 14, kind: 'village' as const }];
		const size = terrainBakeSize(terrain.radius);
		// Compared as buffers: a deep equal over a million elements takes seconds
		expect(Buffer.from(bakeTerrain({ terrain, size, ruins })).equals(Buffer.from(bakeTerrain({ terrain, size, ruins })))).toBe(true);
	});

	it('draws the lakes Terrain.obstacle reports, give or take their shores', () => {
		const { params } = validateMapParams(resolveMapParams({ seed: 5, environment: 'floodlands', radius: 700 }).params);
		const stream = new Rng({ seed: params.seed }).fork('map', 0).fork('terrain', 0);
		const terrain = generateWater({ params, terrain: generateTerrain({ params, rng: stream }), rng: stream.fork('water', 0) }).terrain;
		const size = terrainBakeSize(terrain.radius);
		const texels = bakeTerrain({ terrain, size });
		const texel = (terrain.radius * 2) / size;
		let lakes = 0;
		let agree = 0;
		for (let row = 0; row < size; row += 2) {
			for (let column = 0; column < size; column += 2) {
				const x = -terrain.radius + (column + 0.5) * texel;
				const y = terrain.radius - (row + 0.5) * texel;
				if (x * x + y * y > (terrain.radius - texel) ** 2 || terrain.obstacle(x, y) !== 'lake') continue;
				lakes += 1;
				const at = (row * size + column) * 4;
				const water = [OBSTACLE_COLOURS.lake, OBSTACLE_COLOURS.shore].some((colour) => texels[at] === colour[0] && texels[at + 1] === colour[1] && texels[at + 2] === colour[2]);
				if (water) agree += 1;
			}
		}
		expect(lakes).toBeGreaterThan(100);
		// Craters, their plumes' rings, and the rim's line aside, every lake texel is water.
		expect(agree / lakes).toBeGreaterThan(0.97);
	});

	it('draws the cliffs Terrain.obstacle reports, give or take their edges', () => {
		// The steepest corner of the tuning ranges, where cliffs are commonest
		const terrain = terrainFor({ seed: 5, radius: 600, mountainCoverage: 1, ruggedness: 1, aridity: 0 });
		const size = terrainBakeSize(terrain.radius);
		const texels = bakeTerrain({ terrain, size });
		// The same land with no cliffs, which a texel drawn fully as cliff is the cliff's shade over.
		const bare = bakeTerrain({ terrain: { radius: terrain.radius, hotspots: terrain.hotspots, water: terrain.water, sample: (x, y, out) => terrain.sample(x, y, out), slope: (x, y, out) => terrain.slope(x, y, out), cliffDepth: () => -1 }, size });
		const texel = (terrain.radius * 2) / size;
		let cliffs = 0;
		let agree = 0;
		let drawn = 0;
		for (let row = 0; row < size; row += 2) {
			for (let column = 0; column < size; column += 2) {
				const x = -terrain.radius + (column + 0.5) * texel;
				const y = terrain.radius - (row + 0.5) * texel;
				if (x * x + y * y > (terrain.radius - texel) ** 2) continue;
				const at = (row * size + column) * 4;
				const isCliff = terrain.obstacle(x, y) === 'cliff';
				const full = bare[at] + (OBSTACLE_COLOURS.cliff[0] - bare[at]) * OBSTACLE_COLOURS.cliffWeight;
				const looksCliff = bare[at] !== texels[at] && Math.abs(texels[at] - full) <= 1;
				if (isCliff) cliffs += 1;
				if (looksCliff) drawn += 1;
				if (isCliff && looksCliff) agree += 1;
			}
		}
		expect(cliffs).toBeGreaterThan(100);
		// Most cliff ground is drawn fully as cliff, and little else is
		expect(agree / cliffs).toBeGreaterThan(0.75);
		expect(agree / drawn).toBeGreaterThan(0.85);
	});

	it('rejects a size or step that is not a positive integer', () => {
		expect(() => bakeTerrain({ terrain: flatTerrain(), size: 0 })).toThrow(/size/);
		expect(() => bakeTerrain({ terrain: flatTerrain(), size: 64, colourStep: 1.5 })).toThrow(/colourStep/);
	});
});
