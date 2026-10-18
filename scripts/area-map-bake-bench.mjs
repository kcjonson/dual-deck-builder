/**
 * Times the area map view's bakes (DDB-298): the terrain texture as the view
 * bakes it, the land with its water and hazards and the places' ruins, at
 * each radius and environment, and the fog texture. It runs
 * outside Jest, on modules transpiled by scripts/transpiled.mjs.
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
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transpiled } from './transpiled.mjs';

const { build, args } = await transpiled({
	script: fileURLToPath(import.meta.url),
	name: 'area-map-bake',
	entries: ['game/map/MapParams', 'game/map/ParamValidator', 'game/map/AreaMapPipeline', 'game/map/Places', 'game/ui/areaMap/terrainBake', 'game/ui/areaMap/fogBake'].map(module => `src/renderer/${module}.ts`),
});
const options = {};
for (let index = 0; index < args.length; index += 2) options[args[index].replace(/^--/, '')] = args[index + 1];

// The build's define, off: no dev tools in a timing.
globalThis.__DEV_TOOLS__ = false;
const load = createRequire(join(build, 'src/renderer/index.js'));
const { resolveMapParams } = load('./game/map/MapParams.js');
const { validateMapParams } = load('./game/map/ParamValidator.js');
const { generateAreaMap } = load('./game/map/AreaMapPipeline.js');
const { ruinsOf } = load('./game/map/Places.js');
const { bakeTerrain, terrainBakeSize } = load('./game/ui/areaMap/terrainBake.js');
const { bakeFog } = load('./game/ui/areaMap/fogBake.js');

const ENVIRONMENTS = ['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const seeds = Number(options.seeds ?? 3);
const repeat = Number(options.repeat ?? 3);
const radii = (options.radii ?? '600,1000,1600').split(',').map(Number);

/** What the view bakes of a generated map: the land with its water and hazards, and the places' ruins. */
function bakeInput(set) {
	const { params } = validateMapParams(resolveMapParams(set).params);
	const { hazards, places } = generateAreaMap({ params }).products;
	return { terrain: hazards.terrain, ruins: ruinsOf(places) };
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
bakeTerrain({ ...bakeInput({ seed: 99, radius: 600 }), size: 128 });

const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
console.log(`${runtime}, V8 ${process.versions.v8}; ${ENVIRONMENTS.length} environments x ${seeds} seeds per radius, the fastest of ${repeat} runs each`);
for (const radius of radii) {
	const times = [];
	for (const environment of ENVIRONMENTS) {
		for (let seed = 1; seed <= seeds; seed += 1) {
			const input = bakeInput({ seed, environment, radius });
			times.push(fastest(() => bakeTerrain({ ...input, size: terrainBakeSize(radius) })));
		}
	}
	const size = terrainBakeSize(radius);
	console.log(`radius ${radius}: ${size} x ${size} texels (${(radius * 2 / size).toFixed(2)} units each), median ${median(times).toFixed(1)} ms, slowest ${Math.max(...times).toFixed(1)} ms`);
}
const fog = { cells: 64, isRevealed: (column, row) => Math.hypot(column - 31.5, row - 31.5) < 12 };
console.log(`fog, 64 cells: ${fastest(() => bakeFog({ fog })).toFixed(1)} ms`);
