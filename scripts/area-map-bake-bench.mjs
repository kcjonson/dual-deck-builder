/**
 * Times the area map view's bakes (DDB-298): the terrain texture at each
 * radius and environment, and the fog texture. Like terrain-bench.mjs, it
 * transpiles the modules into a temporary folder and runs them in a fresh
 * child process, clear of Jest's coverage and the TypeScript compiler's heap.
 *
 *   node scripts/area-map-bake-bench.mjs [--seeds 3] [--repeat 3] [--radii 600,1000,1600]
 *
 * For the V8 the desktop app runs, use Electron's bundled Node:
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron scripts/area-map-bake-bench.mjs
 *
 * Each row is the median and the slowest over the five environments and the
 * seeds, each map's time the fastest of its runs, since other work on the
 * machine only ever adds time.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const SOURCES = [
	'game/core/Json', 'game/core/Rng', 'game/map/MapParams', 'game/map/ParamValidator', 'game/map/Noise', 'game/map/Biome',
	'game/map/TerrainSites', 'game/map/Geometry', 'game/map/LandGrid', 'game/map/MapMath', 'game/map/Drainage', 'game/map/Erosion', 'game/map/Uplift',
	'game/map/Land', 'game/map/Terrain', 'engine/theme/tokens', 'game/ui/areaMap/areaMapStyle', 'game/ui/areaMap/terrainBake',
	'game/ui/areaMap/fogBake',
];

if (process.argv[2] !== '--built') {
	const { default: ts } = await import('typescript');
	const root = join(dirname(script), '..');
	const build = mkdtempSync(join(tmpdir(), 'area-map-bake-'));
	for (const source of SOURCES) {
		const text = readFileSync(join(root, 'src/renderer', `${source}.ts`), 'utf8');
		const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
		const target = join(build, `${source}.js`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, outputText);
	}
	const child = spawnSync(process.execPath, [script, '--built', build, ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd() });
	rmSync(build, { recursive: true, force: true });
	process.exit(child.status ?? 1);
}

const build = process.argv[3];
const options = {};
for (let index = 4; index < process.argv.length; index += 2) options[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];

const load = createRequire(join(build, 'index.js'));
const { Rng } = load('./game/core/Rng.js');
const { resolveMapParams } = load('./game/map/MapParams.js');
const { validateMapParams } = load('./game/map/ParamValidator.js');
const { generateTerrain } = load('./game/map/Terrain.js');
const { bakeTerrain, terrainBakeSize } = load('./game/ui/areaMap/terrainBake.js');
const { bakeFog } = load('./game/ui/areaMap/fogBake.js');

const ENVIRONMENTS = ['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const seeds = Number(options.seeds ?? 3);
const repeat = Number(options.repeat ?? 3);
const radii = (options.radii ?? '600,1000,1600').split(',').map(Number);

function terrainFor(set) {
	const { params } = validateMapParams(resolveMapParams(set).params);
	return generateTerrain({ params, rng: new Rng({ seed: params.seed }).fork('map', 0).fork('terrain', 0) });
}

function fastest(run) {
	let best = Infinity;
	for (let attempt = 0; attempt < repeat; attempt += 1) {
		const start = now();
		run();
		best = Math.min(best, now() - start);
	}
	return best;
}

// Warm the engine on a small bake, so the first map's time isn't its compile.
bakeTerrain({ terrain: terrainFor({ seed: 99, radius: 600 }), size: 128 });

const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
console.log(`${runtime}, V8 ${process.versions.v8}; ${ENVIRONMENTS.length} environments x ${seeds} seeds per radius, the fastest of ${repeat} runs each`);
for (const radius of radii) {
	const times = [];
	for (const environment of ENVIRONMENTS) {
		for (let seed = 1; seed <= seeds; seed += 1) {
			const terrain = terrainFor({ seed, environment, radius });
			times.push(fastest(() => bakeTerrain({ terrain, size: terrainBakeSize(radius) })));
		}
	}
	const size = terrainBakeSize(radius);
	console.log(`radius ${radius}: ${size} x ${size} texels (${(radius * 2 / size).toFixed(2)} units each), median ${median(times).toFixed(1)} ms, slowest ${Math.max(...times).toFixed(1)} ms`);
}
const fog = { cells: 64, isRevealed: (column, row) => Math.hypot(column - 31.5, row - 31.5) < 12 };
console.log(`fog, 64 cells: ${fastest(() => bakeFog({ fog })).toFixed(1)} ms`);
