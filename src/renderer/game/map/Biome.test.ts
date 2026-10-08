import { BIOMES, BIOME_COSTS, BIOME_LABELS, BIOME_THRESHOLDS, BiomeFields, classifyBiome } from './Biome';

/** Middling ground: scrub, with nothing pushing it toward any other biome. */
const scrub: BiomeFields = { elevation: 0.5, moisture: 0.45, contamination: 0, mountains: 0, canyons: 0, badlands: 0 };
const fields = (values: Partial<BiomeFields>): BiomeFields => ({ ...scrub, ...values });

describe('classifyBiome', () => {
	const thresholds = BIOME_THRESHOLDS;

	it('calls middling ground scrub', () => {
		expect(classifyBiome(scrub)).toBe('scrub');
	});

	it('reads mountains from the range mask, at the threshold and up', () => {
		expect(classifyBiome(fields({ mountains: thresholds.mountains }))).toBe('mountains');
		expect(classifyBiome(fields({ mountains: thresholds.mountains - 1e-9 }))).toBe('scrub');
	});

	it('reads canyons from how far into one the ground is', () => {
		expect(classifyBiome(fields({ canyons: thresholds.canyons }))).toBe('canyons');
		expect(classifyBiome(fields({ canyons: thresholds.canyons - 1e-9 }))).toBe('scrub');
	});

	it('reads mire from wet, low ground, with contamination counting toward wet', () => {
		const low = thresholds.mireElevation - 0.01;
		expect(classifyBiome(fields({ elevation: low, moisture: thresholds.mireWetness }))).toBe('mire');
		expect(classifyBiome(fields({ elevation: low, moisture: thresholds.mireWetness - 0.01 }))).toBe('scrub');
		expect(classifyBiome(fields({ elevation: low, moisture: thresholds.mireWetness - 0.2, contamination: 0.2 / thresholds.mireContamination }))).toBe('mire');
		expect(classifyBiome(fields({ elevation: thresholds.mireElevation, moisture: 1 }))).toBe('scrub');
	});

	it('reads badlands from broken ground that isn\'t wet', () => {
		expect(classifyBiome(fields({ badlands: thresholds.badlands }))).toBe('badlands');
		expect(classifyBiome(fields({ badlands: thresholds.badlands - 1e-9 }))).toBe('scrub');
		expect(classifyBiome(fields({ badlands: 1, moisture: thresholds.badlandsMoisture }))).toBe('scrub');
	});

	it('reads desert from dry ground', () => {
		expect(classifyBiome(fields({ moisture: thresholds.desertMoisture - 1e-9 }))).toBe('desert');
		expect(classifyBiome(fields({ moisture: thresholds.desertMoisture }))).toBe('scrub');
	});

	it('takes the first match: mountains, canyons, mire, badlands, desert', () => {
		const everything = fields({ mountains: 1, canyons: 1, badlands: 1, elevation: 0, moisture: 1, contamination: 1 });
		expect(classifyBiome(everything)).toBe('mountains');
		expect(classifyBiome({ ...everything, mountains: 0 })).toBe('canyons');
		expect(classifyBiome({ ...everything, mountains: 0, canyons: 0 })).toBe('mire');
		const dryBroken = fields({ badlands: 1, moisture: 0 });
		expect(classifyBiome(dryBroken)).toBe('badlands');
		expect(classifyBiome({ ...dryBroken, badlands: 0 })).toBe('desert');
	});
});

describe('biome tables', () => {
	it('labels and costs every biome', () => {
		BIOMES.forEach((biome) => {
			expect(BIOME_LABELS[biome]).toEqual(expect.any(String));
			expect(BIOME_COSTS[biome]).toBeGreaterThanOrEqual(1);
		});
	});

	it('makes flat scrub the cheapest ground, at 1', () => {
		expect(BIOME_COSTS.scrub).toBe(1);
		expect(Math.min(...BIOMES.map((biome) => BIOME_COSTS[biome]))).toBe(1);
	});
});
