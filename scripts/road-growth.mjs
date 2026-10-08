/**
 * The area map's drivable roads (DDB-290) outside Jest: timings, a sweep of
 * the network checks over many maps, and a picture of one map's roads over
 * its terrain. Like terrain-bench.mjs, it transpiles the map modules into a
 * temporary folder and runs them in a fresh child process, clear of Jest's
 * coverage and the TypeScript compiler's heap.
 *
 *   node scripts/road-growth.mjs bench [--seeds 3]
 *   node scripts/road-growth.mjs check [--maps 2000] [--from 0]
 *   node scripts/road-growth.mjs png --seed 7 [--environment badlands] [--radius 1000] [--size 1024] [--out roads.png] [--curviness 0.8 ...]
 *
 * bench times stages 2 and 3 together at radius 600, 1000, and 1600, each
 * row the median and the slowest over the five environments and the seeds.
 * check grows maps with parameters sampled across their tuning ranges, as
 * the property tests do, and runs checkRoadNetwork on each. png draws one
 * map; any parameter can be set by name.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const SOURCES = [
	'core/Json', 'core/Rng', 'map/MapParams', 'map/ParamValidator', 'map/Noise', 'map/Biome', 'map/TerrainSites', 'map/Terrain',
	'map/Geometry', 'map/SegmentIndex', 'map/RoadNetwork', 'map/RoadGrowth', 'map/Highways', 'map/RoadChecks',
];

if (process.argv[2] !== '--built') {
	const { default: ts } = await import('typescript');
	const root = join(dirname(script), '..');
	const build = mkdtempSync(join(tmpdir(), 'road-growth-'));
	for (const source of SOURCES) {
		const text = readFileSync(join(root, 'src/renderer/game', `${source}.ts`), 'utf8');
		const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
		const target = join(build, `${source}.js`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, outputText);
	}
	const profile = process.argv.indexOf('--profile');
	const flags = profile >= 0 ? ['--cpu-prof', '--cpu-prof-dir', process.argv[profile + 1]] : [];
	const child = spawnSync(process.execPath, [...flags, script, '--built', build, ...process.argv.slice(2)], { stdio: 'inherit', cwd: process.cwd() });
	rmSync(build, { recursive: true, force: true });
	process.exit(child.status ?? 1);
}

const build = process.argv[3];
const command = process.argv[4];
const options = {};
for (let index = 5; index < process.argv.length; index += 2) options[process.argv[index].replace(/^--/, '')] = process.argv[index + 1];

const load = createRequire(join(build, 'index.js'));
const { Rng } = load('./core/Rng.js');
const { MAP_PARAMETERS, NUMBER_PARAMS, resolveMapParams } = load('./map/MapParams.js');
const { validateMapParams } = load('./map/ParamValidator.js');
const { createTerrainSample, generateTerrain } = load('./map/Terrain.js');
const { planHighways } = load('./map/Highways.js');
const { growRoads } = load('./map/RoadGrowth.js');
const { checkRoadNetwork } = load('./map/RoadChecks.js');

const ENVIRONMENTS = ['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * Stages 1 to 3 on the pipeline's streams, the growth stages timed: run
 * `repeat` times and the fastest kept, since other work on the machine only
 * ever adds time.
 */
function generate(set, repeat = 1) {
	const { params } = validateMapParams(resolveMapParams(set).params);
	const map = new Rng({ seed: params.seed }).fork('map', 0);
	const terrain = generateTerrain({ params, rng: map.fork('terrain', 0) });
	let fastest = Infinity;
	let grown = null;
	for (let run = 0; run < repeat; run += 1) {
		const start = now();
		const highways = planHighways({ terrain, params, rng: map.fork('highways', 0) });
		grown = growRoads({ terrain, params, highways, rng: map.fork('growth', 0) });
		fastest = Math.min(fastest, now() - start);
	}
	return { params, terrain, network: grown.network, stats: grown.stats, milliseconds: fastest };
}

function lengths(network) {
	const byClass = { highway: 0, backRoad: 0, trail: 0 };
	for (const stretch of network.stretches) {
		const points = stretch.points;
		for (let point = 0; point + 3 < points.length; point += 2) {
			byClass[stretch.roadClass] += Math.hypot(points[point + 2] - points[point], points[point + 3] - points[point + 1]);
		}
	}
	return byClass;
}

/** The share of highways out of the metro that reach the rim. */
function highwaysOut(network) {
	const roots = network.roads.filter((road) => road.parent === -1);
	const out = roots.filter((road) => network.nodes[network.stretches[road.stretches[road.stretches.length - 1]].to].kind === 'exit');
	return out.length / roots.length;
}

function bench() {
	const seeds = Number(options.seeds ?? 3);
	const repeat = Number(options.repeat ?? 5);
	for (const environment of ENVIRONMENTS) generate({ seed: 99, environment, radius: 1000 });
	const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
	console.log(`${runtime}, V8 ${process.versions.v8}; ${ENVIRONMENTS.length} environments x ${seeds} seeds per radius, the fastest of ${repeat} runs each`);
	for (const radius of [600, 1000, 1600]) {
		const times = [];
		const steps = [];
		const stretches = [];
		const length = [];
		const out = [];
		for (const environment of ENVIRONMENTS) {
			for (let seed = 1; seed <= seeds; seed += 1) {
				const { network, stats, milliseconds } = generate({ seed, environment, radius }, repeat);
				times.push(milliseconds);
				steps.push(stats.steps);
				stretches.push(network.stretches.length);
				const byClass = lengths(network);
				length.push(byClass.highway + byClass.backRoad + byClass.trail);
				out.push(highwaysOut(network));
			}
		}
		const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
		console.log(`radius ${radius}: median ${median(times).toFixed(1)} ms, slowest ${Math.max(...times).toFixed(1)} ms; median ${median(steps)} steps, ${median(stretches)} stretches, ${median(length).toFixed(0)} units of road; ${(100 * mean(out)).toFixed(0)}% of highways reach the rim`);
	}
}

/** Parameter sets across the tuning ranges: each world or network number at an end of its range two times in five. */
function sampledSet(index) {
	const rng = new Rng({ seed: 7919 }).fork('road-sweep', index);
	const set = { seed: rng.next(), environment: rng.pick(ENVIRONMENTS) };
	for (const name of NUMBER_PARAMS) {
		const { group, kind, tuning } = MAP_PARAMETERS[name];
		if (group !== 'world' && group !== 'network') continue;
		const draw = rng.float();
		const value = draw < 0.2 ? tuning.min : draw < 0.4 ? tuning.max : tuning.min + (tuning.max - tuning.min) * rng.float();
		set[name] = kind === 'int' ? Math.round(value) : value;
	}
	return set;
}

function check() {
	const maps = Number(options.maps ?? 500);
	const from = Number(options.from ?? 0);
	let failed = 0;
	const times = [];
	const checks = [];
	const started = now();
	let slowest = { milliseconds: 0, index: -1, steps: 0 };
	for (let index = from; index < from + maps; index += 1) {
		const set = sampledSet(index);
		const { params, terrain, network, stats, milliseconds } = generate(set);
		times.push(milliseconds);
		if (milliseconds > slowest.milliseconds) slowest = { milliseconds, index, steps: stats.steps };
		const checkStart = now();
		const violations = checkRoadNetwork({ network, terrain, clearance: params.roadClearance });
		checks.push(now() - checkStart);
		if (violations.length > 0) {
			failed += 1;
			console.log(`map ${index} ${JSON.stringify(set)}`);
			for (const { rule, detail } of violations.slice(0, 5)) console.log(`  ${rule}: ${detail}`);
		}
		if ((index - from + 1) % 100 === 0) console.log(`${index - from + 1} maps, ${failed} failing, ${((now() - started) / 1000).toFixed(0)} s`);
	}
	console.log(`${maps} maps from ${from}: ${failed} failing; growth median ${median(times).toFixed(1)} ms, slowest ${slowest.milliseconds.toFixed(1)} ms (map ${slowest.index}, ${slowest.steps} steps: ${JSON.stringify(sampledSet(slowest.index))})`);
	console.log(`checkRoadNetwork median ${median(checks).toFixed(1)} ms, slowest ${Math.max(...checks).toFixed(1)} ms`);
	process.exitCode = failed > 0 ? 1 : 0;
}

const BIOME_COLOURS = {
	scrub: [196, 190, 150], desert: [226, 208, 160], mire: [128, 150, 112], badlands: [182, 140, 110], canyons: [204, 160, 120], mountains: [150, 140, 130],
};
const ROAD_STYLES = { highway: { colour: [20, 20, 20], width: 3 }, backRoad: { colour: [70, 60, 50], width: 2 }, trail: { colour: [150, 70, 30], width: 1.2 } };

async function png() {
	const { PNG } = (await import('pngjs')).default;
	const set = { seed: Number(options.seed ?? 1) };
	for (const [key, value] of Object.entries(options)) {
		if (['seed', 'size', 'out', 'window', 'profile'].includes(key)) continue;
		set[key] = key === 'environment' ? value : Number(value);
	}
	const { params, terrain, network, stats, milliseconds } = generate(set);
	const size = Number(options.size ?? 1024);
	const radius = terrain.radius;
	// --window x,y,half draws the square of world space around (x, y) instead of the whole disc.
	const [centreX, centreY, half] = options.window ? options.window.split(',').map(Number) : [0, 0, radius];
	const image = new PNG({ width: size, height: size });
	const sample = createTerrainSample();
	for (let row = 0; row < size; row += 1) {
		for (let column = 0; column < size; column += 1) {
			const x = centreX + ((column + 0.5) / size * 2 - 1) * half;
			const y = centreY - ((row + 0.5) / size * 2 - 1) * half;
			let colour = [235, 235, 235];
			if (x * x + y * y <= radius * radius) {
				terrain.sample(x, y, sample);
				const base = BIOME_COLOURS[sample.biome];
				// Light from the north-west.
				const shade = Math.max(0.55, Math.min(1.25, 1 + (sample.slopeY - sample.slopeX) * 60));
				colour = base.map((channel) => Math.min(255, channel * shade));
				if (sample.ruin > 0) colour = colour.map((channel) => channel * (1 - 0.25 * sample.ruin));
				if (sample.obstacle === 'cliff') colour = [90, 30, 30];
				else if (sample.obstacle === 'crater') colour = [40, 40, 40];
				else if (sample.obstacle === 'water') colour = [70, 110, 170];
			}
			const at = (row * size + column) * 4;
			image.data[at] = colour[0];
			image.data[at + 1] = colour[1];
			image.data[at + 2] = colour[2];
			image.data[at + 3] = 255;
		}
	}
	const toPixel = (x, y) => [((x - centreX) / half + 1) / 2 * size - 0.5, (-(y - centreY) / half + 1) / 2 * size - 0.5];
	const dot = (px, py, width, colour) => {
		const reach = width / 2;
		for (let row = Math.floor(py - reach); row <= Math.ceil(py + reach); row += 1) {
			for (let column = Math.floor(px - reach); column <= Math.ceil(px + reach); column += 1) {
				if (row < 0 || column < 0 || row >= size || column >= size) continue;
				if ((column - px) ** 2 + (row - py) ** 2 > reach * reach + 0.25) continue;
				const at = (row * size + column) * 4;
				image.data[at] = colour[0];
				image.data[at + 1] = colour[1];
				image.data[at + 2] = colour[2];
			}
		}
	};
	const order = ['trail', 'backRoad', 'highway'];
	for (const roadClass of order) {
		const { colour, width } = ROAD_STYLES[roadClass];
		for (const stretch of network.stretches) {
			if (stretch.roadClass !== roadClass) continue;
			const points = stretch.points;
			for (let point = 0; point + 3 < points.length; point += 2) {
				const [ax, ay] = toPixel(points[point], points[point + 1]);
				const [bx, by] = toPixel(points[point + 2], points[point + 3]);
				const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
				for (let step = 0; step <= steps; step += 1) dot(ax + (bx - ax) * step / steps, ay + (by - ay) * step / steps, width, colour);
			}
		}
	}
	for (const node of network.nodes) {
		const [px, py] = toPixel(node.x, node.y);
		if (node.kind === 'junction') dot(px, py, 5, [200, 30, 30]);
		else if (node.kind === 'end') dot(px, py, 4, [30, 90, 200]);
		else if (node.kind === 'classChange') dot(px, py, 4, [230, 160, 0]);
	}
	const out = options.out ?? `roads-${params.seed}.png`;
	writeFileSync(out, PNG.sync.write(image));
	const byClass = lengths(network);
	console.log(`${out}: ${JSON.stringify(set)}`);
	console.log(`growth ${milliseconds.toFixed(1)} ms; ${network.roads.length} roads, ${network.stretches.length} stretches; units of road ${Object.entries(byClass).map(([name, value]) => `${name} ${value.toFixed(0)}`).join(', ')}; ${(100 * highwaysOut(network)).toFixed(0)}% of highways reach the rim`);
	console.log(JSON.stringify(stats));
	const violations = checkRoadNetwork({ network, terrain, clearance: params.roadClearance });
	console.log(violations.length === 0 ? 'checks pass' : violations.map(({ rule, detail }) => `${rule}: ${detail}`).join('\n'));
}

if (command === 'bench') bench();
else if (command === 'check') check();
else if (command === 'png') await png();
else throw new Error(`unknown command ${command}: bench, check, or png`);
