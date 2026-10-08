/**
 * The area map's drivable roads (DDB-290) and stage 5's POIs, strongholds,
 * and approaches (DDB-291) outside Jest: timings, a sweep of the checks over
 * many maps, and a picture of one map's roads over its terrain. Like
 * terrain-bench.mjs, it transpiles the map modules into a temporary folder
 * and runs them in a fresh child process, clear of Jest's coverage and the
 * TypeScript compiler's heap.
 *
 *   node scripts/road-growth.mjs bench [--seeds 3] [--repeat 5] [--radii 600,1000,1600]
 *   node scripts/road-growth.mjs pois [--seeds 3] [--repeat 5] [--radii 600,1000,1600]
 *   node scripts/road-growth.mjs check [--maps 500] [--from 0]
 *   node scripts/road-growth.mjs png --seed 7 [--environment badlands] [--radius 1000] [--size 1024] [--window x,y,half] [--out roads.png] [--curviness 0.8 ...]
 *
 * For the V8 the desktop app runs, use Electron's bundled Node:
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron scripts/road-growth.mjs bench
 *
 * bench times stages 2 and 3 together at each radius, each row the median
 * and the slowest over the five environments and the seeds, each map's time
 * the fastest of its runs, and hashes every network so two engines can be
 * compared. pois times stage 5 the same way, on growth's first attempt, and
 * stages 2 to 5 with the lever's retries (layDrivableMap). check grows maps
 * with parameters sampled across their tuning ranges, as the property tests
 * do, runs checkRoadNetwork on each, then lays stage 5 with its retries and
 * runs checkRoadNetwork and checkPois on that. png draws one map, or a window
 * of it, with its POIs (magenta, strongholds ringed in black) and approaches;
 * any parameter can be set by name. Any command takes --profile <folder> for
 * a CPU profile of the run.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const SOURCES = [
	'core/Json', 'core/Rng', 'campaign/JsonReader', 'map/MapParams', 'map/ParamValidator', 'map/Noise', 'map/Biome', 'map/TerrainSites', 'map/Terrain',
	'map/Geometry', 'map/SegmentIndex', 'map/RoadNetwork', 'map/RoadGrowth', 'map/Highways', 'map/RoadChecks',
	'map/PoiData', 'map/Pois', 'map/PoiChecks', 'map/DrivableMap',
];
const DATA = ['data/pois.json', 'data/factions.json'];

if (process.argv[2] !== '--built') {
	const { default: ts } = await import('typescript');
	const root = join(dirname(script), '..');
	const build = mkdtempSync(join(tmpdir(), 'road-growth-'));
	for (const source of SOURCES) {
		const text = readFileSync(join(root, 'src/renderer/game', `${source}.ts`), 'utf8');
		const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
		const target = join(build, `${source}.js`);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, outputText);
	}
	for (const data of DATA) {
		const target = join(build, data);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, readFileSync(join(root, 'src/renderer/game', data)));
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
const { placePois } = load('./map/Pois.js');
const { checkPois } = load('./map/PoiChecks.js');
const { layDrivableMap } = load('./map/DrivableMap.js');

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
	return { params, map, terrain, network: grown.network, stats: grown.stats, milliseconds: fastest };
}

/**
 * Stage 5 on growth's first network and its own first stream, timed the
 * fastest of `repeat` runs, then stages 2 to 5 with the lever's retries,
 * timed once.
 */
function placeOn({ params, map, terrain, network }, repeat = 1) {
	let fastest = Infinity;
	let outcome = null;
	for (let run = 0; run < repeat; run += 1) {
		const start = now();
		outcome = placePois({ terrain, params, network, rng: map.fork('pois', 0) });
		fastest = Math.min(fastest, now() - start);
	}
	const start = now();
	const laid = layDrivableMap({ terrain, params, map });
	return { outcome, milliseconds: fastest, laid, leverMilliseconds: now() - start };
}

function pois() {
	const seeds = Number(options.seeds ?? 3);
	const repeat = Number(options.repeat ?? 5);
	const radii = (options.radii ?? '600,1000,1600').split(',').map(Number);
	for (const environment of ENVIRONMENTS) placeOn(generate({ seed: 99, environment, radius: 1000 }));
	const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
	console.log(`${runtime}, V8 ${process.versions.v8}; ${ENVIRONMENTS.length} environments x ${seeds} seeds per radius, stage 5 the fastest of ${repeat} runs each`);
	const digest = createHash('sha256');
	for (const radius of radii) {
		const times = [];
		const lever = [];
		const counts = [];
		const approaches = [];
		let first = 0;
		let reruns = 0;
		let unlaid = 0;
		for (const environment of ENVIRONMENTS) {
			for (let seed = 1; seed <= seeds; seed += 1) {
				const { outcome, milliseconds, laid, leverMilliseconds } = placeOn(generate({ seed, environment, radius }), repeat);
				times.push(milliseconds);
				lever.push(leverMilliseconds);
				if (outcome.placed) first += 1;
				if (laid.attempts.growth > 0) reruns += 1;
				if (laid.pois === null) {
					unlaid += 1;
					continue;
				}
				digest.update(JSON.stringify(laid.pois));
				counts.push(laid.pois.pois.length);
				approaches.push([...laid.pois.pois, ...laid.pois.strongholds].reduce((sum, site) => sum + site.approaches.length, 0));
			}
		}
		const maps = ENVIRONMENTS.length * seeds;
		console.log(`radius ${radius}: stage 5 median ${median(times).toFixed(1)} ms, slowest ${Math.max(...times).toFixed(1)} ms; with retries median ${median(lever).toFixed(1)} ms, slowest ${Math.max(...lever).toFixed(1)} ms; `
			+ `${first}/${maps} seated every stronghold first time, ${reruns} reran growth, ${unlaid} need the map restarted; median ${median(counts)} POIs, ${median(approaches)} approaches`);
	}
	console.log(`maps' digest ${digest.digest('hex').slice(0, 16)}`);
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
	const radii = (options.radii ?? '600,1000,1600').split(',').map(Number);
	for (const environment of ENVIRONMENTS) generate({ seed: 99, environment, radius: 1000 });
	const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
	console.log(`${runtime}, V8 ${process.versions.v8}; ${ENVIRONMENTS.length} environments x ${seeds} seeds per radius, the fastest of ${repeat} runs each`);
	// Every network's JSON, hashed: the same digest from two engines means they grew the same roads to the bit.
	const digest = createHash('sha256');
	const smoothing = { smoothed: 0, unsmoothed: 0 };
	for (const radius of radii) {
		const times = [];
		const steps = [];
		const stretches = [];
		const length = [];
		const out = [];
		for (const environment of ENVIRONMENTS) {
			for (let seed = 1; seed <= seeds; seed += 1) {
				const { network, stats, milliseconds } = generate({ seed, environment, radius }, repeat);
				digest.update(JSON.stringify(network));
				smoothing.smoothed += stats.stretches.smoothed;
				smoothing.unsmoothed += stats.stretches.unsmoothed;
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
	console.log(`${smoothing.unsmoothed} of ${smoothing.smoothed + smoothing.unsmoothed} stretches kept their steps; networks' digest ${digest.digest('hex').slice(0, 16)}`);
}

/**
 * Parameter sets across the tuning ranges: each world or network number, and
 * strongholds, which set the fewest highways the validator allows, at an end
 * of its range two times in five.
 */
function sampledSet(index) {
	const rng = new Rng({ seed: 7919 }).fork('road-sweep', index);
	const set = { seed: rng.next(), environment: rng.pick(ENVIRONMENTS) };
	for (const name of NUMBER_PARAMS) {
		const { group, kind, tuning } = MAP_PARAMETERS[name];
		if (group !== 'world' && group !== 'network' && name !== 'strongholds') continue;
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
	// Maps whose stage 5 ran out of retries on the first map attempt, which the pipeline would restart.
	let unlaid = 0;
	for (let index = from; index < from + maps; index += 1) {
		const set = sampledSet(index);
		const { params, terrain, network, stats, milliseconds } = generate(set);
		times.push(milliseconds);
		if (milliseconds > slowest.milliseconds) slowest = { milliseconds, index, steps: stats.steps };
		const checkStart = now();
		const violations = checkRoadNetwork({ network, terrain, clearance: params.roadClearance });
		checks.push(now() - checkStart);
		const laid = layDrivableMap({ terrain, params, map: new Rng({ seed: params.seed }).fork('map', 0) });
		if (laid.pois === null) unlaid += 1;
		else {
			violations.push(...checkRoadNetwork({ network: laid.pois.network, terrain, clearance: params.roadClearance }));
			violations.push(...checkPois({ map: laid.pois, routesTarget: params.routesTarget }));
		}
		if (violations.length > 0) {
			failed += 1;
			console.log(`map ${index} ${JSON.stringify(set)}`);
			for (const { rule, detail } of violations.slice(0, 5)) console.log(`  ${rule}: ${detail}`);
		}
		if ((index - from + 1) % 100 === 0) console.log(`${index - from + 1} maps, ${failed} failing, ${((now() - started) / 1000).toFixed(0)} s`);
	}
	console.log(`${maps} maps from ${from}: ${failed} failing; growth median ${median(times).toFixed(1)} ms, slowest ${slowest.milliseconds.toFixed(1)} ms (map ${slowest.index}, ${slowest.steps} steps: ${JSON.stringify(sampledSet(slowest.index))})`);
	console.log(`checkRoadNetwork median ${median(checks).toFixed(1)} ms, slowest ${Math.max(...checks).toFixed(1)} ms; ${unlaid} maps' stage 5 ran out of retries on the first map attempt`);
	process.exitCode = failed > 0 ? 1 : 0;
}

const BIOME_COLOURS = {
	scrub: [196, 190, 150], desert: [226, 208, 160], mire: [128, 150, 112], badlands: [182, 140, 110], canyons: [204, 160, 120], mountains: [150, 140, 130],
};
const ROAD_STYLES = { highway: { colour: [20, 20, 20], width: 3 }, backRoad: { colour: [70, 60, 50], width: 2 }, trail: { colour: [150, 70, 30], width: 1.2 } };
const APPROACH_COLOUR = [200, 0, 200];

async function png() {
	const { PNG } = (await import('pngjs')).default;
	const set = { seed: Number(options.seed ?? 1) };
	for (const [key, value] of Object.entries(options)) {
		if (['seed', 'size', 'out', 'window', 'profile'].includes(key)) continue;
		set[key] = key === 'environment' ? value : Number(value);
	}
	const generated = generate(set);
	const { params, terrain, stats, milliseconds } = generated;
	const laid = layDrivableMap({ terrain, params, map: generated.map });
	const network = laid.pois?.network ?? generated.network;
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
				// Light from the north-west, in a few steps so the picture compresses.
				const light = Math.max(0.55, Math.min(1.25, 1 + (sample.slopeY - sample.slopeX) * 60));
				const shade = Math.round(light * 10) / 10 * (sample.ruin > 0.5 ? 0.85 : 1);
				colour = base.map((channel) => Math.min(255, Math.round(channel * shade)));
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
		const { width } = ROAD_STYLES[roadClass];
		for (const stretch of network.stretches) {
			if (stretch.roadClass !== roadClass) continue;
			const colour = network.nodes[stretch.to].kind === 'poi' ? APPROACH_COLOUR : ROAD_STYLES[roadClass].colour;
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
		else if (node.kind === 'extension') dot(px, py, 4, APPROACH_COLOUR);
	}
	for (const stronghold of laid.pois?.strongholds ?? []) {
		const [px, py] = toPixel(network.nodes[stronghold.node].x, network.nodes[stronghold.node].y);
		dot(px, py, 16, [0, 0, 0]);
	}
	for (const node of network.nodes) {
		if (node.kind !== 'poi') continue;
		const [px, py] = toPixel(node.x, node.y);
		dot(px, py, 10, APPROACH_COLOUR);
	}
	const out = options.out ?? `roads-${params.seed}.png`;
	writeFileSync(out, PNG.sync.write(image, { colorType: 2, deflateLevel: 9 }));
	// Growth's first attempt; stage 5 may have drawn on a later one.
	const grown = generated.network;
	const byClass = lengths(grown);
	console.log(`${out}: ${JSON.stringify(set)}`);
	console.log(`growth ${milliseconds.toFixed(1)} ms; ${grown.roads.length} roads, ${grown.stretches.length} stretches; units of road ${Object.entries(byClass).map(([name, value]) => `${name} ${value.toFixed(0)}`).join(', ')}; ${(100 * highwaysOut(grown)).toFixed(0)}% of highways reach the rim`);
	console.log(JSON.stringify(stats));
	if (laid.pois === null) console.log(`stage 5 ran out of retries: ${JSON.stringify(laid.failures.slice(-3))}`);
	else {
		console.log(`stage 5 on growth attempt ${laid.attempts.growth}, its own ${laid.attempts.pois}: ${laid.pois.strongholds.length} strongholds (${laid.pois.strongholds.map(({ faction }) => faction).join(', ')}), ${laid.pois.pois.length} POIs`);
		console.log(JSON.stringify(laid.stats.pois));
	}
	const violations = [
		...checkRoadNetwork({ network, terrain, clearance: params.roadClearance }),
		...(laid.pois ? checkPois({ map: laid.pois, routesTarget: params.routesTarget }) : []),
	];
	console.log(violations.length === 0 ? 'checks pass' : violations.map(({ rule, detail }) => `${rule}: ${detail}`).join('\n'));
}

if (command === 'bench') bench();
else if (command === 'pois') pois();
else if (command === 'check') check();
else if (command === 'png') await png();
else throw new Error(`unknown command ${command}: bench, pois, check, or png`);
