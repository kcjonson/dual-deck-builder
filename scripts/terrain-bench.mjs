/**
 * Times the area map's terrain and water stages (DDB-288, DDB-441,
 * DDB-289): growing the land (uplift, erosion, and the finished land's
 * drainage) and laying its water at several radii across the environments,
 * then building a map's terrain with its water and sampling each query over
 * a grid of the disc's bounding square. It runs outside Jest,
 * whose coverage instrumentation and vm context slow the per-sample code
 * several times over: it transpiles the stage's modules into a temporary
 * folder, then times them in a fresh child process, since the TypeScript
 * compiler's heap left in the same process slows sampling about twofold.
 *
 *   node scripts/terrain-bench.mjs
 *   node scripts/terrain-bench.mjs --radii 800,1000,1200 --runs 3 --grid 512 --seeds 5
 *
 * For the V8 the desktop app runs, use Electron's bundled Node:
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron scripts/terrain-bench.mjs
 *
 * The land table gives, per radius and environment, the median of `runs`
 * builds of seeds 1 to `runs`; erosion is the land's time less the uplift's
 * and the final drainage's, each timed on its own. The water table gives
 * the water stage's time the same way, with the terrain's fields over the
 * land and the water's rebuild over its surface, the two the client pays
 * when a map crosses the worker boundary. Each query row is the median,
 * over environments and seeds, of one grid's time, then that per sample.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const SOURCES = [
	'core/Json', 'core/Rng', 'map/MapParams', 'map/ParamValidator', 'map/Noise', 'map/Biome', 'map/TerrainSites', 'map/Geometry',
	'map/LandGrid', 'map/MapMath', 'map/Drainage', 'map/Erosion', 'map/Uplift', 'map/Land', 'map/Terrain', 'map/Rivers', 'map/Lakes', 'map/Water',
];

if (process.argv[2] !== '--built') {
	const { default: ts } = await import('typescript');
	const root = join(dirname(script), '..');
	const build = mkdtempSync(join(tmpdir(), 'terrain-bench-'));
	for (const source of SOURCES) {
		const text = readFileSync(join(root, 'src/renderer/game', `${source}.ts`), 'utf8');
		const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
		const target = join(build, `${source}.js`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, outputText);
	}
	const child = spawnSync(process.execPath, [script, '--built', build, ...process.argv.slice(2)], { stdio: 'inherit' });
	rmSync(build, { recursive: true, force: true });
	process.exit(child.status ?? 1);
}

const build = process.argv[3];
const options = { grid: 256, seeds: 3, runs: 3, radii: '800,1000,1200' };
for (let index = 4; index < process.argv.length; index += 2) {
	const key = process.argv[index].replace(/^--/, '');
	if (!(key in options)) throw new Error(`unknown option --${key}`);
	options[key] = key === 'radii' ? process.argv[index + 1] : Number(process.argv[index + 1]);
}

const load = createRequire(join(build, 'index.js'));
const { Rng } = load('./core/Rng.js');
const { resolveMapParams } = load('./map/MapParams.js');
const { validateMapParams } = load('./map/ParamValidator.js');
const { routeDrainage } = load('./map/Drainage.js');
const { landGridFor } = load('./map/LandGrid.js');
const { generateLand, startRadii } = load('./map/Land.js');
const { buildUplift } = load('./map/Uplift.js');
const { createTerrainSample, generateTerrain, terrainFromSurface } = load('./map/Terrain.js');
const { generateWater, waterFromSurface } = load('./map/Water.js');

const ENVIRONMENTS = ['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;

const paramsFor = (seed, environment, radius) => validateMapParams(resolveMapParams({ seed, environment, radius }).params).params;
const terrainStream = (seed) => new Rng({ seed }).fork('map', 0).fork('terrain', 0);

function timeLand(params) {
	const rng = terrainStream(params.seed);
	let start = now();
	const land = generateLand({ params, rng });
	const total = now() - start;
	const grid = landGridFor(params.radius);
	const { metroRadius, reliefRadius } = startRadii(params);
	start = now();
	buildUplift({ grid, radius: params.radius, metroRadius, reliefRadius, mountainCoverage: params.mountainCoverage, ruggedness: params.ruggedness, rng });
	const uplift = now() - start;
	start = now();
	routeDrainage({ size: grid.size, elevation: land.elevation, outlets: land.drainage.outlets });
	const drainage = now() - start;
	return { total, uplift, drainage, erosion: total - uplift - drainage, size: grid.size };
}

// Warm up the land on every environment so it's optimized before timing.
for (const environment of ENVIRONMENTS) timeLand(paramsFor(99, environment, 1000));

console.log(`${runtime}, V8 ${process.versions.v8}; the land, median of ${options.runs} seeds per radius and environment (ms)`);
console.log(['radius', 'grid', ...ENVIRONMENTS, 'uplift', 'erosion', 'drainage'].map((cell) => cell.padStart(11)).join(''));
for (const radius of options.radii.split(',').map(Number)) {
	const parts = { uplift: [], erosion: [], drainage: [] };
	const totals = ENVIRONMENTS.map((environment) => {
		const times = [];
		for (let seed = 1; seed <= options.runs; seed += 1) {
			const time = timeLand(paramsFor(seed, environment, radius));
			times.push(time.total);
			parts.uplift.push(time.uplift);
			parts.erosion.push(time.erosion);
			parts.drainage.push(time.drainage);
		}
		return median(times);
	});
	const size = landGridFor(radius).size;
	console.log([radius, `${size}x${size}`, ...totals.map((time) => time.toFixed(0)), ...['uplift', 'erosion', 'drainage'].map((part) => median(parts[part]).toFixed(1))]
		.map((cell) => String(cell).padStart(11)).join(''));
}

/**
 * The water stage over each map's land: generateWater, and the client's
 * side of the worker boundary, the terrain's fields rebuilt over the land
 * (terrainFromSurface) and the water over its surface (waterFromSurface).
 */
function timeWater(params) {
	const rng = terrainStream(params.seed);
	const land = generateLand({ params, rng });
	let start = now();
	const terrain = terrainFromSurface({ params, rng, surface: land });
	const fields = now() - start;
	start = now();
	const water = generateWater({ params, terrain, rng: rng.fork('water', 0) });
	const total = now() - start;
	start = now();
	waterFromSurface({ terrain, surface: water.surface });
	const rebuild = now() - start;
	return { total, fields, rebuild, rivers: water.rivers.length, lakes: water.lakes.length };
}

for (const environment of ENVIRONMENTS) timeWater(paramsFor(99, environment, 1000));

console.log(`\nthe water stage, median of ${options.runs} seeds per radius and environment (ms); the terrain's fields and the water's rebuild over what crosses the worker boundary`);
console.log(['radius', ...ENVIRONMENTS, 'fields', 'rebuild', 'rivers', 'lakes'].map((cell) => cell.padStart(11)).join(''));
for (const radius of options.radii.split(',').map(Number)) {
	const parts = { fields: [], rebuild: [], rivers: [], lakes: [] };
	const totals = ENVIRONMENTS.map((environment) => {
		const times = [];
		for (let seed = 1; seed <= options.runs; seed += 1) {
			const time = timeWater(paramsFor(seed, environment, radius));
			times.push(time.total);
			for (const part of Object.keys(parts)) parts[part].push(time[part]);
		}
		return median(times);
	});
	console.log([radius, ...totals.map((time) => time.toFixed(0)), ...['fields', 'rebuild'].map((part) => median(parts[part]).toFixed(1)), ...['rivers', 'lakes'].map((part) => median(parts[part]))]
		.map((cell) => String(cell).padStart(11)).join(''));
}

/** A radius 1000 map's land with its water, what the stages after water sample. */
function terrainFor(seed, environment) {
	const params = paramsFor(seed, environment, 1000);
	const rng = terrainStream(seed);
	return generateWater({ params, terrain: generateTerrain({ params, rng }), rng: rng.fork('water', 0) }).terrain;
}

const out = createTerrainSample();
const slope = { x: 0, y: 0 };
const QUERIES = {
	'sample (every field)': (terrain, x, y) => terrain.sample(x, y, out).elevation,
	elevation: (terrain, x, y) => terrain.elevation(x, y),
	slope: (terrain, x, y) => terrain.slope(x, y, slope).x,
	biome: (terrain, x, y) => terrain.biome(x, y).length,
	impassable: (terrain, x, y) => (terrain.impassable(x, y) ? 1 : 0),
	'moveCost (9 units)': (terrain, x, y) => {
		const cost = terrain.moveCost(x, y, x + 7.2, y + 5.4, 'backRoad');
		return cost === Infinity ? 0 : cost;
	},
};

function timeGrid(terrain, query) {
	const size = options.grid;
	const radius = terrain.radius;
	let sink = 0;
	const start = now();
	for (let row = 0; row < size; row += 1) {
		const y = ((row + 0.5) / size * 2 - 1) * radius;
		for (let column = 0; column < size; column += 1) sink += query(terrain, ((column + 0.5) / size * 2 - 1) * radius, y);
	}
	const elapsed = now() - start;
	if (Number.isNaN(sink)) throw new Error('NaN in a sample');
	return elapsed;
}

// Warm up every query on every environment so each is optimized before timing.
for (const environment of ENVIRONMENTS) {
	const terrain = terrainFor(99, environment);
	for (const query of Object.values(QUERIES)) timeGrid(terrain, query);
}

const builds = [];
const grids = Object.fromEntries(Object.keys(QUERIES).map((name) => [name, []]));
for (const environment of ENVIRONMENTS) {
	for (let seed = 1; seed <= options.seeds; seed += 1) {
		const start = now();
		const terrain = terrainFor(seed, environment);
		builds.push(now() - start);
		for (const [name, query] of Object.entries(QUERIES)) grids[name].push(timeGrid(terrain, query));
	}
}

console.log(`\nradius 1000; ${options.grid}x${options.grid} grid, ${ENVIRONMENTS.length} environments x ${options.seeds} seeds`);
console.log(`build (generateTerrain, the land included): median ${median(builds).toFixed(1)} ms`);
for (const [name, times] of Object.entries(grids)) {
	const grid = median(times);
	console.log(`${name.padEnd(22)} ${grid.toFixed(1).padStart(7)} ms a grid, ${(grid * 1e6 / (options.grid * options.grid)).toFixed(0).padStart(5)} ns a sample`);
}
