/**
 * The area map's places and road network (Maps 6 to 8) outside Jest:
 * timings, a sweep of the stages' first-attempt health over sampled
 * parameters, and a picture of one map's roads and places over its land. Like terrain-bench.mjs, it transpiles the
 * map modules into a temporary folder and runs them in a fresh child process,
 * clear of Jest's coverage and the TypeScript compiler's heap.
 *
 *   node scripts/road-network.mjs bench [--seeds 3] [--repeat 1] [--radii 1000,1200]
 *   node scripts/road-network.mjs check [--maps 30] [--from 0]
 *   node scripts/road-network.mjs places [--seeds 3] [--repeat 3] [--radii 600,1000,1600]
 *   node scripts/road-network.mjs png --seed 7 [--environment badlands] [--radius 1000] [--size 1024] [--window x,y,half] [--out roads.png] [--loops 0.8 ...]
 *
 * Every command runs the area map's stages through the pipeline runner
 * (map/AreaMapPipeline.ts), on their nested streams, the roads checked as the
 * game checks them and the POI stage strict. bench times each stage at each
 * radius, over the five environments and the seeds, each map's time the
 * fastest of its runs, with the network's size, loops, bridges, and the POIs
 * it seats, and hashes every network so two engines can be compared. check
 * runs parameters sampled across their tuning ranges and reports each stage's
 * first-attempt pass rate, the spec's health metric, and any map the pipeline
 * gave up on. places times the hazards and places stages and counts the
 * places against what each map asks for. png draws one map, or a window of
 * it, with its places and POIs; any parameter can be set by name. Any command takes --profile <folder> for a CPU
 * profile of the run.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);

if (process.argv[2] !== '--built') {
	const { default: ts } = await import('typescript');
	const root = join(dirname(script), '..');
	const build = mkdtempSync(join(tmpdir(), 'road-network-'));
	for (const folder of ['core', 'map']) {
		const source = join(root, 'src/renderer/game', folder);
		for (const name of readdirSync(source)) {
			if (!name.endsWith('.ts') || name.endsWith('.test.ts')) continue;
			const text = readFileSync(join(source, name), 'utf8');
			const { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } });
			const target = join(build, folder, name.replace(/\.ts$/, '.js'));
			mkdirSync(dirname(target), { recursive: true });
			writeFileSync(target, outputText);
		}
	}
	mkdirSync(join(build, 'data'), { recursive: true });
	const data = join(root, 'src/renderer/game/data');
	for (const name of readdirSync(data)) if (name.endsWith('.json')) writeFileSync(join(build, 'data', name), readFileSync(join(data, name)));
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
const { checkRoadNetwork } = load('./map/RoadChecks.js');
const { areaMapPipeline } = load('./map/AreaMapPipeline.js');
const { MapPipelineError } = load('./map/MapPipeline.js');
const { loopsNeeded } = load('./map/Roads.js');

const ENVIRONMENTS = ['mixed', 'highDesert', 'rustBelt', 'floodlands', 'badlands'];
const STAGES = ['terrain', 'water', 'hazards', 'places', 'roads', 'routeTree', 'pois'];
const now = () => Number(process.hrtime.bigint()) / 1e6;
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** The area map's stages through the runner, `repeat` times, keeping each stage's fastest run, since other work on the machine only ever adds time. Debug, as the tests run. */
function generate(set, repeat = 1) {
	const { params } = validateMapParams(resolveMapParams(set).params);
	const pipeline = areaMapPipeline();
	const fastest = Object.fromEntries(STAGES.map((stage) => [stage, Infinity]));
	let checks = Infinity;
	let result = null;
	for (let run = 0; run < repeat; run += 1) {
		result = pipeline.run({ seed: params.seed, input: params, debug: true, now });
		for (const stage of STAGES) fastest[stage] = Math.min(fastest[stage], result.timings[stage].milliseconds / Math.max(1, result.timings[stage].runs));
		checks = Math.min(checks, result.timings.roads.checkMilliseconds / Math.max(1, result.timings.roads.runs));
	}
	return { params, result, fastest, checks };
}

function describe({ result }) {
	const { places, roads, routeTree, pois } = result.products;
	const { network, stats } = roads;
	const length = stats.lengths.highway + stats.lengths.backRoad + stats.lengths.trail;
	const routes = pois.pois.filter(({ type }) => type !== 'stronghold').map(({ arrivals }) => arrivals.length);
	return {
		places: places.towns.length + places.villages.length + places.crossroads.length + places.exits.length,
		nodes: network.nodes.length,
		stretches: network.stretches.length,
		length,
		trailShare: stats.lengths.trail / length,
		loops: stats.loops,
		bridges: stats.bridges,
		broken: network.broken.length,
		passes: network.passes.length,
		meetingPoints: routeTree.meetingPoints.length,
		pois: routes.length,
		target: pois.rings.reduce((sum, { target }) => sum + target, 0),
		strongholds: pois.strongholds.length,
		threeRoutes: routes.filter((count) => count === 3).length,
		retries: result.failures.length,
	};
}

function bench() {
	const seeds = Number(options.seeds ?? 3);
	const repeat = Number(options.repeat ?? 1);
	const radii = (options.radii ?? '1000,1200').split(',').map(Number);
	generate({ seed: 99, radius: 1000 });
	const runtime = process.versions.electron ? `Electron ${process.versions.electron}` : `Node ${process.version}`;
	console.log(`${runtime}, V8 ${process.versions.v8}; ${ENVIRONMENTS.length} environments x ${seeds} seeds per radius, the fastest of ${repeat} runs each`);
	const digest = createHash('sha256');
	for (const radius of radii) {
		const times = Object.fromEntries(STAGES.map((stage) => [stage, []]));
		const checks = [];
		const rows = [];
		for (const environment of ENVIRONMENTS) {
			for (let seed = 1; seed <= seeds; seed += 1) {
				const map = generate({ seed, environment, radius }, repeat);
				digest.update(JSON.stringify(map.result.products.roads.network));
				for (const stage of STAGES) times[stage].push(map.fastest[stage]);
				checks.push(map.checks);
				rows.push(describe(map));
			}
		}
		const column = (key) => rows.map((row) => row[key]);
		const sum = (key) => column(key).reduce((total, value) => total + value, 0);
		console.log(`radius ${radius}:`);
		console.log(`  ms per run, median (slowest): ${STAGES.map((stage) => `${stage} ${median(times[stage]).toFixed(0)} (${Math.max(...times[stage]).toFixed(0)})`).join(', ')}; the roads' checks ${median(checks).toFixed(0)}`);
		console.log(`  median ${median(column('nodes'))} nodes, ${median(column('stretches'))} stretches, ${median(column('length')).toFixed(0)} units of road (${(100 * median(column('trailShare'))).toFixed(0)}% trail), ${median(column('loops'))} loops (least ${Math.min(...column('loops'))}), ${median(column('bridges'))} bridges, ${median(column('passes'))} passes, ${median(column('broken'))} broken spans`);
		console.log(`  ${median(column('meetingPoints'))} meeting points; POIs placed ${sum('pois')} of ${sum('target')} (least map ${Math.min(...rows.map(({ pois, target }) => pois / target)).toFixed(2)}), strongholds ${sum('strongholds')}, three-route POIs ${sum('threeRoutes')}; ${rows.filter(({ retries }) => retries > 0).length} of ${rows.length} maps needed a retry`);
	}
	console.log(`networks' digest ${digest.digest('hex').slice(0, 16)}`);
}

/** Parameter sets across the tuning ranges: each world, network, and gameplay number at an end of its range two times in five. */
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
		if (spec.group === 'world' || spec.group === 'network' || name === 'strongholds' || name === 'poiDensity') set[name] = draw(spec);
	}
	return set;
}

function check() {
	const maps = Number(options.maps ?? 30);
	const from = Number(options.from ?? 0);
	const firstPass = Object.fromEntries(STAGES.map((stage) => [stage, 0]));
	const reasons = new Map();
	let gaveUp = 0;
	let broken = 0;
	const roadTimes = [];
	for (let index = from; index < from + maps; index += 1) {
		const set = sampledSet(index);
		let map;
		try {
			map = generate(set);
		} catch (error) {
			if (!(error instanceof MapPipelineError)) throw error;
			gaveUp += 1;
			console.log(`map ${index} ${JSON.stringify(set)}\n  gave up: ${error.message}`);
			continue;
		}
		const { result, params } = map;
		roadTimes.push(map.fastest.roads);
		for (const stage of STAGES) {
			if (!result.failures.some((failure) => failure.stage === stage && failure.mapAttempt === 0 && failure.attempt === 0)) firstPass[stage] += 1;
		}
		for (const { stage, problems } of result.failures) {
			for (const problem of problems) {
				const reason = `${stage}: ${problem.split(':')[0]}`;
				reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
			}
		}
		const violations = checkRoadNetwork({ network: result.products.roads.network, terrain: result.products.hazards.terrain });
		if (violations.length > 0) {
			broken += 1;
			console.log(`map ${index} ${JSON.stringify(set)}: ${violations.slice(0, 3).map(({ rule, detail }) => `${rule}: ${detail}`).join('; ')}`);
		}
		const row = describe(map);
		console.log(`map ${index} ${params.environment} r${params.radius}: ${row.places} places, ${row.loops} loops of ${loopsNeeded(params, result.products.roads.stats.inland)} needed, POIs ${row.pois} of ${row.target}, strongholds ${row.strongholds} of ${params.strongholds}, roads ${map.fastest.roads.toFixed(0)} ms, retries ${row.retries}`);
	}
	console.log(`${maps} maps from ${from}: first-attempt pass rate ${STAGES.map((stage) => `${stage} ${firstPass[stage]}`).join(', ')} of ${maps - gaveUp}; ${gaveUp} gave up; ${broken} broke a road rule; roads median ${median(roadTimes).toFixed(0)} ms`);
	console.log(`failures by reason: ${[...reasons].map(([reason, count]) => `${reason} ${count}`).join(', ') || 'none'}`);
	process.exitCode = gaveUp > 0 || broken > 0 ? 1 : 0;
}

const BIOME_COLOURS = {
	scrub: [206, 200, 160], desert: [230, 214, 170], mire: [150, 168, 128], badlands: [190, 156, 126], canyons: [210, 170, 132], mountains: [168, 158, 146],
};
const ROAD_STYLES = { highway: { colour: [200, 60, 30], width: 3 }, backRoad: { colour: [70, 66, 60], width: 1.8 }, trail: { colour: [130, 90, 50], width: 1.1 } };

async function png() {
	const { PNG } = (await import('pngjs')).default;
	const set = { seed: Number(options.seed ?? 1) };
	for (const [key, value] of Object.entries(options)) {
		if (['seed', 'size', 'out', 'window', 'profile'].includes(key)) continue;
		set[key] = key === 'environment' ? value : Number(value);
	}
	const map = generate(set);
	const { result, params } = map;
	const terrain = result.products.hazards.terrain;
	const { places } = result.products;
	const { network } = result.products.roads;
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
			let colour = [240, 238, 232];
			if (x * x + y * y <= radius * radius) {
				terrain.sample(x, y, sample);
				const base = BIOME_COLOURS[sample.biome];
				const light = Math.max(0.6, Math.min(1.2, 1 + (sample.slopeY - sample.slopeX) * 60));
				colour = base.map((channel) => Math.min(255, Math.round(channel * Math.round(light * 10) / 10)));
				if (sample.obstacle === 'cliff') colour = [110, 50, 45];
				else if (sample.obstacle === 'crater') colour = [50, 45, 45];
				else if (terrain.waterAt(x, y) !== null) colour = [90, 130, 185];
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
	const line = (points, width, colour, dashed = false) => {
		let walked = 0;
		for (let point = 0; point + 3 < points.length; point += 2) {
			const [ax, ay] = toPixel(points[point], points[point + 1]);
			const [bx, by] = toPixel(points[point + 2], points[point + 3]);
			const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 2));
			for (let step = 0; step <= steps; step += 1) {
				walked += Math.hypot(bx - ax, by - ay) / steps;
				if (dashed && Math.floor(walked / 4) % 2 === 1) continue;
				dot(ax + (bx - ax) * step / steps, ay + (by - ay) * step / steps, width, colour);
			}
		}
	};
	for (const roadClass of ['trail', 'backRoad', 'highway']) {
		const { colour, width } = ROAD_STYLES[roadClass];
		for (const stretch of network.stretches) if (stretch.roadClass === roadClass) line(stretch.points, width, colour, roadClass === 'trail');
	}
	for (const stretch of network.broken) line(stretch.points, ROAD_STYLES.highway.width, [255, 255, 255], true);
	for (const node of network.nodes) if (node.kind === 'end') dot(...toPixel(node.x, node.y), 4, [30, 90, 200]);
	// Places: crossroads small and grey, exits ringed, red on a highway, villages and towns black with a white ring.
	for (const { x, y } of places.crossroads) dot(...toPixel(x, y), 4, [60, 60, 60]);
	for (const { x, y, highway } of places.exits) {
		dot(...toPixel(x, y), 9, [20, 20, 20]);
		dot(...toPixel(x, y), 5, highway ? [200, 60, 30] : [255, 255, 255]);
	}
	for (const { x, y, kind } of [...places.villages, ...places.towns]) {
		dot(...toPixel(x, y), kind === 'town' ? 11 : 8, [255, 255, 255]);
		dot(...toPixel(x, y), kind === 'town' ? 8 : 5, [30, 30, 30]);
	}
	for (const { x, y } of network.passes) {
		const [px, py] = toPixel(x, y);
		dot(px, py, 5, [255, 255, 255]);
	}
	for (const poi of result.products.pois.pois) {
		const [px, py] = toPixel(poi.site.x, poi.site.y);
		const stronghold = poi.type === 'stronghold';
		dot(px, py, stronghold ? 11 : 8, [20, 20, 20]);
		dot(px, py, stronghold ? 8 : 5, stronghold ? [150, 40, 160] : poi.arrivals.length === 3 ? [250, 210, 40] : [40, 170, 90]);
	}
	const out = options.out ?? `roads-${params.seed}.png`;
	writeFileSync(out, PNG.sync.write(image, { colorType: 2, deflateLevel: 9 }));
	const row = describe(map);
	console.log(`${out}: ${JSON.stringify(set)}`);
	console.log(`${places.towns.length} towns (${places.towns.map(({ name }) => name).join(', ')}), ${places.villages.length} villages, ${places.crossroads.length} crossroads, ${places.exits.length} exits`);
	console.log(`roads ${map.fastest.roads.toFixed(0)} ms; ${row.nodes} nodes, ${row.stretches} stretches, ${row.length.toFixed(0)} units (${(100 * row.trailShare).toFixed(0)}% trail), ${row.loops} loops, ${row.bridges} bridges, ${row.passes} passes, ${row.broken} broken; POIs ${row.pois} of ${row.target}, strongholds ${row.strongholds}, three-route ${row.threeRoutes}; retries ${row.retries}`);
	const violations = checkRoadNetwork({ network, terrain });
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
				const { params, result, fastest } = generate({ seed, environment, radius }, repeat);
				const { places } = result.products;
				hazards.push(fastest.hazards);
				placing.push(fastest.places);
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
