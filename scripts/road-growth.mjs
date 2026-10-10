/**
 * The area map's places and drivable roads (DDB-290, DDB-442) outside Jest:
 * timings, a sweep of the network checks over many maps, and a picture of
 * one map's roads and places over its terrain. Like terrain-bench.mjs, it
 * transpiles the map modules into a temporary folder and runs them in a
 * fresh child process, clear of Jest's coverage and the TypeScript
 * compiler's heap.
 *
 *   node scripts/road-growth.mjs bench [--seeds 3] [--repeat 5] [--radii 600,1000,1600]
 *   node scripts/road-growth.mjs check [--maps 500] [--from 0]
 *   node scripts/road-growth.mjs places [--seeds 3] [--repeat 3] [--radii 600,1000,1600]
 *   node scripts/road-growth.mjs png --seed 7 [--environment badlands] [--radius 1000] [--size 1024] [--window x,y,half] [--out roads.png] [--curviness 0.8 ...]
 *
 * For the V8 the desktop app runs, use Electron's bundled Node:
 *
 *   ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron scripts/road-growth.mjs bench
 *
 * Every command runs the area map's stages through the pipeline runner
 * (map/AreaMapPipeline.ts), on its nested streams, with growth checked by
 * checkRoadNetwork as the game runs it. bench times growth at each radius,
 * each row the median and the slowest over the five environments and the
 * seeds, each map's time the fastest of its runs, and hashes every network
 * so two engines can be compared. check generates maps with parameters
 * sampled across their tuning ranges, as the property tests do, and reports
 * every map whose growth failed its checks on a first attempt, the spec's
 * health metric. places times the hazards and places stages and counts the
 * places. png draws one map, or a window of it; any parameter can be set by
 * name. Any command takes --profile <folder> for a CPU profile of the run.
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
	'core/Json', 'core/Rng', 'map/MapParams', 'map/ParamValidator', 'map/Noise', 'map/Biome', 'map/TerrainSites',
	'map/LandGrid', 'map/MapMath', 'map/Drainage', 'map/Erosion', 'map/Uplift', 'map/Land', 'map/Terrain',
	'map/Geometry', 'map/SegmentIndex', 'map/RoadNetwork', 'map/RoadGrowth', 'map/Highways', 'map/RoadChecks',
	'map/Rivers', 'map/Lakes', 'map/Water', 'map/Hazards', 'map/PlaceNames', 'map/Places', 'map/MapPipeline', 'map/AreaMapPipeline',
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
const { createTerrainSample } = load('./map/Terrain.js');
const { GROWTH_RANGES, GROWTH_TUNING } = load('./map/RoadGrowth.js');
const { checkRoadNetwork } = load('./map/RoadChecks.js');
const { areaMapPipeline } = load('./map/AreaMapPipeline.js');
const { MapPipelineError } = load('./map/MapPipeline.js');

const ENVIRONMENTS = ['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/**
 * The area map's stages through the pipeline runner, `repeat` times, keeping
 * the fastest growth runs, since other work on the machine only ever adds
 * time, and the fastest growth checks, hazards, and places. Debug, as the
 * tests run. A map that runs out of attempts throws a MapPipelineError. The
 * set can carry growth's own `branchiness` and `clearance` beside the map
 * parameters.
 */
function generate(set, repeat = 1) {
	const { branchiness, clearance = GROWTH_TUNING.clearance, ...mapSet } = set;
	const { params } = validateMapParams(resolveMapParams(mapSet).params);
	const pipeline = areaMapPipeline({ growth: { branchiness, clearance } });
	let fastest = Infinity;
	let checks = Infinity;
	let hazards = Infinity;
	let places = Infinity;
	let result = null;
	for (let run = 0; run < repeat; run += 1) {
		result = pipeline.run({ seed: params.seed, input: params, debug: true, now });
		const { timings } = result;
		fastest = Math.min(fastest, timings.growth.milliseconds);
		checks = Math.min(checks, timings.growth.checkMilliseconds);
		hazards = Math.min(hazards, timings.hazards.milliseconds);
		places = Math.min(places, timings.places.milliseconds);
	}
	const { products } = result;
	return {
		params, clearance, terrain: products.hazards.terrain, places: products.places, network: products.growth.network, stats: products.growth.stats,
		failures: result.failures, milliseconds: fastest, checkMilliseconds: checks, hazardsMilliseconds: hazards, placesMilliseconds: places,
	};
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
		const checks = [];
		const steps = [];
		const stretches = [];
		const length = [];
		const out = [];
		for (const environment of ENVIRONMENTS) {
			for (let seed = 1; seed <= seeds; seed += 1) {
				const { network, stats, milliseconds, checkMilliseconds } = generate({ seed, environment, radius }, repeat);
				digest.update(JSON.stringify(network));
				checks.push(checkMilliseconds);
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
		console.log(`radius ${radius}: median ${median(times).toFixed(1)} ms, slowest ${Math.max(...times).toFixed(1)} ms, growth's checks median ${median(checks).toFixed(1)} ms; median ${median(steps)} steps, ${median(stretches)} stretches, ${median(length).toFixed(0)} units of road; ${(100 * mean(out)).toFixed(0)}% of highways reach the rim`);
	}
	console.log(`${smoothing.unsmoothed} of ${smoothing.smoothed + smoothing.unsmoothed} stretches kept their steps; networks' digest ${digest.digest('hex').slice(0, 16)}`);
}

/**
 * Parameter sets across the tuning ranges: each world or network number,
 * strongholds, which set the fewest highways the validator allows, and
 * growth's own knobs, at an end of its range two times in five.
 */
function sampledSet(index) {
	const rng = new Rng({ seed: 7919 }).fork('road-sweep', index);
	const set = { seed: rng.next(), environment: rng.pick(ENVIRONMENTS) };
	const draw = ({ kind, tuning }) => {
		const end = rng.float();
		const value = end < 0.2 ? tuning.min : end < 0.4 ? tuning.max : tuning.min + (tuning.max - tuning.min) * rng.float();
		return kind === 'int' ? Math.round(value) : value;
	};
	for (const name of NUMBER_PARAMS) {
		const spec = MAP_PARAMETERS[name];
		if (spec.group === 'world' || spec.group === 'network' || name === 'strongholds') set[name] = draw(spec);
	}
	set.branchiness = draw(GROWTH_RANGES.branchiness);
	set.clearance = draw(GROWTH_RANGES.clearance);
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
		let map;
		try {
			map = generate(set);
		} catch (error) {
			if (!(error instanceof MapPipelineError)) throw error;
			failed += 1;
			console.log(`map ${index} ${JSON.stringify(set)}\n  ${error.message}`);
			continue;
		}
		const { stats, failures, milliseconds, checkMilliseconds } = map;
		times.push(milliseconds);
		checks.push(checkMilliseconds);
		if (milliseconds > slowest.milliseconds) slowest = { milliseconds, index, steps: stats.steps };
		if (failures.length > 0) {
			failed += 1;
			console.log(`map ${index} ${JSON.stringify(set)}`);
			for (const { stage, attempt, mapAttempt, problems } of failures.slice(0, 3)) {
				console.log(`  ${stage} attempt ${attempt}, map attempt ${mapAttempt}:`);
				for (const problem of problems.slice(0, 5)) console.log(`    ${problem}`);
			}
		}
		if ((index - from + 1) % 100 === 0) console.log(`${index - from + 1} maps, ${failed} failing, ${((now() - started) / 1000).toFixed(0)} s`);
	}
	console.log(`${maps} maps from ${from}: ${failed} failing a first attempt; growth median ${median(times).toFixed(1)} ms, slowest ${slowest.milliseconds.toFixed(1)} ms (map ${slowest.index}, ${slowest.steps} steps: ${JSON.stringify(sampledSet(slowest.index))})`);
	console.log(`growth's checks median ${median(checks).toFixed(1)} ms, slowest ${Math.max(...checks).toFixed(1)} ms`);
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
	const { params, clearance, terrain, places, network, stats, milliseconds } = generate(set);
	const size = Number(options.size ?? 1024);
	const radius = terrain.radius;
	const ruins = [places.metro, ...places.towns, ...places.villages];
	const inRuin = (x, y) => ruins.some((ruin) => (x - ruin.x) ** 2 + (y - ruin.y) ** 2 <= ruin.radius * ruin.radius);
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
				const shade = Math.round(light * 10) / 10 * (inRuin(x, y) ? 0.85 : 1);
				colour = base.map((channel) => Math.min(255, Math.round(channel * shade)));
				if (sample.obstacle === 'cliff') colour = [90, 30, 30];
				else if (sample.obstacle === 'crater') colour = [40, 40, 40];
				else if (sample.obstacle === 'lake' || sample.obstacle === 'river') colour = [70, 110, 170];
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
	// Places over the roads: crossroads small and grey, exits white, villages and towns black with a white ring.
	for (const { x, y } of places.crossroads) dot(...toPixel(x, y), 5, [90, 90, 90]);
	for (const { x, y, highway } of places.exits) {
		dot(...toPixel(x, y), highway ? 11 : 8, [20, 20, 20]);
		dot(...toPixel(x, y), highway ? 6 : 4, [255, 255, 255]);
	}
	for (const { x, y, kind } of [...places.villages, ...places.towns]) {
		dot(...toPixel(x, y), kind === 'town' ? 13 : 9, [255, 255, 255]);
		dot(...toPixel(x, y), kind === 'town' ? 10 : 6, [20, 20, 20]);
	}
	const out = options.out ?? `roads-${params.seed}.png`;
	writeFileSync(out, PNG.sync.write(image, { colorType: 2, deflateLevel: 9 }));
	const byClass = lengths(network);
	console.log(`${out}: ${JSON.stringify(set)}`);
	console.log(`${places.towns.length} towns (${places.towns.map(({ name }) => name).join(', ')}), ${places.villages.length} villages, ${places.crossroads.length} crossroads, ${places.exits.length} exits`);
	console.log(`growth ${milliseconds.toFixed(1)} ms; ${network.roads.length} roads, ${network.stretches.length} stretches; units of road ${Object.entries(byClass).map(([name, value]) => `${name} ${value.toFixed(0)}`).join(', ')}; ${(100 * highwaysOut(network)).toFixed(0)}% of highways reach the rim`);
	console.log(JSON.stringify(stats));
	const violations = checkRoadNetwork({ network, terrain, clearance });
	console.log(violations.length === 0 ? 'checks pass' : violations.map(({ rule, detail }) => `${rule}: ${detail}`).join('\n'));
}

/**
 * The hazards and places stages over the five environments by `seeds` seeds
 * at each radius: their times, the median of each map's fastest of `repeat`
 * runs, and how many of each kind of place a map gets against what it asks for.
 */
function placesBench() {
	const seeds = Number(options.seeds ?? 3);
	const repeat = Number(options.repeat ?? 3);
	const radii = (options.radii ?? '600,1000,1600').split(',').map(Number);
	const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
	console.log(`${runtime}; ${ENVIRONMENTS.length} environments x ${seeds} seeds per radius, the fastest of ${repeat} runs each`);
	for (const radius of radii) {
		const hazards = [];
		const placing = [];
		const counts = { towns: [], villages: [], crossroads: [], exits: [], short: 0 };
		for (const environment of ENVIRONMENTS) {
			for (let seed = 1; seed <= seeds; seed += 1) {
				const { params, places, hazardsMilliseconds, placesMilliseconds } = generate({ seed, environment, radius }, repeat);
				hazards.push(hazardsMilliseconds);
				placing.push(placesMilliseconds);
				counts.towns.push(places.towns.length);
				counts.villages.push(places.villages.length);
				counts.crossroads.push(places.crossroads.length);
				counts.exits.push(places.exits.length);
				if (places.towns.length < params.towns || places.villages.length < params.villages) {
					counts.short += 1;
					console.log(`  ${environment} seed ${seed}: ${places.towns.length} of ${params.towns} towns, ${places.villages.length} of ${params.villages} villages`);
				}
			}
		}
		const range = (values) => `${Math.min(...values)} to ${Math.max(...values)}`;
		console.log(`radius ${radius}: hazards median ${median(hazards).toFixed(1)} ms, places median ${median(placing).toFixed(1)} ms, slowest ${Math.max(...placing).toFixed(1)} ms; towns ${range(counts.towns)}, villages ${range(counts.villages)}, crossroads ${range(counts.crossroads)} (median ${median(counts.crossroads)}), exits ${range(counts.exits)}; ${counts.short} maps short of a town or village`);
	}
}

if (command === 'bench') bench();
else if (command === 'check') check();
else if (command === 'png') await png();
else if (command === 'places') placesBench();
else throw new Error(`unknown command ${command}: bench, check, png, or places`);
