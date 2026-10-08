/**
 * Times the area map's terrain stage (DDB-288): building a map's terrain, and
 * sampling each query over a grid of the disc's bounding square, across the
 * environments. It runs outside Jest, whose coverage instrumentation and vm
 * context slow the per-sample code several times over: it transpiles the
 * stage's modules into a temporary folder, then times them in a fresh child
 * process, since the TypeScript compiler's heap left in the same process
 * slows sampling about twofold.
 *
 *   node scripts/terrain-bench.mjs
 *   node scripts/terrain-bench.mjs --grid 512 --seeds 5
 *
 * For the V8 the desktop app runs, use Electron's bundled Node:
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron scripts/terrain-bench.mjs
 *
 * Each row is the median, over environments and seeds, of one grid's time,
 * then that per sample.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const SOURCES = ['core/Json', 'core/Rng', 'map/MapParams', 'map/ParamValidator', 'map/Noise', 'map/Biome', 'map/TerrainSites', 'map/Terrain'];

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
const options = { grid: 256, seeds: 3 };
for (let index = 4; index < process.argv.length; index += 2) {
	const key = process.argv[index].replace(/^--/, '');
	if (!(key in options)) throw new Error(`unknown option --${key}`);
	options[key] = Number(process.argv[index + 1]);
}

const load = createRequire(join(build, 'index.js'));
const { Rng } = load('./core/Rng.js');
const { resolveMapParams } = load('./map/MapParams.js');
const { validateMapParams } = load('./map/ParamValidator.js');
const { createTerrainSample, generateTerrain } = load('./map/Terrain.js');

const ENVIRONMENTS = ['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'];
const now = () => Number(process.hrtime.bigint()) / 1e6;

function terrainFor(seed, environment) {
	const { params } = validateMapParams(resolveMapParams({ seed, environment }).params);
	return generateTerrain({ params, rng: new Rng({ seed }).fork('map', 0).fork('terrain', 0) });
}

const out = createTerrainSample();
const slope = { x: 0, y: 0 };
const QUERIES = {
	'sample (every field)': (terrain, x, y) => terrain.sample(x, y, out).elevation,
	elevation: (terrain, x, y) => terrain.elevation(x, y),
	slope: (terrain, x, y) => terrain.slope(x, y, slope).x,
	biome: (terrain, x, y) => terrain.biome(x, y).length,
	impassable: (terrain, x, y) => (terrain.impassable(x, y) ? 1 : 0),
	travelCost: (terrain, x, y) => {
		const cost = terrain.travelCost(x, y);
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

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
console.log(`${runtime}, V8 ${process.versions.v8}; ${options.grid}x${options.grid} grid, ${ENVIRONMENTS.length} environments x ${options.seeds} seeds`);
console.log(`build: median ${median(builds).toFixed(2)} ms`);
for (const [name, times] of Object.entries(grids)) {
	const grid = median(times);
	console.log(`${name.padEnd(22)} ${grid.toFixed(1).padStart(7)} ms a grid, ${(grid * 1e6 / (options.grid * options.grid)).toFixed(0).padStart(5)} ns a sample`);
}
