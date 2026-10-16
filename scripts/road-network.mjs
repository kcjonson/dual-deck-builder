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
 *   node scripts/road-network.mjs dressing --seed 7 [--environment rustBelt] [--size 1400] [--window x,y,half] [--out dressing.png] [--dressing 1 ...]
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
 * it, with its places and POIs; any parameter can be set by name. dressing
 * draws one map's dressing over its land and roads, labels and all, and
 * reports what it made and how long it took. Any command takes --profile
 * <folder> for a CPU profile of the run.
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
const STAGES = ['terrain', 'water', 'hazards', 'places', 'roads', 'routeTree', 'pois', 'stops', 'dressing'];
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

/** The map's parameters from the command line: --seed and any parameter by name. */
function mapSet() {
	const set = { seed: Number(options.seed ?? 1) };
	for (const [key, value] of Object.entries(options)) {
		if (['seed', 'size', 'out', 'window', 'profile'].includes(key)) continue;
		set[key] = key === 'environment' ? value : Number(value);
	}
	return set;
}

/** The land, water, cliffs, and craters as an image, `size` pixels a side, over the square `half` world units round (centreX, centreY). */
async function landImage({ terrain, size, centreX, centreY, half }) {
	const { PNG } = (await import('pngjs')).default;
	const radius = terrain.radius;
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
	return { PNG, image };
}

async function png() {
	const map = generate(mapSet());
	const { result, params } = map;
	const terrain = result.products.hazards.terrain;
	const { places } = result.products;
	const { network } = result.products.roads;
	const size = Number(options.size ?? 1024);
	// --window x,y,half draws the square of world space around (x, y) instead of the whole disc.
	const [centreX, centreY, half] = options.window ? options.window.split(',').map(Number) : [0, 0, terrain.radius];
	const { PNG, image } = await landImage({ terrain, size, centreX, centreY, half });
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

const LABEL_LOOK = {
	metro: { size: 15, weight: 700, colour: '#2a2522', spacing: 2 },
	stronghold: { size: 10, weight: 700, colour: '#8a2a1e' },
	poi: { size: 9, weight: 600, colour: '#22543a' },
	town: { size: 11.5, weight: 700, colour: '#2a2522' },
	shield: { size: 8, weight: 700, colour: '#ffffff' },
	range: { size: 11, weight: 400, colour: '#5e5148', italic: true, spacing: 4 },
	reservoir: { size: 9.5, weight: 400, colour: '#2f5f8f', italic: true },
	lake: { size: 9.5, weight: 400, colour: '#2f5f8f', italic: true },
	river: { size: 8.5, weight: 400, colour: '#2f5f8f', italic: true, spacing: 1 },
	village: { size: 8.5, weight: 400, colour: '#3a3430' },
	pass: { size: 7.5, weight: 400, colour: '#5e5148', italic: true },
};

/**
 * One map's dressing drawn over its land and roads, for QA: street grids
 * (standing blocks rose, rubble pale), rail lines (dark with white ties,
 * thicker on bridges), crater hatching, mire stipple, and the labels set by
 * a plain greedy placement, highest priority first, each kept only where its
 * box is clear. That placement is this script's stand-in, not the view's.
 * Chromium (Playwright's) renders the SVG to a PNG; without it the SVG is
 * written instead.
 */
async function dressingPicture() {
	const map = generate(mapSet());
	const { result, params } = map;
	const { hazards, roads, dressing } = result.products;
	const terrain = hazards.terrain;
	const size = Number(options.size ?? 1400);
	const [centreX, centreY, half] = options.window ? options.window.split(',').map(Number) : [0, 0, terrain.radius];
	const { PNG, image } = await landImage({ terrain, size, centreX, centreY, half });
	const scale = size / (2 * half);
	const px = (x) => (((x - centreX) / half + 1) / 2 * size).toFixed(1);
	const py = (y) => ((-(y - centreY) / half + 1) / 2 * size).toFixed(1);
	const line = (points) => {
		let d = '';
		for (let index = 0; index < points.length; index += 2) d += `${index === 0 ? 'M' : 'L'}${px(points[index])},${py(points[index + 1])}`;
		return d;
	};
	const svg = [];
	svg.push(`<image href="data:image/png;base64,${PNG.sync.write(image, { colorType: 2 }).toString('base64')}" width="${size}" height="${size}"/>`);
	svg.push(`<g opacity="0.55">${dressing.hatches.map(({ x, y, inner, outer, ux, uy, spacing }, index) => {
		const angle = (Math.atan2(-uy, ux) * 180 / Math.PI).toFixed(1);
		return `<pattern id="h${index}" width="${(spacing * scale).toFixed(2)}" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(${angle})"><line x1="0" y1="0" x2="0" y2="4" stroke="#7a2e22" stroke-width="1"/></pattern>`
			+ `<path fill="url(#h${index})" fill-rule="evenodd" d="M${px(x - outer)},${py(y)}a${(outer * scale).toFixed(1)},${(outer * scale).toFixed(1)} 0 1,0 ${(2 * outer * scale).toFixed(1)},0a${(outer * scale).toFixed(1)},${(outer * scale).toFixed(1)} 0 1,0 ${(-2 * outer * scale).toFixed(1)},0Z M${px(x - inner)},${py(y)}a${(inner * scale).toFixed(1)},${(inner * scale).toFixed(1)} 0 1,0 ${(2 * inner * scale).toFixed(1)},0a${(inner * scale).toFixed(1)},${(inner * scale).toFixed(1)} 0 1,0 ${(-2 * inner * scale).toFixed(1)},0Z"/>`;
	}).join('')}</g>`);
	let dots = '';
	for (let index = 0; index < dressing.stipple.length; index += 2) dots += `M${px(dressing.stipple[index])},${py(dressing.stipple[index + 1])}h0.01`;
	svg.push(`<path d="${dots}" stroke="#4f6b45" stroke-width="1.6" stroke-linecap="round"/>`);
	for (const { ux, uy, spacing, blocks, rubble } of dressing.districts) {
		const inset = spacing * 0.4;
		const quads = (centres) => {
			let d = '';
			for (let index = 0; index < centres.length; index += 2) {
				const x = centres[index];
				const y = centres[index + 1];
				const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [x + (ux * a - uy * b) * inset, y + (uy * a + ux * b) * inset]);
				d += `M${corners.map(([cx, cy]) => `${px(cx)},${py(cy)}`).join('L')}Z`;
			}
			return d;
		};
		svg.push(`<path d="${quads(blocks)}" fill="#c99d93"/><path d="${quads(rubble)}" fill="#c99d93" opacity="0.3"/>`);
	}
	const roadLook = { trail: 'stroke="#8a6a44" stroke-width="1" stroke-dasharray="3 2"', backRoad: 'stroke="#6c6660" stroke-width="1.1"', highway: 'stroke="#c8461e" stroke-width="2.6"' };
	for (const roadClass of ['trail', 'backRoad', 'highway']) {
		const d = roads.network.stretches.filter((stretch) => stretch.roadClass === roadClass).map(({ points }) => line(points)).join('');
		if (roadClass === 'highway') svg.push(`<path d="${d}" fill="none" stroke="#5a2412" stroke-width="3.8"/>`);
		svg.push(`<path d="${d}" fill="none" ${roadLook[roadClass]}/>`);
	}
	svg.push(`<path d="${roads.network.broken.map(({ points }) => line(points)).join('')}" fill="none" stroke="#c8461e" stroke-width="2.4" stroke-dasharray="4 4" opacity="0.6"/>`);
	for (const { points, length, bridges } of dressing.rails) {
		svg.push(`<path d="${line(points)}" fill="none" stroke="#2b2b2b" stroke-width="2.6"/><path d="${line(points)}" fill="none" stroke="#f4f1ea" stroke-width="1.2" stroke-dasharray="3 3"/>`);
		for (const { start, end } of bridges) {
			const deck = [];
			for (let along = start; along <= end + 0.01; along += Math.max(0.5, (end - start) / 4)) {
				const at = { x: 0, y: 0 };
				pointAlongPolyline(points, Math.min(along, length), at);
				deck.push(at.x, at.y);
			}
			if (deck.length >= 4) svg.push(`<path d="${line(deck)}" fill="none" stroke="#111" stroke-width="5"/>`);
		}
	}
	for (const poi of result.products.pois.pois) {
		const stronghold = poi.type === 'stronghold';
		svg.push(`<circle cx="${px(poi.site.x)}" cy="${py(poi.site.y)}" r="${stronghold ? 4.5 : 3.5}" fill="${stronghold ? '#8a2a1e' : '#2f8a5a'}" stroke="#111" stroke-width="1"/>`);
	}
	const { places } = result.products;
	for (const { x, y, kind } of [...places.villages, ...places.towns]) svg.push(`<circle cx="${px(x)}" cy="${py(y)}" r="${kind === 'town' ? 3.5 : 2.2}" fill="#222" stroke="#fff" stroke-width="1"/>`);

	const boxes = [];
	const clear = (box) => box.x0 >= 0 && box.y0 >= 0 && box.x1 <= size && box.y1 <= size && boxes.every((other) => box.x1 < other.x0 || other.x1 < box.x0 || box.y1 < other.y0 || other.y1 < box.y0);
	const placed = {};
	const dropped = {};
	dressing.labels.forEach((label, index) => {
		const look = LABEL_LOOK[label.kind];
		const width = label.text.length * look.size * 0.56 + label.text.length * (look.spacing ?? 0);
		const font = `font-family="Georgia, serif" font-size="${look.size}" font-weight="${look.weight}"${look.italic ? ' font-style="italic"' : ''}${look.spacing ? ` letter-spacing="${look.spacing}"` : ''}`;
		const ax = Number(px(label.x));
		const ay = Number(py(label.y));
		let box;
		let markup;
		if (label.path.length >= 4) {
			const xs = [];
			const ys = [];
			for (let at = 0; at < label.path.length; at += 2) {
				xs.push(Number(px(label.path[at])));
				ys.push(Number(py(label.path[at + 1])));
			}
			// Set it left to right.
			const flip = xs[xs.length - 1] < xs[0];
			const path = [];
			for (let at = 0; at < xs.length; at += 1) path.push(flip ? [xs[xs.length - 1 - at], ys[ys.length - 1 - at]] : [xs[at], ys[at]]);
			const span = path.reduce((total, [x, y], at) => (at === 0 ? 0 : total + Math.hypot(x - path[at - 1][0], y - path[at - 1][1])), 0);
			if (span < width) {
				dropped[label.kind] = (dropped[label.kind] ?? 0) + 1;
				return;
			}
			// Small boxes along the middle of the path, as long as the text, stand in for its outline.
			const pieces = [];
			let walked = 0;
			for (let at = 1; at < path.length; at += 1) {
				const [x0, y0] = path[at - 1];
				const [x1, y1] = path[at];
				const piece = Math.hypot(x1 - x0, y1 - y0);
				const steps = Math.max(1, Math.ceil(piece / look.size));
				for (let step = 0; step < steps; step += 1) {
					const middle = walked + piece * (step + 0.5) / steps;
					if (Math.abs(middle - span / 2) > width / 2) continue;
					const cx = x0 + (x1 - x0) * (step + 0.5) / steps;
					const cy = y0 + (y1 - y0) * (step + 0.5) / steps;
					pieces.push({ x0: cx - look.size * 0.6, y0: cy - look.size * 0.6, x1: cx + look.size * 0.6, y1: cy + look.size * 0.6 });
				}
				walked += piece;
			}
			box = pieces;
			markup = `<path id="l${index}" d="M${path.map(([x, y]) => `${x},${y}`).join('L')}" fill="none"/><text ${font} fill="${look.colour}" stroke="#f4f1ea" stroke-width="2.5" paint-order="stroke"><textPath href="#l${index}" startOffset="50%" text-anchor="middle">${label.text}</textPath></text>`;
		} else if (label.kind === 'shield') {
			const w = width + 6;
			box = { x0: ax - w / 2, y0: ay - 6, x1: ax + w / 2, y1: ay + 6 };
			markup = `<rect x="${box.x0}" y="${box.y0}" width="${w}" height="12" rx="3" fill="#2a4c8a" stroke="#fff" stroke-width="1"/><text x="${ax}" y="${ay + 3}" text-anchor="middle" ${font} fill="#fff">${label.text}</text>`;
		} else {
			const right = ['town', 'village', 'poi', 'stronghold', 'pass'].includes(label.kind);
			const left = right ? ax + 6 : ax - width / 2;
			box = { x0: left - 1, y0: ay - look.size * 0.8 - 1, x1: left + width + 1, y1: ay + look.size * 0.3 + 1 };
			markup = `<text x="${left}" y="${ay + look.size * 0.3}" ${font} fill="${look.colour}" stroke="#f4f1ea" stroke-width="2.5" paint-order="stroke">${label.text}</text>`;
		}
		const parts = Array.isArray(box) ? box : [box];
		if (!parts.every(clear)) {
			dropped[label.kind] = (dropped[label.kind] ?? 0) + 1;
			return;
		}
		boxes.push(...parts);
		placed[label.kind] = (placed[label.kind] ?? 0) + 1;
		svg.push(markup);
	});

	const document = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${svg.join('')}</svg>`;
	const out = options.out ?? `dressing-${params.seed}.png`;
	let rendered = false;
	try {
		const { chromium } = createRequire(script)('@playwright/test');
		const browser = await chromium.launch();
		const page = await browser.newPage({ viewport: { width: size, height: size } });
		await page.setContent(`<html><body style="margin:0">${document}</body></html>`);
		await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } });
		await browser.close();
		rendered = true;
	} catch (error) {
		writeFileSync(out.replace(/\.png$/, '.svg'), document);
		console.log(`no Chromium (${error.message.split('\n')[0]}), wrote the SVG instead`);
	}
	const blocks = dressing.districts.reduce((sum, { blocks: standing }) => sum + standing.length / 2, 0);
	const rubble = dressing.districts.reduce((sum, { rubble: fallen }) => sum + fallen.length / 2, 0);
	const kinds = Object.keys(LABEL_LOOK).filter((kind) => placed[kind] || dropped[kind]);
	console.log(`${rendered ? out : out.replace(/\.png$/, '.svg')}: ${JSON.stringify(mapSet())}`);
	console.log(`dressing ${map.fastest.dressing.toFixed(1)} ms (stops ${map.fastest.stops.toFixed(1)}, whole map ${result.milliseconds.toFixed(0)}); metro ${dressing.metroName}, routes ${dressing.routeNumbers.join(', ')}`);
	console.log(`${dressing.districts.length} districts (${dressing.districts.filter(({ kind }) => kind === 'metro').length} in the metro), ${blocks} blocks standing, ${rubble} rubble; ${dressing.rails.length} of ${params.railLines} rail lines, ${dressing.rails.map(({ length, bridges }) => `${length.toFixed(0)} units with ${bridges.length} bridges`).join(', ') || 'none'}; ${dressing.hatches.length} hatched craters; ${dressing.stipple.length / 2} mire dots`);
	console.log(`labels placed (dropped): ${kinds.map((kind) => `${kind} ${placed[kind] ?? 0} (${dropped[kind] ?? 0})`).join(', ')}`);
	console.log(`ranges: ${dressing.ranges.map(({ name, cells }) => `${name} ${cells}`).join(', ') || 'none'}`);
}

/** A point along a polyline, as Geometry's pointAlong finds it. */
function pointAlongPolyline(points, distance, out) {
	let travelled = 0;
	for (let index = 0; index + 3 < points.length; index += 2) {
		const segment = Math.hypot(points[index + 2] - points[index], points[index + 3] - points[index + 1]);
		if (travelled + segment >= distance && segment > 0) {
			const share = (distance - travelled) / segment;
			out.x = points[index] + (points[index + 2] - points[index]) * share;
			out.y = points[index + 1] + (points[index + 3] - points[index + 1]) * share;
			return out;
		}
		travelled += segment;
	}
	out.x = points[points.length - 2];
	out.y = points[points.length - 1];
	return out;
}

if (command === 'bench') bench();
else if (command === 'check') check();
else if (command === 'png') await png();
else if (command === 'places') placesBench();
else if (command === 'dressing') await dressingPicture();
else throw new Error(`unknown command ${command}: bench, check, png, places, or dressing`);
